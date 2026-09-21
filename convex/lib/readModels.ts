import { type MutationCtx, type QueryCtx } from "../_generated/server"

export const READ_MODELS_KEY = "read-models-v1"

export async function readModelsAreReady(ctx: QueryCtx | MutationCtx) {
  const marker = await ctx.db
    .query("systemSettings")
    .withIndex("by_key", (index) => index.eq("key", READ_MODELS_KEY))
    .unique()
  return marker?.value === "ready"
}

export async function markReadModelsReady(ctx: MutationCtx) {
  const existing = await ctx.db
    .query("systemSettings")
    .withIndex("by_key", (index) => index.eq("key", READ_MODELS_KEY))
    .unique()
  const details = {
    key: READ_MODELS_KEY,
    updatedAt: Date.now(),
    value: "ready",
  }
  if (existing) {
    await ctx.db.replace(existing._id, details)
    return existing._id
  }
  return ctx.db.insert("systemSettings", details)
}
