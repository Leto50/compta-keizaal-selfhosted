// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest"

import { type Id } from "../../convex/_generated/dataModel"
import { ProductPicker } from "./product-picker"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./ui/dialog"

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

afterEach(cleanup)

afterAll(() => {
  vi.unstubAllGlobals()
  if (originalScrollIntoView) {
    Object.defineProperty(
      Element.prototype,
      "scrollIntoView",
      originalScrollIntoView
    )
  } else {
    Reflect.deleteProperty(Element.prototype, "scrollIntoView")
  }
})

describe("ProductPicker inside a dialog", () => {
  it.each(["wheel", "touchmove"] as const)(
    "allows %s in the product list while keeping the background locked",
    async (eventType) => {
      render(
        <Dialog defaultOpen>
          <DialogContent>
            <DialogTitle>Ajouter un produit</DialogTitle>
            <DialogDescription>Choisissez un produit.</DialogDescription>
            <ProductPicker
              ariaLabel="Produit"
              onChange={vi.fn()}
              products={Array.from({ length: 30 }, (_, index) => ({
                _id: `product-${index}` as Id<"products">,
                name: `Produit ${index}`,
              }))}
            />
          </DialogContent>
        </Dialog>
      )

      fireEvent.click(screen.getByRole("combobox", { name: "Produit" }))
      const list = await screen.findByRole("listbox")
      list.style.overflowY = "auto"
      Object.defineProperties(list, {
        clientHeight: { value: 200 },
        scrollHeight: { value: 1200 },
      })
      list.scrollTop = 100
      const option = screen.getByRole("option", { name: "Produit 0" })

      if (eventType === "wheel") {
        expect(fireEvent.wheel(option, { deltaY: 120 })).toBe(true)
        expect(fireEvent.wheel(document.body, { deltaY: 120 })).toBe(false)
        list.scrollTop = 1000
        expect(fireEvent.wheel(option, { deltaY: 150 })).toBe(false)
      } else {
        const start = [{ clientX: 100, clientY: 150 }]
        const end = [{ clientX: 100, clientY: 100 }]
        fireEvent.touchStart(option, { touches: start, changedTouches: start })
        expect(
          fireEvent.touchMove(option, { touches: end, changedTouches: end })
        ).toBe(true)
        expect(
          fireEvent.touchMove(document.body, {
            touches: end,
            changedTouches: end,
          })
        ).toBe(false)
      }
    }
  )
})
