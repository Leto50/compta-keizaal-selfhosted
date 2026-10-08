import { type Doc, type Id } from "../_generated/dataModel"
import { type MutationCtx, type QueryCtx } from "../_generated/server"
import {
  canSeeCatalogEntry,
  type ReaderAccess,
} from "../../shared/reader-access"
import {
  applyAccountSummaryTransaction,
  emptyAccountWeek,
  isFinancialTransaction,
  type AccountSummaryTransaction,
} from "./accountSummary"
import { startOfUtcWeek } from "./time"

type Scope = Pick<
  Doc<"transactionVisibilityScopes">,
  "kind" | "productIds" | "bundleIds" | "hasUnlinkedProducts"
>

export async function loadTransactionScope(
  ctx: QueryCtx | MutationCtx,
  transaction: Doc<"transactions">
): Promise<Scope> {
  const [lines, movements, orderLines] = await Promise.all([
    ctx.db
      .query("transactionLines")
      .withIndex("by_transaction", (index) =>
        index.eq("transactionId", transaction._id)
      )
      .collect(),
    ctx.db
      .query("stockMovements")
      .withIndex("by_transaction", (index) =>
        index.eq("transactionId", transaction._id)
      )
      .collect(),
    transaction.orderId
      ? ctx.db
          .query("orderLines")
          .withIndex("by_order", (index) =>
            index.eq("orderId", transaction.orderId!)
          )
          .collect()
      : [],
  ])
  const productIds = [
    transaction.productId,
    ...lines.map((line) => line.productId),
    ...movements.map((movement) => movement.productId),
    ...orderLines.map((line) => line.productId),
  ].filter((id): id is Id<"products"> => id !== undefined)
  return {
    kind: transaction.kind,
    productIds: [...new Set(productIds)].sort(),
    bundleIds: [
      ...new Set(
        lines
          .map((line) => line.bundleId)
          .filter((id): id is Id<"bundles"> => id !== undefined)
      ),
    ].sort(),
    hasUnlinkedProducts:
      lines.some((line) => !line.productId && !line.bundleId) ||
      orderLines.some((line) => !line.productId),
  }
}

export async function scopeIsVisible(
  ctx: QueryCtx,
  access: ReaderAccess,
  scope: Scope
): Promise<boolean> {
  if (
    !isFinancialTransaction(scope) ||
    !access.operationKinds.some((kind) => kind === scope.kind)
  )
    return false
  if (access.productIds === undefined) return true
  if (scope.hasUnlinkedProducts) return false
  const productIds: (string | undefined)[] = [...scope.productIds]
  // Bundle contents remain live, as in transactionIsVisible: editing a lot must
  // never expose its past sales to a reader forbidden to see a new ingredient.
  for (const bundleId of scope.bundleIds) {
    const items = await ctx.db
      .query("bundleItems")
      .withIndex("by_bundle", (index) => index.eq("bundleId", bundleId))
      .collect()
    if (items.some((item) => !item.productId)) return false
    productIds.push(...items.map((item) => item.productId))
  }
  return canSeeCatalogEntry(access, productIds)
}

async function changeScopeWeek(
  ctx: MutationCtx,
  scopeId: Id<"transactionVisibilityScopes">,
  transaction: AccountSummaryTransaction,
  multiplier: 1 | -1
) {
  const startsAt = startOfUtcWeek(transaction.occurredAt)
  const existing = await ctx.db
    .query("scopedAccountWeekSummaries")
    .withIndex("by_scope_and_week", (index) =>
      index.eq("scopeId", scopeId).eq("startsAt", startsAt)
    )
    .unique()
  const summary = existing
    ? { ...existing, actors: existing.actors.map((actor) => ({ ...actor })) }
    : emptyAccountWeek(startsAt)
  applyAccountSummaryTransaction(summary, transaction, multiplier)
  if (summary.transactionCount <= 0) {
    if (existing) await ctx.db.delete(existing._id)
    return
  }
  const details = {
    actors: summary.actors,
    balance: summary.balance,
    incoming: summary.incoming,
    outgoing: summary.outgoing,
    startsAt,
    transactionCount: summary.transactionCount,
    scopeId,
    updatedAt: Date.now(),
  }
  if (existing) await ctx.db.replace(existing._id, details)
  else await ctx.db.insert("scopedAccountWeekSummaries", details)
}

