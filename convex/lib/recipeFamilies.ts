import { ConvexError } from "convex/values"

import { type Doc } from "../_generated/dataModel"
import { type MutationCtx, type QueryCtx } from "../_generated/server"
import {
  canonicalRecipeFamily,
  getRecipeFamilies,
  isRecipeFamily,
  MAX_RECIPE_FAMILY_LENGTH,
} from "../../shared/recipe-families"
import { normalizeCatalogName, normalizeName } from "./text"

export { canonicalRecipeFamily } from "../../shared/recipe-families"

const REGISTRY_KEY = "recipe-categories-v1"

export function validatedCategoryName(value: string) {
  if (!isRecipeFamily(value)) {
    throw new ConvexError({
      code: "INVALID_INPUT",
      message: `Choisissez ou saisissez une catégorie valide (${MAX_RECIPE_FAMILY_LENGTH} caractères maximum).`,
    })
  }
  return normalizeCatalogName(value)
}

export async function recipeCategoriesAreInitialized(
  ctx: QueryCtx | MutationCtx
) {
  return (
    (await ctx.db
      .query("systemSettings")
      .withIndex("by_key", (index) => index.eq("key", REGISTRY_KEY))
      .unique()) !== null
  )
}

export async function initializeRecipeCategoriesData(ctx: MutationCtx) {
  if (await recipeCategoriesAreInitialized(ctx)) return { initialized: false }
  const recipes = await ctx.db.query("recipes").collect()
  const existing = await ctx.db.query("recipeCategories").collect()
  const names = getRecipeFamilies(recipes.map((recipe) => recipe.family))
  const categoriesByName = new Map(
    existing.map((category) => [category.normalizedName, category.name])
  )
  for (const name of names) {
    const normalizedName = normalizeName(name)
    if (!categoriesByName.has(normalizedName)) {
      await ctx.db.insert("recipeCategories", { name, normalizedName })
      categoriesByName.set(normalizedName, name)
    }
  }
  for (const recipe of recipes) {
    const canonical = canonicalRecipeFamily(recipe.family)
    if (!canonical) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: `La catégorie de la recette « ${recipe.name} » est invalide.`,
      })
    }
    const family = categoriesByName.get(normalizeName(canonical))!
    if (recipe.family !== family) await ctx.db.patch(recipe._id, { family })
  }
  await ctx.db.insert("systemSettings", {
    key: REGISTRY_KEY,
    updatedAt: Date.now(),
    value: "initialized",
  })
  return { initialized: true }
}

export async function listRecipeCategoriesData(
  ctx: QueryCtx | MutationCtx,
  visibleRecipes?: Doc<"recipes">[]
) {
  const initialized = await recipeCategoriesAreInitialized(ctx)
  const recipes = visibleRecipes ?? (await ctx.db.query("recipes").collect())
  const storedCategories = await ctx.db.query("recipeCategories").collect()
  const names = initialized
    ? storedCategories.map((category) => category.name)
    : getRecipeFamilies(recipes.map((recipe) => recipe.family))
  return names
    .map((name) => {
      const matching = recipes.filter(
        (recipe) =>
          normalizeName(
            initialized
              ? recipe.family
              : (canonicalRecipeFamily(recipe.family) ?? recipe.family)
          ) === normalizeName(name)
      )
      return {
        name,
        recipeCount: matching.length,
        archivedRecipeCount: matching.filter(
          (recipe) => recipe.active === false
        ).length,
      }
    })
    .filter(
      (category) => visibleRecipes === undefined || category.recipeCount > 0
    )
    .sort((left, right) => left.name.localeCompare(right.name, "fr"))
}

export async function findRecipeCategory(ctx: MutationCtx, value: string) {
  return ctx.db
    .query("recipeCategories")
    .withIndex("by_normalized_name", (index) =>
      index.eq("normalizedName", normalizeName(value))
    )
    .unique()
}

export async function resolveRecipeCategory(
  ctx: MutationCtx,
  value: string,
  allowCreate: boolean,
  actorUserId: string
) {
  const name = validatedCategoryName(value)
  await initializeRecipeCategoriesData(ctx)
  const existing = await findRecipeCategory(ctx, name)
  if (existing) return existing.name
  if (!allowCreate) {
    throw new ConvexError({
      code: "NOT_FOUND",
      message:
        "Cette catégorie n’existe plus. Choisissez une catégorie disponible ou créez-en une nouvelle.",
    })
  }
  const entityId = await ctx.db.insert("recipeCategories", {
    name,
    normalizedName: normalizeName(name),
  })
  await ctx.db.insert("auditLogs", {
    action: "recipe_category.created",
    actorUserId,
    createdAt: Date.now(),
    detail: name,
    entityId,
    entityType: "recipe_category",
  })
  return name
}
