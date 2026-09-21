import { describe, expect, it } from "vitest"

import { normalizeCatalogName, normalizeName } from "./text"

describe("normalizeName", () => {
  it("ignore les accents, la casse, les apostrophes et les espaces", () => {
    expect(normalizeName("  Bière d’Été  ")).toBe("biere d ete")
    expect(normalizeName("biere d'ete")).toBe("biere d ete")
    expect(normalizeName("Œil de chimère")).toBe("oeil de chimere")
  })
})

describe("normalizeCatalogName", () => {
  it("uniformise les espaces et applique une casse de phrase", () => {
    expect(normalizeCatalogName("  POTION   DE\nSOIN  ")).toBe("Potion de soin")
    expect(normalizeCatalogName("potion de VIGUEUR")).toBe("Potion de vigueur")
  })

  it("conserve les accents saisis", () => {
    expect(normalizeCatalogName(" bière ")).toBe("Bière")
    expect(normalizeCatalogName(" biere ")).toBe("Biere")
  })
})
