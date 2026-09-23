import { v } from "convex/values"

import { type Doc } from "./_generated/dataModel"
import { mutation, query } from "./_generated/server"
import {
  buildAccountWeekSummaries,
  readAccountWeekSummaries,
} from "./lib/accountSummary"
import { requireAdmin, requireUser } from "./lib/auth"
import { assertFiniteRange, assertWholeNumberRange } from "./lib/numbers"
import { readJournalBalance } from "./lib/journalSummary"
import { readModelsAreReady } from "./lib/readModels"
import {
  DAY_IN_MILLISECONDS,
  startOfUtcWeek,
  WEEK_IN_MILLISECONDS,
} from "./lib/time"

const WEEK_COUNT = 8
const MAX_AMOUNT = 1_000_000_000
const MAX_TIMESTAMP = 8_640_000_000_000_000

const DEFAULT_SETTINGS = {
  cashBalance: 2_183,
  censusPerEmployee: 80,
  employeeCount: 2,
  fundsBalance: 2_713,
  key: "main" as const,
  salaryRate: 0.25,
  taxRate: 0.2,
  weeklyRent: 500,
}

function calculateSalary(revenue: number, rate: number): number {
  return Math.round((revenue * rate + Number.EPSILON) * 100) / 100
}

function summarizeActors(
  actors: readonly Doc<"accountWeekSummaries">["actors"][number][],
  salaryRate: number
) {
  return actors
    .filter((actor) => actor.incoming !== 0 || actor.outgoing !== 0)
    .map((actor) => ({
      ...actor,
      net: actor.incoming - actor.outgoing,
      salary: calculateSalary(actor.salaryRevenue, salaryRate),
    }))
    .sort(
      (left, right) =>
        right.incoming - left.incoming ||
        right.net - left.net ||
        left.actorName.localeCompare(right.actorName, "fr")
    )
}

export const overview = query({
  args: {
    currentWeekStartsAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireUser(ctx)
    if (args.currentWeekStartsAt !== undefined) {
      assertFiniteRange(
        args.currentWeekStartsAt,
        0,
        MAX_TIMESTAMP,
        "Le début de semaine"
      )
    }
    const currentWeekStartsAt = startOfUtcWeek(
      args.currentWeekStartsAt ?? Date.now()
    )
    const firstWeekStartsAt =
      currentWeekStartsAt - (WEEK_COUNT - 1) * WEEK_IN_MILLISECONDS
    const readModelsReady = await readModelsAreReady(ctx)
    const summariesPromise = readModelsReady
      ? readAccountWeekSummaries(ctx, firstWeekStartsAt, currentWeekStartsAt)
      : ctx.db
          .query("transactions")
          .withIndex("by_occurred_at", (index) =>
            index.gte("occurredAt", firstWeekStartsAt)
          )
          .collect()
          .then(buildAccountWeekSummaries)
    const [storedSettings, summaries, journalBalance] = await Promise.all([
      ctx.db
        .query("accountSettings")
        .withIndex("by_key", (index) => index.eq("key", "main"))
        .unique(),
      summariesPromise,
      readJournalBalance(ctx),
    ])
    const settings = storedSettings ?? DEFAULT_SETTINGS
    const salaryRate = settings.salaryRate ?? DEFAULT_SETTINGS.salaryRate
    const summariesByWeek = new Map(
      summaries.map((summary) => [summary.startsAt, summary])
    )
    const weeks = Array.from({ length: WEEK_COUNT }, (_, index) => {
      const startsAt = currentWeekStartsAt - index * WEEK_IN_MILLISECONDS
      const endsAt = startsAt + 6.5 * DAY_IN_MILLISECONDS
      const summary = summariesByWeek.get(startsAt)
      const incoming = summary?.incoming ?? 0
      const outgoing = summary?.outgoing ?? 0
      const actors = summarizeActors(summary?.actors ?? [], salaryRate)
      return {
        actors,
        endsAt,
        incoming,
        net: incoming - outgoing,
        outgoing,
        salary: actors.reduce((total, actor) => total + actor.salary, 0),
        salaryRevenue: actors.reduce(
          (total, actor) => total + actor.salaryRevenue,
          0
        ),
        startsAt,
        transactionCount: summary?.transactionCount ?? 0,
      }
    })
    const currentWeek = weeks[0]
    const census = settings.censusPerEmployee * settings.employeeCount
    const rent = settings.weeklyRent
    const taxableProfit = Math.max((currentWeek?.net ?? 0) - census - rent, 0)
    const charges = {
      census,
      rent,
      salary: currentWeek?.salary ?? 0,
      tax: Math.floor(taxableProfit * settings.taxRate),
    }
    return {
      charges: {
        ...charges,
        total: charges.census + charges.rent + charges.salary + charges.tax,
      },
      journalBalance,
      settings: {
        cashBalance: settings.cashBalance,
        censusPerEmployee: settings.censusPerEmployee,
        employeeCount: settings.employeeCount,
        fundsBalance: settings.fundsBalance,
        salaryRate,
        taxRate: settings.taxRate,
        weeklyRent: settings.weeklyRent,
      },
      weeks,
    }
  },
})

export const saveSettings = mutation({
  args: {
    cashBalance: v.number(),
    censusPerEmployee: v.number(),
    employeeCount: v.number(),
    fundsBalance: v.number(),
    salaryRate: v.number(),
    taxRate: v.number(),
    weeklyRent: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await requireAdmin(ctx)
    assertWholeNumberRange(
      args.cashBalance,
      0,
      MAX_AMOUNT,
      "La caisse déclarée"
    )
    assertWholeNumberRange(
      args.fundsBalance,
      0,
      MAX_AMOUNT,
      "Les fonds disponibles"
    )
    assertWholeNumberRange(
      args.employeeCount,
      0,
      10_000,
      "Le nombre d’employés"
    )
    assertWholeNumberRange(
      args.weeklyRent,
      0,
      MAX_AMOUNT,
      "Le loyer hebdomadaire"
    )
    assertWholeNumberRange(
      args.censusPerEmployee,
      0,
      MAX_AMOUNT,
      "Le cens par employé"
    )
    assertFiniteRange(args.salaryRate, 0, 1, "Le taux de salaire")
    assertFiniteRange(args.taxRate, 0, 1, "Le taux de taxe")

    const existing = await ctx.db
      .query("accountSettings")
      .withIndex("by_key", (index) => index.eq("key", "main"))
      .unique()
    const details = {
      ...args,
      key: "main" as const,
      updatedAt: Date.now(),
      updatedBy: String(user._id),
    }
    let settingsId
    if (existing) {
      await ctx.db.replace(existing._id, details)
      settingsId = existing._id
    } else {
      settingsId = await ctx.db.insert("accountSettings", details)
    }
    await ctx.db.insert("auditLogs", {
      action: "account.settings_updated",
      actorUserId: String(user._id),
      createdAt: Date.now(),
      detail: `${args.cashBalance}:${args.fundsBalance}:${args.employeeCount}:${args.salaryRate}`,
      entityId: settingsId,
      entityType: "account_settings",
    })
  },
})
