import { type Doc } from "../_generated/dataModel"
import { type MutationCtx } from "../_generated/server"

type CostProduct = Pick<Doc<"products">, "_id" | "name" | "purchasePrice">
type CostIngredient = Pick<
  Doc<"recipeIngredients">,
  "ingredientName" | "productId" | "quantity"
>

export interface RecipeCost {
  cost?: number
  missingReferences: string[]
}

export function calculateRecipeCost(
  ingredients: readonly CostIngredient[],
  productsById: ReadonlyMap<string, CostProduct>
): RecipeCost {
  const missingReferences = new Set<string>()
  let cost = 0

  for (const ingredient of ingredients) {
    const product = ingredient.productId
      ? productsById.get(ingredient.productId)
      : undefined
    if (product?.purchasePrice === undefined) {
      missingReferences.add(product?.name ?? ingredient.ingredientName)
      continue
    }
    cost += ingredient.quantity * product.purchasePrice
  }

  return {
    ...(missingReferences.size === 0 ? { cost } : {}),
    missingReferences: [...missingReferences].sort((left, right) =>
      left.localeCompare(right, "fr")
    ),
  }
}

export async function rebuildRecipeCostProjections(ctx: MutationCtx) {
  const [ingredients, products, recipes] = await Promise.all([
    ctx.db.query("recipeIngredients").collect(),
    ctx.db.query("products").collect(),
    ctx.db.query("recipes").collect(),
  ])
  const productsById = new Map(
    products.map((product) => [product._id, product])
  )
  const ingredientsByRecipe = new Map<string, typeof ingredients>()
  for (const ingredient of ingredients) {
    const entries = ingredientsByRecipe.get(ingredient.recipeId) ?? []
    entries.push(ingredient)
    ingredientsByRecipe.set(ingredient.recipeId, entries)
  }

  for (const recipe of recipes) {
    const { cost, missingReferences } = calculateRecipeCost(
      ingredientsByRecipe.get(recipe._id) ?? [],
      productsById
    )
    await ctx.db.patch(recipe._id, {
      cost,
      missingCostReferences: missingReferences,
    })
  }
  return recipes.length
}
