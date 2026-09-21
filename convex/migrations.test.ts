import { convexTest } from "convex-test"
import { describe, expect, it } from "vitest"

import { internal } from "./_generated/api"
import schema from "./schema"
import { modules } from "./test.setup"

describe("migrations.repairRecipeReferences", () => {
  it("relie les anciennes variantes aux produits canoniques", async () => {
    const backend = convexTest(schema, modules)
    const state = await backend.run(async (ctx) => {
      const outputId = await ctx.db.insert("products", {
        active: true,
        category: "potion",
        currentStock: 0,
        minimumStock: 5,
        name: "Médicinale",
        normalizedName: "medicinale",
        tracksStock: true,
      })
      await ctx.db.insert("products", {
        active: true,
        category: "ingredient",
        currentStock: 10,
        minimumStock: 5,
        name: "Ail",
        normalizedName: "ail",
        purchasePrice: 1 / 3,
        tracksStock: true,
      })
      const recipeId = await ctx.db.insert("recipes", {
        active: true,
        cost: 3,
        family: "Médicinal",
        name: "Médicinal",
      })
      await ctx.db.insert("recipeIngredients", {
        ingredientName: "ail",
        quantity: 3,
        raw: "3 ail",
        recipeId,
      })
      await ctx.db.insert("recipeIngredients", {
        ingredientName: "sucrelune",
        quantity: 1,
        raw: "1 sucrelune",
        recipeId,
      })
      return { outputId, recipeId }
    })

    const result = await backend.mutation(
      internal.migrations.repairRecipeReferences,
      {}
    )
    const second = await backend.mutation(
      internal.migrations.repairRecipeReferences,
      {}
    )
    const repaired = await backend.run(async (ctx) => ({
      ingredients: await ctx.db
        .query("recipeIngredients")
        .withIndex("by_recipe", (index) => index.eq("recipeId", state.recipeId))
        .collect(),
      products: await ctx.db.query("products").collect(),
      recipe: await ctx.db.get(state.recipeId),
    }))

    expect(result).toMatchObject({
      createdProducts: 1,
      linkedIngredients: 2,
      linkedRecipes: 1,
      repaired: true,
    })
    expect(second).toMatchObject({ repaired: false })
    expect(repaired.recipe).toMatchObject({
      family: "Médicinale",
      name: "Médicinale",
      productId: state.outputId,
    })
    expect(repaired.recipe?.cost).toBeUndefined()
    expect(
      repaired.ingredients.every((ingredient) => ingredient.productId)
    ).toBe(true)
    expect(
      repaired.products.find((product) => product.name === "Sucrelune")
    ).toMatchObject({ currentStock: 0, tracksStock: true })
  })
})

describe("migrations.reclassifyAnnexePotions", () => {
  it("reclasse les anciennes annexes en potions de façon idempotente", async () => {
    const backend = convexTest(schema, modules)
    const productId = await backend.run((ctx) =>
      ctx.db.insert("products", {
        active: true,
        category: "annexe",
        currentStock: 2,
        minimumStock: 2,
        name: "Potion trouvée",
        normalizedName: "potion trouvee",
        tracksStock: true,
      })
    )

    const result = await backend.mutation(
      internal.migrations.reclassifyAnnexePotions,
      {}
    )
    const second = await backend.mutation(
      internal.migrations.reclassifyAnnexePotions,
      {}
    )
    const product = await backend.run((ctx) => ctx.db.get(productId))

    expect(result).toMatchObject({
      reclassified: true,
      reclassifiedProducts: 1,
    })
    expect(second).toMatchObject({ reclassified: false })
    expect(product?.category).toBe("potion")
  })
})

describe("migrations.classifyPotionCraftability", () => {
  it("distingue les potions fabricables des potions trouvées uniquement", async () => {
    const backend = convexTest(schema, modules)
    const [lootOnlyId, craftableId] = await backend.run(async (ctx) => {
      const lootOnlyId = await ctx.db.insert("products", {
        active: true,
        category: "potion",
        currentStock: 1,
        legacyKey: "product:chevalier",
        minimumStock: 2,
        name: "Chevalier",
        normalizedName: "chevalier",
        tracksStock: true,
      })
      const craftableId = await ctx.db.insert("products", {
        active: true,
        category: "potion",
        currentStock: 0,
        legacyKey: "product:soin mineur",
        minimumStock: 5,
        name: "Soin Mineur",
        normalizedName: "soin mineur",
        tracksStock: true,
      })
      return [lootOnlyId, craftableId] as const
    })

    const result = await backend.mutation(
      internal.migrations.classifyPotionCraftability,
      {}
    )
    const products = await backend.run(async (ctx) => ({
      craftable: await ctx.db.get(craftableId),
      lootOnly: await ctx.db.get(lootOnlyId),
    }))

    expect(result).toMatchObject({
      classified: true,
      craftableProducts: 1,
      lootOnlyProducts: 1,
    })
    expect(products.craftable?.craftable).toBe(true)
    expect(products.lootOnly?.craftable).toBe(false)
  })
})

