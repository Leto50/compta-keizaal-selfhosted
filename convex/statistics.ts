import { paginationOptsValidator } from "convex/server"
import { ConvexError, v } from "convex/values"
import { query, type QueryCtx } from "./_generated/server"
import { type Doc } from "./_generated/dataModel"
import { requireReadAccess } from "./lib/auth"
import { isFinancialTransaction, transactionFlows } from "./lib/accountSummary"
import { orderIsVisible, transactionIsVisible } from "./lib/readerAccess"
import {
  loadTransactionScope,
  scopeProductsAreVisible,
} from "./lib/transactionScopes"
import { redactReaderData, type ReaderAccess } from "../shared/reader-access"
import { calculateHarvestValue } from "../shared/harvest-value"
import {
  summarizeStatistics,
  summarizeStatisticsOrders,
  type StatisticsEvent,
  type StatisticsProduct,
} from "../shared/statistics"

const rangeArgs = { from: v.optional(v.number()), to: v.optional(v.number()) }

function assertRange(from: number | undefined, to: number | undefined) {
  if (
    [from, to].some(
      (value) =>
        value !== undefined &&
        (!Number.isSafeInteger(value) ||
          Math.abs(value) > 8_640_000_000_000_000)
    ) ||
    (from !== undefined && to !== undefined && from >= to)
  ) {
    throw new ConvexError({
      code: "INVALID_INPUT",
      message: "La période sélectionnée est invalide.",
    })
  }
}

function canReadDomain(
  access: ReaderAccess | null,
  ...sections: ("transactions" | "account" | "harvests" | "orders")[]
) {
  return (
    !access || sections.some((section) => access.sections.includes(section))
  )
}

async function isVisible(
  ctx: QueryCtx,
  access: ReaderAccess | null,
  transaction: Doc<"transactions">
) {
  if (transaction.kind === "harvest") {
    if (!canReadDomain(access, "harvests")) return false
    if (!access?.productIds) return true
    return scopeProductsAreVisible(
      ctx,
      access,
      await loadTransactionScope(ctx, transaction)
    )
  }
  if (!isFinancialTransaction(transaction)) return !access
  return (
    canReadDomain(access, "transactions", "account") &&
    transactionIsVisible(ctx, access, transaction)
  )
}

