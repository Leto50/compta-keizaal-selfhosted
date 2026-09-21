import { ConvexError, v } from "convex/values"
import { paginationOptsValidator } from "convex/server"

import { type Doc, type Id } from "./_generated/dataModel"
import { mutation, query, type QueryCtx } from "./_generated/server"
import { requireUser } from "./lib/auth"
import { isFinancialTransaction } from "./lib/accountSummary"
import { resolveOrderContact } from "./lib/contacts"
import {
  assertFiniteRange,
  assertWholeNumberRange,
  roundSeptimsDown,
} from "./lib/numbers"
import {
  exchangeLineValidator,
  loadStockBeforeTransaction,
  prepareExchange,
} from "./lib/exchange"
import { orderTransactionLabel, withOrderTotal } from "./lib/order"
import { applyJournalBalanceChange } from "./lib/journalSummary"
import { applyInventoryProductChanges } from "./lib/inventorySummary"
import { prepareProduction } from "./lib/production"
import { readModelsAreReady } from "./lib/readModels"
import { normalizeName } from "./lib/text"
import { buildTransactionSearchText } from "./lib/transactionSearch"
import { financialTransactionKind, stockOperationKind } from "./lib/validators"

const MAX_TEXT_LENGTH = 500
const MAX_SEARCH_LENGTH = 100
const MAX_QUANTITY = 1_000_000
const MAX_PRICE = 1_000_000_000

const tradeLineValidator = v.union(
  v.object({
    kind: v.literal("product"),
    productId: v.id("products"),
    quantity: v.number(),
    unitPrice: v.optional(v.number()),
  }),
  v.object({
    bundleId: v.id("bundles"),
    kind: v.literal("bundle"),
    quantity: v.number(),
    unitPrice: v.optional(v.number()),
  })
)

function isEditableKind(
  kind: Doc<"transactions">["kind"]
): kind is "exchange" | "production" | "purchase" | "sale" | "service" {
  return (
    kind === "exchange" ||
    kind === "production" ||
    kind === "purchase" ||
    kind === "sale" ||
    kind === "service"
  )
}

function cleanOptionalText(value: string | undefined): string | undefined {
  const cleaned = value?.trim()
  if (!cleaned) return undefined
  if (cleaned.length > MAX_TEXT_LENGTH) {
    throw new ConvexError({
      code: "INVALID_INPUT",
      message: "Le texte saisi est trop long.",
    })
  }
  return cleaned
}

async function withTransactionDetails(
  ctx: QueryCtx,
  transaction: Doc<"transactions">
) {
  const [lines, movements] = await Promise.all([
    transaction.lineCount
      ? ctx.db
          .query("transactionLines")
          .withIndex("by_transaction", (index) =>
            index.eq("transactionId", transaction._id)
          )
          .collect()
      : [],
    ctx.db
      .query("stockMovements")
      .withIndex("by_transaction", (index) =>
        index.eq("transactionId", transaction._id)
      )
      .collect(),
  ])
  const deltas = new Map<string, number>()
  for (const movement of movements) {
    deltas.set(
      movement.productId,
      (deltas.get(movement.productId) ?? 0) + movement.delta
    )
  }
  return {
    ...transaction,
    canManage: true,
    canDelete: true,
    lines,
    stockDeltas: [...deltas].map(([productId, delta]) => ({
      delta,
      productId: productId as Id<"products">,
    })),
  }
}

export const listPage = query({
  args: {
    characterId: v.optional(v.id("characters")),
    from: v.optional(v.number()),
    kind: v.optional(financialTransactionKind),
    paginationOpts: paginationOptsValidator,
    q: v.optional(v.string()),
    to: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireUser(ctx)
    const readModelsReady = await readModelsAreReady(ctx)
    const from = args.from
    const to = args.to
    if (
      (from !== undefined && (!Number.isFinite(from) || from < 0)) ||
      (to !== undefined && (!Number.isFinite(to) || to < 0)) ||
      (from !== undefined && to !== undefined && from >= to)
    ) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "La période du journal est invalide.",
      })
    }
    const rawSearch = args.q?.trim()
    if (rawSearch && rawSearch.length > MAX_SEARCH_LENGTH) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: `La recherche est limitée à ${MAX_SEARCH_LENGTH} caractères.`,
      })
    }
    const normalizedSearch = rawSearch ? normalizeName(rawSearch) : undefined
    const paginationOpts = {
      ...args.paginationOpts,
      numItems: Math.min(
        100,
        Math.max(1, Math.round(args.paginationOpts.numItems))
      ),
    }

    function buildQuery() {
      if (normalizedSearch) {
        let searchQuery = ctx.db
          .query("transactions")
          .withSearchIndex("search_journal", (search) => {
            let filters = search.search("searchText", normalizedSearch)
            if (readModelsReady) filters = filters.eq("financial", true)
            if (args.kind) filters = filters.eq("kind", args.kind)
            if (args.characterId) {
              filters = filters.eq("actorCharacterId", args.characterId)
            }
            return filters
          })
        if (!readModelsReady) {
          searchQuery = searchQuery.filter((filter) =>
            filter.and(
              filter.neq(filter.field("kind"), "adjustment"),
              filter.neq(filter.field("kind"), "production")
            )
          )
        }
        if (from !== undefined) {
          searchQuery = searchQuery.filter((filter) =>
            filter.gte(filter.field("occurredAt"), from)
          )
        }
        if (to !== undefined) {
          searchQuery = searchQuery.filter((filter) =>
            filter.lt(filter.field("occurredAt"), to)
          )
        }
        return searchQuery
      }

      const indexedQuery = args.kind
        ? from !== undefined && to !== undefined
          ? ctx.db
              .query("transactions")
              .withIndex("by_kind_and_date", (index) =>
                index
                  .eq("kind", args.kind!)
                  .gte("occurredAt", from)
                  .lt("occurredAt", to)
              )
          : from !== undefined
            ? ctx.db
                .query("transactions")
                .withIndex("by_kind_and_date", (index) =>
                  index.eq("kind", args.kind!).gte("occurredAt", from)
                )
            : to !== undefined
              ? ctx.db
                  .query("transactions")
                  .withIndex("by_kind_and_date", (index) =>
                    index.eq("kind", args.kind!).lt("occurredAt", to)
                  )
              : ctx.db
                  .query("transactions")
                  .withIndex("by_kind_and_date", (index) =>
                    index.eq("kind", args.kind!)
                  )
        : readModelsReady
          ? from !== undefined && to !== undefined
            ? ctx.db
                .query("transactions")
                .withIndex("by_financial_and_date", (index) =>
                  index
                    .eq("financial", true)
                    .gte("occurredAt", from)
                    .lt("occurredAt", to)
                )
            : from !== undefined
              ? ctx.db
                  .query("transactions")
                  .withIndex("by_financial_and_date", (index) =>
                    index.eq("financial", true).gte("occurredAt", from)
                  )
              : to !== undefined
                ? ctx.db
                    .query("transactions")
                    .withIndex("by_financial_and_date", (index) =>
                      index.eq("financial", true).lt("occurredAt", to)
                    )
                : ctx.db
                    .query("transactions")
                    .withIndex("by_financial_and_date", (index) =>
                      index.eq("financial", true)
                    )
          : from !== undefined && to !== undefined
            ? ctx.db
                .query("transactions")
                .withIndex("by_occurred_at", (index) =>
                  index.gte("occurredAt", from).lt("occurredAt", to)
                )
            : from !== undefined
              ? ctx.db
                  .query("transactions")
                  .withIndex("by_occurred_at", (index) =>
                    index.gte("occurredAt", from)
                  )
              : to !== undefined
                ? ctx.db
                    .query("transactions")
                    .withIndex("by_occurred_at", (index) =>
                      index.lt("occurredAt", to)
                    )
                : ctx.db.query("transactions").withIndex("by_occurred_at")
      let filteredQuery = indexedQuery.order("desc")
      if (!args.kind && !readModelsReady) {
        filteredQuery = filteredQuery.filter((filter) =>
          filter.and(
            filter.neq(filter.field("kind"), "adjustment"),
            filter.neq(filter.field("kind"), "production")
          )
        )
      }
      if (args.characterId) {
        filteredQuery = filteredQuery.filter((filter) =>
          filter.eq(filter.field("actorCharacterId"), args.characterId)
        )
      }
      return filteredQuery
    }
    const result = await buildQuery().paginate(paginationOpts)

    return {
      ...result,
      page: result.page.map((transaction) => ({
        ...transaction,
        canManage: true,
        canDelete: true,
      })),
    }
  },
})

