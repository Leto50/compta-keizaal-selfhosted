import { describe, expect, it } from "vitest"

import { api, internal } from "./_generated/api"
import { asAuthenticatedUser, createTestBackend } from "./test.helpers"

async function fixture() {
  const backend = createTestBackend()
  const member = await asAuthenticatedUser(backend)
  const ingredientId = await backend.run((ctx) =>
    ctx.db.insert("products", {
      active: true,
      category: "ingredient",
      currentStock: 20,
      minimumStock: 0,
      name: "Blé",
      normalizedName: "ble",
      tracksStock: true,
    })
  )
  const recipe = {
    effect: "",
    ingredients: [{ productId: ingredientId, quantity: 1 }],
    name: "Potion de force",
  }
  return { backend, member, recipe, ingredientId }
}

async function registryState(backend: ReturnType<typeof createTestBackend>) {
  return backend.run(async (ctx) => ({
    categories: await ctx.db.query("recipeCategories").collect(),
    recipes: await ctx.db.query("recipes").collect(),
    audits: await ctx.db.query("auditLogs").collect(),
    settings: await ctx.db.query("systemSettings").collect(),
  }))
}

describe("registre persistant de catégories", () => {
  it("crée une catégorie sans recette et refuse les doublons de casse ou d’accents", async () => {
    const { backend, member } = await fixture()
    await member.mutation(api.recipes.createCategory, {
      name: "  RÉGÉNÉRATION DE SANTÉ  ",
    })
    expect(await member.query(api.recipes.listCategories, {})).toContainEqual({
      name: "Régénération de santé",
      recipeCount: 0,
      archivedRecipeCount: 0,
    })
    const before = await registryState(backend)
    await expect(
      member.mutation(api.recipes.createCategory, {
        name: "regeneration de sante",
      })
    ).rejects.toThrowError("existe déjà")
    expect(await registryState(backend)).toEqual(before)
    expect(before.audits.map((audit) => audit.action)).toEqual([
      "recipe_category.created",
    ])
  })

  it("conserve la catégorie quand sa dernière recette en change", async () => {
    const { member, recipe } = await fixture()
    const recipeId = await member.mutation(api.recipes.save, {
      ...recipe,
      family: "Force",
      createFamily: true,
    })
    await member.mutation(api.recipes.save, {
      ...recipe,
      family: "Soin",
      recipeId,
    })
    expect(await member.query(api.recipes.listFamilies, {})).toContain("Force")
    expect(await member.query(api.recipes.listCategories, {})).toContainEqual({
      name: "Force",
      recipeCount: 0,
      archivedRecipeCount: 0,
    })
  })

  it("renomme la catégorie et toutes ses recettes actives et archivées", async () => {
    const { backend, member, recipe } = await fixture()
    const firstId = await member.mutation(api.recipes.save, {
      ...recipe,
      family: "Force",
      createFamily: true,
    })
    const secondId = await member.mutation(api.recipes.save, {
      ...recipe,
      name: "Élixir de force",
      family: "Force",
    })
    await member.mutation(api.recipes.setActive, {
      active: false,
      recipeId: secondId,
    })
    const before = await backend.run((ctx) =>
      ctx.db.query("products").collect()
    )
    await member.mutation(api.recipes.renameCategory, {
      family: "Force",
      name: " FORCE   ACCRUE ",
    })
    const recipes = await backend.run((ctx) =>
      Promise.all([ctx.db.get(firstId), ctx.db.get(secondId)])
    )
    expect(recipes.map((entry) => entry?.family)).toEqual([
      "Force accrue",
      "Force accrue",
    ])
    expect(await member.query(api.recipes.listCategories, {})).toContainEqual({
      name: "Force accrue",
      recipeCount: 2,
      archivedRecipeCount: 1,
    })
    expect(await member.query(api.recipes.listFamilies, {})).not.toContain(
      "Force"
    )
    expect(
      await backend.run((ctx) => ctx.db.query("products").collect())
    ).toEqual(before)
    await expect(
      member.mutation(api.recipes.save, {
        ...recipe,
        family: "Force",
        recipeId: firstId,
      })
    ).rejects.toThrowError("n’existe plus")
  })

  it("bloque la suppression pour une recette active puis archivée, et l’autorise après réaffectation", async () => {
    const { backend, member, recipe } = await fixture()
    const recipeId = await member.mutation(api.recipes.save, {
      ...recipe,
      family: "Force",
      createFamily: true,
    })
    for (const active of [true, false]) {
      await member.mutation(api.recipes.setActive, { active, recipeId })
      const before = await registryState(backend)
      await expect(
        member.mutation(api.recipes.removeCategory, { family: "Force" })
      ).rejects.toThrowError("y compris archivées")
      expect(await registryState(backend)).toEqual(before)
    }
    await member.mutation(api.recipes.save, {
      ...recipe,
      family: "Soin",
      recipeId,
    })
    await member.mutation(api.recipes.removeCategory, { family: "Force" })
    expect(await member.query(api.recipes.listFamilies, {})).not.toContain(
      "Force"
    )
    expect((await registryState(backend)).recipes[0]).toMatchObject({
      active: false,
      family: "Soin",
    })
    expect((await registryState(backend)).audits.at(-1)?.action).toBe(
      "recipe_category.deleted"
    )
  })

  it("ne recrée pas une catégorie prédéfinie supprimée et refuse un choix devenu périmé", async () => {
    const { backend, member, recipe } = await fixture()
    await member.mutation(api.recipes.removeCategory, { family: "Soin" })
    await member.mutation(api.recipes.createCategory, { name: "Force" })
    await backend.mutation(internal.migrations.initializeRecipeCategories, {})
    expect(await member.query(api.recipes.listFamilies, {})).not.toContain(
      "Soin"
    )
    const before = await registryState(backend)
    await expect(
      member.mutation(api.recipes.save, { ...recipe, family: "Soin" })
    ).rejects.toThrowError("n’existe plus")
    expect(await registryState(backend)).toEqual(before)
    await member.mutation(api.recipes.createCategory, { name: "Soin" })
    expect(await member.query(api.recipes.listFamilies, {})).toContain("Soin")
  })

  it("permet un registre vide sans réintroduire les catégories d’origine", async () => {
    const { backend, member } = await fixture()
    for (const family of await member.query(api.recipes.listFamilies, {})) {
      await member.mutation(api.recipes.removeCategory, { family })
    }
    await backend.mutation(internal.migrations.initializeRecipeCategories, {})
    expect(await member.query(api.recipes.listFamilies, {})).toEqual([])
    await member.mutation(api.recipes.createCategory, { name: "Force" })
    expect(await member.query(api.recipes.listFamilies, {})).toEqual(["Force"])
  })

  it("reprend les catégories historiques et personnalisées une seule fois sans modifier les renommages ultérieurs", async () => {
    const { backend, member } = await fixture()
    await backend.run(async (ctx) => {
      await ctx.db.insert("recipes", {
        name: "Ancien soin",
        family: "Soins",
        active: true,
      })
      await ctx.db.insert("recipes", {
        name: "Ancienne régénération",
        family: "RÉGÉNÉRATION",
        active: false,
      })
    })
    expect(await member.query(api.recipes.listCategories, {})).toContainEqual({
      name: "Régénération",
      recipeCount: 1,
      archivedRecipeCount: 1,
    })
    await backend.mutation(internal.migrations.initializeRecipeCategories, {})
    await member.mutation(api.recipes.renameCategory, {
      family: "Soin",
      name: "Soins",
    })
    await backend.mutation(internal.migrations.normalizeRecipeFamilies, {})
    await backend.mutation(internal.migrations.initializeRecipeCategories, {})
    const state = await registryState(backend)
    expect(state.recipes.map((entry) => entry.family)).toEqual([
      "Soins",
      "Régénération",
    ])
    expect(
      state.categories.filter((entry) => entry.name === "Régénération")
    ).toHaveLength(1)
    expect(state.categories.some((entry) => entry.name === "Soin")).toBe(false)
  })

  it("refuse un renommage en doublon sans modifier le registre ni les recettes", async () => {
    const { backend, member, recipe } = await fixture()
    await member.mutation(api.recipes.save, {
      ...recipe,
      family: "Force",
      createFamily: true,
    })
    await member.mutation(api.recipes.createCategory, { name: "Régénération" })
    const before = await registryState(backend)
    await expect(
      member.mutation(api.recipes.renameCategory, {
        family: "Force",
        name: "regeneration",
      })
    ).rejects.toThrowError("existe déjà")
    expect(await registryState(backend)).toEqual(before)
  })

  it.each(["", " ", "---", "all", "x".repeat(101)])(
    "refuse le nom invalide %s sans initialiser de données",
    async (name) => {
      const { backend, member } = await fixture()
      const before = await registryState(backend)
      await expect(
        member.mutation(api.recipes.createCategory, { name })
      ).rejects.toThrowError("catégorie valide")
      await expect(
        member.mutation(api.recipes.renameCategory, { family: "Soin", name })
      ).rejects.toThrowError("catégorie valide")
      expect(await registryState(backend)).toEqual(before)
    }
  )

  it("annule aussi la catégorie créée lorsque l’enregistrement de la recette échoue", async () => {
    const { backend, member, recipe, ingredientId } = await fixture()
    await backend.run((ctx) => ctx.db.patch(ingredientId, { active: false }))
    const before = await registryState(backend)
    await expect(
      member.mutation(api.recipes.save, {
        ...recipe,
        family: "Force",
        createFamily: true,
      })
    ).rejects.toThrowError("ingrédient")
    expect(await registryState(backend)).toEqual(before)
  })

  it("autorise la consultation aux lecteurs et protège toutes les mutations", async () => {
    const { backend, member } = await fixture()
    await member.mutation(api.recipes.createCategory, { name: "Force" })
    const reader = await asAuthenticatedUser(backend, "reader")
    expect(await reader.query(api.recipes.listCategories, {})).toContainEqual({
      name: "Force",
      recipeCount: 0,
      archivedRecipeCount: 0,
    })
    await expect(
      backend.query(api.recipes.listCategories, {})
    ).rejects.toThrowError()
    const before = await registryState(backend)
    for (const client of [backend, reader]) {
      await expect(
        client.mutation(api.recipes.createCategory, { name: "Nouvelle" })
      ).rejects.toThrowError()
      await expect(
        client.mutation(api.recipes.renameCategory, {
          family: "Force",
          name: "Renommée",
        })
      ).rejects.toThrowError()
      await expect(
        client.mutation(api.recipes.removeCategory, { family: "Force" })
      ).rejects.toThrowError()
    }
    expect(await registryState(backend)).toEqual(before)
  })
})
