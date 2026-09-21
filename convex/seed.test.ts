import { convexTest } from "convex-test"
import { describe, expect, it } from "vitest"

import seedData from "../data/inventaire.seed.json"
import { api, internal } from "./_generated/api"
import { roundSeptimsDown } from "./lib/numbers"
import schema from "./schema"
import { modules } from "./test.setup"

describe("seed.importWorkbook", () => {
  it("refuse un secret invalide avant toute écriture", async () => {
    process.env.SEED_SECRET = "secret-de-test-valide"
    const backend = convexTest(schema, modules)

    await expect(
      backend.mutation(api.seed.importWorkbook, {
        seedSecret: "secret-de-test-invalide",
      })
    ).rejects.toThrowError("L’import initial n’est pas autorisé")

    const products = await backend.run((ctx) =>
      ctx.db.query("products").collect()
    )
    expect(products).toHaveLength(0)
  })

  it("importe directement le classeur dans le modèle d’échange converti", async () => {
    process.env.SEED_SECRET = "secret-de-test-valide"
    const backend = convexTest(schema, modules)

    const result = await backend.mutation(api.seed.importWorkbook, {
      seedSecret: "secret-de-test-valide",
    })
    const secondMigration = await backend.mutation(
      internal.migrations.convertLegacyOperations,
      {}
    )
    const state = await backend.run(async (ctx) => ({
      bundleItems: await ctx.db.query("bundleItems").collect(),
      lines: await ctx.db.query("transactionLines").collect(),
      orderLines: await ctx.db.query("orderLines").collect(),
      orders: await ctx.db.query("orders").collect(),
      products: await ctx.db.query("products").collect(),
      recipeIngredients: await ctx.db.query("recipeIngredients").collect(),
      recipes: await ctx.db.query("recipes").collect(),
      transactions: await ctx.db.query("transactions").collect(),
    }))

    expect(result).toMatchObject({
      imported: true,
      migration: {
        converted: true,
        convertedTransactions: 232,
        linkedBundleItems: 21,
        linkedOrderLines: 8,
      },
      recipeMigration: {
        createdProducts: 0,
        repaired: true,
      },
    })
    expect(secondMigration).toMatchObject({ converted: false })
    expect(state.transactions).toHaveLength(seedData.transactions.length)
    expect(
      state.transactions.filter((transaction) =>
        ["bundle", "order", "service"].includes(transaction.kind)
      )
    ).toHaveLength(0)
    expect(
      state.transactions.filter(
        (transaction) =>
          transaction.kind !== "production" && !transaction.lineCount
      )
    ).toHaveLength(0)
    expect(state.lines).toHaveLength(245)
    expect(state.bundleItems.every((item) => item.productId)).toBe(true)
    expect(state.orderLines.every((line) => line.productId)).toBe(true)
    expect(state.recipes.every((recipe) => recipe.productId)).toBe(true)
    expect(
      state.recipeIngredients.every((ingredient) => ingredient.productId)
    ).toBe(true)
    for (const transaction of state.transactions) {
      if (["adjustment", "production"].includes(transaction.kind)) continue
      const linkedOrder = transaction.orderId
        ? state.orders.find((order) => order._id === transaction.orderId)
        : undefined
      if (linkedOrder) {
        expect(transaction.discount, transaction.legacyKey).toBeUndefined()
        expect(transaction.productName, transaction.legacyKey).toBe(
          linkedOrder.kind === "client"
            ? `Commande de ${linkedOrder.contactName}`
            : `Commande auprès de ${linkedOrder.contactName}`
        )
        expect(transaction.total, transaction.legacyKey).toBe(
          linkedOrder.kind === "client"
            ? linkedOrder.total
            : -(linkedOrder.total ?? 0)
        )
        continue
      }
      const lines = state.lines.filter(
        (line) => line.transactionId === transaction._id
      )
      const outgoingGross = lines
        .filter((line) => line.direction === "outgoing")
        .reduce((sum, line) => sum + line.total, 0)
      const incomingGross = lines
        .filter((line) => line.direction === "incoming")
        .reduce((sum, line) => sum + line.total, 0)
      const recomputedTotal =
        roundSeptimsDown(outgoingGross - (transaction.discount ?? 0)) -
        roundSeptimsDown(incomingGross)

      expect(recomputedTotal, transaction.legacyKey).toBe(transaction.total)
      if (incomingGross > 0 && outgoingGross === 0) {
        expect(transaction.discount, transaction.legacyKey).toBeUndefined()
      }
    }
    expect(
      state.products.find(
        (product) => product.name === "Location table étranger"
      )
    ).toMatchObject({ currentStock: 0, salePrice: 20, tracksStock: false })
    expect(
      state.products.find((product) => product.name === "Sucrelune")
    ).toMatchObject({ currentStock: 0, tracksStock: true })
    expect(
      state.recipes.find((recipe) => recipe.name === "Médicinale")
    ).toMatchObject({ family: "Médicinale" })
    expect(
      state.products
        .filter((product) => product.legacyKey)
        .map((product) => product.currentStock)
    ).toEqual(seedData.products.map((product) => product.currentStock))
  })

  it("actualise seulement les transactions du classeur sans modifier les stocks", async () => {
    process.env.SEED_SECRET = "secret-de-test-valide"
    const backend = convexTest(schema, modules)
    await backend.mutation(api.seed.importWorkbook, {
      seedSecret: "secret-de-test-valide",
    })
    const before = await backend.run(async (ctx) => {
      const webTransactionId = await ctx.db.insert("transactions", {
        actorName: "Employé web",
        kind: "service",
        occurredAt: Date.now(),
        productName: "Service conservé",
        quantity: 1,
        source: "web",
        total: 42,
      })
      return {
        productStocks: Object.fromEntries(
          (await ctx.db.query("products").collect()).map((product) => [
            product._id,
            product.currentStock,
          ])
        ),
        webTransactionId,
      }
    })

    const result = await backend.mutation(
      internal.migrations.refreshWorkbookTransactions,
      {}
    )
    const second = await backend.mutation(
      internal.migrations.refreshWorkbookTransactions,
      {}
    )
    const state = await backend.run(async (ctx) => ({
      products: await ctx.db.query("products").collect(),
      summary: await ctx.db
        .query("journalSummaries")
        .withIndex("by_key", (index) => index.eq("key", "main"))
        .unique(),
      transactions: await ctx.db.query("transactions").collect(),
      webTransaction: await ctx.db.get(before.webTransactionId),
    }))

    expect(result).toMatchObject({
      importedTransactions: seedData.transactions.length,
      preservedWebTransactions: 1,
      refreshed: true,
      removedTransactions: seedData.transactions.length,
    })
    expect(second).toMatchObject({ refreshed: false })
    expect(state.webTransaction).not.toBeNull()
    expect(
      state.transactions.filter(
        (transaction) => transaction.source === "workbook"
      )
    ).toHaveLength(seedData.transactions.length)
    expect(state.transactions).toHaveLength(seedData.transactions.length + 1)
    expect(state.summary?.balance).toBe(
      seedData.transactions.reduce(
        (total, transaction) => total + transaction.total,
        42
      )
    )
    for (const product of state.products) {
      expect(product.currentStock).toBe(before.productStocks[product._id])
    }
  })
})
