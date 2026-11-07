import { describe, expect, it } from "vitest"
import {
  emptyStatisticsDay,
  mergeStatistics,
  statisticsTimeline,
  statisticsTotals,
  summarizeStatisticsOrders,
  statisticsPeriodStart,
  statisticsPreviousPeriod,
  statisticsChange,
  type StatisticsBatch,
} from "./statistics"
import { DAY_IN_MILLISECONDS } from "./time"

describe("Analyse des statistiques", () => {
  it("compare deux fenêtres adjacentes de même durée, même à cheval sur une année", () => {
    const from = Date.UTC(2026, 0, 1)
    const to = Date.UTC(2026, 0, 29)
    expect(statisticsPreviousPeriod(from, to)).toEqual({
      from: Date.UTC(2025, 11, 4),
      to: from,
    })
    expect(statisticsPreviousPeriod(undefined, to)).toBeUndefined()
    expect(statisticsPreviousPeriod(from, undefined)).toBeUndefined()
    expect(statisticsPreviousPeriod(to, from)).toBeUndefined()
    expect(statisticsPreviousPeriod(from, from)).toBeUndefined()
    expect(statisticsPreviousPeriod(-8_640_000_000_000_000, to)).toBeUndefined()
  })
  it("n’invente pas de pourcentage quand la base est nulle ou négative", () => {
    expect(statisticsChange(150, 100)).toEqual({ delta: 50, percent: 50 })
    expect(statisticsChange(0, 100)).toEqual({ delta: -100, percent: -100 })
    expect(statisticsChange(0, 0)).toEqual({ delta: 0, percent: undefined })
    expect(statisticsChange(50, 0)).toEqual({ delta: 50, percent: undefined })
    expect(statisticsChange(20, -10)).toEqual({ delta: 30, percent: undefined })
  })
})

describe("statisticsTimeline", () => {
  it("respecte les mois calendaires, les fins de mois et les années bissextiles", () => {
    expect(statisticsPeriodStart(Date.UTC(2026, 9, 15), "6m")).toBe(
      Date.UTC(2026, 3, 16)
    )
    expect(statisticsPeriodStart(Date.UTC(2024, 1, 28), "12m")).toBe(
      Date.UTC(2023, 1, 28)
    )
    expect(statisticsPeriodStart(Date.UTC(2026, 7, 30), "6m")).toBe(
      Date.UTC(2026, 1, 28)
    )
    expect(statisticsPeriodStart(Date.UTC(2026, 9, 15), "28")).toBe(
      Date.UTC(2026, 8, 18)
    )
  })
  it("classe les commandes selon le travail restant, sans confondre paiement et livraison", () => {
    const today = Date.UTC(2026, 9, 15)
    const groups = summarizeStatisticsOrders(
      [
        {
          kind: "client",
          status: "open",
          transactionId: "paid",
          total: 90,
          dueAt: today - DAY_IN_MILLISECONDS,
        },
        {
          kind: "client",
          status: "delivered",
          total: 50,
          dueAt: today - DAY_IN_MILLISECONDS,
        },
        { kind: "supplier", status: "ready", total: 20 },
        { kind: "supplier", status: "cancelled", total: 999 },
        {
          kind: "supplier",
          status: "delivered",
          transactionId: "received",
          total: 500,
        },
        { kind: "client", status: "open" },
      ],
      today
    )
    expect(
      groups.find((entry) => entry.kind === "client" && entry.state === "open")
    ).toMatchObject({
      count: 2,
      pendingCount: 1,
      total: 0,
      unpricedCount: 1,
      overdueCount: 1,
    })
    expect(groups.find((entry) => entry.state === "unsettled")).toMatchObject({
      pendingCount: 1,
      total: 50,
      overdueCount: 1,
    })
    expect(
      groups.find(
        (entry) => entry.kind === "supplier" && entry.state === "open"
      )
    ).toMatchObject({ count: 1, pendingCount: 1, total: 20 })
    expect(groups.find((entry) => entry.state === "completed")).toMatchObject({
      count: 1,
      pendingCount: 0,
      total: 0,
    })
    expect(groups.find((entry) => entry.state === "cancelled")).toMatchObject({
      count: 1,
      pendingCount: 0,
      total: 0,
    })
  })
  it("complète les jours sans activité et conserve les totaux au regroupement mensuel", () => {
    const first = Date.UTC(2020, 1, 28)
    const end = Date.UTC(2020, 2, 2)
    const batch: StatisticsBatch = {
      days: [
        {
          ...emptyStatisticsDay(first),
          incoming: 20,
          outgoing: 30,
          transactionCount: 1,
        },
        {
          ...emptyStatisticsDay(Date.UTC(2020, 2, 1)),
          incoming: 40,
          transactionCount: 2,
        },
      ],
      products: [],
      kinds: [],
    }
    const daily = statisticsTimeline(batch, "day", first, end)
    expect(daily).toHaveLength(3)
    expect(daily[1]).toMatchObject({
      startsAt: first + DAY_IN_MILLISECONDS,
      transactionCount: 0,
    })
    const monthly = statisticsTimeline(batch, "month", first, end)
    expect(monthly.map((day) => day.startsAt)).toEqual([
      Date.UTC(2020, 1, 1),
      Date.UTC(2020, 2, 1),
    ])
    expect(statisticsTotals({ ...batch, days: monthly })).toEqual(
      statisticsTotals(batch)
    )
  })

  it("réunit les lots sans mutation ni double comptage et regroupe les semaines en UTC", () => {
    const day = Date.UTC(2026, 9, 4)
    const batch: StatisticsBatch = {
      days: [{ ...emptyStatisticsDay(day), incoming: 12, transactionCount: 1 }],
      products: [
        {
          key: "p",
          name: "Blé",
          sold: 2,
          purchased: 0,
          harvested: 0,
          produced: 0,
          incoming: 12,
          outgoing: 0,
        },
      ],
      kinds: [{ kind: "sale", count: 1 }],
    }
    const snapshot = structuredClone(batch)
    const merged = mergeStatistics([batch, batch])
    expect(merged.products[0]?.sold).toBe(4)
    expect(merged.kinds[0]?.count).toBe(2)
    expect(batch).toEqual(snapshot)
    expect(
      statisticsTimeline(merged, "week", day, day + DAY_IN_MILLISECONDS)[0]
    ).toMatchObject({ startsAt: Date.UTC(2026, 8, 28), incoming: 24 })
  })
})
