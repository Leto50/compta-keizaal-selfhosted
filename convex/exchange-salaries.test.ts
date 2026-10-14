import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { api, internal } from "./_generated/api"
import { asAuthenticatedUser, createTestBackend } from "./test.helpers"
import { defaultReaderAccess } from "../shared/reader-access"
import { startOfUtcWeek, WEEK_IN_MILLISECONDS } from "./lib/time"

async function fixture(
  mode: "direct" | "global" | "scoped",
  documentsRead?: number
) {
  const backend = createTestBackend(documentsRead ? { documentsRead } : false)
  const employee = await asAuthenticatedUser(backend)
  const admin = await asAuthenticatedUser(backend, "admin")
  const reader = await asAuthenticatedUser(backend, "reader")
  const user = await reader.query(api.auth.getCurrentUser, {})
  if (!user) throw new Error("Lecteur absent")
  const { characterId, productId } = await backend.run(async (ctx) => ({
    characterId: await ctx.db.insert("characters", {
      active: true,
      name: "Vendeuse test",
    }),
    productId: await ctx.db.insert("products", {
      active: true,
      category: "potion",
      currentStock: 100,
      minimumStock: 0,
      name: "Potion échangée",
      normalizedName: "potion echangee",
      purchasePrice: 80,
      salePrice: 100,
      tracksStock: true,
    }),
  }))
  await admin.mutation(api.administration.saveAccountAccess, {
    userId: user._id,
    role: "reader",
    access: { ...defaultReaderAccess, productIds: [productId] },
  })
  if (mode === "global")
    await backend.mutation(internal.migrations.rebuildReadModels, {})
  if (mode === "scoped")
    await backend.mutation(internal.migrations.prepareHistorySummaries, {})
  return {
    backend,
    employee,
    reader,
    viewer: mode === "scoped" ? reader : employee,
    characterId,
    productId,
    week: startOfUtcWeek(Date.now()),
  }
}

