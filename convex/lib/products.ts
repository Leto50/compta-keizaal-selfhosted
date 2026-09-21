import { type Doc } from "../_generated/dataModel"

export type ProductCategory = Exclude<Doc<"products">["category"], "annexe">

const lootOnlyLegacyKeys = new Set([
  "product:chevalier",
  "product:escarmoucheur",
  "product:force",
  "product:forgeron",
  "product:invocateur",
  "product:res feu",
  "product:res foudre",
  "product:res glace",
  "product:respiration aqua",
])

export function canonicalProductCategory(
  category: Doc<"products">["category"]
): ProductCategory {
  return category === "annexe" ? "potion" : category
}

export function isProductDeclaredCraftable(
  product: Pick<Doc<"products">, "category" | "craftable" | "tracksStock">
) {
  if (!product.tracksStock) return false
  if (product.craftable !== undefined) return product.craftable

  // Before craftability was generalized, only potions stored this field.
  return canonicalProductCategory(product.category) === "potion"
}

export function isLootOnlyLegacyProduct(legacyKey: string | undefined) {
  return legacyKey !== undefined && lootOnlyLegacyKeys.has(legacyKey)
}
