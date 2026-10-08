import { paginationOptsValidator } from "convex/server"
import { ConvexError, v } from "convex/values"

import { mutation, query } from "./_generated/server"
import { requireWriter } from "./lib/auth"
import { applyInventoryProductChanges } from "./lib/inventorySummary"
import { assertFiniteRange, assertWholeNumberRange } from "./lib/numbers"
import { buildTransactionSearchText } from "./lib/transactionSearch"

const MAX_QUANTITY = 1_000_000

export const listPage = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    await requireWriter(ctx)
    const result = await ctx.db
      .query("transactions")
      .withIndex("by_kind_and_date", (index) => index.eq("kind", "harvest"))
      .order("desc")
      .paginate({
        ...args.paginationOpts,
        numItems: Math.min(
          50,
          Math.max(1, Math.round(args.paginationOpts.numItems))
        ),
      })
    return {
      ...result,
      page: await Promise.all(
        result.page.map(async (harvest) => ({
          ...harvest,
          lines: await ctx.db
            .query("transactionLines")
            .withIndex("by_transaction", (index) =>
              index.eq("transactionId", harvest._id)
            )
            .collect(),
        }))
      ),
    }
  },
})

export const record = mutation({
  args: {
    characterId: v.id("characters"),
    comment: v.optional(v.string()),
    lines: v.array(
      v.object({ productId: v.id("products"), quantity: v.number() })
    ),
    occurredAt: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await requireWriter(ctx)
    const character = await ctx.db.get(args.characterId)
    if (!character?.active) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Personnage introuvable ou archivé.",
      })
    }
    if (args.lines.length === 0 || args.lines.length > 50) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Une récolte doit contenir entre 1 et 50 ingrédients.",
      })
    }
    assertFiniteRange(args.occurredAt, 0, Date.now() + 86_400_000, "La date")
    const comment = args.comment?.trim()
    if (comment && comment.length > 500) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Le commentaire ne peut pas dépasser 500 caractères.",
      })
    }
    const references = new Set<string>()
    const preparedLines = []
    for (const line of args.lines) {
      assertWholeNumberRange(line.quantity, 1, MAX_QUANTITY, "La quantité")
      if (references.has(line.productId)) {
        throw new ConvexError({
          code: "INVALID_INPUT",
          message:
            "Un ingrédient ne peut apparaître qu’une fois dans la récolte.",
        })
      }
      references.add(line.productId)
      const product = await ctx.db.get(line.productId)
      if (
        !product?.active ||
        product.category !== "ingredient" ||
        !product.tracksStock
      ) {
        throw new ConvexError({
          code: "INVALID_INPUT",
          message: "Sélectionnez un ingrédient actif suivi en stock.",
        })
      }
      const resultingStock = product.currentStock + line.quantity
      assertWholeNumberRange(
        resultingStock,
        0,
        MAX_QUANTITY,
        "Le stock après récolte"
      )
      preparedLines.push({ product, quantity: line.quantity, resultingStock })
    }

    const productName = preparedLines
      .map((line) => line.product.name)
      .join(", ")
    const transactionId = await ctx.db.insert("transactions", {
      actorCharacterId: character._id,
      actorName: character.name,
      actorUserId: String(user._id),
      ...(comment ? { comment } : {}),
      financial: false,
      kind: "harvest",
      lineCount: preparedLines.length,
      occurredAt: args.occurredAt,
      productName,
      quantity: preparedLines.reduce((total, line) => total + line.quantity, 0),
      searchText: buildTransactionSearchText({
        actorName: character.name,
        comment,
        productName,
      }),
      source: "web",
      total: 0,
    })
    for (const { product, quantity, resultingStock } of preparedLines) {
      await ctx.db.insert("transactionLines", {
        direction: "incoming",
        kind: "product",
        productId: product._id,
        productName: product.name,
        quantity,
        total: 0,
        transactionId,
        unitPrice: 0,
      })
      await ctx.db.patch(product._id, { currentStock: resultingStock })
      await ctx.db.insert("stockMovements", {
        delta: quantity,
        occurredAt: args.occurredAt,
        previousStock: product.currentStock,
        productId: product._id,
        reason: "harvest",
        resultingStock,
        transactionId,
      })
    }
    await applyInventoryProductChanges(
      ctx,
      preparedLines.map(({ product, resultingStock }) => ({
        before: product,
        after: { ...product, currentStock: resultingStock },
      }))
    )
    await ctx.db.insert("auditLogs", {
      action: "harvest.recorded",
      actorUserId: String(user._id),
      createdAt: Date.now(),
      detail: `${character.name}:${productName}`,
      entityId: transactionId,
      entityType: "transaction",
    })
    return { transactionId }
  },
})
