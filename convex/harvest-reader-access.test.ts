import { describe, expect, it } from "vitest"
import { api, internal } from "./_generated/api"
import { asAuthenticatedUser, createTestBackend } from "./test.helpers"
import { defaultReaderAccess, type ReaderAccess } from "../shared/reader-access"
import { startOfUtcWeek, WEEK_IN_MILLISECONDS } from "../shared/time"

const pageArgs = { paginationOpts: { cursor: null, numItems: 30 } }

async function fixture() {
  const backend = createTestBackend()
  const admin = await asAuthenticatedUser(backend, "admin")
  const member = await asAuthenticatedUser(backend)
  const reader = await asAuthenticatedUser(backend, "reader")
  const user = await reader.query(api.auth.getCurrentUser, {})
  if (!user) throw new Error("Lecteur absent")
  const week = startOfUtcWeek(Date.now())
  const ids = await backend.run(async (ctx) => {
    const characterId = await ctx.db.insert("characters", {
      name: "Mira",
      active: true,
    })
    const otherCharacterId = await ctx.db.insert("characters", {
      name: "Secret",
      active: true,
    })
    const products = []
    for (const name of ["Public", "Secret", "Autre public"])
      products.push(
        await ctx.db.insert("products", {
          name,
          normalizedName: name.toLowerCase(),
          active: true,
          category: "ingredient",
          tracksStock: true,
          currentStock: 100,
          minimumStock: 0,
          purchasePrice: 4,
        })
      )
    const [a, b, c] = products
    const harvests = []
    // Legacy rows lack visibility scopes, so both paths must enforce the policy.
    for (const [index, productIds] of [[a!], [c!], [a!, b!], [b!]].entries()) {
      const transactionId = await ctx.db.insert("transactions", {
        actorCharacterId: index < 2 ? characterId : otherCharacterId,
        actorName: index < 2 ? "Mira" : "Secret",
        kind: "harvest",
        occurredAt: week - (index >= 2 ? WEEK_IN_MILLISECONDS : 0) + index,
        source: "web",
        total: 0,
        productName: index < 2 ? "Public" : "Secret",
        quantity: productIds.length * 2,
      })
      for (const productId of productIds)
        await ctx.db.insert("transactionLines", {
          transactionId,
          productId,
          productName: productId === b ? "Secret" : "Public",
          quantity: 2,
          kind: "product",
          unitPrice: 0,
          total: 0,
          purchaseUnitPrice: 4,
        })
      harvests.push(transactionId)
    }
    return { a: a!, b: b!, c: c!, characterId, otherCharacterId, harvests }
  })
  const access: ReaderAccess = {
    ...defaultReaderAccess,
    sections: ["harvests"],
    operationKinds: [],
    productIds: [ids.a, ids.c],
  }
  const grant = (policy: ReaderAccess = access) =>
    admin.mutation(api.administration.saveAccountAccess, {
      userId: user._id,
      role: "reader",
      access: {
        ...policy,
        productIds: policy.productIds as (typeof ids.a)[] | undefined,
      },
    })
  return { backend, admin, member, reader, user, week, access, grant, ...ids }
}

