import { ConvexError, type Infer, v } from "convex/values"
import { paginationOptsValidator } from "convex/server"

import { type Doc, type Id } from "./_generated/dataModel"
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server"
import { requireUser } from "./lib/auth"
import {
  type exchangeLineValidator,
  loadStockBeforeTransaction,
  prepareExchange,
} from "./lib/exchange"
import {
  assertFiniteRange,
  assertWholeNumberRange,
  roundSeptimsDown,
} from "./lib/numbers"
import { resolveOrderContact } from "./lib/contacts"
import {
  loadOrdersNeedingAttention,
  orderTransactionLabel,
  withOrderTotal,
} from "./lib/order"
import { buildTransactionSearchText } from "./lib/transactionSearch"
import { applyJournalBalanceChange } from "./lib/journalSummary"
import { applyInventoryProductChanges } from "./lib/inventorySummary"
import { orderKind, orderStatus } from "./lib/validators"
import { orderStatusesForKind } from "../shared/order-status"

const MAX_CONTACT_NAME_LENGTH = 100
const MAX_LINES = 50
const MAX_NOTES_LENGTH = 1_000
const MAX_PRICE = 1_000_000_000
const MAX_QUANTITY = 1_000_000

const auditDateFormatter = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "medium",
  timeZone: "Europe/Paris",
})

interface OrderLineForExchange {
  bundleId?: Id<"bundles">
  kind?: "bundle" | "product"
  productId?: Id<"products">
  productName: string
  quantity: number
  unitPrice?: number
}

interface LinkedTransactionCorrection {
  actorCharacterId: Id<"characters">
  actorName: string
  occurredAt: number
}

function orderTransactionCorrectionDetail(
  contactName: string,
  transaction: Doc<"transactions">,
  character: Doc<"characters">,
  occurredAt: number
): string {
  const changes: string[] = []
  if (transaction.actorName !== character.name) {
    changes.push(
      `personne : « ${transaction.actorName} » → « ${character.name} »`
    )
  }
  if (transaction.occurredAt !== occurredAt) {
    changes.push(
      `date : ${auditDateFormatter.format(new Date(transaction.occurredAt))} → ${auditDateFormatter.format(new Date(occurredAt))}`
    )
  }
  return [contactName, ...changes].join(" · ")
}

function exchangeLinesFromOrder(
  kind: Doc<"orders">["kind"],
  lines: readonly OrderLineForExchange[]
): Array<Infer<typeof exchangeLineValidator>> {
  const direction = kind === "client" ? "outgoing" : "incoming"
  return lines.map((line) => {
    if (line.unitPrice === undefined) {
      throw new ConvexError({
        code: "ORDER_PRICE_REQUIRED",
        message:
          "Renseignez le prix de chaque ligne avant de traiter la commande.",
      })
    }
    if (line.kind === "bundle") {
      if (direction === "incoming" || !line.bundleId) {
        throw new ConvexError({
          code: "INVALID_OPERATION",
          message: "Une commande fournisseur ne peut pas recevoir un lot.",
        })
      }
      return {
        bundleId: line.bundleId,
        direction: "outgoing",
        kind: "bundle",
        quantity: line.quantity,
        unitPrice: line.unitPrice,
      }
    }
    if (!line.productId) {
      throw new ConvexError({
        code: "UNLINKED_ORDER_LINE",
        message: `La référence « ${line.productName} » doit être reliée à un produit avant de traiter la commande.`,
      })
    }
    return {
      direction,
      kind: "product",
      productId: line.productId,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
    }
  })
}