export const getDetails = query({
  args: {
    transactionId: v.id("transactions"),
  },
  handler: async (ctx, args) => {
    await requireUser(ctx)
    const transaction = await ctx.db.get(args.transactionId)
    if (!transaction) return null
    return withTransactionDetails(ctx, transaction)
  },
})

export const list = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireUser(ctx)
    const limit = Math.min(200, Math.max(10, Math.round(args.limit ?? 100)))
    const transactions = await ctx.db
      .query("transactions")
      .withIndex("by_occurred_at")
      .order("desc")
      .take(limit)
    return Promise.all(
      transactions.map((transaction) =>
        withTransactionDetails(ctx, transaction)
      )
    )
  },
})

export const recordExchange = mutation({
  args: {
    characterId: v.id("characters"),
    comment: v.optional(v.string()),
    counterparty: v.optional(v.string()),
    discount: v.optional(v.number()),
    lines: v.array(exchangeLineValidator),
    occurredAt: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    const character = await ctx.db.get(args.characterId)
    if (!character?.active) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Personnage introuvable ou archivé.",
      })
    }
    assertFiniteRange(args.occurredAt, 0, Date.now() + 86_400_000, "La date")
    const discount = args.discount ?? 0
    const prepared = await prepareExchange(ctx, args.lines, { discount })
    const comment = cleanOptionalText(args.comment)
    const counterparty = cleanOptionalText(args.counterparty)
    const firstLine = prepared.lines[0]
    const productName =
      prepared.lines.length === 1 && firstLine
        ? firstLine.productName
        : `${prepared.lines.length} références`
    const transactionDetails = {
      actorCharacterId: character._id,
      actorName: character.name,
      actorUserId: String(user._id),
      ...(comment ? { comment } : {}),
      ...(counterparty ? { counterparty } : {}),
      ...(discount > 0 ? { discount } : {}),
      financial: true,
      incomingTotal: prepared.incomingTotal,
      kind: prepared.kind,
      lineCount: prepared.lines.length,
      occurredAt: args.occurredAt,
      outgoingTotal: prepared.outgoingTotal,
      productName,
      quantity: prepared.lines.reduce((sum, line) => sum + line.quantity, 0),
      searchText: buildTransactionSearchText({
        actorName: character.name,
        comment,
        counterparty,
        productName,
      }),
      source: "web" as const,
      total: prepared.total,
      ...(prepared.lines.length === 1 && firstLine
        ? { unitPrice: firstLine.unitPrice }
        : {}),
    }
    const transactionId = await ctx.db.insert(
      "transactions",
      transactionDetails
    )

    for (const line of prepared.lines) {
      await ctx.db.insert("transactionLines", {
        ...(line.bundleId ? { bundleId: line.bundleId } : {}),
        direction: line.direction,
        kind: line.kind,
        ...(line.productId ? { productId: line.productId } : {}),
        productName: line.productName,
        quantity: line.quantity,
        total: line.total,
        transactionId,
        unitPrice: line.unitPrice,
      })
    }
    const inventoryChanges = []
    for (const { delta, product } of prepared.deltas.values()) {
      const resultingStock = product.currentStock + delta
      await ctx.db.patch(product._id, { currentStock: resultingStock })
      inventoryChanges.push({
        after: { ...product, currentStock: resultingStock },
        before: product,
      })
      await ctx.db.insert("stockMovements", {
        delta,
        occurredAt: args.occurredAt,
        previousStock: product.currentStock,
        productId: product._id,
        reason: prepared.kind,
        resultingStock,
        transactionId,
      })
    }
    await applyInventoryProductChanges(ctx, inventoryChanges)
    await ctx.db.insert("auditLogs", {
      action: "exchange.recorded",
      actorUserId: String(user._id),
      createdAt: Date.now(),
      detail: `${prepared.lines.length}:${prepared.total}`,
      entityId: transactionId,
      entityType: "transaction",
    })
    await applyJournalBalanceChange(ctx, undefined, transactionDetails)

    return {
      incomingTotal: prepared.incomingTotal,
      outgoingTotal: prepared.outgoingTotal,
      total: prepared.total,
      transactionId,
    }
  },
})

