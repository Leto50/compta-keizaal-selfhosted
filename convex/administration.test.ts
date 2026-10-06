import { describe, expect, it } from "vitest"

import { api } from "./_generated/api"
import { asAuthenticatedUser, createTestBackend } from "./test.helpers"
import { DEFAULT_SITE_NAME, SITE_NAME_MAX_LENGTH } from "../shared/site-name"

describe("nom du site", () => {
  it("fournit le nom par défaut sans session, sans exposer les autres réglages", async () => {
    const backend = createTestBackend()
    await backend.run(async (ctx) => {
      await ctx.db.insert("systemSettings", {
        key: "internal-setting",
        updatedAt: Date.now(),
        value: "Valeur interne",
      })
    })
    expect(await backend.query(api.administration.getSiteName, {})).toBe(
      DEFAULT_SITE_NAME
    )
  })

  it("enregistre et partage le nom, journalise les changements et ignore les doublons", async () => {
    const backend = createTestBackend()
    const admin = await asAuthenticatedUser(backend, "admin")
    const user = await admin.query(api.auth.getCurrentUser, {})
    await admin.mutation(api.administration.saveSiteName, {
      name: "  La Fiole du Voyageur  ",
    })
    expect(await backend.query(api.administration.getSiteName, {})).toBe(
      "La Fiole du Voyageur"
    )
    await admin.mutation(api.administration.saveSiteName, {
      name: "L’Échoppe du Voyageur",
    })
    await admin.mutation(api.administration.saveSiteName, {
      name: " L’Échoppe du Voyageur ",
    })
    const { settings, audit } = await backend.run(async (ctx) => ({
      settings: await ctx.db.query("systemSettings").collect(),
      audit: await ctx.db.query("auditLogs").collect(),
    }))
    expect(settings).toHaveLength(1)
    expect(settings[0]).toMatchObject({ value: "L’Échoppe du Voyageur" })
    expect(audit).toHaveLength(2)
    expect(audit[0]).toMatchObject({
      action: "site.name_updated",
      actorUserId: String(user?._id),
      detail: `${DEFAULT_SITE_NAME} → La Fiole du Voyageur`,
      entityId: settings[0]?._id,
      entityType: "site_settings",
    })
    expect(audit[1]).toMatchObject({
      detail: "La Fiole du Voyageur → L’Échoppe du Voyageur",
    })
  })

  it("conserve un nom indépendant pour chaque instance", async () => {
    const firstInstance = createTestBackend()
    const secondInstance = createTestBackend()
    const admin = await asAuthenticatedUser(firstInstance, "admin")
    await admin.mutation(api.administration.saveSiteName, {
      name: "La Fiole du Voyageur",
    })
    expect(await firstInstance.query(api.administration.getSiteName, {})).toBe(
      "La Fiole du Voyageur"
    )
    expect(await secondInstance.query(api.administration.getSiteName, {})).toBe(
      DEFAULT_SITE_NAME
    )
  })

  it("refuse une modification sans session", async () => {
    const backend = createTestBackend()
    await expect(
      backend.mutation(api.administration.saveSiteName, {
        name: "Nom non autorisé",
      })
    ).rejects.toThrowError("Vous devez être connecté")
    expect(await backend.query(api.administration.getSiteName, {})).toBe(
      DEFAULT_SITE_NAME
    )
  })

  it.each(["user", "reader"] as const)(
    "refuse une modification directe par le rôle %s",
    async (role) => {
      const backend = createTestBackend()
      const employee = await asAuthenticatedUser(backend, role)
      await expect(
        employee.mutation(api.administration.saveSiteName, {
          name: "Nom non autorisé",
        })
      ).rejects.toThrowError("réservée aux administrateurs")
      expect(await employee.query(api.administration.getSiteName, {})).toBe(
        DEFAULT_SITE_NAME
      )
      expect(
        await backend.run(async (ctx) => ctx.db.query("auditLogs").collect())
      ).toEqual([])
    }
  )

  it.each([
    "",
    "   ",
    "x".repeat(SITE_NAME_MAX_LENGTH + 1),
    "x".repeat(40),
    "x".repeat(100),
  ])(
    "rejette un nom vide ou trop long (%j) sans modifier les données",
    async (name) => {
      const backend = createTestBackend()
      const admin = await asAuthenticatedUser(backend, "admin")
      await admin.mutation(api.administration.saveSiteName, {
        name: "Nom existant",
      })
      const snapshot = () =>
        backend.run(async (ctx) => ({
          settings: await ctx.db.query("systemSettings").collect(),
          audit: await ctx.db.query("auditLogs").collect(),
        }))
      const before = await snapshot()
      await expect(
        admin.mutation(api.administration.saveSiteName, { name })
      ).rejects.toThrowError("Le nom du site doit contenir")
      expect(await snapshot()).toEqual(before)
    }
  )

  it("accepte un nom de 24 caractères", async () => {
    const backend = createTestBackend()
    const admin = await asAuthenticatedUser(backend, "admin")
    const name = "La fiole du grand voyage"
    await admin.mutation(api.administration.saveSiteName, { name })
    expect(await backend.query(api.administration.getSiteName, {})).toBe(name)
  })
})

describe("administration", () => {
  it.each(["user", "reader"] as const)(
    "réserve les comptes et l’audit aux administrateurs pour le rôle %s",
    async (role) => {
      const backend = createTestBackend()
      const employee = await asAuthenticatedUser(backend, role)

      await expect(
        employee.query(api.administration.listAccounts, {})
      ).rejects.toThrowError("réservée aux administrateurs")
      await expect(
        employee.query(api.administration.listAuditPage, {
          paginationOpts: { cursor: null, numItems: 30 },
        })
      ).rejects.toThrowError("réservée aux administrateurs")
    }
  )

  it("liste le rôle, l’état et les dates des comptes", async () => {
    const backend = createTestBackend()
    const admin = await asAuthenticatedUser(backend, "admin")
    await asAuthenticatedUser(backend, "reader")

    const accounts = await admin.query(api.administration.listAccounts, {})

    expect(accounts).toHaveLength(2)
    expect(accounts[0]).toMatchObject({
      banned: false,
      identifier: "admin",
      name: "Administratrice test",
      role: "admin",
    })
    expect(accounts[0]?.createdAt).toEqual(expect.any(Number))
    expect(accounts[0]?.updatedAt).toEqual(expect.any(Number))
    expect(accounts[1]).toMatchObject({ identifier: "reader", role: "reader" })
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
