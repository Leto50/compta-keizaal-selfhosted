import { startOfUtcDay } from "./time"

export interface AttentionOrder {
  dueAt?: number
  kind: "client" | "supplier"
  status: "cancelled" | "delivered" | "open" | "ready"
  transactionId?: unknown
}

export function orderNeedsAttention(order: AttentionOrder): boolean {
  if (order.status === "cancelled") return false
  if (order.status === "open" || order.status === "ready") return true
  return order.transactionId === undefined
}

export function orderIsHistorical(order: AttentionOrder): boolean {
  return !orderNeedsAttention(order)
}

export function orderIsOverdue(
  order: AttentionOrder,
  now = Date.now()
): boolean {
  return (
    orderNeedsAttention(order) &&
    order.dueAt !== undefined &&
    order.dueAt < startOfUtcDay(now)
  )
}

export function summarizeOrderAttention(
  orders: readonly AttentionOrder[],
  now = Date.now()
) {
  const actionable = orders.filter(orderNeedsAttention)
  return {
    client: actionable.filter((order) => order.kind === "client").length,
    overdue: actionable.filter((order) => orderIsOverdue(order, now)).length,
    supplier: actionable.filter((order) => order.kind === "supplier").length,
    total: actionable.length,
  }
}
