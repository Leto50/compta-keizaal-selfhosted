import { type Doc, type Id } from "../_generated/dataModel"
import { type MutationCtx } from "../_generated/server"
import { calculateHarvestValue } from "../../shared/harvest-value"
import { startOfUtcWeek, WEEK_IN_MILLISECONDS } from "./time"

type Harvest = Doc<"transactions">
type Change = {
  transaction: Harvest
  lines: Doc<"transactionLines">[]
  multiplier: 1 | -1
}

export function harvestCharacterKey(
  harvest: Pick<Harvest, "actorCharacterId" | "actorName">
) {
  return JSON.stringify([
    harvest.actorCharacterId,
    harvest.actorCharacterId === undefined ? harvest.actorName : undefined,
  ])
}

export async function applyHarvestSummaryChange(
  ctx: MutationCtx,
  before:
    { transaction: Harvest; lines: Doc<"transactionLines">[] } | undefined,
  after: { transaction: Harvest; lines: Doc<"transactionLines">[] } | undefined
) {
  const changes: Change[] = []
  // Unindexed legacy records have never contributed to these totals.
  if (before?.transaction.harvestSummaryIndexed)
    changes.push({ ...before, multiplier: -1 })
  if (after) changes.push({ ...after, multiplier: 1 })
  const weeks = new Set(
    changes.map((change) => startOfUtcWeek(change.transaction.occurredAt))
  )
  for (const startsAt of weeks) {
    const existing = await ctx.db
      .query("harvestWeekSummaries")
      .withIndex("by_starts_at", (index) => index.eq("startsAt", startsAt))
      .unique()
    const harvestCount =
      (existing?.harvestCount ?? 0) +
      changes.reduce(
        (sum, change) =>
          sum +
          (startOfUtcWeek(change.transaction.occurredAt) === startsAt
            ? change.multiplier
            : 0),
        0
      )
    if (harvestCount <= 0) {
      if (existing) await ctx.db.delete(existing._id)
    } else if (existing) await ctx.db.patch(existing._id, { harvestCount })
    else await ctx.db.insert("harvestWeekSummaries", { startsAt, harvestCount })
  }
  const keys = new Set(
    changes.map((change) => harvestCharacterKey(change.transaction))
  )
  for (const characterKey of keys) {
    const characterChanges = changes.filter(
      (change) => harvestCharacterKey(change.transaction) === characterKey
    )
    const character = characterChanges[0]!.transaction
    const periods = new Set<number | undefined>([
      undefined,
      ...characterChanges.map((change) =>
        startOfUtcWeek(change.transaction.occurredAt)
      ),
    ])
    for (const weekStartsAt of periods) {
      const existing = await ctx.db
        .query("harvestSummaries")
        .withIndex("by_week_and_character", (index) =>
          index
            .eq("weekStartsAt", weekStartsAt)
            .eq("characterKey", characterKey)
        )
        .unique()
      const totals = {
        harvestCount: existing?.harvestCount ?? 0,
        quantity: existing?.quantity ?? 0,
        lineCount: existing?.lineCount ?? 0,
        knownValue: existing?.knownValue ?? 0,
        unpricedLineCount: existing?.unpricedLineCount ?? 0,
      }
      for (const change of characterChanges) {
        if (
          weekStartsAt !== undefined &&
          startOfUtcWeek(change.transaction.occurredAt) !== weekStartsAt
        )
          continue
        const value = calculateHarvestValue(change.lines)
        totals.harvestCount += change.multiplier
        totals.quantity +=
          change.multiplier *
          change.lines.reduce((sum, line) => sum + line.quantity, 0)
        totals.lineCount += change.multiplier * change.lines.length
        totals.knownValue += change.multiplier * value.knownValue
        totals.unpricedLineCount += change.multiplier * value.unpricedLineCount
      }
      if (totals.harvestCount <= 0) {
        if (existing) await ctx.db.delete(existing._id)
        continue
      }
      if (totals.lineCount === totals.unpricedLineCount) totals.knownValue = 0
      // Resolve the latest snapshot through an index, including after deleting or redating it.
      const latest = character.actorCharacterId
        ? await ctx.db
            .query("transactions")
            .withIndex("by_kind_and_character_and_date", (index) => {
              const range = index
                .eq("kind", "harvest")
                .eq("actorCharacterId", character.actorCharacterId)
              return weekStartsAt === undefined
                ? range
                : range
                    .gte("occurredAt", weekStartsAt)
                    .lt("occurredAt", weekStartsAt + WEEK_IN_MILLISECONDS)
            })
            .order("desc")
            .first()
        : null
      const details = {
        ...totals,
        characterKey,
        weekStartsAt,
        actorCharacterId: character.actorCharacterId,
        actorName: latest?.actorName ?? character.actorName,
      }
      if (existing) await ctx.db.replace(existing._id, details)
      else await ctx.db.insert("harvestSummaries", details)
    }
  }
  if (after)
    await ctx.db.patch(after.transaction._id, { harvestSummaryIndexed: true })
}

export async function indexHarvestSummary(
  ctx: MutationCtx,
  transactionId: Id<"transactions">
) {
  const transaction = await ctx.db.get(transactionId)
  if (transaction?.kind !== "harvest" || transaction.harvestSummaryIndexed)
    return
  const lines = await ctx.db
    .query("transactionLines")
    .withIndex("by_transaction", (index) =>
      index.eq("transactionId", transactionId)
    )
    .collect()
  await applyHarvestSummaryChange(ctx, undefined, { transaction, lines })
}
