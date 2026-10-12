import { describe, expect, it } from "vitest"

import { api, internal } from "./_generated/api"
import { asAuthenticatedUser, createTestBackend } from "./test.helpers"
import { calculateHarvestValue } from "../shared/harvest-value"
import { defaultReaderAccess, redactReaderData } from "../shared/reader-access"
import { startOfUtcWeek, WEEK_IN_MILLISECONDS } from "../shared/time"

const pageArgs = { paginationOpts: { cursor: null, numItems: 30 } }

async function setup(summariesReady = false) {
  const backend = createTestBackend()
  const member = await asAuthenticatedUser(backend)
  if (summariesReady)
    await backend.mutation(internal.migrations.prepareHistorySummaries, {})
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
  it("calcule les totaux d’un groupe sur toutes ses récoltes, au-delà d’une page de détails", async () => {
    const { backend, member, args, productIds } = await setup(true)
    const week = startOfUtcWeek(args.occurredAt)
    await backend.run(async (ctx) => {
      await ctx.db.patch(productIds[1]!, { purchasePrice: undefined })
    })
    for (let index = 0; index < 32; index++) {
      await member.mutation(api.harvests.record, {
        ...args,
        occurredAt: week + index,
      })
    }
    await member.mutation(api.harvests.record, {
      ...args,
      occurredAt: week - WEEK_IN_MILLISECONDS,
    })
    await member.mutation(api.transactions.recordTrade, {
      characterId: args.characterId,
      occurredAt: week,
      kind: "purchase",
      lines: [{ kind: "product", productId: productIds[0]!, quantity: 1 }],
    })
    const grouped = await member.query(api.harvests.listGroups, {
      page: 0,
      weekStartsAt: week,
    })
    expect(grouped.groups).toHaveLength(1)
    expect(grouped.groups[0]).toMatchObject({
      character: { id: args.characterId, name: "Alixard Veliane" },
      harvestCount: 32,
      quantity: 224,
      lineCount: 64,
      knownValue: 384,
      unpricedLineCount: 32,
    })
    const first = await member.query(api.harvests.listPage, {
      ...pageArgs,
      weekStartsAt: week,
      character: grouped.groups[0]!.character,
    })
    expect(first.page).toHaveLength(30)
    expect(first.isDone).toBe(false)
    const last = await member.query(api.harvests.listPage, {
      weekStartsAt: week,
      character: grouped.groups[0]!.character,
      paginationOpts: { numItems: 30, cursor: first.continueCursor },
    })
    expect(last.page).toHaveLength(2)
    expect(last.isDone).toBe(true)
    expect(
      new Set([...first.page, ...last.page].map((harvest) => harvest._id)).size
    ).toBe(32)
    expect(
      (await member.query(api.harvests.listGroups, { page: 0 })).groups[0]
        ?.harvestCount
    ).toBe(33)
  })

  it("filtre les personnages par semaine du lundi au dimanche, y compris au changement d’année", async () => {
    const { backend, member, args } = await setup(true)
    const otherId = await backend.run((ctx) =>
      ctx.db.insert("characters", { active: true, name: "Mira" })
    )
    const monday = Date.UTC(2025, 11, 29)
    const dates = [
      monday - 1,
      monday,
      monday + WEEK_IN_MILLISECONDS - 1,
      monday + WEEK_IN_MILLISECONDS,
    ]
    for (const occurredAt of dates)
      await member.mutation(api.harvests.record, { ...args, occurredAt })
    await member.mutation(api.harvests.record, {
      ...args,
      characterId: otherId,
      occurredAt: monday,
    })
    expect(await member.query(api.harvests.listWeeks, {})).toEqual([
      monday + WEEK_IN_MILLISECONDS,
      monday,
      monday - WEEK_IN_MILLISECONDS,
    ])
    const weekPage = await member.query(api.harvests.listPage, {
      ...pageArgs,
      weekStartsAt: monday,
    })
    expect(weekPage.page.map((harvest) => harvest.occurredAt)).toEqual([
      monday + WEEK_IN_MILLISECONDS - 1,
      monday,
      monday,
    ])
    const result = await member.query(api.harvests.listGroups, {
      page: 0,
      weekStartsAt: monday,
    })
    expect(
      result.groups.map((group) => [
        group.character.name,
        group.harvestCount,
        group.quantity,
        group.knownValue,
      ])
    ).toEqual([
      ["Alixard Veliane", 2, 14, 56],
      ["Mira", 1, 7, 28],
    ])
    for (const group of result.groups) {
      const details = await member.query(api.harvests.listPage, {
        ...pageArgs,
        character: group.character,
        weekStartsAt: monday,
      })
      expect(details.page).toHaveLength(group.harvestCount)
      expect(
        details.page.every(
          (harvest) =>
            harvest.actorCharacterId === group.character.id &&
            startOfUtcWeek(harvest.occurredAt) === monday
        )
      ).toBe(true)
    }
    expect(
      (await member.query(api.harvests.listGroups, { page: 0 })).groups.map(
        (group) => group.harvestCount
      )
    ).toEqual([4, 1])
    const emptyWeek = monday - 2 * WEEK_IN_MILLISECONDS
    expect(
      (
        await member.query(api.harvests.listGroups, {
          page: 0,
          weekStartsAt: emptyWeek,
        })
      ).groups
    ).toEqual([])
    expect(
      (
        await member.query(api.harvests.listPage, {
          ...pageArgs,
          weekStartsAt: emptyWeek,
        })
      ).page
    ).toEqual([])
  })

  it("distingue les homonymes et garde ensemble les récoltes d’un personnage renommé ou archivé", async () => {
    const { backend, member, args } = await setup(true)
    await member.mutation(api.harvests.record, args)
    const homonymId = await backend.run(async (ctx) => {
      await ctx.db.patch(args.characterId, { name: "Zélie" })
      return ctx.db.insert("characters", {
        active: true,
        name: "Alixard Veliane",
      })
    })
    await member.mutation(api.harvests.record, {
      ...args,
      occurredAt: args.occurredAt + 1,
    })
    await member.mutation(api.harvests.record, {
      ...args,
      characterId: homonymId,
    })
    await backend.run((ctx) =>
      ctx.db.patch(args.characterId, { active: false })
    )
    const result = await member.query(api.harvests.listGroups, {
      page: 0,
    })
    expect(
      result.groups.map((group) => [group.character?.name, group.harvestCount])
    ).toEqual([
      ["Alixard Veliane", 1],
      ["Zélie", 2],
    ])
    const details = await member.query(api.harvests.listPage, {
      ...pageArgs,
      character: result.groups[1]!.character,
    })
    expect(details.page.map((harvest) => harvest.actorName)).toEqual([
      "Zélie",
      "Alixard Veliane",
    ])
  })

  it("recalcule les groupes après modification et suppression en conservant le prix historique", async () => {
    const { backend, member, args, productIds } = await setup(true)
    const oldWeek = startOfUtcWeek(args.occurredAt) - WEEK_IN_MILLISECONDS
    const { transactionId } = await member.mutation(api.harvests.record, {
      ...args,
      occurredAt: oldWeek,
    })
    const otherId = await backend.run(async (ctx) => {
      await ctx.db.patch(productIds[0]!, { purchasePrice: 100 })
      return ctx.db.insert("characters", { active: true, name: "Mira" })
    })
    await member.mutation(api.harvests.update, {
      ...args,
      transactionId,
      characterId: otherId,
      lines: [{ productId: productIds[0]!, quantity: 2 }],
    })
    const result = await member.query(api.harvests.listGroups, {
      page: 0,
    })
    expect(
      (
        await member.query(api.harvests.listGroups, {
          page: 0,
          weekStartsAt: oldWeek,
        })
      ).groups
    ).toEqual([])
    expect(await member.query(api.harvests.listWeeks, {})).toEqual([
      startOfUtcWeek(args.occurredAt),
    ])
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0]).toMatchObject({
      character: { id: otherId },
      harvestCount: 1,
      quantity: 2,
      knownValue: 8,
    })
    await member.mutation(api.transactions.remove, { transactionId })
    expect(await member.query(api.harvests.listGroups, { page: 5 })).toEqual({
      groups: [],
      page: 0,
      pageCount: 1,
    })
  })

  it("pagine les groupes dans un ordre stable et refuse les accès et arguments invalides", async () => {
    const { backend, member, args } = await setup(true)
    for (let index = 0; index < 8; index++) {
      const characterId = await backend.run((ctx) =>
        ctx.db.insert("characters", {
          active: true,
          name: `Personnage ${index + 1}`,
        })
      )
      await member.mutation(api.harvests.record, { ...args, characterId })
    }
    const first = await member.query(api.harvests.listGroups, {
      page: 0,
    })
    const last = await member.query(api.harvests.listGroups, {
      page: 1,
    })
    expect(first).toMatchObject({ page: 0, pageCount: 2 })
    expect(first.groups).toHaveLength(6)
    expect(last.groups.map((group) => group.character?.name)).toEqual([
      "Personnage 7",
      "Personnage 8",
    ])
    expect(
      (
        await member.query(api.harvests.listGroups, {
          page: 20,
        })
      ).page
    ).toBe(1)
    for (const page of [-1, 0.5, Number.POSITIVE_INFINITY])
      await expect(
        member.query(api.harvests.listGroups, { page })
      ).rejects.toThrow()
    await expect(
      member.query(api.harvests.listPage, {
        ...pageArgs,
        weekStartsAt: Date.UTC(2026, 0, 1),
      })
    ).rejects.toThrow("Semaine invalide")
    await expect(
      member.query(api.harvests.listGroups, {
        page: 0,
        weekStartsAt: Date.UTC(2026, 0, 1),
      })
    ).rejects.toThrow("Semaine invalide")
    const reader = await asAuthenticatedUser(backend, "reader")
    for (const client of [backend, reader]) {
      await expect(client.query(api.harvests.listWeeks, {})).rejects.toThrow()
      await expect(
        client.query(api.harvests.listGroups, { page: 0 })
      ).rejects.toThrow()
      await expect(
        client.query(api.harvests.listPage, {
          ...pageArgs,
          character: { id: args.characterId, name: "Alixard Veliane" },
        })
      ).rejects.toThrow()
    }
  })

  it("conserve les groupes des anciennes récoltes sans identifiant de personnage ni prix connu", async () => {
    const { backend, member, args } = await setup()
    const { transactionId } = await member.mutation(api.harvests.record, args)
    await backend.run(async (ctx) => {
      await ctx.db.patch(transactionId, { actorCharacterId: undefined })
      const lines = await ctx.db
        .query("transactionLines")
        .withIndex("by_transaction", (index) =>
          index.eq("transactionId", transactionId)
        )
        .collect()
      for (const line of lines)
        await ctx.db.patch(line._id, { purchaseUnitPrice: undefined })
    })
    await member.mutation(api.harvests.record, args)
    const result = await member.query(api.harvests.listGroups, {
      page: 0,
    })
    expect(result.groups).toHaveLength(2)
    const legacy = result.groups.find(
      (group) => group.character?.id === undefined
    )!
    expect(legacy).toMatchObject({
      harvestCount: 1,
      knownValue: 0,
      unpricedLineCount: 2,
    })
    const details = await member.query(api.harvests.listPage, {
      ...pageArgs,
      character: legacy.character,
    })
    expect(details.page.map((harvest) => harvest._id)).toEqual([transactionId])
  })

  it("modifie une récolte, remplace ses ingrédients et conserve ses prix et son auteur d’origine", async () => {
    const { backend, member, args, productIds } = await setup()
    const admin = await asAuthenticatedUser(backend, "admin")
    const { transactionId } = await member.mutation(api.harvests.record, args)
    const original = (await stockState(backend)).transactions[0]!
    const { characterId, productId } = await backend.run(async (ctx) => {
      await ctx.db.patch(productIds[0]!, {
        name: "Lys renommé",
        purchasePrice: 40,
      })
      return {
        characterId: await ctx.db.insert("characters", {
          active: true,
          name: "Mira",
        }),
        productId: await ctx.db.insert("products", {
          active: true,
          category: "ingredient",
          currentStock: 1,
          minimumStock: 0,
          name: "Blé",
          normalizedName: "blé",
          purchasePrice: 2,
          tracksStock: true,
        }),
      }
    })
    const occurredAt = args.occurredAt - 86_400_000
    await admin.mutation(api.harvests.update, {
      transactionId,
      characterId,
      occurredAt,
      comment: "  Récolte corrigée  ",
      lines: [
        { productId: productIds[0]!, quantity: 5 },
        { productId, quantity: 2 },
      ],
    })
    const state = await stockState(backend)
    expect(state.products.map((product) => product.currentStock)).toEqual([
      7, 2, 3,
    ])
    expect(state.transactions).toEqual([
      expect.objectContaining({
        _id: transactionId,
        actorUserId: original.actorUserId,
        actorCharacterId: characterId,
        actorName: "Mira",
        comment: "Récolte corrigée",
        occurredAt,
        quantity: 7,
        lineCount: 2,
        kind: "harvest",
        financial: false,
        total: 0,
      }),
    ])
    expect(
      state.lines.map((line) => ({
        name: line.productName,
        quantity: line.quantity,
        price: line.purchaseUnitPrice,
        total: line.total,
      }))
    ).toEqual([
      { name: "Lys bleu", quantity: 5, price: 4, total: 0 },
      { name: "Blé", quantity: 2, price: 2, total: 0 },
    ])
    expect(calculateHarvestValue(state.lines)).toEqual({
      knownValue: 24,
      unpricedLineCount: 0,
    })
    expect(
      state.movements.map((movement) => ({
        productId: movement.productId,
        delta: movement.delta,
        occurredAt: movement.occurredAt,
      }))
    ).toEqual([
      { productId: productIds[0], delta: 5, occurredAt },
      { productId, delta: 2, occurredAt },
    ])
    expect(state.audits.at(-1)).toMatchObject({
      action: "harvest.updated",
      entityId: transactionId,
    })
    expect(state.audits.at(-1)?.actorUserId).not.toBe(original.actorUserId)
    expect(JSON.parse(state.audits.at(-1)!.detail!)).toMatchObject({
      before: { actorName: original.actorName },
      after: { actorName: "Mira" },
    })
    await admin.mutation(api.transactions.remove, { transactionId })
    expect(
      (await stockState(backend)).products.map(
        (product) => product.currentStock
      )
    ).toEqual([2, 2, 1])
  })

  it("corrige une récolte déjà consommée en validant le stock final, sans annuler les ventes suivantes", async () => {
    const { backend, member, args, productIds } = await setup()
    const { transactionId } = await member.mutation(api.harvests.record, args)
    await member.mutation(api.transactions.recordTrade, {
      characterId: args.characterId,
      occurredAt: args.occurredAt,
      kind: "sale",
      lines: [{ kind: "product", productId: productIds[1]!, quantity: 5 }],
    })
    await member.mutation(api.harvests.update, {
      ...args,
      transactionId,
      comment: "Lieu précisé",
    })
    expect(
      (await stockState(backend)).products.map(
        (product) => product.currentStock
      )
    ).toEqual([5, 1])
    const valid = {
      ...args,
      transactionId,
      lines: [args.lines[0]!, { productId: productIds[1]!, quantity: 3 }],
    }
    await member.mutation(api.harvests.update, valid)
    expect(
      (await stockState(backend)).products.map(
        (product) => product.currentStock
      )
    ).toEqual([5, 0])
    expect(
      (await member.query(api.harvests.listPage, pageArgs)).page[0]?.comment
    ).toBeUndefined()
    const before = await stockState(backend)
    for (const lines of [
      [args.lines[0]!, { productId: productIds[1]!, quantity: 2 }],
      [args.lines[0]!],
    ]) {
      await expect(
        member.mutation(api.harvests.update, { ...valid, lines })
      ).rejects.toThrow("négatif")
      expect(await stockState(backend)).toEqual(before)
    }
  })

  it.each([0, -1, 1.5, 1_000_001, NaN, Infinity])(
    "refuse une modification de quantité %s sans aucune écriture",
    async (quantity) => {
      const { backend, member, args } = await setup()
      const { transactionId } = await member.mutation(api.harvests.record, args)
      const before = await stockState(backend)
      await expect(
        member.mutation(api.harvests.update, {
          ...args,
          transactionId,
          lines: [args.lines[0]!, { ...args.lines[1]!, quantity }],
        })
      ).rejects.toThrow()
      expect(await stockState(backend)).toEqual(before)
    }
  )

  it("refuse les doublons, dates et listes invalides ainsi que les stocks excessifs lors d’une modification", async () => {
    const { backend, member, args, productIds } = await setup()
    const { transactionId } = await member.mutation(api.harvests.record, args)
    const before = await stockState(backend)
    for (const patch of [
      { lines: [] },
      { lines: [args.lines[0]!, args.lines[0]!] },
      { lines: Array.from({ length: 51 }, () => args.lines[0]!) },
      { comment: "x".repeat(501) },
      { occurredAt: -1 },
      { occurredAt: Date.now() + 2 * 86_400_000 },
    ]) {
      await expect(
        member.mutation(api.harvests.update, {
          ...args,
          transactionId,
          ...patch,
        })
      ).rejects.toThrow()
      expect(await stockState(backend)).toEqual(before)
    }
    await backend.run((ctx) =>
      ctx.db.patch(productIds[0]!, { currentStock: 1_000_000 })
    )
    const atLimit = await stockState(backend)
    await expect(
      member.mutation(api.harvests.update, {
        ...args,
        transactionId,
        lines: [{ ...args.lines[0]!, quantity: 4 }, args.lines[1]!],
      })
    ).rejects.toThrow("stock")
    expect(await stockState(backend)).toEqual(atLimit)
  })

  it("permet de conserver les références archivées existantes et refuse d’en ajouter ou d’utiliser une référence supprimée", async () => {
    const { backend, member, args, productIds, characterId } = await setup()
    const { transactionId } = await member.mutation(api.harvests.record, {
      ...args,
      lines: [args.lines[0]!],
    })
    await backend.run(async (ctx) => {
      await ctx.db.patch(characterId, { active: false })
      await ctx.db.patch(productIds[0]!, { active: false })
      await ctx.db.patch(productIds[1]!, { active: false })
    })
    await member.mutation(api.harvests.update, {
      ...args,
      transactionId,
      lines: [args.lines[0]!],
      comment: "Correction du lieu",
    })
    const before = await stockState(backend)
    await expect(
      member.mutation(api.harvests.update, { ...args, transactionId })
    ).rejects.toThrow("ingrédient actif")
    expect(await stockState(backend)).toEqual(before)
    await backend.run((ctx) => ctx.db.delete(productIds[0]!))
    const missing = await stockState(backend)
    await expect(
      member.mutation(api.harvests.update, {
        ...args,
        transactionId,
        lines: [args.lines[0]!],
      })
    ).rejects.toThrow()
    expect(await stockState(backend)).toEqual(missing)
  })

  it("conserve les prix absents ou nuls et les anciennes lignes sans prix lors d’une correction", async () => {
    const { backend, member, args, productIds } = await setup()
    await backend.run(async (ctx) => {
      await ctx.db.patch(productIds[0]!, { purchasePrice: 0 })
      await ctx.db.patch(productIds[1]!, { purchasePrice: undefined })
    })
    const { transactionId } = await member.mutation(api.harvests.record, args)
    await backend.run(async (ctx) => {
      for (const productId of productIds)
        await ctx.db.patch(productId, { purchasePrice: 99 })
    })
    await member.mutation(api.harvests.update, {
      ...args,
      transactionId,
      lines: args.lines.map((line) => ({ ...line, quantity: 5 })),
    })
    const harvest = (await member.query(api.harvests.listPage, pageArgs))
      .page[0]!
    expect(calculateHarvestValue(harvest.lines)).toEqual({
      knownValue: 0,
      unpricedLineCount: 1,
    })
    await backend.run((ctx) =>
      ctx.db.patch(harvest.lines[0]!._id, { purchaseUnitPrice: undefined })
    )
    await member.mutation(api.harvests.update, { ...args, transactionId })
    expect(
      calculateHarvestValue(
        (await member.query(api.harvests.listPage, pageArgs)).page[0]!.lines
      )
    ).toEqual({ knownValue: 0, unpricedLineCount: 2 })
  })

  it("réserve la modification aux employés et administrateurs et refuse les autres types d’opérations", async () => {
    const { backend, member, args } = await setup()
    const reader = await asAuthenticatedUser(backend, "reader")
    const admin = await asAuthenticatedUser(backend, "admin")
    const { transactionId } = await member.mutation(api.harvests.record, args)
    const input = { ...args, transactionId }
    const before = await stockState(backend)
    await expect(backend.mutation(api.harvests.update, input)).rejects.toThrow(
      "connecté"
    )
    await expect(reader.mutation(api.harvests.update, input)).rejects.toThrow(
      "lecture seule"
    )
    expect(await stockState(backend)).toEqual(before)
    await admin.mutation(api.harvests.update, input)
    await backend.run((ctx) =>
      ctx.db.patch(transactionId, { kind: "purchase" })
    )
    const otherKind = await stockState(backend)
    await expect(member.mutation(api.harvests.update, input)).rejects.toThrow(
      "Seule une récolte"
    )
    expect(await stockState(backend)).toEqual(otherKind)
    await backend.run((ctx) => ctx.db.delete(transactionId))
    await expect(member.mutation(api.harvests.update, input)).rejects.toThrow(
      "introuvable"
    )
  })

  it.each([false, true])(
    "actualise uniquement l’inventaire lors de la modification (projections : %s)",
    async (ready) => {
      const { backend, member, args } = await setup()
      if (ready)
        await backend.mutation(internal.migrations.rebuildReadModels, {})
      const { transactionId } = await member.mutation(api.harvests.record, args)
      const beforeAccount = await member.query(api.accounts.overview, {})
      const beforeDashboard = await member.query(api.dashboard.overview, {})
      const beforeJournal = await member.query(
        api.transactions.listPage,
        pageArgs
      )
      await member.mutation(api.harvests.update, {
        ...args,
        transactionId,
        lines: [args.lines[0]!],
      })
      expect(await member.query(api.accounts.overview, {})).toEqual(
        beforeAccount
      )
      expect(await member.query(api.transactions.listPage, pageArgs)).toEqual(
        beforeJournal
      )
      expect(await member.query(api.dashboard.overview, {})).toMatchObject({
        weeklyBalance: beforeDashboard.weeklyBalance,
        weeklyTransactionCount: beforeDashboard.weeklyTransactionCount,
        recentTransactions: [],
        stockValue: beforeDashboard.stockValue - 16,
        lowStockCount: 1,
      })
    }
  )

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
        purchaseUnitPrice: 4,
        quantity: 3,
        direction: "incoming",
        total: 0,
        transactionId,
      }),
      expect.objectContaining({
        productId: productIds[1],
        productName: "Sel de feu",
        purchaseUnitPrice: 4,
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
        purchasePrice: 40,
      })
    })
    const page = await member.query(api.harvests.listPage, pageArgs)
    expect(page.page[0]?.actorName).toBe("Alixard Veliane")
    expect(page.page[0]?.lines[0]?.productName).toBe("Lys bleu")
    expect(calculateHarvestValue(page.page[0]!.lines)).toEqual({
      knownValue: 28,
      unpricedLineCount: 0,
    })
  })

  it("conserve les tarifs d’achat de la saisie, y compris les fractions, sans compléter les prix absents après coup", async () => {
    const { backend, member, args, productIds } = await setup()
    await backend.run(async (ctx) => {
      await ctx.db.patch(productIds[0]!, { purchasePrice: 10 / 3 })
      await ctx.db.patch(productIds[1]!, { purchasePrice: undefined })
    })
    const { transactionId } = await member.mutation(api.harvests.record, args)
    await backend.run(async (ctx) => {
      await ctx.db.patch(productIds[0]!, { purchasePrice: 99 })
      await ctx.db.patch(productIds[1]!, { purchasePrice: 5 })
    })
    const harvest = (await member.query(api.harvests.listPage, pageArgs))
      .page[0]!
    expect(harvest._id).toBe(transactionId)
    expect(harvest.lines[0]?.purchaseUnitPrice).toBe(10 / 3)
    expect(harvest.lines[1]?.purchaseUnitPrice).toBeUndefined()
    expect(calculateHarvestValue(harvest.lines)).toEqual({
      knownValue: 10,
      unpricedLineCount: 1,
    })
    expect(harvest.total).toBe(0)
    expect(harvest.financial).toBe(false)
    expect(harvest.lines.map((line) => line.total)).toEqual([0, 0])

    const latest = await member.mutation(api.harvests.record, {
      ...args,
      occurredAt: args.occurredAt + 1,
    })
    const latestHarvest = (
      await member.query(api.harvests.listPage, pageArgs)
    ).page.find((entry) => entry._id === latest.transactionId)!
    expect(calculateHarvestValue(latestHarvest.lines)).toEqual({
      knownValue: 317,
      unpricedLineCount: 0,
    })
  })

  it("distingue un tarif nul d’un tarif inconnu et conserve la compatibilité des anciennes récoltes", async () => {
    const { backend, member, args, productIds } = await setup()
    await backend.run(async (ctx) => {
      await ctx.db.patch(productIds[0]!, { purchasePrice: 0 })
      await ctx.db.patch(productIds[1]!, { purchasePrice: undefined })
    })
    await member.mutation(api.harvests.record, args)
    const harvest = (await member.query(api.harvests.listPage, pageArgs))
      .page[0]!
    expect(harvest.lines[0]?.purchaseUnitPrice).toBe(0)
    expect(calculateHarvestValue(harvest.lines)).toEqual({
      knownValue: 0,
      unpricedLineCount: 1,
    })
    await backend.run((ctx) =>
      ctx.db.patch(harvest.lines[0]!._id, { purchaseUnitPrice: undefined })
    )
    const legacy = (await member.query(api.harvests.listPage, pageArgs))
      .page[0]!
    expect(calculateHarvestValue(legacy.lines)).toEqual({
      knownValue: 0,
      unpricedLineCount: 2,
    })
  })

  it("classe le tarif d’achat conservé parmi les prix protégés des lecteurs", () => {
    expect(
      redactReaderData(
        { purchaseUnitPrice: 4 },
        { ...defaultReaderAccess, showPurchasePrices: false }
      )
    ).toEqual({ purchaseUnitPrice: 0 })
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

  it("réserve la saisie aux employés et administrateurs et refuse l’historique aux lecteurs sans droit explicite", async () => {
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
      "ne permet pas de consulter"
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
