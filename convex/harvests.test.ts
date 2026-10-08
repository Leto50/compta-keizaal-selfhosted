import { describe, expect, it } from "vitest"

import { api, internal } from "./_generated/api"
import { asAuthenticatedUser, createTestBackend } from "./test.helpers"

const pageArgs = { paginationOpts: { cursor: null, numItems: 30 } }

async function setup() {
  const backend = createTestBackend()
  const member = await asAuthenticatedUser(backend)
  const ids = await backend.run(async (ctx) => {
    const characterId = await ctx.db.insert("characters", {
      active: true,
      name: "Alixard Veliane",
    })
    const productIds = []
    for (const name of ["Lys bleu", "Sel de feu"]) {
      productIds.push(
        await ctx.db.insert("products", {
          active: true,
          category: "ingredient",
          currentStock: 2,
          minimumStock: 3,
          name,
          normalizedName: name.toLowerCase(),
          purchasePrice: 4,
          salePrice: 8,
          tracksStock: true,
        })
      )
    }
    return { characterId, productIds }
  })
  return {
    backend,
    member,
    ...ids,
    args: {
      characterId: ids.characterId,
      occurredAt: Date.now(),
      lines: ids.productIds.map((productId, index) => ({
        productId,
        quantity: index + 3,
      })),
    },
  }
}

async function stockState(backend: ReturnType<typeof createTestBackend>) {
  return backend.run(async (ctx) => ({
    products: await ctx.db.query("products").collect(),
    transactions: await ctx.db.query("transactions").collect(),
    lines: await ctx.db.query("transactionLines").collect(),
    movements: await ctx.db.query("stockMovements").collect(),
    audits: await ctx.db.query("auditLogs").collect(),
  }))
}

