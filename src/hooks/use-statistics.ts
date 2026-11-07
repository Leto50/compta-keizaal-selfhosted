import { usePaginatedQuery } from "convex/react"
import { useEffect, useMemo, useState } from "react"
import { api } from "../../convex/_generated/api"
import {
  mergeStatistics,
  statisticsOrderStates,
  statisticsPeriodStart,
  statisticsPreviousPeriod,
  statisticsTimeline,
  statisticsTotals,
  type StatisticsInterval,
} from "../../shared/statistics"
import { DAY_IN_MILLISECONDS, startOfUtcDay } from "../../shared/time"
import { usePermissions } from "@/hooks/use-permissions"
import { useIsMobile } from "@/hooks/use-mobile"
import { parseDateValue } from "@/lib/date-values"

export const statisticsPeriods = [
  { value: "28", label: "4 dernières semaines" },
  { value: "84", label: "12 dernières semaines" },
  { value: "6m", label: "6 derniers mois" },
  { value: "12m", label: "12 derniers mois" },
  { value: "all", label: "Tout l’historique" },
  { value: "custom", label: "Période personnalisée" },
]
const productMetrics = [
  { value: "sold", label: "Unités vendues" },
  { value: "incoming", label: "Encaissements ventilés" },
  { value: "purchased", label: "Unités achetées" },
  { value: "outgoing", label: "Décaissements ventilés" },
  { value: "harvested", label: "Unités récoltées" },
  { value: "produced", label: "Unités fabriquées" },
] as const
export type ProductMetric = (typeof productMetrics)[number]["value"]

export function formatStatisticsDate(value: number) {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(value)
}

function dateBoundary(value: string) {
  const date = parseDateValue(value)
  return date
    ? Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
    : undefined
}