describe("migrations.normalizeCatalogNames", () => {
  it("normalise le catalogue sans réécrire les opérations historiques", async () => {
    const backend = convexTest(schema, modules)
    const state = await backend.run(async (ctx) => {
      const potionId = await ctx.db.insert("products", {
        active: true,
        category: "potion",
        currentStock: 2,
        minimumStock: 1,
        name: "  POTION DE SOIN  ",
        normalizedName: "potion de soin",
        tracksStock: true,
      })
      const ingredientId = await ctx.db.insert("products", {
        active: true,
        category: "ingredient",
        currentStock: 10,
        minimumStock: 2,
        name: "TIGE DE CHARDON",
        normalizedName: "tige de chardon",
        tracksStock: true,
      })
      const recipeId = await ctx.db.insert("recipes", {
        family: "Soin",
        name: "Potion de SOIN",
        productId: potionId,
      })
      const ingredientLineId = await ctx.db.insert("recipeIngredients", {
        ingredientName: "TIGE DE CHARDON",
        productId: ingredientId,
        quantity: 3,
        raw: "3 TIGE DE CHARDON",
        recipeId,
      })
      const bundleId = await ctx.db.insert("bundles", {
        active: true,
        name: " LOT DU SOIGNEUR ",
      })
      const bundleItemId = await ctx.db.insert("bundleItems", {
        bundleId,
        productId: potionId,
        productName: "POTION DE SOIN",
        quantity: 2,
      })
      const transactionId = await ctx.db.insert("transactions", {
        actorName: "Alix",
        kind: "sale",
        occurredAt: Date.now(),
        productName: "POTION DE SOIN (historique)",
        quantity: 1,
        source: "web",
        total: 12,
      })
      return {
        bundleId,
        bundleItemId,
        ingredientId,
        ingredientLineId,
        potionId,
        recipeId,
        transactionId,
      }
    })

    const result = await backend.mutation(
      internal.migrations.normalizeCatalogNames,
      {}
    )
    const second = await backend.mutation(
      internal.migrations.normalizeCatalogNames,
      {}
    )
    const migrated = await backend.run(async (ctx) => ({
      bundle: await ctx.db.get(state.bundleId),
      bundleItem: await ctx.db.get(state.bundleItemId),
      ingredient: await ctx.db.get(state.ingredientId),
      ingredientLine: await ctx.db.get(state.ingredientLineId),
      potion: await ctx.db.get(state.potionId),
      recipe: await ctx.db.get(state.recipeId),
      transaction: await ctx.db.get(state.transactionId),
    }))

    expect(result).toMatchObject({
      normalized: true,
      normalizedBundleItems: 1,
      normalizedBundles: 1,
      normalizedIngredients: 1,
      normalizedProducts: 2,
      normalizedRecipes: 1,
    })
    expect(second).toMatchObject({ normalized: false })
    expect(migrated.potion).toMatchObject({
      name: "Potion de soin",
      normalizedName: "potion de soin",
    })
    expect(migrated.ingredient).toMatchObject({ name: "Tige de chardon" })
    expect(migrated.recipe).toMatchObject({ name: "Potion de soin" })
    expect(migrated.ingredientLine).toMatchObject({
      ingredientName: "Tige de chardon",
      raw: "3 Tige de chardon",
    })
    expect(migrated.bundle).toMatchObject({ name: "Lot du soigneur" })
    expect(migrated.bundleItem).toMatchObject({
      productName: "Potion de soin",
    })
    expect(migrated.transaction?.productName).toBe(
      "POTION DE SOIN (historique)"
    )
  })

  it("interrompt la migration avant toute écriture en cas de noms concurrents", async () => {
    const backend = convexTest(schema, modules)
    await backend.run(async (ctx) => {
      await ctx.db.insert("products", {
        active: true,
        category: "potion",
        currentStock: 1,
        minimumStock: 0,
        name: "BIÈRE",
        normalizedName: "biere",
        tracksStock: true,
      })
      await ctx.db.insert("products", {
        active: true,
        category: "potion",
        currentStock: 1,
        minimumStock: 0,
        name: "biere",
        normalizedName: "biere",
        tracksStock: true,
      })
    })

    await expect(
      backend.mutation(internal.migrations.normalizeCatalogNames, {})
    ).rejects.toThrowError("en conflit")

    const state = await backend.run(async (ctx) => ({
      names: (await ctx.db.query("products").collect()).map(
        (product) => product.name
      ),
      settings: await ctx.db.query("systemSettings").collect(),
    }))
    expect(state.names).toEqual(["BIÈRE", "biere"])
    expect(state.settings).toHaveLength(0)
  })
})

