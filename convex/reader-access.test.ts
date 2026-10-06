import { describe, expect, it } from "vitest"
import { api, components } from "./_generated/api"
import { asAuthenticatedUser, createTestBackend } from "./test.helpers"
import { defaultReaderAccess } from "../shared/reader-access"

async function fixture() {
  const backend = createTestBackend()
  const admin = await asAuthenticatedUser(backend, "admin")
  const reader = await asAuthenticatedUser(backend, "reader")
  const user = await reader.query(api.auth.getCurrentUser, {})
  if (!user) throw new Error("Lecteur absent")
  const ids = await backend.run(async (ctx) => {
    const product = {
      active: true,
      category: "ingredient" as const,
      currentStock: 12345,
      minimumStock: 50,
      normalizedName: "public",
      purchasePrice: 4567,
      salePrice: 8765,
      tracksStock: true,
    }
    const a = await ctx.db.insert("products", {
      ...product,
      name: "Produit autorisé",
    })
    const b = await ctx.db.insert("products", {
      ...product,
      name: "Produit secret",
      normalizedName: "secret",
    })
    const character = await ctx.db.insert("characters", {
      name: "Employé",
      active: true,
    })
    const sale = await ctx.db.insert("transactions", {
      actorName: "Employé",
      actorCharacterId: character,
      kind: "sale",
      productId: a,
      productName: "Produit autorisé",
      quantity: 1,
      occurredAt: Date.now(),
      source: "web",
      total: 8765,
    })
    const purchase = await ctx.db.insert("transactions", {
      actorName: "Employé",
      kind: "purchase",
      productId: a,
      productName: "Achat privé",
      quantity: 1,
      occurredAt: Date.now(),
      source: "web",
      total: -4567,
    })
    const hiddenSale = await ctx.db.insert("transactions", {
      actorName: "Employé",
      kind: "sale",
      productId: b,
      productName: "Produit secret",
      quantity: 1,
      occurredAt: Date.now(),
      source: "web",
      total: 99999,
    })
    const mixed = await ctx.db.insert("transactions", {
      actorName: "Employé",
      kind: "sale",
      productId: a,
      productName: "Échange mixte secret",
      quantity: 1,
      occurredAt: Date.now(),
      source: "web",
      total: 88888,
      lineCount: 2,
    })
    await ctx.db.insert("transactionLines", {
      transactionId: mixed,
      kind: "product",
      productId: a,
      productName: "Produit autorisé",
      quantity: 1,
      total: 8765,
      unitPrice: 8765,
    })
    await ctx.db.insert("transactionLines", {
      transactionId: mixed,
      kind: "product",
      productId: b,
      productName: "Produit secret",
      quantity: 1,
      total: 8765,
      unitPrice: 8765,
    })
    const production = await ctx.db.insert("transactions", {
      actorName: "Employé",
      kind: "production",
      productId: a,
      productName: "Production secrète",
      quantity: 1,
      occurredAt: Date.now(),
      source: "web",
      total: 0,
    })
    await ctx.db.insert("stockMovements", {
      transactionId: production,
      productId: b,
      delta: -1,
      occurredAt: Date.now(),
      reason: "production",
    })
    const recipe = await ctx.db.insert("recipes", {
      active: true,
      productId: a,
      name: "Recette autorisée",
      family: "Utilitaire",
      cost: 4567,
      missingCostReferences: [],
    })
    await ctx.db.insert("recipeIngredients", {
      recipeId: recipe,
      productId: a,
      ingredientName: "Produit autorisé",
      quantity: 1,
      raw: "1 Produit autorisé",
    })
    const hiddenRecipe = await ctx.db.insert("recipes", {
      active: true,
      productId: a,
      name: "Recette secrète",
      family: "Utilitaire",
    })
    await ctx.db.insert("recipeIngredients", {
      recipeId: hiddenRecipe,
      productId: b,
      ingredientName: "Produit secret",
      quantity: 1,
      raw: "1 Produit secret",
    })
    const bundle = await ctx.db.insert("bundles", {
      active: true,
      name: "Lot autorisé",
      price: 8765,
    })
    await ctx.db.insert("bundleItems", {
      bundleId: bundle,
      productId: a,
      productName: "Produit autorisé",
      quantity: 1,
    })
    const hiddenBundle = await ctx.db.insert("bundles", {
      active: true,
      name: "Lot secret",
      price: 88888,
    })
    await ctx.db.insert("bundleItems", {
      bundleId: hiddenBundle,
      productId: b,
      productName: "Produit secret",
      quantity: 1,
    })
    const order = await ctx.db.insert("orders", {
      contactName: "Client autorisé",
      kind: "client",
      status: "open",
      total: 8765,
      transactionId: purchase,
    })
    await ctx.db.insert("orderLines", {
      orderId: order,
      productId: a,
      productName: "Produit autorisé",
      quantity: 1,
      total: 8765,
      unitPrice: 8765,
    })
    const hiddenOrder = await ctx.db.insert("orders", {
      contactName: "Client secret",
      kind: "client",
      status: "open",
      total: 88888,
    })
    await ctx.db.insert("orderLines", {
      orderId: hiddenOrder,
      productId: b,
      productName: "Produit secret",
      quantity: 1,
      total: 88888,
      unitPrice: 88888,
    })
    return {
      a,
      b,
      sale,
      purchase,
      hiddenSale,
      mixed,
      production,
      recipe,
      bundle,
      order,
      hiddenOrder,
    }
  })
  const access = {
    ...defaultReaderAccess,
    productIds: [ids.a],
    operationKinds: ["sale"] as ["sale"],
    showPrices: false,
    showStock: false,
  }
  await admin.mutation(api.administration.saveAccountAccess, {
    userId: user._id,
    role: "reader",
    access,
  })
  return { backend, admin, reader, userId: user._id, ids, access }
}

