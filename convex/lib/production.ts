import { ConvexError } from "convex/values"

import { type Doc, type Id } from "../_generated/dataModel"
import { type MutationCtx } from "../_generated/server"
import { assertWholeNumberRange } from "./numbers"

const MAX_PRODUCTION_QUANTITY = 1_000_000

export interface PreparedProductionDelta {
  delta: number
  product: Doc<"products">
}

interface PrepareProductionOptions {
  baseStocks?: ReadonlyMap<string, number>
}

function addDelta(
  deltas: Map<string, PreparedProductionDelta>,
  product: Doc<"products">,
  delta: number
): void {
  const current = deltas.get(product._id)
  deltas.set(product._id, {
    delta: (current?.delta ?? 0) + delta,
    product,
  })
}

export async function prepareProduction(
  ctx: MutationCtx,
  productId: Id<"products">,
  quantity: number,
  options: Readonly<PrepareProductionOptions> = {}
) {
  assertWholeNumberRange(quantity, 1, MAX_PRODUCTION_QUANTITY, "La quantité")
  const product = await ctx.db.get(productId)
  if (!product?.active || !product.tracksStock) {
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "L’article fabriqué est introuvable ou archivé.",
    })
  }
  if (product.craftable === false) {
    throw new ConvexError({
      code: "INVALID_OPERATION",
      message:
        "Cet article est déclaré non fabricable et ne peut pas être produit.",
    })
  }

  const recipes = await ctx.db
    .query("recipes")
    .withIndex("by_product", (index) => index.eq("productId", product._id))
    .collect()
  const recipe = recipes.find((entry) => entry.active !== false)
  if (!recipe) {
    throw new ConvexError({
      code: "INVALID_OPERATION",
      message: "Ce produit ne possède aucune recette active.",
    })
  }
  const ingredients = await ctx.db
    .query("recipeIngredients")
    .withIndex("by_recipe", (index) => index.eq("recipeId", recipe._id))
    .collect()
  if (ingredients.length === 0) {
    throw new ConvexError({
      code: "INVALID_OPERATION",
      message: "Cette recette ne contient aucun ingrédient.",
    })
  }

  const deltas = new Map<string, PreparedProductionDelta>()
  addDelta(deltas, product, quantity)
  for (const ingredient of ingredients) {
    assertWholeNumberRange(
      ingredient.quantity,
      1,
      MAX_PRODUCTION_QUANTITY,
      "La quantité de l’ingrédient"
    )
    if (!ingredient.productId) {
      throw new ConvexError({
        code: "INVALID_OPERATION",
        message: `L’ingrédient « ${ingredient.ingredientName} » n’est relié à aucun stock.`,
      })
    }
    const ingredientProduct = await ctx.db.get(ingredient.productId)
    if (!ingredientProduct?.active || !ingredientProduct.tracksStock) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: `L’ingrédient « ${ingredient.ingredientName} » est indisponible.`,
      })
    }
    if (ingredientProduct._id === product._id) {
      throw new ConvexError({
        code: "INVALID_OPERATION",
        message: "Un article ne peut pas être son propre ingrédient.",
      })
    }
    const requiredQuantity = ingredient.quantity * quantity
    assertWholeNumberRange(
      requiredQuantity,
      1,
      Number.MAX_SAFE_INTEGER,
      `La quantité requise pour « ${ingredientProduct.name} »`
    )
    addDelta(deltas, ingredientProduct, -requiredQuantity)
  }

  for (const { delta, product: changedProduct } of deltas.values()) {
    const baseStock =
      options.baseStocks?.get(changedProduct._id) ?? changedProduct.currentStock
    if (baseStock + delta < 0) {
      throw new ConvexError({
        code: "INSUFFICIENT_STOCK",
        message: `Stock insuffisant pour « ${changedProduct.name} » : ${baseStock} disponibles.`,
      })
    }
  }

  return { deltas, product, recipe }
}