interface PreparedTradeLine {
  bundleId?: Id<"bundles">
  kind: "bundle" | "product"
  productId?: Id<"products">
  productName: string
  quantity: number
  total: number
  unitPrice: number
}

interface StockRequirement {
  product: Doc<"products">
  quantity: number
}

export const recordTrade = mutation({
  args: {
    characterId: v.id("characters"),
    comment: v.optional(v.string()),
    counterparty: v.optional(v.string()),
    discount: v.optional(v.number()),
    kind: v.union(v.literal("purchase"), v.literal("sale")),
    lines: v.array(tradeLineValidator),
    occurredAt: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
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
        message: "Une opération doit contenir entre 1 et 50 lignes.",
      })
    }
    assertFiniteRange(args.occurredAt, 0, Date.now() + 86_400_000, "La date")
    const discount = args.discount ?? 0
    assertFiniteRange(discount, 0, MAX_PRICE, "La remise")
    const counterparty = cleanOptionalText(args.counterparty)
    const comment = cleanOptionalText(args.comment)

    const references = new Set<string>()
    const preparedLines: PreparedTradeLine[] = []
    const stockRequirements = new Map<string, StockRequirement>()

    function addStockRequirement(product: Doc<"products">, quantity: number) {
      const existing = stockRequirements.get(product._id)
      stockRequirements.set(product._id, {
        product,
        quantity: (existing?.quantity ?? 0) + quantity,
      })
    }

    for (const line of args.lines) {
      assertWholeNumberRange(line.quantity, 1, MAX_QUANTITY, "La quantité")
      const referenceKey =
        line.kind === "product"
          ? `product:${line.productId}`
          : `bundle:${line.bundleId}`
      if (references.has(referenceKey)) {
        throw new ConvexError({
          code: "INVALID_INPUT",
          message:
            "Une référence ne peut apparaître qu’une fois dans l’opération.",
        })
      }
      references.add(referenceKey)

      if (line.kind === "product") {
        const product = await ctx.db.get(line.productId)
        if (!product?.active || !product.tracksStock) {
          throw new ConvexError({
            code: "NOT_FOUND",
            message:
              "Un produit de l’opération est introuvable ou indisponible.",
          })
        }
        const fallbackPrice =
          args.kind === "purchase" ? product.purchasePrice : product.salePrice
        const unitPrice = line.unitPrice ?? fallbackPrice ?? 0
        assertFiniteRange(unitPrice, 0, MAX_PRICE, "Le prix")
        preparedLines.push({
          kind: "product",
          productId: product._id,
          productName: product.name,
          quantity: line.quantity,
          total: line.quantity * unitPrice,
          unitPrice,
        })
        addStockRequirement(product, line.quantity)
        continue
      }

      if (args.kind === "purchase") {
        throw new ConvexError({
          code: "INVALID_INPUT",
          message: "Un achat ne peut contenir que des produits.",
        })
      }

      const bundle = await ctx.db.get(line.bundleId)
      if (!bundle?.active) {
        throw new ConvexError({
          code: "NOT_FOUND",
          message: "Un lot de la vente est introuvable ou archivé.",
        })
      }
      const bundleItems = await ctx.db
        .query("bundleItems")
        .withIndex("by_bundle", (index) => index.eq("bundleId", bundle._id))
        .collect()
      if (bundleItems.length === 0) {
        throw new ConvexError({
          code: "INVALID_INPUT",
          message: `Le lot « ${bundle.name} » ne contient aucun produit.`,
        })
      }
      for (const item of bundleItems) {
        if (!item.productId) {
          throw new ConvexError({
            code: "INVALID_INPUT",
            message: `Le composant « ${item.productName} » du lot n’est relié à aucun produit.`,
          })
        }
        const product = await ctx.db.get(item.productId)
        if (!product?.active || !product.tracksStock) {
          throw new ConvexError({
            code: "NOT_FOUND",
            message: `Le composant « ${item.productName} » est indisponible.`,
          })
        }
        assertWholeNumberRange(
          item.quantity,
          1,
          MAX_QUANTITY,
          "La quantité du lot"
        )
        addStockRequirement(product, item.quantity * line.quantity)
      }
      const unitPrice = line.unitPrice ?? bundle.price ?? 0
      assertFiniteRange(unitPrice, 0, MAX_PRICE, "Le prix")
      preparedLines.push({
        bundleId: bundle._id,
        kind: "bundle",
        productName: bundle.name,
        quantity: line.quantity,
        total: line.quantity * unitPrice,
        unitPrice,
      })
    }

    const gross = preparedLines.reduce((total, line) => total + line.total, 0)
    if (discount > gross) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "La remise ne peut pas dépasser le montant brut.",
      })
    }
    for (const requirement of stockRequirements.values()) {
      if (
        args.kind === "sale" &&
        requirement.quantity > requirement.product.currentStock
      ) {
        throw new ConvexError({
          code: "INSUFFICIENT_STOCK",
          message: `Stock insuffisant pour « ${requirement.product.name} » : ${requirement.product.currentStock} disponibles.`,
        })
      }
    }

    const roundedTotal = roundSeptimsDown(gross - discount)
    const total =
      args.kind === "purchase" && roundedTotal !== 0
        ? -roundedTotal
        : roundedTotal
    const firstLine = preparedLines[0]
    const occurredAt = args.occurredAt
    const productName =
      preparedLines.length === 1 && firstLine
        ? firstLine.productName
        : `${preparedLines.length} références`
    const transactionDetails = {
      actorCharacterId: character._id,
      actorName: character.name,
      actorUserId: String(user._id),
      ...(comment ? { comment } : {}),
      ...(counterparty ? { counterparty } : {}),
      ...(discount > 0 ? { discount } : {}),
      financial: true,
      kind: args.kind,
      lineCount: preparedLines.length,
      occurredAt,
      productName,
      quantity: preparedLines.reduce((sum, line) => sum + line.quantity, 0),
      searchText: buildTransactionSearchText({
        actorName: character.name,
        comment,
        counterparty,
        productName,
      }),
      source: "web" as const,
      total,
      ...(preparedLines.length === 1 && firstLine
        ? { unitPrice: firstLine.unitPrice }
        : {}),
    }
    const transactionId = await ctx.db.insert(
      "transactions",
      transactionDetails
    )

    for (const line of preparedLines) {
      await ctx.db.insert("transactionLines", {
        ...(line.bundleId ? { bundleId: line.bundleId } : {}),
        kind: line.kind,
        ...(line.productId ? { productId: line.productId } : {}),
        productName: line.productName,
        quantity: line.quantity,
        total: line.total,
        transactionId,
        unitPrice: line.unitPrice,
      })
    }
    const inventoryChanges = []
    for (const requirement of stockRequirements.values()) {
      const delta =
        args.kind === "purchase" ? requirement.quantity : -requirement.quantity
      const resultingStock = requirement.product.currentStock + delta
      await ctx.db.patch(requirement.product._id, {
        currentStock: resultingStock,
      })
      inventoryChanges.push({
        after: { ...requirement.product, currentStock: resultingStock },
        before: requirement.product,
      })
      await ctx.db.insert("stockMovements", {
        delta,
        occurredAt,
        previousStock: requirement.product.currentStock,
        productId: requirement.product._id,
        reason: args.kind,
        resultingStock,
        transactionId,
      })
    }
    await applyInventoryProductChanges(ctx, inventoryChanges)
    await ctx.db.insert("auditLogs", {
      action: `${args.kind}.recorded`,
      actorUserId: String(user._id),
      createdAt: Date.now(),
      detail: `${preparedLines.length}:${total}`,
      entityId: transactionId,
      entityType: "transaction",
    })
    await applyJournalBalanceChange(ctx, undefined, transactionDetails)

    return { total, transactionId }
  },
})