async function synchronizeLinkedTransaction(
  ctx: MutationCtx,
  transaction: Doc<"transactions">,
  orderId: Id<"orders">,
  orderKind: Doc<"orders">["kind"],
  contactName: string,
  exchangeLines: readonly Infer<typeof exchangeLineValidator>[],
  total: number,
  correction?: LinkedTransactionCorrection
) {
  const { movements, states } = await loadStockBeforeTransaction(
    ctx,
    transaction._id
  )
  const baseStocks = new Map(
    [...states].map(([productId, state]) => [productId, state.baseStock])
  )
  const prepared = withOrderTotal(
    await prepareExchange(ctx, exchangeLines, { baseStocks }),
    orderKind,
    total
  )
  const oldLines = await ctx.db
    .query("transactionLines")
    .withIndex("by_transaction", (index) =>
      index.eq("transactionId", transaction._id)
    )
    .collect()
  const stockIds = new Set([...states.keys(), ...prepared.deltas.keys()])

  await Promise.all([
    ...oldLines.map((line) => ctx.db.delete(line._id)),
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

  const firstLine = prepared.lines[0]
  const occurredAt = correction?.occurredAt ?? transaction.occurredAt
  const actorName = correction?.actorName ?? transaction.actorName
  const productName = orderTransactionLabel(orderKind, contactName)
  const updatedTransaction = {
    ...((correction?.actorCharacterId ?? transaction.actorCharacterId)
      ? {
          actorCharacterId:
            correction?.actorCharacterId ?? transaction.actorCharacterId,
        }
      : {}),
    actorName,
    ...(transaction.actorUserId
      ? { actorUserId: transaction.actorUserId }
      : {}),
    ...(transaction.comment ? { comment: transaction.comment } : {}),
    counterparty: contactName,
    financial: true,
    incomingTotal: prepared.incomingTotal,
    kind: prepared.kind,
    ...(transaction.legacyKey ? { legacyKey: transaction.legacyKey } : {}),
    lineCount: prepared.lines.length,
    occurredAt,
    orderId,
    outgoingTotal: prepared.outgoingTotal,
    ...(prepared.lines.length === 1 && firstLine?.productId
      ? { productId: firstLine.productId }
      : {}),
    productName,
    quantity: prepared.lines.reduce((sum, line) => sum + line.quantity, 0),
    searchText: buildTransactionSearchText({
      actorName,
      comment: transaction.comment,
      counterparty: contactName,
      productName,
    }),
    source: transaction.source,
    total: prepared.total,
    ...(prepared.lines.length === 1 && firstLine
      ? { unitPrice: firstLine.unitPrice }
      : {}),
  }
  await ctx.db.replace(transaction._id, updatedTransaction)
  await applyJournalBalanceChange(ctx, transaction, updatedTransaction)
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
  for (const { delta, product } of prepared.deltas.values()) {
    const baseStock = states.get(product._id)?.baseStock ?? product.currentStock
    const resultingStock = baseStock + delta
    await ctx.db.insert("stockMovements", {
      delta,
      occurredAt,
      previousStock: baseStock,
      productId: product._id,
      reason: prepared.kind,
      resultingStock,
      transactionId: transaction._id,
    })
  }
  return prepared
}

async function withOrderDetails(ctx: QueryCtx, order: Doc<"orders">) {
  const [lines, linkedTransaction] = await Promise.all([
    ctx.db
      .query("orderLines")
      .withIndex("by_order", (index) => index.eq("orderId", order._id))
      .collect(),
    order.transactionId ? ctx.db.get(order.transactionId) : null,
  ])
  return { ...order, lines, linkedTransaction }
}

export const getById = query({
  args: {
    orderId: v.id("orders"),
  },
  handler: async (ctx, args) => {
    await requireUser(ctx)
    const order = await ctx.db.get(args.orderId)
    return order ? withOrderDetails(ctx, order) : null
  },
})

export const listAttention = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx)
    const orders = await loadOrdersNeedingAttention(ctx)
    const withLines = await Promise.all(
      orders.map((order) => withOrderDetails(ctx, order))
    )

    return withLines.sort((left, right) => {
      if (left.status !== right.status) return left.status === "open" ? -1 : 1
      return (
        (left.dueAt ?? Number.MAX_SAFE_INTEGER) -
        (right.dueAt ?? Number.MAX_SAFE_INTEGER)
      )
    })
  },
})

export const listHistoryPage = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    await requireUser(ctx)
    const result = await ctx.db
      .query("orders")
      .order("desc")
      .filter((filter) =>
        filter.or(
          filter.eq(filter.field("status"), "cancelled"),
          filter.and(
            filter.eq(filter.field("status"), "delivered"),
            filter.neq(filter.field("transactionId"), undefined)
          )
        )
      )
      .paginate(args.paginationOpts)

    return {
      ...result,
      page: await Promise.all(
        result.page.map((order) => withOrderDetails(ctx, order))
      ),
    }
  },
})

