import { type Doc, type Id } from "../_generated/dataModel"
import { type MutationCtx, type QueryCtx } from "../_generated/server"
import {
  applyAccountWeekSummaryChange,
  isFinancialTransaction,
  type AccountSummaryTransaction,
} from "./accountSummary"
import { applyTransactionScopeChange } from "./transactionScopes"
import { historySummariesAreReady } from "./historySummaries"

type FinancialTransaction = Pick<Doc<"transactions">, "kind" | "total">

export function journalContribution(
  transaction: FinancialTransaction | undefined
): number {
  return transaction && isFinancialTransaction(transaction)
    ? transaction.total
    : 0
}

async function getStoredSummary(ctx: QueryCtx | MutationCtx) {
  return ctx.db
    .query("journalSummaries")
    .withIndex("by_key", (index) => index.eq("key", "main"))
    .unique()
}

export async function readJournalBalance(ctx: QueryCtx): Promise<number> {
  const summary = await getStoredSummary(ctx)
  if (summary) return summary.balance

  if (await historySummariesAreReady(ctx)) {
    const scopes = await ctx.db.query("transactionVisibilityScopes").collect()
    return scopes.reduce((balance, scope) => balance + scope.balance, 0)
  }

  const transactions = await ctx.db.query("transactions").collect()
  return transactions.reduce(
    (balance, transaction) => balance + journalContribution(transaction),
    0
  )
}

export async function applyJournalBalanceChange(
  ctx: MutationCtx,
  transactionId: Id<"transactions">,
  before: AccountSummaryTransaction | undefined,
  after: AccountSummaryTransaction | undefined
): Promise<void> {
  await applyTransactionScopeChange(ctx, transactionId, before, after)
  await applyAccountWeekSummaryChange(ctx, before, after)
  const summary = await getStoredSummary(ctx)
  if (!summary) return
  const delta = journalContribution(after) - journalContribution(before)
  if (delta === 0) return
  await ctx.db.patch(summary._id, {
    balance: summary.balance + delta,
    updatedAt: Date.now(),
  })
}

export async function rebuildJournalSummary(ctx: MutationCtx) {
  const transactions = await ctx.db.query("transactions").collect()
  const balance = transactions.reduce(
    (total, transaction) => total + journalContribution(transaction),
    0
  )
  const existing = await getStoredSummary(ctx)
  const details = { balance, key: "main" as const, updatedAt: Date.now() }
  if (existing) {
    await ctx.db.replace(existing._id, details)
    return existing._id
  }
  return ctx.db.insert("journalSummaries", details)
}
