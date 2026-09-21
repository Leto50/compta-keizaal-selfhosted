import { describe, expect, it } from "vitest"

import { api } from "./_generated/api"
import { asAuthenticatedUser, createTestBackend } from "./test.helpers"

describe("contacts", () => {
  it("protège les listes des contacts derrière l’authentification", async () => {
    const backend = createTestBackend()

    await expect(backend.query(api.contacts.list)).rejects.toThrowError(
      "connecté"
    )
    await expect(
      backend.query(api.contacts.listForManagement)
    ).rejects.toThrowError("connecté")
  })

  it("permet à un employé de renommer et archiver sans réécrire les commandes", async () => {
    const backend = createTestBackend()
    const employee = await asAuthenticatedUser(backend)
    const { contactId, orderId } = await backend.run(async (ctx) => {
      const contactId = await ctx.db.insert("contacts", {
        active: true,
        kind: "client",
        name: "Maison d’Ambre",
        normalizedName: "maison d ambre",
      })
      const orderId = await ctx.db.insert("orders", {
        contactId,
        contactName: "Maison d’Ambre",
        kind: "client",
        status: "open",
      })
      return { contactId, orderId }
    })

    await employee.mutation(api.contacts.rename, {
      contactId,
      name: "Maison de Verre",
    })
    await employee.mutation(api.contacts.setActive, {
      active: false,
      contactId,
    })

    expect(await employee.query(api.contacts.list)).toEqual([])
    const state = await backend.run(async (ctx) => ({
      audits: await ctx.db.query("auditLogs").collect(),
      contact: await ctx.db.get(contactId),
      order: await ctx.db.get(orderId),
    }))
    expect(state.contact).toMatchObject({
      active: false,
      name: "Maison de Verre",
      normalizedName: "maison de verre",
    })
    expect(state.order?.contactName).toBe("Maison d’Ambre")
    expect(state.audits.map((audit) => audit.action)).toEqual([
      "contact.renamed",
      "contact.archived",
    ])
  })

  it("refuse les doublons normalisés pour un même type mais autorise l’autre type", async () => {
    const backend = createTestBackend()
    const admin = await asAuthenticatedUser(backend, "admin")
    const { anotherClientId, supplierId } = await backend.run(async (ctx) => {
      await ctx.db.insert("contacts", {
        active: true,
        kind: "client",
        name: "Élodie",
        normalizedName: "elodie",
      })
      const anotherClientId = await ctx.db.insert("contacts", {
        active: true,
        kind: "client",
        name: "Autre client",
        normalizedName: "autre client",
      })
      const supplierId = await ctx.db.insert("contacts", {
        active: true,
        kind: "supplier",
        name: "Autre fournisseur",
        normalizedName: "autre fournisseur",
      })
      return { anotherClientId, supplierId }
    })

    await expect(
      admin.mutation(api.contacts.rename, {
        contactId: anotherClientId,
        name: "  elodie  ",
      })
    ).rejects.toThrowError("existe déjà")
    await admin.mutation(api.contacts.rename, {
      contactId: supplierId,
      name: "elodie",
    })

    const supplier = await backend.run((ctx) => ctx.db.get(supplierId))
    expect(supplier?.name).toBe("elodie")
  })
})
