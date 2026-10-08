import { paginationOptsValidator } from "convex/server"
import { ConvexError, v } from "convex/values"

import { type Doc, type Id } from "./_generated/dataModel"
import { mutation, query, type MutationCtx } from "./_generated/server"
import { requireWriter } from "./lib/auth"
import { loadStockBeforeTransaction } from "./lib/exchange"
import { applyInventoryProductChanges } from "./lib/inventorySummary"
import { assertFiniteRange, assertWholeNumberRange } from "./lib/numbers"
import { buildTransactionSearchText } from "./lib/transactionSearch"

const MAX_QUANTITY = 1_000_000

const harvestArgs = {
  characterId: v.id("characters"),
  comment: v.optional(v.string()),
  lines: v.array(
    v.object({ productId: v.id("products"), quantity: v.number() })
  ),
  occurredAt: v.number(),
}
interface HarvestInput {
  characterId: Id<"characters">
  comment?: string
  lines: readonly { productId: Id<"products">; quantity: number }[]
  occurredAt: number
}

async function prepareHarvest(
  ctx: MutationCtx,
  args: HarvestInput,
  existing?: {
    transaction: Doc<"transactions">
    lines: Doc<"transactionLines">[]
  }
) {
  const character = await ctx.db.get(args.characterId)
  if (
    !character ||
    (!character.active &&
      existing?.transaction.actorCharacterId !== character._id)
  ) {
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
  let comment = args.comment?.trim()
  if (comment === "") comment = undefined
  if (comment && comment.length > 500) {
    throw new ConvexError({
      code: "INVALID_INPUT",
      message: "Le commentaire ne peut pas dépasser 500 caractères.",
    })
  }
  const references = new Set<string>()
  const lines = []
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
    const previous = existing?.lines.find(
      (entry) => entry.productId === line.productId
    )
    const product = await ctx.db.get(line.productId)
    if (
      !product ||
      (!previous &&
        (!product.active ||
          product.category !== "ingredient" ||
          !product.tracksStock))
    ) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Sélectionnez un ingrédient actif suivi en stock.",
      })
    }
    lines.push({
      product,
      productName: previous?.productName ?? product.name,
      purchaseUnitPrice: previous
        ? previous.purchaseUnitPrice
        : product.purchasePrice,
      quantity: line.quantity,
    })
  }
  const actorName =
    existing?.transaction.actorCharacterId === character._id
      ? existing.transaction.actorName
      : character.name
  const productName = lines.map((line) => line.productName).join(", ")
  return {
    details: {
      actorCharacterId: character._id,
      actorName,
      comment,
      lineCount: lines.length,
      occurredAt: args.occurredAt,
      productName,
      quantity: lines.reduce((total, line) => total + line.quantity, 0),
      searchText: buildTransactionSearchText({
        actorName,
        comment,
        productName,
      }),
    },
    lines,
  }
}

async function writeHarvestLines(
  ctx: MutationCtx,
  transactionId: Id<"transactions">,
  occurredAt: number,
  prepared: Awaited<ReturnType<typeof prepareHarvest>>,
  baseStocks: ReadonlyMap<string, number> = new Map()
) {
  for (const {
    product,
    productName,
    purchaseUnitPrice,
    quantity,
  } of prepared.lines) {
    await ctx.db.insert("transactionLines", {
      direction: "incoming",
      kind: "product",
      productId: product._id,
      productName,
      ...(purchaseUnitPrice === undefined ? {} : { purchaseUnitPrice }),
      quantity,
      total: 0,
      transactionId,
      unitPrice: 0,
    })
    const previousStock = baseStocks.get(product._id) ?? product.currentStock
    await ctx.db.insert("stockMovements", {
      delta: quantity,
      occurredAt,
      previousStock,
      productId: product._id,
      reason: "harvest",
      resultingStock: previousStock + quantity,
      transactionId,
    })
  }
}

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
  args: harvestArgs,
  handler: async (ctx, args) => {
    const user = await requireWriter(ctx)
    const prepared = await prepareHarvest(ctx, args)
    for (const { product, quantity } of prepared.lines) {
      assertWholeNumberRange(
        product.currentStock + quantity,
        0,
        MAX_QUANTITY,
        "Le stock après récolte"
      )
    }
    const transactionId = await ctx.db.insert("transactions", {
      ...prepared.details,
      actorUserId: String(user._id),
      financial: false,
      kind: "harvest",
      source: "web",
      total: 0,
    })
    for (const { product, quantity } of prepared.lines) {
      await ctx.db.patch(product._id, {
        currentStock: product.currentStock + quantity,
      })
    }
    await writeHarvestLines(ctx, transactionId, args.occurredAt, prepared)
    await applyInventoryProductChanges(
      ctx,
      prepared.lines.map(({ product, quantity }) => ({
        before: product,
        after: { ...product, currentStock: product.currentStock + quantity },
      }))
    )
    await ctx.db.insert("auditLogs", {
      action: "harvest.recorded",
      actorUserId: String(user._id),
      createdAt: Date.now(),
      detail: `${prepared.details.actorName}:${prepared.details.productName}`,
      entityId: transactionId,
      entityType: "transaction",
    })
    return { transactionId }
  },
})

