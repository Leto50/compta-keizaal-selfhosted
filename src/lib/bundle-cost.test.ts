import { describe, expect, it } from "vitest"

import { calculateBundleCost } from "./bundle-cost"

describe("calculateBundleCost", () => {
  it("privilégie le coût de recette et additionne les quantités", () => {
    expect(
      calculateBundleCost(
        [
          { productId: "potion", quantity: 2 },
          { productId: "fiole", quantity: 3 },
        ],
        [
          { _id: "potion", purchasePrice: 20 },
          { _id: "fiole", purchasePrice: 1 },
        ],
        [{ cost: 4, productId: "potion" }]
      )
    ).toBe(11)
  })

  it("signale un coût incomplet si un composant n’est pas valorisé", () => {
    expect(
      calculateBundleCost([{ productId: "inconnu", quantity: 1 }], [], [])
    ).toBeUndefined()
  })
})
