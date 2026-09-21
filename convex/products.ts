import { ConvexError, v } from "convex/values"

import { type Id } from "./_generated/dataModel"
import { mutation, query } from "./_generated/server"
import { requireUser } from "./lib/auth"
import {
  applyInventoryProductChanges,
  rebuildInventorySummaryIfReady,
} from "./lib/inventorySummary"
import { assertFiniteRange, assertWholeNumberRange } from "./lib/numbers"
import { canonicalProductCategory } from "./lib/products"
import { rebuildRecipeCostProjections } from "./lib/recipeCost"
import { normalizeCatalogName, normalizeName } from "./lib/text"
import { buildTransactionSearchText } from "./lib/transactionSearch"
import { productCategory } from "./lib/validators"

const MAX_NAME_LENGTH = 100
const MAX_PRICE = 1_000_000_000
const MAX_STOCK = 1_000_000

function optionalPrice(value: number | null): number | undefined {
  if (value === null) return undefined
  assertFiniteRange(value, 0, MAX_PRICE, "Le prix")
  return value
}

export const list = query({
  args: {
    category: v.optional(productCategory),
    search: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireUser(ctx)
    const products = args.category
      ? await ctx.db
          .query("products")
          .withIndex("by_category", (index) =>
            index.eq("category", args.category!)
          )
          .collect()
      : await ctx.db
          .query("products")
          .withIndex("by_active", (index) => index.eq("active", true))
          .collect()
    const search = normalizeName(args.search ?? "")

    return products
      .filter(
        (product) =>
          product.active && (!search || product.normalizedName.includes(search))
      )
      .sort((left, right) => left.name.localeCompare(right.name, "fr"))
  },
})

export const selectable = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx)
    const products = await ctx.db
      .query("products")
      .withIndex("by_active", (index) => index.eq("active", true))
      .collect()
    return products.sort((left, right) =>
      left.name.localeCompare(right.name, "fr")
    )
  },
})

export const listArchived = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx)
    const products = await ctx.db
      .query("products")
      .withIndex("by_active", (index) => index.eq("active", false))
      .collect()
    return products.sort((left, right) =>
      left.name.localeCompare(right.name, "fr")
    )
  },
})

export const setActive = mutation({
  args: {
    active: v.boolean(),
    productId: v.id("products"),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    const product = await ctx.db.get(args.productId)
    if (!product) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Référence introuvable.",
      })
    }
    const updatedProduct = { ...product, active: args.active }
    await ctx.db.patch(product._id, { active: args.active })
    await applyInventoryProductChanges(ctx, [
      { after: updatedProduct, before: product },
    ])
    await ctx.db.insert("auditLogs", {
      action: args.active ? "product.reactivated" : "product.archived",
      actorUserId: String(user._id),
      createdAt: Date.now(),
      detail: product.name,
      entityId: product._id,
      entityType: "product",
    })
  },
})

