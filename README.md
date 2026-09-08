# kcemanes-budget

A small personal budget tracker: log expenses by category and income by
source, set a monthly budget per category, and see where the month went.
Record what each of your accounts is worth at a month end and it tracks net
worth too — then tells you how much of each month's change the ledger
actually accounts for. Each account only ever sees its own data. Light/dark
theme and the display currency are picked in the header and remembered per
browser.

It is an installable, offline-first app: it launches, reads and records
entries with no connection, and syncs when one comes back. See
[Offline](#offline).

Live at **[budget.kcemanes.com](https://budget.kcemanes.com)**.

## Stack

- **React 19 + TypeScript**, built by **Vite**
- **Tailwind CSS v4** (via `@tailwindcss/vite`, no config file — theme tokens
  live in [src/index.css](src/index.css))
- **Supabase** for email/password auth and Postgres storage
- **IndexedDB** as the local source of truth, with a sync engine on top
- **vite-plugin-pwa** (Workbox) for the manifest and service worker
- **GitHub Pages** for hosting, deployed by GitHub Actions

## How it works

Everything runs in the browser and talks to Supabase directly — there is no
server of our own. Data is kept private by Postgres Row Level Security
rather than by application code, so the publishable key shipped in the
bundle can only reach the signed-in user's rows.

The screen never reads from Supabase, though. It reads from an IndexedDB
copy of the account, and a sync engine moves changes between that copy and
Postgres in the background — see [Offline](#offline).

| Path | Role |
| --- | --- |
| [src/App.tsx](src/App.tsx) | Session gate: loading → [Login](src/components/Login.tsx) → [Dashboard](src/components/Dashboard.tsx) |
| [src/hooks/useSession.ts](src/hooks/useSession.ts) | The signed-in account, resolved so that being offline never looks like being signed out |
| [src/hooks/useSyncState.ts](src/hooks/useSyncState.ts) | Subscribes the header to the sync engine's status and queue depth |
| [src/hooks/useBudgetData.ts](src/hooks/useBudgetData.ts) | Categories and income sources, plus a date range of expenses and incomes, re-read whenever the store changes |
| [src/hooks/useNetWorth.ts](src/hooks/useNetWorth.ts) | Accounts and every balance ever recorded — no date range, because net worth is a running series |
| [src/hooks/useElementWidth.ts](src/hooks/useElementWidth.ts) | The rendered width of an element, so a chart can draw at one unit per pixel |
| [src/hooks/usePwa.ts](src/hooks/usePwa.ts) | Subscribes to "an update is waiting" and "the browser is offering an install" |
| [src/lib/supabase.ts](src/lib/supabase.ts) | The single Supabase client; fails loudly if env vars are missing |
| [src/lib/api.ts](src/lib/api.ts) | All reads and writes for both directions of money — local, never networked |
| [src/lib/db.ts](src/lib/db.ts) | Opening IndexedDB, and reading or writing whole stores |
| [src/lib/store.ts](src/lib/store.ts) | Categories, expenses, income sources, incomes, accounts, balances, and the outbox |
| [src/lib/sync.ts](src/lib/sync.ts) | The only module that talks to Supabase |
| [src/lib/auth.ts](src/lib/auth.ts) | Who is signed in, in a form that survives being offline |
| [src/lib/pwa.ts](src/lib/pwa.ts) | Service worker registration, update and install prompts |
| [src/lib/format.ts](src/lib/format.ts) | Date and month range helpers |
| [src/lib/analytics.ts](src/lib/analytics.ts) | The per-month, per-parent and actual-against-target aggregations behind the charts, plus both axis scales; below those, the net worth series and the reconciliation that joins it to the ledger |
| [src/lib/theme.ts](src/lib/theme.ts) | Theme choice, storage, and the `data-theme` stamp |
| [src/lib/currency.ts](src/lib/currency.ts) | The currency list, money formatting, and storage |
| [src/components/Balances.tsx](src/components/Balances.tsx) | The Net worth tab: the balance sheet, the trend, and what moved it |
| [src/components/SnapshotForm.tsx](src/components/SnapshotForm.tsx) | Month-end entry — one prefilled field per account, writing only what changed |
| [src/components/NetWorthChart.tsx](src/components/NetWorthChart.tsx) | Net worth over the months that were actually recorded |
| [src/components/AccountsEditor.tsx](src/components/AccountsEditor.tsx) | Renaming, reclassifying and archiving accounts |
| [src/components/ThemeToggle.tsx](src/components/ThemeToggle.tsx) | The light/dark button, used by both Login and Dashboard |
| [src/components/SyncStatus.tsx](src/components/SyncStatus.tsx) | The header pill: offline, syncing, or changes still queued |
| [src/components/UpdatePrompt.tsx](src/components/UpdatePrompt.tsx) | Offers a downloaded update rather than reloading unasked |
| [src/components/InstallButton.tsx](src/components/InstallButton.tsx) | Hands back the install prompt, on the browsers that defer one |
| [scripts/generate-icons.mjs](scripts/generate-icons.mjs) | Draws the install icons from the same geometry as the favicon |
| [supabase/schema.sql](supabase/schema.sql) | Tables, indexes, and RLS policies |

A few details worth knowing:

- The dashboard has two views. **Month** is scoped to one month at a time;
  expenses and incomes are fetched for that month's inclusive date range and
  the stepper can't move past the current month. **Charts** covers the last
  3, 6 or 12 months ending with the current one, and deliberately ignores the
  stepper — a trend that stops halfway through history because you were
  browsing March is a trap rather than a feature.
- The charts are hand-drawn SVG and CSS rather than a charting library: four
  figures still did not justify the dependency in a bundle that has to
  precache for offline use. Ranking stays one series in one hue, since what a
  single category or source is worth is magnitude rather than identity, and
  every figure has a table view underneath so no value is reachable only by
  hovering. The by-month pair and the net chart are where colour does carry
  identity — see [Charting two directions](#charting-two-directions).
- A brand-new account has no categories, so a starter set (Groceries, Rent,
  Transport, Utilities, Dining out, Other) is seeded — but only once a sync
  has confirmed the server side is genuinely empty. Seeding on any empty
  read would re-seed on every cold offline start. Income sources are
  deliberately **not** seeded: there is no equivalent of "Groceries" that is
  right for everyone, and skipping it means there is no second re-seed gate
  to keep in step with the first.
- `expenses` uses a **composite** foreign key on `(user_id, category_id)`,
  and `incomes` the same on `(user_id, source_id)`. Foreign keys are checked
  without RLS, so a plain FK on the child column alone would let a crafted
  request attach another user's category or source.
- Amounts come back from `numeric()` as strings once large enough, so every
  money column is coerced in `pull()` on the way in — `amount` on both
  halves, and the `monthly_budget` / `expected_monthly` targets.

## Money in and money out

Expenses hang off categories; incomes hang off **income sources**. The two
halves are deliberately separate table pairs rather than one signed table,
and `amount` stays `> 0` on both sides — the *table* carries the direction,
so nothing downstream reasons about signs.

Folding them together looks cheaper and is not. Letting a sign carry the
direction would mean dropping `check (amount > 0)`, and that check turns out
to be load bearing in more places than it looks: `axisMax()` guards on a
non-negative peak, the summary bars set a CSS width straight from an amount,
and the month's hero figure would quietly change meaning from "spent" to
"net". Two positive tables cost one more pair of `selectAll` calls and break
nothing. Where a signed number really is the point — the net per month — it
is *derived* by `monthlyFlow()` rather than stored.

### One form, one ledger

[EntryForm](src/components/EntryForm.tsx) records both directions. They take
the same five fields under different names, so a mode switch reuses the
layout rather than stacking a second near-identical form underneath. Which
list the picker draws from is the only real asymmetry.

That selection is *derived* from the list rather than stored, which is what
stops the select ever holding a value matching none of its own options — a
picker displaying one thing while its state says another, and submitting the
empty string on top of it. An invalid pick falls back to the first entry; an
empty list falls back to the create field, which is the normal opening state
for income, since a new account is given starter categories but no sources.

[Ledger](src/components/Ledger.tsx) shows both in one table, because "where
did the month go" is a question about both halves at once. Direction is
carried by the **sign** in front of the amount rather than by its colour: a
`+` is text, and survives being read aloud, printed in greyscale, or seen by
someone who cannot separate the two hues. The colour only confirms it.

One Tailwind trap, since the ledger walks straight into it: two competing
`text-*` utilities in one class list resolve by stylesheet order, not by the
order they are written in. `.text-income-strong` happens to be emitted
*before* `.text-ink`, so a shared base class carrying `text-ink` would
silently win over the per-row one. The amount cell therefore carries no
colour in its base and picks the whole thing per row.

### Targets

A category's `monthly_budget` and a source's `expected_monthly` are the same
shape and the **opposite test**: a budget is a ceiling you would rather stay
under, an expectation is a floor you would rather clear.

[TargetSummary](src/components/TargetSummary.tsx) draws both, and takes the
comparison as a `miss` prop rather than inferring it from the data. Handed
income rows with the expense test it would paint a source that *beat* its
target in the overspend colour — so the prop exists to make that bug hard to
write rather than merely unlikely. Missing a target is also stated in words,
`over` or `short`, because which side of a target you landed on is the one
thing on that row worth not leaving to a hue.

Bars stay relative to the largest figure in their own list rather than to
each row's target, which is the behaviour the spending summary always had: it
compares rows to each other, and the target is the annotation. A row is kept
when either its actual or its target is non-zero, so a target missed
completely still appears instead of silently dropping out.

**Neither target has an editor yet.** `monthly_budget` never had one — the
form has always passed `null` — and `expected_monthly` matches it, so both
are set by hand in SQL for now. Everything that *reads* them is finished; it
is only the writing that is missing.

### Charting two directions

Ranking a set of categories is a question about magnitude, so
[RankedBars](src/components/RankedBars.tsx) still draws one series in one
hue. Putting income *next to* spending is a question about identity, and that
is the one thing the old palette could not express — so income gets a hue of
its own, and `--color-income` was repointed from the emerald alias it had
been sitting on since before anything used it.

Indigo, not the conventional green, because both halves of the conventional
pairing were already spoken for: emerald is the accent and therefore reads as
spending, and rose means overspending. Emerald-against-rose is also the one
in/out pairing that collapses under red-green colour blindness, which a
two-series chart cannot afford. Indigo against emerald survives it.

Hue is never the only channel. In the grouped chart income sits left and
spending right inside every month band, there is a legend above it, and each
band exposes a focusable readout naming both figures; the table underneath
carries In, Out and Net as text.

[NetChart](src/components/NetChart.tsx) is the one figure where colour is a
value judgment rather than an identity, so it deliberately does **not** reuse
the series hues. A surplus is `income` — the money stayed with you — and a
deficit is `overspend`, which is what that token already means everywhere
else. Emerald is kept out of it entirely: directly above sits a chart where
emerald means "spending", and reusing it for "good month" would make the pair
contradict each other. Which side of zero a column is on, the sign in the
tooltip, and the Net column of the table above all say the same thing without
reference to hue.

Its axis comes from `axisBounds()` rather than `axisMax()`. Both round the
*step* instead of the ends, but a diverging axis needs one more thing from
that: because both ends land on a multiple of the step, **zero is always
exactly on a gridline**. A zero line floating between ticks would misreport
which columns sit below it, which is the only thing the chart exists to show.
The range can end up wider than four steps when it has to reach both ways —
that is the honest outcome, the alternative being a clipped column.

Finally, all of this is conditional on there being income to draw. An account
that has never recorded any sees the view exactly as it was: one series, one
hero figure, two figures, no legend. A net chart would restate the spending
chart upside down and a by-source chart would be empty, so neither is
rendered.

### Adding it to a browser that already has data

The two new IndexedDB stores arrive as `DB_VERSION` 2. `onupgradeneeded`
already creates whatever is missing and leaves what exists alone, so there is
no data migration to write.

It is the first version bump the app has ever shipped, though, and that
carries one cost: a second tab still holding version 1 open blocks the
upgrade, `onblocked` resolves null, and *that* tab drops to the in-memory
fallback for the rest of its life, because `opening` is memoized. Writes
still work and still sync — they just do not outlive the tab. A reload clears
it, which is what the update prompt is already nudging people towards.

## Net worth

The two directions of money above are *flows*: amounts that crossed a line
during a month. The **Net worth** tab records the *stock* those flows move —
what each account was worth at each month end — and then subtracts one from
the other.

Neither can be derived from the other, which is the whole reason both are
here. A market gain moves net worth with no transaction behind it. A transfer
between two of your own accounts is a transaction that moves nothing. And the
figure that matters most is only available when you have both:

> Net worth went up ₱163,733 last month. The ledger says you saved ₱135,000
> of that. The other ₱28,733 is the market.

### Accounts and balances

A third table pair, following the same convention as the first two:
[`accounts`](supabase/schema.sql) is the parent, `balances` the rows under it,
every amount positive, and direction carried by something other than a sign —
here `accounts.kind`, one of `bank`, `investment`, `other_asset` or `debt`. A
debt holds what is owed and is subtracted because of what it is.

A balance is a **snapshot, not a transaction**. One row per account per month
end, and recording the same month twice replaces the earlier reading rather
than adding to it. `unique (user_id, account_id, as_of)` enforces that, and a
check constraint pins `as_of` to the last day of its month so a second,
differently-dated row cannot slip past the constraint and be counted twice.

Because a correction has to land on the row that is already there,
`store.setBalance()` looks for an existing row for that account and month and
reuses its id. That is what keeps the local copy agreeing with the server's
unique constraint, and what lets the push stay an ordinary upsert on `id` like
every other write in the app.

### Recording a month

The form is a vertical list of accounts with an amount against each, not a
grid. A grid of accounts across months is the right way to *read* a balance
sheet and the worst way to write one — thirteen columns scrolled sideways on a
phone with the row labels off screen. The list is the same thirteen numbers in
a minute on the couch, and it works with no connection like everything else.

Two rules make it short:

- **Every field starts on the figure that already applies** — this month's
  reading if one was taken, otherwise the last one carried forward, labelled
  so a carried number is never mistaken for a fresh one.
- **Only fields you changed are written.** Leaving an account alone is not an
  omission; carrying forward already says it did not move. So the two or three
  that did move are the whole job, and the store does not fill with rows
  restating last month.

Clearing a field withdraws that month's reading. Typing `0` is different, and
means the account really was empty.

### What the chart does that a spreadsheet does not

`netWorthSeries()` produces a point only for months that were actually
recorded. A grid has a column for every month whether or not it was filled in,
so its chart plots the empty ones as zero and the line falls off a cliff at
today and runs flat to the end of the year. There is no such column here and
nothing to fall off: the series simply stops at the last reading.

The other half of the same idea is carry-forward. An account that was not
re-read keeps its last known value rather than counting as zero, so a month
where you only updated three accounts is still a complete balance sheet. Every
carried figure is marked, and the count rides on the point, because it changes
how to read the chart: a month where everything was carried is last month
redrawn, not news.

An archived account is carried only as far as its final reading. That is what
stops closing an account from either dragging a stale figure forward forever
or rewriting the months it was genuinely part of. There is no delete, for the
same reason and because the foreign key is `on delete restrict`.

### Reconciliation

`reconcile()` is the join between the two halves. For each step between
readings it reports the change in net worth, the ledger's income less expenses
over the months in between, and the remainder.

The remainder is named as a remainder — *Other*, not *returns*. It is defined
by what it is not, so unrecorded spending lands in it alongside market
movement and interest. When the ledger was not loaded for every month of a
span the split is shown as `—` rather than guessed, because a flow silently
treated as zero would read as an enormous unexplained gain.

### One currency

Balances are plain numbers in whatever currency you think in, exactly as
expenses and incomes are — [`currency.ts`](src/lib/currency.ts) relabels
figures, it never converts them. So there is deliberately no currency column
on `accounts`: it would imply a conversion that does not happen, and the first
foreign-currency account would be added to the total at face value. Until
there is an FX rate stored per snapshot to convert with, an account in another
currency is better left out — which is what the spreadsheet this replaces was
already doing by hand.

### What the sync engine had to learn

Two changes, both in the merge rather than the transport.

`account.set` and `balance.set` are upserts of rows that may already exist,
where every other outbox kind is a first sighting of a new row. That flips who
wins in `replaceFromRemote()` when a pulled row and a still-queued local row
share an id: for a create, incoming wins (the server has the row and the
queued op would rewrite the same values); for an upsert, the local row wins,
or an unsynced correction would revert on screen every time a sync ran before
it was pushed. The `overwrites` flag on each entry in `SYNCED` is that
distinction.

The other is a new collision. Two devices, both offline, both told to record
August: each mints its own id and the second is refused by the unique
constraint on (account, month). There is nothing to merge — the two rows
describe the same account and the same month and differ only in the id — so
`adoptRemoteBalance()` forgets the local one and lets the pull bring down the
one that won.

There is deliberately no equivalent for a refused `account.set`. That would be
a duplicate *name*, and the repair `mergeDuplicateName()` performs for
categories is only safe when the two rows were meant to be the same thing. An
`account.set` is as often a rename as a creation, and folding a renamed
account's whole history into whichever account already held that name is not
recoverable. Both forms check names against the ones already on the device
instead, which makes the collision rare enough to simply report.

### Adding it to a browser that already has data

The two new stores arrive as `DB_VERSION` 3. As with the bump to 2,
`onupgradeneeded` creates whatever is missing and leaves what exists alone, so
there is no data migration — and the same cost applies: a tab still holding
version 2 open blocks the upgrade and drops itself to the in-memory fallback
until it is reloaded.

## Offline

The app installs to a home screen and works with no connection at all,
including a cold launch. Two independent pieces make that true.

**The shell** is precached by a service worker generated at build time by
vite-plugin-pwa, configured in [vite.config.ts](vite.config.ts). Supabase
requests are deliberately *not* cached: the data already lives in IndexedDB,
and an HTTP cache in front of the API would only be a second copy that
disagrees with it.

**The data** lives in IndexedDB, and it is the only thing the UI reads.
[src/lib/api.ts](src/lib/api.ts) — what the components call — never touches
the network, which is why the form behaves the same on a train as on wifi.

Where IndexedDB cannot be opened at all — a private window, storage blocked
by policy — [db.ts](src/lib/db.ts) quietly falls back to an in-memory copy
instead of failing. The app then behaves like the online-only version it used
to be: writes still work and still sync, they just do not outlive the tab.

### How a write works

Adding an expense or an income writes it to IndexedDB and appends a change to
the **outbox**, an ordered log of what this device has done that Postgres has
not confirmed. The call returns as soon as that lands.

Row ids are generated by the client rather than by `gen_random_uuid()`.
That is the detail that makes offline writes work: the row has its final id
the moment it is created, so nothing has to be re-pointed when it
eventually syncs, and the push can use `upsert` — a replay after a lost
response rewrites the same row instead of inserting a duplicate.

Deleting an entry that has not synced yet drops its queued create rather than
queueing a delete behind it, so a row the server has never seen is not
described to it twice. Both directions go through the same helper, so this
holds for an income exactly as it does for an expense.

### How a sync works

A pass is always **push, then pull**:

1. The outbox replays in `seq` order. Order matters: an expense cannot be
   inserted before the category it points at, nor an income before its
   source, because the composite foreign key would refuse it. One global
   queue per account is what guarantees that for both pairs at once.
2. Every row for the account is fetched back and the local copy is replaced
   with it. Anything still in the outbox is layered on top, so an unsynced
   row does not flicker out mid-pass.

Pushing first is what lets the pull be treated as the truth, rather than
something that has to be merged field by field.

Passes run on load, on `online`, when the tab becomes visible, after every
local write, and on a 60-second timer as a backstop for a connection that
came back without announcing itself. Concurrent requests coalesce: a burst of
writes settles with one follow-up pass rather than one pass each.

There is deliberately no Background Sync registration — replaying a write
needs the Supabase session and its refresh logic, which live on the page, and
duplicating those in the worker would be a second, subtly different copy of
the auth code for a trigger only Chromium implements.

Pulls page through the results. PostgREST caps a response at 1000 rows and
says nothing about having done so, which would silently truncate a long
history.

### When the server says no

The two failure modes need opposite handling, and
[sync.ts](src/lib/sync.ts) tells them apart by status code:

- **Retryable** — no response at all, `401`/`403` (the token is likely
  mid-refresh), `408`, `429`, or any `5xx`. The change stays queued, and the
  pass stops there rather than skipping past it, because a later change may
  depend on it.
- **Refused** — anything else in the `4xx` range. It would be refused again
  forever, so it is dropped, and the pull that follows is what rolls the
  local row back. The dashboard then says what was undone.

One refusal is repaired instead of reported: two devices adding the same
category — or income source — name while both offline. Names are unique per
account, so the second to arrive loses, but the rows queued behind it are
perfectly good, so they are repointed at the parent that won. The repair is
written once and parameterised over the two pairs rather than copied.

### What the header shows

A pill next to the account email appears only when there is something to
say — `Offline`, `Syncing…`, `Sync failed`, or a count of changes that have
not reached the server; the count combines with the first two, as
`Offline · 3 unsynced`. Nothing showing means everything is saved on both
sides.

### Signing out

Signing out erases this browser's copy of the account. That is the point
rather than a side effect: the local database is the account's full history,
and leaving it behind on a shared computer would outlive the session that
was supposed to protect it. Anything still queued goes with it, so the
button asks first when the outbox is not empty.

### Staying signed in without a network

Supabase refreshes its access token over the network, so a cold launch in
aeroplane mode can come back with no session at all — which, taken at face
value, would show the login form and hide data sitting in IndexedDB right
there. The account id and email are therefore remembered separately under
`budget.account` and treated as enough to keep rendering.

That identity grants nothing on its own; every queued write still has to
pass RLS with a real token before it reaches Postgres. Two cases are told
apart on purpose:

- The token **could not be checked** — the refresh call failed. `navigator.onLine`
  is not enough to detect this, because a captive portal or a dead uplink
  still reports being online. The remembered account stands.
- The session is **genuinely gone**, and Supabase said so without erroring.
  The login form comes back — and the outbox survives it, because only an
  explicit sign-out clears local data.

### Installing

Chromium fires `beforeinstallprompt` when the app qualifies, and
[pwa.ts](src/lib/pwa.ts) holds on to that event so
[InstallButton](src/components/InstallButton.tsx) can hand it back when the
header button is clicked. The event is `preventDefault`ed, or the browser
would show its own bar instead of letting the header do it; it is also
single-use, so the button disappears once it has been spent, accepted or not.

Safari and Firefox never fire it and install from their own menus, so the
button simply never appears there. iOS additionally ignores the manifest for
the app title, the status bar, and the home-screen icon, which is why
[index.html](index.html) carries the `apple-mobile-web-app-*` tags and an
`apple-touch-icon` next to it.

### Updates

A new build is never applied silently. This is a form people type into, and
reloading underneath them would discard what they were writing, so
[UpdatePrompt](src/components/UpdatePrompt.tsx) offers the reload instead
(`registerType: 'prompt'`). Declining costs nothing; the next launch picks
it up anyway.

### Icons

The manifest needs PNGs and the mark is only four shapes, so
[scripts/generate-icons.mjs](scripts/generate-icons.mjs) draws them and
encodes the PNGs directly rather than adding a rasteriser and a native build
step to CI. The output is committed. Re-run `npm run icons` after editing
[public/favicon.svg](public/favicon.svg) — the geometry is duplicated in
both files, **so change them together**.

The maskable icon insets the mark to 60%, because Android crops adaptive
icons to a shape of its choosing and only guarantees the middle 80%.

## Theme and currency

Both are display-only settings held in React context by
[src/App.tsx](src/App.tsx) and remembered in `localStorage`. They are per
browser, not per account — nothing about them is stored in Supabase, and
every read and write is wrapped in `try`/`catch` so a browser with storage
blocked still renders.

### Dark mode

The palette is two sets of CSS custom properties in
[src/index.css](src/index.css), swapped by a `data-theme` attribute on
`<html>`. Tailwind's `dark:` variant is repointed at the same attribute
(`@custom-variant dark`) so utilities and tokens can never disagree.

The choice is `system`, `light`, or `dark`, defaulting to `system`, which
follows the OS and keeps following it — `watchSystemTheme()` listens for
`prefers-color-scheme` changes, so a flip mid-session repaints without a
reload. The toggle in the header reads the *resolved* theme and offers the
opposite, so the first click always moves away from what is on screen.

An inline script in [index.html](index.html) stamps `data-theme` before the
first paint; without it, every load would flash one frame of the light
palette. It also sets the `theme-color` meta tag, which is what tints the
title bar of the installed app — CSS cannot reach that, so `applyTheme()`
keeps it in step on every later change. The script duplicates a little of
`theme.ts` on purpose — the storage key `budget.theme`, the attribute, and
the two bar colours are shared, **so change both together**.

### Currency

Amounts are stored as plain numbers with no currency attached, so switching
currency **relabels the existing figures rather than converting them** —
there are no exchange rates involved. `formatMoney()` comes from context, and
`Intl.NumberFormat` instances are cached per currency.

To add one, append an entry to `CURRENCIES` in
[src/lib/currency.ts](src/lib/currency.ts) with its code, the label shown in
the header picker, and a locale for the number format; the `CurrencyCode`
type and the picker's options both derive from that array. `DEFAULT_CURRENCY`
in the same file is what a browser with nothing remembered gets.

## Setup

Requires Node 22+.

```bash
npm install
```

### Supabase project

1. Create a Supabase project.
2. Open **SQL Editor > New query**, paste [supabase/schema.sql](supabase/schema.sql),
   and run it. It is safe to re-run.
3. Under **Authentication > Providers**, keep Email enabled. Sign-up with
   email confirmation on means new accounts see a "check your inbox"
   notice before their first session.

### Environment

Create `.env.local` in the repo root:

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable key>
```

Both are read from **Project Settings > API**. Use the *publishable*
(anon) key only — it is inlined into the public bundle at build time. The
secret/service-role key must never appear here.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server with HMR |
| `npm run build` | Type-check (`tsc -b`) then build to `dist/` |
| `npm run preview` | Serve the built `dist/` locally — the only way to exercise the service worker |
| `npm run icons` | Redraw the install icons from the favicon geometry |
| `npm run lint` | ESLint over the repo |

## Deploying

Pushing to `main` triggers [.github/workflows/deploy.yml](.github/workflows/deploy.yml),
which builds and publishes `dist/` to GitHub Pages.

Because Vite inlines env vars at build time, the two `VITE_*` values must
also exist in the repo under **Settings > Secrets and variables > Actions**
(repository scope, not an environment). Either the Variables or the Secrets
tab works. The workflow checks both are non-empty and fails with a clear
error before building if not.

The service worker is built alongside the bundle and needs no extra step,
but two things about it are worth knowing. Its scope is the site root, which
works because the app is served from the domain root. And a returning visitor
gets the new build one launch late by design: the worker downloads it in the
background, and the update prompt hands it over when they say so.

`npm run dev` does not register a worker, so anything about offline
behaviour has to be checked against `npm run build && npm run preview`.

The custom domain comes from [public/CNAME](public/CNAME), which is why
Vite's `base` stays `'/'` — see [vite.config.ts](vite.config.ts). Changing
to a project subpath (`user.github.io/repo/`) would require setting `base`
to match.

## Changing the date locale

Dates are the one format not chosen at runtime:
[src/lib/format.ts](src/lib/format.ts) has a single `LOCALE` constant at the
top, and editing it changes every formatted date in the app. Money is
independent of it — see [Currency](#currency) above.
