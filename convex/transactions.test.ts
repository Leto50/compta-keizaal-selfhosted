import { describe, expect, it } from "vitest"

import { api } from "./_generated/api"
import { buildTransactionSearchText } from "./lib/transactionSearch"
import { asAuthenticatedUser, createTestBackend } from "./test.helpers"

async function seedStock(backend: ReturnType<typeof createTestBackend>) {
  return backend.run(async (ctx) => {
    const productId = await ctx.db.insert("products", {
      active: true,
      category: "potion",
      currentStock: 10,
      minimumStock: 2,
      name: "Potion de soin",
      normalizedName: "potion de soin",
      purchasePrice: 6,
      salePrice: 12,
      tracksStock: true,
    })
    const characterId = await ctx.db.insert("characters", {
      active: true,
      name: "Alixard Veliane",
    })
    return { characterId, productId }
  })
}

describe("transactions.record", () => {
  it("réserve la production aux produits qui possèdent une recette active", async () => {
    const backend = createTestBackend()
    const member = await asAuthenticatedUser(backend)
    const { characterId, productId } = await seedStock(backend)

    await expect(
      member.mutation(api.transactions.record, {
        characterId,
        kind: "production",
        occurredAt: Date.now(),
        productId,
        quantity: 2,
      })
    ).rejects.toThrowError("aucune recette active")

    const ingredientId = await backend.run(async (ctx) => {
      const nextIngredientId = await ctx.db.insert("products", {
        active: true,
        category: "ingredient",
        currentStock: 5,
        minimumStock: 1,
        name: "Lys bleu",
        normalizedName: "lys bleu",
        tracksStock: true,
      })
      const recipeId = await ctx.db.insert("recipes", {
        active: true,
        family: "Soins",
        name: "Potion de soin",
        productId,
      })
      await ctx.db.insert("recipeIngredients", {
        ingredientName: "Lys bleu",
        productId: nextIngredientId,
        quantity: 2,
        raw: "2 Lys bleu",
        recipeId,
      })
      return nextIngredientId
    })
    const recorded = await member.mutation(api.transactions.record, {
      characterId,
      kind: "production",
      occurredAt: Date.now(),
      productId,
      quantity: 2,
    })

    const production = await backend.run(async (ctx) => ({
      ingredient: await ctx.db.get(ingredientId),
      movements: await ctx.db
        .query("stockMovements")
        .withIndex("by_transaction", (index) =>
          index.eq("transactionId", recorded.transactionId)
        )
        .collect(),
      product: await ctx.db.get(productId),
    }))
    expect(production.product?.currentStock).toBe(12)
    expect(production.ingredient?.currentStock).toBe(1)
    expect(production.movements).toHaveLength(2)
    expect(production.movements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ delta: 2, productId }),
        expect.objectContaining({ delta: -4, productId: ingredientId }),
      ])
    )

    await backend.run((ctx) => ctx.db.patch(productId, { craftable: false }))
    await expect(
      member.mutation(api.transactions.record, {
        characterId,
        kind: "production",
        occurredAt: Date.now(),
        productId,
        quantity: 1,
      })
    ).rejects.toThrowError("non fabricable")
  })

  it("refuse atomiquement une production dont un ingrédient est insuffisant", async () => {
    const backend = createTestBackend()
    const member = await asAuthenticatedUser(backend)
    const { characterId, productId } = await seedStock(backend)
    const ingredientId = await backend.run(async (ctx) => {
      const nextIngredientId = await ctx.db.insert("products", {
        active: true,
        category: "ingredient",
        currentStock: 3,
        minimumStock: 1,
        name: "Sel de feu",
        normalizedName: "sel de feu",
        tracksStock: true,
      })
      const recipeId = await ctx.db.insert("recipes", {
        active: true,
        family: "Résistance",
        name: "Potion de soin",
        productId,
      })
      await ctx.db.insert("recipeIngredients", {
        ingredientName: "Sel de feu",
        productId: nextIngredientId,
        quantity: 2,
        raw: "2 Sel de feu",
        recipeId,
      })
      return nextIngredientId
    })

    await expect(
      member.mutation(api.transactions.record, {
        characterId,
        kind: "production",
        occurredAt: Date.now(),
        productId,
        quantity: 2,
      })
    ).rejects.toThrowError("Stock insuffisant")

    const state = await backend.run(async (ctx) => ({
      audits: await ctx.db.query("auditLogs").collect(),
      ingredient: await ctx.db.get(ingredientId),
      movements: await ctx.db.query("stockMovements").collect(),
      product: await ctx.db.get(productId),
      transactions: await ctx.db.query("transactions").collect(),
    }))
    expect(state.product?.currentStock).toBe(10)
    expect(state.ingredient?.currentStock).toBe(3)
    expect(state.transactions).toHaveLength(0)
    expect(state.movements).toHaveLength(0)
    expect(state.audits).toHaveLength(0)
  })

  it("fabrique un article qui est lui-même classé comme ingrédient", async () => {
    const backend = createTestBackend()
    const member = await asAuthenticatedUser(backend)
    const characterId = await backend.run((ctx) =>
      ctx.db.insert("characters", { active: true, name: "Alixard Veliane" })
    )
    const { rawIngredientId, saltId } = await backend.run(async (ctx) => {
      const rawIngredientId = await ctx.db.insert("products", {
        active: true,
        category: "ingredient",
        currentStock: 5,
        minimumStock: 1,
        name: "Poudre minérale",
        normalizedName: "poudre minerale",
        tracksStock: true,
      })
      const saltId = await ctx.db.insert("products", {
        active: true,
        category: "ingredient",
        currentStock: 2,
        minimumStock: 1,
        name: "Sel de feu",
        normalizedName: "sel de feu",
        tracksStock: true,
      })
      const recipeId = await ctx.db.insert("recipes", {
        active: true,
        family: "Sel",
        name: "Sel de feu",
        productId: saltId,
      })
      await ctx.db.insert("recipeIngredients", {
        ingredientName: "Poudre minérale",
        productId: rawIngredientId,
        quantity: 2,
        raw: "2 Poudre minérale",
        recipeId,
      })
      return { rawIngredientId, saltId }
    })

    await member.mutation(api.transactions.record, {
      characterId,
      kind: "production",
      occurredAt: Date.now(),
      productId: saltId,
      quantity: 2,
    })

    const state = await backend.run(async (ctx) => ({
      rawIngredient: await ctx.db.get(rawIngredientId),
      salt: await ctx.db.get(saltId),
    }))
    expect(state.salt?.currentStock).toBe(4)
    expect(state.rawIngredient?.currentStock).toBe(1)
  })

  it("corrige puis supprime une production en restaurant tous les stocks", async () => {
    const backend = createTestBackend()
    const member = await asAuthenticatedUser(backend)
    const { characterId, productId } = await seedStock(backend)
    const ingredientId = await backend.run(async (ctx) => {
      const nextIngredientId = await ctx.db.insert("products", {
        active: true,
        category: "ingredient",
        currentStock: 10,
        minimumStock: 1,
        name: "Poudre minérale",
        normalizedName: "poudre minerale",
        tracksStock: true,
      })
      const recipeId = await ctx.db.insert("recipes", {
        active: true,
        family: "Soins",
        name: "Potion de soin",
        productId,
      })
      await ctx.db.insert("recipeIngredients", {
        ingredientName: "Poudre minérale",
        productId: nextIngredientId,
        quantity: 2,
        raw: "2 Poudre minérale",
        recipeId,
      })
      return nextIngredientId
    })
    const recorded = await member.mutation(api.transactions.record, {
      characterId,
      kind: "production",
      occurredAt: Date.now(),
      productId,
      quantity: 2,
    })

    await member.mutation(api.transactions.update, {
      characterId,
      kind: "production",
      occurredAt: Date.now(),
      productId,
      quantity: 3,
      transactionId: recorded.transactionId,
    })
    const corrected = await backend.run(async (ctx) => ({
      ingredient: await ctx.db.get(ingredientId),
      movements: await ctx.db
        .query("stockMovements")
        .withIndex("by_transaction", (index) =>
          index.eq("transactionId", recorded.transactionId)
        )
        .collect(),
      product: await ctx.db.get(productId),
    }))
    expect(corrected.product?.currentStock).toBe(13)
    expect(corrected.ingredient?.currentStock).toBe(4)
    expect(corrected.movements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ delta: 3, productId }),
        expect.objectContaining({ delta: -6, productId: ingredientId }),
      ])
    )

    await member.mutation(api.transactions.remove, {
      transactionId: recorded.transactionId,
    })
    const restored = await backend.run(async (ctx) => ({
      ingredient: await ctx.db.get(ingredientId),
      movements: await ctx.db.query("stockMovements").collect(),
      product: await ctx.db.get(productId),
      transaction: await ctx.db.get(recorded.transactionId),
    }))
    expect(restored.product?.currentStock).toBe(10)
    expect(restored.ingredient?.currentStock).toBe(10)
    expect(restored.transaction).toBeNull()
    expect(restored.movements).toHaveLength(0)
  })

  it("écrit atomiquement la vente, le mouvement, l'audit et le nouveau stock", async () => {
    const backend = createTestBackend()
    const member = await asAuthenticatedUser(backend)
    const { characterId, productId } = await seedStock(backend)

    const result = await member.mutation(api.transactions.record, {
      characterId,
      kind: "sale",
      occurredAt: Date.now(),
      productId,
      quantity: 3,
    })

    expect(result.resultingStock).toBe(7)
    const state = await backend.run(async (ctx) => ({
      audits: await ctx.db.query("auditLogs").collect(),
      movements: await ctx.db.query("stockMovements").collect(),
      product: await ctx.db.get(productId),
      transactions: await ctx.db.query("transactions").collect(),
    }))
    expect(state.product?.currentStock).toBe(7)
    expect(state.transactions).toHaveLength(1)
    expect(state.transactions[0]).toMatchObject({
      kind: "sale",
      quantity: 3,
      total: 36,
      unitPrice: 12,
    })
    expect(state.movements[0]).toMatchObject({
      delta: -3,
      previousStock: 10,
      resultingStock: 7,
    })
    expect(state.audits[0]).toMatchObject({
      action: "transaction.recorded",
      entityType: "transaction",
    })
  })

  it("refuse une vente qui rendrait le stock négatif sans écriture partielle", async () => {
    const backend = createTestBackend()
    const member = await asAuthenticatedUser(backend)
    const { characterId, productId } = await seedStock(backend)

    await expect(
      member.mutation(api.transactions.record, {
        characterId,
        kind: "sale",
        occurredAt: Date.now(),
        productId,
        quantity: 11,
      })
    ).rejects.toThrowError("Stock insuffisant")

    const state = await backend.run(async (ctx) => ({
      audits: await ctx.db.query("auditLogs").collect(),
      movements: await ctx.db.query("stockMovements").collect(),
      product: await ctx.db.get(productId),
      transactions: await ctx.db.query("transactions").collect(),
    }))
    expect(state.product?.currentStock).toBe(10)
    expect(state.transactions).toHaveLength(0)
    expect(state.movements).toHaveLength(0)
    expect(state.audits).toHaveLength(0)
  })

  it("refuse une quantité fractionnaire sans modifier le stock", async () => {
    const backend = createTestBackend()
    const member = await asAuthenticatedUser(backend)
    const { characterId, productId } = await seedStock(backend)

    await expect(
      member.mutation(api.transactions.record, {
        characterId,
        kind: "sale",
        occurredAt: Date.now(),
        productId,
        quantity: 1.5,
      })
    ).rejects.toThrowError("nombre entier")

    const state = await backend.run(async (ctx) => ({
      product: await ctx.db.get(productId),
      transactions: await ctx.db.query("transactions").collect(),
    }))
    expect(state.product?.currentStock).toBe(10)
    expect(state.transactions).toHaveLength(0)
  })

  it("arrondit un achat au septim inférieur", async () => {
    const backend = createTestBackend()
    const member = await asAuthenticatedUser(backend)
    const { characterId, productId } = await seedStock(backend)
    await backend.run((ctx) =>
      ctx.db.patch(productId, { purchasePrice: 1 / 4 })
    )

    const firstResult = await member.mutation(api.transactions.record, {
      characterId,
      kind: "purchase",
      occurredAt: Date.now(),
      productId,
      quantity: 1,
    })
    const secondResult = await member.mutation(api.transactions.record, {
      characterId,
      kind: "purchase",
      occurredAt: Date.now(),
      productId,
      quantity: 4,
    })

    const state = await backend.run(async (ctx) => ({
      product: await ctx.db.get(productId),
      transactions: await ctx.db.query("transactions").collect(),
    }))
    expect(firstResult.resultingStock).toBe(11)
    expect(secondResult.resultingStock).toBe(15)
    expect(state.product?.currentStock).toBe(15)
    expect(state.transactions.map((transaction) => transaction.total)).toEqual([
      0, -1,
    ])
  })

  it("refuse l'opération en l'absence d'une session Better Auth valide", async () => {
    const backend = createTestBackend()
    const { characterId, productId } = await seedStock(backend)

    await expect(
      backend.mutation(api.transactions.record, {
        characterId,
        kind: "sale",
        occurredAt: Date.now(),
        productId,
        quantity: 1,
      })
    ).rejects.toThrowError("Vous devez être connecté")
  })
})

