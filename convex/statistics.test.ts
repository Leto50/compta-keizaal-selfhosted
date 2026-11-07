import { describe, expect, it } from "vitest"
import { type FunctionReturnType } from "convex/server"
import { api } from "./_generated/api"
import { asAuthenticatedUser, createTestBackend } from "./test.helpers"
import { defaultReaderAccess, type ReaderAccess } from "../shared/reader-access"
import {
  mergeStatistics,
  statisticsTotals,
  type StatisticsBatch,
} from "../shared/statistics"

async function fixture() {
  const backend = createTestBackend()
  const member = await asAuthenticatedUser(backend)
  const reader = await asAuthenticatedUser(backend, "reader")
  const user = await reader.query(api.auth.getCurrentUser, {})
  if (!user) throw new Error("Lecteur absent")
  const ids = await backend.run(async (ctx) => {
    const base = {
      active: true,
      category: "ingredient" as const,
      currentStock: 100,
      minimumStock: 0,
      tracksStock: true,
    }
    const wheat = await ctx.db.insert("products", {
      ...base,
      name: "Blé",
      normalizedName: "ble",
    })
    const salt = await ctx.db.insert("products", {
      ...base,
      name: "Sel",
      normalizedName: "sel",
    })
    const old = Date.UTC(2019, 0, 1)
    const recent = Date.UTC(2026, 9, 1)
    const baseTransaction = {
      actorName: "Identité privée",
      actorUserId: "compte-prive",
      comment: "Commentaire confidentiel",
      counterparty: "Contact confidentiel",
      source: "web" as const,
      productName: "Blé",
      productId: wheat,
      quantity: 1,
    }
    await ctx.db.insert("transactions", {
      ...baseTransaction,
      kind: "sale",
      occurredAt: old,
      total: 5,
    })
    const exchange = await ctx.db.insert("transactions", {
      ...baseTransaction,
      kind: "exchange",
      occurredAt: recent,
      total: 60,
      outgoingTotal: 90,
      incomingTotal: 30,
      quantity: 13,
      discount: 10,
    })
    await ctx.db.insert("transactionLines", {
      transactionId: exchange,
      kind: "product",
      productId: wheat,
      productName: "Blé",
      direction: "outgoing",
      quantity: 10,
      unitPrice: 10,
      total: 100,
    })
    await ctx.db.insert("transactionLines", {
      transactionId: exchange,
      kind: "product",
      productId: salt,
      productName: "Sel",
      direction: "incoming",
      quantity: 3,
      unitPrice: 10,
      total: 30,
    })
    const harvest = await ctx.db.insert("transactions", {
      ...baseTransaction,
      kind: "harvest",
      occurredAt: recent,
      total: 0,
      quantity: 5,
    })
    await ctx.db.insert("transactionLines", {
      transactionId: harvest,
      kind: "product",
      productId: wheat,
      productName: "Blé",
      quantity: 4,
      unitPrice: 0,
      total: 0,
      purchaseUnitPrice: 2,
    })
    await ctx.db.insert("transactionLines", {
      transactionId: harvest,
      kind: "product",
      productId: salt,
      productName: "Sel",
      quantity: 1,
      unitPrice: 0,
      total: 0,
    })
    await ctx.db.insert("transactions", {
      ...baseTransaction,
      kind: "production",
      occurredAt: recent,
      total: 999,
      quantity: 3,
    })
    await ctx.db.insert("transactions", {
      ...baseTransaction,
      kind: "adjustment",
      occurredAt: recent,
      total: 999,
      quantity: 10,
    })
    const order = await ctx.db.insert("orders", {
      kind: "client",
      contactName: "Client privé",
      status: "open",
      total: 75,
    })
    await ctx.db.insert("orderLines", {
      orderId: order,
      productId: wheat,
      productName: "Blé",
      quantity: 5,
      unitPrice: 15,
      total: 75,
    })
    return { wheat, salt, old, recent, order }
  })
  const policy = async (changes: Partial<ReaderAccess>) => {
    await backend.run(async (ctx) => {
      const existing = await ctx.db
        .query("readerAccess")
        .withIndex("by_user", (index) => index.eq("userId", user._id))
        .unique()
      const value = {
        ...defaultReaderAccess,
        sections: [...defaultReaderAccess.sections, "statistics" as const],
        ...changes,
        productIds: changes.productIds as (typeof ids.wheat)[] | undefined,
        userId: user._id,
        updatedBy: "admin",
        updatedAt: Date.now(),
      }
      if (existing) await ctx.db.replace(existing._id, value)
      else await ctx.db.insert("readerAccess", value)
    })
  }
  return { backend, member, reader, policy, ...ids }
}

