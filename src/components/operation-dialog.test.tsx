// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { getFunctionName, type FunctionReference } from "convex/server"
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"

import { type Doc, type Id } from "../../convex/_generated/dataModel"
import { OperationDialog } from "./operation-dialog"

const mutations = vi.hoisted(() => ({
  recordExchange: vi.fn(),
  record: vi.fn(),
  updateExchange: vi.fn(),
  update: vi.fn(),
}))

vi.mock("convex/react", () => ({
  useMutation: (reference: FunctionReference<"mutation">) =>
    mutations[
      getFunctionName(reference).split(":")[1] as keyof typeof mutations
    ],
}))

const product: Doc<"products"> = {
  _id: "product-1" as Id<"products">,
  _creationTime: 0,
  active: true,
  category: "ingredient",
  currentStock: 10,
  minimumStock: 0,
  name: "Blé test",
  normalizedName: "ble test",
  purchasePrice: 3,
  salePrice: 7,
  tracksStock: true,
}
const character: Doc<"characters"> = {
  _id: "character-1" as Id<"characters">,
  _creationTime: 0,
  active: true,
  name: "Alice",
}
const originalScrollIntoView = Object.getOwnPropertyDescriptor(
  Element.prototype,
  "scrollIntoView"
)

beforeAll(() => {
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  })
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
    }
  )
})
beforeEach(() => {
  vi.clearAllMocks()
  mutations.recordExchange.mockResolvedValue(undefined)
})
afterEach(cleanup)
afterAll(() => {
  vi.unstubAllGlobals()
  if (originalScrollIntoView)
    Object.defineProperty(
      Element.prototype,
      "scrollIntoView",
      originalScrollIntoView
    )
  else Reflect.deleteProperty(Element.prototype, "scrollIntoView")
})

function start(initialKind: "sale" | "purchase" | "exchange" = "exchange") {
  const view = render(
    <OperationDialog
      characters={[character]}
      products={[product]}
      initialKind={initialKind}
    />
  )
  fireEvent.click(screen.getByRole("button", { name: "Nouvel échange" }))
  return view
}
async function add(direction: "outgoing" | "incoming") {
  fireEvent.click(
    screen.getByRole("combobox", {
      name:
        direction === "outgoing"
          ? "Ajouter un article à la vente"
          : "Ajouter un produit à l’achat",
    })
  )
  fireEvent.click(
    await screen.findByRole("option", { name: "Blé test10 en stock" })
  )
}
async function chooseCharacter() {
  fireEvent.keyDown(screen.getByRole("combobox", { name: "Personnage" }), {
    key: "ArrowDown",
  })
  fireEvent.click(await screen.findByRole("option", { name: "Alice" }))
}