export const update = mutation({
  args: { ...harvestArgs, transactionId: v.id("transactions") },
  handler: async (ctx, args) => {
    const user = await requireWriter(ctx)
    const transaction = await ctx.db.get(args.transactionId)
    if (!transaction) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Récolte introuvable.",
      })
    }
    if (transaction.kind !== "harvest") {
      throw new ConvexError({
        code: "INVALID_OPERATION",
        message: "Seule une récolte peut être modifiée depuis cette rubrique.",
      })
    }
    const existingLines = await ctx.db
      .query("transactionLines")
      .withIndex("by_transaction", (index) =>
        index.eq("transactionId", transaction._id)
      )
      .collect()
    const prepared = await prepareHarvest(ctx, args, {
      transaction,
      lines: existingLines,
    })
    const { movements, states } = await loadStockBeforeTransaction(
      ctx,
      transaction._id
    )
    const baseStocks = new Map(
      [...states].map(([id, state]) => [id, state.baseStock])
    )
    const changes = new Map(
      [...states].map(([id, state]) => [
        id,
        {
          before: state.product,
          after: { ...state.product, currentStock: state.baseStock },
        },
      ])
    )
    for (const { product, quantity } of prepared.lines) {
      changes.set(product._id, {
        before: product,
        after: {
          ...product,
          currentStock:
            (baseStocks.get(product._id) ?? product.currentStock) + quantity,
        },
      })
    }
    // Validate the final stock, including ingredients removed from the harvest.
    // The stock without the old harvest can be negative after consumption.
    for (const { after } of changes.values()) {
      if (after.currentStock < 0) {
        throw new ConvexError({
          code: "INSUFFICIENT_STOCK",
          message: `Impossible de modifier : le stock de « ${after.name} » deviendrait négatif.`,
        })
      }
      assertWholeNumberRange(
        after.currentStock,
        0,
        MAX_QUANTITY,
        "Le stock après correction"
      )
    }
    await Promise.all([
      ...existingLines.map((line) => ctx.db.delete(line._id)),
      ...movements.map((movement) => ctx.db.delete(movement._id)),
    ])
    for (const { after } of changes.values()) {
      await ctx.db.patch(after._id, { currentStock: after.currentStock })
    }
    await ctx.db.patch(transaction._id, prepared.details)
    await writeHarvestLines(
      ctx,
      transaction._id,
      args.occurredAt,
      prepared,
      baseStocks
    )
    await applyInventoryProductChanges(ctx, [...changes.values()])
    await ctx.db.insert("auditLogs", {
      action: "harvest.updated",
      actorUserId: String(user._id),
      createdAt: Date.now(),
      detail: JSON.stringify({
        before: {
          actorCharacterId: transaction.actorCharacterId,
          actorName: transaction.actorName,
          occurredAt: transaction.occurredAt,
          comment: transaction.comment,
          lines: existingLines.map(
            ({ productId, quantity, purchaseUnitPrice }) => ({
              productId,
              quantity,
              purchaseUnitPrice,
            })
          ),
        },
        after: {
          ...prepared.details,
          lines: prepared.lines.map(
            ({ product, quantity, purchaseUnitPrice }) => ({
              productId: product._id,
              quantity,
              purchaseUnitPrice,
            })
          ),
        },
      }),
      entityId: transaction._id,
      entityType: "transaction",
    })
    return { transactionId: transaction._id }
  },
})
