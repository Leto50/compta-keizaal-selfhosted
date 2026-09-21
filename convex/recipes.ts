import { ConvexError, v } from "convex/values"

import { type Doc, type Id } from "./_generated/dataModel"
import { mutation, query, type QueryCtx } from "./_generated/server"
import { requireUser } from "./lib/auth"
import { assertWholeNumberRange } from "./lib/numbers"
import { rebuildInventorySummaryIfReady } from "./lib/inventorySummary"
import { isProductDeclaredCraftable } from "./lib/products"
import { calculateRecipeCost } from "./lib/recipeCost"
import { recipeFamily } from "./lib/recipeFamilies"
import { normalizeCatalogName, normalizeName } from "./lib/text"

const MAX_EFFECT_LENGTH = 500
const MAX_INGREDIENTS = 50
const MAX_NAME_LENGTH = 100
const MAX_QUANTITY = 1_000_000

async function completeRecipe(
  ctx: QueryCtx,
  recipe: Doc<"recipes">,
  productsById?: ReadonlyMap<string, Doc<"products">>
) {
  const ingredients = await ctx.db
    .query("recipeIngredients")
    .withIndex("by_recipe", (index) => index.eq("recipeId", recipe._id))
    .collect()
  const product =
    recipe.productId && productsById
      ? productsById.get(recipe.productId)
      : undefined
  const { cost, missingReferences } = productsById
    ? calculateRecipeCost(ingredients, productsById)
    : {
        cost: recipe.cost,
        missingReferences: recipe.missingCostReferences ?? [],
      }
  const storedRecipe = { ...recipe }
  delete storedRecipe.cost
  delete storedRecipe.missingCostReferences

  return {
    ...storedRecipe,
    ...(cost === undefined ? {} : { cost }),
    ingredients,
    missingCostReferences: missingReferences,
    name: product?.name ?? recipe.name,
  }
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx)
    const recipes = await ctx.db.query("recipes").collect()
    const activeRecipes = recipes.filter((recipe) => recipe.active !== false)
    const productsById = activeRecipes.some(
      (recipe) => recipe.missingCostReferences === undefined
    )
      ? new Map(
          (await ctx.db.query("products").collect()).map((product) => [
            product._id,
            product,
          ])
        )
      : undefined
    const withIngredients = await Promise.all(
      activeRecipes.map((recipe) => completeRecipe(ctx, recipe, productsById))
    )
    return withIngredients.sort((left, right) =>
      left.name.localeCompare(right.name, "fr")
    )
  },
})

export const listCraftableProductIds = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx)
    const [recipes, products] = await Promise.all([
      ctx.db.query("recipes").collect(),
      ctx.db.query("products").collect(),
    ])
    const craftableProducts = new Set(
      products
        .filter(
          (product) =>
            product.active && product.tracksStock && product.craftable !== false
        )
        .map((product) => product._id)
    )
    return [
      ...new Set(
        recipes.flatMap((recipe) =>
          recipe.active !== false &&
          recipe.productId &&
          craftableProducts.has(recipe.productId)
            ? [recipe.productId]
            : []
        )
      ),
    ]
  },
})

export const listLinkedProductIds = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx)
    const recipes = await ctx.db.query("recipes").collect()
    return [
      ...new Set(
        recipes.flatMap((recipe) =>
          recipe.productId ? [recipe.productId] : []
        )
      ),
    ]
  },
})

export const listActiveLinkedProductIds = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx)
    const recipes = await ctx.db.query("recipes").collect()
    return [
      ...new Set(
        recipes.flatMap((recipe) =>
          recipe.active !== false && recipe.productId ? [recipe.productId] : []
        )
      ),
    ]
  },
})

export const listArchived = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx)
    const recipes = await ctx.db.query("recipes").collect()
    const archived = recipes.filter((recipe) => recipe.active === false)
    const productsById = archived.some(
      (recipe) => recipe.missingCostReferences === undefined
    )
      ? new Map(
          (await ctx.db.query("products").collect()).map((product) => [
            product._id,
            product,
          ])
        )
      : undefined
    const withIngredients = await Promise.all(
      archived.map((recipe) => completeRecipe(ctx, recipe, productsById))
    )
    return withIngredients.sort((left, right) =>
      left.name.localeCompare(right.name, "fr")
    )
  },
})