export const save = mutation({
  args: {
    active: v.boolean(),
    category: productCategory,
    craftable: v.optional(v.boolean()),
    minimumStock: v.number(),
    name: v.string(),
    productId: v.optional(v.id("products")),
    purchasePrice: v.union(v.number(), v.null()),
    salePrice: v.union(v.number(), v.null()),
    targetStock: v.number(),
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

    const normalizedName = normalizeName(name)
    const duplicates = await ctx.db
      .query("products")
      .withIndex("by_normalized_name", (index) =>
        index.eq("normalizedName", normalizedName)
      )
      .collect()
    if (duplicates.some((product) => product._id !== args.productId)) {
      throw new ConvexError({
        code: "ALREADY_EXISTS",
        message: "Une référence portant ce nom existe déjà.",
      })
    }

    const purchasePrice = optionalPrice(args.purchasePrice)
    const salePrice = optionalPrice(args.salePrice)
    const category = canonicalProductCategory(args.category)
    const tracksStock = category !== "service"
    const minimumStock = tracksStock ? args.minimumStock : 0
    const targetStock = tracksStock ? args.targetStock : 0
    assertWholeNumberRange(minimumStock, 0, MAX_STOCK, "Le seuil minimum")
    assertWholeNumberRange(targetStock, 0, MAX_STOCK, "Le stock")

    const existing = args.productId
      ? await ctx.db.get(args.productId)
      : undefined
    if (args.productId && !existing) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Référence introuvable.",
      })
    }
    const linkedRecipes = existing
      ? await ctx.db
          .query("recipes")
          .withIndex("by_product", (index) =>
            index.eq("productId", existing._id)
          )
          .collect()
      : []
    const hasActiveRecipe = linkedRecipes.some(
      (recipe) => recipe.active !== false
    )
    const craftable = tracksStock
      ? (args.craftable ??
        existing?.craftable ??
        (category === "potion" || hasActiveRecipe))
      : undefined
    if (existing && hasActiveRecipe && (!tracksStock || craftable === false)) {
      throw new ConvexError({
        code: "INVALID_OPERATION",
        message:
          "Archivez d’abord la recette active avant de rendre cet article non fabricable.",
      })
    }

    const previousStock = existing?.currentStock ?? 0
    const stockDelta = targetStock - previousStock
    const adjustmentLabel = existing
      ? `Correction de stock (${previousStock} → ${targetStock})`
      : "Stock initial"

    const details = {
      active: args.active,
      category,
      ...(craftable === undefined ? {} : { craftable }),
      currentStock: targetStock,
      ...(existing?.legacyKey ? { legacyKey: existing.legacyKey } : {}),
      minimumStock,
      name,
      normalizedName,
      ...(purchasePrice === undefined ? {} : { purchasePrice }),
      ...(salePrice === undefined ? {} : { salePrice }),
      tracksStock,
    }
    let productId: Id<"products">
    if (existing) {
      await ctx.db.replace(existing._id, details)
      productId = existing._id
      if (existing.name !== name) {
        const [linkedRecipes, linkedRecipeIngredients, linkedBundleItems] =
          await Promise.all([
            ctx.db
              .query("recipes")
              .filter((query) => query.eq(query.field("productId"), productId))
              .collect(),
            ctx.db
              .query("recipeIngredients")
              .filter((query) => query.eq(query.field("productId"), productId))
              .collect(),
            ctx.db
              .query("bundleItems")
              .filter((query) => query.eq(query.field("productId"), productId))
              .collect(),
          ])
        await Promise.all([
          ...linkedRecipes.map((recipe) => ctx.db.patch(recipe._id, { name })),
          ...linkedRecipeIngredients.map((ingredient) =>
            ctx.db.patch(ingredient._id, {
              ingredientName: name,
              raw: `${ingredient.quantity} ${name}`,
            })
          ),
          ...linkedBundleItems.map((item) =>
            ctx.db.patch(item._id, { productName: name })
          ),
        ])
      }
    } else {
      productId = await ctx.db.insert("products", details)
    }

    if (stockDelta !== 0) {
      const occurredAt = Date.now()
      const transactionId = await ctx.db.insert("transactions", {
        actorName: user.name,
        actorUserId: String(user._id),
        comment: adjustmentLabel,
        financial: false,
        kind: "adjustment",
        occurredAt,
        productId,
        productName: name,
        quantity: Math.abs(stockDelta),
        searchText: buildTransactionSearchText({
          actorName: user.name,
          comment: adjustmentLabel,
          productName: name,
        }),
        source: "web",
        total: 0,
      })
      await ctx.db.insert("stockMovements", {
        delta: stockDelta,
        occurredAt,
        previousStock,
        productId,
        reason: "adjustment",
        resultingStock: targetStock,
        transactionId,
      })
      await ctx.db.insert("auditLogs", {
        action: "product.stock_adjusted",
        actorUserId: String(user._id),
        createdAt: occurredAt,
        detail: adjustmentLabel,
        entityId: productId,
        entityType: "product",
      })
    }

    await ctx.db.insert("auditLogs", {
      action: existing ? "product.updated" : "product.created",
      actorUserId: String(user._id),
      createdAt: Date.now(),
      detail: name,
      entityId: productId,
      entityType: "product",
    })

    await rebuildRecipeCostProjections(ctx)
    await rebuildInventorySummaryIfReady(ctx)

    return productId
  },
})
