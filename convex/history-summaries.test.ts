import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { api, internal } from "./_generated/api"
import { asAuthenticatedUser, createTestBackend } from "./test.helpers"
import { defaultReaderAccess } from "../shared/reader-access"
import seedData from "../data/inventaire.seed.json"
import { startOfUtcWeek, WEEK_IN_MILLISECONDS } from "../shared/time"

async function fixture(documentsRead?: number) {
  const backend = createTestBackend(documentsRead ? { documentsRead } : false)
  const member = await asAuthenticatedUser(backend)
  const admin = await asAuthenticatedUser(backend, "admin")
  const reader = await asAuthenticatedUser(backend, "reader")
  const user = await reader.query(api.auth.getCurrentUser, {})
  if (!user) throw new Error("Lecteur absent")
  const ids = await backend.run(async (ctx) => {
    const characterId = await ctx.db.insert("characters", {
      active: true,
      name: "Mira",
    })
    const products = []
    for (const name of ["Public", "Secret"])
      products.push(
        await ctx.db.insert("products", {
          active: true,
          category: "ingredient",
          currentStock: 1000,
          minimumStock: 0,
          name,
          normalizedName: name.toLowerCase(),
          purchasePrice: 4,
          salePrice: 3,
          tracksStock: true,
        })
      )
    return { characterId, a: products[0]!, b: products[1]! }
  })
  const access = {
    ...defaultReaderAccess,
    productIds: [ids.a],
    operationKinds: ["sale", "bundle", "exchange", "purchase"] as (
      "sale" | "bundle" | "exchange" | "purchase"
    )[],
  }
  await admin.mutation(api.administration.saveAccountAccess, {
    userId: user._id,
    role: "reader",
    access,
  })
  return {
    backend,
    member,
    admin,
    reader,
    userId: user._id,
    access,
    ...ids,
    week: startOfUtcWeek(Date.now()),
  }
}

async function prepare(backend: ReturnType<typeof createTestBackend>) {
  await backend.mutation(internal.migrations.prepareHistorySummaries, {})
  await backend.finishAllScheduledFunctions(vi.runAllTimers, 1000)
}

