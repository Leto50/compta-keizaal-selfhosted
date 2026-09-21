import { ConvexError } from "convex/values"
import { describe, expect, it } from "vitest"

import { getUserFacingErrorMessage } from "./errors"

describe("getUserFacingErrorMessage", () => {
  it("affiche uniquement le message métier d’une erreur Convex structurée", () => {
    const error = new ConvexError({
      code: "ALREADY_EXISTS",
      message: "Une recette nommée « Bière » existe déjà.",
    })

    expect(getUserFacingErrorMessage(error, "Échec.")).toBe(
      "Une recette nommée « Bière » existe déjà."
    )
  })

  it("accepte les erreurs Convex contenant directement un message", () => {
    expect(
      getUserFacingErrorMessage(
        new ConvexError("La référence est indisponible."),
        "Échec."
      )
    ).toBe("La référence est indisponible.")
  })

  it("masque les erreurs techniques derrière le message prévu par l’écran", () => {
    const error = new Error(
      "[CONVEX M(recipes:save)] Server Error Uncaught ConvexError"
    )

    expect(
      getUserFacingErrorMessage(error, "Impossible d’enregistrer la recette.")
    ).toBe("Impossible d’enregistrer la recette.")
  })
})