export const save = mutation({
  args: {
    effect: v.string(),
    family: recipeFamily,
    ingredients: v.array(
      v.object({
        productId: v.id("products"),
        quantity: v.number(),
      })
    ),
    name: v.string(),
    outputProductId: v.optional(v.id("products")),
    recipeId: v.optional(v.id("recipes")),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    const name = normalizeCatalogName(args.name)
    const family = args.family
    const effect = args.effect.trim()
    if (!name || name.length > MAX_NAME_LENGTH) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: `Le nom doit contenir entre 1 et ${MAX_NAME_LENGTH} caractères.`,
      })
    }
    if (effect.length > MAX_EFFECT_LENGTH) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "La description de l’effet est trop longue.",
      })
    }
    if (
      args.ingredients.length === 0 ||
      args.ingredients.length > MAX_INGREDIENTS
    ) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: `Une recette doit contenir entre 1 et ${MAX_INGREDIENTS} ingrédients.`,
      })
    }
    const existing = args.recipeId ? await ctx.db.get(args.recipeId) : undefined
    if (args.recipeId && !existing) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Recette introuvable.",
      })
    }

    const normalizedName = normalizeName(name)
    const recipes = await ctx.db.query("recipes").collect()
    if (
      recipes.some(
        (recipe) =>
          recipe._id !== args.recipeId &&
          normalizeName(recipe.name) === normalizedName
      )
    ) {
      throw new ConvexError({
        code: "ALREADY_EXISTS",
        message: `Une recette existe déjà sous le nom « ${name} ».`,
      })
    }

    const productsWithName = await ctx.db
      .query("products")
      .withIndex("by_normalized_name", (index) =>
        index.eq("normalizedName", normalizedName)
      )
      .collect()
    let linkedProduct: Doc<"products"> | null
    if (existing) {
      linkedProduct = existing.productId
        ? await ctx.db.get(existing.productId)
        : null
      if (!linkedProduct) {
        throw new ConvexError({
          code: "NOT_FOUND",
          message: "L’article fabriqué lié à cette recette est introuvable.",
        })
      }
      if (
        productsWithName.some((product) => product._id !== linkedProduct?._id)
      ) {
        throw new ConvexError({
          code: "ALREADY_EXISTS",
          message: `Un article existe déjà sous le nom « ${name} ».`,
        })
      }
      if (
        linkedProduct.name !== name ||
        linkedProduct.normalizedName !== normalizedName
      ) {
        await ctx.db.patch(linkedProduct._id, { name, normalizedName })
        linkedProduct = { ...linkedProduct, name, normalizedName }
        await ctx.db.insert("auditLogs", {
          action: "product.updated",
          actorUserId: String(user._id),
          createdAt: Date.now(),
          detail: name,
          entityId: linkedProduct._id,
          entityType: "product",
        })
      }
    } else if (args.outputProductId) {
      linkedProduct = await ctx.db.get(args.outputProductId)
      if (
        !linkedProduct?.active ||
        !isProductDeclaredCraftable(linkedProduct)
      ) {
        throw new ConvexError({
          code: "NOT_FOUND",
          message: "L’article choisi est introuvable ou non fabricable.",
        })
      }
      if (linkedProduct.normalizedName !== normalizedName) {
        throw new ConvexError({
          code: "INVALID_INPUT",
          message: "La recette doit porter exactement le nom de l’article.",
        })
      }
      if (
        productsWithName.some((product) => product._id !== linkedProduct?._id)
      ) {
        throw new ConvexError({
          code: "ALREADY_EXISTS",
          message: `Un autre article existe déjà sous le nom « ${name} ».`,
        })
      }
    } else {
      if (productsWithName.length > 0) {
        throw new ConvexError({
          code: "ALREADY_EXISTS",
          message: `Choisissez l’article existant « ${name} » comme produit obtenu.`,
        })
      }
      const productId = await ctx.db.insert("products", {
        active: true,
        category: "potion",
        craftable: true,
        currentStock: 0,
        minimumStock: 0,
        name,
        normalizedName,
        tracksStock: true,
      })
      linkedProduct = await ctx.db.get(productId)
      await ctx.db.insert("auditLogs", {
        action: "product.created",
        actorUserId: String(user._id),
        createdAt: Date.now(),
        detail: name,
        entityId: productId,
        entityType: "product",
      })
    }

    if (
      !linkedProduct?.active ||
      !linkedProduct.tracksStock ||
      linkedProduct.craftable === false
    ) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "L’article fabriqué est introuvable ou non fabricable.",
      })
    }
    if (
      recipes.some(
        (recipe) =>
          recipe._id !== args.recipeId && recipe.productId === linkedProduct._id
      )
    ) {
      throw new ConvexError({
        code: "ALREADY_EXISTS",
        message: `Une recette existe déjà pour « ${linkedProduct.name} ».`,
      })
    }

    const ingredientProductsById = new Map<string, Doc<"products">>()
    const seenProducts = new Set<string>()
    const preparedIngredients = await Promise.all(
      args.ingredients.map(async (ingredient) => {
        assertWholeNumberRange(
          ingredient.quantity,
          1,
          MAX_QUANTITY,
          "La quantité"
        )
        if (seenProducts.has(ingredient.productId)) {
          throw new ConvexError({
            code: "INVALID_INPUT",
            message: "Un ingrédient ne peut apparaître qu’une fois.",
          })
        }
        seenProducts.add(ingredient.productId)
        const product = await ctx.db.get(ingredient.productId)
        if (!product?.active || !product.tracksStock) {
          throw new ConvexError({
            code: "NOT_FOUND",
            message: "Un ingrédient est introuvable ou indisponible.",
          })
        }
        if (product._id === linkedProduct._id) {
          throw new ConvexError({
            code: "INVALID_INPUT",
            message: "Un article ne peut pas être son propre ingrédient.",
          })
        }
        ingredientProductsById.set(product._id, product)
        return {
          ingredientName: product.name,
          productId: product._id,
          quantity: ingredient.quantity,
          raw: `${ingredient.quantity} ${product.name}`,
        }
      })
    )

    const { cost, missingReferences } = calculateRecipeCost(
      preparedIngredients,
      ingredientProductsById
    )

    const details = {
      active: existing?.active ?? true,
      ...(cost === undefined ? {} : { cost }),
      ...(effect ? { effect } : {}),
      family,
      ...(existing?.legacyKey ? { legacyKey: existing.legacyKey } : {}),
      missingCostReferences: missingReferences,
      name,
      productId: linkedProduct._id,
    }
    let recipeId: Id<"recipes">
    if (existing) {
      await ctx.db.replace(existing._id, details)
      recipeId = existing._id
      const oldIngredients = await ctx.db
        .query("recipeIngredients")
        .withIndex("by_recipe", (index) => index.eq("recipeId", recipeId))
        .collect()
      await Promise.all(
        oldIngredients.map((ingredient) => ctx.db.delete(ingredient._id))
      )
    } else {
      recipeId = await ctx.db.insert("recipes", details)
    }

    await Promise.all(
      preparedIngredients.map((ingredient) =>
        ctx.db.insert("recipeIngredients", { recipeId, ...ingredient })
      )
    )
    await ctx.db.insert("auditLogs", {
      action: existing ? "recipe.updated" : "recipe.created",
      actorUserId: String(user._id),
      createdAt: Date.now(),
      detail: `${name}:${preparedIngredients.length}`,
      entityId: recipeId,
      entityType: "recipe",
    })
    await rebuildInventorySummaryIfReady(ctx)
    return recipeId
  },
})

