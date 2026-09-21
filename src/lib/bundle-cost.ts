interface BundleCostItem {
  productId?: string
  quantity: number
}

interface BundleCostProduct {
  _id: string
  purchasePrice?: number
}

interface BundleCostRecipe {
  cost?: number
  productId?: string
}

export function calculateBundleCost(
  items: readonly BundleCostItem[],
  products: readonly BundleCostProduct[],
  recipes: readonly BundleCostRecipe[]
): number | undefined {
  const productsById = new Map(
    products.map((product) => [product._id, product])
  )
  const recipeCostsByProductId = new Map(
    recipes.flatMap((recipe) =>
      recipe.productId && recipe.cost !== undefined
        ? [[recipe.productId, recipe.cost] as const]
        : []
    )
  )

  return items.reduce<number | undefined>((total, item) => {
    if (total === undefined || !item.productId) return undefined
    const product = productsById.get(item.productId)
    const unitCost =
      recipeCostsByProductId.get(item.productId) ?? product?.purchasePrice
    return unitCost === undefined ? undefined : total + unitCost * item.quantity
  }, 0)
}
