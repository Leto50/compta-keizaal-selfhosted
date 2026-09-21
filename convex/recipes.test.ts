import { describe, expect, it } from "vitest"

import { api } from "./_generated/api"
import { asAuthenticatedUser, createTestBackend } from "./test.helpers"

async function seedRecipeProducts(
  backend: ReturnType<typeof createTestBackend>
) {
  return backend.run(async (ctx) => {
    const ingredientId = await ctx.db.insert("products", {
      active: true,
      category: "ingredient",
      currentStock: 20,
      minimumStock: 2,
      name: "Poudre minérale",
      normalizedName: "poudre minerale",
      purchasePrice: 1.25,
      tracksStock: true,
    })
    const existingPotionId = await ctx.db.insert("products", {
      active: true,
      category: "potion",
      currentStock: 4,
      minimumStock: 1,
      name: "Préparation déjà enregistrée",
      normalizedName: "preparation deja enregistree",
      tracksStock: true,
    })
    return { existingPotionId, ingredientId }
  })
}

describe("recipes", () => {
  it("ne propose à la fabrication que les articles liés à une recette active", async () => {
    const backend = createTestBackend()
    const member = await asAuthenticatedUser(backend)
    const [activeProductId, archivedProductId, saltProductId] =
      await backend.run(async (ctx) => {
        const activeProductId = await ctx.db.insert("products", {
          active: true,
          category: "potion",
          currentStock: 0,
          minimumStock: 0,
          name: "Potion réalisable",
          normalizedName: "potion realisable",
          tracksStock: true,
        })
        const archivedProductId = await ctx.db.insert("products", {
          active: true,
          category: "potion",
          currentStock: 1,
          minimumStock: 0,
          name: "Potion trouvée",
          normalizedName: "potion trouvee",
          tracksStock: true,
        })
        const saltProductId = await ctx.db.insert("products", {
          active: true,
          category: "ingredient",
          currentStock: 1,
          minimumStock: 0,
          name: "Sel réalisable",
          normalizedName: "sel realisable",
          tracksStock: true,
        })
        await ctx.db.insert("recipes", {
          active: true,
          family: "Soins",
          name: "Potion réalisable",
          productId: activeProductId,
        })
        await ctx.db.insert("recipes", {
          active: false,
          family: "Trouvailles",
          name: "Potion trouvée",
          productId: archivedProductId,
        })
        await ctx.db.insert("recipes", {
          active: true,
          family: "Sel",
          name: "Sel réalisable",
          productId: saltProductId,
        })
        return [activeProductId, archivedProductId, saltProductId] as const
      })

    const result = await member.query(api.recipes.listCraftableProductIds, {})
    const activeLinks = await member.query(
      api.recipes.listActiveLinkedProductIds,
      {}
    )

    expect(result).toEqual([activeProductId, saltProductId])
    expect(result).not.toContain(archivedProductId)
    expect(activeLinks).toEqual([activeProductId, saltProductId])
  })

  it("crée, modifie et archive une recette avec ses ingrédients", async () => {
    const backend = createTestBackend()
    const admin = await asAuthenticatedUser(backend, "admin")
    const { ingredientId } = await seedRecipeProducts(backend)

    const recipeId = await admin.mutation(api.recipes.save, {
      effect: "Aide à tenir pendant une longue garde.",
      family: "Fortifiant",
      ingredients: [{ productId: ingredientId, quantity: 2 }],
      name: "  ÉLIXIR DU VEILLEUR  ",
    })
    await admin.mutation(api.recipes.save, {
      effect: "Soutient l’effort prolongé.",
      family: "Fortifiant",
      ingredients: [{ productId: ingredientId, quantity: 3 }],
      name: "ÉLIXIR DU VEILLEUR RENFORCÉ",
      recipeId,
    })
    await admin.mutation(api.recipes.setActive, {
      active: false,
      recipeId,
    })

    const state = await backend.run(async (ctx) => {
      const recipe = await ctx.db.get(recipeId)
      return {
        audits: await ctx.db.query("auditLogs").collect(),
        ingredients: await ctx.db
          .query("recipeIngredients")
          .withIndex("by_recipe", (index) => index.eq("recipeId", recipeId))
          .collect(),
        product: recipe?.productId ? await ctx.db.get(recipe.productId) : null,
        recipe,
      }
    })
    expect(state.recipe).toMatchObject({
      active: false,
      cost: 3.75,
      name: "Élixir du veilleur renforcé",
      productId: state.product?._id,
    })
    expect(state.product?.name).toBe("Élixir du veilleur renforcé")
    expect(state.ingredients).toHaveLength(1)
    expect(state.ingredients[0]).toMatchObject({
      ingredientName: "Poudre minérale",
      quantity: 3,
    })
    expect(state.audits.map((audit) => audit.action)).toEqual([
      "product.created",
      "recipe.created",
      "product.updated",
      "recipe.updated",
      "recipe.archived",
    ])
  })

  it("refuse les quantités d’ingrédients fractionnaires", async () => {
    const backend = createTestBackend()
    const admin = await asAuthenticatedUser(backend, "admin")
    const { ingredientId } = await seedRecipeProducts(backend)

    await expect(
      admin.mutation(api.recipes.save, {
        effect: "",
        family: "Utilitaire",
        ingredients: [{ productId: ingredientId, quantity: 1.5 }],
        name: "Préparation incomplète",
      })
    ).rejects.toThrowError("nombre entier")

    const products = await backend.run((ctx) =>
      ctx.db.query("products").collect()
    )
    expect(products).toHaveLength(2)
  })

  it("permet la gestion des recettes aux employés", async () => {
    const backend = createTestBackend()
    const employee = await asAuthenticatedUser(backend)
    const { ingredientId } = await seedRecipeProducts(backend)

    const recipeId = await employee.mutation(api.recipes.save, {
      effect: "",
      family: "Utilitaire",
      ingredients: [{ productId: ingredientId, quantity: 1 }],
      name: "Élixir du veilleur",
    })

    expect(await backend.run((ctx) => ctx.db.get(recipeId))).toMatchObject({
      name: "Élixir du veilleur",
    })
  })

  it("refuse de relier une nouvelle recette à un article homonyme", async () => {
    const backend = createTestBackend()
    const admin = await asAuthenticatedUser(backend, "admin")
    const { ingredientId } = await seedRecipeProducts(backend)

    await expect(
      admin.mutation(api.recipes.save, {
        effect: "",
        family: "Utilitaire",
        ingredients: [{ productId: ingredientId, quantity: 1 }],
        name: "Préparation déjà enregistrée",
      })
    ).rejects.toThrowError("Choisissez l’article existant")

    const state = await backend.run(async (ctx) => ({
      audits: await ctx.db.query("auditLogs").collect(),
      products: await ctx.db.query("products").collect(),
      recipes: await ctx.db.query("recipes").collect(),
    }))
    expect(state.products).toHaveLength(2)
    expect(state.recipes).toHaveLength(0)
    expect(state.audits).toHaveLength(0)
  })

  it("relie explicitement une recette à une potion fabricable existante", async () => {
    const backend = createTestBackend()
    const admin = await asAuthenticatedUser(backend, "admin")
    const { existingPotionId, ingredientId } = await seedRecipeProducts(backend)

    const recipeId = await admin.mutation(api.recipes.save, {
      effect: "",
      family: "Utilitaire",
      ingredients: [{ productId: ingredientId, quantity: 1 }],
      name: "Préparation déjà enregistrée",
      outputProductId: existingPotionId,
    })

    const state = await backend.run(async (ctx) => ({
      products: await ctx.db.query("products").collect(),
      recipe: await ctx.db.get(recipeId),
    }))
    expect(state.products).toHaveLength(2)
    expect(state.recipe?.productId).toBe(existingPotionId)
  })

  it("relie une recette à un ingrédient explicitement fabricable", async () => {
    const backend = createTestBackend()
    const admin = await asAuthenticatedUser(backend, "admin")
    const { ingredientId } = await seedRecipeProducts(backend)
    const saltId = await backend.run((ctx) =>
      ctx.db.insert("products", {
        active: true,
        category: "ingredient",
        craftable: true,
        currentStock: 0,
        minimumStock: 1,
        name: "Sel de feu",
        normalizedName: "sel de feu",
        tracksStock: true,
      })
    )

    const recipeId = await admin.mutation(api.recipes.save, {
      effect: "",
      family: "Sel",
      ingredients: [{ productId: ingredientId, quantity: 2 }],
      name: "Sel de feu",
      outputProductId: saltId,
    })

    expect(await backend.run((ctx) => ctx.db.get(recipeId))).toMatchObject({
      name: "Sel de feu",
      productId: saltId,
    })
  })

  it("modifie et réactive la recette historique d’un ingrédient", async () => {
    const backend = createTestBackend()
    const admin = await asAuthenticatedUser(backend, "admin")
    const { ingredientId } = await seedRecipeProducts(backend)
    const recipeId = await backend.run(async (ctx) => {
      const saltId = await ctx.db.insert("products", {
        active: true,
        category: "ingredient",
        currentStock: 4,
        minimumStock: 1,
        name: "Sel de néant",
        normalizedName: "sel de neant",
        tracksStock: true,
      })
      return ctx.db.insert("recipes", {
        active: true,
        family: "Sel",
        name: "Sel de néant",
        productId: saltId,
      })
    })

    await admin.mutation(api.recipes.save, {
      effect: "Stabilise les préparations.",
      family: "Sel",
      ingredients: [{ productId: ingredientId, quantity: 3 }],
      name: "Sel de néant",
      recipeId,
    })
    await admin.mutation(api.recipes.setActive, { active: false, recipeId })
    await admin.mutation(api.recipes.setActive, { active: true, recipeId })

    expect(await backend.run((ctx) => ctx.db.get(recipeId))).toMatchObject({
      active: true,
      effect: "Stabilise les préparations.",
      family: "Sel",
      name: "Sel de néant",
    })
  })

  it("refuse de fabriquer une potion déclarée comme trouvée uniquement", async () => {
    const backend = createTestBackend()
    const admin = await asAuthenticatedUser(backend, "admin")
    const { existingPotionId, ingredientId } = await seedRecipeProducts(backend)
    await backend.run((ctx) =>
      ctx.db.patch(existingPotionId, { craftable: false })
    )

    await expect(
      admin.mutation(api.recipes.save, {
        effect: "",
        family: "Utilitaire",
        ingredients: [{ productId: ingredientId, quantity: 1 }],
        name: "Préparation déjà enregistrée",
        outputProductId: existingPotionId,
      })
    ).rejects.toThrowError("non fabricable")
  })

  it("refuse de réactiver la recette d’une potion trouvée uniquement", async () => {
    const backend = createTestBackend()
    const admin = await asAuthenticatedUser(backend, "admin")
    const { existingPotionId } = await seedRecipeProducts(backend)
    const recipeId = await backend.run((ctx) =>
      ctx.db.insert("recipes", {
        active: false,
        family: "Utilitaire",
        name: "Préparation déjà enregistrée",
        productId: existingPotionId,
      })
    )
    await backend.run((ctx) =>
      ctx.db.patch(existingPotionId, { craftable: false })
    )

    await expect(
      admin.mutation(api.recipes.setActive, { active: true, recipeId })
    ).rejects.toThrowError("Rendez d’abord l’article fabricable")
  })

  it("calcule le coût courant et interdit deux recettes pour le même article", async () => {
    const backend = createTestBackend()
    const admin = await asAuthenticatedUser(backend, "admin")
    const { ingredientId } = await seedRecipeProducts(backend)

    await admin.mutation(api.recipes.save, {
      effect: "",
      family: "Fortifiant",
      ingredients: [{ productId: ingredientId, quantity: 2 }],
      name: "Élixir du veilleur",
    })
    await admin.mutation(api.products.save, {
      active: true,
      category: "ingredient",
      minimumStock: 2,
      name: "Poudre minérale",
      productId: ingredientId,
      purchasePrice: 2,
      salePrice: null,
      targetStock: 20,
    })

    const recipes = await admin.query(api.recipes.list, {})
    expect(recipes[0]).toMatchObject({
      cost: 4,
      name: "Élixir du veilleur",
    })
    expect(recipes[0]?.productId).toBeDefined()
    await expect(
      admin.mutation(api.recipes.save, {
        effect: "",
        family: "Utilitaire",
        ingredients: [{ productId: ingredientId, quantity: 1 }],
        name: "élixir DU veilleur",
      })
    ).rejects.toThrowError("existe déjà")
  })

  it("crée automatiquement l’article portant le nom de la recette", async () => {
    const backend = createTestBackend()
    const admin = await asAuthenticatedUser(backend, "admin")
    const { ingredientId } = await seedRecipeProducts(backend)

    const recipeId = await admin.mutation(api.recipes.save, {
      effect: "Éclaire les galeries les plus sombres.",
      family: "Utilitaire",
      ingredients: [{ productId: ingredientId, quantity: 2 }],
      name: "Philtre du guetteur",
    })

    const state = await backend.run(async (ctx) => ({
      audits: await ctx.db.query("auditLogs").collect(),
      products: await ctx.db.query("products").collect(),
      recipe: await ctx.db.get(recipeId),
    }))
    const product = state.products.find(
      (entry) => entry.name === "Philtre du guetteur"
    )
    expect(product).toMatchObject({
      category: "potion",
      currentStock: 0,
      minimumStock: 0,
      tracksStock: true,
    })
    expect(state.recipe).toMatchObject({
      name: "Philtre du guetteur",
      productId: product?._id,
    })
    expect(state.audits.map((audit) => audit.action)).toEqual([
      "product.created",
      "recipe.created",
    ])
  })
})
