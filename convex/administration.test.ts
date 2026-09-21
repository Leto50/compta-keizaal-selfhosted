import { describe, expect, it } from "vitest"

import { api } from "./_generated/api"
import { asAuthenticatedUser, createTestBackend } from "./test.helpers"

describe("administration", () => {
  it("réserve les comptes et l’audit aux administrateurs", async () => {
    const backend = createTestBackend()
    const employee = await asAuthenticatedUser(backend)

    await expect(
      employee.query(api.administration.listAccounts, {})
    ).rejects.toThrowError("réservée aux administrateurs")
    await expect(
      employee.query(api.administration.listAuditPage, {
        paginationOpts: { cursor: null, numItems: 30 },
      })
    ).rejects.toThrowError("réservée aux administrateurs")
  })

  it("liste le rôle, l’état et les dates des comptes", async () => {
    const backend = createTestBackend()
    const admin = await asAuthenticatedUser(backend, "admin")

    const accounts = await admin.query(api.administration.listAccounts, {})

    expect(accounts).toHaveLength(1)
    expect(accounts[0]).toMatchObject({
      banned: false,
      identifier: "admin",
      name: "Administratrice test",
      role: "admin",
    })
    expect(accounts[0]?.createdAt).toEqual(expect.any(Number))
    expect(accounts[0]?.updatedAt).toEqual(expect.any(Number))
  })

  it("pagine l’audit du plus récent au plus ancien et résout son auteur", async () => {
    const backend = createTestBackend()
    const admin = await asAuthenticatedUser(backend, "admin")
    const currentUser = await admin.query(api.auth.getCurrentUser, {})
    if (!currentUser) throw new Error("Compte de test introuvable")

    await backend.run(async (ctx) => {
      await ctx.db.insert("auditLogs", {
        action: "product.created",
        actorUserId: String(currentUser._id),
        createdAt: 100,
        detail: "Ancien article",
        entityId: "product-old",
        entityType: "product",
      })
      await ctx.db.insert("auditLogs", {
        action: "product.updated",
        actorUserId: String(currentUser._id),
        createdAt: 200,
        detail: "Article récent",
        entityId: "product-new",
        entityType: "product",
      })
    })

    const firstPage = await admin.query(api.administration.listAuditPage, {
      paginationOpts: { cursor: null, numItems: 1 },
    })
    const secondPage = await admin.query(api.administration.listAuditPage, {
      paginationOpts: { cursor: firstPage.continueCursor, numItems: 1 },
    })

    expect(firstPage.page[0]).toMatchObject({
      action: "product.updated",
      actor: {
        identifier: "admin",
        name: "Administratrice test",
      },
      createdAt: 200,
    })
    expect(secondPage.page[0]).toMatchObject({
      action: "product.created",
      createdAt: 100,
    })
  })
})
