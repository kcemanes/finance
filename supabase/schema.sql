-- Budget tracker schema.
-- Run this in Supabase: SQL Editor > New query > paste > Run.
-- Written to be safe to re-run.
--
-- Money moves in two directions and gets a table pair each: expense_categories +
-- expenses for money out, income_sources + incomes for money in. Both
-- amount columns stay strictly positive and the *table* carries the
-- direction, so no aggregation anywhere has to reason about signs.

-- ---------------------------------------------------------------------------
-- Rename: `categories` became `expense_categories`.
--
-- Ahead of the create below, so a project that already ran an earlier version
-- of this file keeps its rows. The expenses foreign key, its indexes and the
-- unique constraints all follow the table itself rather than its name, so
-- nothing else has to be rebuilt — only the RLS policy is named after the old
-- table, and it is dropped further down.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.categories') is not null
     and to_regclass('public.expense_categories') is null then
    alter table public.categories rename to expense_categories;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Expense categories
-- ---------------------------------------------------------------------------
create table if not exists public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  monthly_budget numeric(12, 2) check (monthly_budget is null or monthly_budget >= 0),
  created_at timestamptz not null default now(),

  -- One category name per user, and a target the composite FK below can point at.
  unique (user_id, name),
  unique (user_id, id)
);

-- ---------------------------------------------------------------------------
-- Expenses
-- ---------------------------------------------------------------------------
create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  category_id uuid not null,
  spent_on date not null default current_date,
  amount numeric(12, 2) not null check (amount > 0),
  note text check (note is null or char_length(note) <= 200),
  created_at timestamptz not null default now(),

  -- Composite FK: an expense can only point at a category owned by the SAME
  -- user. Foreign keys are checked without RLS, so a plain FK on category_id
  -- alone would let a crafted request attach someone else's category id.
  constraint expenses_category_fkey
    foreign key (user_id, category_id)
    references public.expense_categories (user_id, id)
    on update cascade
    on delete restrict
);

create index if not exists expenses_user_spent_on_idx
  on public.expenses (user_id, spent_on desc);

create index if not exists expenses_user_category_idx
  on public.expenses (user_id, category_id);

-- ---------------------------------------------------------------------------
-- Income sources
--
-- The mirror of expense_categories, with one meaning inverted: monthly_budget
-- is a ceiling you would rather stay under, expected_monthly is a floor you
-- would rather clear. Same shape, opposite test — anything comparing an amount
-- against it has to know which of the two it is holding.
-- ---------------------------------------------------------------------------
create table if not exists public.income_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  expected_monthly numeric(12, 2) check (expected_monthly is null or expected_monthly >= 0),
  created_at timestamptz not null default now(),

  unique (user_id, name),
  unique (user_id, id)
);

-- ---------------------------------------------------------------------------
-- Incomes
-- ---------------------------------------------------------------------------
create table if not exists public.incomes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  source_id uuid not null,
  received_on date not null default current_date,
  amount numeric(12, 2) not null check (amount > 0),
  note text check (note is null or char_length(note) <= 200),
  created_at timestamptz not null default now(),

  -- Composite, for the same reason as expenses_category_fkey above.
  constraint incomes_source_fkey
    foreign key (user_id, source_id)
    references public.income_sources (user_id, id)
    on update cascade
    on delete restrict
);

create index if not exists incomes_user_received_on_idx
  on public.incomes (user_id, received_on desc);

create index if not exists incomes_user_source_idx
  on public.incomes (user_id, source_id);

-- ---------------------------------------------------------------------------
-- Row Level Security: every row is private to the user that owns it.
-- Without this, the publishable key in the browser can read the whole table.
-- ---------------------------------------------------------------------------
alter table public.expense_categories enable row level security;
alter table public.expenses enable row level security;
alter table public.income_sources enable row level security;
alter table public.incomes enable row level security;

-- The policy the rename above left behind, still carrying the old table's name.
drop policy if exists "categories are private" on public.expense_categories;

drop policy if exists "expense categories are private" on public.expense_categories;
create policy "expense categories are private"
  on public.expense_categories
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "expenses are private" on public.expenses;
create policy "expenses are private"
  on public.expenses
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "income sources are private" on public.income_sources;
create policy "income sources are private"
  on public.income_sources
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "incomes are private" on public.incomes;
create policy "incomes are private"
  on public.incomes
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