describe.each(["direct", "global", "scoped"] as const)(
  "salaires des échanges (%s)",
  (mode) => {
    it.each([
      { purchase: 80, sale: 100, discount: 0 },
      { purchase: 100, sale: 100, discount: 0 },
      { purchase: 120, sale: 100, discount: 0 },
      { purchase: 80, sale: 100, discount: 20 },
      { purchase: 80, sale: 100, discount: 100 },
    ])(
      "verse la même paie pour un échange et deux opérations séparées (achat $purchase, vente $sale, remise $discount)",
      async ({ purchase, sale, discount }) => {
        const { employee, viewer, characterId, productId, week } =
          await fixture(mode)
        const purchaseLine = {
          direction: "incoming" as const,
          kind: "product" as const,
          productId,
          quantity: 1,
          unitPrice: purchase,
        }
        const saleLine = {
          ...purchaseLine,
          direction: "outgoing" as const,
          unitPrice: sale,
        }
        const recorded = await employee.mutation(
          api.transactions.recordExchange,
          {
            characterId,
            occurredAt: week,
            discount,
            lines: [purchaseLine, saleLine],
          }
        )
        const queryArgs = { currentWeekStartsAt: week }
        const mixed = await viewer.query(api.accounts.overview, queryArgs)
        const expected = {
          incoming: sale - discount,
          outgoing: purchase,
          net: sale - discount - purchase,
          salaryRevenue: sale - discount,
          salary: (sale - discount) * 0.25,
        }
        expect(mixed.weeks[0]).toMatchObject(expected)
        expect(mixed.weeks[0]?.actors).toEqual([
          expect.objectContaining({
            ...expected,
            actorCharacterId: characterId,
          }),
        ])
        expect(mixed.charges.salary).toBe(expected.salary)

        await employee.mutation(api.transactions.remove, {
          transactionId: recorded.transactionId,
        })
        expect(
          (await viewer.query(api.accounts.overview, queryArgs)).weeks[0]
        ).toMatchObject({ actors: [], salary: 0, salaryRevenue: 0 })
        await employee.mutation(api.transactions.recordExchange, {
          characterId,
          occurredAt: week,
          lines: [purchaseLine],
        })
        await employee.mutation(api.transactions.recordExchange, {
          characterId,
          occurredAt: week,
          discount,
          lines: [saleLine],
        })
        const separate = await viewer.query(api.accounts.overview, queryArgs)
        expect(separate.weeks[0]).toMatchObject(expected)
        expect(separate.charges).toEqual(mixed.charges)
        expect(separate.journalBalance).toBe(mixed.journalBalance)
      }
    )

    it("actualise la paie des lots vendus lors d’une correction de type, personnage ou semaine", async () => {
      const { backend, employee, viewer, characterId, productId, week } =
        await fixture(mode)
      const bundleId = await employee.mutation(api.bundles.save, {
        name: "Lot échangé",
        price: 150,
        items: [{ productId, quantity: 1 }],
      })
      const purchaseLine = {
        direction: "incoming" as const,
        kind: "product" as const,
        productId,
        quantity: 1,
      }
      const saleLine = {
        direction: "outgoing" as const,
        kind: "bundle" as const,
        bundleId,
        quantity: 1,
      }
      const recorded = await employee.mutation(
        api.transactions.recordExchange,
        {
          characterId,
          occurredAt: week,
          discount: 10,
          lines: [purchaseLine, saleLine],
        }
      )
      const queryArgs = { currentWeekStartsAt: week }
      expect(
        (await viewer.query(api.accounts.overview, queryArgs)).weeks[0]
      ).toMatchObject({ salary: 35, salaryRevenue: 140 })

      await employee.mutation(api.transactions.updateExchange, {
        characterId,
        occurredAt: week,
        transactionId: recorded.transactionId,
        lines: [purchaseLine],
      })
      expect(
        (await viewer.query(api.accounts.overview, queryArgs)).weeks[0]
      ).toMatchObject({ salary: 0, salaryRevenue: 0 })

      const secondCharacterId = await backend.run((ctx) =>
        ctx.db.insert("characters", { active: true, name: "Seconde vendeuse" })
      )
      await employee.mutation(api.transactions.updateExchange, {
        characterId: secondCharacterId,
        occurredAt: week - WEEK_IN_MILLISECONDS,
        transactionId: recorded.transactionId,
        discount: 10,
        lines: [purchaseLine, saleLine],
      })
      const updated = await viewer.query(api.accounts.overview, queryArgs)
      expect(updated.weeks[0]).toMatchObject({ salary: 0, actors: [] })
      expect(updated.weeks[1]).toMatchObject({
        salary: 35,
        salaryRevenue: 140,
        actors: [
          {
            actorCharacterId: secondCharacterId,
            salary: 35,
            salaryRevenue: 140,
          },
        ],
      })
      await employee.mutation(api.transactions.remove, {
        transactionId: recorded.transactionId,
      })
      expect(
        (await viewer.query(api.accounts.overview, queryArgs)).weeks[1]
      ).toMatchObject({ salary: 0, salaryRevenue: 0, actors: [] })
    })
  }
)