export const save = mutation({
  args: {
    actorCharacterId: v.optional(v.id("characters")),
    contactId: v.optional(v.id("contacts")),
    contactName: v.string(),
    dueAt: v.union(v.number(), v.null()),
    kind: orderKind,
    lines: v.array(
      v.object({
        productId: v.id("products"),
        quantity: v.number(),
        unitPrice: v.union(v.number(), v.null()),
      })
    ),
    notes: v.string(),
    orderId: v.optional(v.id("orders")),
    processedAt: v.optional(v.number()),
    status: orderStatus,
    total: v.union(v.number(), v.null()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    if (!orderStatusesForKind(args.kind).includes(args.status)) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Cet état n’existe pas pour une commande fournisseur.",
      })
    }
    const submittedContactName = args.contactName.trim()
    const notes = args.notes.trim()
    if (
      !submittedContactName ||
      submittedContactName.length > MAX_CONTACT_NAME_LENGTH
    ) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: `Le nom du contact doit contenir entre 1 et ${MAX_CONTACT_NAME_LENGTH} caractères.`,
      })
    }
    if (notes.length > MAX_NOTES_LENGTH) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Les notes sont trop longues.",
      })
    }
    if (args.dueAt !== null) {
      assertFiniteRange(
        args.dueAt,
        0,
        Number.MAX_SAFE_INTEGER,
        "La date prévue"
      )
    }
    if (args.lines.length === 0 || args.lines.length > MAX_LINES) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: `Une commande doit contenir entre 1 et ${MAX_LINES} références.`,
      })
    }

    const existing = args.orderId ? await ctx.db.get(args.orderId) : undefined
    if (args.orderId && !existing) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Commande introuvable.",
      })
    }
    const { contactId, contactName } = await resolveOrderContact(ctx, {
      ...(args.contactId ? { contactId: args.contactId } : {}),
      ...(existing ? { existingOrder: existing } : {}),
      kind: args.kind,
      name: submittedContactName,
    })
    const linkedTransaction = existing?.transactionId
      ? await ctx.db.get(existing.transactionId)
      : undefined
    if (existing?.transactionId && !linkedTransaction) {
      throw new ConvexError({
        code: "LINKED_TRANSACTION_MISSING",
        message:
          "La transaction liée à cette commande est introuvable. Aucune correction n’a été appliquée.",
      })
    }
    if (
      linkedTransaction?.orderId &&
      linkedTransaction.orderId !== existing?._id
    ) {
      throw new ConvexError({
        code: "INVALID_LINKED_TRANSACTION",
        message: "La transaction est liée à une autre commande.",
      })
    }
    if (
      !linkedTransaction &&
      (args.actorCharacterId !== undefined || args.processedAt !== undefined)
    ) {
      throw new ConvexError({
        code: "INVALID_OPERATION",
        message:
          "Le personnage et la date ne peuvent être corrigés qu’après le traitement de la commande.",
      })
    }
    if (
      linkedTransaction &&
      (args.actorCharacterId === undefined) !== (args.processedAt === undefined)
    ) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message:
          "Le personnage et la date de la transaction doivent être corrigés ensemble.",
      })
    }
    if (args.processedAt !== undefined) {
      assertFiniteRange(
        args.processedAt,
        0,
        Date.now() + 86_400_000,
        "La date de transaction"
      )
    }
    const correctedCharacter = args.actorCharacterId
      ? await ctx.db.get(args.actorCharacterId)
      : undefined
    if (args.actorCharacterId && !correctedCharacter?.active) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Personnage introuvable ou archivé.",
      })
    }

    const seenProducts = new Set<string>()
    const preparedLines = await Promise.all(
      args.lines.map(async (line) => {
        assertWholeNumberRange(line.quantity, 1, MAX_QUANTITY, "La quantité")
        if (seenProducts.has(line.productId)) {
          throw new ConvexError({
            code: "INVALID_INPUT",
            message: "Une référence ne peut apparaître qu’une fois.",
          })
        }
        seenProducts.add(line.productId)
        const product = await ctx.db.get(line.productId)
        if (!product?.active) {
          throw new ConvexError({
            code: "NOT_FOUND",
            message: "Une référence est introuvable ou indisponible.",
          })
        }
        if (args.kind === "supplier" && !product.tracksStock) {
          throw new ConvexError({
            code: "INVALID_OPERATION",
            message:
              "Une commande fournisseur ne peut pas contenir un service.",
          })
        }
        if (line.unitPrice !== null) {
          assertFiniteRange(line.unitPrice, 0, MAX_PRICE, "Le prix")
        }
        return {
          productId: product._id,
          productName: product.name,
          quantity: line.quantity,
          ...(line.unitPrice === null
            ? {}
            : {
                total: line.unitPrice * line.quantity,
                unitPrice: line.unitPrice,
              }),
        }
      })
    )

    const pricedLines = preparedLines.filter(
      (
        line
      ): line is typeof line & {
        total: number
        unitPrice: number
      } => line.total !== undefined
    )
    const gross = pricedLines.reduce((sum, line) => sum + line.total, 0)
    if (args.total !== null) {
      assertWholeNumberRange(args.total, 0, MAX_PRICE, "Le total convenu")
    }
    const automaticTotal =
      pricedLines.length === preparedLines.length
        ? roundSeptimsDown(gross)
        : undefined
    const total = args.total ?? automaticTotal
    const details = {
      contactId,
      contactName,
      ...(args.dueAt === null ? {} : { dueAt: args.dueAt }),
      kind: args.kind,
      ...(existing?.legacyKey ? { legacyKey: existing.legacyKey } : {}),
      ...(notes ? { notes } : {}),
      ...(existing?.processedAt === undefined && args.processedAt === undefined
        ? {}
        : { processedAt: args.processedAt ?? existing?.processedAt }),
      status: args.status,
      ...(total === undefined ? {} : { total }),
      ...(existing?.transactionId
        ? { transactionId: existing.transactionId }
        : {}),
    }
    let orderId: Id<"orders">
    if (existing) {
      await ctx.db.replace(existing._id, details)
      orderId = existing._id
      const oldLines = await ctx.db
        .query("orderLines")
        .withIndex("by_order", (index) => index.eq("orderId", orderId))
        .collect()
      await Promise.all(oldLines.map((line) => ctx.db.delete(line._id)))
    } else {
      orderId = await ctx.db.insert("orders", details)
    }

    await Promise.all(
      preparedLines.map((line) =>
        ctx.db.insert("orderLines", { orderId, ...line })
      )
    )
    let synchronizedTotal: number | undefined
    if (linkedTransaction) {
      if (total === undefined) {
        throw new ConvexError({
          code: "ORDER_PRICE_REQUIRED",
          message:
            "Renseignez le total convenu avant de corriger cette commande.",
        })
      }
      const exchangeLines = exchangeLinesFromOrder(args.kind, preparedLines)
      const synchronized = await synchronizeLinkedTransaction(
        ctx,
        linkedTransaction,
        orderId,
        args.kind,
        contactName,
        exchangeLines,
        total,
        correctedCharacter && args.processedAt !== undefined
          ? {
              actorCharacterId: correctedCharacter._id,
              actorName: correctedCharacter.name,
              occurredAt: args.processedAt,
            }
          : undefined
      )
      synchronizedTotal = synchronized.total
    }
    await ctx.db.insert("auditLogs", {
      action: existing ? "order.updated" : "order.created",
      actorUserId: String(user._id),
      createdAt: Date.now(),
      detail: `${contactName}:${preparedLines.length}${synchronizedTotal === undefined ? "" : `:${synchronizedTotal}`}`,
      entityId: orderId,
      entityType: "order",
    })
    return orderId
  },
})

