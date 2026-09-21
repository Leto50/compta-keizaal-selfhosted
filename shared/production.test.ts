import { describe, expect, it } from "vitest"

import { calculateProductionPlan } from "./production"

const recipe = {
  ingredients: [
    { ingredientName: "Blé", productId: "wheat", quantity: 2 },
    { ingredientName: "Lys bleu", productId: "flower", quantity: 3 },
  ],
}

describe("calculateProductionPlan", () => {
  it("calcule les besoins et la quantité maximale fabricable", () => {
    const plan = calculateProductionPlan(
      recipe,
      [
        { _id: "wheat", currentStock: 9 },
        { _id: "flower", currentStock: 7 },
      ],
      2
    )

    expect(plan).toMatchObject({
      canProduce: true,
      complete: true,
      maximumQuantity: 2,
    })
    expect(plan.requirements).toEqual([
      {
        available: 9,
        ingredientName: "Blé",
        productId: "wheat",
        required: 4,
        requiredPerUnit: 2,
      },
      {
        available: 7,
        ingredientName: "Lys bleu",
        productId: "flower",
        required: 6,
        requiredPerUnit: 3,
      },
    ])
  })

  it("signale une quantité trop élevée ou une référence manquante", () => {
    expect(
      calculateProductionPlan(
        recipe,
        [
          { _id: "wheat", currentStock: 9 },
          { _id: "flower", currentStock: 7 },
        ],
        3
      ).canProduce
    ).toBe(false)
    expect(
      calculateProductionPlan(recipe, [{ _id: "wheat", currentStock: 9 }], 1)
    ).toMatchObject({ canProduce: false, complete: false, maximumQuantity: 0 })
  })
})
