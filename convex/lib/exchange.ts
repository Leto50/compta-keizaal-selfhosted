import { ConvexError, type Infer, v } from "convex/values"

import { type Doc, type Id } from "../_generated/dataModel"
import { type MutationCtx } from "../_generated/server"
import {
  assertFiniteRange,
  assertWholeNumberRange,
  roundSeptimsDown,
} from "./numbers"

export const MAX_EXCHANGE_LINES = 50
export const MAX_EXCHANGE_PRICE = 1_000_000_000
export const MAX_EXCHANGE_QUANTITY = 1_000_000

const directionValidator = v.union(v.literal("incoming"), v.literal("outgoing"))

export const exchangeLineValidator = v.union(
  v.object({
    direction: directionValidator,
    kind: v.literal("product"),
    productId: v.id("products"),
    quantity: v.number(),
    unitPrice: v.optional(v.number()),
  }),
  v.object({
    bundleId: v.id("bundles"),
    direction: v.literal("outgoing"),
    kind: v.literal("bundle"),
    quantity: v.number(),
    unitPrice: v.optional(v.number()),
  })
)

export type ExchangeLineInput = Infer<typeof exchangeLineValidator>
export type ExchangeDirection = ExchangeLineInput["direction"]

export interface PreparedExchangeLine {
  bundleId?: Id<"bundles">
  direction: ExchangeDirection
  kind: "bundle" | "product"
  productId?: Id<"products">
  productName: string
  quantity: number
  total: number
  unitPrice: number
}

export interface PreparedExchangeDelta {
  delta: number
  product: Doc<"products">
}

export interface TransactionStockState {
  baseStock: number
  product: Doc<"products">
}

export interface PreparedExchange {
  deltas: Map<string, PreparedExchangeDelta>
  incomingTotal: number
  kind: "exchange" | "purchase" | "sale"
  lines: PreparedExchangeLine[]
  outgoingTotal: number
  total: number
}

interface PrepareExchangeOptions {
  baseStocks?: ReadonlyMap<string, number>
  discount?: number
}

function addDelta(
  deltas: Map<string, PreparedExchangeDelta>,
  product: Doc<"products">,
  delta: number
): void {
  const current = deltas.get(product._id)
  deltas.set(product._id, {
    delta: (current?.delta ?? 0) + delta,
    product,
  })
}

export async function loadStockBeforeTransaction(
  ctx: MutationCtx,
  transactionId: Id<"transactions">
) {
  const movements = await ctx.db
    .query("stockMovements")
    .withIndex("by_transaction", (index) =>
      index.eq("transactionId", transactionId)
    )
    .collect()
  const oldDeltas = new Map<string, number>()
  for (const movement of movements) {
    oldDeltas.set(
      movement.productId,
      (oldDeltas.get(movement.productId) ?? 0) + movement.delta
    )
  }

  const states = new Map<string, TransactionStockState>()
  await Promise.all(
    [...oldDeltas].map(async ([productId, oldDelta]) => {
      const product = await ctx.db.get(productId as Id<"products">)
      if (!product) {
        throw new ConvexError({
          code: "NOT_FOUND",
          message: "Un produit lié à l’opération est introuvable.",
        })
      }
      states.set(product._id, {
        baseStock: product.currentStock - oldDelta,
        product,
      })
    })
  )
  return { movements, states }
}

