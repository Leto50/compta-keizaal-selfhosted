import { describe, expect, it } from "vitest"

import {
  canonicalRecipeFamily,
  getRecipeFamilies,
  isRecipeFamily,
  recipeFamilies,
} from "./recipe-families"

describe("catégories de recettes", () => {
  it.each([
    ["  RÉGÉNÉRATION   DE SANTÉ  ", "Régénération de santé"],
    ["FORCE", "Force"],
    ["re\u0301ge\u0301ne\u0301ration", "Régénération"],
    ["Resistance magie", "Résistance magique"],
    ["Soins", "Soin"],
  ])("normalise %s en %s", (input, expected) => {
    expect(canonicalRecipeFamily(input)).toBe(expected)
  })

  it.each(["", "  ", "---", "all", " ALL ", "x".repeat(101)])(
    "refuse la catégorie invalide %s",
    (input) => {
      expect(isRecipeFamily(input)).toBe(false)
      expect(canonicalRecipeFamily(input)).toBeUndefined()
    }
  )

  it("déduplique les variantes et conserve les catégories historiques", () => {
    const families = getRecipeFamilies([
      "Régénération",
      "regeneration",
      "Force",
      "FORCE",
      "Soins",
      "",
    ])
    expect(families).toEqual(
      [...recipeFamilies, "Force", "Régénération"].sort((left, right) =>
        left.localeCompare(right, "fr")
      )
    )
    expect(isRecipeFamily("x".repeat(100))).toBe(true)
  })
})
