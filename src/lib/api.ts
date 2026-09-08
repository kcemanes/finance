/**
 * What the components call. Every function here answers from the local
 * database in ./store and never awaits the network.
 *
 * Writes return as soon as IndexedDB has them and kick off a sync in the
 * background; whether that sync succeeds changes nothing about what the user
 * sees. This is the whole of the offline-first bargain, and the reason none
 * of these are allowed to reject on a connection failure.
 *
 * The Supabase calls that used to live here are now in ./sync, which is the
 * only module that talks to the server.
 */
import * as store from './store'
import { requestSync } from './sync'
import type {
  Account,
  AccountKind,
  Balance,
  Category,
  Expense,
  Income,
  IncomeSource,
} from '../types'

export function listCategories(userId: string): Promise<Category[]> {
  return store.loadCategories(userId)
}

export function listIncomeSources(userId: string): Promise<IncomeSource[]> {
  return store.loadIncomeSources(userId)
}

export function listExpenses(
  userId: string,
  from: string,
  to: string,
): Promise<Expense[]> {
  return store.loadExpenses(userId, from, to)
}

export function listIncomes(
  userId: string,
  from: string,
  to: string,
): Promise<Income[]> {
  return store.loadIncomes(userId, from, to)
}

export async function createCategory(
  userId: string,
  name: string,
  monthlyBudget: number | null,
): Promise<Category> {
  const category = await store.addCategory(userId, name, monthlyBudget)
  void requestSync(userId)
  return category
}

export async function createIncomeSource(
  userId: string,
  name: string,
  expectedMonthly: number | null,
): Promise<IncomeSource> {
  const source = await store.addIncomeSource(userId, name, expectedMonthly)
  void requestSync(userId)
  return source
}

export async function createExpense(
  userId: string,
  input: {
    category_id: string
    spent_on: string
    amount: number
    note: string | null
  },
): Promise<void> {
  await store.addExpense(userId, input)
  void requestSync(userId)
}

export async function createIncome(
  userId: string,
  input: {
    source_id: string
    received_on: string
    amount: number
    note: string | null
  },
): Promise<void> {
  await store.addIncome(userId, input)
  void requestSync(userId)
}

export async function deleteExpense(userId: string, id: string): Promise<void> {
  await store.removeExpense(userId, id)
  void requestSync(userId)
}

export async function deleteIncome(userId: string, id: string): Promise<void> {
  await store.removeIncome(userId, id)
  void requestSync(userId)
}

export function listAccounts(userId: string): Promise<Account[]> {
  return store.loadAccounts(userId)
}

export function listBalances(userId: string): Promise<Balance[]> {
  return store.loadBalances(userId)
}

/**
 * Creates an account or replaces an existing one. Passing an `id` is what
 * makes it the latter — see the note on `store.setAccount`.
 */
export async function saveAccount(
  userId: string,
  input: { id?: string; name: string; kind: AccountKind; is_active: boolean },
): Promise<Account> {
  const account = await store.setAccount(userId, input)
  void requestSync(userId)
  return account
}

/**
 * Records what an account was worth at a month end, replacing whatever it said
 * about that month before.
 */
export async function saveBalance(
  userId: string,
  input: {
    account_id: string
    as_of: string
    amount: number
    note: string | null
  },
): Promise<void> {
  await store.setBalance(userId, input)
  void requestSync(userId)
}

export async function deleteBalance(userId: string, id: string): Promise<void> {
  await store.removeBalance(userId, id)
  void requestSync(userId)
}
