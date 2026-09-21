import { type Doc } from "../../convex/_generated/dataModel"

export type ProductCategory = Exclude<Doc<"products">["category"], "annexe">

export const productCategories: readonly ProductCategory[] = [
  "potion",
  "ingredient",
  "service",
]

export function canonicalProductCategory(
  category: Doc<"products">["category"]
): ProductCategory {
  return category === "annexe" ? "potion" : category
}

export function isProductCraftable(
  product: Pick<Doc<"products">, "category" | "craftable" | "tracksStock">,
  hasRecipe = false
) {
  if (!product.tracksStock) return false
  if (product.craftable !== undefined) return product.craftable

  // Legacy potions and existing recipe outputs predate the generalized field.
  return canonicalProductCategory(product.category) === "potion" || hasRecipe
}
