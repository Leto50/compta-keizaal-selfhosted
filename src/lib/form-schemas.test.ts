import { describe, expect, it } from "vitest"

import {
  accountFormSchema,
  accountSettingsFormSchema,
  bundleFormSchema,
  operationFormSchema,
  passwordResetFormSchema,
  priceDraftSchema,
  productFormSchema,
  recipeFormSchema,
} from "./form-schemas"

describe("form schemas", () => {
  it("valide un compte uniquement avec un identifiant et un mot de passe corrects", () => {
    expect(
      accountFormSchema.safeParse({
        identifier: "identifiant invalide",
        name: " ",
        password: "court",
        role: "user",
      }).success
    ).toBe(false)
    expect(
      accountFormSchema.safeParse({
        identifier: "employe_rp",
        name: "Employé",
        password: "mot-de-passe-solide",
        role: "user",
      }).success
    ).toBe(true)

    const emptyIdentifier = accountFormSchema.safeParse({
      identifier: "",
      name: "Employé",
      password: "mot-de-passe-solide",
      role: "user",
    })
    expect(emptyIdentifier.success).toBe(false)
    if (!emptyIdentifier.success) {
      expect(
        emptyIdentifier.error.issues.filter(
          (issue) => issue.path[0] === "identifier"
        )
      ).toHaveLength(1)
    }
  })

  it("associe la confirmation du mot de passe à son champ", () => {
    const result = passwordResetFormSchema.safeParse({
      confirmation: "mot-de-passe-different",
      password: "mot-de-passe-solide",
    })

    expect(result.success).toBe(false)
    if (!result.success)
      expect(result.error.issues[0]?.path).toEqual(["confirmation"])
  })

  it("valide les taux comptables en pourcentage", () => {
    const settings = {
      cashBalance: "100",
      censusPerEmployee: "80",
      employeeCount: "2",
      fundsBalance: "200",
      salaryRatePercent: "25",
      taxRatePercent: "20",
      weeklyRent: "500",
    }

    expect(accountSettingsFormSchema.safeParse(settings).success).toBe(true)
    expect(
      accountSettingsFormSchema.safeParse({
        ...settings,
        salaryRatePercent: "100.1",
      }).success
    ).toBe(false)
  })

  it("refuse les rapports de prix incomplets ou hors limite", () => {
    expect(
      priceDraftSchema.safeParse({ septims: "5", units: "0" }).success
    ).toBe(false)
    expect(
      priceDraftSchema.safeParse({ septims: "1000000001", units: "1" }).success
    ).toBe(false)
    expect(
      priceDraftSchema.safeParse({ septims: "5", units: "2" }).success
    ).toBe(true)
  })

  it("place une erreur sur la ligne dupliquée d’un lot", () => {
    const result = bundleFormSchema.safeParse({
      items: [
        { key: 0, productId: "produit", quantity: "1" },
        { key: 1, productId: "produit", quantity: "2" },
      ],
      name: "Lot",
      price: { septims: "", units: "1" },
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.at(-1)?.path).toEqual([
        "items",
        1,
        "productId",
      ])
    }
  })

  it("interdit à une potion d’être son propre ingrédient", () => {
    const result = recipeFormSchema.safeParse({
      effect: "",
      family: "Soin",
      ingredients: [{ key: 0, productId: "potion", quantity: "1" }],
      name: "Potion",
      outputProductId: "potion",
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.at(-1)?.path).toEqual([
        "ingredients",
        0,
        "productId",
      ])
    }
  })

  it("applique les règles propres au mode de production", () => {
    const result = operationFormSchema.safeParse({
      agreedTotal: "",
      characterId: "personnage",
      comment: "",
      counterparty: "",
      discount: "",
      linkedOrderMode: false,
      occurredOn: "2020-01-01",
      productId: "",
      productionMode: true,
      quantity: "0",
      tradeLines: [],
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path.at(-1))).toEqual(
        expect.arrayContaining(["productId", "quantity"])
      )
    }
  })

  it("ignore les champs de stock masqués d’un service", () => {
    const base = {
      category: "service" as const,
      craftable: false,
      minimumStock: "valeur masquée",
      name: "Conseil alchimique",
      purchasePrice: { septims: "", units: "1" },
      salePrice: { septims: "10", units: "1" },
      targetStock: "valeur masquée",
    }
    expect(productFormSchema.safeParse(base).success).toBe(true)
  })

  it("exige explicitement le total d’une commande déjà liée", () => {
    const result = operationFormSchema.safeParse({
      agreedTotal: "",
      characterId: "personnage",
      comment: "",
      counterparty: "",
      discount: "",
      linkedOrderMode: true,
      occurredOn: "2020-01-01",
      productId: "",
      productionMode: false,
      quantity: "1",
      tradeLines: [
        {
          direction: "outgoing",
          id: "produit",
          kind: "product",
          name: "Potion",
          quantity: "1",
          unitPrice: { septims: "10", units: "1" },
        },
      ],
    })

    expect(result.success).toBe(false)
    if (!result.success)
      expect(result.error.issues[0]?.path).toEqual(["agreedTotal"])
  })
})