describe("migrations.normalizeRecipeFamilies", () => {
  it("remplace les variantes libres par les catégories canoniques", async () => {
    const backend = convexTest(schema, modules)
    const recipeIds = await backend.run(async (ctx) => [
      await ctx.db.insert("recipes", {
        family: "Resistance magie",
        name: "Résistance",
      }),
      await ctx.db.insert("recipes", {
        family: "Vigueur accru",
        name: "Vigueur",
      }),
    ])

    const result = await backend.mutation(
      internal.migrations.normalizeRecipeFamilies,
      {}
    )
    const recipes = await backend.run((ctx) =>
      Promise.all(recipeIds.map((recipeId) => ctx.db.get(recipeId)))
    )

    expect(result).toMatchObject({ normalized: true, normalizedRecipes: 2 })
    expect(recipes.map((recipe) => recipe?.family)).toEqual([
      "Résistance magique",
      "Vigueur améliorée",
    ])
  })
})

describe("migrations.indexTransactionSearch", () => {
  it("indexe les opérations historiques de façon idempotente", async () => {
    const backend = convexTest(schema, modules)
    const transactionId = await backend.run((ctx) =>
      ctx.db.insert("transactions", {
        actorName: "Éléonore",
        comment: "Livraison urgente",
        counterparty: "Maison d’Ambre",
        kind: "sale",
        occurredAt: Date.now(),
        productName: "Potion d’éclat",
        quantity: 2,
        source: "workbook",
        total: 24,
      })
    )

    const result = await backend.mutation(
      internal.migrations.indexTransactionSearch,
      {}
    )
    const second = await backend.mutation(
      internal.migrations.indexTransactionSearch,
      {}
    )
    const transaction = await backend.run((ctx) => ctx.db.get(transactionId))

    expect(result).toEqual({ indexed: true, indexedTransactions: 1 })
    expect(second).toMatchObject({ indexed: false })
    expect(transaction?.searchText).toBe(
      "potion d eclat eleonore maison d ambre livraison urgente"
    )
  })
})

describe("migrations.normalizeContacts", () => {
  it("fusionne les doublons sans modifier les noms historiques des commandes", async () => {
    const backend = convexTest(schema, modules)
    const state = await backend.run(async (ctx) => {
      const canonicalId = await ctx.db.insert("contacts", {
        kind: "client",
        legacyKey: "contact:maison-ambre",
        name: "Maison d’Ambre",
      })
      const duplicateId = await ctx.db.insert("contacts", {
        kind: "client",
        name: " maison d ambre ",
      })
      const orderId = await ctx.db.insert("orders", {
        contactId: duplicateId,
        contactName: "Maison d ambre (historique)",
        kind: "client",
        status: "open",
      })
      return { canonicalId, duplicateId, orderId }
    })

    const result = await backend.mutation(
      internal.migrations.normalizeContacts,
      {}
    )
    const second = await backend.mutation(
      internal.migrations.normalizeContacts,
      {}
    )
    const migrated = await backend.run(async (ctx) => ({
      contacts: await ctx.db.query("contacts").collect(),
      duplicate: await ctx.db.get(state.duplicateId),
      order: await ctx.db.get(state.orderId),
    }))

    expect(result).toMatchObject({
      mergedContacts: 1,
      normalized: true,
      rewiredOrders: 1,
    })
    expect(second).toMatchObject({ normalized: false })
    expect(migrated.contacts).toHaveLength(1)
    expect(migrated.contacts[0]).toMatchObject({
      _id: state.canonicalId,
      active: true,
      normalizedName: "maison d ambre",
    })
    expect(migrated.duplicate).toBeNull()
    expect(migrated.order).toMatchObject({
      contactId: state.canonicalId,
      contactName: "Maison d ambre (historique)",
    })
  })
})

describe("migrations.normalizeSupplierOrderStatuses", () => {
  it("remplace l’ancien état prêt des fournisseurs par à recevoir", async () => {
    const backend = convexTest(schema, modules)
    const orderId = await backend.run((ctx) =>
      ctx.db.insert("orders", {
        contactName: "Fournisseur historique",
        kind: "supplier",
        status: "ready",
      })
    )

    const result = await backend.mutation(
      internal.migrations.normalizeSupplierOrderStatuses,
      {}
    )
    const order = await backend.run((ctx) => ctx.db.get(orderId))

    expect(result).toEqual({ normalizedOrders: 1 })
    expect(order).toMatchObject({ status: "open" })
  })
})
