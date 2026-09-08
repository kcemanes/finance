-- Finance tracker schema.
-- Run this in Supabase: SQL Editor > New query > paste > Run.
-- Written to be safe to re-run.
--
-- Money moves in two directions and gets a table pair each: expense_categories +
-- expenses for money out, income_sources + incomes for money in. Both
-- amount columns stay strictly positive and the *table* carries the
-- direction, so no aggregation anywhere has to reason about signs.
--
-- Those four are flows. A third pair — accounts + balances, at the bottom of
-- this file — records the stock those flows move: what each pot was worth at
-- each month end. Same convention again, with `accounts.kind` standing in for
-- the table as the thing that carries direction.

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

-- ---------------------------------------------------------------------------
-- Accounts
--
-- The balance sheet half of the app. Expenses and incomes are *flows* — money
-- crossing a line during a month; an account and its balances are a *stock* —
-- what a pot was worth at a moment. The two are related (a month's flow is
-- most of what moved the stock) but they are not the same rows, and neither
-- can be derived from the other: a market gain moves net worth without any
-- transaction, and a transfer between two of your own accounts is a
-- transaction that moves nothing.
--
-- `kind` carries the direction, the way the expenses/incomes table pair does:
-- every amount below is positive and a debt is a debt because of its account,
-- not because of a sign. Nothing downstream has to reason about negatives.
--
-- There is deliberately no currency column. Money here is stored as a plain
-- number in whatever currency the user thinks in, exactly as expenses and
-- incomes are — ./src/lib/currency relabels figures, it never converts them.
-- A currency column would imply a conversion that does not happen, and the
-- first foreign-currency account would silently be added to the total at face
-- value. Until there is an FX rate per snapshot to convert with, an account in
-- another currency is better left out.
-- ---------------------------------------------------------------------------
create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  kind text not null check (kind in ('bank', 'investment', 'other_asset', 'debt')),

  -- Closed, sold, paid off. Archiving rather than deleting is what keeps the
  -- history honest: the balances that account held are still part of what net
  -- worth was in those months, and deleting the parent would rewrite them out
  -- of the past. An inactive account keeps its rows and stops being asked for.
  is_active boolean not null default true,
  created_at timestamptz not null default now(),

  unique (user_id, name),
  unique (user_id, id)
);

-- ---------------------------------------------------------------------------
-- Balances
--
-- One row per account per month end: what it was worth on that date. Not a
-- ledger — nothing accumulates, each row stands alone and replaces whatever
-- the same account said about the same month before it.
-- ---------------------------------------------------------------------------
create table if not exists public.balances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  account_id uuid not null,

  -- Always the last day of its month. The app normalises before writing; this
  -- check is what stops a second, differently-dated row for the same month
  -- from slipping past the unique constraint below and being counted twice.
  --
  -- Expressed as "the next day is the first of a month", which is true of a
  -- month end and nothing else. Date arithmetic only, so there is no cast to
  -- get wrong and nothing here that is not immutable.
  as_of date not null check (extract(day from as_of + 1) = 1),

  -- Positive, like every other amount in this schema. A debt account holds
  -- what is owed, not a negative asset.
  amount numeric(14, 2) not null check (amount >= 0),
  note text check (note is null or char_length(note) <= 200),
  created_at timestamptz not null default now(),

  -- One reading per account per month. Re-recording a month is an update of
  -- this row, which is why the client upserts rather than inserts.
  constraint balances_account_month_key unique (user_id, account_id, as_of),

  -- Composite, for the same reason as expenses_category_fkey above.
  constraint balances_account_fkey
    foreign key (user_id, account_id)
    references public.accounts (user_id, id)
    on update cascade
    on delete restrict
);

create index if not exists balances_user_as_of_idx
  on public.balances (user_id, as_of desc);

create index if not exists balances_user_account_idx
  on public.balances (user_id, account_id);

alter table public.accounts enable row level security;
alter table public.balances enable row level security;

drop policy if exists "accounts are private" on public.accounts;
create policy "accounts are private"
  on public.accounts
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "balances are private" on public.balances;
create policy "balances are private"
  on public.balances
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