const paginationOpts = { cursor: null, numItems: 40 }
const TODAY = Date.UTC(2026, 9, 15)

describe("statistiques : cohérence métier", () => {
  it("retrouve les flux du Compte après un échange réel et ignore les paramètres de charges actuels", async () => {
    const { backend, member, wheat, salt, recent } = await fixture()
    const characterId = await backend.run((ctx) =>
      ctx.db.insert("characters", { active: true, name: "Privé" })
    )
    await member.mutation(api.transactions.recordExchange, {
      characterId,
      occurredAt: recent,
      discount: 10,
      lines: [
        {
          kind: "product",
          direction: "outgoing",
          productId: wheat,
          quantity: 10,
          unitPrice: 10,
        },
        {
          kind: "product",
          direction: "incoming",
          productId: salt,
          quantity: 3,
          unitPrice: 10,
        },
      ],
    })
    const args = {
      from: Date.UTC(2026, 8, 28),
      to: Date.UTC(2026, 9, 5),
      paginationOpts,
    }
    const totals = statisticsTotals(
      mergeStatistics(
        (await member.query(api.statistics.transactionsPage, args)).page
      )
    )
    const account = await member.query(api.accounts.overview, {
      currentWeekStartsAt: args.from,
    })
    expect(totals.incoming).toBe(account.weeks[0]!.incoming)
    expect(totals.outgoing).toBe(account.weeks[0]!.outgoing)
    expect(totals.incoming - totals.outgoing).toBe(account.weeks[0]!.net)
    expect(totals.financialCount).toBe(account.weeks[0]!.transactionCount)
    await backend.run((ctx) =>
      ctx.db.insert("accountSettings", {
        key: "main",
        cashBalance: 999999,
        fundsBalance: 888888,
        weeklyRent: 2000,
        censusPerEmployee: 500,
        employeeCount: 6,
        taxRate: 0.5,
        salaryRate: 0.75,
        updatedAt: Date.now(),
        updatedBy: "admin",
      })
    )
    expect(
      statisticsTotals(
        mergeStatistics(
          (await member.query(api.statistics.transactionsPage, args)).page
        )
      )
    ).toEqual(totals)
  })

  it("conserve le total des anciennes commandes sans transformer leur libellé en produit", async () => {
    const { backend, member, recent } = await fixture()
    await backend.run((ctx) =>
      ctx.db.insert("transactions", {
        actorName: "Personne privée",
        kind: "order",
        productName: "Commande de Contact secret",
        quantity: 25,
        total: 500,
        source: "workbook",
        occurredAt: recent,
      })
    )
    const result = await member.query(api.statistics.transactionsPage, {
      paginationOpts,
    })
    const batch = mergeStatistics(result.page)
    expect(statisticsTotals(batch)).toMatchObject({
      incoming: 595,
      unattributedIncoming: 500,
      unattributedCount: 1,
      orderCount: 1,
    })
    expect(batch.products).toHaveLength(2)
    expect(JSON.stringify(result)).not.toContain("Contact secret")
  })

  it("ne devine pas les côtés d’un échange ancien et signale les flux incomplets", async () => {
    const { backend, member, wheat, recent } = await fixture()
    await backend.run(async (ctx) => {
      const id = await ctx.db.insert("transactions", {
        actorName: "Privé",
        kind: "exchange",
        productName: "Échange",
        quantity: 5,
        total: 0,
        incomingTotal: 40,
        outgoingTotal: 40,
        source: "workbook",
        occurredAt: recent,
      })
      await ctx.db.insert("transactionLines", {
        transactionId: id,
        kind: "product",
        productId: wheat,
        productName: "Blé",
        quantity: 5,
        total: 40,
        unitPrice: 8,
      })
      await ctx.db.insert("transactions", {
        actorName: "Privé",
        kind: "exchange",
        productId: wheat,
        productName: "Ancien échange",
        quantity: 8,
        total: -30,
        source: "workbook",
        occurredAt: recent,
      })
    })
    const batch = mergeStatistics(
      (await member.query(api.statistics.transactionsPage, { paginationOpts }))
        .page
    )
    expect(statisticsTotals(batch)).toMatchObject({
      incoming: 135,
      outgoing: 100,
      incompleteFlowCount: 1,
      unattributedCount: 2,
      unattributedIncoming: 40,
      unattributedOutgoing: 70,
    })
    expect(batch.products.find((entry) => entry.name === "Blé")?.sold).toBe(11)
  })

  it("ventile la remise sans réaffecter les lignes inconnues et protège cette ventilation pour les lecteurs", async () => {
    const { backend, member, reader, policy, wheat, recent } = await fixture()
    await backend.run(async (ctx) => {
      const id = await ctx.db.insert("transactions", {
        actorName: "Privé",
        kind: "sale",
        productName: "2 références",
        quantity: 10,
        total: 90,
        discount: 10,
        source: "workbook",
        occurredAt: recent,
      })
      await ctx.db.insert("transactionLines", {
        transactionId: id,
        kind: "product",
        productId: wheat,
        productName: "Blé",
        quantity: 5,
        total: 50,
        unitPrice: 10,
      })
      await ctx.db.insert("transactionLines", {
        transactionId: id,
        kind: "product",
        productName: "Référence non résolue confidentielle",
        quantity: 5,
        total: 50,
        unitPrice: 10,
      })
    })
    const result = await member.query(api.statistics.transactionsPage, {
      paginationOpts,
    })
    const batch = mergeStatistics(result.page)
    expect(statisticsTotals(batch)).toMatchObject({
      incoming: 185,
      unattributedIncoming: 45,
      unattributedCount: 1,
    })
    expect(batch.products.find((entry) => entry.name === "Blé")?.incoming).toBe(
      140
    )
    expect(JSON.stringify(result)).not.toContain("confidentielle")
    await policy({ sections: ["statistics", "account"], showPrices: false })
    expect(
      statisticsTotals(
        mergeStatistics(
          (
            await reader.query(api.statistics.transactionsPage, {
              paginationOpts,
            })
          ).page
        )
      )
    ).toMatchObject({
      incoming: 0,
      unattributedIncoming: 0,
      unattributedOutgoing: 0,
    })
  })

  it("garde les lots distincts et les prix de récolte historiques malgré les modifications du catalogue", async () => {
    const { backend, member, wheat, salt, recent } = await fixture()
    const bundle = await backend.run(async (ctx) => {
      const bundleId = await ctx.db.insert("bundles", {
        active: true,
        name: "Lot de voyage",
        price: 25,
      })
      const item = await ctx.db.insert("bundleItems", {
        bundleId,
        productId: wheat,
        productName: "Blé",
        quantity: 3,
      })
      const transactionId = await ctx.db.insert("transactions", {
        actorName: "Privé",
        kind: "sale",
        productName: "Lot de voyage",
        quantity: 2,
        total: 45,
        source: "web",
        occurredAt: recent,
      })
      await ctx.db.insert("transactionLines", {
        transactionId,
        bundleId,
        kind: "bundle",
        direction: "outgoing",
        productName: "Lot de voyage",
        quantity: 2,
        unitPrice: 25,
        total: 50,
      })
      return { bundleId, item }
    })
    await backend.run(async (ctx) => {
      await ctx.db.patch(wheat, { purchasePrice: 999, salePrice: 999 })
      await ctx.db.patch(bundle.bundleId, { price: 999 })
      await ctx.db.patch(bundle.item, {
        productId: salt,
        productName: "Sel",
        quantity: 50,
      })
    })
    const batch = mergeStatistics(
      (await member.query(api.statistics.transactionsPage, { paginationOpts }))
        .page
    )
    expect(
      batch.products.find((entry) => entry.key === `bundle:${bundle.bundleId}`)
    ).toMatchObject({ sold: 2, incoming: 45 })
    expect(batch.products.find((entry) => entry.name === "Blé")?.sold).toBe(11)
    expect(statisticsTotals(batch)).toMatchObject({
      knownValue: 8,
      unpricedLineCount: 1,
    })
  })

  it("sépare paiement et livraison avec les mutations de commande existantes", async () => {
    const { backend, member, order, recent } = await fixture()
    const characterId = await backend.run((ctx) =>
      ctx.db.insert("characters", { active: true, name: "Privé" })
    )
    await member.mutation(api.orders.process, {
      orderId: order,
      characterId,
      occurredAt: recent,
    })
    const args = { todayStartsAt: TODAY, paginationOpts }
    let snapshot = await member.query(api.statistics.ordersPage, args)
    expect(snapshot.page[0]).toMatchObject({
      kind: "client",
      state: "open",
      count: 1,
      pendingCount: 0,
      total: 0,
    })
    await member.mutation(api.orders.updateStatus, {
      orderId: order,
      status: "delivered",
    })
    snapshot = await member.query(api.statistics.ordersPage, args)
    expect(snapshot.page[0]).toMatchObject({
      state: "completed",
      pendingCount: 0,
      total: 0,
    })
    const batch = mergeStatistics(
      (
        await member.query(api.statistics.transactionsPage, {
          from: recent,
          to: recent + 1,
          paginationOpts,
        })
      ).page
    )
    expect(statisticsTotals(batch)).toMatchObject({
      incoming: 165,
      outgoing: 30,
      orderCount: 1,
    })
    expect(batch.kinds.find((entry) => entry.kind === "order")?.count).toBe(1)
    await backend.run((ctx) =>
      ctx.db.insert("orders", {
        kind: "client",
        status: "delivered",
        contactName: "Contact privé",
        total: 75,
        legacyKey: "imported-order",
        dueAt: TODAY - 86400000,
      })
    )
    snapshot = await member.query(api.statistics.ordersPage, args)
    expect(
      snapshot.page.find((entry) => entry.state === "unsettled")
    ).toMatchObject({
      state: "unsettled",
      pendingCount: 1,
      total: 75,
      overdueCount: 1,
    })
  })
})

