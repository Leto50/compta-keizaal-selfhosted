export interface ProductionIngredientLike {
  ingredientName: string
  productId?: string
  quantity: number
}

export interface ProductionRecipeLike {
  ingredients: readonly ProductionIngredientLike[]
}

export interface ProductionStockLike {
  _id: string
  currentStock: number
}

export interface ProductionRequirement {
  available?: number
  ingredientName: string
  productId?: string
  required: number
  requiredPerUnit: number
}

export function calculateProductionPlan(
  recipe: ProductionRecipeLike | undefined,
  products: readonly ProductionStockLike[],
  requestedQuantity: number
) {
  const quantity =
    Number.isInteger(requestedQuantity) && requestedQuantity > 0
      ? requestedQuantity
      : 0
  const productsById = new Map(
    products.map((product) => [product._id, product])
  )
  const requirements: ProductionRequirement[] = (recipe?.ingredients ?? []).map(
    (ingredient) => {
      const product = ingredient.productId
        ? productsById.get(ingredient.productId)
        : undefined
      return {
        ...(product ? { available: product.currentStock } : {}),
        ingredientName: ingredient.ingredientName,
        ...(ingredient.productId ? { productId: ingredient.productId } : {}),
        required: ingredient.quantity * quantity,
        requiredPerUnit: ingredient.quantity,
      }
    }
  )
  const complete =
    requirements.length > 0 &&
    requirements.every(
      (requirement) =>
        requirement.available !== undefined && requirement.requiredPerUnit > 0
    )
  const maximumQuantity = complete
    ? Math.min(
        ...requirements.map((requirement) =>
          Math.floor(requirement.available! / requirement.requiredPerUnit)
        )
      )
    : 0

  return {
    canProduce:
      complete &&
      quantity > 0 &&
      requirements.every(
        (requirement) => requirement.required <= requirement.available!
      ),
    complete,
    maximumQuantity,
    requirements,
  }
}