// These tests exercise the submitted data and recovery, rather than CSS classes.
describe("enregistrement des achats et ventes", () => {
  it.each(["sale", "purchase"] as const)(
    "enregistre un %s avec sa quantité et son prix par lot",
    async (kind) => {
      start(kind)
      const direction = kind === "sale" ? "outgoing" : "incoming"
      await add(direction)
      fireEvent.change(screen.getByRole("spinbutton", { name: "Quantité" }), {
        target: { value: "3" },
      })
      fireEvent.change(
        screen.getByRole("spinbutton", { name: "Nombre de septims" }),
        { target: { value: "6" } }
      )
      fireEvent.change(
        screen.getByRole("spinbutton", {
          name: "Nombre d’unités couvertes par le prix",
        }),
        { target: { value: "2" } }
      )
      await chooseCharacter()
      fireEvent.click(
        screen.getByRole("button", {
          name: kind === "sale" ? "Encaisser 9 sept." : "Payer 9 sept.",
        })
      )
      await waitFor(() =>
        expect(mutations.recordExchange).toHaveBeenCalledTimes(1)
      )
      expect(mutations.recordExchange).toHaveBeenCalledWith(
        expect.objectContaining({
          characterId: character._id,
          lines: [
            {
              direction,
              kind: "product",
              productId: product._id,
              quantity: 3,
              unitPrice: 3,
            },
          ],
        })
      )
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    }
  )

  it("conserve les ventes quand on ajoute aussi un achat au même échange", async () => {
    start()
    await add("outgoing")
    fireEvent.click(screen.getByRole("button", { name: "Achat" }))
    await add("incoming")
    const incomingQuantity = screen.getAllByRole("spinbutton", {
      name: "Quantité",
    })[1]
    if (!incomingQuantity) throw new Error("La quantité de l’achat manque.")
    fireEvent.change(incomingQuantity, { target: { value: "2" } })
    await chooseCharacter()
    fireEvent.click(screen.getByRole("button", { name: "Encaisser 1 sept." }))
    await waitFor(() =>
      expect(mutations.recordExchange).toHaveBeenCalledTimes(1)
    )
    expect(mutations.recordExchange).toHaveBeenCalledWith(
      expect.objectContaining({
        lines: [
          {
            direction: "outgoing",
            kind: "product",
            productId: product._id,
            quantity: 1,
            unitPrice: 7,
          },
          {
            direction: "incoming",
            kind: "product",
            productId: product._id,
            quantity: 2,
            unitPrice: 3,
          },
        ],
      })
    )
  })

  it("ramène au champ invalide et conserve le panier pour permettre la correction", async () => {
    start()
    await add("outgoing")
    fireEvent.click(screen.getByRole("button", { name: "Encaisser 7 sept." }))
    const select = screen.getByRole("combobox", { name: "Personnage" })
    await waitFor(() => expect(document.activeElement).toBe(select))
    expect(mutations.recordExchange).not.toHaveBeenCalled()
    expect(screen.getByRole("spinbutton", { name: "Quantité" })).not.toBeNull()
    await chooseCharacter()
    fireEvent.click(screen.getByRole("button", { name: "Encaisser 7 sept." }))
    await waitFor(() =>
      expect(mutations.recordExchange).toHaveBeenCalledTimes(1)
    )
  })

  it("prépare un panier vide pour l’opération suivante en conservant le personnage", async () => {
    const view = start()
    await add("outgoing")
    await chooseCharacter()
    fireEvent.click(screen.getByRole("button", { name: "Encaisser 7 sept." }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    view.rerender(<OperationDialog characters={[]} products={[]} loading />)
    fireEvent.click(screen.getByRole("button", { name: "Nouvel échange" }))
    view.rerender(
      <OperationDialog characters={[character]} products={[product]} />
    )
    expect(
      screen.getByRole("combobox", { name: "Personnage" }).textContent
    ).toBe("Alice")
    expect(screen.queryByRole("spinbutton", { name: "Quantité" })).toBeNull()
    expect(
      screen.getByRole("button", { name: "Valider l’échange" })
    ).not.toBeNull()
  })

  it("ramène au panier d’achat sélectionné quand il manque un article", async () => {
    start("purchase")
    fireEvent.click(screen.getByRole("button", { name: "Valider l’échange" }))
    const picker = screen.getByRole("combobox", {
      name: "Ajouter un produit à l’achat",
    })
    await waitFor(() => expect(document.activeElement).toBe(picker))
    expect(mutations.recordExchange).not.toHaveBeenCalled()
    expect(screen.getByText("Ajoutez au moins une ligne.")).not.toBeNull()
  })

  it("permet de corriger une quantité invalide sans perdre le prix", async () => {
    start()
    await add("outgoing")
    await chooseCharacter()
    const quantity = screen.getByRole("spinbutton", { name: "Quantité" })
    fireEvent.change(quantity, { target: { value: "0" } })
    fireEvent.click(screen.getByRole("button", { name: "Valider l’échange" }))
    await waitFor(() => expect(document.activeElement).toBe(quantity))
    expect(mutations.recordExchange).not.toHaveBeenCalled()
    fireEvent.change(quantity, { target: { value: "2" } })
    fireEvent.click(screen.getByRole("button", { name: "Encaisser 14 sept." }))
    await waitFor(() =>
      expect(mutations.recordExchange).toHaveBeenCalledTimes(1)
    )
    expect(mutations.recordExchange).toHaveBeenCalledWith(
      expect.objectContaining({
        lines: [expect.objectContaining({ quantity: 2, unitPrice: 7 })],
      })
    )
  })

  it("signale le stock insuffisant et bloque la validation d’une vente", async () => {
    start()
    await add("outgoing")
    fireEvent.change(screen.getByRole("spinbutton", { name: "Quantité" }), {
      target: { value: "11" },
    })
    expect(screen.getByRole("alert").textContent).toContain("Stock insuffisant")
    const submit = screen.getByRole<HTMLButtonElement>("button", {
      name: "Encaisser 77 sept.",
    })
    expect(submit.disabled).toBe(true)
    fireEvent.click(submit)
    expect(mutations.recordExchange).not.toHaveBeenCalled()
  })
})
