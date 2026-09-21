import { describe, expect, it } from "vitest"

import { calculateOrderPreparation } from "./order-preparation"

describe("calculateOrderPreparation", () => {
  it("agrège les ingrédients et le coût matière de plusieurs potions", () => {
    const result = calculateOrderPreparation(
      [
        { productId: "minor", productName: "Soin mineur", quantity: 2 },
        { productId: "major", productName: "Soin moyen", quantity: 3 },
      ],
      [
        { _id: "minor", category: "potion", name: "Soin mineur" },
        { _id: "major", category: "potion", name: "Soin moyen" },
      ],
      [
        {
          cost: 5,
          ingredients: [
            { ingredientName: "Blé", productId: "wheat", quantity: 7 },
            { ingredientName: "Lys bleu", productId: "flower", quantity: 15 },
          ],
          productId: "minor",
        },
        {
          cost: 6.5,
          ingredients: [
            { ingredientName: "Blé", productId: "wheat", quantity: 7 },
            { ingredientName: "Lys bleu", productId: "flower", quantity: 10 },
          ],
          productId: "major",
        },
      ]
    )

    expect(result).toEqual({
      ingredients: [
        { ingredientName: "Blé", productId: "wheat", quantity: 35 },
        { ingredientName: "Lys bleu", productId: "flower", quantity: 60 },
      ],
      missingCostReferences: [],
      missingRecipeReferences: [],
      productionCost: 29.5,
      referenceCount: 2,
    })
  })

  it("signale une potion sans recette sans inventer un coût", () => {
    const result = calculateOrderPreparation(
      [{ productId: "beer", productName: "Bière", quantity: 12 }],
      [{ _id: "beer", category: "potion", name: "Bière" }],
      []
    )

    expect(result).toEqual({
      ingredients: [],
      missingCostReferences: ["Bière"],
      missingRecipeReferences: ["Bière"],
      referenceCount: 1,
    })
  })
})
