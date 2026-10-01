import { describe, expect, it } from "vitest"

import { api, components } from "./_generated/api"
import { asAuthenticatedUser, createTestBackend } from "./test.helpers"

async function createFixture(backend: ReturnType<typeof createTestBackend>) {
  return backend.run(async (ctx) => {
    const productId = await ctx.db.insert("products", {
      active: true,
      category: "ingredient",
      currentStock: 10,
      minimumStock: 0,
      name: "Ingrédient protégé",
      normalizedName: "ingredient protege",
      purchasePrice: 2,
      salePrice: 3,
      tracksStock: true,
    })
    const characterId = await ctx.db.insert("characters", {
      active: true,
      name: "Personnage protégé",
    })
    const contactId = await ctx.db.insert("contacts", {
      active: true,
      kind: "client",
      name: "Contact protégé",
      normalizedName: "contact protege",
    })
    const orderId = await ctx.db.insert("orders", {
      contactId,
      contactName: "Contact protégé",
      kind: "client",
      status: "open",
    })
    const transactionId = await ctx.db.insert("transactions", {
      actorCharacterId: characterId,
      actorName: "Personnage protégé",
      kind: "sale",
      occurredAt: Date.now(),
      productId,
      productName: "Ingrédient protégé",
      quantity: 1,
      source: "web",
      total: 3,
    })
    const recipeId = await ctx.db.insert("recipes", {
      active: true,
      family: "Utilitaire",
      name: "Recette protégée",
    })
    const bundleId = await ctx.db.insert("bundles", {
      active: true,
      name: "Lot protégé",
      price: 6,
    })
    return {
      bundleId,
      characterId,
      contactId,
      orderId,
      productId,
      recipeId,
      transactionId,
    }
  })
}

async function businessState(backend: ReturnType<typeof createTestBackend>) {
  const tables = [
    "accountSettings",
    "accountWeekSummaries",
    "auditLogs",
    "bundleItems",
    "bundles",
    "characters",
    "contacts",
    "inventorySummaries",
    "journalSummaries",
    "orderLines",
    "orders",
    "products",
    "recipeIngredients",
    "recipes",
    "stockMovements",
    "systemSettings",
    "transactionLines",
    "transactions",
  ] as const
  return backend.run(async (ctx) =>
    Promise.all(tables.map((table) => ctx.db.query(table).collect()))
  )
}