describe("transactions.recordExchange", () => {
  it("mélange produits, lot, service et achat dans un seul panier", async () => {
    const backend = createTestBackend()
    const member = await asAuthenticatedUser(backend)
    const { characterId, productId } = await seedStock(backend)
    const references = await backend.run(async (ctx) => {
      const ingredientId = await ctx.db.insert("products", {
        active: true,
        category: "ingredient",
        currentStock: 1,
        minimumStock: 0,
        name: "Ail du test",
        normalizedName: "ail du test",
        purchasePrice: 1 / 4,
        tracksStock: true,
      })
      const serviceId = await ctx.db.insert("products", {
        active: true,
        category: "service",
        currentStock: 0,
        minimumStock: 0,
        name: "Location test",
        normalizedName: "location test",
        salePrice: 20,
        tracksStock: false,
      })
      const bundleId = await ctx.db.insert("bundles", {
        active: true,
        name: "Lot du test",
        price: 30,
      })
      await ctx.db.insert("bundleItems", {
        bundleId,
        productId,
        productName: "Potion de soin",
        quantity: 2,
      })
      return { bundleId, ingredientId, serviceId }
    })

    const result = await member.mutation(api.transactions.recordExchange, {
      characterId,
      lines: [
        {
          bundleId: references.bundleId,
          direction: "outgoing",
          kind: "bundle",
          quantity: 1,
        },
        {
          direction: "outgoing",
          kind: "product",
          productId: references.serviceId,
          quantity: 1,
        },
        {
          direction: "incoming",
          kind: "product",
          productId: references.ingredientId,
          quantity: 4,
        },
      ],
      occurredAt: Date.now(),
    })
    const state = await backend.run(async (ctx) => ({
      ingredient: await ctx.db.get(references.ingredientId),
      lines: await ctx.db.query("transactionLines").collect(),
      potion: await ctx.db.get(productId),
      transactions: await ctx.db.query("transactions").collect(),
    }))

    expect(result).toMatchObject({
      incomingTotal: 1,
      outgoingTotal: 50,
      total: 49,
    })
    expect(state.transactions[0]).toMatchObject({ kind: "exchange" })
    expect(state.potion?.currentStock).toBe(8)
    expect(state.ingredient?.currentStock).toBe(5)
    expect(state.lines.map((line) => line.direction)).toEqual(
      expect.arrayContaining(["incoming", "outgoing"])
    )
  })
})