describe("droits détaillés des lecteurs", () => {
  it.each([
    {
      showPurchasePrices: false,
      showSalePrices: true,
      purchasePrice: 0,
      salePrice: 8765,
      cost: 0,
    },
    {
      showPurchasePrices: true,
      showSalePrices: false,
      purchasePrice: 4567,
      salePrice: 0,
      cost: 4567,
    },
  ])(
    "sépare les prix d’achat et de vente et masque les montants dérivés ($showPurchasePrices/$showSalePrices)",
    async (expected) => {
      const { admin, reader, userId, access } = await fixture()
      await admin.mutation(api.administration.saveAccountAccess, {
        userId,
        role: "reader",
        access: {
          ...access,
          showPrices: true,
          showPurchasePrices: expected.showPurchasePrices,
          showSalePrices: expected.showSalePrices,
        },
      })
      expect((await reader.query(api.products.list, {}))[0]).toMatchObject({
        purchasePrice: expected.purchasePrice,
        salePrice: expected.salePrice,
      })
      expect((await reader.query(api.recipes.list, {}))[0]?.cost).toBe(
        expected.cost
      )
      expect((await reader.query(api.transactions.list, {}))[0]?.total).toBe(0)
      expect(
        (await reader.query(api.accounts.overview, {})).journalBalance
      ).toBe(0)
    }
  )
  it("applique aussi la sélection des produits et le masquage aux archives", async () => {
    const { backend, reader, ids } = await fixture()
    await backend.run(async (ctx) => {
      for (const product of await ctx.db.query("products").collect())
        await ctx.db.patch(product._id, { active: false })
      for (const recipe of await ctx.db.query("recipes").collect())
        await ctx.db.patch(recipe._id, { active: false })
      for (const bundle of await ctx.db.query("bundles").collect())
        await ctx.db.patch(bundle._id, { active: false })
    })
    const products = await reader.query(api.products.listArchived, {})
    expect(products.map((product) => product._id)).toEqual([ids.a])
    expect(products[0]).toMatchObject({
      purchasePrice: 0,
      salePrice: 0,
      currentStock: 0,
    })
    expect(
      (await reader.query(api.recipes.listArchived, {})).map(
        (recipe) => recipe._id
      )
    ).toEqual([ids.recipe])
    const bundles = await reader.query(api.bundles.listArchived, {})
    expect(bundles.map((bundle) => bundle._id)).toEqual([ids.bundle])
    expect(bundles[0]?.price).toBe(0)
  })

  it("limite les données de support du catalogue aux références liées aux rubriques autorisées", async () => {
    const { admin, reader, userId, ids, access } = await fixture()
    await admin.mutation(api.administration.saveAccountAccess, {
      userId,
      role: "reader",
      access: { ...access, sections: ["bundles"] },
    })
    expect(
      (await reader.query(api.products.catalog, {})).map(
        (product) => product._id
      )
    ).toEqual([ids.a])
    await expect(reader.query(api.products.list, {})).rejects.toThrow(
      "ne permet pas de consulter"
    )
    await expect(reader.query(api.recipes.list, {})).rejects.toThrow(
      "ne permet pas de consulter"
    )
    await expect(reader.query(api.characters.list, {})).rejects.toThrow(
      "ne permet pas de consulter"
    )
    const order = await reader.query(api.auth.getCurrentUser, {})
    expect(order?.readerAccess?.sections).toEqual(["bundles"])
  })

  it("refuse également la création de comptes par un lecteur et ignore les restrictions d’un employé promu", async () => {
    const { reader, admin, userId, access, ids } = await fixture()
    await expect(
      reader.mutation(api.administration.createReaderAccount, {
        identifier: "intrus",
        name: "Intrus",
        password: "Mot-de-passe-local-test",
        access,
      })
    ).rejects.toThrow("réservée aux administrateurs")
    await admin.mutation(api.administration.saveAccountAccess, {
      userId,
      role: "user",
      access,
    })
    expect(
      (await reader.query(api.products.list, {})).map((product) => product._id)
    ).toContain(ids.b)
    expect(
      (await reader.query(api.auth.getCurrentUser, {}))?.readerAccess
    ).toBeNull()
  })
  it("filtre les produits et masque leurs prix et stocks dans l’API", async () => {
    const { reader, ids } = await fixture()
    for (const query of [
      api.products.list,
      api.products.selectable,
      api.products.catalog,
    ]) {
      const products = await reader.query(query, {})
      expect(products).toHaveLength(1)
      expect(products[0]).toMatchObject({
        _id: ids.a,
        purchasePrice: 0,
        salePrice: 0,
        currentStock: 0,
        minimumStock: 0,
      })
      expect(JSON.stringify(products)).not.toContain("Produit secret")
    }
  })

  it("filtre les opérations, les échanges mixtes, les détails et les productions impliquant un ingrédient interdit", async () => {
    const { reader, admin, ids, userId, access } = await fixture()
    const list = await reader.query(api.transactions.list, {})
    expect(list.map((transaction) => transaction._id)).toEqual([ids.sale])
    expect(list[0]).toMatchObject({
      total: 0,
      canManage: false,
      stockDeltas: [],
    })
    const page = await reader.query(api.transactions.listPage, {
      paginationOpts: { cursor: null, numItems: 100 },
    })
    expect(page.page.map((transaction) => transaction._id)).toEqual([ids.sale])
    for (const transactionId of [
      ids.purchase,
      ids.hiddenSale,
      ids.mixed,
      ids.production,
    ])
      expect(
        await reader.query(api.transactions.getDetails, { transactionId })
      ).toBeNull()
    await admin.mutation(api.administration.saveAccountAccess, {
      userId,
      role: "reader",
      access: { ...access, operationKinds: ["production"] },
    })
    expect(
      await reader.query(api.transactions.getDetails, {
        transactionId: ids.production,
      })
    ).toBeNull()
  })

  it("filtre les recettes, lots et commandes et protège les transactions liées", async () => {
    const { reader, ids } = await fixture()
    const recipes = await reader.query(api.recipes.list, {})
    expect(recipes.map((recipe) => recipe._id)).toEqual([ids.recipe])
    expect(recipes[0]?.cost).toBe(0)
    const bundles = await reader.query(api.recipes.listBundles, {})
    expect(bundles.map((bundle) => bundle._id)).toEqual([ids.bundle])
    expect(bundles[0]?.price).toBe(0)
    const orders = await reader.query(api.orders.listAttention, {})
    expect(orders.map((order) => order._id)).toEqual([ids.order])
    expect(orders[0]).toMatchObject({ total: 0, linkedTransaction: null })
    expect(
      await reader.query(api.orders.getById, { orderId: ids.hiddenOrder })
    ).toBeNull()
    expect(await reader.query(api.recipes.listLinkedProductIds, {})).toEqual([
      ids.a,
    ])
  })

  it("recalcule les résumés sur les seules opérations visibles", async () => {
    const { admin, reader, userId, access } = await fixture()
    await admin.mutation(api.administration.saveAccountAccess, {
      userId,
      role: "reader",
      access: { ...access, showPrices: true },
    })
    const dashboard = await reader.query(api.dashboard.overview, {})
    expect(dashboard).toMatchObject({
      stockValue: 0,
      lowStock: [],
      lowStockCount: 0,
      weeklyBalance: 8765,
      weeklyTransactionCount: 1,
    })
    expect(dashboard.recentTransactions).toHaveLength(1)
    const account = await reader.query(api.accounts.overview, {})
    expect(account).toMatchObject({
      scoped: true,
      journalBalance: 8765,
      settings: { cashBalance: 0, fundsBalance: 0 },
    })
    expect(account.weeks[0]).toMatchObject({
      incoming: 8765,
      outgoing: 0,
      transactionCount: 1,
    })
  })

  it("retire les rubriques sans fuite dans l’accueil ni par un appel direct à l’API", async () => {
    const { admin, reader, userId, access } = await fixture()
    await admin.mutation(api.administration.saveAccountAccess, {
      userId,
      role: "reader",
      access: { ...access, sections: [] },
    })
    for (const query of [
      api.products.list,
      api.products.selectable,
      api.products.catalog,
      api.products.listArchived,
      api.recipes.list,
      api.recipes.listArchived,
      api.recipes.listBundles,
      api.recipes.listCraftableProductIds,
      api.recipes.listLinkedProductIds,
      api.recipes.listActiveLinkedProductIds,
      api.bundles.listArchived,
      api.orders.listAttention,
      api.contacts.list,
      api.contacts.listForManagement,
      api.characters.list,
      api.accounts.overview,
      api.transactions.list,
    ]) {
      await expect(reader.query(query, {})).rejects.toThrow(
        "ne permet pas de consulter"
      )
    }
    expect(await reader.query(api.dashboard.overview, {})).toMatchObject({
      lowStock: [],
      recentTransactions: [],
      weeklyBalance: 0,
      weeklyTransactionCount: 0,
      orderAttention: { total: 0 },
    })
  })

  it("permet de revenir de la sélection à tous les produits et conserve les lecteurs existants", async () => {
    const { admin, reader, userId, ids } = await fixture()
    await admin.mutation(api.administration.saveAccountAccess, {
      userId,
      role: "reader",
      access: { ...defaultReaderAccess, productIds: undefined },
    })
    expect(
      (await reader.query(api.products.list, {})).map((product) => product._id)
    ).toContain(ids.b)
    const legacy = await asAuthenticatedUser(createTestBackend(), "reader")
    expect(
      (await legacy.query(api.auth.getCurrentUser, {}))?.readerAccess
    ).toEqual(defaultReaderAccess)
  })

  it("réserve la modification des droits aux administrateurs et protège le dernier administrateur", async () => {
    const { admin, reader, userId, access, backend } = await fixture()
    await expect(
      reader.mutation(api.administration.saveAccountAccess, {
        userId,
        role: "admin",
        access,
      })
    ).rejects.toThrow("réservée aux administrateurs")
    const adminUser = await admin.query(api.auth.getCurrentUser, {})
    await expect(
      admin.mutation(api.administration.saveAccountAccess, {
        userId: adminUser!._id,
        role: "reader",
        access,
      })
    ).rejects.toThrow("dernier administrateur actif")
    const employee = await asAuthenticatedUser(backend)
    await expect(
      employee.mutation(api.administration.saveAccountAccess, {
        userId,
        role: "reader",
        access,
      })
    ).rejects.toThrow("réservée aux administrateurs")
  })

  it("crée le compte et ses permissions ensemble, et annule la création si les permissions échouent", async () => {
    const { admin, backend, ids } = await fixture()
    const created = await admin.mutation(
      api.administration.createReaderAccount,
      {
        identifier: "lecteur_precis",
        name: "Lecteur précis",
        password: "Mot-de-passe-local-test",
        access: {
          ...defaultReaderAccess,
          sections: ["inventory"],
          productIds: [ids.a],
          showPrices: false,
        },
      }
    )
    const users = await admin.query(api.administration.listAccounts, {})
    expect(users.find((user) => user.id === created.id)).toMatchObject({
      role: "reader",
      readerAccess: {
        sections: ["inventory"],
        productIds: [ids.a],
        showPrices: false,
      },
    })
    const absentId = await backend.run(async (ctx) => {
      const id = await ctx.db.insert("products", {
        active: true,
        category: "ingredient",
        name: "Supprimé",
        normalizedName: "supprime",
        currentStock: 0,
        minimumStock: 0,
        tracksStock: true,
      })
      await ctx.db.delete(id)
      return id
    })
    await expect(
      admin.mutation(api.administration.createReaderAccount, {
        identifier: "creation_annulee",
        name: "Annulé",
        password: "Mot-de-passe-local-test",
        access: { ...defaultReaderAccess, productIds: [absentId] },
      })
    ).rejects.toThrow("introuvable")
    expect(
      await backend.query(components.betterAuth.adapter.findOne, {
        model: "user",
        where: [{ field: "username", value: "creation_annulee" }],
      })
    ).toBeNull()
  })
})