describe("accès lecteur", () => {
  it("consulte toutes les pages métier et les détails sans permission de gestion", async () => {
    const backend = createTestBackend()
    const ids = await createFixture(backend)
    const reader = await asAuthenticatedUser(backend, "reader")

    expect(await reader.query(api.auth.getCurrentUser, {})).toMatchObject({
      role: "reader",
    })
    expect(await reader.query(api.products.list, {})).toHaveLength(1)
    expect(await reader.query(api.products.selectable, {})).toHaveLength(1)
    expect(await reader.query(api.recipes.list, {})).toHaveLength(1)
    expect(await reader.query(api.recipes.listBundles, {})).toHaveLength(1)
    expect(await reader.query(api.contacts.list, {})).toHaveLength(1)
    expect(await reader.query(api.characters.list, {})).toHaveLength(1)
    expect(await reader.query(api.orders.listAttention, {})).toHaveLength(1)
    expect(
      await reader.query(api.orders.getById, { orderId: ids.orderId })
    ).toMatchObject({ _id: ids.orderId })
    expect(
      await reader.query(api.orders.listHistoryPage, {
        paginationOpts: { cursor: null, numItems: 30 },
      })
    ).toMatchObject({ page: [] })
    expect(await reader.query(api.dashboard.overview, {})).toBeDefined()
    expect(await reader.query(api.accounts.overview, {})).toBeDefined()
    const page = await reader.query(api.transactions.listPage, {
      paginationOpts: { cursor: null, numItems: 30 },
    })
    const details = await reader.query(api.transactions.getDetails, {
      transactionId: ids.transactionId,
    })
    const list = await reader.query(api.transactions.list, {})
    for (const transaction of [page.page[0], details, list[0]]) {
      expect(transaction).toMatchObject({
        _id: ids.transactionId,
        canDelete: false,
        canManage: false,
      })
    }
  })

  it("refuse tous les appels directs d’écriture sans modifier les données ni l’audit", async () => {
    const backend = createTestBackend()
    const ids = await createFixture(backend)
    const reader = await asAuthenticatedUser(backend, "reader")
    const before = await businessState(backend)
    const occurredAt = Date.now()
    const product = {
      active: true,
      category: "ingredient" as const,
      minimumStock: 0,
      name: "Ingrédient modifié",
      purchasePrice: 2,
      salePrice: 3,
      targetStock: 5,
    }
    const recipe = {
      effect: "",
      family: "Utilitaire" as const,
      ingredients: [{ productId: ids.productId, quantity: 1 }],
      name: "Recette modifiée",
    }
    const bundle = {
      items: [{ productId: ids.productId, quantity: 1 }],
      name: "Lot modifié",
      price: 3,
    }
    const order = {
      contactName: "Commande modifiée",
      dueAt: null,
      kind: "client" as const,
      lines: [{ productId: ids.productId, quantity: 1, unitPrice: 3 }],
      notes: "",
      status: "open" as const,
      total: 3,
    }
    const exchange = {
      characterId: ids.characterId,
      lines: [
        {
          direction: "outgoing" as const,
          kind: "product" as const,
          productId: ids.productId,
          quantity: 1,
        },
      ],
      occurredAt,
    }
    const trade = {
      characterId: ids.characterId,
      kind: "sale" as const,
      lines: [
        { kind: "product" as const, productId: ids.productId, quantity: 1 },
      ],
      occurredAt,
    }
    const attempts = [
      () => reader.mutation(api.products.save, product),
      () =>
        reader.mutation(api.products.save, {
          ...product,
          productId: ids.productId,
        }),
      () =>
        reader.mutation(api.products.setActive, {
          active: false,
          productId: ids.productId,
        }),
      () => reader.mutation(api.recipes.save, recipe),
      () =>
        reader.mutation(api.recipes.save, {
          ...recipe,
          recipeId: ids.recipeId,
        }),
      () =>
        reader.mutation(api.recipes.setActive, {
          active: false,
          recipeId: ids.recipeId,
        }),
      () => reader.mutation(api.bundles.save, bundle),
      () =>
        reader.mutation(api.bundles.save, {
          ...bundle,
          bundleId: ids.bundleId,
        }),
      () =>
        reader.mutation(api.bundles.setActive, {
          active: false,
          bundleId: ids.bundleId,
        }),
      () =>
        reader.mutation(api.contacts.rename, {
          contactId: ids.contactId,
          name: "Contact modifié",
        }),
      () =>
        reader.mutation(api.contacts.setActive, {
          active: false,
          contactId: ids.contactId,
        }),
      () => reader.mutation(api.orders.save, order),
      () =>
        reader.mutation(api.orders.save, { ...order, orderId: ids.orderId }),
      () =>
        reader.mutation(api.orders.updateStatus, {
          orderId: ids.orderId,
          status: "ready",
        }),
      () =>
        reader.mutation(api.orders.process, {
          characterId: ids.characterId,
          occurredAt,
          orderId: ids.orderId,
        }),
      () => reader.mutation(api.orders.remove, { orderId: ids.orderId }),
      () => reader.mutation(api.transactions.recordExchange, exchange),
      () => reader.mutation(api.transactions.recordTrade, trade),
      () =>
        reader.mutation(api.transactions.record, {
          characterId: ids.characterId,
          kind: "production",
          occurredAt,
          productId: ids.productId,
          quantity: 1,
        }),
      () =>
        reader.mutation(api.transactions.updateExchange, {
          ...exchange,
          transactionId: ids.transactionId,
        }),
      () =>
        reader.mutation(api.transactions.update, {
          ...trade,
          transactionId: ids.transactionId,
        }),
      () =>
        reader.mutation(api.transactions.remove, {
          transactionId: ids.transactionId,
        }),
    ]
    for (const attempt of attempts) {
      await expect(attempt()).rejects.toThrowError("lecture seule")
    }
    expect(await businessState(backend)).toEqual(before)
  })

  it("refuse les fonctions d’administration", async () => {
    const backend = createTestBackend()
    const ids = await createFixture(backend)
    const reader = await asAuthenticatedUser(backend, "reader")
    const attempts = [
      () => reader.query(api.administration.listAccounts, {}),
      () =>
        reader.query(api.administration.listAuditPage, {
          paginationOpts: { cursor: null, numItems: 30 },
        }),
      () => reader.query(api.characters.listForAdmin, {}),
      () => reader.query(api.characters.listArchived, {}),
      () =>
        reader.mutation(api.characters.save, {
          characterId: ids.characterId,
          name: "Personnage modifié",
        }),
      () =>
        reader.mutation(api.characters.setActive, {
          active: false,
          characterId: ids.characterId,
        }),
      () =>
        reader.mutation(api.accounts.saveSettings, {
          cashBalance: 0,
          censusPerEmployee: 0,
          employeeCount: 0,
          fundsBalance: 0,
          salaryRate: 0,
          taxRate: 0,
          weeklyRent: 0,
        }),
    ]
    for (const attempt of attempts) {
      await expect(attempt()).rejects.toThrowError(
        "réservée aux administrateurs"
      )
    }
  })

  it("applique immédiatement la rétrogradation sur une session déjà ouverte", async () => {
    const backend = createTestBackend()
    const employee = await asAuthenticatedUser(backend)
    const user = await employee.query(api.auth.getCurrentUser, {})
    if (!user) throw new Error("Compte de test introuvable")
    const product = {
      active: true,
      category: "ingredient" as const,
      minimumStock: 0,
      name: "Avant rétrogradation",
      purchasePrice: null,
      salePrice: null,
      targetStock: 0,
    }
    await employee.mutation(api.products.save, product)
    await backend.mutation(components.betterAuth.adapter.updateOne, {
      input: {
        model: "user",
        update: { role: "reader" },
        where: [{ field: "_id", value: user._id }],
      },
    })
    expect(await employee.query(api.auth.getCurrentUser, {})).toMatchObject({
      role: "reader",
    })
    await expect(
      employee.mutation(api.products.save, {
        ...product,
        name: "Après rétrogradation",
      })
    ).rejects.toThrowError("lecture seule")
    expect(await employee.query(api.products.list, {})).toHaveLength(1)
  })

  it.each(["user", "admin"] as const)(
    "conserve les droits d’écriture du rôle %s",
    async (role) => {
      const backend = createTestBackend()
      const user = await asAuthenticatedUser(backend, role)
      const productId = await user.mutation(api.products.save, {
        active: true,
        category: "ingredient",
        minimumStock: 0,
        name: "Nouvel ingrédient",
        purchasePrice: null,
        salePrice: null,
        targetStock: 0,
      })
      expect(await user.query(api.products.list, {})).toMatchObject([
        { _id: productId },
      ])
      await user.mutation(api.products.setActive, { active: false, productId })
      expect(await user.query(api.products.list, {})).toEqual([])
    }
  )
})
