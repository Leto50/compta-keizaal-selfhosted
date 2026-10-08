import { type Id } from "../_generated/dataModel"
import { type MutationCtx, type QueryCtx } from "../_generated/server"
import { type AccountSummaryTransaction } from "./accountSummary"
import { harvestCharacterKey } from "./harvestSummary"
import { startOfUtcWeek, WEEK_IN_MILLISECONDS } from "./time"

export const HARVEST_READER_SUMMARIES_KEY = "harvest-reader-summaries-v1"

export async function harvestReaderSummariesAreReady(ctx: QueryCtx) {
  const state = await ctx.db
    .query("systemSettings")
    .withIndex("by_key", (index) =>
      index.eq("key", HARVEST_READER_SUMMARIES_KEY)
    )
    .unique()
  return state?.value === "ready"
}

// Only ingredients visible together contribute to the same scope. This avoids
// scanning the entire history or leaking totals from partly forbidden harvests.
export async function applyScopedHarvestSummaryChange(
  ctx: MutationCtx,
  scopeId: Id<"transactionVisibilityScopes">,
  transaction: AccountSummaryTransaction,
  multiplier: 1 | -1
) {
  const contribution = transaction.harvestScopeContribution
  if (!contribution) throw new Error("Récolte indexée sans contribution.")
  const characterKey = harvestCharacterKey(transaction)
  for (const weekStartsAt of [
    undefined,
    startOfUtcWeek(transaction.occurredAt),
  ]) {
    const existing = await ctx.db
      .query("scopedHarvestSummaries")
      .withIndex("by_scope_and_week_and_character", (index) =>
        index
          .eq("scopeId", scopeId)
          .eq("weekStartsAt", weekStartsAt)
          .eq("characterKey", characterKey)
      )
      .unique()
    const totals = {
      harvestCount: (existing?.harvestCount ?? 0) + multiplier,
      quantity: (existing?.quantity ?? 0) + multiplier * contribution.quantity,
      lineCount:
        (existing?.lineCount ?? 0) + multiplier * contribution.lineCount,
      knownValue:
        (existing?.knownValue ?? 0) + multiplier * contribution.knownValue,
      unpricedLineCount:
        (existing?.unpricedLineCount ?? 0) +
        multiplier * contribution.unpricedLineCount,
    }
    if (totals.harvestCount <= 0) {
      if (existing) await ctx.db.delete(existing._id)
      continue
    }
    const latest = await ctx.db
      .query("transactions")
      .withIndex("by_visibility_scope_and_character_and_date", (index) => {
        const range = index
          .eq("visibilityScopeId", scopeId)
          .eq("harvestCharacterKey", characterKey)
        return weekStartsAt === undefined
          ? range
          : range
              .gte("occurredAt", weekStartsAt)
              .lt("occurredAt", weekStartsAt + WEEK_IN_MILLISECONDS)
      })
      .order("desc")
      .first()
    if (!latest)
      throw new Error("Récolte absente lors du calcul de son résumé.")
    if (totals.lineCount === totals.unpricedLineCount) totals.knownValue = 0
    const details = {
      ...totals,
      scopeId,
      characterKey,
      weekStartsAt,
      actorCharacterId: latest.actorCharacterId,
      actorName: latest.actorName,
      latestOccurredAt: latest.occurredAt,
      latestCreationTime: latest._creationTime,
    }
    if (existing) await ctx.db.replace(existing._id, details)
    else await ctx.db.insert("scopedHarvestSummaries", details)
  }
}