describe("transactions.recordTrade", () => {
  it("enregistre un achat multi-produits dans une seule transaction", async () => {
    const backend = createTestBackend()
    const member = await asAuthenticatedUser(backend)
    const { characterId, productId } = await seedStock(backend)
    const secondProductId = await backend.run(async (ctx) => {
      await ctx.db.patch(productId, { purchasePrice: 1 / 4 })
      return ctx.db.insert("products", {
        active: true,
        category: "ingredient",
        currentStock: 5,
        minimumStock: 1,
        name: "Ail",
        normalizedName: "ail",
        purchasePrice: 3 / 4,
        tracksStock: true,
      })
    })

    const result = await member.mutation(api.transactions.recordTrade, {
      characterId,
      kind: "purchase",
      lines: [
        { kind: "product", productId, quantity: 1 },
        { kind: "product", productId: secondProductId, quantity: 1 },
      ],
      occurredAt: Date.now(),
    })

    const state = await backend.run(async (ctx) => ({
      audits: await ctx.db.query("auditLogs").collect(),
      firstProduct: await ctx.db.get(productId),
      lines: await ctx.db.query("transactionLines").collect(),
      movements: await ctx.db.query("stockMovements").collect(),
      secondProduct: await ctx.db.get(secondProductId),
      transactions: await ctx.db.query("transactions").collect(),
    }))
    expect(result.total).toBe(-1)
    expect(state.firstProduct?.currentStock).toBe(11)
    expect(state.secondProduct?.currentStock).toBe(6)
    expect(state.transactions[0]).toMatchObject({
      kind: "purchase",
      lineCount: 2,
      productName: "2 références",
      total: -1,
    })
    expect(state.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ quantity: 1, total: 1 / 4 }),
        expect.objectContaining({ quantity: 1, total: 3 / 4 }),
      ])
    )
    expect(state.movements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ delta: 1, resultingStock: 11 }),
        expect.objectContaining({ delta: 1, resultingStock: 6 }),
      ])
    )
    expect(state.audits[0]).toMatchObject({ action: "purchase.recorded" })
  })

  it("annule tout l’achat si une référence est indisponible", async () => {
    const backend = createTestBackend()
    const member = await asAuthenticatedUser(backend)
    const { characterId, productId } = await seedStock(backend)
    const archivedProductId = await backend.run((ctx) =>
      ctx.db.insert("products", {
        active: false,
        category: "ingredient",
        currentStock: 4,
        minimumStock: 1,
        name: "Sel",
        normalizedName: "sel",
        purchasePrice: 1,
        tracksStock: true,
      })
    )

    await expect(
      member.mutation(api.transactions.recordTrade, {
        characterId,
        kind: "purchase",
        lines: [
          { kind: "product", productId, quantity: 2 },
          { kind: "product", productId: archivedProductId, quantity: 1 },
        ],
        occurredAt: Date.now(),
      })
    ).rejects.toThrowError("indisponible")

    const state = await backend.run(async (ctx) => ({
      lines: await ctx.db.query("transactionLines").collect(),
      movements: await ctx.db.query("stockMovements").collect(),
      product: await ctx.db.get(productId),
      transactions: await ctx.db.query("transactions").collect(),
    }))
    expect(state.product?.currentStock).toBe(10)
    expect(state.transactions).toHaveLength(0)
    expect(state.lines).toHaveLength(0)
    expect(state.movements).toHaveLength(0)
  })

  it("enregistre une vente multi-références et déstocke les composants des lots", async () => {
    const backend = createTestBackend()
    const member = await asAuthenticatedUser(backend)
    const { characterId, productId } = await seedStock(backend)
    const { bundleId, secondProductId } = await backend.run(async (ctx) => {
      const secondProductId = await ctx.db.insert("products", {
        active: true,
        category: "ingredient",
        currentStock: 5,
        minimumStock: 1,
        name: "Sacoche d’apothicaire",
        normalizedName: "sacoche d apothicaire",
        salePrice: 5,
        tracksStock: true,
      })
      const bundleId = await ctx.db.insert("bundles", {
        active: true,
        name: "Trousse du voyageur",
        price: 20,
      })
      await ctx.db.insert("bundleItems", {
        bundleId,
        productId,
        productName: "Potion de soin",
        quantity: 2,
      })
      await ctx.db.insert("bundleItems", {
        bundleId,
        productId: secondProductId,
        productName: "Sacoche d’apothicaire",
        quantity: 1,
      })
      return { bundleId, secondProductId }
    })

    const result = await member.mutation(api.transactions.recordTrade, {
      characterId,
      discount: 2,
      kind: "sale",
      lines: [
        { kind: "product", productId, quantity: 1 },
        { bundleId, kind: "bundle", quantity: 2 },
      ],
      occurredAt: Date.now(),
    })

    expect(result.total).toBe(50)
    const state = await backend.run(async (ctx) => ({
      audits: await ctx.db.query("auditLogs").collect(),
      firstProduct: await ctx.db.get(productId),
      lines: await ctx.db.query("transactionLines").collect(),
      movements: await ctx.db.query("stockMovements").collect(),
      secondProduct: await ctx.db.get(secondProductId),
      transactions: await ctx.db.query("transactions").collect(),
    }))
    expect(state.firstProduct?.currentStock).toBe(5)
    expect(state.secondProduct?.currentStock).toBe(3)
    expect(state.transactions[0]).toMatchObject({
      kind: "sale",
      lineCount: 2,
      productName: "2 références",
      total: 50,
    })
    expect(state.lines).toHaveLength(2)
    expect(state.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "product",
          productName: "Potion de soin",
          quantity: 1,
          total: 12,
        }),
        expect.objectContaining({
          kind: "bundle",
          productName: "Trousse du voyageur",
          quantity: 2,
          total: 40,
        }),
      ])
    )
    expect(state.movements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ delta: -5, resultingStock: 5 }),
        expect.objectContaining({ delta: -2, resultingStock: 3 }),
      ])
    )
    expect(state.audits[0]).toMatchObject({ action: "sale.recorded" })
  })

  it("refuse tout le panier si un composant de lot manque en stock", async () => {
    const backend = createTestBackend()
    const member = await asAuthenticatedUser(backend)
    const { characterId, productId } = await seedStock(backend)
    const bundleId = await backend.run(async (ctx) => {
      const bundleId = await ctx.db.insert("bundles", {
        active: true,
        name: "Caisse de potions",
        price: 50,
      })
      await ctx.db.insert("bundleItems", {
        bundleId,
        productId,
        productName: "Potion de soin",
        quantity: 6,
      })
      return bundleId
    })

    await expect(
      member.mutation(api.transactions.recordTrade, {
        characterId,
        kind: "sale",
        lines: [{ bundleId, kind: "bundle", quantity: 2 }],
        occurredAt: Date.now(),
      })
    ).rejects.toThrowError("Stock insuffisant")

    const state = await backend.run(async (ctx) => ({
      audits: await ctx.db.query("auditLogs").collect(),
      lines: await ctx.db.query("transactionLines").collect(),
      movements: await ctx.db.query("stockMovements").collect(),
      product: await ctx.db.get(productId),
      transactions: await ctx.db.query("transactions").collect(),
    }))
    expect(state.product?.currentStock).toBe(10)
    expect(state.transactions).toHaveLength(0)
    expect(state.lines).toHaveLength(0)
    expect(state.movements).toHaveLength(0)
    expect(state.audits).toHaveLength(0)
  })

  it("refuse une ligne fractionnaire sans enregistrer le panier", async () => {
    const backend = createTestBackend()
    const member = await asAuthenticatedUser(backend)
    const { characterId, productId } = await seedStock(backend)

    await expect(
      member.mutation(api.transactions.recordTrade, {
        characterId,
        kind: "sale",
        lines: [{ kind: "product", productId, quantity: 1.01 }],
        occurredAt: Date.now(),
      })
    ).rejects.toThrowError("nombre entier")

    const state = await backend.run(async (ctx) => ({
      lines: await ctx.db.query("transactionLines").collect(),
      product: await ctx.db.get(productId),
      transactions: await ctx.db.query("transactions").collect(),
    }))
    expect(state.product?.currentStock).toBe(10)
    expect(state.transactions).toHaveLength(0)
    expect(state.lines).toHaveLength(0)
  })

  it("cumule le panier avant de l’arrondir au septim inférieur", async () => {
    const backend = createTestBackend()
    const member = await asAuthenticatedUser(backend)
    const { characterId, productId } = await seedStock(backend)
    const secondProductId = await backend.run(async (ctx) => {
      await ctx.db.patch(productId, { salePrice: 3 / 4 })
      return ctx.db.insert("products", {
        active: true,
        category: "ingredient",
        currentStock: 10,
        minimumStock: 1,
        name: "Ail",
        normalizedName: "ail",
        salePrice: 3 / 4,
        tracksStock: true,
      })
    })

    const result = await member.mutation(api.transactions.recordTrade, {
      characterId,
      kind: "sale",
      lines: [
        { kind: "product", productId, quantity: 1 },
        { kind: "product", productId: secondProductId, quantity: 1 },
      ],
      occurredAt: Date.now(),
    })

    const transaction = await backend.run((ctx) =>
      ctx.db.query("transactions").first()
    )
    expect(result.total).toBe(1)
    expect(transaction?.total).toBe(1)
  })
})

