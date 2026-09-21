import { describe, expect, it } from "vitest"

import { isProductCraftable } from "./product-categories"

const trackedProduct = {
  category: "ingredient" as const,
  tracksStock: true,
}

describe("isProductCraftable", () => {
  it("conserve la compatibilité avec les anciennes potions", () => {
    expect(isProductCraftable({ category: "potion", tracksStock: true })).toBe(
      true
    )
  })

  it("reconnaît un ancien ingrédient comme fabricable lorsqu’il a une recette", () => {
    expect(isProductCraftable(trackedProduct, true)).toBe(true)
    expect(isProductCraftable(trackedProduct, false)).toBe(false)
  })

  it("respecte le mode d’obtention explicite indépendamment de la catégorie", () => {
    expect(isProductCraftable({ ...trackedProduct, craftable: true })).toBe(
      true
    )
    expect(
      isProductCraftable({ ...trackedProduct, craftable: false }, true)
    ).toBe(false)
    expect(
      isProductCraftable({
        category: "service",
        craftable: true,
        tracksStock: false,
      })
    ).toBe(false)
  })
})
