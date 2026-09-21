import { type Doc } from "../_generated/dataModel"
import { type MutationCtx, type QueryCtx } from "../_generated/server"
import { readModelsAreReady } from "./readModels"
import { startOfUtcWeek } from "./time"

export type AccountSummaryTransaction = Pick<
  Doc<"transactions">,
  | "actorCharacterId"
  | "actorName"
  | "incomingTotal"
  | "kind"
  | "occurredAt"
  | "orderId"
  | "outgoingTotal"
  | "total"
>

type WeekActor = Doc<"accountWeekSummaries">["actors"][number]
type WeekSummary = Omit<
  Doc<"accountWeekSummaries">,
  "_creationTime" | "_id" | "updatedAt"
>

const SALARY_TRANSACTION_KINDS = new Set<Doc<"transactions">["kind"]>([
  "bundle",
  "sale",
  "service",
])

export function isFinancialTransaction(
  transaction: Pick<Doc<"transactions">, "kind">
) {
  return transaction.kind !== "adjustment" && transaction.kind !== "production"
}

export function transactionFlows(
  transaction: Pick<
    Doc<"transactions">,
    "incomingTotal" | "outgoingTotal" | "total"
  >
) {
  const incoming = transaction.outgoingTotal ?? Math.max(transaction.total, 0)
  const outgoing =
    transaction.incomingTotal ?? Math.abs(Math.min(transaction.total, 0))
  return { incoming, net: incoming - outgoing, outgoing }
}

export function salaryRevenue(transaction: AccountSummaryTransaction): number {
  if (transaction.orderId || !SALARY_TRANSACTION_KINDS.has(transaction.kind)) {
    return 0
  }
  return Math.max(transactionFlows(transaction).incoming, 0)
}

function actorKey(actor: Pick<WeekActor, "actorCharacterId" | "actorName">) {
  return actor.actorCharacterId
    ? `character:${actor.actorCharacterId}`
    : `name:${actor.actorName}`
}

function emptyWeek(startsAt: number): WeekSummary {
  return {
    actors: [],
    balance: 0,
    incoming: 0,
    outgoing: 0,
    startsAt,
    transactionCount: 0,
  }
}

function normalizedNumber(value: number) {
  return Math.abs(value) < 1e-9 ? 0 : value
}

function applyTransaction(
  summary: WeekSummary,
  transaction: AccountSummaryTransaction,
  multiplier: 1 | -1
) {
  if (!isFinancialTransaction(transaction)) return
  const flows = transactionFlows(transaction)
  summary.balance = normalizedNumber(
    summary.balance + multiplier * transaction.total
  )
  summary.incoming = normalizedNumber(
    summary.incoming + multiplier * flows.incoming
  )
  summary.outgoing = normalizedNumber(
    summary.outgoing + multiplier * flows.outgoing
  )
  summary.transactionCount += multiplier
  if (flows.incoming === 0 && flows.outgoing === 0) return

  const key = actorKey(transaction)
  const index = summary.actors.findIndex((actor) => actorKey(actor) === key)
  const existing = index === -1 ? undefined : summary.actors[index]
  const actor: WeekActor = {
    ...(transaction.actorCharacterId
      ? { actorCharacterId: transaction.actorCharacterId }
      : {}),
    actorName:
      multiplier === 1
        ? transaction.actorName
        : (existing?.actorName ?? transaction.actorName),
    incoming: normalizedNumber(
      (existing?.incoming ?? 0) + multiplier * flows.incoming
    ),
    outgoing: normalizedNumber(
      (existing?.outgoing ?? 0) + multiplier * flows.outgoing
    ),
    salaryRevenue: normalizedNumber(
      (existing?.salaryRevenue ?? 0) + multiplier * salaryRevenue(transaction)
    ),
    transactionCount: (existing?.transactionCount ?? 0) + multiplier,
  }
  if (actor.transactionCount <= 0) {
    if (index !== -1) summary.actors.splice(index, 1)
  } else if (index === -1) {
    summary.actors.push(actor)
  } else {
    summary.actors[index] = actor
  }
}

