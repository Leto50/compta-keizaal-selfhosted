import { describe, expect, it } from "vitest"

import {
  internalAccountEmail,
  isAccountIdentifier,
  normalizeAccountIdentifier,
} from "./account-identifiers"

describe("account identifiers", () => {
  it("normalise un identifiant RP sans collecter d’adresse réelle", () => {
    expect(normalizeAccountIdentifier("  Alixard-7  ")).toBe("alixard-7")
    expect(internalAccountEmail("Alixard-7")).toBe(
      "alixard-7@accounts.eauderoche.invalid"
    )
  })

  it.each(["ab", "éloane", "nom avec espace", "nom@domaine.fr"])(
    "refuse l’identifiant %s",
    (identifier) => {
      expect(isAccountIdentifier(identifier)).toBe(false)
    }
  )

  it.each(["alixard", "eloane_2", "garde.bleu", "joueur-7"])(
    "accepte l’identifiant %s",
    (identifier) => {
      expect(isAccountIdentifier(identifier)).toBe(true)
    }
  )
})