async function statisticsEvent(
  ctx: QueryCtx,
  transaction: Doc<"transactions">
): Promise<StatisticsEvent> {
  const financial = isFinancialTransaction(transaction)
  const flows = financial
    ? transactionFlows(transaction)
    : { incoming: 0, outgoing: 0 }
  const storedLines = await ctx.db
    .query("transactionLines")
    .withIndex("by_transaction", (index) =>
      index.eq("transactionId", transaction._id)
    )
    .collect()
  const lines: Pick<
    Doc<"transactionLines">,
    | "productId"
    | "bundleId"
    | "productName"
    | "quantity"
    | "total"
    | "direction"
    | "purchaseUnitPrice"
  >[] = [...storedLines]
  // A historical description may contain a contact's name. Only catalog references
  // and their recorded lines can contribute to product statistics.
  if (
    !lines.length &&
    transaction.productId &&
    !transaction.orderId &&
    transaction.kind !== "exchange" &&
    transaction.kind !== "adjustment" &&
    (transaction.lineCount ?? 1) === 1
  ) {
    const product = await ctx.db.get(transaction.productId)
    if (product)
      lines.push({
        productId: product._id,
        productName: product.name,
        quantity: transaction.quantity,
        total: Math.abs(transaction.total),
      })
  }
  const direction = (line: (typeof lines)[number]) => {
    if (line.direction) return line.direction
    if (transaction.kind === "purchase") return "incoming"
    if (transaction.kind === "order")
      return transaction.total > 0
        ? "outgoing"
        : transaction.total < 0
          ? "incoming"
          : undefined
    if (transaction.kind === "exchange") return undefined
    return "outgoing"
  }
  const incompleteFlowCount =
    transaction.kind === "exchange" &&
    (transaction.incomingTotal === undefined ||
      transaction.outgoingTotal === undefined)
      ? 1
      : 0
  const ambiguousDirections =
    financial && lines.some((line) => direction(line) === undefined)
  const saleGross = lines
    .filter((line) => direction(line) === "outgoing")
    .reduce((sum, line) => sum + Math.abs(line.total), 0)
  const purchaseGross = lines
    .filter((line) => direction(line) === "incoming")
    .reduce((sum, line) => sum + Math.abs(line.total), 0)
  const usableLines =
    transaction.kind === "adjustment" || ambiguousDirections
      ? []
      : lines.filter(
          (line) => line.productId !== undefined || line.bundleId !== undefined
        )
  const products: StatisticsProduct[] = usableLines.map((line) => {
    const sale = financial && direction(line) === "outgoing"
    const purchase = financial && direction(line) === "incoming"
    return {
      key: line.bundleId
        ? `bundle:${line.bundleId}`
        : `product:${line.productId!}`,
      name: line.productName,
      sold: sale ? line.quantity : 0,
      purchased: purchase ? line.quantity : 0,
      harvested: transaction.kind === "harvest" ? line.quantity : 0,
      produced: transaction.kind === "production" ? line.quantity : 0,
      incoming:
        sale && !incompleteFlowCount && saleGross > 0
          ? (flows.incoming * Math.abs(line.total)) / saleGross
          : 0,
      outgoing:
        purchase && !incompleteFlowCount && purchaseGross > 0
          ? (flows.outgoing * Math.abs(line.total)) / purchaseGross
          : 0,
    }
  })
  const harvestLineCount =
    transaction.kind === "harvest"
      ? storedLines.length > 0
        ? storedLines.length
        : Math.max(transaction.lineCount ?? 1, 1)
      : 0
  const harvest =
    transaction.kind === "harvest"
      ? storedLines.length
        ? calculateHarvestValue(storedLines)
        : { knownValue: 0, unpricedLineCount: harvestLineCount }
      : { knownValue: 0, unpricedLineCount: 0 }
  const unmatched = (total: number, attributed: number) =>
    Math.abs(total - attributed) <=
    Math.max(1e-9, Math.abs(total) * Number.EPSILON * 100)
      ? 0
      : Math.max(0, total - attributed)
  const unattributedIncoming = unmatched(
    flows.incoming,
    products.reduce((sum, product) => sum + product.incoming, 0)
  )
  const unattributedOutgoing = unmatched(
    flows.outgoing,
    products.reduce((sum, product) => sum + product.outgoing, 0)
  )
  return {
    occurredAt: transaction.occurredAt,
    kind: financial && transaction.orderId ? "order" : transaction.kind,
    financial,
    ...flows,
    quantity: transaction.quantity,
    ...harvest,
    products,
    harvestLineCount,
    orderCount:
      financial && (transaction.orderId || transaction.kind === "order")
        ? 1
        : 0,
    incompleteFlowCount,
    unattributedIncoming,
    unattributedOutgoing,
    unattributedCount:
      transaction.kind !== "adjustment" &&
      (!usableLines.length ||
        usableLines.length !== lines.length ||
        unattributedIncoming > 0 ||
        unattributedOutgoing > 0)
        ? 1
        : 0,
  }
}

export const transactionsPage = query({
  args: { ...rangeArgs, paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const { access } = await requireReadAccess(ctx, "statistics")
    assertRange(args.from, args.to)
    const result = await ctx.db
      .query("transactions")
      .withIndex("by_occurred_at", (index) => {
        const lower =
          args.from === undefined ? index : index.gte("occurredAt", args.from)
        return args.to === undefined ? lower : lower.lt("occurredAt", args.to)
      })
      .order("asc")
      .paginate({
        ...args.paginationOpts,
        numItems: Math.min(
          40,
          Math.max(1, Math.round(args.paginationOpts.numItems))
        ),
      })
    const events: StatisticsEvent[] = []
    for (const transaction of result.page) {
      if (await isVisible(ctx, access, transaction))
        events.push(await statisticsEvent(ctx, transaction))
    }
    // Aggregate each bounded page before returning it; no people, contacts or comments leave this endpoint.
    return redactReaderData(
      { ...result, page: [summarizeStatistics(events)] },
      access
    )
  },
})

export const ordersPage = query({
  args: { todayStartsAt: v.number(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const { access } = await requireReadAccess(ctx, "statistics")
    if (!canReadDomain(access, "orders"))
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Votre accès ne permet pas de consulter les commandes.",
      })
    assertRange(args.todayStartsAt, undefined)
    // Orders store only their current status. An import timestamp cannot supply
    // a historical order cohort or reconstruct past payments and deliveries.
    const result = await ctx.db
      .query("orders")
      .withIndex("by_creation_time")
      .order("asc")
      .paginate({
        ...args.paginationOpts,
        numItems: Math.min(
          40,
          Math.max(1, Math.round(args.paginationOpts.numItems))
        ),
      })
    const visible: Doc<"orders">[] = []
    for (const order of result.page)
      if (await orderIsVisible(ctx, access, order)) visible.push(order)
    return redactReaderData(
      {
        ...result,
        page: summarizeStatisticsOrders(visible, args.todayStartsAt),
      },
      access
    )
  },
})
