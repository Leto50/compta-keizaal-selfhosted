export interface PreparationIngredient {
  ingredientName: string
  productId?: string
  quantity: number
}

export interface PreparationLine {
  productId?: string
  productName: string
  quantity: number
}

export interface PreparationProduct {
  _id: string
  category: "annexe" | "ingredient" | "potion" | "service"
  name: string
  purchasePrice?: number
}

export interface PreparationRecipe {
  cost?: number
  ingredients: readonly PreparationIngredient[]
  productId?: string
}

export interface OrderPreparation {
  ingredients: PreparationIngredient[]
  missingCostReferences: string[]
  missingRecipeReferences: string[]
  productionCost?: number
  referenceCount: number
}

export function calculateOrderPreparation(
  lines: readonly PreparationLine[],
  products: readonly PreparationProduct[],
  recipes: readonly PreparationRecipe[]
): OrderPreparation {
  const productsById = new Map(
    products.map((product) => [product._id, product])
  )
  const recipesByProductId = new Map(
    recipes.flatMap((recipe) =>
      recipe.productId ? [[recipe.productId, recipe] as const] : []
    )
  )
  const ingredientTotals = new Map<string, PreparationIngredient>()
  const missingCosts = new Set<string>()
  const missingRecipes = new Set<string>()
  let productionCost = 0
  let referenceCount = 0

  function addIngredient(
    ingredient: PreparationIngredient,
    multiplier: number
  ) {
    const key = ingredient.productId ?? ingredient.ingredientName.toLowerCase()
    const existing = ingredientTotals.get(key)
    ingredientTotals.set(key, {
      ingredientName: existing?.ingredientName ?? ingredient.ingredientName,
      ...(ingredient.productId ? { productId: ingredient.productId } : {}),
      quantity: (existing?.quantity ?? 0) + ingredient.quantity * multiplier,
    })
  }

  for (const line of lines) {
    if (
      !line.productId ||
      !Number.isFinite(line.quantity) ||
      line.quantity <= 0
    ) {
      continue
    }
    const product = productsById.get(line.productId)
    if (!product) continue
    referenceCount += 1
    const recipe = recipesByProductId.get(product._id)
    if (recipe) {
      for (const ingredient of recipe.ingredients) {
        addIngredient(ingredient, line.quantity)
      }
      if (recipe.cost === undefined) {
        missingCosts.add(line.productName)
      } else {
        productionCost += recipe.cost * line.quantity
      }
      continue
    }

    if (product.category === "ingredient") {
      addIngredient(
        {
          ingredientName: product.name,
          productId: product._id,
          quantity: 1,
        },
        line.quantity
      )
    } else if (product.category === "potion") {
      missingRecipes.add(line.productName)
    }

    if (product.category === "service") continue
    if (product.purchasePrice === undefined) {
      missingCosts.add(line.productName)
    } else {
      productionCost += product.purchasePrice * line.quantity
    }
  }

  return {
    ingredients: [...ingredientTotals.values()].sort((left, right) =>
      left.ingredientName.localeCompare(right.ingredientName, "fr")
    ),
    missingCostReferences: [...missingCosts].sort((left, right) =>
      left.localeCompare(right, "fr")
    ),
    missingRecipeReferences: [...missingRecipes].sort((left, right) =>
      left.localeCompare(right, "fr")
    ),
    ...(missingCosts.size === 0 ? { productionCost } : {}),
    referenceCount,
  }
}
