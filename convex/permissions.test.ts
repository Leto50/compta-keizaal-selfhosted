import { describe, expect, it } from "vitest"

import { api } from "./_generated/api"
import { createTestBackend } from "./test.helpers"

describe("permissions métier", () => {
  it("refuse toute écriture métier sans session", async () => {
    const backend = createTestBackend()
    const ids = await backend.run(async (ctx) => {
      const productId = await ctx.db.insert("products", {
        active: true,
        category: "ingredient",
        currentStock: 10,
        minimumStock: 0,
        name: "Produit protégé",
        normalizedName: "produit protege",
        tracksStock: true,
      })
      const contactId = await ctx.db.insert("contacts", {
        active: true,
        kind: "client",
        name: "Contact protégé",
        normalizedName: "contact protege",
      })
      const orderId = await ctx.db.insert("orders", {
        contactName: "Commande protégée",
        kind: "client",
        status: "open",
      })
      const transactionId = await ctx.db.insert("transactions", {
        actorName: "Employé",
        kind: "service",
        occurredAt: Date.now(),
        productName: "Service protégé",
        quantity: 1,
        source: "web",
        total: 1,
      })
      return { contactId, orderId, productId, transactionId }
    })

    const attempts = [
      () =>
        backend.mutation(api.products.save, {
          active: true,
          category: "ingredient",
          minimumStock: 0,
          name: "Nouveau produit",
          purchasePrice: null,
          salePrice: null,
          targetStock: 0,
        }),
      () =>
        backend.mutation(api.recipes.save, {
          effect: "",
          family: "Utilitaire",
          ingredients: [{ productId: ids.productId, quantity: 1 }],
          name: "Nouvelle recette",
        }),
      () =>
        backend.mutation(api.bundles.save, {
          items: [{ productId: ids.productId, quantity: 1 }],
          name: "Nouveau lot",
          price: null,
        }),
      () =>
        backend.mutation(api.characters.save, {
          name: "Nouveau personnage",
        }),
      () =>
        backend.mutation(api.contacts.rename, {
          contactId: ids.contactId,
          name: "Contact renommé",
        }),
      () => backend.mutation(api.orders.remove, { orderId: ids.orderId }),
      () =>
        backend.mutation(api.transactions.remove, {
          transactionId: ids.transactionId,
        }),
    ]

    for (const attempt of attempts) {
      await expect(attempt()).rejects.toThrowError("connecté")
    }
  })
})