export const remove = mutation({
  args: { orderId: v.id("orders") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    const order = await ctx.db.get(args.orderId)
    if (!order) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Commande introuvable.",
      })
    }
    if (order.transactionId) {
      throw new ConvexError({
        code: "ORDER_ALREADY_PROCESSED",
        message: "Supprimez d’abord la transaction liée à cette commande.",
      })
    }
    const lines = await ctx.db
      .query("orderLines")
      .withIndex("by_order", (index) => index.eq("orderId", order._id))
      .collect()
    await Promise.all(lines.map((line) => ctx.db.delete(line._id)))
    await ctx.db.delete(order._id)
    await ctx.db.insert("auditLogs", {
      action: "order.deleted",
      actorUserId: String(user._id),
      createdAt: Date.now(),
      detail: order.contactName,
      entityId: order._id,
      entityType: "order",
    })
  },
})

export const updateStatus = mutation({
  args: {
    orderId: v.id("orders"),
    status: orderStatus,
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    const order = await ctx.db.get(args.orderId)
    if (!order) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Commande introuvable.",
      })
    }

    if (!orderStatusesForKind(order.kind).includes(args.status)) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Cet état n’existe pas pour une commande fournisseur.",
      })
    }

    await ctx.db.patch(order._id, { status: args.status })
    await ctx.db.insert("auditLogs", {
      action: "order.status_updated",
      actorUserId: String(user._id),
      createdAt: Date.now(),
      detail: args.status,
      entityId: order._id,
      entityType: "order",
    })
  },
})