export const record = mutation({
  args: {
    characterId: v.id("characters"),
    comment: v.optional(v.string()),
    counterparty: v.optional(v.string()),
    discount: v.optional(v.number()),
    kind: stockOperationKind,
    occurredAt: v.number(),
    productId: v.id("products"),
    quantity: v.number(),
    unitPrice: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    const [product, character] = await Promise.all([
      ctx.db.get(args.productId),
      ctx.db.get(args.characterId),
    ])
    if (!product?.active) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Produit introuvable ou archivé.",
      })
    }
    if (!character?.active) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Personnage introuvable ou archivé.",
      })
    }
    assertWholeNumberRange(args.quantity, 1, MAX_QUANTITY, "La quantité")
    assertFiniteRange(args.occurredAt, 0, Date.now() + 86_400_000, "La date")
    const fallbackPrice =
      args.kind === "purchase" ? product.purchasePrice : product.salePrice
    const unitPrice = args.unitPrice ?? fallbackPrice ?? 0
    const discount = args.discount ?? 0
    assertFiniteRange(unitPrice, 0, MAX_PRICE, "Le prix")
    assertFiniteRange(discount, 0, MAX_PRICE, "La remise")

    if (product.tracksStock === false && args.kind !== "service") {
      throw new ConvexError({
        code: "INVALID_OPERATION",
        message: "Ce service ne produit aucun mouvement de stock.",
      })
    }
    if (product.tracksStock && args.kind === "service") {
      throw new ConvexError({
        code: "INVALID_OPERATION",
        message: "Sélectionnez un service pour cette opération.",
      })
    }

    const production =
      args.kind === "production"
        ? await prepareProduction(ctx, product._id, args.quantity)
        : undefined
    const delta =
      args.kind === "sale"
        ? -args.quantity
        : args.kind === "purchase"
          ? args.quantity
          : 0
    const stockDeltas =
      production?.deltas ??
      new Map(delta === 0 ? [] : [[product._id, { delta, product }] as const])
    const resultingStock =
      product.currentStock + (stockDeltas.get(product._id)?.delta ?? 0)
    if (!production && resultingStock < 0) {
      throw new ConvexError({
        code: "INSUFFICIENT_STOCK",
        message: `Stock insuffisant : ${product.currentStock} ${Math.abs(product.currentStock) === 1 ? "disponible" : "disponibles"}.`,
      })
    }

    const gross = args.quantity * unitPrice
    if (discount > gross) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "La remise ne peut pas dépasser le montant brut.",
      })
    }
    const net = roundSeptimsDown(gross - discount)
    const total =
      args.kind === "purchase"
        ? net === 0
          ? 0
          : -net
        : args.kind === "production"
          ? 0
          : net
    const counterparty = cleanOptionalText(args.counterparty)
    const comment = cleanOptionalText(args.comment)
    const transactionDetails = {
      actorCharacterId: character._id,
      actorName: character.name,
      actorUserId: String(user._id),
      ...(comment ? { comment } : {}),
      ...(counterparty ? { counterparty } : {}),
      ...(discount > 0 ? { discount } : {}),
      financial: isFinancialTransaction({ kind: args.kind }),
      kind: args.kind,
      occurredAt: args.occurredAt,
      productId: product._id,
      productName: product.name,
      quantity: args.quantity,
      searchText: buildTransactionSearchText({
        actorName: character.name,
        comment,
        counterparty,
        productName: product.name,
      }),
      source: "web" as const,
      total,
      unitPrice,
    }
    const transactionId = await ctx.db.insert(
      "transactions",
      transactionDetails
    )

    const inventoryChanges = []
    for (const change of stockDeltas.values()) {
      const changedStock = change.product.currentStock + change.delta
      await ctx.db.patch(change.product._id, { currentStock: changedStock })
      inventoryChanges.push({
        after: { ...change.product, currentStock: changedStock },
        before: change.product,
      })
      await ctx.db.insert("stockMovements", {
        delta: change.delta,
        occurredAt: args.occurredAt,
        previousStock: change.product.currentStock,
        productId: change.product._id,
        reason: args.kind,
        resultingStock: changedStock,
        transactionId,
      })
    }
    await applyInventoryProductChanges(ctx, inventoryChanges)

    await ctx.db.insert("auditLogs", {
      action: "transaction.recorded",
      actorUserId: String(user._id),
      createdAt: Date.now(),
      detail: `${args.kind}:${args.quantity}`,
      entityId: transactionId,
      entityType: "transaction",
    })
    await applyJournalBalanceChange(ctx, undefined, transactionDetails)

    return { resultingStock, transactionId }
  },
})