export function useStatistics() {
  const permissions = usePermissions()
  const isMobile = useIsMobile()
  const { canRead, canWrite, showPrices } = permissions
  const hasFinancial = canRead("account") || canRead("transactions")
  const hasHarvests = canRead("harvests")
  const hasOrders = canRead("orders")
  const hasHistory = hasFinancial || hasHarvests || canWrite
  const [tabChoice, setTab] = useState(hasHistory ? "activity" : "orders")
  const permittedTabs = [
    ...(hasHistory ? ["activity", "products"] : []),
    ...(hasHarvests ? ["harvests"] : []),
    ...(hasOrders ? ["orders"] : []),
  ]
  const tab = permittedTabs.includes(tabChoice)
    ? tabChoice
    : (permittedTabs[0] ?? "activity")
  const ordersActive = hasOrders && tab === "orders"
  const [today] = useState(() => startOfUtcDay(Date.now()))
  const [period, setPeriod] = useState("28")
  const [fromValue, setFromValue] = useState(() =>
    new Date(statisticsPeriodStart(today, "28")).toISOString().slice(0, 10)
  )
  const [toValue, setToValue] = useState(() =>
    new Date(today).toISOString().slice(0, 10)
  )
  const [intervalChoice, setIntervalChoice] = useState("auto")
  const [metricChoice, setMetricChoice] = useState<ProductMetric>("sold")
  const [search, setSearch] = useState("")
  const from =
    period === "all"
      ? undefined
      : period === "custom"
        ? dateBoundary(fromValue)
        : statisticsPeriodStart(today, period as "28" | "84" | "6m" | "12m")
  const end = dateBoundary(toValue)
  const to =
    period === "all"
      ? undefined
      : period === "custom"
        ? end === undefined
          ? undefined
          : end + DAY_IN_MILLISECONDS
        : today + DAY_IN_MILLISECONDS
  const invalidRange =
    period === "custom" &&
    (from === undefined || to === undefined || from >= to)
  const historyEnabled = hasHistory && !ordersActive && !invalidRange
  const transactions = usePaginatedQuery(
    api.statistics.transactionsPage,
    historyEnabled ? { from, to } : "skip",
    { initialNumItems: 40 }
  )
  const previousPeriod =
    historyEnabled && tab === "activity"
      ? statisticsPreviousPeriod(from, to)
      : undefined
  const previous = usePaginatedQuery(
    api.statistics.transactionsPage,
    previousPeriod ?? "skip",
    { initialNumItems: 40 }
  )
  const orders = usePaginatedQuery(
    api.statistics.ordersPage,
    ordersActive ? { todayStartsAt: today } : "skip",
    { initialNumItems: 40 }
  )
  const { status, loadMore } = transactions
  const { status: previousStatus, loadMore: loadPrevious } = previous
  const { status: orderStatus, loadMore: loadOrders } = orders
  const previousEnabled = previousPeriod !== undefined
  useEffect(() => {
    if (historyEnabled && status === "CanLoadMore") loadMore(40)
  }, [historyEnabled, status, loadMore])
  useEffect(() => {
    if (previousEnabled && previousStatus === "CanLoadMore") loadPrevious(40)
  }, [previousEnabled, previousStatus, loadPrevious])
  useEffect(() => {
    if (ordersActive && orderStatus === "CanLoadMore") loadOrders(40)
  }, [ordersActive, orderStatus, loadOrders])

  const batch = useMemo(
    () => mergeStatistics(transactions.results),
    [transactions.results]
  )
  const totals = statisticsTotals(batch)
  const previousTotals = statisticsTotals(mergeStatistics(previous.results))
  const loading = historyEnabled && status !== "Exhausted"
  const initialLoading = historyEnabled && status === "LoadingFirstPage"
  const comparisonReady =
    previousPeriod !== undefined && previousStatus === "Exhausted" && !loading
  const firstDate = from ?? batch.days[0]?.startsAt ?? today
  const lastDate =
    to ??
    Math.max(
      today + DAY_IN_MILLISECONDS,
      (batch.days.at(-1)?.startsAt ?? today) + DAY_IN_MILLISECONDS
    )
  const dayCount = (lastDate - firstDate) / DAY_IN_MILLISECONDS
  const interval: StatisticsInterval =
    intervalChoice === "auto"
      ? dayCount <= (isMobile ? 14 : 31)
        ? "day"
        : dayCount <= (isMobile ? 100 : 200)
          ? "week"
          : "month"
      : (intervalChoice as StatisticsInterval)
  const safeInterval =
    (interval === "day" && dayCount > 730) ||
    (interval === "week" && dayCount > 3650)
      ? "month"
      : interval
  const timeline = useMemo(
    () =>
      invalidRange
        ? []
        : statisticsTimeline(batch, safeInterval, firstDate, lastDate),
    [batch, safeInterval, firstDate, lastDate, invalidRange]
  )
  const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "UTC",
    ...(safeInterval === "month"
      ? ({ month: "short", year: "numeric" } as const)
      : ({ day: "2-digit", month: "short", year: "2-digit" } as const)),
  })
  const chartPoints = (values: (day: (typeof timeline)[number]) => number[]) =>
    timeline.map((day) => ({
      label: dateFormatter.format(Math.max(firstDate, day.startsAt)),
      values: values(day),
    }))
  const availableMetrics = productMetrics.filter(
    (entry) =>
      (hasFinancial ||
        !["sold", "purchased", "incoming", "outgoing"].includes(entry.value)) &&
      (showPrices || !["incoming", "outgoing"].includes(entry.value)) &&
      (hasHarvests || entry.value !== "harvested") &&
      (canWrite || entry.value !== "produced")
  )
  const metric =
    availableMetrics.find((entry) => entry.value === metricChoice) ??
    availableMetrics[0] ??
    productMetrics[0]
  const moneyMetric = metric.value === "incoming" || metric.value === "outgoing"
  const rankedProducts = [...batch.products]
    .filter((p) => p[metric.value] > 0)
    .sort(
      (a, b) =>
        b[metric.value] - a[metric.value] || a.name.localeCompare(b.name, "fr")
    )
  const productTotal = rankedProducts.reduce(
    (sum, p) => sum + p[metric.value],
    0
  )
  // Search changes the visible rows, never the meaning of their share of the period.
  const products = rankedProducts
    .map((product, index) => ({
      key: product.key,
      label: product.name,
      value: product[metric.value],
      share: (product[metric.value] / productTotal) * 100,
      rank: index + 1,
    }))
    .filter((p) =>
      p.label
        .toLocaleLowerCase("fr")
        .includes(search.trim().toLocaleLowerCase("fr"))
    )
  const orderGroups = (["client", "supplier"] as const).map((kind) => ({
    kind,
    entries: statisticsOrderStates
      .filter((state) => kind === "client" || state !== "ready")
      .map((state) => {
        const matches = orders.results.filter(
          (entry) => entry.kind === kind && entry.state === state
        )
        return {
          state,
          count: matches.reduce((sum, e) => sum + e.count, 0),
          pendingCount: matches.reduce((sum, e) => sum + e.pendingCount, 0),
          overdueCount: matches.reduce((sum, e) => sum + e.overdueCount, 0),
          total: matches.reduce((sum, e) => sum + e.total, 0),
          unpricedCount: matches.reduce((sum, e) => sum + e.unpricedCount, 0),
        }
      }),
  }))

  return {
    ...permissions,
    hasFinancial,
    hasHarvests,
    hasOrders,
    hasHistory,
    tab,
    setTab,
    ordersActive,
    period,
    setPeriod,
    fromValue,
    setFromValue,
    toValue,
    setToValue,
    intervalChoice,
    setIntervalChoice,
    safeInterval,
    interval,
    invalidRange,
    batch,
    totals,
    previousTotals,
    previousPeriod,
    comparisonReady,
    loading,
    initialLoading,
    firstDate,
    lastDate,
    chartPoints,
    timeline,
    availableMetrics,
    metric,
    setMetricChoice,
    moneyMetric,
    search,
    setSearch,
    products,
    productTotal,
    rankedProducts,
    orderGroups,
    ordersLoading: ordersActive && orderStatus !== "Exhausted",
    ordersInitialLoading: ordersActive && orderStatus === "LoadingFirstPage",
  }
}
export type StatisticsModel = ReturnType<typeof useStatistics>
