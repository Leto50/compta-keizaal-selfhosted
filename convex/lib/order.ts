import { type Doc } from "../_generated/dataModel"
import { type QueryCtx } from "../_generated/server"
import { type PreparedExchange } from "./exchange"

export async function loadOrdersNeedingAttention(ctx: QueryCtx) {
  const [openOrders, readyOrders, unpaidDeliveredOrders] = await Promise.all([
    ctx.db
      .query("orders")
      .withIndex("by_status", (index) => index.eq("status", "open"))
      .collect(),
    ctx.db
      .query("orders")
      .withIndex("by_status", (index) => index.eq("status", "ready"))
      .collect(),
    ctx.db
      .query("orders")
      .withIndex("by_status", (index) => index.eq("status", "delivered"))
      .filter((filter) => filter.eq(filter.field("transactionId"), undefined))
      .collect(),
  ])

  return [...openOrders, ...readyOrders, ...unpaidDeliveredOrders]
}

export function orderTransactionLabel(
  kind: Doc<"orders">["kind"],
  contactName: string
): string {
  return kind === "client"
    ? `Commande de ${contactName}`
    : `Commande auprès de ${contactName}`
}

export function withOrderTotal(
  prepared: PreparedExchange,
  kind: Doc<"orders">["kind"],
  total: number
): PreparedExchange {
  return {
    ...prepared,
    incomingTotal: kind === "supplier" ? total : 0,
    outgoingTotal: kind === "client" ? total : 0,
    total: kind === "client" ? total : -total,
  }
}
