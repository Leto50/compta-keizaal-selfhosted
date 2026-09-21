import { describe, expect, it } from "vitest"

import { sortActorEntries, sortInventoryEntries } from "./table-sorting"

describe("sortInventoryEntries", () => {
  const entries = [
    {
      currentStock: 0,
      minimumStock: 0,
      name: "Service",
      tracksStock: false,
    },
    {
      currentStock: 2,
      minimumStock: 3,
      name: "Bière",
      salePrice: 4,
      tracksStock: true,
    },
    {
      currentStock: 12,
      minimumStock: 3,
      name: "Potion",
      salePrice: 8,
      tracksStock: true,
    },
  ]

  it("trie les valeurs numériques et garde les valeurs absentes à la fin", () => {
    expect(
      sortInventoryEntries(entries, "stock", "desc").map((entry) => entry.name)
    ).toEqual(["Potion", "Bière", "Service"])
    expect(
      sortInventoryEntries(entries, "price", "asc").map((entry) => entry.name)
    ).toEqual(["Bière", "Potion", "Service"])
  })

  it("place les stocks faibles en premier dans le tri d’état", () => {
    expect(
      sortInventoryEntries(entries, "status", "asc").map((entry) => entry.name)
    ).toEqual(["Bière", "Potion", "Service"])
    expect(
      sortInventoryEntries(entries, "status", "desc").map((entry) => entry.name)
    ).toEqual(["Potion", "Bière", "Service"])
  })
})

describe("sortActorEntries", () => {
  const actors = [
    {
      actorName: "Éloïse",
      incoming: 12,
      net: 4,
      outgoing: 8,
      salary: 3,
      transactionCount: 2,
    },
    {
      actorName: "Alix",
      incoming: 30,
      net: 25,
      outgoing: 5,
      salary: 7.5,
      transactionCount: 3,
    },
  ]

  it("trie les montants dans la direction demandée", () => {
    expect(
      sortActorEntries(actors, "incoming", "desc").map(
        (actor) => actor.actorName
      )
    ).toEqual(["Alix", "Éloïse"])
    expect(
      sortActorEntries(actors, "outgoing", "asc").map(
        (actor) => actor.actorName
      )
    ).toEqual(["Alix", "Éloïse"])
    expect(
      sortActorEntries(actors, "salary", "desc").map((actor) => actor.actorName)
    ).toEqual(["Alix", "Éloïse"])
  })
})
