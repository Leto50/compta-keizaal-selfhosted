import { describe, expect, it } from "vitest"

import { bundleMatchesSearch, recipeMatchesSearch } from "./recipe-catalog"

describe("recipeMatchesSearch", () => {
  const recipe = {
    effect: "Régénération durable",
    ingredients: [{ ingredientName: "Ail" }, { ingredientName: "Sucrelune" }],
    name: "Breuvage de puissance",
  }

  it("cherche dans le nom, l’effet et les ingrédients", () => {
    expect(recipeMatchesSearch(recipe, "breuvage")).toBe(true)
    expect(recipeMatchesSearch(recipe, "regeneration")).toBe(true)
    expect(recipeMatchesSearch(recipe, "ail")).toBe(true)
    expect(recipeMatchesSearch(recipe, "lys bleu")).toBe(false)
    expect(
      recipeMatchesSearch(
        {
          ingredients: [{ ingredientName: "Pholiote à écaille" }],
          name: "Potion de récupération",
        },
        "ail"
      )
    ).toBe(false)
  })
})

describe("bundleMatchesSearch", () => {
  const bundle = {
    items: [{ productName: "Soin mineur" }, { productName: "Médicinale" }],
    name: "L’aventurier en herbe",
  }

  it("cherche dans le nom et la composition du lot", () => {
    expect(bundleMatchesSearch(bundle, "aventurier")).toBe(true)
    expect(bundleMatchesSearch(bundle, "medicinale")).toBe(true)
    expect(bundleMatchesSearch(bundle, "berserker")).toBe(false)
  })
})
