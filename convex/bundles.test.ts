import { describe, expect, it } from "vitest"

import { api } from "./_generated/api"
import { asAuthenticatedUser, createTestBackend } from "./test.helpers"

describe("bundles.save", () => {
  it("crée puis modifie un lot et ses composants", async () => {
    const backend = createTestBackend()
    const admin = await asAuthenticatedUser(backend, "admin")
    const { firstProductId, secondProductId } = await backend.run(
      async (ctx) => {
        const firstProductId = await ctx.db.insert("products", {
          active: true,
          category: "potion",
          currentStock: 20,
          minimumStock: 2,
          name: "Potion de souffle",
          normalizedName: "potion de souffle",
          tracksStock: true,
        })
        const secondProductId = await ctx.db.insert("products", {
          active: true,
          category: "potion",
          currentStock: 20,
          minimumStock: 2,
          name: "Étui de voyage",
          normalizedName: "etui de voyage",
          tracksStock: true,
        })
        return { firstProductId, secondProductId }
      }
    )

    const bundleId = await admin.mutation(api.bundles.save, {
      items: [{ productId: firstProductId, quantity: 2 }],
      name: "  NÉCESSAIRE D’EXPLORATION  ",
      price: 28,
    })
    await admin.mutation(api.bundles.save, {
      bundleId,
      items: [
        { productId: firstProductId, quantity: 3 },
        { productId: secondProductId, quantity: 1 },
      ],
      name: "NÉCESSAIRE D’EXPLORATION",
      price: 39,
    })
    await admin.mutation(api.bundles.setActive, {
      active: false,
      bundleId,
    })
    await admin.mutation(api.bundles.setActive, {
      active: true,
      bundleId,
    })

    const state = await backend.run(async (ctx) => ({
      audits: await ctx.db.query("auditLogs").collect(),
      bundle: await ctx.db.get(bundleId),
      items: await ctx.db
        .query("bundleItems")
        .withIndex("by_bundle", (index) => index.eq("bundleId", bundleId))
        .collect(),
    }))
    expect(state.bundle).toMatchObject({
      active: true,
      name: "Nécessaire d’exploration",
      price: 39,
    })
    expect(state.items).toHaveLength(2)
    expect(state.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          productName: "Potion de souffle",
          quantity: 3,
        }),
        expect.objectContaining({
          productName: "Étui de voyage",
          quantity: 1,
        }),
      ])
    )
    expect(state.audits.map((audit) => audit.action)).toEqual([
      "bundle.created",
      "bundle.updated",
      "bundle.archived",
      "bundle.reactivated",
    ])
  })

  it("refuse les doublons et conserve le lot existant", async () => {
    const backend = createTestBackend()
    const admin = await asAuthenticatedUser(backend, "admin")
    const productId = await backend.run((ctx) =>
      ctx.db.insert("products", {
        active: true,
        category: "ingredient",
        currentStock: 20,
        minimumStock: 2,
        name: "Résine de pin",
        normalizedName: "resine de pin",
        tracksStock: true,
      })
    )

    await expect(
      admin.mutation(api.bundles.save, {
        items: [
          { productId, quantity: 1 },
          { productId, quantity: 2 },
        ],
        name: "Lot du forestier",
        price: 8,
      })
    ).rejects.toThrowError("qu’une fois")

    const bundles = await backend.run((ctx) =>
      ctx.db.query("bundles").collect()
    )
    expect(bundles).toHaveLength(0)
  })

  it("refuse une quantité fractionnaire dans un lot", async () => {
    const backend = createTestBackend()
    const admin = await asAuthenticatedUser(backend, "admin")
    const productId = await backend.run((ctx) =>
      ctx.db.insert("products", {
        active: true,
        category: "potion",
        currentStock: 20,
        minimumStock: 2,
        name: "Potion de guérison",
        normalizedName: "potion de guerison",
        tracksStock: true,
      })
    )

    await expect(
      admin.mutation(api.bundles.save, {
        items: [{ productId, quantity: 1.5 }],
        name: "Lot de soins",
        price: 1 / 4,
      })
    ).rejects.toThrowError("nombre entier")

    const bundles = await backend.run((ctx) =>
      ctx.db.query("bundles").collect()
    )
    expect(bundles).toHaveLength(0)
  })

  it("permet la création d’un lot à un employé", async () => {
    const backend = createTestBackend()
    const employee = await asAuthenticatedUser(backend)
    const productId = await backend.run((ctx) =>
      ctx.db.insert("products", {
        active: true,
        category: "ingredient",
        currentStock: 20,
        minimumStock: 2,
        name: "Sel des mines",
        normalizedName: "sel des mines",
        tracksStock: true,
      })
    )

    const bundleId = await employee.mutation(api.bundles.save, {
      items: [{ productId, quantity: 1 }],
      name: "Lot du mineur",
      price: 5,
    })

    expect(await backend.run((ctx) => ctx.db.get(bundleId))).toMatchObject({
      name: "Lot du mineur",
    })
  })
})