export async function applyTransactionScopeChange(
  ctx: MutationCtx,
  transactionId: Id<"transactions">,
  before: AccountSummaryTransaction | undefined,
  after: AccountSummaryTransaction | undefined
) {
  const previousScope = before?.visibilityScopeId
    ? await ctx.db.get(before.visibilityScopeId)
    : null
  if (previousScope && before) {
    await changeScopeWeek(ctx, previousScope._id, before, -1)
    await ctx.db.patch(previousScope._id, {
      balance: previousScope.balance - before.total,
      transactionCount: previousScope.transactionCount - 1,
    })
  }
  if (after && isFinancialTransaction(after)) {
    const transaction = await ctx.db.get(transactionId)
    if (!transaction)
      throw new Error("Transaction absente lors de son indexation.")
    const scope = await loadTransactionScope(ctx, transaction)
    const key = JSON.stringify([
      scope.kind,
      scope.productIds,
      scope.bundleIds,
      scope.hasUnlinkedProducts,
    ])
    const existing = await ctx.db
      .query("transactionVisibilityScopes")
      .withIndex("by_key", (index) => index.eq("key", key))
      .unique()
    const scopeId = existing
      ? existing._id
      : await ctx.db.insert("transactionVisibilityScopes", {
          ...scope,
          key,
          balance: 0,
          transactionCount: 0,
        })
    await ctx.db.patch(scopeId, {
      balance: (existing?.balance ?? 0) + after.total,
      transactionCount: (existing?.transactionCount ?? 0) + 1,
    })
    await changeScopeWeek(ctx, scopeId, after, 1)
    await ctx.db.patch(transactionId, { visibilityScopeId: scopeId })
  } else if (after)
    await ctx.db.patch(transactionId, { visibilityScopeId: undefined })
  if (previousScope) {
    const remaining = await ctx.db.get(previousScope._id)
    if (remaining?.transactionCount === 0) await ctx.db.delete(remaining._id)
  }
}

export async function indexTransactionScope(
  ctx: MutationCtx,
  transactionId: Id<"transactions">
) {
  const transaction = await ctx.db.get(transactionId)
  if (
    !transaction ||
    transaction.visibilityScopeId ||
    !isFinancialTransaction(transaction)
  )
    return
  await applyTransactionScopeChange(ctx, transactionId, undefined, transaction)
}

export async function visibleTransactionScopes(
  ctx: QueryCtx,
  access: ReaderAccess
) {
  const scopes = (
    await Promise.all(
      [...new Set(access.operationKinds)].map((kind) =>
        ctx.db
          .query("transactionVisibilityScopes")
          .withIndex("by_kind", (index) => index.eq("kind", kind))
          .collect()
      )
    )
  ).flat()
  const visible = await Promise.all(
    scopes.map((scope) => scopeIsVisible(ctx, access, scope))
  )
  return scopes.filter((_, index) => visible[index])
}

export async function readScopedAccountWeeks(
  ctx: QueryCtx,
  scopes: Doc<"transactionVisibilityScopes">[],
  firstWeek: number,
  lastWeek: number
) {
  const summaries = (
    await Promise.all(
      scopes.map((scope) =>
        ctx.db
          .query("scopedAccountWeekSummaries")
          .withIndex("by_scope_and_week", (index) =>
            index
              .eq("scopeId", scope._id)
              .gte("startsAt", firstWeek)
              .lte("startsAt", lastWeek)
          )
          .collect()
      )
    )
  ).flat()
  const weeks = new Map<number, ReturnType<typeof emptyAccountWeek>>()
  for (const summary of summaries) {
    const week =
      weeks.get(summary.startsAt) ?? emptyAccountWeek(summary.startsAt)
    week.balance += summary.balance
    week.incoming += summary.incoming
    week.outgoing += summary.outgoing
    week.transactionCount += summary.transactionCount
    for (const actor of summary.actors) {
      const existing = week.actors.find((entry) =>
        actor.actorCharacterId
          ? entry.actorCharacterId === actor.actorCharacterId
          : !entry.actorCharacterId && entry.actorName === actor.actorName
      )
      if (existing) {
        existing.incoming += actor.incoming
        existing.outgoing += actor.outgoing
        existing.salaryRevenue += actor.salaryRevenue
        existing.transactionCount += actor.transactionCount
      } else week.actors.push({ ...actor })
    }
    weeks.set(week.startsAt, week)
  }
  return [...weeks.values()]
}

export async function readScopedRecentTransactions(
  ctx: QueryCtx,
  scopes: Doc<"transactionVisibilityScopes">[]
) {
  const recent = (
    await Promise.all(
      scopes.map((scope) =>
        ctx.db
          .query("transactions")
          .withIndex("by_visibility_scope_and_date", (index) =>
            index.eq("visibilityScopeId", scope._id)
          )
          .order("desc")
          .take(8)
      )
    )
  ).flat()
  return recent
    .sort(
      (a, b) => b.occurredAt - a.occurredAt || b._creationTime - a._creationTime
    )
    .slice(0, 8)
}