export const process = mutation({
  args: {
    characterId: v.id("characters"),
    occurredAt: v.number(),
    orderId: v.id("orders"),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    const [order, character] = await Promise.all([
      ctx.db.get(args.orderId),
      ctx.db.get(args.characterId),
    ])
    if (!order) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Commande introuvable.",
      })
    }
    if (!order.transactionId && order.status === "cancelled") {
      throw new ConvexError({
        code: "INVALID_OPERATION",
        message: "Une commande annulée ne peut pas être traitée.",
      })
    }
    if (!character?.active) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Personnage introuvable ou archivé.",
      })
    }
    assertFiniteRange(args.occurredAt, 0, Date.now() + 86_400_000, "La date")
    if (order.transactionId) {
      const transaction = await ctx.db.get(order.transactionId)
      if (transaction?.orderId !== order._id) {
        throw new ConvexError({
          code: "LINKED_TRANSACTION_MISSING",
          message:
            "La transaction liée à cette commande est introuvable. Aucune correction n’a été appliquée.",
        })
      }
      const movements = await ctx.db
        .query("stockMovements")
        .withIndex("by_transaction", (index) =>
          index.eq("transactionId", transaction._id)
        )
        .collect()
      const correctionDetail = orderTransactionCorrectionDetail(
        order.contactName,
        transaction,
        character,
        args.occurredAt
      )
      const updatedTransaction = {
        ...transaction,
        actorCharacterId: character._id,
        actorName: character.name,
        financial: true,
        occurredAt: args.occurredAt,
        searchText: buildTransactionSearchText({
          ...transaction,
          actorName: character.name,
        }),
      }
      await ctx.db.patch(transaction._id, {
        actorCharacterId: updatedTransaction.actorCharacterId,
        actorName: updatedTransaction.actorName,
        financial: updatedTransaction.financial,
        occurredAt: updatedTransaction.occurredAt,
        searchText: updatedTransaction.searchText,
      })
      await applyJournalBalanceChange(ctx, transaction, updatedTransaction)
      await Promise.all(
        movements.map((movement) =>
          ctx.db.patch(movement._id, { occurredAt: args.occurredAt })
        )
      )
      await ctx.db.patch(order._id, { processedAt: args.occurredAt })
      await ctx.db.insert("auditLogs", {
        action:
          order.kind === "client"
            ? "order.payment_updated"
            : "order.reception_updated",
        actorUserId: String(user._id),
        createdAt: Date.now(),
        detail: correctionDetail,
        entityId: order._id,
        entityType: "order",
      })
      return {
        total: transaction.total,
        transactionId: transaction._id,
        updated: true,
      }
    }
    const orderLines = await ctx.db
      .query("orderLines")
      .withIndex("by_order", (index) => index.eq("orderId", order._id))
      .collect()
    if (
      orderLines.length === 0 ||
      orderLines.some((line) => line.unitPrice === undefined)
    ) {
      throw new ConvexError({
        code: "ORDER_PRICE_REQUIRED",
        message:
          "Renseignez le prix de chaque ligne avant de traiter la commande.",
      })
    }
    const exchangeLines = exchangeLinesFromOrder(order.kind, orderLines)
    const preparedFromLines = await prepareExchange(ctx, exchangeLines)
    const agreedTotal = order.total ?? Math.abs(preparedFromLines.total)
    assertWholeNumberRange(agreedTotal, 0, MAX_PRICE, "Le total convenu")
    const prepared = withOrderTotal(preparedFromLines, order.kind, agreedTotal)
    const firstLine = prepared.lines[0]
    const productName = orderTransactionLabel(order.kind, order.contactName)
    const transactionDetails = {
      actorCharacterId: character._id,
      actorName: character.name,
      actorUserId: String(user._id),
      counterparty: order.contactName,
      financial: true,
      incomingTotal: prepared.incomingTotal,
      kind: prepared.kind,
      lineCount: prepared.lines.length,
      occurredAt: args.occurredAt,
      orderId: order._id,
      outgoingTotal: prepared.outgoingTotal,
      productName,
      quantity: prepared.lines.reduce((sum, line) => sum + line.quantity, 0),
      searchText: buildTransactionSearchText({
        actorName: character.name,
        counterparty: order.contactName,
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
    await ctx.db.patch(order._id, {
      processedAt: args.occurredAt,
      ...(order.kind === "supplier" ? { status: "delivered" as const } : {}),
      transactionId,
    })
    await applyJournalBalanceChange(ctx, undefined, transactionDetails)
    await ctx.db.insert("auditLogs", {
      action:
        order.kind === "client" ? "order.payment_recorded" : "order.received",
      actorUserId: String(user._id),
      createdAt: Date.now(),
      detail: `${order.contactName}:${prepared.total}`,
      entityId: order._id,
      entityType: "order",
    })

    return { total: prepared.total, transactionId, updated: false }
  },
})