describe("récoltes", () => {
  it("ajoute plusieurs ingrédients et conserve le personnage, le compte, la date et les quantités", async () => {
    const { backend, member, args, characterId, productIds } = await setup()
    const { transactionId } = await member.mutation(api.harvests.record, {
      ...args,
      comment: "  Autour de Blancherive  ",
    })
    const state = await stockState(backend)
    expect(state.products.map((product) => product.currentStock)).toEqual([
      5, 6,
    ])
    expect(state.transactions).toEqual([
      expect.objectContaining({
        _id: transactionId,
        actorCharacterId: characterId,
        actorName: "Alixard Veliane",
        actorUserId: expect.any(String) as string,
        comment: "Autour de Blancherive",
        kind: "harvest",
        occurredAt: args.occurredAt,
        financial: false,
        quantity: 7,
        total: 0,
      }),
    ])
    expect(state.lines).toEqual([
      expect.objectContaining({
        productId: productIds[0],
        productName: "Lys bleu",
        quantity: 3,
        direction: "incoming",
        total: 0,
        transactionId,
      }),
      expect.objectContaining({
        productId: productIds[1],
        productName: "Sel de feu",
        quantity: 4,
        direction: "incoming",
        total: 0,
        transactionId,
      }),
    ])
    expect(state.movements).toEqual([
      expect.objectContaining({
        productId: productIds[0],
        previousStock: 2,
        resultingStock: 5,
        delta: 3,
        reason: "harvest",
        occurredAt: args.occurredAt,
        transactionId,
      }),
      expect.objectContaining({
        productId: productIds[1],
        previousStock: 2,
        resultingStock: 6,
        delta: 4,
        reason: "harvest",
        occurredAt: args.occurredAt,
        transactionId,
      }),
    ])
    expect(state.audits[0]).toMatchObject({
      action: "harvest.recorded",
      actorUserId: state.transactions[0]?.actorUserId,
    })

    await backend.run(async (ctx) => {
      await ctx.db.patch(characterId, { active: false, name: "Nom modifié" })
      await ctx.db.patch(productIds[0]!, {
        active: false,
        name: "Ingrédient renommé",
      })
    })
    const page = await member.query(api.harvests.listPage, pageArgs)
    expect(page.page[0]?.actorName).toBe("Alixard Veliane")
    expect(page.page[0]?.lines[0]?.productName).toBe("Lys bleu")
  })

  it.each([0, -1, 1.5, 1_000_001, NaN, Infinity])(
    "refuse la quantité %s sans modifier aucun stock",
    async (quantity) => {
      const { backend, member, args } = await setup()
      const before = await stockState(backend)
      await expect(
        member.mutation(api.harvests.record, {
          ...args,
          lines: [args.lines[0]!, { ...args.lines[1]!, quantity }],
        })
      ).rejects.toThrow()
      expect(await stockState(backend)).toEqual(before)
    }
  )

  it.each([
    { active: false },
    { category: "potion" as const },
    { category: "service" as const, tracksStock: false },
    { tracksStock: false },
    { currentStock: 999_999 },
  ])(
    "refuse atomiquement un ingrédient indisponible ou un stock excessif : %j",
    async (patch) => {
      const { backend, member, args, productIds } = await setup()
      await backend.run((ctx) => ctx.db.patch(productIds[1]!, patch))
      const before = await stockState(backend)
      await expect(member.mutation(api.harvests.record, args)).rejects.toThrow()
      expect(await stockState(backend)).toEqual(before)
    }
  )

  it("refuse les doublons, les listes vides ou trop longues, les commentaires et dates invalides", async () => {
    const { backend, member, args } = await setup()
    const before = await stockState(backend)
    for (const invalidArgs of [
      { ...args, lines: [] },
      { ...args, lines: [args.lines[0]!, args.lines[0]!] },
      { ...args, lines: Array.from({ length: 51 }, () => args.lines[0]!) },
      { ...args, comment: "x".repeat(501) },
      { ...args, occurredAt: -1 },
      { ...args, occurredAt: Date.now() + 2 * 86_400_000 },
      { ...args, occurredAt: Infinity },
    ]) {
      await expect(
        member.mutation(api.harvests.record, invalidArgs)
      ).rejects.toThrow()
      expect(await stockState(backend)).toEqual(before)
    }
  })

  it("refuse un personnage archivé ou un ingrédient supprimé", async () => {
    const { backend, member, args, characterId, productIds } = await setup()
    await backend.run((ctx) => ctx.db.patch(characterId, { active: false }))
    await expect(member.mutation(api.harvests.record, args)).rejects.toThrow(
      "Personnage introuvable"
    )
    await backend.run(async (ctx) => {
      await ctx.db.patch(characterId, { active: true })
      await ctx.db.delete(productIds[1]!)
    })
    const before = await stockState(backend)
    await expect(member.mutation(api.harvests.record, args)).rejects.toThrow(
      "ingrédient actif"
    )
    expect(await stockState(backend)).toEqual(before)
  })

  it.each([false, true])(
    "actualise l’inventaire sans modifier le journal, les semaines ou les salaires (projections : %s)",
    async (ready) => {
      const { backend, member, args } = await setup()
      if (ready)
        await backend.mutation(internal.migrations.rebuildReadModels, {})
      const beforeAccount = await member.query(api.accounts.overview, {})
      const beforeDashboard = await member.query(api.dashboard.overview, {})
      const { transactionId } = await member.mutation(api.harvests.record, args)
      expect(await member.query(api.accounts.overview, {})).toEqual(
        beforeAccount
      )
      const dashboard = await member.query(api.dashboard.overview, {})
      expect(dashboard).toMatchObject({
        weeklyBalance: beforeDashboard.weeklyBalance,
        weeklyTransactionCount: beforeDashboard.weeklyTransactionCount,
        recentTransactions: [],
        lowStockCount: 0,
        stockValue: beforeDashboard.stockValue + 7 * 4,
      })
      expect(
        (await member.query(api.transactions.listPage, pageArgs)).page
      ).toEqual([])
      expect(
        (
          await member.query(api.transactions.listPage, {
            ...pageArgs,
            q: "Lys",
          })
        ).page
      ).toEqual([])
      await backend.mutation(internal.migrations.rebuildReadModels, {})
      expect(await member.query(api.accounts.overview, {})).toEqual(
        beforeAccount
      )
      await member.mutation(api.transactions.remove, { transactionId })
      expect((await member.query(api.dashboard.overview, {})).stockValue).toBe(
        beforeDashboard.stockValue
      )
      expect(await member.query(api.accounts.overview, {})).toEqual(
        beforeAccount
      )
    }
  )

  it("réserve la saisie et l’historique aux employés et administrateurs", async () => {
    const { backend, member, args } = await setup()
    const reader = await asAuthenticatedUser(backend, "reader")
    const admin = await asAuthenticatedUser(backend, "admin")
    await expect(backend.mutation(api.harvests.record, args)).rejects.toThrow(
      "connecté"
    )
    await expect(
      backend.query(api.harvests.listPage, pageArgs)
    ).rejects.toThrow("connecté")
    await expect(reader.mutation(api.harvests.record, args)).rejects.toThrow(
      "lecture seule"
    )
    await expect(reader.query(api.harvests.listPage, pageArgs)).rejects.toThrow(
      "lecture seule"
    )
    const { transactionId } = await member.mutation(api.harvests.record, args)
    expect(
      await reader.query(api.transactions.getDetails, { transactionId })
    ).toBeNull()
    expect(await reader.query(api.transactions.list, {})).toEqual([])
    await expect(
      reader.mutation(api.transactions.remove, { transactionId })
    ).rejects.toThrow("lecture seule")
    await admin.mutation(api.harvests.record, args)
    expect(
      (await admin.query(api.harvests.listPage, pageArgs)).page
    ).toHaveLength(2)
  })

  it("pagine les récoltes par date, de la plus récente à la plus ancienne", async () => {
    const { member, args } = await setup()
    for (const occurredAt of [
      args.occurredAt - 1000,
      args.occurredAt,
      args.occurredAt - 2000,
    ]) {
      await member.mutation(api.harvests.record, { ...args, occurredAt })
    }
    const first = await member.query(api.harvests.listPage, {
      paginationOpts: { cursor: null, numItems: 2 },
    })
    expect(first.page.map((harvest) => harvest.occurredAt)).toEqual([
      args.occurredAt,
      args.occurredAt - 1000,
    ])
    expect(first.isDone).toBe(false)
    const last = await member.query(api.harvests.listPage, {
      paginationOpts: { cursor: first.continueCursor, numItems: 2 },
    })
    expect(last.page.map((harvest) => harvest.occurredAt)).toEqual([
      args.occurredAt - 2000,
    ])
    expect(last.isDone).toBe(true)
  })

  it("supprime une récolte en retirant ses stocks, lignes et mouvements, avec une trace d’audit", async () => {
    const { backend, member, args } = await setup()
    const { transactionId } = await member.mutation(api.harvests.record, args)
    await member.mutation(api.transactions.remove, { transactionId })
    const state = await stockState(backend)
    expect(state.products.map((product) => product.currentStock)).toEqual([
      2, 2,
    ])
    expect(state.transactions).toEqual([])
    expect(state.lines).toEqual([])
    expect(state.movements).toEqual([])
    expect(state.audits.map((audit) => audit.action)).toEqual([
      "harvest.recorded",
      "transaction.deleted",
    ])
  })

  it("refuse de supprimer une récolte dont les ingrédients ont été consommés", async () => {
    const { backend, member, args, productIds } = await setup()
    const { transactionId } = await member.mutation(api.harvests.record, args)
    await member.mutation(api.transactions.recordTrade, {
      characterId: args.characterId,
      occurredAt: args.occurredAt,
      kind: "sale",
      lines: [{ kind: "product", productId: productIds[1]!, quantity: 5 }],
    })
    const before = await stockState(backend)
    await expect(
      member.mutation(api.transactions.remove, { transactionId })
    ).rejects.toThrow("stock")
    expect(await stockState(backend)).toEqual(before)
  })

  it("empêche de transformer une récolte en échange par un appel direct", async () => {
    const { backend, member, args, productIds } = await setup()
    const { transactionId } = await member.mutation(api.harvests.record, args)
    const before = await stockState(backend)
    await expect(
      member.mutation(api.transactions.updateExchange, {
        characterId: args.characterId,
        occurredAt: args.occurredAt,
        transactionId,
        lines: [
          {
            direction: "incoming",
            kind: "product",
            productId: productIds[0]!,
            quantity: 1,
          },
        ],
      })
    ).rejects.toThrow("récolte")
    expect(await stockState(backend)).toEqual(before)
  })
})
