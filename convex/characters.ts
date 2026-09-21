import { ConvexError, v } from "convex/values"

import { type Id } from "./_generated/dataModel"
import { mutation, query } from "./_generated/server"
import { requireAdmin, requireUser } from "./lib/auth"
import { normalizeName } from "./lib/text"

const MAX_NAME_LENGTH = 100

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx)
    const characters = await ctx.db.query("characters").collect()
    return characters
      .filter((character) => character.active)
      .sort((left, right) => left.name.localeCompare(right.name, "fr"))
  },
})

export const listForAdmin = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx)
    const characters = await ctx.db.query("characters").collect()
    return characters
      .filter((character) => character.active)
      .sort((left, right) => left.name.localeCompare(right.name, "fr"))
  },
})

export const listArchived = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx)
    const characters = await ctx.db.query("characters").collect()
    return characters
      .filter((character) => !character.active)
      .sort((left, right) => left.name.localeCompare(right.name, "fr"))
  },
})

export const save = mutation({
  args: {
    characterId: v.optional(v.id("characters")),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireAdmin(ctx)
    const name = args.name.trim()
    if (!name || name.length > MAX_NAME_LENGTH) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: `Le nom doit contenir entre 1 et ${MAX_NAME_LENGTH} caractères.`,
      })
    }

    const existing = args.characterId
      ? await ctx.db.get(args.characterId)
      : undefined
    if (args.characterId && !existing) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Personnage introuvable.",
      })
    }

    const normalizedName = normalizeName(name)
    const characters = await ctx.db.query("characters").collect()
    if (
      characters.some(
        (character) =>
          character._id !== args.characterId &&
          normalizeName(character.name) === normalizedName
      )
    ) {
      throw new ConvexError({
        code: "ALREADY_EXISTS",
        message: "Un personnage portant ce nom existe déjà.",
      })
    }

    const details = {
      active: existing?.active ?? true,
      ...(existing?.legacyKey ? { legacyKey: existing.legacyKey } : {}),
      name,
    }
    let characterId: Id<"characters">
    if (existing) {
      await ctx.db.replace(existing._id, details)
      characterId = existing._id
    } else {
      characterId = await ctx.db.insert("characters", details)
    }

    await ctx.db.insert("auditLogs", {
      action: existing ? "character.updated" : "character.created",
      actorUserId: String(user._id),
      createdAt: Date.now(),
      detail: name,
      entityId: characterId,
      entityType: "character",
    })
    return characterId
  },
})

export const setActive = mutation({
  args: {
    active: v.boolean(),
    characterId: v.id("characters"),
  },
  handler: async (ctx, args) => {
    const user = await requireAdmin(ctx)
    const character = await ctx.db.get(args.characterId)
    if (!character) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Personnage introuvable.",
      })
    }

    await ctx.db.patch(character._id, { active: args.active })
    await ctx.db.insert("auditLogs", {
      action: args.active ? "character.reactivated" : "character.archived",
      actorUserId: String(user._id),
      createdAt: Date.now(),
      detail: character.name,
      entityId: character._id,
      entityType: "character",
    })
  },
})
