-- Remove the four starter categories the app re-seeded over the merge.
--
-- Run in Supabase: SQL Editor > New query > paste > Run. One transaction, so
-- it either lands whole or not at all. Safe to re-run: the second run finds
-- nothing left to move and changes nothing.
--
-- What happened: ./merge-expense-categories.sql ran at 2026-09-15 05:03:23 and
-- did exactly what it said — 1195 expenses across 11 categories. Fifty-seven
-- seconds later, one sync poll, the app wrote four of them back: Rent,
-- Utilities, Dining out and Other. Those are the entries in
-- ../src/lib/store.ts's STARTER_CATEGORIES that the merge had just folded
-- away. The other two starters, Groceries and Transport, were seeded in the
-- same pass but collided with the surviving rows on `unique (user_id, name)`
-- and the sync engine quietly merged them, which is why four came back rather
-- than six.
--
-- The seed fired because a pull that is not authenticated is indistinguishable
-- from an account with no rows: every RLS policy here is `to authenticated`,
-- so an anon-role request matches no policy and PostgREST answers `[]` with a
-- 200 rather than a 401. The sync engine believed it. That is fixed in
-- ../src/lib/sync.ts — deploy that before running this, or the next expired
-- token puts the same four rows back.
--
-- Note the second Dining Out is 'Dining out', lowercase o. The unique
-- constraint is case-sensitive, so Postgres holds them as two categories while
-- a picker shows what looks like one name twice.

begin;

create temporary table category_cleanup (old_name text primary key, new_name text not null)
  on commit drop;

insert into category_cleanup (old_name, new_name) values
  ('Rent', 'Fixed Monthly'),
  ('Utilities', 'Fixed Monthly'),
  ('Dining out', 'Dining Out'),
  ('Other', 'Fees & Other');

-- Deliberately missing, next to the merge this mirrors: a step that creates
-- the target names. Requiring the target to already exist is what keeps this
-- safe for an account that never ran the merge — a user whose 'Rent' is still
-- their own category has no 'Fixed Monthly' to fold it into, so both
-- statements below skip them entirely rather than dismantling a taxonomy that
-- was never broken.

-- 1. Repoint the expenses. One row today: the 1,400 recorded against the
--    re-seeded Utilities on 2026-09-16, which belongs under Fixed Monthly with
--    the rest of the recurring bills. Amounts, dates and notes are untouched,
--    so every historical total stays the number it was. The other three
--    categories are empty and this is a no-op for them.
update public.expenses e
set category_id = tgt.id
from public.expense_categories src
join category_cleanup m on m.old_name = src.name
join public.expense_categories tgt
  on tgt.user_id = src.user_id and tgt.name = m.new_name
where e.category_id = src.id
  and e.user_id = src.user_id
  and tgt.id <> src.id;

-- 2. Drop the emptied categories. `on delete restrict` on the FK is the safety
--    net: if step 1 missed an expense, this errors and the whole transaction
--    rolls back rather than orphaning anything. The not-exists is belt and
--    braces so the failure mode is a no-op, not an abort.
--
--    monthly_budget on these four is lost, as it was in the merge. All four
--    are null today, so nothing is actually going.
delete from public.expense_categories c
using category_cleanup m, public.expense_categories tgt
where m.old_name = c.name
  and tgt.user_id = c.user_id
  and tgt.name = m.new_name
  and tgt.id <> c.id
  and not exists (select 1 from public.expenses e where e.category_id = c.id);

commit;

-- Nothing to do on the devices. The next successful pull calls
-- `replaceFromRemote`, which drops local rows the server no longer has.
--
-- Check: 11 rows, and the counts should still sum to 1195 expenses.
--
--   select c.name, count(e.id) as n, coalesce(sum(e.amount), 0) as total
--   from public.expense_categories c
--   left join public.expenses e on e.category_id = c.id
--   group by c.name
--   order by total desc;
