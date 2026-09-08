-- Bulk import of a Date / Vendor / Category / Amount spreadsheet into public.expenses.
--
-- Why this exists rather than pasting into the Table Editor: the sheet's four
-- columns do not line up with the four columns `expenses` actually needs.
--
--   Date     -> spent_on     straightforward
--   Vendor   -> note         there is no vendor column; the free-text note is it
--   Category -> category_id  a uuid FK, NOT the name — it has to be looked up,
--                            and the category row created if it does not exist
--   Amount   -> amount       must be strictly positive, so no currency symbols,
--                            no thousands separators, no parenthesised negatives
--
-- and `user_id` defaults to auth.uid(), which is NULL here: the SQL editor runs
-- as postgres, not as a logged-in user. A raw paste therefore fails the NOT NULL
-- on user_id before it ever gets to the FK.
--
-- So: land the sheet verbatim in a staging table (that part IS a plain paste),
-- then let SQL do the lookup and the type conversion.

-- ---------------------------------------------------------------------------
-- Step 0. Confirm your login email resolves to exactly one user. Every
-- statement below looks your id up this way, and a `where email =` that
-- matches nothing makes step 4b insert zero rows without complaining.
-- ---------------------------------------------------------------------------
select id, email from auth.users where email = 'you@example.com';

-- And make that a hard stop rather than a hint. Every lookup below is a scalar
-- subquery, so a non-matching email yields NULL, not an error: step 4a fails
-- confusingly on the user_id NOT NULL, and step 4b would insert zero rows in
-- complete silence. Run this and it says so plainly instead.
do $$
begin
  if (select count(*) from auth.users where email = 'you@example.com') <> 1 then
    raise exception 'No single auth.users row for that email. Replace you@example.com everywhere in this file before running steps 4a/4b.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Step 1. Staging table — all text, so a messy export cannot fail the load.
-- ---------------------------------------------------------------------------
create table if not exists public.import_expenses (
  date_text     text,
  vendor_text   text,
  category_text text,
  amount_text   text
);

-- Step 2. Load the sheet into it, either way:
--
--   a) Table Editor > import_expenses > Insert > Import data from CSV, or
--   b) paste rows here as a values list:
--
--        insert into public.import_expenses values
--          ('2026-01-15', 'Loblaws',   'Groceries',  '84.32'),
--          ('2026-01-16', 'Petro-Can', 'Transport', '$62.10');
--
-- Get the dates into YYYY-MM-DD in the sheet first (Format > Number > Custom
-- date and time). Step 3 also accepts M/D/YYYY, but only those two shapes —
-- 03/04/2026 is ambiguous and Postgres will read it as the American one.

-- ---------------------------------------------------------------------------
-- Step 3. Sanity-check the staging rows BEFORE inserting anything.
-- Expect zero rows back. Anything listed here would be silently dropped or
-- would abort the insert below, so fix it in staging first.
--
-- The negative check matters most: step 4b strips everything but digits and a
-- dot, so '-62.10' and '(62.10)' both arrive as a positive 62.10 rather than
-- being rejected. `expenses.amount` is positive by design and refunds belong
-- in `incomes`, so decide what those rows are before importing them.
-- ---------------------------------------------------------------------------
select *,
       case
         when btrim(coalesce(date_text, '')) = ''                     then 'missing date'
         when btrim(coalesce(category_text, '')) = ''                 then 'missing category'
         when not (date_text ~ '^\s*\d{4}-\d{2}-\d{2}\s*$'
                or date_text ~ '^\s*\d{1,2}/\d{1,2}/\d{4}\s*$')      then 'date not YYYY-MM-DD or M/D/YYYY'
         when amount_text ~ '^\s*[-(]'                                then 'amount looks negative'
         when regexp_replace(coalesce(amount_text, ''), '[^0-9.]', '', 'g') = ''
                                                                      then 'unparseable amount'
         when regexp_replace(amount_text, '[^0-9.]', '', 'g')::numeric <= 0
                                                                      then 'amount not positive'
         when char_length(btrim(category_text)) > 40                  then 'category name over 40 chars'
         when char_length(btrim(coalesce(vendor_text, ''))) > 200     then 'vendor over 200 chars'
       end as problem
from public.import_expenses
where case
        when btrim(coalesce(date_text, '')) = ''                      then true
        when btrim(coalesce(category_text, '')) = ''                  then true
        when not (date_text ~ '^\s*\d{4}-\d{2}-\d{2}\s*$'
               or date_text ~ '^\s*\d{1,2}/\d{1,2}/\d{4}\s*$')       then true
        when amount_text ~ '^\s*[-(]'                                then true
        when regexp_replace(coalesce(amount_text, ''), '[^0-9.]', '', 'g') = ''
                                                                      then true
        when regexp_replace(amount_text, '[^0-9.]', '', 'g')::numeric <= 0
                                                                      then true
        when char_length(btrim(category_text)) > 40                   then true
        when char_length(btrim(coalesce(vendor_text, ''))) > 200      then true
        else false
      end;

-- ---------------------------------------------------------------------------
-- Step 4. The import. Run both statements, in this order. Like every other
-- step they need your user id, so replace `you@example.com` throughout this
-- file first — it appears five times, including the step 0 guard.
-- ---------------------------------------------------------------------------

-- 4a. Create any category the sheet mentions that you do not have yet.
--     Existing categories keep their monthly_budget — on conflict do nothing.
insert into public.expense_categories (user_id, name)
select (select id from auth.users where email = 'you@example.com'),
       btrim(category_text)
from public.import_expenses
where btrim(coalesce(category_text, '')) <> ''
group by btrim(category_text)
on conflict (user_id, name) do nothing;

-- 4b. The expenses themselves, joined to the categories by name.
--     An inner join, so a row whose category somehow still does not exist is
--     left behind rather than inserted against the wrong one.
insert into public.expenses (user_id, category_id, spent_on, amount, note)
select u.id,
       c.id,
       case
         when btrim(i.date_text) ~ '^\d{4}-\d{2}-\d{2}$' then btrim(i.date_text)::date
         else to_date(btrim(i.date_text), 'FMMM/FMDD/YYYY')
       end,
       regexp_replace(i.amount_text, '[^0-9.]', '', 'g')::numeric(12, 2),
       nullif(btrim(coalesce(i.vendor_text, '')), '')
from public.import_expenses i
cross join (select id from auth.users where email = 'you@example.com') u
join public.expense_categories c
  on c.user_id = u.id
 and c.name = btrim(i.category_text);

-- ---------------------------------------------------------------------------
-- Step 5. Check the totals, then empty staging.
--
-- Emptying it is what makes this file safe to re-run: step 4b has no way to
-- tell a genuine duplicate (two coffees, same day, same price) from a second
-- run of the same import, so it does not try. An empty staging table inserts
-- nothing instead.
-- ---------------------------------------------------------------------------
select c.name, count(*) as rows, sum(e.amount) as total
from public.expenses e
join public.expense_categories c on c.id = e.category_id
where e.user_id = (select id from auth.users where email = 'you@example.com')
group by c.name
order by total desc;

truncate public.import_expenses;
-- drop table public.import_expenses;  -- once you are done importing for good