export const updateExchange = mutation({
  args: {
    agreedTotal: v.optional(v.number()),
    characterId: v.id("characters"),
    comment: v.optional(v.string()),
    counterparty: v.optional(v.string()),
    discount: v.optional(v.number()),
    lines: v.array(exchangeLineValidator),
    occurredAt: v.number(),
    transactionId: v.id("transactions"),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    const transaction = await ctx.db.get(args.transactionId)
    if (!transaction) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Opération introuvable.",
      })
    }
    if (transaction.kind === "production") {
      throw new ConvexError({
        code: "INVALID_OPERATION",
        message: "Une production utilise son formulaire dédié.",
      })
    }
    const character = await ctx.db.get(args.characterId)
    if (!character?.active) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Personnage introuvable ou archivé.",
      })
    }
    assertFiniteRange(args.occurredAt, 0, Date.now() + 86_400_000, "La date")
    const { movements, states } = await loadStockBeforeTransaction(
      ctx,
      transaction._id
    )
    const baseStocks = new Map(
      [...states].map(([productId, state]) => [productId, state.baseStock])
    )
    const linkedOrder = transaction.orderId
      ? await ctx.db.get(transaction.orderId)
      : null
    if (transaction.orderId && !linkedOrder) {
      throw new ConvexError({
        code: "LINKED_ORDER_MISSING",
        message:
          "La commande liée à cette transaction est introuvable. Aucune correction n’a été appliquée.",
      })
    }
    const discount = args.discount ?? 0
    if (linkedOrder && discount > 0) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message:
          "Modifiez le total convenu de la commande plutôt qu’une remise.",
      })
    }
    if (linkedOrder && args.agreedTotal !== undefined) {
      assertWholeNumberRange(args.agreedTotal, 0, MAX_PRICE, "Le total convenu")
    }
    const preparedFromLines = await prepareExchange(ctx, args.lines, {
      baseStocks,
      discount: linkedOrder ? 0 : discount,
    })
    const linkedOrderKind =
      linkedOrder && preparedFromLines.lines[0]?.direction === "incoming"
        ? "supplier"
        : "client"
    const linkedAgreedTotal = linkedOrder
      ? (args.agreedTotal ?? linkedOrder.total ?? Math.abs(transaction.total))
      : undefined
    if (linkedAgreedTotal !== undefined) {
      assertWholeNumberRange(
        linkedAgreedTotal,
        0,
        MAX_PRICE,
        "Le total convenu"
      )
    }
    const prepared =
      linkedOrder && linkedAgreedTotal !== undefined
        ? withOrderTotal(preparedFromLines, linkedOrderKind, linkedAgreedTotal)
        : preparedFromLines
    if (linkedOrder) {
      const directions = new Set(prepared.lines.map((line) => line.direction))
      if (
        directions.size !== 1 ||
        prepared.lines.some((line) => line.kind === "bundle")
      ) {
        throw new ConvexError({
          code: "INVALID_ORDER_TRANSACTION",
          message:
            "Une transaction liée à une commande doit contenir uniquement des produits dans un seul sens.",
        })
      }
    }
    const existingLines = await ctx.db
      .query("transactionLines")
      .withIndex("by_transaction", (index) =>
        index.eq("transactionId", transaction._id)
      )
      .collect()
    const stockIds = new Set([...states.keys(), ...prepared.deltas.keys()])
    for (const productId of stockIds) {
      const state = states.get(productId)
      const newDelta = prepared.deltas.get(productId)
      const product = state?.product ?? newDelta?.product
      if (!product) continue
      const baseStock = state?.baseStock ?? product.currentStock
      const resultingStock = baseStock + (newDelta?.delta ?? 0)
      if (resultingStock < 0) {
        throw new ConvexError({
          code: "INSUFFICIENT_STOCK",
          message: `Stock insuffisant pour « ${product.name} » : ${baseStock} disponibles.`,
        })
      }
    }

    await Promise.all([
      ...existingLines.map((line) => ctx.db.delete(line._id)),
      ...movements.map((movement) => ctx.db.delete(movement._id)),
    ])
    const inventoryChanges = []
    for (const productId of stockIds) {
      const state = states.get(productId)
      const newDelta = prepared.deltas.get(productId)
      const product = state?.product ?? newDelta?.product
      if (!product) continue
      const baseStock = state?.baseStock ?? product.currentStock
      const resultingStock = baseStock + (newDelta?.delta ?? 0)
      await ctx.db.patch(product._id, {
        currentStock: resultingStock,
      })
      inventoryChanges.push({
        after: { ...product, currentStock: resultingStock },
        before: product,
      })
    }
    await applyInventoryProductChanges(ctx, inventoryChanges)

    const comment = cleanOptionalText(args.comment)
    const counterparty = cleanOptionalText(args.counterparty)
    const resolvedLinkedContact = linkedOrder
      ? await resolveOrderContact(ctx, {
          ...(linkedOrder.contactId &&
          linkedOrder.kind === linkedOrderKind &&
          (!counterparty ||
            normalizeName(counterparty) ===
              normalizeName(linkedOrder.contactName))
            ? { contactId: linkedOrder.contactId }
            : {}),
          existingOrder: linkedOrder,
          kind: linkedOrderKind,
          name: counterparty ?? linkedOrder.contactName,
        })
      : undefined
    const resolvedCounterparty =
      resolvedLinkedContact?.contactName ?? counterparty
    const firstLine = prepared.lines[0]
    const productName = linkedOrder
      ? orderTransactionLabel(
          linkedOrderKind,
          resolvedLinkedContact!.contactName
        )
      : prepared.lines.length === 1 && firstLine
        ? firstLine.productName
        : `${prepared.lines.length} références`
    const updatedTransaction = {
      actorCharacterId: character._id,
      actorName: character.name,
      actorUserId: transaction.actorUserId ?? String(user._id),
      ...(comment ? { comment } : {}),
      ...(resolvedCounterparty ? { counterparty: resolvedCounterparty } : {}),
      ...(!linkedOrder && discount > 0 ? { discount } : {}),
      financial: true,
      incomingTotal: prepared.incomingTotal,
      kind: prepared.kind,
      ...(transaction.legacyKey ? { legacyKey: transaction.legacyKey } : {}),
      lineCount: prepared.lines.length,
      occurredAt: args.occurredAt,
      ...(transaction.orderId ? { orderId: transaction.orderId } : {}),
      outgoingTotal: prepared.outgoingTotal,
      productName,
      quantity: prepared.lines.reduce((sum, line) => sum + line.quantity, 0),
      searchText: buildTransactionSearchText({
        actorName: character.name,
        comment,
        counterparty: resolvedCounterparty,
        productName,
      }),
      source: transaction.source,
      total: prepared.total,
      ...(prepared.lines.length === 1 && firstLine
        ? { unitPrice: firstLine.unitPrice }
        : {}),
    }
    await ctx.db.replace(transaction._id, updatedTransaction)
    for (const line of prepared.lines) {
      await ctx.db.insert("transactionLines", {
        ...(line.bundleId ? { bundleId: line.bundleId } : {}),
        direction: line.direction,
        kind: line.kind,
        ...(line.productId ? { productId: line.productId } : {}),
        productName: line.productName,
        quantity: line.quantity,
        total: line.total,
        transactionId: transaction._id,
        unitPrice: line.unitPrice,
      })
    }
    if (linkedOrder) {
      const oldOrderLines = await ctx.db
        .query("orderLines")
        .withIndex("by_order", (index) => index.eq("orderId", linkedOrder._id))
        .collect()
      await Promise.all(oldOrderLines.map((line) => ctx.db.delete(line._id)))
      await Promise.all(
        prepared.lines.map((line) =>
          ctx.db.insert("orderLines", {
            kind: "product",
            orderId: linkedOrder._id,
            productId: line.productId,
            productName: line.productName,
            quantity: line.quantity,
            total: line.total,
            unitPrice: line.unitPrice,
          })
        )
      )
      await ctx.db.patch(linkedOrder._id, {
        contactId: resolvedLinkedContact!.contactId,
        contactName: resolvedLinkedContact!.contactName,
        discount: undefined,
        kind: linkedOrderKind,
        processedAt: args.occurredAt,
        ...(linkedOrderKind === "supplier"
          ? { status: "delivered" as const }
          : {}),
        total: Math.abs(prepared.total),
      })
    }
    for (const { delta, product } of prepared.deltas.values()) {
      const baseStock =
        states.get(product._id)?.baseStock ?? product.currentStock
      const resultingStock = baseStock + delta
      await ctx.db.insert("stockMovements", {
        delta,
        occurredAt: args.occurredAt,
        previousStock: baseStock,
        productId: product._id,
        reason: prepared.kind,
        resultingStock,
        transactionId: transaction._id,
      })
    }
    await ctx.db.insert("auditLogs", {
      action: "transaction.updated",
      actorUserId: String(user._id),
      createdAt: Date.now(),
      detail: `${transaction.kind}->${prepared.kind}:${transaction.total}->${prepared.total}`,
      entityId: transaction._id,
      entityType: "transaction",
    })
    await applyJournalBalanceChange(ctx, transaction, updatedTransaction)

    return {
      incomingTotal: prepared.incomingTotal,
      outgoingTotal: prepared.outgoingTotal,
      total: prepared.total,
    }
  },
})

