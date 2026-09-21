import { describe, expect, it } from "vitest"

import { api, internal } from "./_generated/api"
import { asAuthenticatedUser, createTestBackend } from "./test.helpers"

async function insertTransaction(
  backend: ReturnType<typeof createTestBackend>,
  occurredAt: number,
  total: number,
  actorName = "Comptable test"
) {
  await backend.run((ctx) =>
    ctx.db.insert("transactions", {
      actorName,
      kind: total >= 0 ? "sale" : "purchase",
      occurredAt,
      productName: "Écriture test",
      quantity: 1,
      source: "web",
      total,
    })
  )
}

describe("accounts", () => {
  it("maintient les projections comptables lors des écritures du journal", async () => {
    const backend = createTestBackend()
    const employee = await asAuthenticatedUser(backend)
    const now = Date.now()
    const { characterId, productId } = await backend.run(async (ctx) => ({
      characterId: await ctx.db.insert("characters", {
        active: true,
        name: "Vendeuse test",
      }),
      productId: await ctx.db.insert("products", {
        active: true,
        category: "potion",
        currentStock: 2,
        minimumStock: 0,
        name: "Potion du résumé",
        normalizedName: "potion du resume",
        salePrice: 25,
        tracksStock: true,
      }),
    }))
    await insertTransaction(backend, now, 100)
    await backend.mutation(internal.migrations.rebuildReadModels, {})

    const created = await employee.mutation(api.transactions.record, {
      characterId,
      kind: "sale",
      occurredAt: now,
      productId,
      quantity: 1,
    })
    const afterCreation = await employee.query(api.accounts.overview, {
      currentWeekStartsAt: now,
    })
    expect(afterCreation.journalBalance).toBe(125)
    expect(afterCreation.weeks[0]).toMatchObject({
      incoming: 125,
      net: 125,
      transactionCount: 2,
    })

    await employee.mutation(api.transactions.remove, {
      transactionId: created.transactionId,
    })
    const afterRemoval = await employee.query(api.accounts.overview, {
      currentWeekStartsAt: now,
    })
    expect(afterRemoval.journalBalance).toBe(100)
    expect(afterRemoval.weeks[0]).toMatchObject({
      incoming: 100,
      net: 100,
      transactionCount: 1,
    })
  })

  it("reconstruit les modèles de lecture de façon idempotente", async () => {
    const backend = createTestBackend()
    const employee = await asAuthenticatedUser(backend)
    const now = Date.now()
    await backend.run(async (ctx) => {
      for (const [kind, total] of [
        ["sale", 40],
        ["sale", 0],
        ["production", 0],
      ] as const) {
        await ctx.db.insert("transactions", {
          actorName: "Alchimiste test",
          kind,
          occurredAt: now,
          productName: "Écriture test",
          quantity: 1,
          source: "web",
          total,
        })
      }
    })

    const firstResult = await backend.mutation(
      internal.migrations.rebuildReadModels,
      {}
    )
    const firstOverview = await employee.query(api.accounts.overview, {
      currentWeekStartsAt: now,
    })
    const secondResult = await backend.mutation(
      internal.migrations.rebuildReadModels,
      {}
    )
    const journalPage = await employee.query(api.transactions.listPage, {
      paginationOpts: { cursor: null, numItems: 10 },
    })
    const state = await backend.run(async (ctx) => ({
      markers: await ctx.db
        .query("systemSettings")
        .withIndex("by_key", (index) => index.eq("key", "read-models-v1"))
        .collect(),
      summaries: await ctx.db.query("accountWeekSummaries").collect(),
      transactions: await ctx.db.query("transactions").collect(),
    }))

    expect(firstResult).toMatchObject({
      accountWeeks: 1,
      indexedTransactions: 3,
    })
    expect(secondResult).toMatchObject({
      accountWeeks: 1,
      indexedTransactions: 0,
    })
    expect(state.markers).toHaveLength(1)
    expect(state.summaries).toHaveLength(1)
    expect(
      state.transactions.map((transaction) => transaction.financial)
    ).toEqual([true, true, false])
    expect(journalPage.page.map((transaction) => transaction.kind)).toEqual([
      "sale",
      "sale",
    ])
    expect(firstOverview.weeks[0]).toMatchObject({
      actors: [
        {
          actorName: "Alchimiste test",
          incoming: 40,
          transactionCount: 1,
        },
      ],
      incoming: 40,
      transactionCount: 2,
    })
  })

  it("déplace une correction vers la bonne semaine et le bon personnage", async () => {
    const backend = createTestBackend()
    const employee = await asAuthenticatedUser(backend)
    const now = Date.now()
    const previousWeek = now - 8 * 24 * 60 * 60 * 1_000
    const { firstCharacterId, productId, secondCharacterId } =
      await backend.run(async (ctx) => ({
        firstCharacterId: await ctx.db.insert("characters", {
          active: true,
          name: "Premier personnage",
        }),
        productId: await ctx.db.insert("products", {
          active: true,
          category: "potion",
          currentStock: 10,
          minimumStock: 0,
          name: "Potion mobile",
          normalizedName: "potion mobile",
          salePrice: 25,
          tracksStock: true,
        }),
        secondCharacterId: await ctx.db.insert("characters", {
          active: true,
          name: "Second personnage",
        }),
      }))
    await backend.mutation(internal.migrations.rebuildReadModels, {})
    const recorded = await employee.mutation(api.transactions.record, {
      characterId: firstCharacterId,
      kind: "sale",
      occurredAt: previousWeek,
      productId,
      quantity: 1,
    })

    await employee.mutation(api.transactions.update, {
      characterId: secondCharacterId,
      kind: "sale",
      lines: [{ kind: "product", productId, quantity: 1, unitPrice: 25 }],
      occurredAt: now,
      transactionId: recorded.transactionId,
    })
    const account = await employee.query(api.accounts.overview, {
      currentWeekStartsAt: now,
    })

    expect(account.weeks[0]).toMatchObject({
      actors: [
        {
          actorName: "Second personnage",
          incoming: 25,
          transactionCount: 1,
        },
      ],
      incoming: 25,
      transactionCount: 1,
    })
    expect(account.weeks[1]).toMatchObject({
      actors: [],
      incoming: 0,
      transactionCount: 0,
    })
  })

  it("calcule le bilan courant et les charges initiales du classeur", async () => {
    const backend = createTestBackend()
    const employee = await asAuthenticatedUser(backend)
    const now = Date.now()
    await insertTransaction(backend, now, 100, "Anoril Aliaria")
    await insertTransaction(backend, now, -25, "Gand Ulf")
    await insertTransaction(backend, now - 8 * 24 * 60 * 60 * 1_000, 40)
    await backend.run(async (ctx) => {
      for (const kind of ["production", "adjustment"] as const) {
        await ctx.db.insert("transactions", {
          actorName: "Alixard Veliane",
          kind,
          occurredAt: now,
          productName: "Mouvement de stock",
          quantity: 1,
          source: "web",
          total: 0,
        })
      }
    })

    const account = await employee.query(api.accounts.overview, {})

    expect(account.settings).toMatchObject({
      cashBalance: 2_183,
      censusPerEmployee: 80,
      employeeCount: 2,
      fundsBalance: 2_713,
      salaryRate: 0.25,
      taxRate: 0.2,
      weeklyRent: 500,
    })
    expect(account.weeks[0]).toMatchObject({
      actors: [
        {
          actorName: "Anoril Aliaria",
          incoming: 100,
          net: 100,
          outgoing: 0,
          salary: 25,
          salaryRevenue: 100,
          transactionCount: 1,
        },
        {
          actorName: "Gand Ulf",
          incoming: 0,
          net: -25,
          outgoing: 25,
          salary: 0,
          salaryRevenue: 0,
          transactionCount: 1,
        },
      ],
      incoming: 100,
      net: 75,
      outgoing: 25,
      salary: 25,
      salaryRevenue: 100,
      transactionCount: 2,
    })
    expect(account.charges).toEqual({
      census: 160,
      rent: 500,
      salary: 25,
      tax: 20,
      total: 705,
    })
    expect(account.journalBalance).toBe(115)
  })

  it("sépare les entrées et sorties brutes d’un échange mixte", async () => {
    const backend = createTestBackend()
    const employee = await asAuthenticatedUser(backend)
    const now = Date.now()

    await backend.run((ctx) =>
      ctx.db.insert("transactions", {
        actorName: "Alixard Veliane",
        incomingTotal: 80,
        kind: "exchange",
        occurredAt: now,
        outgoingTotal: 100,
        productName: "Échange mixte",
        quantity: 2,
        source: "web",
        total: 20,
      })
    )

    const queryArgs = { currentWeekStartsAt: now }
    const account = await employee.query(api.accounts.overview, queryArgs)
    await backend.mutation(internal.migrations.rebuildReadModels, {})
    const projectedAccount = await employee.query(
      api.accounts.overview,
      queryArgs
    )

    expect(projectedAccount).toEqual(account)

    expect(account.weeks[0]).toMatchObject({
      actors: [
        {
          actorName: "Alixard Veliane",
          incoming: 100,
          net: 20,
          outgoing: 80,
          salary: 0,
          salaryRevenue: 0,
          transactionCount: 1,
        },
      ],
      incoming: 100,
      net: 20,
      outgoing: 80,
      salary: 0,
      salaryRevenue: 0,
      transactionCount: 1,
    })
    expect(account.charges.tax).toBe(20)
    expect(account.journalBalance).toBe(20)
  })

  it("calcule les salaires par personnage sur les ventes hors commande", async () => {
    const backend = createTestBackend()
    const employee = await asAuthenticatedUser(backend)
    const now = Date.now()

    await backend.run(async (ctx) => {
      const orderId = await ctx.db.insert("orders", {
        contactName: "Commande exclue",
        kind: "client",
        status: "delivered",
      })
      const transactions = [
        { actorName: "Alix", kind: "sale" as const, total: 100 },
        { actorName: "Alix", kind: "service" as const, total: 20 },
        { actorName: "Gand", kind: "bundle" as const, total: 40 },
        {
          actorName: "Alix",
          incomingTotal: 10,
          kind: "exchange" as const,
          outgoingTotal: 60,
          total: 50,
        },
        { actorName: "Alix", kind: "order" as const, total: 500 },
        {
          actorName: "Alix",
          kind: "sale" as const,
          orderId,
          total: 200,
        },
        { actorName: "Gand", kind: "purchase" as const, total: -10 },
      ]

      for (const transaction of transactions) {
        await ctx.db.insert("transactions", {
          ...transaction,
          occurredAt: now,
          productName: "Écriture test",
          quantity: 1,
          source: "web",
        })
      }
    })

    const queryArgs = { currentWeekStartsAt: now }
    const account = await employee.query(api.accounts.overview, queryArgs)
    await backend.mutation(internal.migrations.rebuildReadModels, {})
    const projectedAccount = await employee.query(
      api.accounts.overview,
      queryArgs
    )

    expect(projectedAccount).toEqual(account)

    expect(account.weeks[0]).toMatchObject({
      actors: [
        {
          actorName: "Alix",
          salary: 30,
          salaryRevenue: 120,
        },
        {
          actorName: "Gand",
          salary: 10,
          salaryRevenue: 40,
        },
      ],
      salary: 40,
      salaryRevenue: 160,
    })
    expect(account.charges.salary).toBe(40)
  })

  it("applique le taux par défaut aux anciens paramètres comptables", async () => {
    const backend = createTestBackend()
    const employee = await asAuthenticatedUser(backend)

    await backend.run((ctx) =>
      ctx.db.insert("accountSettings", {
        cashBalance: 0,
        censusPerEmployee: 0,
        employeeCount: 1,
        fundsBalance: 0,
        key: "main",
        salaryPerEmployee: 250,
        taxRate: 0,
        updatedAt: Date.now(),
        updatedBy: "legacy",
        weeklyRent: 0,
      })
    )
    await insertTransaction(backend, Date.now(), 80, "Alix")

    const account = await employee.query(api.accounts.overview, {})

    expect(account.settings.salaryRate).toBe(0.25)
    expect(account.charges.salary).toBe(20)
  })

  it("permet à un administrateur de modifier les paramètres", async () => {
    const backend = createTestBackend()
    const admin = await asAuthenticatedUser(backend, "admin")

    await admin.mutation(api.accounts.saveSettings, {
      cashBalance: 3_000,
      censusPerEmployee: 100,
      employeeCount: 3,
      fundsBalance: 4_000,
      salaryRate: 0.3,
      taxRate: 0.15,
      weeklyRent: 600,
    })
    const account = await admin.query(api.accounts.overview, {})
    const audits = await backend.run((ctx) =>
      ctx.db.query("auditLogs").collect()
    )

    expect(account.settings).toMatchObject({
      cashBalance: 3_000,
      censusPerEmployee: 100,
      employeeCount: 3,
      fundsBalance: 4_000,
      salaryRate: 0.3,
      taxRate: 0.15,
      weeklyRent: 600,
    })
    expect(audits.at(-1)?.action).toBe("account.settings_updated")
  })

  it("réserve les paramètres comptables aux administrateurs", async () => {
    const backend = createTestBackend()
    const employee = await asAuthenticatedUser(backend)

    await expect(
      employee.mutation(api.accounts.saveSettings, {
        cashBalance: 0,
        censusPerEmployee: 0,
        employeeCount: 0,
        fundsBalance: 0,
        salaryRate: 0,
        taxRate: 0,
        weeklyRent: 0,
      })
    ).rejects.toThrowError("réservée aux administrateurs")
  })

  it("refuse un taux de salaire hors limites", async () => {
    const backend = createTestBackend()
    const admin = await asAuthenticatedUser(backend, "admin")

    await expect(
      admin.mutation(api.accounts.saveSettings, {
        cashBalance: 0,
        censusPerEmployee: 0,
        employeeCount: 0,
        fundsBalance: 0,
        salaryRate: 1.01,
        taxRate: 0,
        weeklyRent: 0,
      })
    ).rejects.toThrowError("Le taux de salaire doit être compris entre 0 et 1")
  })
})
