import { describe, expect, it } from "vitest"

import { api } from "./_generated/api"
import { asAuthenticatedUser, createTestBackend } from "./test.helpers"

describe("products.save", () => {
  it("uniformise l’affichage et refuse les variantes d’un même nom", async () => {
    const backend = createTestBackend()
    const admin = await asAuthenticatedUser(backend, "admin")

    const productId = await admin.mutation(api.products.save, {
      active: true,
      category: "potion",
      minimumStock: 0,
      name: "  POTION DE SOIN  ",
      purchasePrice: null,
      salePrice: null,
      targetStock: 0,
    })

    await expect(
      admin.mutation(api.products.save, {
        active: true,
        category: "potion",
        minimumStock: 0,
        name: "potion de sóin",
        purchasePrice: null,
        salePrice: null,
        targetStock: 0,
      })
    ).rejects.toThrowError("existe déjà")

    const product = await backend.run((ctx) => ctx.db.get(productId))
    expect(product).toMatchObject({
      name: "Potion de soin",
      normalizedName: "potion de soin",
    })
  })

  it("accepte les prix fractionnaires avec des stocks entiers", async () => {
    const backend = createTestBackend()
    const admin = await asAuthenticatedUser(backend, "admin")

    const productId = await admin.mutation(api.products.save, {
      active: true,
      category: "potion",
      minimumStock: 2,
      name: "Potion de soin diluée",
      purchasePrice: 1 / 8,
      salePrice: 1 / 4,
      targetStock: 12,
    })

    const product = await backend.run((ctx) => ctx.db.get(productId))
    expect(product).toMatchObject({
      craftable: true,
      currentStock: 12,
      minimumStock: 2,
      purchasePrice: 1 / 8,
      salePrice: 1 / 4,
    })
  })

  it("refuse un stock fractionnaire sans écriture partielle", async () => {
    const backend = createTestBackend()
    const admin = await asAuthenticatedUser(backend, "admin")

    await expect(
      admin.mutation(api.products.save, {
        active: true,
        category: "potion",
        minimumStock: 1,
        name: "Potion de vigueur",
        purchasePrice: 1 / 4,
        salePrice: 1 / 2,
        targetStock: 1.5,
      })
    ).rejects.toThrowError("nombre entier")

    const products = await backend.run((ctx) =>
      ctx.db.query("products").collect()
    )
    expect(products).toHaveLength(0)
  })

  it("permet à un administrateur de modifier les prix et trace un ajustement de stock", async () => {
    const backend = createTestBackend()
    const admin = await asAuthenticatedUser(backend, "admin")
    const productId = await backend.run(async (ctx) => {
      const id = await ctx.db.insert("products", {
        active: true,
        category: "potion",
        currentStock: 8,
        minimumStock: 2,
        name: "Potion de vigueur",
        normalizedName: "potion de vigueur",
        purchasePrice: 5,
        salePrice: 11,
        tracksStock: true,
      })
      await ctx.db.insert("recipes", {
        active: true,
        family: "Vigueur",
        name: "Potion de vigueur",
        productId: id,
      })
      return id
    })

    await admin.mutation(api.products.save, {
      active: true,
      category: "potion",
      minimumStock: 4,
      name: "Potion de vigueur supérieure",
      productId,
      purchasePrice: 6,
      salePrice: 15,
      targetStock: 10,
    })
    await admin.mutation(api.products.setActive, {
      active: false,
      productId,
    })
    await admin.mutation(api.products.setActive, {
      active: true,
      productId,
    })

    const state = await backend.run(async (ctx) => ({
      audits: await ctx.db.query("auditLogs").collect(),
      movements: await ctx.db.query("stockMovements").collect(),
      product: await ctx.db.get(productId),
      recipes: await ctx.db.query("recipes").collect(),
      transactions: await ctx.db.query("transactions").collect(),
    }))
    expect(state.product).toMatchObject({
      currentStock: 10,
      minimumStock: 4,
      name: "Potion de vigueur supérieure",
      purchasePrice: 6,
      salePrice: 15,
    })
    expect(state.recipes[0]?.name).toBe("Potion de vigueur supérieure")
    expect(state.transactions).toHaveLength(1)
    expect(state.transactions[0]).toMatchObject({
      comment: "Correction de stock (8 → 10)",
      kind: "adjustment",
      quantity: 2,
      total: 0,
    })
    expect(state.movements[0]).toMatchObject({
      delta: 2,
      previousStock: 8,
      resultingStock: 10,
    })
    expect(state.audits.map((audit) => audit.action)).toEqual([
      "product.stock_adjusted",
      "product.updated",
      "product.archived",
      "product.reactivated",
    ])
  })

  it("répercute le renommage d’un ingrédient dans les recettes et les lots", async () => {
    const backend = createTestBackend()
    const admin = await asAuthenticatedUser(backend, "admin")
    const productId = await backend.run(async (ctx) => {
      const ingredientId = await ctx.db.insert("products", {
        active: true,
        category: "ingredient",
        currentStock: 5,
        minimumStock: 1,
        name: "Fleur pâle",
        normalizedName: "fleur pale",
        purchasePrice: 2,
        tracksStock: true,
      })
      const recipeId = await ctx.db.insert("recipes", {
        active: true,
        family: "Essais",
        name: "Décoction claire",
      })
      await ctx.db.insert("recipeIngredients", {
        ingredientName: "Fleur pâle",
        productId: ingredientId,
        quantity: 3,
        raw: "3 Fleur pâle",
        recipeId,
      })
      const bundleId = await ctx.db.insert("bundles", {
        active: true,
        name: "Nécessaire d’alchimiste",
      })
      await ctx.db.insert("bundleItems", {
        bundleId,
        productId: ingredientId,
        productName: "Fleur pâle",
        quantity: 2,
      })
      return ingredientId
    })

    await admin.mutation(api.products.save, {
      active: true,
      category: "ingredient",
      minimumStock: 1,
      name: "Fleur des brumes",
      productId,
      purchasePrice: 2,
      salePrice: null,
      targetStock: 5,
    })

    const state = await backend.run(async (ctx) => ({
      bundleItems: await ctx.db.query("bundleItems").collect(),
      recipeIngredients: await ctx.db.query("recipeIngredients").collect(),
    }))
    expect(state.recipeIngredients[0]).toMatchObject({
      ingredientName: "Fleur des brumes",
      raw: "3 Fleur des brumes",
    })
    expect(state.bundleItems[0]?.productName).toBe("Fleur des brumes")
  })

  it("corrige le stock sans motif et conserve une trace automatique", async () => {
    const backend = createTestBackend()
    const admin = await asAuthenticatedUser(backend, "admin")
    const productId = await backend.run((ctx) =>
      ctx.db.insert("products", {
        active: true,
        category: "ingredient",
        currentStock: 5,
        minimumStock: 1,
        name: "Fleur de montagne",
        normalizedName: "fleur de montagne",
        tracksStock: true,
      })
    )

    await admin.mutation(api.products.save, {
      active: true,
      category: "ingredient",
      minimumStock: 1,
      name: "Fleur de montagne",
      productId,
      purchasePrice: null,
      salePrice: null,
      targetStock: 4,
    })

    const state = await backend.run(async (ctx) => ({
      audits: await ctx.db.query("auditLogs").collect(),
      product: await ctx.db.get(productId),
      transactions: await ctx.db.query("transactions").collect(),
    }))
    expect(state.product?.currentStock).toBe(4)
    expect(state.transactions).toHaveLength(1)
    expect(state.transactions[0]).toMatchObject({
      comment: "Correction de stock (5 → 4)",
      kind: "adjustment",
    })
    expect(state.audits.map((audit) => audit.action)).toEqual([
      "product.stock_adjusted",
      "product.updated",
    ])
  })

  it("refuse de rendre non fabricable une potion qui possède une recette active", async () => {
    const backend = createTestBackend()
    const admin = await asAuthenticatedUser(backend, "admin")
    const productId = await backend.run(async (ctx) => {
      const id = await ctx.db.insert("products", {
        active: true,
        category: "potion",
        craftable: true,
        currentStock: 2,
        minimumStock: 1,
        name: "Potion liée",
        normalizedName: "potion liee",
        tracksStock: true,
      })
      await ctx.db.insert("recipes", {
        active: true,
        family: "Soin",
        name: "Potion liée",
        productId: id,
      })
      return id
    })

    await expect(
      admin.mutation(api.products.save, {
        active: true,
        category: "potion",
        craftable: false,
        minimumStock: 1,
        name: "Potion liée",
        productId,
        purchasePrice: null,
        salePrice: null,
        targetStock: 2,
      })
    ).rejects.toThrowError("Archivez d’abord la recette active")

    const product = await backend.run((ctx) => ctx.db.get(productId))
    expect(product?.craftable).toBe(true)
  })

  it("modifie sans migration un ingrédient déjà lié à une recette", async () => {
    const backend = createTestBackend()
    const admin = await asAuthenticatedUser(backend, "admin")
    const productId = await backend.run(async (ctx) => {
      const id = await ctx.db.insert("products", {
        active: true,
        category: "ingredient",
        currentStock: 6,
        minimumStock: 2,
        name: "Sel de givre",
        normalizedName: "sel de givre",
        purchasePrice: 2,
        tracksStock: true,
      })
      await ctx.db.insert("recipes", {
        active: true,
        family: "Sel",
        name: "Sel de givre",
        productId: id,
      })
      return id
    })

    await admin.mutation(api.products.save, {
      active: true,
      category: "ingredient",
      minimumStock: 3,
      name: "Sel de givre raffiné",
      productId,
      purchasePrice: 3,
      salePrice: null,
      targetStock: 6,
    })
    await expect(
      admin.mutation(api.products.save, {
        active: true,
        category: "ingredient",
        craftable: false,
        minimumStock: 3,
        name: "Sel de givre raffiné",
        productId,
        purchasePrice: 3,
        salePrice: null,
        targetStock: 6,
      })
    ).rejects.toThrowError("Archivez d’abord la recette active")

    const state = await backend.run(async (ctx) => ({
      product: await ctx.db.get(productId),
      recipes: await ctx.db.query("recipes").collect(),
      transactions: await ctx.db.query("transactions").collect(),
    }))
    expect(state.product).toMatchObject({
      category: "ingredient",
      craftable: true,
      currentStock: 6,
      minimumStock: 3,
      name: "Sel de givre raffiné",
      purchasePrice: 3,
    })
    expect(state.recipes[0]?.name).toBe("Sel de givre raffiné")
    expect(state.transactions).toHaveLength(0)
  })

  it("permet la gestion du catalogue à un employé", async () => {
    const backend = createTestBackend()
    const employee = await asAuthenticatedUser(backend)

    await employee.mutation(api.products.save, {
      active: true,
      category: "ingredient",
      minimumStock: 0,
      name: "Flacon vide",
      purchasePrice: 1,
      salePrice: 2,
      targetStock: 0,
    })

    const products = await backend.run((ctx) =>
      ctx.db.query("products").collect()
    )
    expect(products).toMatchObject([{ name: "Flacon vide" }])
  })
})
