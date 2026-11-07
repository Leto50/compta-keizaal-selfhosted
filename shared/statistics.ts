import { startOfUtcDay, startOfUtcWeek, DAY_IN_MILLISECONDS } from "./time"
import {
  orderNeedsAttention,
  orderIsOverdue,
  type AttentionOrder,
} from "./order-attention"

export type StatisticsKind =
  | "adjustment"
  | "bundle"
  | "exchange"
  | "harvest"
  | "order"
  | "production"
  | "purchase"
  | "sale"
  | "service"

export interface StatisticsDay {
  startsAt: number
  incoming: number
  outgoing: number
  transactionCount: number
  financialCount: number
  harvestCount: number
  harvestQuantity: number
  harvestLineCount: number
  knownValue: number
  unpricedLineCount: number
  productionQuantity: number
  orderCount: number
  incompleteFlowCount: number
  unattributedCount: number
  unattributedIncoming: number
  unattributedOutgoing: number
}

export interface StatisticsProduct {
  key: string
  name: string
  sold: number
  purchased: number
  harvested: number
  produced: number
  incoming: number
  outgoing: number
}

export interface StatisticsBatch {
  days: StatisticsDay[]
  products: StatisticsProduct[]
  kinds: { kind: StatisticsKind; count: number }[]
}

// The statistics contract deliberately contains no person or account identifiers.
export interface StatisticsEvent {
  occurredAt: number
  kind: StatisticsKind
  financial: boolean
  incoming: number
  outgoing: number
  quantity: number
  knownValue: number
  unpricedLineCount: number
  products: StatisticsProduct[]
  orderCount?: number
  harvestLineCount?: number
  incompleteFlowCount?: number
  unattributedCount?: number
  unattributedIncoming?: number
  unattributedOutgoing?: number
}

export function emptyStatisticsDay(startsAt: number): StatisticsDay {
  return {
    startsAt,
    incoming: 0,
    outgoing: 0,
    transactionCount: 0,
    financialCount: 0,
    harvestCount: 0,
    harvestQuantity: 0,
    harvestLineCount: 0,
    knownValue: 0,
    unpricedLineCount: 0,
    productionQuantity: 0,
    orderCount: 0,
    incompleteFlowCount: 0,
    unattributedCount: 0,
    unattributedIncoming: 0,
    unattributedOutgoing: 0,
  }
}

const dayMetrics = [
  "incoming",
  "outgoing",
  "transactionCount",
  "financialCount",
  "harvestCount",
  "harvestQuantity",
  "harvestLineCount",
  "knownValue",
  "unpricedLineCount",
  "productionQuantity",
  "orderCount",
  "incompleteFlowCount",
  "unattributedCount",
  "unattributedIncoming",
  "unattributedOutgoing",
] as const

function addDay(target: StatisticsDay, source: StatisticsDay) {
  for (const metric of dayMetrics) target[metric] += source[metric]
}

export function summarizeStatistics(
  events: readonly StatisticsEvent[]
): StatisticsBatch {
  return mergeStatistics(
    events.map((event) => ({
      days: [
        {
          ...emptyStatisticsDay(startOfUtcDay(event.occurredAt)),
          incoming: event.incoming,
          outgoing: event.outgoing,
          transactionCount: 1,
          financialCount: event.financial ? 1 : 0,
          harvestCount: event.kind === "harvest" ? 1 : 0,
          harvestQuantity: event.kind === "harvest" ? event.quantity : 0,
          harvestLineCount: event.harvestLineCount ?? 0,
          knownValue: event.knownValue,
          unpricedLineCount: event.unpricedLineCount,
          productionQuantity: event.kind === "production" ? event.quantity : 0,
          orderCount: event.orderCount ?? 0,
          incompleteFlowCount: event.incompleteFlowCount ?? 0,
          unattributedCount: event.unattributedCount ?? 0,
          unattributedIncoming: event.unattributedIncoming ?? 0,
          unattributedOutgoing: event.unattributedOutgoing ?? 0,
        },
      ],
      products: event.products,
      kinds: [{ kind: event.kind, count: 1 }],
    }))
  )
}

export function mergeStatistics(
  batches: readonly StatisticsBatch[]
): StatisticsBatch {
  const days = new Map<number, StatisticsDay>()
  const products = new Map<string, StatisticsProduct>()
  const kinds = new Map<StatisticsKind, number>()
  for (const batch of batches) {
    for (const day of batch.days) {
      const target = days.get(day.startsAt) ?? emptyStatisticsDay(day.startsAt)
      addDay(target, day)
      days.set(day.startsAt, target)
    }
    for (const product of batch.products) {
      const target = products.get(product.key)
      if (!target) products.set(product.key, { ...product })
      else {
        target.name = product.name
        for (const metric of [
          "sold",
          "purchased",
          "harvested",
          "produced",
          "incoming",
          "outgoing",
        ] as const) {
          target[metric] += product[metric]
        }
      }
    }
    for (const entry of batch.kinds)
      kinds.set(entry.kind, (kinds.get(entry.kind) ?? 0) + entry.count)
  }
  return {
    days: [...days.values()].sort((a, b) => a.startsAt - b.startsAt),
    products: [...products.values()],
    kinds: [...kinds].map(([kind, count]) => ({ kind, count })),
  }
}