describe("résumés d’historique", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("lit un historique de 840 opérations sans dépasser 200 documents par requête ni par lot de reprise", async () => {
    const {
      backend,
      member,
      reader,
      admin,
      access,
      userId,
      a,
      b,
      characterId,
      week,
    } = await fixture(200)
    await admin.mutation(api.administration.saveAccountAccess, {
      userId,
      role: "reader",
      access: {
        ...access,
        sections: [...access.sections, "harvests"],
      },
    })
    for (let batch = 0; batch < 28; batch++)
      await backend.run(async (ctx) => {
        for (let offset = 0; offset < 10; offset++) {
          const index = batch * 10 + offset
          const occurredAt =
            week - Math.floor(index / 7) * WEEK_IN_MILLISECONDS + (index % 7)
          for (const productId of [a, b])
            await ctx.db.insert("transactions", {
              actorCharacterId: characterId,
              actorName: "Mira",
              kind: "sale",
              productId,
              productName: "Vente",
              quantity: 1,
              occurredAt,
              source: "web",
              total: 3,
            })
          const transactionId = await ctx.db.insert("transactions", {
            actorCharacterId: characterId,
            actorName: "Mira",
            kind: "harvest",
            financial: false,
            productName: "Récolte",
            quantity: 2,
            occurredAt,
            source: "web",
            total: 0,
          })
          await ctx.db.insert("transactionLines", {
            transactionId,
            productId: a,
            kind: "product",
            productName: "Public",
            quantity: 2,
            unitPrice: 0,
            total: 0,
            purchaseUnitPrice: 4,
          })
        }
      })
    // The same strict read budget demonstrates the original full scans fail.
    await expect(
      member.query(api.harvests.listGroups, { page: 0 })
    ).rejects.toThrow("Scanned too many documents")
    await expect(reader.query(api.accounts.overview, {})).rejects.toThrow(
      "Scanned too many documents"
    )
    const first = await backend.mutation(
      internal.migrations.prepareHistorySummaries,
      {}
    )
    expect(first).toEqual({ ready: false, indexedTransactions: 10 })
    await backend.finishAllScheduledFunctions(vi.runAllTimers, 1000)
    await backend.mutation(
      internal.migrations.prepareHarvestReaderSummaries,
      {}
    )
    await backend.finishAllScheduledFunctions(vi.runAllTimers, 1000)
    expect(await reader.query(api.harvests.listWeeks, {})).toHaveLength(40)
    expect(
      (await reader.query(api.harvests.listGroups, { page: 0 })).groups[0]
    ).toMatchObject({ harvestCount: 280, quantity: 560, knownValue: 2240 })
    expect(
      (
        await reader.query(api.harvests.listGroups, {
          page: 0,
          weekStartsAt: week,
        })
      ).groups[0]?.harvestCount
    ).toBe(7)
    expect(
      (
        await reader.query(api.harvests.listPage, {
          paginationOpts: { cursor: null, numItems: 30 },
        })
      ).page
    ).toHaveLength(30)
    expect(
      (await member.query(api.harvests.listGroups, { page: 0 })).groups[0]
    ).toMatchObject({
      harvestCount: 280,
      quantity: 560,
      lineCount: 280,
      knownValue: 2240,
      unpricedLineCount: 0,
    })
    expect(await member.query(api.harvests.listWeeks, {})).toHaveLength(40)
    expect(
      (
        await member.query(api.harvests.listGroups, {
          page: 0,
          weekStartsAt: week,
        })
      ).groups[0]?.harvestCount
    ).toBe(7)
    const account = await reader.query(api.accounts.overview, {})
    expect(account.journalBalance).toBe(840)
    expect(account.weeks[0]).toMatchObject({
      incoming: 21,
      outgoing: 0,
      transactionCount: 7,
    })
    expect((await member.query(api.accounts.overview, {})).journalBalance).toBe(
      1680
    )
    expect(await member.query(api.dashboard.overview, {})).toMatchObject({
      weeklyBalance: 42,
      weeklyTransactionCount: 14,
    })
    const dashboard = await reader.query(api.dashboard.overview, {})
    expect(dashboard).toMatchObject({
      weeklyBalance: 21,
      weeklyTransactionCount: 7,
    })
    expect(dashboard.recentTransactions).toHaveLength(8)
    expect(
      dashboard.recentTransactions.every(
        (transaction) => transaction.productId === a
      )
    ).toBe(true)
    const page = await member.query(api.harvests.listPage, {
      paginationOpts: { cursor: null, numItems: 30 },
    })
    expect(page.page).toHaveLength(30)
    expect(page.isDone).toBe(false)
    expect(
      await backend.mutation(internal.migrations.prepareHistorySummaries, {})
    ).toEqual({ ready: true, indexedTransactions: 0 })
    expect((await reader.query(api.accounts.overview, {})).journalBalance).toBe(
      840
    )
  }, 20_000)

  it("reprend les anciennes récoltes sans prix et absorbe les corrections, suppressions et créations pendant la reprise", async () => {
    const { backend, member, reader, a, characterId, week } = await fixture()
    const ids = await backend.run(async (ctx) => {
      const ids = []
      for (let index = 0; index < 24; index++) {
        const transactionId = await ctx.db.insert("transactions", {
          actorCharacterId: characterId,
          actorName: "Mira",
          kind: "harvest",
          financial: false,
          productName: "Ancienne récolte",
          quantity: 1,
          occurredAt: week - WEEK_IN_MILLISECONDS,
          source: "web",
          total: 0,
        })
        await ctx.db.insert("transactionLines", {
          transactionId,
          kind: "product",
          productId: a,
          productName: "Public",
          quantity: 1,
          unitPrice: 0,
          total: 0,
        })
        ids.push(transactionId)
      }
      return ids
    })
    await backend.mutation(internal.migrations.prepareHistorySummaries, {})
    // One indexed and one not-yet-indexed record must both be corrected exactly once.
    for (const transactionId of [ids[0]!, ids[20]!])
      await member.mutation(api.harvests.update, {
        transactionId,
        characterId,
        occurredAt: week,
        lines: [{ productId: a, quantity: 3 }],
      })
    for (const transactionId of [ids[1]!, ids[21]!])
      await member.mutation(api.transactions.remove, { transactionId })
    await member.mutation(api.harvests.record, {
      characterId,
      occurredAt: week,
      lines: [{ productId: a, quantity: 2 }],
    })
    await backend.finishAllScheduledFunctions(vi.runAllTimers, 1000)
    const all = await member.query(api.harvests.listGroups, { page: 0 })
    expect(all.groups[0]).toMatchObject({
      harvestCount: 23,
      quantity: 28,
      lineCount: 23,
      knownValue: 8,
      unpricedLineCount: 22,
    })
    expect(
      (
        await member.query(api.harvests.listGroups, {
          page: 0,
          weekStartsAt: week,
        })
      ).groups[0]
    ).toMatchObject({
      harvestCount: 3,
      quantity: 8,
      knownValue: 8,
      unpricedLineCount: 2,
    })
    expect((await reader.query(api.accounts.overview, {})).journalBalance).toBe(
      0
    )
    await prepare(backend)
    expect(await member.query(api.harvests.listGroups, { page: 0 })).toEqual(
      all
    )
  })

  it("maintient les soldes lecteurs après changement de produit, de semaine et de type puis suppression", async () => {
    const {
      backend,
      member,
      reader,
      a,
      b,
      characterId,
      week,
      admin,
      userId,
      access,
    } = await fixture()
    await prepare(backend)
    const { transactionId } = await member.mutation(
      api.transactions.recordTrade,
      {
        characterId,
        kind: "sale",
        occurredAt: week - 12 * WEEK_IN_MILLISECONDS,
        lines: [{ kind: "product", productId: a, quantity: 2 }],
      }
    )
    expect((await reader.query(api.accounts.overview, {})).journalBalance).toBe(
      6
    )
    expect(
      (await reader.query(api.dashboard.overview, {})).weeklyTransactionCount
    ).toBe(0)
    await member.mutation(api.transactions.updateExchange, {
      transactionId,
      characterId,
      occurredAt: week,
      counterparty: "",
      comment: "",
      discount: 0,
      lines: [
        { kind: "product", productId: b, quantity: 1, direction: "outgoing" },
      ],
    })
    expect((await reader.query(api.accounts.overview, {})).journalBalance).toBe(
      0
    )
    await admin.mutation(api.administration.saveAccountAccess, {
      userId,
      role: "reader",
      access: { ...access, productIds: [a, b] },
    })
    expect((await reader.query(api.accounts.overview, {})).journalBalance).toBe(
      3
    )
    await member.mutation(api.transactions.updateExchange, {
      transactionId,
      characterId,
      occurredAt: week,
      counterparty: "",
      comment: "",
      discount: 0,
      lines: [
        { kind: "product", productId: a, quantity: 1, direction: "incoming" },
      ],
    })
    expect((await reader.query(api.accounts.overview, {})).journalBalance).toBe(
      -4
    )
    expect((await reader.query(api.dashboard.overview, {})).weeklyBalance).toBe(
      -4
    )
    await member.mutation(api.transactions.remove, { transactionId })
    expect((await reader.query(api.accounts.overview, {})).journalBalance).toBe(
      0
    )
    expect(
      (await reader.query(api.dashboard.overview, {})).recentTransactions
    ).toEqual([])
  })

  it("reprend les soldes historiques sans doubler les opérations modifiées pendant les lots", async () => {
    const { backend, member, reader, a, characterId, week } = await fixture()
    const ids = await backend.run(async (ctx) => {
      const ids = []
      for (let index = 0; index < 24; index++)
        ids.push(
          await ctx.db.insert("transactions", {
            actorCharacterId: characterId,
            actorName: "Mira",
            kind: "sale",
            productId: a,
            productName: "Public",
            quantity: 1,
            occurredAt: week - 12 * WEEK_IN_MILLISECONDS,
            source: "web",
            total: 3,
          })
        )
      return ids
    })
    await backend.mutation(internal.migrations.prepareHistorySummaries, {})
    for (const transactionId of [ids[0]!, ids[20]!])
      await member.mutation(api.transactions.updateExchange, {
        transactionId,
        characterId,
        occurredAt: week,
        lines: [
          { kind: "product", productId: a, quantity: 2, direction: "outgoing" },
        ],
      })
    for (const transactionId of [ids[1]!, ids[21]!])
      await member.mutation(api.transactions.remove, { transactionId })
    await member.mutation(api.transactions.recordExchange, {
      characterId,
      occurredAt: week,
      lines: [
        { kind: "product", productId: a, quantity: 1, direction: "incoming" },
      ],
    })
    await backend.finishAllScheduledFunctions(vi.runAllTimers, 1000)
    const account = await reader.query(api.accounts.overview, {})
    expect(account.journalBalance).toBe(68)
    expect(account.weeks[0]).toMatchObject({
      incoming: 12,
      outgoing: 4,
      transactionCount: 3,
      salary: 3,
    })
    await prepare(backend)
    expect(await reader.query(api.accounts.overview, {})).toEqual(account)
  })

  it("masque les échanges mixtes et recontrôle les lots modifiés sans revaloriser les ventes passées", async () => {
    const {
      backend,
      member,
      admin,
      reader,
      a,
      b,
      characterId,
      week,
      userId,
      access,
    } = await fixture()
    await prepare(backend)
    const mixed = await member.mutation(api.transactions.recordExchange, {
      characterId,
      occurredAt: week,
      lines: [
        { kind: "product", productId: a, quantity: 1, direction: "outgoing" },
        { kind: "product", productId: b, quantity: 1, direction: "incoming" },
      ],
    })
    expect((await reader.query(api.accounts.overview, {})).journalBalance).toBe(
      0
    )
    expect(
      await reader.query(api.transactions.getDetails, {
        transactionId: mixed.transactionId,
      })
    ).toBeNull()
    const bundleId = await member.mutation(api.bundles.save, {
      name: "Lot",
      price: 6,
      items: [{ productId: a, quantity: 2 }],
    })
    const sale = await member.mutation(api.transactions.recordTrade, {
      characterId,
      occurredAt: week,
      kind: "sale",
      lines: [{ kind: "bundle", bundleId, quantity: 1 }],
    })
    expect((await reader.query(api.accounts.overview, {})).journalBalance).toBe(
      6
    )
    expect(
      (await reader.query(api.dashboard.overview, {})).recentTransactions.map(
        (transaction) => transaction._id
      )
    ).toEqual([sale.transactionId])
    await member.mutation(api.bundles.save, {
      bundleId,
      name: "Lot",
      price: 100,
      items: [{ productId: b, quantity: 2 }],
    })
    expect((await reader.query(api.accounts.overview, {})).journalBalance).toBe(
      0
    )
    expect(
      await reader.query(api.transactions.getDetails, {
        transactionId: sale.transactionId,
      })
    ).toBeNull()
    await admin.mutation(api.administration.saveAccountAccess, {
      userId,
      role: "reader",
      access: { ...access, productIds: [a, b] },
    })
    expect((await reader.query(api.accounts.overview, {})).journalBalance).toBe(
      5
    )
    await admin.mutation(api.administration.saveAccountAccess, {
      userId,
      role: "reader",
      access: { ...access, productIds: [a, b], showPurchasePrices: false },
    })
    expect((await reader.query(api.accounts.overview, {})).journalBalance).toBe(
      0
    )
    expect((await reader.query(api.dashboard.overview, {})).weeklyBalance).toBe(
      0
    )
  })

  it("actualise les résumés des commandes lors des corrections de références et de date", async () => {
    const { backend, member, reader, a, b, characterId, week } = await fixture()
    await prepare(backend)
    const orderId = await member.mutation(api.orders.save, {
      contactName: "Client",
      kind: "client",
      dueAt: null,
      lines: [{ productId: a, quantity: 2, unitPrice: 3 }],
      notes: "",
      status: "open",
      total: null,
    })
    await member.mutation(api.orders.process, {
      orderId,
      characterId,
      occurredAt: week,
    })
    expect(
      (await reader.query(api.accounts.overview, {})).weeks[0]
    ).toMatchObject({ incoming: 6, salary: 0 })
    await member.mutation(api.orders.save, {
      orderId,
      contactName: "Client",
      kind: "client",
      dueAt: null,
      lines: [{ productId: b, quantity: 1, unitPrice: 8 }],
      notes: "",
      status: "open",
      total: null,
    })
    expect((await reader.query(api.accounts.overview, {})).journalBalance).toBe(
      0
    )
    await member.mutation(api.orders.save, {
      orderId,
      contactName: "Client",
      kind: "client",
      dueAt: null,
      lines: [{ productId: a, quantity: 1, unitPrice: 5 }],
      notes: "",
      status: "open",
      total: null,
      actorCharacterId: characterId,
      processedAt: week - 2 * WEEK_IN_MILLISECONDS,
    })
    const account = await reader.query(api.accounts.overview, {})
    expect(account.journalBalance).toBe(5)
    expect(account.weeks[0]?.transactionCount).toBe(0)
    expect(account.weeks[2]).toMatchObject({
      incoming: 5,
      transactionCount: 1,
      salary: 0,
    })
  })

  it("reprend un import effectué après l’initialisation puis son actualisation sans perdre ni doubler les soldes", async () => {
    const { backend, member, reader } = await fixture()
    await prepare(backend)
    const oldSecret = process.env.SEED_SECRET
    process.env.SEED_SECRET = "secret-de-test-valide"
    try {
      await backend.mutation(api.seed.importWorkbook, {
        seedSecret: "secret-de-test-valide",
      })
      await backend.finishAllScheduledFunctions(vi.runAllTimers, 1000)
      const balance = seedData.transactions.reduce(
        (total, transaction) => total + transaction.total,
        0
      )
      const readScopeBalance = () =>
        backend.run(async (ctx) =>
          (await ctx.db.query("transactionVisibilityScopes").collect()).reduce(
            (total, scope) => total + scope.balance,
            0
          )
        )
      expect(await readScopeBalance()).toBe(balance)
      expect(
        (await member.query(api.accounts.overview, {})).journalBalance
      ).toBe(balance)
      expect(
        (await reader.query(api.accounts.overview, {})).journalBalance
      ).toBe(0)
      await backend.mutation(
        internal.migrations.refreshWorkbookTransactions,
        {}
      )
      await backend.finishAllScheduledFunctions(vi.runAllTimers, 1000)
      expect(await readScopeBalance()).toBe(balance)
      expect(
        (await member.query(api.accounts.overview, {})).journalBalance
      ).toBe(balance)
    } finally {
      if (oldSecret === undefined) delete process.env.SEED_SECRET
      else process.env.SEED_SECRET = oldSecret
    }
  })
})