describe("statistics", () => {
  it("exige une session et un accès explicite aux statistiques", async () => {
    const { backend, reader } = await fixture()
    await expect(
      backend.query(api.statistics.transactionsPage, { paginationOpts })
    ).rejects.toThrow("Vous devez être connecté")
    await expect(
      reader.query(api.statistics.transactionsPage, { paginationOpts })
    ).rejects.toThrow("Votre accès ne permet pas")
  })

  it("agrège tous les mouvements, conserve les flux des échanges après remise et exclut les personnes", async () => {
    const { member } = await fixture()
    const result = await member.query(api.statistics.transactionsPage, {
      paginationOpts,
    })
    const batch = mergeStatistics(result.page)
    expect(statisticsTotals(batch)).toMatchObject({
      incoming: 95,
      outgoing: 30,
      transactionCount: 5,
      financialCount: 2,
      harvestCount: 1,
      harvestQuantity: 5,
      knownValue: 8,
      unpricedLineCount: 1,
      productionQuantity: 3,
    })
    expect(
      batch.products.find((product) => product.name === "Blé")
    ).toMatchObject({ sold: 11, incoming: 95, harvested: 4, produced: 3 })
    expect(
      batch.products.find((product) => product.name === "Sel")
    ).toMatchObject({ purchased: 3, outgoing: 30, harvested: 1 })
    expect(JSON.stringify(result)).not.toMatch(
      /Identité privée|compte-prive|confidentiel|actorName|actorUserId|actorCharacterId|counterparty|comment/
    )
  })

  it("parcourt tout l’historique par lots, sans couper les premiers enregistrements", async () => {
    const { backend, member, wheat, old } = await fixture()
    await backend.run(async (ctx) => {
      for (let index = 0; index < 90; index++)
        await ctx.db.insert("transactions", {
          actorName: "Privé",
          kind: "sale",
          productId: wheat,
          productName: "Blé",
          quantity: 1,
          occurredAt: old + index,
          source: "workbook",
          total: 1,
        })
    })
    const batches: StatisticsBatch[] = []
    let cursor: string | null = null
    let pages = 0
    for (;;) {
      const result: FunctionReturnType<typeof api.statistics.transactionsPage> =
        await member.query(api.statistics.transactionsPage, {
          paginationOpts: { cursor, numItems: 1000 },
        })
      batches.push(...result.page)
      pages++
      if (result.isDone) break
      cursor = result.continueCursor
    }
    expect(pages).toBe(3)
    expect(statisticsTotals(mergeStatistics(batches))).toMatchObject({
      incoming: 185,
      transactionCount: 95,
    })
    expect(mergeStatistics(batches).days[0]?.startsAt).toBe(old)
  })

  it("respecte les bornes inclusives et exclusives et refuse les périodes invalides", async () => {
    const { member, old, recent } = await fixture()
    const result = await member.query(api.statistics.transactionsPage, {
      from: old,
      to: recent,
      paginationOpts,
    })
    expect(
      statisticsTotals(mergeStatistics(result.page)).transactionCount
    ).toBe(1)
    for (const range of [
      { from: recent, to: old },
      { from: old, to: old },
      { from: 0.5 },
      { to: Infinity },
    ]) {
      await expect(
        member.query(api.statistics.transactionsPage, {
          ...range,
          paginationOpts,
        })
      ).rejects.toThrow("période sélectionnée est invalide")
    }
  })

  it("filtre les rubriques, produits et types d’opérations côté serveur", async () => {
    const { reader, policy, wheat } = await fixture()
    await policy({
      sections: ["statistics", "account", "harvests"],
      productIds: [wheat],
      operationKinds: ["sale"],
    })
    const result = await reader.query(api.statistics.transactionsPage, {
      paginationOpts,
    })
    expect(statisticsTotals(mergeStatistics(result.page))).toMatchObject({
      incoming: 5,
      transactionCount: 1,
      harvestCount: 0,
    })
    expect(JSON.stringify(result)).not.toContain("Sel")
    await policy({ sections: ["statistics"] })
    const empty = await reader.query(api.statistics.transactionsPage, {
      paginationOpts,
    })
    expect(mergeStatistics(empty.page).days).toEqual([])
    await expect(
      reader.query(api.statistics.ordersPage, {
        todayStartsAt: TODAY,
        paginationOpts,
      })
    ).rejects.toThrow("Votre accès ne permet pas")
  })

  it("retire les montants protégés, y compris ceux des produits et des récoltes", async () => {
    const { reader, policy } = await fixture()
    await policy({
      sections: ["statistics", "transactions", "harvests", "orders"],
      showPrices: false,
    })
    const result = await reader.query(api.statistics.transactionsPage, {
      paginationOpts,
    })
    const batch = mergeStatistics(result.page)
    expect(statisticsTotals(batch)).toMatchObject({
      incoming: 0,
      outgoing: 0,
      knownValue: 0,
      harvestQuantity: 5,
      financialCount: 2,
    })
    expect(
      batch.products.every(
        (product) => product.incoming === 0 && product.outgoing === 0
      )
    ).toBe(true)
    const orders = await reader.query(api.statistics.ordersPage, {
      todayStartsAt: TODAY,
      paginationOpts,
    })
    expect(orders.page[0]).toMatchObject({ total: 0, count: 1 })
    await policy({
      sections: ["statistics", "transactions", "harvests"],
      showSalePrices: false,
    })
    const saleHidden = statisticsTotals(
      mergeStatistics(
        (
          await reader.query(api.statistics.transactionsPage, {
            paginationOpts,
          })
        ).page
      )
    )
    expect(saleHidden).toMatchObject({
      incoming: 0,
      outgoing: 0,
      knownValue: 8,
    })
  })

  it("compte les commandes sans révéler les contacts ni ajouter leur montant au journal", async () => {
    const { member, reader, policy, salt } = await fixture()
    const orders = await member.query(api.statistics.ordersPage, {
      todayStartsAt: TODAY,
      paginationOpts,
    })
    expect(orders.page[0]).toMatchObject({
      kind: "client",
      state: "open",
      count: 1,
      pendingCount: 1,
      total: 75,
    })
    expect(JSON.stringify(orders)).not.toMatch(
      /Client privé|contactName|contactId/
    )
    await policy({ sections: ["statistics", "orders"], productIds: [salt] })
    expect(
      (
        await reader.query(api.statistics.ordersPage, {
          todayStartsAt: TODAY,
          paginationOpts,
        })
      ).page
    ).toEqual([])
  })
})
