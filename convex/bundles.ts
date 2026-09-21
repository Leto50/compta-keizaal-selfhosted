import { ConvexError, v } from "convex/values"

import { type Id } from "./_generated/dataModel"
import { mutation, query } from "./_generated/server"
import { requireUser } from "./lib/auth"
import { assertFiniteRange, assertWholeNumberRange } from "./lib/numbers"
import { normalizeCatalogName, normalizeName } from "./lib/text"

const MAX_ITEMS = 50
const MAX_NAME_LENGTH = 100
const MAX_PRICE = 1_000_000_000
const MAX_QUANTITY = 1_000_000

export const listArchived = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx)
    const bundles = await ctx.db.query("bundles").collect()
    return bundles
      .filter((bundle) => !bundle.active)
      .sort((left, right) => left.name.localeCompare(right.name, "fr"))
  },
})

export const save = mutation({
  args: {
    bundleId: v.optional(v.id("bundles")),
    items: v.array(
      v.object({
        productId: v.id("products"),
        quantity: v.number(),
      })
    ),
    name: v.string(),
    price: v.union(v.number(), v.null()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    const name = normalizeCatalogName(args.name)
    if (!name || name.length > MAX_NAME_LENGTH) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: `Le nom doit contenir entre 1 et ${MAX_NAME_LENGTH} caractères.`,
      })
    }
    if (args.items.length === 0 || args.items.length > MAX_ITEMS) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: `Un lot doit contenir entre 1 et ${MAX_ITEMS} références.`,
      })
    }
    if (args.price !== null) {
      assertFiniteRange(args.price, 0, MAX_PRICE, "Le prix")
    }

    const productIds = new Set<string>()
    const preparedItems = await Promise.all(
      args.items.map(async (item) => {
        assertWholeNumberRange(item.quantity, 1, MAX_QUANTITY, "La quantité")
        if (productIds.has(item.productId)) {
          throw new ConvexError({
            code: "INVALID_INPUT",
            message:
              "Une référence ne peut apparaître qu’une fois dans un lot.",
          })
        }
        productIds.add(item.productId)
        const product = await ctx.db.get(item.productId)
        if (!product?.active || !product.tracksStock) {
          throw new ConvexError({
            code: "NOT_FOUND",
            message: "Une référence du lot est introuvable ou indisponible.",
          })
        }
        return {
          productId: product._id,
          productName: product.name,
          quantity: item.quantity,
        }
      })
    )

    const existing = args.bundleId ? await ctx.db.get(args.bundleId) : undefined
    if (args.bundleId && !existing) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Lot introuvable.",
      })
    }
    const normalizedName = normalizeName(name)
    const bundles = await ctx.db.query("bundles").collect()
    if (
      bundles.some(
        (bundle) =>
          bundle._id !== args.bundleId &&
          normalizeName(bundle.name) === normalizedName
      )
    ) {
      throw new ConvexError({
        code: "ALREADY_EXISTS",
        message: "Un lot portant ce nom existe déjà.",
      })
    }

    const details = {
      active: existing?.active ?? true,
      ...(existing?.legacyKey ? { legacyKey: existing.legacyKey } : {}),
      name,
      ...(args.price === null ? {} : { price: args.price }),
    }
    let bundleId: Id<"bundles">
    if (existing) {
      await ctx.db.replace(existing._id, details)
      bundleId = existing._id
      const existingItems = await ctx.db
        .query("bundleItems")
        .withIndex("by_bundle", (index) => index.eq("bundleId", bundleId))
        .collect()
      await Promise.all(existingItems.map((item) => ctx.db.delete(item._id)))
    } else {
      bundleId = await ctx.db.insert("bundles", details)
    }

    await Promise.all(
      preparedItems.map((item) =>
        ctx.db.insert("bundleItems", {
          bundleId,
          productId: item.productId,
          productName: item.productName,
          quantity: item.quantity,
        })
      )
    )
    await ctx.db.insert("auditLogs", {
      action: existing ? "bundle.updated" : "bundle.created",
      actorUserId: String(user._id),
      createdAt: Date.now(),
      detail: `${name}:${args.items.length}`,
      entityId: bundleId,
      entityType: "bundle",
    })

    return bundleId
  },
})

export const setActive = mutation({
  args: {
    active: v.boolean(),
    bundleId: v.id("bundles"),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    const bundle = await ctx.db.get(args.bundleId)
    if (!bundle) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Lot introuvable.",
      })
    }
    await ctx.db.patch(bundle._id, { active: args.active })
    await ctx.db.insert("auditLogs", {
      action: args.active ? "bundle.reactivated" : "bundle.archived",
      actorUserId: String(user._id),
      createdAt: Date.now(),
      detail: bundle.name,
      entityId: bundle._id,
      entityType: "bundle",
    })
  },
})