export const remove = mutation({
  args: {
    transactionId: v.id("transactions"),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    const transaction = await ctx.db.get(args.transactionId)
    if (!transaction) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Opération introuvable.",
      })
    }
    const { movements, states } = await loadStockBeforeTransaction(
      ctx,
      transaction._id
    )
    for (const state of states.values()) {
      if (state.baseStock < 0) {
        throw new ConvexError({
          code: "INSUFFICIENT_STOCK",
          message: `Impossible de supprimer : le stock de « ${state.product.name} » est insuffisant.`,
        })
      }
    }

    const lines = await ctx.db
      .query("transactionLines")
      .withIndex("by_transaction", (index) =>
        index.eq("transactionId", transaction._id)
      )
      .collect()
    const linkedOrder = await ctx.db
      .query("orders")
      .withIndex("by_transaction", (index) =>
        index.eq("transactionId", transaction._id)
      )
      .unique()
    await Promise.all([
      ...lines.map((line) => ctx.db.delete(line._id)),
      ...movements.map((movement) => ctx.db.delete(movement._id)),
    ])
    await Promise.all(
      [...states.values()].map((state) =>
        ctx.db.patch(state.product._id, { currentStock: state.baseStock })
      )
    )
    await applyInventoryProductChanges(
      ctx,
      [...states.values()].map((state) => ({
        after: { ...state.product, currentStock: state.baseStock },
        before: state.product,
      }))
    )
    await ctx.db.delete(transaction._id)
    await applyJournalBalanceChange(ctx, transaction, undefined)
    if (linkedOrder) {
      await ctx.db.patch(linkedOrder._id, {
        processedAt: undefined,
        transactionId: undefined,
      })
    }
    await ctx.db.insert("auditLogs", {
      action: "transaction.deleted",
      actorUserId: String(user._id),
      createdAt: Date.now(),
      detail: `${transaction.kind}:${transaction.productName}:${transaction.quantity}:${transaction.total}`,
      entityId: transaction._id,
      entityType: "transaction",
    })
  },
})

