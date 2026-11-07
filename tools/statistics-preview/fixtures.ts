import { getFunctionName, type FunctionReference } from "convex/server"
import {
  summarizeStatistics,
  type StatisticsEvent,
  type StatisticsOrderGroup,
} from "../../shared/statistics"
import { startOfUtcDay, DAY_IN_MILLISECONDS } from "../../shared/time"

export const scenarios = {
  populated: "Activité complète",
  empty: "Aucune donnée",
  loading: "Premier chargement",
  partial: "Chargement de l’historique",
  incomplete: "Historique incomplet",
  reader: "Lecteur sans montants",
  orders: "Commandes uniquement",
  harvests: "Récoltes uniquement",
  none: "Aucune rubrique autorisée",
  large: "Grands montants et noms longs",
} as const
const selected =
  new URLSearchParams(location.search).get("scenario") ?? "populated"
const today = startOfUtcDay(Date.now())
const names = [
  "Potion de soin",
  "Blé",
  "Fleur de montagne bleue",
  "Lot du voyageur",
  "Sel",
  "Aile de papillon",
  "Potion de vigueur",
  "Lavande",
  "Champignon luisant",
  "Peau de ragnard",
]
const events: StatisticsEvent[] = []
for (let offset = 0; offset < 120; offset++) {
  if (offset % 7 === 0) continue
  const product = offset % names.length
  const quantity = 3 + (offset % 18)
  const incoming =
    (quantity * (12 + product * 3) + offset * 2) *
    (selected === "large" ? 12345678 : 1)
  const base = {
    occurredAt: today - offset * DAY_IN_MILLISECONDS,
    quantity,
    knownValue: 0,
    unpricedLineCount: 0,
    products: [
      {
        key: String(product),
        name:
          selected === "large"
            ? `${names[product]} — préparation de voyage de qualité supérieure, grand conditionnement`
            : names[product]!,
        sold: quantity,
        purchased: 0,
        harvested: 0,
        produced: 0,
        incoming,
        outgoing: 0,
      },
    ],
  }
  events.push({ ...base, kind: "sale", financial: true, incoming, outgoing: 0 })
  if (offset % 3 === 0)
    events.push({
      ...base,
      kind: "purchase",
      financial: true,
      incoming: 0,
      outgoing: incoming / 3,
      products: [
        {
          ...base.products[0]!,
          sold: 0,
          purchased: quantity,
          incoming: 0,
          outgoing: incoming / 3,
        },
      ],
    })
  if (offset % 2 === 0)
    events.push({
      ...base,
      kind: "harvest",
      financial: false,
      incoming: 0,
      outgoing: 0,
      knownValue:
        selected === "incomplete" && offset % 4 === 0 ? 0 : quantity * 2,
      harvestLineCount: 1,
      unpricedLineCount: selected === "incomplete" && offset % 4 === 0 ? 1 : 0,
      products: [
        { ...base.products[0]!, sold: 0, harvested: quantity, incoming: 0 },
      ],
    })
}
if (selected === "incomplete")
  events.push({
    occurredAt: today,
    kind: "exchange",
    financial: true,
    incoming: 150,
    outgoing: 0,
    quantity: 4,
    knownValue: 0,
    unpricedLineCount: 0,
    products: [],
    incompleteFlowCount: 1,
    unattributedCount: 1,
    unattributedIncoming: 150,
  })
const orderGroups: StatisticsOrderGroup[] = [
  {
    kind: "client",
    state: "open",
    count: 12,
    pendingCount: 8,
    overdueCount: 2,
    total: 1250,
    unpricedCount: 0,
  },
  {
    kind: "client",
    state: "ready",
    count: 3,
    pendingCount: 3,
    overdueCount: 1,
    total: 420,
    unpricedCount: 0,
  },
  {
    kind: "client",
    state: "unsettled",
    count: 2,
    pendingCount: 2,
    overdueCount: 1,
    total: 180,
    unpricedCount: 0,
  },
  {
    kind: "client",
    state: "completed",
    count: 26,
    pendingCount: 0,
    overdueCount: 0,
    total: 0,
    unpricedCount: 0,
  },
  {
    kind: "supplier",
    state: "open",
    count: 4,
    pendingCount: 4,
    overdueCount: 1,
    total: 760,
    unpricedCount: 0,
  },
  {
    kind: "supplier",
    state: "completed",
    count: 9,
    pendingCount: 0,
    overdueCount: 0,
    total: 0,
    unpricedCount: 0,
  },
]

export function usePermissions() {
  const reader = ["reader", "orders", "harvests", "none"].includes(selected)
  const sections =
    selected === "orders"
      ? ["statistics", "orders"]
      : selected === "harvests"
        ? ["statistics", "harvests"]
        : selected === "none"
          ? ["statistics"]
          : [
              "statistics",
              "transactions",
              "account",
              "orders",
              "harvests",
              "inventory",
            ]
  return {
    canWrite: !reader,
    isAdmin: !reader,
    isReader: reader,
    isPending: false,
    canRead: (section: string) => sections.includes(section),
    showPrices: selected !== "reader",
    showPurchasePrices: selected !== "reader",
    showSalePrices: selected !== "reader",
    showSalaries: false,
    showStock: true,
    access: null,
  }
}
export function useSiteName() {
  return "L’eau d’Roche"
}
export const authClient = {
  useSession: () => ({ data: { user: { name: "Compte de démonstration" } } }),
  signOut: () => Promise.resolve(),
}
export function usePaginatedQuery(
  reference: FunctionReference<"query">,
  args: unknown
) {
  const name = getFunctionName(reference)
  const range = args as { from?: number; to?: number }
  const harvestOnly = selected === "harvests"
  const filtered =
    args === "skip" || selected === "empty"
      ? []
      : events.filter(
          (e) =>
            (!harvestOnly || e.kind === "harvest") &&
            (range.from === undefined || e.occurredAt >= range.from) &&
            (range.to === undefined || e.occurredAt < range.to)
        )
  const batch = summarizeStatistics(
    selected === "partial" ? filtered.slice(0, 8) : filtered
  )
  const isOrders = name === "statistics:ordersPage"
  const status =
    args === "skip" || selected === "loading"
      ? "LoadingFirstPage"
      : selected === "partial"
        ? "LoadingMore"
        : "Exhausted"
  return {
    results:
      args === "skip" || selected === "loading"
        ? []
        : isOrders
          ? selected === "empty"
            ? []
            : orderGroups
          : [batch],
    status,
    loadMore: () => undefined,
  }
}