describe("transactions.listPage et getDetails", () => {
  it("pagine les résumés sans charger les lignes de chaque opération", async () => {
    const backend = createTestBackend()
    const member = await asAuthenticatedUser(backend)
    const { characterId, productId } = await seedStock(backend)
    const now = Date.now()
    for (const offset of [1, 2, 3]) {
      await member.mutation(api.transactions.recordTrade, {
        characterId,
        kind: "sale",
        lines: [{ kind: "product", productId, quantity: 1 }],
        occurredAt: now - offset,
      })
    }

    const firstPage = await member.query(api.transactions.listPage, {
      paginationOpts: { cursor: null, numItems: 2 },
    })
    const secondPage = await member.query(api.transactions.listPage, {
      paginationOpts: {
        cursor: firstPage.continueCursor,
        numItems: 2,
      },
    })

    expect(firstPage.page).toHaveLength(2)
    expect(firstPage.isDone).toBe(false)
    expect(firstPage.page[0]).toMatchObject({
      canDelete: true,
      canManage: true,
    })
    expect(firstPage.page[0]).not.toHaveProperty("lines")
    expect(firstPage.page[0]).not.toHaveProperty("stockDeltas")
    expect(secondPage.page).toHaveLength(1)
    expect(secondPage.isDone).toBe(true)
  })

  it("réserve le journal d’activité aux transactions financières", async () => {
    const backend = createTestBackend()
    const member = await asAuthenticatedUser(backend)
    await backend.run(async (ctx) => {
      for (const [kind, productName, total] of [
        ["adjustment", "Correction de stock", 0],
        ["production", "Potion fabriquée", 0],
        ["sale", "Potion vendue", 12],
      ] as const) {
        await ctx.db.insert("transactions", {
          actorName: "Alixard Veliane",
          kind,
          occurredAt: Date.now(),
          productName,
          quantity: 1,
          searchText: buildTransactionSearchText({
            actorName: "Alixard Veliane",
            productName,
          }),
          source: "web",
          total,
        })
      }
    })

    const page = await member.query(api.transactions.listPage, {
      paginationOpts: { cursor: null, numItems: 10 },
    })
    const searchPage = await member.query(api.transactions.listPage, {
      paginationOpts: { cursor: null, numItems: 10 },
      q: "potion",
    })

    expect(page.page.map((transaction) => transaction.kind)).toEqual(["sale"])
    expect(searchPage.page.map((transaction) => transaction.kind)).toEqual([
      "sale",
    ])
  })

  it("filtre le journal côté serveur par texte, période, type et personnage", async () => {
    const backend = createTestBackend()
    const member = await asAuthenticatedUser(backend)
    const { characterId } = await seedStock(backend)
    const secondCharacterId = await backend.run((ctx) =>
      ctx.db.insert("characters", {
        active: true,
        name: "Bérénice de Verre",
      })
    )
    const day = 86_400_000
    const now = Date.now()
    await backend.run(async (ctx) => {
      for (const transaction of [
        {
          actorCharacterId: characterId,
          actorName: "Alixard Veliane",
          counterparty: "Maison d’Ambre",
          kind: "sale" as const,
          occurredAt: now - day,
          productName: "Potion d’éclat",
        },
        {
          actorCharacterId: characterId,
          actorName: "Alixard Veliane",
          comment: "Livraison pour la Maison d’Ambre",
          kind: "purchase" as const,
          occurredAt: now - day * 2,
          productName: "Lys bleu",
        },
        {
          actorCharacterId: secondCharacterId,
          actorName: "Bérénice de Verre",
          counterparty: "Maison d’Ambre",
          kind: "sale" as const,
          occurredAt: now - day * 3,
          productName: "Potion d’éclat",
        },
      ]) {
        await ctx.db.insert("transactions", {
          ...transaction,
          quantity: 1,
          searchText: buildTransactionSearchText(transaction),
          source: "web",
          total: 12,
        })
      }
    })

    const filtered = await member.query(api.transactions.listPage, {
      characterId,
      from: now - day * 1.5,
      kind: "sale",
      paginationOpts: { cursor: null, numItems: 10 },
      q: "maison eclat",
      to: now,
    })
    const byComment = await member.query(api.transactions.listPage, {
      paginationOpts: { cursor: null, numItems: 10 },
      q: "livraison",
    })

    expect(filtered.page).toHaveLength(1)
    expect(filtered.page[0]).toMatchObject({
      actorCharacterId: characterId,
      kind: "sale",
      productName: "Potion d’éclat",
    })
    expect(byComment.page).toHaveLength(1)
    expect(byComment.page[0]?.kind).toBe("purchase")
  })

  it("pagine une recherche sans perdre les résultats séparés par des non-correspondances", async () => {
    const backend = createTestBackend()
    const member = await asAuthenticatedUser(backend)
    const { characterId } = await seedStock(backend)
    const now = Date.now()
    await backend.run(async (ctx) => {
      for (const [offset, productName] of [
        [1, "Potion solaire"],
        [2, "Sel de lune"],
        [3, "Potion lunaire"],
        [4, "Fiole vide"],
        [5, "Potion minérale"],
      ] as const) {
        await ctx.db.insert("transactions", {
          actorCharacterId: characterId,
          actorName: "Alixard Veliane",
          kind: "sale",
          occurredAt: now - offset,
          productName,
          quantity: 1,
          searchText: buildTransactionSearchText({
            actorName: "Alixard Veliane",
            productName,
          }),
          source: "web",
          total: 12,
        })
      }
    })

    const firstPage = await member.query(api.transactions.listPage, {
      paginationOpts: { cursor: null, numItems: 2 },
      q: "potion",
    })
    const secondPage = await member.query(api.transactions.listPage, {
      paginationOpts: {
        cursor: firstPage.continueCursor,
        numItems: 2,
      },
      q: "potion",
    })

    expect(
      firstPage.page.map((transaction) => transaction.productName)
    ).toEqual(["Potion solaire", "Potion lunaire"])
    expect(firstPage.isDone).toBe(false)
    expect(
      secondPage.page.map((transaction) => transaction.productName)
    ).toEqual(["Potion minérale"])
    expect(secondPage.isDone).toBe(true)
  })

  it("charge les lignes et variations de stock pour une seule opération", async () => {
    const backend = createTestBackend()
    const member = await asAuthenticatedUser(backend)
    const { characterId, productId } = await seedStock(backend)
    const recorded = await member.mutation(api.transactions.recordTrade, {
      characterId,
      kind: "sale",
      lines: [{ kind: "product", productId, quantity: 3 }],
      occurredAt: Date.now(),
    })

    const details = await member.query(api.transactions.getDetails, {
      transactionId: recorded.transactionId,
    })

    expect(details?.lines).toHaveLength(1)
    expect(details?.lines[0]).toMatchObject({
      productId,
      quantity: 3,
    })
    expect(details?.stockDeltas).toEqual([{ delta: -3, productId }])
  })
})

