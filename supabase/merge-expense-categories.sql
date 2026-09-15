-- Consolidate expense categories: 62 -> 11.
--
-- Run in Supabase: SQL Editor > New query > paste > Run. One transaction, so
-- it either lands whole or not at all. Safe to re-run: the second run finds
-- nothing left to move and changes nothing.
--
-- Why a merge and not a rename: the 62 names grew one entry at a time, so the
-- same thing was spelled three ways in three different months (Grocery /
-- Groceries / Grocey), and half the list holds a single expense each. Neither
-- the picker nor the ranked bars can say anything useful about a list shaped
-- like that. The mapping below is the whole decision; everything under it is
-- mechanical.
--
-- What is NOT preserved: monthly_budget on a category that gets merged away.
-- Every category in this project currently has a null budget, so nothing is
-- actually lost today — but if budgets are set before this runs, set them
-- again on the 11 survivors afterwards.
--
-- Expense rows themselves are never deleted, only repointed. The amounts,
-- dates and notes come through untouched, so every historical total stays the
-- number it was.

begin;

create temporary table category_merge (old_name text primary key, new_name text not null)
  on commit drop;

insert into category_merge (old_name, new_name) values
  -- Food at home. 'Snacks'/'Snack' are the convenience-store version of the
  -- same trip and 'Rice'/'Fruits'/'Milk' are single line items that were never
  -- going to earn their own row in a chart.
  ('Grocery', 'Groceries'), ('Groceries', 'Groceries'), ('Grocey', 'Groceries'),
  ('Snacks', 'Groceries'), ('Snack', 'Groceries'), ('Fruits', 'Groceries'),
  ('Rice', 'Groceries'), ('Milk', 'Groceries'),

  -- Food out. 'Dinner' is a time of day, not a different kind of spending.
  ('Dine Out', 'Dining Out'), ('Dining out', 'Dining Out'), ('Dinner', 'Dining Out'),

  -- The recurring bill block: utilities, connectivity, household help, rent.
  -- These are the payments that arrive whether or not anyone decides anything,
  -- which is what makes them worth seeing as one number.
  ('Monthly', 'Fixed Monthly'), ('Bills', 'Fixed Monthly'), ('Utilities', 'Fixed Monthly'),
  ('Rent', 'Fixed Monthly'), ('Internet', 'Fixed Monthly'), ('Water', 'Fixed Monthly'),
  ('LPG', 'Fixed Monthly'), ('Gas', 'Fixed Monthly'), ('Load', 'Fixed Monthly'),
  ('Subscriptions', 'Fixed Monthly'), ('Cleaner', 'Fixed Monthly'), ('Helpers', 'Fixed Monthly'),

  -- Things for the house rather than for the month.
  ('Household', 'Household'), ('Houseware', 'Household'), ('Hardware', 'Household'),
  ('Garden', 'Household'), ('Toiletries', 'Household'),

  -- One child, spelled six ways, plus the categories that are about to become
  -- the same child getting older.
  ('Baby', 'Baby & Kids'), ('Baby 2', 'Baby & Kids'), ('Baby Items', 'Baby & Kids'),
  ('Baby Clothes', 'Baby & Kids'), ('Formula Milk', 'Baby & Kids'), ('Toddler', 'Baby & Kids'),
  ('Toys', 'Baby & Kids'), ('School', 'Baby & Kids'), ('School Supplies', 'Baby & Kids'),

  -- 'Medicine' vs 'Medical' was never a distinction anyone applied twice the
  -- same way. Grooming and Wellness sit here because they are the same errand.
  ('Medicine', 'Health'), ('Medical', 'Health'), ('Dental', 'Health'),
  ('Vitamins', 'Health'), ('Eyewear', 'Health'), ('Wellness', 'Health'),
  ('Grooming', 'Health'),

  -- Getting around, including what the car costs to keep.
  ('Fuel', 'Transport'), ('Parking', 'Transport'), ('Toll', 'Transport'),
  ('Fare', 'Transport'), ('Transportation', 'Transport'), ('Transport', 'Transport'),
  ('Car', 'Transport'),

  -- Durable things bought for a person.
  ('Clothing', 'Shopping'), ('Accessories', 'Shopping'), ('Electronics', 'Shopping'),
  ('Books', 'Shopping'),

  -- Discretionary time. 'Vacation' held one expense; 'Travel' held the rest of
  -- the same trips.
  ('Travel', 'Travel & Fun'), ('Vacation', 'Travel & Fun'), ('Entertainment', 'Travel & Fun'),

  -- Spending on other people, which spikes in December and should be readable
  -- as one seasonal shape rather than two.
  ('Gifts', 'Gifts & Occasions'), ('Christmas', 'Gifts & Occasions'),

  -- The genuine remainder. Kept small on purpose: a large 'Other' is a sign
  -- the other ten are wrong.
  ('Fees', 'Fees & Other'), ('Other', 'Fees & Other');

-- 1. Make sure every target name exists, for every user that has anything to
--    merge into it. `on conflict do nothing` covers the targets that are
--    already there under their final name (Groceries, Household, Transport).
insert into public.expense_categories (user_id, name)
select distinct c.user_id, m.new_name
from public.expense_categories c
join category_merge m on m.old_name = c.name
on conflict (user_id, name) do nothing;

-- 2. Repoint the expenses. This is the only step that touches history, and it
--    changes one column. The composite FK means the join has to carry user_id
--    through so a row can never land on another user's category.
update public.expenses e
set category_id = tgt.id
from public.expense_categories src
join category_merge m on m.old_name = src.name
join public.expense_categories tgt
  on tgt.user_id = src.user_id and tgt.name = m.new_name
where e.category_id = src.id
  and e.user_id = src.user_id
  and tgt.id <> src.id;

-- 3. Drop the emptied categories. `on delete restrict` on the FK is the
--    safety net here: if step 2 missed an expense, this errors and the whole
--    transaction rolls back rather than orphaning anything. The not-exists is
--    belt and braces so the failure mode is a no-op, not an abort.
delete from public.expense_categories c
using category_merge m
where m.old_name = c.name
  and c.name <> m.new_name
  and not exists (select 1 from public.expenses e where e.category_id = c.id);

commit;

-- Check: 11 rows, and the counts below should sum to the same 1185 expenses
-- that existed before.
--
--   select c.name, count(e.id) as n, coalesce(sum(e.amount), 0) as total
--   from public.expense_categories c
--   left join public.expenses e on e.category_id = c.id
--   group by c.name
--   order by total desc;
