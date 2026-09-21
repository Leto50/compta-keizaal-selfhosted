import { describe, expect, it } from "vitest"

import { api } from "./_generated/api"
import { asAuthenticatedUser, createTestBackend } from "./test.helpers"

async function seedOrderProduct(backend: ReturnType<typeof createTestBackend>) {
  return backend.run((ctx) =>
    ctx.db.insert("products", {
      active: true,
      category: "potion",
      currentStock: 10,
      minimumStock: 2,
      name: "Potion de réserve",
      normalizedName: "potion de reserve",
      salePrice: 1 / 4,
      tracksStock: true,
    })
  )
}

describe("orders", () => {
  it("réutilise les contacts normalisés et valide leur type", async () => {
    const backend = createTestBackend()
    const employee = await asAuthenticatedUser(backend)
    const productId = await seedOrderProduct(backend)
    const firstOrderId = await employee.mutation(api.orders.save, {
      contactName: "Élodie",
      dueAt: null,
      kind: "client",
      lines: [{ productId, quantity: 1, unitPrice: 1 }],
      notes: "",
      status: "open",
      total: null,
    })
    const firstOrder = await backend.run((ctx) => ctx.db.get(firstOrderId))
    await employee.mutation(api.orders.save, {
      contactName: "  elodie ",
      dueAt: null,
      kind: "client",
      lines: [{ productId, quantity: 1, unitPrice: 1 }],
      notes: "",
      status: "open",
      total: null,
    })
    await employee.mutation(api.orders.save, {
      contactName: "Élodie",
      dueAt: null,
      kind: "supplier",
      lines: [{ productId, quantity: 1, unitPrice: 1 }],
      notes: "",
      status: "open",
      total: null,
    })

    const contacts = await backend.run((ctx) =>
      ctx.db.query("contacts").collect()
    )
    expect(contacts).toHaveLength(2)
    expect(contacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          active: true,
          kind: "client",
          name: "Élodie",
          normalizedName: "elodie",
        }),
        expect.objectContaining({ kind: "supplier", name: "Élodie" }),
      ])
    )

    await expect(
      employee.mutation(api.orders.save, {
        contactId: firstOrder?.contactId,
        contactName: "Élodie",
        dueAt: null,
        kind: "supplier",
        lines: [{ productId, quantity: 1, unitPrice: 1 }],
        notes: "",
        status: "open",
        total: null,
      })
    ).rejects.toThrowError("type de commande")
  })

  it("crée puis modifie une commande multi-produits sans toucher au stock", async () => {
    const backend = createTestBackend()
    const employee = await asAuthenticatedUser(backend)
    const firstProductId = await seedOrderProduct(backend)
    const secondProductId = await backend.run((ctx) =>
      ctx.db.insert("products", {
        active: true,
        category: "potion",
        currentStock: 5,
        minimumStock: 1,
        name: "Flacon de transport",
        normalizedName: "flacon de transport",
        tracksStock: true,
      })
    )

    const orderId = await employee.mutation(api.orders.save, {
      contactName: "Client de passage",
      dueAt: null,
      kind: "client",
      lines: [
        { productId: firstProductId, quantity: 1, unitPrice: 1 / 4 },
        { productId: secondProductId, quantity: 2, unitPrice: 3 / 4 },
      ],
      notes: "Remise au comptoir.",
      status: "open",
      total: null,
    })
    await employee.mutation(api.orders.save, {
      contactName: "Client de passage",
      dueAt: Date.UTC(2026, 7, 30),
      kind: "client",
      lines: [{ productId: firstProductId, quantity: 4, unitPrice: 1 / 4 }],
      notes: "Prévenir lorsque la commande est prête.",
      orderId,
      status: "ready",
      total: null,
    })

    const details = await employee.query(api.orders.getById, { orderId })

    const state = await backend.run(async (ctx) => ({
      audits: await ctx.db.query("auditLogs").collect(),
      contacts: await ctx.db.query("contacts").collect(),
      lines: await ctx.db
        .query("orderLines")
        .withIndex("by_order", (index) => index.eq("orderId", orderId))
        .collect(),
      order: await ctx.db.get(orderId),
      product: await ctx.db.get(firstProductId),
    }))
    expect(state.order).toMatchObject({ status: "ready", total: 1 })
    expect(details).toMatchObject({
      contactName: "Client de passage",
      linkedTransaction: null,
      status: "ready",
    })
    expect(details?.lines).toHaveLength(1)
    expect(state.lines).toHaveLength(1)
    expect(state.contacts).toHaveLength(1)
    expect(state.product?.currentStock).toBe(10)
    expect(state.audits.map((audit) => audit.action)).toEqual([
      "order.created",
      "order.updated",
    ])
  })

  it("refuse l’état prêt pour une commande fournisseur", async () => {
    const backend = createTestBackend()
    const employee = await asAuthenticatedUser(backend)
    const productId = await seedOrderProduct(backend)

    await expect(
      employee.mutation(api.orders.save, {
        contactName: "Fournisseur test",
        dueAt: null,
        kind: "supplier",
        lines: [{ productId, quantity: 1, unitPrice: 1 }],
        notes: "",
        status: "ready",
        total: null,
      })
    ).rejects.toThrowError("n’existe pas pour une commande fournisseur")

    const orderId = await employee.mutation(api.orders.save, {
      contactName: "Fournisseur test",
      dueAt: null,
      kind: "supplier",
      lines: [{ productId, quantity: 1, unitPrice: 1 }],
      notes: "",
      status: "open",
      total: null,
    })
    await expect(
      employee.mutation(api.orders.updateStatus, {
        orderId,
        status: "ready",
      })
    ).rejects.toThrowError("n’existe pas pour une commande fournisseur")
  })

  it("pagine uniquement les commandes historiques", async () => {
    const backend = createTestBackend()
    const employee = await asAuthenticatedUser(backend)

    await backend.run(async (ctx) => {
      for (let index = 0; index < 25; index += 1) {
        await ctx.db.insert("orders", {
          contactName: `Commande historique ${index}`,
          kind: "client",
          status: "cancelled",
        })
      }
      await ctx.db.insert("orders", {
        contactName: "Commande active",
        kind: "client",
        status: "open",
      })
    })

    const firstPage = await employee.query(api.orders.listHistoryPage, {
      paginationOpts: { cursor: null, numItems: 20 },
    })
    const secondPage = await employee.query(api.orders.listHistoryPage, {
      paginationOpts: { cursor: firstPage.continueCursor, numItems: 20 },
    })
    const attention = await employee.query(api.orders.listAttention, {})

    expect(firstPage.page).toHaveLength(20)
    expect(firstPage.isDone).toBe(false)
    expect(secondPage.page).toHaveLength(5)
    expect(secondPage.isDone).toBe(true)
    expect(attention.map((order) => order.contactName)).toEqual([
      "Commande active",
    ])
  })

  it("permet à un administrateur de supprimer une commande annulée et ses lignes", async () => {
    const backend = createTestBackend()
    const admin = await asAuthenticatedUser(backend, "admin")
    const productId = await seedOrderProduct(backend)
    const orderId = await admin.mutation(api.orders.save, {
      contactName: "Commande à retirer",
      dueAt: null,
      kind: "supplier",
      lines: [{ productId, quantity: 2, unitPrice: null }],
      notes: "",
      status: "cancelled",
      total: null,
    })

    await admin.mutation(api.orders.remove, { orderId })

    const state = await backend.run(async (ctx) => ({
      audits: await ctx.db.query("auditLogs").collect(),
      lines: await ctx.db.query("orderLines").collect(),
      order: await ctx.db.get(orderId),
    }))
    expect(state.order).toBeNull()
    expect(state.lines).toHaveLength(0)
    expect(state.audits.at(-1)?.action).toBe("order.deleted")
  })

  it("permet la suppression d’une commande à un employé", async () => {
    const backend = createTestBackend()
    const employee = await asAuthenticatedUser(backend)
    const orderId = await backend.run((ctx) =>
      ctx.db.insert("orders", {
        contactName: "Commande protégée",
        kind: "client",
        status: "open",
      })
    )

    await employee.mutation(api.orders.remove, { orderId })

    expect(await backend.run((ctx) => ctx.db.get(orderId))).toBeNull()
  })

  it("corrige une commande payée, sa transaction et son stock sans doublon", async () => {
    const backend = createTestBackend()
    const employee = await asAuthenticatedUser(backend)
    const admin = await asAuthenticatedUser(backend, "admin")
    const employeeAccount = await employee.query(api.auth.getCurrentUser, {})
    const adminAccount = await admin.query(api.auth.getCurrentUser, {})
    if (!employeeAccount || !adminAccount) {
      throw new Error("Comptes de test introuvables")
    }
    const productId = await seedOrderProduct(backend)
    const characterId = await backend.run((ctx) =>
      ctx.db.insert("characters", {
        active: true,
        name: "Caissière test",
      })
    )
    const correctedCharacterId = await backend.run((ctx) =>
      ctx.db.insert("characters", {
        active: true,
        name: "Responsable correction",
      })
    )
    const orderId = await employee.mutation(api.orders.save, {
      contactName: "Client du test",
      dueAt: null,
      kind: "client",
      lines: [{ productId, quantity: 8, unitPrice: 1 / 4 }],
      notes: "",
      status: "ready",
      total: 1,
    })
    const occurredAt = Date.now() - 1_000

    const result = await employee.mutation(api.orders.process, {
      characterId,
      occurredAt,
      orderId,
    })
    expect(result.updated).toBe(false)

    const correctedPaymentDate = Date.now()
    const correctedPayment = await admin.mutation(api.orders.process, {
      characterId: correctedCharacterId,
      occurredAt: correctedPaymentDate,
      orderId,
    })
    expect(correctedPayment).toMatchObject({
      transactionId: result.transactionId,
      updated: true,
    })

    const processed = await backend.run(async (ctx) => ({
      order: await ctx.db.get(orderId),
      product: await ctx.db.get(productId),
      movements: await ctx.db
        .query("stockMovements")
        .withIndex("by_transaction", (index) =>
          index.eq("transactionId", result.transactionId)
        )
        .collect(),
      audits: await ctx.db.query("auditLogs").collect(),
      transaction: await ctx.db.get(result.transactionId),
      transactions: await ctx.db.query("transactions").collect(),
    }))
    expect(processed.order).toMatchObject({
      processedAt: correctedPaymentDate,
      transactionId: result.transactionId,
    })
    expect(processed.product?.currentStock).toBe(2)
    expect(processed.transaction).toMatchObject({
      actorCharacterId: correctedCharacterId,
      actorUserId: String(employeeAccount._id),
      orderId,
      occurredAt: correctedPaymentDate,
      productName: "Commande de Client du test",
      total: 1,
    })
    expect(processed.transaction?.discount).toBeUndefined()
    expect(processed.transactions).toHaveLength(1)
    expect(processed.movements).toEqual([
      expect.objectContaining({ occurredAt: correctedPaymentDate }),
    ])
    expect(processed.audits.at(-1)).toMatchObject({
      action: "order.payment_updated",
      actorUserId: String(adminAccount._id),
    })
    expect(processed.audits.at(-1)?.detail).toContain(
      "personne : « Caissière test » → « Responsable correction »"
    )
    expect(processed.audits.at(-1)?.detail).toContain("date :")

    await expect(
      employee.mutation(api.orders.save, {
        contactName: "Correction impossible",
        dueAt: null,
        kind: "client",
        lines: [{ productId, quantity: 11, unitPrice: 1 / 4 }],
        notes: "",
        orderId,
        status: "ready",
        total: 2,
      })
    ).rejects.toThrowError("Stock insuffisant")
    const unchangedAfterFailedCorrection = await backend.run(async (ctx) => ({
      lines: await ctx.db
        .query("orderLines")
        .withIndex("by_order", (index) => index.eq("orderId", orderId))
        .collect(),
      order: await ctx.db.get(orderId),
      product: await ctx.db.get(productId),
      transaction: await ctx.db.get(result.transactionId),
    }))
    expect(unchangedAfterFailedCorrection.order).toMatchObject({
      contactName: "Client du test",
      total: 1,
    })
    expect(unchangedAfterFailedCorrection.lines).toEqual([
      expect.objectContaining({ quantity: 8 }),
    ])
    expect(unchangedAfterFailedCorrection.product?.currentStock).toBe(2)
    expect(unchangedAfterFailedCorrection.transaction).toMatchObject({
      total: 1,
    })

    const savedCorrectionDate = Date.now() - 750
    await employee.mutation(api.orders.save, {
      actorCharacterId: characterId,
      contactName: "Client corrigé",
      dueAt: null,
      kind: "client",
      lines: [{ productId, quantity: 8, unitPrice: 1 / 4 }],
      notes: "Quantité corrigée après paiement.",
      orderId,
      processedAt: savedCorrectionDate,
      status: "ready",
      total: 1,
    })
    const correctedOrderState = await backend.run(async (ctx) => ({
      lines: await ctx.db
        .query("transactionLines")
        .withIndex("by_transaction", (index) =>
          index.eq("transactionId", result.transactionId)
        )
        .collect(),
      order: await ctx.db.get(orderId),
      product: await ctx.db.get(productId),
      movements: await ctx.db
        .query("stockMovements")
        .withIndex("by_transaction", (index) =>
          index.eq("transactionId", result.transactionId)
        )
        .collect(),
      transaction: await ctx.db.get(result.transactionId),
    }))
    expect(correctedOrderState.order).toMatchObject({
      contactName: "Client corrigé",
      processedAt: savedCorrectionDate,
      total: 1,
      transactionId: result.transactionId,
    })
    expect(correctedOrderState.transaction).toMatchObject({
      counterparty: "Client corrigé",
      actorCharacterId: characterId,
      actorName: "Caissière test",
      occurredAt: savedCorrectionDate,
      productName: "Commande de Client corrigé",
      total: 1,
    })
    expect(correctedOrderState.lines).toEqual([
      expect.objectContaining({ quantity: 8, total: 2 }),
    ])
    expect(correctedOrderState.product?.currentStock).toBe(2)
    expect(correctedOrderState.movements).toEqual([
      expect.objectContaining({ occurredAt: savedCorrectionDate }),
    ])

    const correctedDate = Date.now() - 500
    await employee.mutation(api.transactions.updateExchange, {
      agreedTotal: 1,
      characterId: correctedCharacterId,
      counterparty: "Client corrigé depuis le journal",
      lines: [
        {
          direction: "outgoing",
          kind: "product",
          productId,
          quantity: 5,
          unitPrice: 1 / 4,
        },
      ],
      occurredAt: correctedDate,
      transactionId: result.transactionId,
    })
    const correctedJournalState = await backend.run(async (ctx) => ({
      contacts: await ctx.db.query("contacts").collect(),
      lines: await ctx.db
        .query("orderLines")
        .withIndex("by_order", (index) => index.eq("orderId", orderId))
        .collect(),
      order: await ctx.db.get(orderId),
      product: await ctx.db.get(productId),
    }))
    expect(correctedJournalState.order).toMatchObject({
      contactName: "Client corrigé depuis le journal",
      processedAt: correctedDate,
      total: 1,
    })
    expect(
      correctedJournalState.contacts.find(
        (contact) => contact._id === correctedJournalState.order?.contactId
      )
    ).toMatchObject({
      kind: "client",
      name: "Client corrigé depuis le journal",
      normalizedName: "client corrige depuis le journal",
    })
    expect(correctedJournalState.lines).toEqual([
      expect.objectContaining({ quantity: 5, total: 5 / 4 }),
    ])
    expect(correctedJournalState.product?.currentStock).toBe(5)

    await employee.mutation(api.transactions.remove, {
      transactionId: result.transactionId,
    })
    const reverted = await backend.run(async (ctx) => ({
      order: await ctx.db.get(orderId),
      product: await ctx.db.get(productId),
    }))
    expect(reverted.product?.currentStock).toBe(10)
    expect(reverted.order?.transactionId).toBeUndefined()
    expect(reverted.order?.processedAt).toBeUndefined()
  })

  it("refuse de traiter une commande annulée", async () => {
    const backend = createTestBackend()
    const employee = await asAuthenticatedUser(backend)
    const productId = await seedOrderProduct(backend)
    const characterId = await backend.run((ctx) =>
      ctx.db.insert("characters", {
        active: true,
        name: "Caissière test",
      })
    )
    const orderId = await employee.mutation(api.orders.save, {
      contactName: "Commande annulée",
      dueAt: null,
      kind: "client",
      lines: [{ productId, quantity: 4, unitPrice: 1 / 4 }],
      notes: "",
      status: "cancelled",
      total: null,
    })

    await expect(
      employee.mutation(api.orders.process, {
        characterId,
        occurredAt: Date.now(),
        orderId,
      })
    ).rejects.toThrowError("annulée ne peut pas être traitée")
  })

  it("refuse un total convenu fractionnaire", async () => {
    const backend = createTestBackend()
    const employee = await asAuthenticatedUser(backend)
    const productId = await seedOrderProduct(backend)

    await expect(
      employee.mutation(api.orders.save, {
        contactName: "Client du total fractionnaire",
        dueAt: null,
        kind: "client",
        lines: [{ productId, quantity: 4, unitPrice: 1 / 4 }],
        notes: "",
        status: "open",
        total: 1.5,
      })
    ).rejects.toThrowError("nombre entier")

    const orders = await backend.run((ctx) => ctx.db.query("orders").collect())
    expect(orders).toHaveLength(0)
  })
})