describe("reprise des salaires des anciens échanges", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it.each(["direct", "global"] as const)(
    "reprend les échanges par lots sans doubler les corrections ou suppressions concurrentes (%s)",
    async (mode) => {
      const { backend, employee, reader, characterId, productId, week } =
        await fixture(mode, 200)
      const ids = await backend.run(async (ctx) => {
        const ids = []
        for (let index = 0; index < 24; index++) {
          const transactionId = await ctx.db.insert("transactions", {
            actorCharacterId: characterId,
            actorName: "Vendeuse test",
            incomingTotal: 80,
            kind: "exchange",
            occurredAt: week,
            outgoingTotal: 100,
            productName: "Ancien échange",
            quantity: 2,
            source: "web",
            total: 20,
          })
          for (const direction of ["incoming", "outgoing"] as const)
            await ctx.db.insert("transactionLines", {
              direction,
              kind: "product",
              productId,
              productName: "Potion échangée",
              quantity: 1,
              total: direction === "incoming" ? 80 : 100,
              transactionId,
              unitPrice: direction === "incoming" ? 80 : 100,
            })
          ids.push(transactionId)
        }
        return ids
      })
      if (mode === "global") {
        await backend.mutation(internal.migrations.rebuildReadModels, {})
        await backend.mutation(internal.migrations.prepareHistorySummaries, {})
        await backend.finishAllScheduledFunctions(vi.runAllTimers, 1000)
      }
      const queryArgs = { currentWeekStartsAt: week }
      for (const viewer of [employee, reader])
        expect(
          (await viewer.query(api.accounts.overview, queryArgs)).weeks[0]
        ).toMatchObject({ incoming: 2400, salary: 0, salaryRevenue: 0 })
      expect(
        await backend.mutation(internal.migrations.prepareExchangeSalaries, {})
      ).toEqual({ ready: false, migratedTransactions: 10 })

      const secondCharacterId = await backend.run((ctx) =>
        ctx.db.insert("characters", { active: true, name: "Seconde vendeuse" })
      )
      // Correct and remove both migrated and not-yet-migrated exchanges.
      for (const transactionId of [ids[0]!, ids[20]!])
        await employee.mutation(api.transactions.updateExchange, {
          characterId: secondCharacterId,
          occurredAt: week - WEEK_IN_MILLISECONDS,
          transactionId,
          discount: 10,
          lines: [
            {
              direction: "incoming",
              kind: "product",
              productId,
              quantity: 1,
              unitPrice: 20,
            },
            {
              direction: "outgoing",
              kind: "product",
              productId,
              quantity: 1,
              unitPrice: 60,
            },
          ],
        })
      for (const transactionId of [ids[1]!, ids[21]!])
        await employee.mutation(api.transactions.remove, { transactionId })
      await employee.mutation(api.transactions.recordExchange, {
        characterId,
        occurredAt: week,
        discount: 20,
        lines: [
          {
            direction: "incoming",
            kind: "product",
            productId,
            quantity: 1,
            unitPrice: 120,
          },
          {
            direction: "outgoing",
            kind: "product",
            productId,
            quantity: 1,
            unitPrice: 100,
          },
        ],
      })
      await backend.finishAllScheduledFunctions(vi.runAllTimers, 1000)

      for (const viewer of [employee, reader]) {
        const account = await viewer.query(api.accounts.overview, queryArgs)
        expect(account.weeks[0]).toMatchObject({
          incoming: 2080,
          outgoing: 1720,
          salary: 520,
          salaryRevenue: 2080,
          transactionCount: 21,
        })
        expect(account.weeks[1]).toMatchObject({
          salary: 25,
          salaryRevenue: 100,
          actors: [{ actorCharacterId: secondCharacterId, salary: 25 }],
        })
        expect(account.charges.salary).toBe(520)
        expect(account.journalBalance).toBe(420)
      }
      expect(
        await backend.mutation(internal.migrations.prepareExchangeSalaries, {})
      ).toEqual({ ready: true, migratedTransactions: 0 })
      // A full rebuild must produce the same values as the incremental migration.
      const migrated = await employee.query(api.accounts.overview, queryArgs)
      await backend.mutation(internal.migrations.rebuildReadModels, {})
      expect(await employee.query(api.accounts.overview, queryArgs)).toEqual(
        migrated
      )
    }
  )

  it("préserve les données financières et les stocks en reprenant les échanges après remise et sans totaux détaillés", async () => {
    const { backend, employee, reader, characterId, productId, week } =
      await fixture("global")
    await backend.run(async (ctx) => {
      for (const flows of [
        { incomingTotal: 80, outgoingTotal: 80, discount: 20, total: 0 },
        { total: 20 },
      ])
        await ctx.db.insert("transactions", {
          actorCharacterId: characterId,
          actorName: "Vendeuse test",
          kind: "exchange",
          occurredAt: week,
          productId,
          productName: "Ancien échange",
          quantity: 2,
          source: "web",
          ...flows,
        })
    })
    await backend.mutation(internal.migrations.rebuildReadModels, {})
    await backend.mutation(internal.migrations.prepareHistorySummaries, {})
    const snapshot = () =>
      backend.run(async (ctx) => ({
        products: await ctx.db.query("products").collect(),
        lines: await ctx.db.query("transactionLines").collect(),
        movements: await ctx.db.query("stockMovements").collect(),
        journal: await ctx.db.query("journalSummaries").collect(),
        settings: await ctx.db.query("accountSettings").collect(),
        audit: await ctx.db.query("auditLogs").collect(),
      }))
    const before = await snapshot()
    expect(
      await backend.mutation(internal.migrations.prepareExchangeSalaries, {})
    ).toEqual({ ready: true, migratedTransactions: 2 })
    expect(await snapshot()).toEqual(before)
    for (const viewer of [employee, reader]) {
      const account = await viewer.query(api.accounts.overview, {
        currentWeekStartsAt: week,
      })
      expect(account.weeks[0]).toMatchObject({
        incoming: 100,
        outgoing: 80,
        net: 20,
        salary: 25,
        salaryRevenue: 100,
        transactionCount: 2,
      })
      expect(account.journalBalance).toBe(20)
    }
  })
})