export async function prepareExchange(
  ctx: MutationCtx,
  lines: readonly ExchangeLineInput[],
  options: Readonly<PrepareExchangeOptions> = {}
): Promise<PreparedExchange> {
  if (lines.length === 0 || lines.length > MAX_EXCHANGE_LINES) {
    throw new ConvexError({
      code: "INVALID_INPUT",
      message: `Un échange doit contenir entre 1 et ${MAX_EXCHANGE_LINES} lignes.`,
    })
  }

  const discount = options.discount ?? 0
  assertFiniteRange(discount, 0, MAX_EXCHANGE_PRICE, "La remise")
  const references = new Set<string>()
  const preparedLines: PreparedExchangeLine[] = []
  const deltas = new Map<string, PreparedExchangeDelta>()

  for (const line of lines) {
    assertWholeNumberRange(
      line.quantity,
      1,
      MAX_EXCHANGE_QUANTITY,
      "La quantité"
    )
    const referenceId = line.kind === "product" ? line.productId : line.bundleId
    const referenceKey = `${line.direction}:${line.kind}:${referenceId}`
    if (references.has(referenceKey)) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message:
          "Une référence ne peut apparaître qu’une fois dans le même sens.",
      })
    }
    references.add(referenceKey)

    if (line.kind === "product") {
      const product = await ctx.db.get(line.productId)
      if (!product?.active) {
        throw new ConvexError({
          code: "NOT_FOUND",
          message: "Un produit de l’échange est introuvable ou archivé.",
        })
      }
      if (line.direction === "incoming" && !product.tracksStock) {
        throw new ConvexError({
          code: "INVALID_OPERATION",
          message: "Un service ne peut pas être acheté par la boutique.",
        })
      }
      const fallbackPrice =
        line.direction === "incoming"
          ? product.purchasePrice
          : product.salePrice
      const unitPrice = line.unitPrice ?? fallbackPrice ?? 0
      assertFiniteRange(unitPrice, 0, MAX_EXCHANGE_PRICE, "Le prix")
      preparedLines.push({
        direction: line.direction,
        kind: "product",
        productId: product._id,
        productName: product.name,
        quantity: line.quantity,
        total: line.quantity * unitPrice,
        unitPrice,
      })
      if (product.tracksStock) {
        addDelta(
          deltas,
          product,
          line.direction === "incoming" ? line.quantity : -line.quantity
        )
      }
      continue
    }

    const bundle = await ctx.db.get(line.bundleId)
    if (!bundle?.active) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Un lot de l’échange est introuvable ou archivé.",
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
        MAX_EXCHANGE_QUANTITY,
        "La quantité du lot"
      )
      addDelta(deltas, product, -(item.quantity * line.quantity))
    }
    const unitPrice = line.unitPrice ?? bundle.price ?? 0
    assertFiniteRange(unitPrice, 0, MAX_EXCHANGE_PRICE, "Le prix")
    preparedLines.push({
      bundleId: bundle._id,
      direction: "outgoing",
      kind: "bundle",
      productName: bundle.name,
      quantity: line.quantity,
      total: line.quantity * unitPrice,
      unitPrice,
    })
  }

  for (const { delta, product } of deltas.values()) {
    const baseStock =
      options.baseStocks?.get(product._id) ?? product.currentStock
    if (baseStock + delta < 0) {
      throw new ConvexError({
        code: "INSUFFICIENT_STOCK",
        message: `Stock insuffisant pour « ${product.name} » : ${baseStock} disponibles.`,
      })
    }
  }

  const outgoingGross = preparedLines
    .filter((line) => line.direction === "outgoing")
    .reduce((sum, line) => sum + line.total, 0)
  const incomingGross = preparedLines
    .filter((line) => line.direction === "incoming")
    .reduce((sum, line) => sum + line.total, 0)
  if (discount > outgoingGross) {
    throw new ConvexError({
      code: "INVALID_INPUT",
      message: "La remise ne peut pas dépasser les ventes du panier.",
    })
  }
  const outgoingTotal = roundSeptimsDown(outgoingGross - discount)
  const incomingTotal = roundSeptimsDown(incomingGross)
  const hasOutgoing = preparedLines.some(
    (line) => line.direction === "outgoing"
  )
  const hasIncoming = preparedLines.some(
    (line) => line.direction === "incoming"
  )

  return {
    deltas,
    incomingTotal,
    kind:
      hasOutgoing && hasIncoming
        ? "exchange"
        : hasIncoming
          ? "purchase"
          : "sale",
    lines: preparedLines,
    outgoingTotal,
    total: outgoingTotal - incomingTotal,
  }
}