export function statisticsTotals(batch: StatisticsBatch) {
  const total = emptyStatisticsDay(0)
  for (const day of batch.days) addDay(total, day)
  return total
}

export function cumulativeStatistics(days: readonly StatisticsDay[]) {
  const points: { startsAt: number; balance: number }[] = []
  let balance = 0
  for (const day of days) {
    balance += day.incoming - day.outgoing
    points.push({ startsAt: day.startsAt, balance })
  }
  return points
}

export function statisticsPreviousPeriod(
  from: number | undefined,
  to: number | undefined
) {
  if (from === undefined || to === undefined || from >= to) return undefined
  const previousFrom = from - (to - from)
  if (
    !Number.isSafeInteger(previousFrom) ||
    previousFrom < -8_640_000_000_000_000
  )
    return undefined
  return { from: previousFrom, to: from }
}

export function statisticsChange(current: number, previous: number) {
  return {
    delta: current - previous,
    // A percentage from a zero or negative balance would be misleading.
    percent: previous > 0 ? ((current - previous) / previous) * 100 : undefined,
  }
}

export type StatisticsInterval = "day" | "week" | "month"

export function statisticsPeriodStart(
  todayStartsAt: number,
  period: "28" | "84" | "6m" | "12m"
) {
  if (period === "28" || period === "84")
    return todayStartsAt - (Number(period) - 1) * DAY_IN_MILLISECONDS
  const end = new Date(todayStartsAt + DAY_IN_MILLISECONDS)
  const month = new Date(
    Date.UTC(
      end.getUTCFullYear(),
      end.getUTCMonth() - (period === "6m" ? 6 : 12),
      1
    )
  )
  const lastDay = new Date(
    Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)
  ).getUTCDate()
  return Date.UTC(
    month.getUTCFullYear(),
    month.getUTCMonth(),
    Math.min(end.getUTCDate(), lastDay)
  )
}

function bucketStart(timestamp: number, interval: StatisticsInterval): number {
  if (interval === "day") return startOfUtcDay(timestamp)
  if (interval === "week") return startOfUtcWeek(timestamp)
  const date = new Date(timestamp)
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)
}

export function statisticsTimeline(
  batch: StatisticsBatch,
  interval: StatisticsInterval,
  from: number,
  to: number
): StatisticsDay[] {
  const buckets = new Map<number, StatisticsDay>()
  for (const day of batch.days) {
    const startsAt = bucketStart(day.startsAt, interval)
    const target = buckets.get(startsAt) ?? emptyStatisticsDay(startsAt)
    addDay(target, day)
    buckets.set(startsAt, target)
  }
  const points: StatisticsDay[] = []
  for (let cursor = bucketStart(from, interval); cursor < to;) {
    points.push(buckets.get(cursor) ?? emptyStatisticsDay(cursor))
    if (interval === "month") {
      const date = new Date(cursor)
      cursor = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)
    } else cursor += DAY_IN_MILLISECONDS * (interval === "week" ? 7 : 1)
  }
  return points
}

export const statisticsOrderStates = [
  "open",
  "ready",
  "unsettled",
  "completed",
  "cancelled",
] as const
export type StatisticsOrderState = (typeof statisticsOrderStates)[number]
export interface StatisticsOrderGroup {
  kind: "client" | "supplier"
  state: StatisticsOrderState
  count: number
  overdueCount: number
  pendingCount: number
  total: number
  unpricedCount: number
}

export function statisticsOrderState(
  order: AttentionOrder
): StatisticsOrderState {
  if (order.status === "cancelled") return "cancelled"
  if (!orderNeedsAttention(order)) return "completed"
  if (order.status === "delivered") return "unsettled"
  return order.kind === "supplier" ? "open" : order.status
}

export function statisticsOrderLabel(
  kind: "client" | "supplier",
  state: StatisticsOrderState
) {
  const labels = {
    open: kind === "client" ? "À préparer" : "À recevoir",
    ready: "Prêtes à livrer",
    unsettled:
      kind === "client" ? "Livrées, à encaisser" : "Reçues, à régulariser",
    completed: "Terminées",
    cancelled: "Annulées",
  }
  return labels[state]
}

export function summarizeStatisticsOrders(
  orders: readonly (AttentionOrder & { total?: number })[],
  todayStartsAt: number
): StatisticsOrderGroup[] {
  const groups = new Map<string, StatisticsOrderGroup>()
  for (const order of orders) {
    const state = statisticsOrderState(order)
    const key = `${order.kind}:${state}`
    const group = groups.get(key) ?? {
      kind: order.kind,
      state,
      count: 0,
      overdueCount: 0,
      pendingCount: 0,
      total: 0,
      unpricedCount: 0,
    }
    const pending =
      order.status !== "cancelled" && order.transactionId === undefined
    group.count += 1
    group.overdueCount += orderIsOverdue(order, todayStartsAt) ? 1 : 0
    if (pending) {
      group.pendingCount += 1
      group.total += order.total ?? 0
      group.unpricedCount += order.total === undefined ? 1 : 0
    }
    groups.set(key, group)
  }
  return [...groups.values()]
}
