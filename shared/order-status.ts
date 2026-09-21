export type OrderKind = "client" | "supplier"
export type OrderStatus = "cancelled" | "delivered" | "open" | "ready"

export const clientOrderStatuses: readonly OrderStatus[] = [
  "open",
  "ready",
  "delivered",
  "cancelled",
]

export const supplierOrderStatuses: readonly OrderStatus[] = [
  "open",
  "delivered",
  "cancelled",
]

export function orderStatusesForKind(kind: OrderKind): readonly OrderStatus[] {
  return kind === "client" ? clientOrderStatuses : supplierOrderStatuses
}

export function normalizeOrderStatus(
  kind: OrderKind,
  status: OrderStatus
): OrderStatus {
  return kind === "supplier" && status === "ready" ? "open" : status
}
