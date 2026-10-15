import { type MutationCtx, type QueryCtx } from "../_generated/server"
import { internal } from "../_generated/api"

export const HISTORY_SUMMARIES_KEY = "history-summaries-v1"

export async function historySummariesAreReady(ctx: QueryCtx | MutationCtx) {
  const state = await ctx.db
    .query("systemSettings")
    .withIndex("by_key", (index) => index.eq("key", HISTORY_SUMMARIES_KEY))
    .unique()
  return state?.value === "ready"
}

export async function resumeHistorySummariesAfterImport(ctx: MutationCtx) {
  const state = await ctx.db
    .query("systemSettings")
    .withIndex("by_key", (index) => index.eq("key", HISTORY_SUMMARIES_KEY))
    .unique()
  // Before the first deployment migration, the import keeps the legacy read path.
  if (!state) return
  if (state.value === "ready")
    await ctx.db.patch(state._id, { value: "null", updatedAt: Date.now() })
  await ctx.scheduler.runAfter(
    0,
    internal.migrations.prepareHistorySummaries,
    {}
  )
}
