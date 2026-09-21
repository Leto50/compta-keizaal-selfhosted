import { describe, expect, it } from "vitest"

import {
  formatDecimalSeptims,
  formatOrderStatus,
  formatQuantity,
  formatSeptims,
  formatUnitPrice,
} from "./format"

describe("formatOrderStatus", () => {
  it("adapte le vocabulaire au sens de la commande", () => {
    expect(formatOrderStatus("open", "client")).toBe("À préparer")
    expect(formatOrderStatus("delivered", "client")).toBe("Livrée")
    expect(formatOrderStatus("open", "supplier")).toBe("À recevoir")
    expect(formatOrderStatus("ready", "supplier")).toBe("À recevoir")
    expect(formatOrderStatus("delivered", "supplier")).toBe("Reçue")
  })
})

describe("formatQuantity", () => {
  it("accorde unité au singulier", () => {
    expect(formatQuantity(1)).toBe("1 unité")
    expect(formatQuantity(-1)).toBe("-1 unité")
  })

  it("accorde unités au pluriel", () => {
    expect(formatQuantity(0)).toBe("0 unités")
    expect(formatQuantity(2)).toBe("2 unités")
  })
})

describe("formatSeptims", () => {
  it("affiche les montants non entiers comme de vraies fractions", () => {
    expect(formatSeptims(1 / 3)).toBe("1/3 sept.")
    expect(formatSeptims(3.5)).toBe("3 1/2 sept.")
    expect(formatSeptims(1_234.5)).toBe("1 234 1/2 sept.")
    expect(formatSeptims(-0.25)).toBe("−1/4 sept.")
  })
})

describe("formatDecimalSeptims", () => {
  it("affiche les valeurs calculées en décimal plutôt qu’en fraction", () => {
    expect(formatDecimalSeptims(1 / 3)).toBe("0,33 sept.")
    expect(formatDecimalSeptims(1_234.5)).toBe("1 234,5 sept.")
    expect(formatDecimalSeptims(-0.25)).toBe("−0,25 sept.")
  })
})

describe("formatUnitPrice", () => {
  it("exprime un tarif fractionnaire en septims pour plusieurs unités", () => {
    expect(formatUnitPrice(1 / 4)).toBe("1 septim pour 4")
    expect(formatUnitPrice(1 / 3)).toBe("1 septim pour 3")
    expect(formatUnitPrice(1.5)).toBe("3 septims pour 2")
  })

  it("exprime un tarif entier à l’unité", () => {
    expect(formatUnitPrice(1)).toBe("1 septim l’unité")
    expect(formatUnitPrice(12)).toBe("12 septims l’unité")
  })
})
