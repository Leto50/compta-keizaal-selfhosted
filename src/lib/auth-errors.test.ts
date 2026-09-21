import { ConvexError } from "convex/values"
import { describe, expect, it } from "vitest"

import { isAuthenticationError } from "./auth-errors"

describe("isAuthenticationError", () => {
  it("reconnaît le code d’authentification Convex", () => {
    expect(
      isAuthenticationError(
        new ConvexError({
          code: "UNAUTHENTICATED",
          message: "Connexion requise",
        })
      )
    ).toBe(true)
  })

  it("ne confond pas une interdiction avec une session absente", () => {
    expect(
      isAuthenticationError(
        new ConvexError({ code: "FORBIDDEN", message: "Accès interdit" })
      )
    ).toBe(false)
  })

  it("reconnaît les erreurs sérialisées par le transport", () => {
    expect(isAuthenticationError(new Error("Unauthenticated request"))).toBe(
      true
    )
  })
})