describe("transactions.remove", () => {
  it("supprime réellement une vente, ses lignes et ses mouvements", async () => {
    const backend = createTestBackend()
    const member = await asAuthenticatedUser(backend)
    const { characterId, productId } = await seedStock(backend)
    const recorded = await member.mutation(api.transactions.recordTrade, {
      characterId,
      kind: "sale",
      lines: [{ kind: "product", productId, quantity: 3 }],
      occurredAt: Date.now(),
    })
    const visibleTransactions = await member.query(api.transactions.list, {})
    expect(visibleTransactions[0]?.canDelete).toBe(true)

    await member.mutation(api.transactions.remove, {
      transactionId: recorded.transactionId,
    })

    const state = await backend.run(async (ctx) => ({
      audits: await ctx.db.query("auditLogs").collect(),
      lines: await ctx.db.query("transactionLines").collect(),
      movements: await ctx.db.query("stockMovements").collect(),
      product: await ctx.db.get(productId),
      transaction: await ctx.db.get(recorded.transactionId),
    }))
    expect(state.product?.currentStock).toBe(10)
    expect(state.transaction).toBeNull()
    expect(state.lines).toHaveLength(0)
    expect(state.movements).toHaveLength(0)
    expect(state.audits.at(-1)).toMatchObject({
      action: "transaction.deleted",
      entityId: recorded.transactionId,
    })
  })

  it("refuse de supprimer un achat déjà consommé sans écriture partielle", async () => {
    const backend = createTestBackend()
    const member = await asAuthenticatedUser(backend)
    const { characterId, productId } = await seedStock(backend)
    const recorded = await member.mutation(api.transactions.recordTrade, {
      characterId,
      kind: "purchase",
      lines: [{ kind: "product", productId, quantity: 3 }],
      occurredAt: Date.now(),
    })
    await backend.run((ctx) => ctx.db.patch(productId, { currentStock: 2 }))

    await expect(
      member.mutation(api.transactions.remove, {
        transactionId: recorded.transactionId,
      })
    ).rejects.toThrowError("stock")

    const state = await backend.run(async (ctx) => ({
      audits: await ctx.db.query("auditLogs").collect(),
      lines: await ctx.db.query("transactionLines").collect(),
      movements: await ctx.db.query("stockMovements").collect(),
      product: await ctx.db.get(productId),
      transaction: await ctx.db.get(recorded.transactionId),
    }))
    expect(state.product?.currentStock).toBe(2)
    expect(state.transaction).not.toBeNull()
    expect(state.lines).toHaveLength(1)
    expect(state.movements).toHaveLength(1)
    expect(state.audits).toHaveLength(1)
  })

  it("permet à un employé de supprimer la saisie d’un autre compte", async () => {
    const backend = createTestBackend()
    const employee = await asAuthenticatedUser(backend)
    const transactionId = await backend.run((ctx) =>
      ctx.db.insert("transactions", {
        actorName: "Autre employé",
        actorUserId: "autre-compte",
        kind: "service",
        occurredAt: Date.now(),
        productName: "Conseil alchimique",
        quantity: 1,
        source: "web",
        total: 5,
      })
    )
    const visibleTransactions = await employee.query(api.transactions.list, {})
    expect(visibleTransactions[0]?.canDelete).toBe(true)

    await employee.mutation(api.transactions.remove, { transactionId })
    expect(await backend.run((ctx) => ctx.db.get(transactionId))).toBeNull()
  })
})