export const setActive = mutation({
  args: {
    active: v.boolean(),
    recipeId: v.id("recipes"),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    const recipe = await ctx.db.get(args.recipeId)
    if (!recipe) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Recette introuvable.",
      })
    }
    if (args.active) {
      const product = recipe.productId
        ? await ctx.db.get(recipe.productId)
        : null
      if (
        !product?.active ||
        !product.tracksStock ||
        product.craftable === false
      ) {
        throw new ConvexError({
          code: "INVALID_OPERATION",
          message:
            "Rendez d’abord l’article fabricable avant de réactiver sa recette.",
        })
      }
    }
    await ctx.db.patch(recipe._id, { active: args.active })
    await rebuildInventorySummaryIfReady(ctx)
    await ctx.db.insert("auditLogs", {
      action: args.active ? "recipe.reactivated" : "recipe.archived",
      actorUserId: String(user._id),
      createdAt: Date.now(),
      detail: recipe.name,
      entityId: recipe._id,
      entityType: "recipe",
    })
  },
})

export const listBundles = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx)
    const bundles = await ctx.db.query("bundles").collect()
    return Promise.all(
      bundles
        .filter((bundle) => bundle.active)
        .map(async (bundle) => ({
          ...bundle,
          items: await ctx.db
            .query("bundleItems")
            .withIndex("by_bundle", (index) => index.eq("bundleId", bundle._id))
            .collect(),
        }))
    )
  },
})