export function buildAccountWeekSummaries(
  transactions: readonly AccountSummaryTransaction[]
) {
  const summaries = new Map<number, WeekSummary>()
  for (const transaction of transactions) {
    if (!isFinancialTransaction(transaction)) continue
    const startsAt = startOfUtcWeek(transaction.occurredAt)
    const summary = summaries.get(startsAt) ?? emptyWeek(startsAt)
    applyTransaction(summary, transaction, 1)
    summaries.set(startsAt, summary)
  }
  return [...summaries.values()].sort(
    (left, right) => left.startsAt - right.startsAt
  )
}

export async function applyAccountWeekSummaryChange(
  ctx: MutationCtx,
  before: AccountSummaryTransaction | undefined,
  after: AccountSummaryTransaction | undefined
) {
  if (!(await readModelsAreReady(ctx))) return
  const startsAtValues = new Set<number>()
  if (before && isFinancialTransaction(before)) {
    startsAtValues.add(startOfUtcWeek(before.occurredAt))
  }
  if (after && isFinancialTransaction(after)) {
    startsAtValues.add(startOfUtcWeek(after.occurredAt))
  }

  for (const startsAt of startsAtValues) {
    const existing = await ctx.db
      .query("accountWeekSummaries")
      .withIndex("by_starts_at", (index) => index.eq("startsAt", startsAt))
      .unique()
    const summary: WeekSummary = existing
      ? {
          actors: existing.actors.map((actor) => ({ ...actor })),
          balance: existing.balance,
          incoming: existing.incoming,
          outgoing: existing.outgoing,
          startsAt,
          transactionCount: existing.transactionCount,
        }
      : emptyWeek(startsAt)
    if (
      before &&
      isFinancialTransaction(before) &&
      startOfUtcWeek(before.occurredAt) === startsAt
    ) {
      applyTransaction(summary, before, -1)
    }
    if (
      after &&
      isFinancialTransaction(after) &&
      startOfUtcWeek(after.occurredAt) === startsAt
    ) {
      applyTransaction(summary, after, 1)
    }

    if (summary.transactionCount <= 0) {
      if (existing) await ctx.db.delete(existing._id)
      continue
    }
    const details = { ...summary, updatedAt: Date.now() }
    if (existing) {
      await ctx.db.replace(existing._id, details)
    } else {
      await ctx.db.insert("accountWeekSummaries", details)
    }
  }
}

export async function rebuildAccountWeekSummaries(ctx: MutationCtx) {
  const [existing, transactions] = await Promise.all([
    ctx.db.query("accountWeekSummaries").collect(),
    ctx.db.query("transactions").collect(),
  ])
  const summaries = buildAccountWeekSummaries(transactions)
  const byStartsAt = new Map(existing.map((entry) => [entry.startsAt, entry]))
  const updatedAt = Date.now()

  for (const summary of summaries) {
    const stored = byStartsAt.get(summary.startsAt)
    if (stored) {
      await ctx.db.replace(stored._id, { ...summary, updatedAt })
      byStartsAt.delete(summary.startsAt)
    } else {
      await ctx.db.insert("accountWeekSummaries", { ...summary, updatedAt })
    }
  }
  await Promise.all(
    [...byStartsAt.values()].map((summary) => ctx.db.delete(summary._id))
  )
  return summaries.length
}

export async function readAccountWeekSummaries(
  ctx: QueryCtx,
  firstWeekStartsAt: number,
  lastWeekStartsAt: number
) {
  return ctx.db
    .query("accountWeekSummaries")
    .withIndex("by_starts_at", (index) =>
      index.gte("startsAt", firstWeekStartsAt).lte("startsAt", lastWeekStartsAt)
    )
    .collect()
}