describe("lecture des récoltes", () => {
  it("garde l’accès fermé pour un lecteur sans configuration et pour les droits déjà enregistrés, y compris après la reprise", async () => {
    const { backend, reader, grant } = await fixture()
    for (const policy of [undefined, { ...defaultReaderAccess }]) {
      if (policy) await grant(policy)
      expect(
        (await reader.query(api.auth.getCurrentUser, {}))?.readerAccess
          ?.sections
      ).not.toContain("harvests")
      await expect(
        reader.query(api.harvests.listPage, pageArgs)
      ).rejects.toThrow("ne permet pas de consulter")
      await expect(reader.query(api.harvests.listWeeks, {})).rejects.toThrow(
        "ne permet pas de consulter"
      )
      await expect(
        reader.query(api.harvests.listGroups, { page: 0 })
      ).rejects.toThrow("ne permet pas de consulter")
    }
    await backend.mutation(
      internal.migrations.prepareHarvestReaderSummaries,
      {}
    )
    await expect(reader.query(api.harvests.listPage, pageArgs)).rejects.toThrow(
      "ne permet pas de consulter"
    )
  })

  it.each([false, true])(
    "filtre les récoltes mixtes, les personnages, les semaines et leurs totaux (résumés prêts : %s)",
    async (prepared) => {
      const { backend, reader, grant, week, harvests, characterId, access } =
        await fixture()
      await grant()
      if (prepared)
        await backend.mutation(
          internal.migrations.prepareHarvestReaderSummaries,
          {}
        )
      const result = await reader.query(api.harvests.listPage, pageArgs)
      expect(result.page.map((harvest) => harvest._id).sort()).toEqual(
        harvests.slice(0, 2).sort()
      )
      expect(await reader.query(api.harvests.listWeeks, {})).toEqual([week])
      const groups = await reader.query(api.harvests.listGroups, { page: 0 })
      expect(groups).toMatchObject({
        page: 0,
        pageCount: 1,
        groups: [
          {
            character: { id: characterId, name: "Mira" },
            harvestCount: 2,
            quantity: 4,
            lineCount: 2,
            knownValue: 16,
            unpricedLineCount: 0,
          },
        ],
      })
      expect(groups.groups).toHaveLength(1)
      expect(
        (
          await reader.query(api.harvests.listGroups, {
            page: 0,
            weekStartsAt: week - WEEK_IN_MILLISECONDS,
          })
        ).groups
      ).toEqual([])
      expect(
        (
          await reader.query(api.harvests.listPage, {
            ...pageArgs,
            character: { name: "Secret" },
          })
        ).page
      ).toEqual([])
      await grant({ ...access, productIds: [] })
      expect(
        (await reader.query(api.harvests.listPage, pageArgs)).page
      ).toEqual([])
      expect(await reader.query(api.harvests.listWeeks, {})).toEqual([])
      expect(
        (await reader.query(api.harvests.listGroups, { page: 0 })).groups
      ).toEqual([])
    }
  )

  it("accorde la consultation seule, indépendamment du catalogue et des opérations financières, et applique une révocation", async () => {
    const { reader, grant, access, characterId, a, harvests } = await fixture()
    await grant({ ...access, productIds: undefined })
    expect(
      (await reader.query(api.harvests.listPage, pageArgs)).page
    ).toHaveLength(4)
    await expect(reader.query(api.characters.list, {})).rejects.toThrow(
      "ne permet pas de consulter"
    )
    await expect(reader.query(api.products.list, {})).rejects.toThrow(
      "ne permet pas de consulter"
    )
    const args = {
      characterId,
      occurredAt: Date.now(),
      lines: [{ productId: a, quantity: 1 }],
    }
    await expect(reader.mutation(api.harvests.record, args)).rejects.toThrow(
      "lecture seule"
    )
    await expect(
      reader.mutation(api.harvests.update, {
        ...args,
        transactionId: harvests[0]!,
      })
    ).rejects.toThrow("lecture seule")
    await expect(
      reader.mutation(api.transactions.remove, { transactionId: harvests[0]! })
    ).rejects.toThrow("lecture seule")
    await grant({ ...access, sections: [] })
    await expect(reader.query(api.harvests.listPage, pageArgs)).rejects.toThrow(
      "ne permet pas de consulter"
    )
  })

  it.each([
    {
      showPrices: false,
      showPurchasePrices: true,
      showSalePrices: true,
      value: 0,
    },
    {
      showPrices: true,
      showPurchasePrices: false,
      showSalePrices: true,
      value: 0,
    },
    {
      showPrices: true,
      showPurchasePrices: true,
      showSalePrices: false,
      value: 16,
    },
  ])(
    "protège les prix et l’économie estimée côté serveur ($showPrices/$showPurchasePrices/$showSalePrices)",
    async ({ value, ...priceAccess }) => {
      const { backend, reader, grant, access } = await fixture()
      await grant({ ...access, ...priceAccess })
      for (const prepared of [false, true]) {
        if (prepared)
          await backend.mutation(
            internal.migrations.prepareHarvestReaderSummaries,
            {}
          )
        const page = await reader.query(api.harvests.listPage, pageArgs)
        expect(page.page[0]?.lines[0]?.purchaseUnitPrice).toBe(
          value === 0 ? 0 : 4
        )
        if (prepared)
          expect(page.page[0]?.harvestScopeContribution?.knownValue).toBe(
            value === 0 ? 0 : 8
          )
        expect(
          (await reader.query(api.harvests.listGroups, { page: 0 })).groups[0]
            ?.knownValue
        ).toBe(value)
      }
    }
  )

  it("met à jour les résumés autorisés après correction des ingrédients, du personnage, de la semaine et après suppression", async () => {
    const {
      backend,
      member,
      reader,
      grant,
      access,
      characterId,
      otherCharacterId,
      a,
      b,
      week,
    } = await fixture()
    await grant({ ...access, productIds: [a] })
    await backend.mutation(
      internal.migrations.prepareHarvestReaderSummaries,
      {}
    )
    const { transactionId } = await member.mutation(api.harvests.record, {
      characterId,
      occurredAt: week + 100,
      lines: [{ productId: a, quantity: 3 }],
    })
    expect(
      (await reader.query(api.harvests.listGroups, { page: 0 })).groups[0]
    ).toMatchObject({ harvestCount: 2, quantity: 5, knownValue: 20 })
    await member.mutation(api.harvests.update, {
      transactionId,
      characterId: otherCharacterId,
      occurredAt: week - 2 * WEEK_IN_MILLISECONDS,
      lines: [{ productId: a, quantity: 4 }],
    })
    expect(await reader.query(api.harvests.listWeeks, {})).toEqual([
      week,
      week - 2 * WEEK_IN_MILLISECONDS,
    ])
    expect(
      (await reader.query(api.harvests.listGroups, { page: 0 })).groups
    ).toHaveLength(2)
    await member.mutation(api.harvests.update, {
      transactionId,
      characterId: otherCharacterId,
      occurredAt: week - 2 * WEEK_IN_MILLISECONDS,
      lines: [
        { productId: a, quantity: 4 },
        { productId: b, quantity: 2 },
      ],
    })
    expect(await reader.query(api.harvests.listWeeks, {})).toEqual([week])
    expect(
      (await reader.query(api.harvests.listGroups, { page: 0 })).groups
    ).toHaveLength(1)
    await member.mutation(api.harvests.update, {
      transactionId,
      characterId,
      occurredAt: week,
      lines: [{ productId: a, quantity: 1 }],
    })
    await member.mutation(api.transactions.remove, { transactionId })
    expect(
      (await reader.query(api.harvests.listGroups, { page: 0 })).groups[0]
    ).toMatchObject({ harvestCount: 1, quantity: 2, knownValue: 8 })
    expect(
      await backend.mutation(
        internal.migrations.prepareHarvestReaderSummaries,
        {}
      )
    ).toEqual({ ready: true, indexedTransactions: 0 })
    expect(
      (await reader.query(api.harvests.listGroups, { page: 0 })).groups[0]
        ?.harvestCount
    ).toBe(1)
  })
})