export const update = mutation({
  args: {
    characterId: v.id("characters"),
    comment: v.optional(v.string()),
    counterparty: v.optional(v.string()),
    discount: v.optional(v.number()),
    kind: stockOperationKind,
    lines: v.optional(v.array(tradeLineValidator)),
    occurredAt: v.number(),
    productId: v.optional(v.id("products")),
    quantity: v.optional(v.number()),
    transactionId: v.id("transactions"),
    unitPrice: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    const transaction = await ctx.db.get(args.transactionId)
    if (!transaction) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Opération introuvable.",
      })
    }
    if (!isEditableKind(transaction.kind)) {
      throw new ConvexError({
        code: "INVALID_OPERATION",
        message: "Ce type d’opération historique ne peut pas être modifié.",
      })
    }
    const character = await ctx.db.get(args.characterId)
    if (!character?.active) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Personnage introuvable ou archivé.",
      })
    }
    assertFiniteRange(args.occurredAt, 0, Date.now() + 86_400_000, "La date")
    const discount = args.discount ?? 0
    assertFiniteRange(discount, 0, MAX_PRICE, "La remise")
    const counterparty = cleanOptionalText(args.counterparty)
    const comment = cleanOptionalText(args.comment)
    const { movements: oldMovements, states } =
      await loadStockBeforeTransaction(ctx, transaction._id)
    const newDeltas = new Map<
      string,
      { delta: number; product: Doc<"products"> }
    >()

    function addDelta(product: Doc<"products">, delta: number) {
      const current = newDeltas.get(product._id)
      newDeltas.set(product._id, {
        delta: (current?.delta ?? 0) + delta,
        product,
      })
    }

    let details: Omit<Doc<"transactions">, "_creationTime" | "_id">
    const preparedLines: PreparedTradeLine[] = []

    if (args.kind === "purchase" || args.kind === "sale") {
      const lines = args.lines ?? []
      if (lines.length === 0 || lines.length > 50) {
        throw new ConvexError({
          code: "INVALID_INPUT",
          message: "Une opération doit contenir entre 1 et 50 lignes.",
        })
      }
      const references = new Set<string>()
      const stockRequirements = new Map<string, StockRequirement>()

      function addStockRequirement(product: Doc<"products">, quantity: number) {
        const current = stockRequirements.get(product._id)
        stockRequirements.set(product._id, {
          product,
          quantity: (current?.quantity ?? 0) + quantity,
        })
      }

      for (const line of lines) {
        assertWholeNumberRange(line.quantity, 1, MAX_QUANTITY, "La quantité")
        const referenceKey =
          line.kind === "product"
            ? `product:${line.productId}`
            : `bundle:${line.bundleId}`
        if (references.has(referenceKey)) {
          throw new ConvexError({
            code: "INVALID_INPUT",
            message:
              "Une référence ne peut apparaître qu’une fois dans l’opération.",
          })
        }
        references.add(referenceKey)

        if (line.kind === "product") {
          const product = await ctx.db.get(line.productId)
          if (!product?.active || !product.tracksStock) {
            throw new ConvexError({
              code: "NOT_FOUND",
              message:
                "Un produit de l’opération est introuvable ou indisponible.",
            })
          }
          const fallbackPrice =
            args.kind === "purchase" ? product.purchasePrice : product.salePrice
          const linePrice = line.unitPrice ?? fallbackPrice ?? 0
          assertFiniteRange(linePrice, 0, MAX_PRICE, "Le prix")
          preparedLines.push({
            kind: "product",
            productId: product._id,
            productName: product.name,
            quantity: line.quantity,
            total: line.quantity * linePrice,
            unitPrice: linePrice,
          })
          addStockRequirement(product, line.quantity)
          continue
        }

        if (args.kind === "purchase") {
          throw new ConvexError({
            code: "INVALID_INPUT",
            message: "Un achat ne peut contenir que des produits.",
          })
        }
        const bundle = await ctx.db.get(line.bundleId)
        if (!bundle?.active) {
          throw new ConvexError({
            code: "NOT_FOUND",
            message: "Un lot de la vente est introuvable ou archivé.",
          })
        }
        const bundleItems = await ctx.db
          .query("bundleItems")
          .withIndex("by_bundle", (index) => index.eq("bundleId", bundle._id))
          .collect()
        if (bundleItems.length === 0) {
          throw new ConvexError({
            code: "INVALID_INPUT",
            message: `Le lot « ${bundle.name} » ne contient aucun produit.`,
          })
        }
        for (const item of bundleItems) {
          if (!item.productId) {
            throw new ConvexError({
              code: "INVALID_INPUT",
              message: `Le composant « ${item.productName} » du lot n’est relié à aucun produit.`,
            })
          }
          const product = await ctx.db.get(item.productId)
          if (!product?.active || !product.tracksStock) {
            throw new ConvexError({
              code: "NOT_FOUND",
              message: `Le composant « ${item.productName} » est indisponible.`,
            })
          }
          assertWholeNumberRange(
            item.quantity,
            1,
            MAX_QUANTITY,
            "La quantité du lot"
          )
          addStockRequirement(product, item.quantity * line.quantity)
        }
        const linePrice = line.unitPrice ?? bundle.price ?? 0
        assertFiniteRange(linePrice, 0, MAX_PRICE, "Le prix")
        preparedLines.push({
          bundleId: bundle._id,
          kind: "bundle",
          productName: bundle.name,
          quantity: line.quantity,
          total: line.quantity * linePrice,
          unitPrice: linePrice,
        })
      }

      const gross = preparedLines.reduce((sum, line) => sum + line.total, 0)
      if (discount > gross) {
        throw new ConvexError({
          code: "INVALID_INPUT",
          message: "La remise ne peut pas dépasser le montant brut.",
        })
      }
      for (const requirement of stockRequirements.values()) {
        addDelta(
          requirement.product,
          args.kind === "purchase"
            ? requirement.quantity
            : -requirement.quantity
        )
      }
      const roundedTotal = roundSeptimsDown(gross - discount)
      const total =
        args.kind === "purchase" && roundedTotal !== 0
          ? -roundedTotal
          : roundedTotal
      const firstLine = preparedLines[0]
      details = {
        actorCharacterId: character._id,
        actorName: character.name,
        actorUserId: transaction.actorUserId ?? String(user._id),
        ...(comment ? { comment } : {}),
        ...(counterparty ? { counterparty } : {}),
        ...(discount > 0 ? { discount } : {}),
        financial: true,
        kind: args.kind,
        ...(transaction.legacyKey ? { legacyKey: transaction.legacyKey } : {}),
        lineCount: preparedLines.length,
        occurredAt: args.occurredAt,
        productName:
          preparedLines.length === 1 && firstLine
            ? firstLine.productName
            : `${preparedLines.length} références`,
        quantity: preparedLines.reduce((sum, line) => sum + line.quantity, 0),
        source: transaction.source,
        total,
        ...(preparedLines.length === 1 && firstLine
          ? { unitPrice: firstLine.unitPrice }
          : {}),
      }
    } else {
      if (!args.productId || args.quantity === undefined) {
        throw new ConvexError({
          code: "INVALID_INPUT",
          message: "Le produit et la quantité sont obligatoires.",
        })
      }
      const product = await ctx.db.get(args.productId)
      if (!product?.active) {
        throw new ConvexError({
          code: "NOT_FOUND",
          message: "Produit introuvable ou archivé.",
        })
      }
      assertWholeNumberRange(args.quantity, 1, MAX_QUANTITY, "La quantité")
      const fallbackPrice = product.salePrice
      const unitPrice = args.unitPrice ?? fallbackPrice ?? 0
      assertFiniteRange(unitPrice, 0, MAX_PRICE, "Le prix")
      if (product.tracksStock === false && args.kind !== "service") {
        throw new ConvexError({
          code: "INVALID_OPERATION",
          message: "Ce service ne produit aucun mouvement de stock.",
        })
      }
      if (product.tracksStock && args.kind === "service") {
        throw new ConvexError({
          code: "INVALID_OPERATION",
          message: "Sélectionnez un service pour cette opération.",
        })
      }
      const gross = args.quantity * unitPrice
      if (discount > gross) {
        throw new ConvexError({
          code: "INVALID_INPUT",
          message: "La remise ne peut pas dépasser le montant brut.",
        })
      }
      if (args.kind === "production") {
        const baseStocks = new Map(
          [...states].map(([productId, state]) => [productId, state.baseStock])
        )
        const production = await prepareProduction(
          ctx,
          product._id,
          args.quantity,
          { baseStocks }
        )
        for (const change of production.deltas.values()) {
          addDelta(change.product, change.delta)
        }
      }
      const total =
        args.kind === "production" ? 0 : roundSeptimsDown(gross - discount)
      details = {
        actorCharacterId: character._id,
        actorName: character.name,
        actorUserId: transaction.actorUserId ?? String(user._id),
        ...(comment ? { comment } : {}),
        ...(counterparty ? { counterparty } : {}),
        ...(discount > 0 ? { discount } : {}),
        financial: isFinancialTransaction({ kind: args.kind }),
        kind: args.kind,
        ...(transaction.legacyKey ? { legacyKey: transaction.legacyKey } : {}),
        occurredAt: args.occurredAt,
        productId: product._id,
        productName: product.name,
        quantity: args.quantity,
        source: transaction.source,
        total,
        unitPrice,
      }
    }

    for (const { product } of newDeltas.values()) {
      if (!states.has(product._id)) {
        states.set(product._id, {
          baseStock: product.currentStock,
          product,
        })
      }
    }
    const inventoryChanges = []
    for (const state of states.values()) {
      const delta = newDeltas.get(state.product._id)?.delta ?? 0
      if (state.baseStock + delta < 0) {
        throw new ConvexError({
          code: "INSUFFICIENT_STOCK",
          message: `Stock insuffisant pour « ${state.product.name} » : ${state.baseStock} disponibles après correction.`,
        })
      }
    }

    const oldLines = await ctx.db
      .query("transactionLines")
      .withIndex("by_transaction", (index) =>
        index.eq("transactionId", transaction._id)
      )
      .collect()
    await Promise.all([
      ...oldLines.map((line) => ctx.db.delete(line._id)),
      ...oldMovements.map((movement) => ctx.db.delete(movement._id)),
    ])
    details.searchText = buildTransactionSearchText(details)
    await ctx.db.replace(transaction._id, details)
    await Promise.all(
      preparedLines.map((line) =>
        ctx.db.insert("transactionLines", {
          ...(line.bundleId ? { bundleId: line.bundleId } : {}),
          kind: line.kind,
          ...(line.productId ? { productId: line.productId } : {}),
          productName: line.productName,
          quantity: line.quantity,
          total: line.total,
          transactionId: transaction._id,
          unitPrice: line.unitPrice,
        })
      )
    )

    for (const state of states.values()) {
      const delta = newDeltas.get(state.product._id)?.delta ?? 0
      const resultingStock = state.baseStock + delta
      await ctx.db.patch(state.product._id, { currentStock: resultingStock })
      inventoryChanges.push({
        after: { ...state.product, currentStock: resultingStock },
        before: state.product,
      })
      if (delta !== 0) {
        await ctx.db.insert("stockMovements", {
          delta,
          occurredAt: args.occurredAt,
          previousStock: state.baseStock,
          productId: state.product._id,
          reason: args.kind,
          resultingStock,
          transactionId: transaction._id,
        })
      }
    }
    await applyInventoryProductChanges(ctx, inventoryChanges)
    await ctx.db.insert("auditLogs", {
      action: "transaction.updated",
      actorUserId: String(user._id),
      createdAt: Date.now(),
      detail: `${transaction.kind}->${args.kind}:${transaction.total}->${details.total}`,
      entityId: transaction._id,
      entityType: "transaction",
    })
    await applyJournalBalanceChange(ctx, transaction, details)
    return { total: details.total, transactionId: transaction._id }
  },
})