describe("transactions.update", () => {
  it("permet à un employé de corriger sa vente et recalcule le stock", async () => {
    const backend = createTestBackend()
    const member = await asAuthenticatedUser(backend)
    const { characterId, productId } = await seedStock(backend)
    const recorded = await member.mutation(api.transactions.record, {
      characterId,
      kind: "sale",
      occurredAt: Date.now(),
      productId,
      quantity: 3,
    })

    await member.mutation(api.transactions.update, {
      characterId,
      kind: "sale",
      lines: [
        {
          kind: "product",
          productId,
          quantity: 5,
          unitPrice: 10,
        },
      ],
      occurredAt: Date.now(),
      transactionId: recorded.transactionId,
    })
    const visibleTransactions = await member.query(api.transactions.list, {})

    const state = await backend.run(async (ctx) => ({
      audits: await ctx.db.query("auditLogs").collect(),
      lines: await ctx.db.query("transactionLines").collect(),
      movements: await ctx.db.query("stockMovements").collect(),
      product: await ctx.db.get(productId),
      transaction: await ctx.db.get(recorded.transactionId),
    }))
    expect(state.product?.currentStock).toBe(5)
    expect(state.transaction).toMatchObject({
      kind: "sale",
      quantity: 5,
      total: 50,
    })
    expect(state.lines).toHaveLength(1)
    expect(state.movements).toHaveLength(1)
    expect(state.movements[0]).toMatchObject({
      delta: -5,
      previousStock: 10,
      resultingStock: 5,
    })
    expect(state.audits.at(-1)?.action).toBe("transaction.updated")
    expect(visibleTransactions[0]?.canManage).toBe(true)
  })

  it("remplace atomiquement les lignes et mouvements d’un achat", async () => {
    const backend = createTestBackend()
    const member = await asAuthenticatedUser(backend)
    const { characterId, productId } = await seedStock(backend)
    const secondProductId = await backend.run((ctx) =>
      ctx.db.insert("products", {
        active: true,
        category: "ingredient",
        currentStock: 5,
        minimumStock: 1,
        name: "Sel des anciens",
        normalizedName: "sel des anciens",
        purchasePrice: 2,
        tracksStock: true,
      })
    )
    const recorded = await member.mutation(api.transactions.recordTrade, {
      characterId,
      kind: "purchase",
      lines: [
        { kind: "product", productId, quantity: 1 },
        { kind: "product", productId: secondProductId, quantity: 1 },
      ],
      occurredAt: Date.now(),
    })

    await member.mutation(api.transactions.update, {
      characterId,
      kind: "purchase",
      lines: [{ kind: "product", productId, quantity: 2, unitPrice: 5 }],
      occurredAt: Date.now(),
      transactionId: recorded.transactionId,
    })

    const state = await backend.run(async (ctx) => ({
      first: await ctx.db.get(productId),
      lines: await ctx.db.query("transactionLines").collect(),
      movements: await ctx.db.query("stockMovements").collect(),
      second: await ctx.db.get(secondProductId),
      transaction: await ctx.db.get(recorded.transactionId),
    }))
    expect(state.first?.currentStock).toBe(12)
    expect(state.second?.currentStock).toBe(5)
    expect(state.transaction?.total).toBe(-10)
    expect(state.lines).toHaveLength(1)
    expect(state.movements).toHaveLength(1)
    expect(state.movements[0]).toMatchObject({ delta: 2 })
  })

  it("refuse une correction qui rendrait un stock négatif sans écriture partielle", async () => {
    const backend = createTestBackend()
    const member = await asAuthenticatedUser(backend)
    const { characterId, productId } = await seedStock(backend)
    const recorded = await member.mutation(api.transactions.record, {
      characterId,
      kind: "purchase",
      occurredAt: Date.now(),
      productId,
      quantity: 3,
    })
    await backend.run((ctx) => ctx.db.patch(productId, { currentStock: 2 }))

    await expect(
      member.mutation(api.transactions.update, {
        characterId,
        kind: "sale",
        lines: [{ kind: "product", productId, quantity: 1 }],
        occurredAt: Date.now(),
        transactionId: recorded.transactionId,
      })
    ).rejects.toThrowError("Stock insuffisant")

    const state = await backend.run(async (ctx) => ({
      movements: await ctx.db.query("stockMovements").collect(),
      product: await ctx.db.get(productId),
      transaction: await ctx.db.get(recorded.transactionId),
    }))
    expect(state.product?.currentStock).toBe(2)
    expect(state.transaction?.kind).toBe("purchase")
    expect(state.movements).toHaveLength(1)
    expect(state.movements[0]?.delta).toBe(3)
  })

  it("permet à un employé de modifier la saisie d’un autre compte", async () => {
    const backend = createTestBackend()
    const employee = await asAuthenticatedUser(backend)
    const { characterId, productId } = await seedStock(backend)
    const transactionId = await backend.run((ctx) =>
      ctx.db.insert("transactions", {
        actorName: "Autre employé",
        actorUserId: "autre-compte",
        kind: "purchase",
        occurredAt: Date.now(),
        productId,
        productName: "Essence de test",
        quantity: 1,
        source: "web",
        total: 0,
      })
    )

    await employee.mutation(api.transactions.update, {
      characterId,
      kind: "purchase",
      lines: [{ kind: "product", productId, quantity: 2 }],
      occurredAt: Date.now(),
      transactionId,
    })

    const transaction = await backend.run((ctx) => ctx.db.get(transactionId))
    expect(transaction).toMatchObject({
      actorUserId: "autre-compte",
      kind: "purchase",
      quantity: 2,
    })
  })
})
