// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react"
import { type ComponentType } from "react"
import type * as ReactRouter from "@tanstack/react-router"
import { getFunctionName, type FunctionReference } from "convex/server"
import {
  afterEach,
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"
import { Route } from "@/routes/_app/statistiques"
import { useStatistics } from "@/hooks/use-statistics"
import { statisticsCsv } from "@/lib/statistics-export"
import {
  emptyStatisticsDay,
  type StatisticsBatch,
  type StatisticsOrderGroup,
} from "../../shared/statistics"

const state = vi.hoisted(() => ({
  writer: true,
  prices: true,
  sections: ["statistics", "transactions", "account", "orders", "harvests"],
  status: "Exhausted",
  batches: [] as StatisticsBatch[],
  previousBatches: [] as StatisticsBatch[],
  previousStatus: "Exhausted",
  orders: [] as StatisticsOrderGroup[],
  queries: [] as { name: string; args: unknown }[],
  loadMore: vi.fn(),
}))

vi.mock("@/hooks/use-permissions", () => ({
  usePermissions: () => ({
    canWrite: state.writer,
    showPrices: state.prices,
    showPurchasePrices: state.prices,
    isPending: false,
    canRead: (section: string) => state.sections.includes(section),
  }),
}))
vi.mock("convex/react", () => ({
  usePaginatedQuery: (reference: FunctionReference<"query">, args: unknown) => {
    const name = getFunctionName(reference)
    state.queries.push({ name, args })
    const isPrevious =
      name === "statistics:transactionsPage" &&
      args !== "skip" &&
      typeof args === "object" &&
      args !== null &&
      "to" in args &&
      typeof args.to === "number" &&
      args.to <= new Date().setUTCHours(0, 0, 0, 0)
    return {
      results:
        name === "statistics:transactionsPage" && args !== "skip"
          ? isPrevious
            ? state.previousBatches
            : state.batches
          : name === "statistics:ordersPage" && args !== "skip"
            ? state.orders
            : [],
      status:
        args === "skip"
          ? "LoadingFirstPage"
          : isPrevious
            ? state.previousStatus
            : state.status,
      loadMore: state.loadMore,
    }
  },
}))
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof ReactRouter>()),
  createFileRoute: () => (options: unknown) => ({ options }),
}))

const Page = Route.options.component as ComponentType

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-10-17T12:00:00Z"))
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  )
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
    }
  )
  Element.prototype.scrollIntoView = vi.fn()
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return this.id === "recharts_measurement_span"
        ? new DOMRect(0, 0, (this.textContent?.length ?? 0) * 7, 14)
        : new DOMRect(0, 0, 640, 320)
    }
  )
  Element.prototype.hasPointerCapture = vi.fn(() => false)
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
})
beforeEach(() => {
  state.writer = true
  state.prices = true
  state.sections = [
    "statistics",
    "transactions",
    "account",
    "orders",
    "harvests",
  ]
  state.status = "Exhausted"
  state.previousStatus = "Exhausted"
  state.previousBatches = []
  state.queries = []
  state.loadMore.mockClear()
  state.orders = []
  state.batches = [
    {
      days: [
        {
          ...emptyStatisticsDay(Date.UTC(2026, 9, 1)),
          incoming: 120,
          outgoing: 30,
          financialCount: 2,
          transactionCount: 3,
          harvestCount: 1,
          harvestQuantity: 4,
          harvestLineCount: 1,
          knownValue: 8,
        },
      ],
      products: [
        {
          key: "wheat",
          name: "Blé",
          sold: 10,
          purchased: 2,
          harvested: 4,
          produced: 0,
          incoming: 120,
          outgoing: 30,
        },
      ],
      kinds: [
        { kind: "exchange", count: 2 },
        { kind: "harvest", count: 1 },
      ],
    },
  ]
})
afterEach(cleanup)
afterAll(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("Statistiques de la boutique", () => {
  it("affiche les agrégats et les graphiques sans suivi individuel", () => {
    render(<Page />)
    expect(screen.getByRole("heading", { name: "Statistiques" })).not.toBeNull()
    expect(
      screen.getByRole("figure", { name: "Évolution des entrées et sorties" })
    ).not.toBeNull()
    expect(screen.queryByRole("figure", { name: "Solde cumulé" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Cumul" }))
    expect(screen.getByRole("figure", { name: "Solde cumulé" })).not.toBeNull()
    expect(
      screen.queryByRole("figure", { name: "Évolution des entrées et sorties" })
    ).toBeNull()
    expect(screen.getAllByRole("application").length).toBeGreaterThan(0)
    expect(document.body.textContent).not.toMatch(
      /personnage|employé|compte privé/i
    )
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Exporter en CSV" })
        .disabled
    ).toBe(false)
  })

  it("retire les bornes pour consulter tout l’historique", () => {
    render(<Page />)
    fireEvent.click(screen.getByRole("combobox", { name: "Période" }))
    fireEvent.click(screen.getByRole("option", { name: "Tout l’historique" }))
    const query = state.queries
      .filter((entry) => entry.name === "statistics:transactionsPage")
      .filter((entry) => entry.args !== "skip")
      .at(-1)
    expect(query?.args).toEqual({ from: undefined, to: undefined })
    expect(
      state.queries
        .filter((entry) => entry.name === "statistics:ordersPage")
        .at(-1)?.args
    ).toBe("skip")
  })

  it("compare les indicateurs avec une période précédente de même durée", () => {
    state.previousBatches = [
      {
        days: [
          {
            ...emptyStatisticsDay(Date.UTC(2026, 5, 1)),
            incoming: 60,
            outgoing: 15,
            transactionCount: 1,
          },
        ],
        products: [],
        kinds: [],
      },
    ]
    render(<Page />)
    expect(screen.getByText(/\+60 sept\. \(\+100 %\)/)).not.toBeNull()
    const queries = state.queries.filter(
      (entry) => entry.name === "statistics:transactionsPage"
    )
    const current = queries[0]?.args as { from: number; to: number }
    const previous = queries[1]?.args as { from: number; to: number }
    expect(previous.to).toBe(current.from)
    expect(previous.to - previous.from).toBe(current.to - current.from)
    expect(
      screen.getByRole("figure", { name: "Répartition des opérations" })
    ).not.toBeNull()
    expect(screen.getAllByRole("application")).toHaveLength(2)
  })

  it("attend toutes les pages précédentes avant d’afficher une variation", () => {
    state.previousStatus = "CanLoadMore"
    render(<Page />)
    expect(state.loadMore).toHaveBeenCalledWith(40)
    expect(
      screen.getByText(/Chargement de la période précédente/)
    ).not.toBeNull()
    expect(screen.queryByText(/vs période précédente/)).toBeNull()
  })

  it("conserve la part réelle de la période après recherche et change d’indicateur", () => {
    state.batches[0]!.products.push({
      key: "barley",
      name: "Orge",
      sold: 30,
      purchased: 0,
      harvested: 0,
      produced: 0,
      incoming: 0,
      outgoing: 0,
    })
    render(<Page />)
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Produits & lots" }), {
      button: 0,
      ctrlKey: false,
    })
    expect(
      screen.getByRole("figure", { name: "Classement des produits et lots" })
    ).not.toBeNull()
    expect(screen.getByRole("cell", { name: "25 %" })).not.toBeNull()
    fireEvent.change(
      screen.getByRole("textbox", { name: "Rechercher un produit ou un lot" }),
      { target: { value: "Blé" } }
    )
    expect(screen.queryByRole("cell", { name: "Orge" })).toBeNull()
    expect(screen.getByRole("cell", { name: "25 %" })).not.toBeNull()
    fireEvent.click(screen.getByRole("combobox", { name: "Classer par" }))
    fireEvent.click(
      screen.getByRole("option", { name: "Encaissements ventilés" })
    )
    expect(screen.getByRole("cell", { name: "120 sept." })).not.toBeNull()
  })

  it("continue le chargement et empêche l’export de totaux provisoires", () => {
    state.status = "CanLoadMore"
    render(<Page />)
    expect(state.loadMore).toHaveBeenCalledWith(40)
    expect(screen.getByRole("status").textContent).toContain(
      "résultats provisoires"
    )
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Exporter en CSV" })
        .disabled
    ).toBe(true)
  })

  it("masque les montants et les rubriques non autorisées", () => {
    state.writer = false
    state.prices = false
    state.sections = ["statistics", "transactions"]
    render(<Page />)
    expect(
      screen.queryByRole("figure", { name: "Évolution des entrées et sorties" })
    ).toBeNull()
    expect(screen.queryByRole("tab", { name: "Récoltes" })).toBeNull()
    expect(screen.queryByRole("tab", { name: "Commandes" })).toBeNull()
    expect(
      state.queries.find((entry) => entry.name === "statistics:ordersPage")
        ?.args
    ).toBe("skip")
    expect(document.body.textContent).not.toContain("120 sept.")
  })

  it("permet de consulter les références et les volumes de récolte", () => {
    render(<Page />)
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Produits & lots" }), {
      button: 0,
      ctrlKey: false,
    })
    expect(screen.getAllByText("Blé").length).toBeGreaterThan(0)
    fireEvent.change(
      screen.getByRole("textbox", { name: "Rechercher un produit ou un lot" }),
      { target: { value: "introuvable" } }
    )
    expect(screen.queryByRole("cell", { name: "Blé" })).toBeNull()
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Récoltes" }), {
      button: 0,
      ctrlKey: false,
    })
    expect(
      screen.getByRole("figure", { name: "Unités récoltées" })
    ).not.toBeNull()
  })

  it("sépare les commandes comptabilisées de leur situation actuelle", () => {
    state.batches[0]!.days[0]!.orderCount = 1
    state.orders = [
      {
        kind: "client",
        state: "unsettled",
        count: 1,
        pendingCount: 1,
        overdueCount: 1,
        total: 75,
        unpricedCount: 0,
      },
    ]
    render(<Page />)
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Commandes" }), {
      button: 0,
      ctrlKey: false,
    })
    expect(
      screen.getByRole("heading", { name: "Situation actuelle des commandes" })
    ).not.toBeNull()
    expect(screen.queryByRole("combobox", { name: "Période" })).toBeNull()
    expect(
      state.queries
        .filter((entry) => entry.name === "statistics:transactionsPage")
        .at(-1)?.args
    ).toBe("skip")

    expect(screen.getAllByText("Livrées, à encaisser").length).toBeGreaterThan(
      0
    )
    expect(
      screen.getByText(/indépendamment de la période d’activité/)
    ).not.toBeNull()
    expect(
      screen.getAllByText(/Montant prévu à encaisser/).length
    ).toBeGreaterThan(0)
    expect(screen.queryByText(/commandes créées sur la période/i)).toBeNull()
  })

  it("signale les flux historiques et les ventilations incomplets", () => {
    state.batches[0]!.days[0]!.incompleteFlowCount = 1
    state.batches[0]!.days[0]!.unattributedCount = 1
    state.batches[0]!.days[0]!.unattributedIncoming = 45
    render(<Page />)
    expect(screen.getByText("Flux historiques incomplets")).not.toBeNull()
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Produits & lots" }), {
      button: 0,
      ctrlKey: false,
    })
    expect(
      screen.getByText("Ventilation partielle des références")
    ).not.toBeNull()
    expect(screen.getByText(/45 sept\. en entrées/)).not.toBeNull()
  })

  it("réutilise l’affichage des récoltes pour distinguer absence de prix et valeur nulle", () => {
    state.batches[0]!.days[0]!.knownValue = 0
    state.batches[0]!.days[0]!.unpricedLineCount = 1
    render(<Page />)
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Récoltes" }), {
      button: 0,
      ctrlKey: false,
    })
    expect(screen.getByText("Non renseignée")).not.toBeNull()
    expect(screen.getByText(/Estimation incomplète/)).not.toBeNull()
  })

  it("n’affiche pas de faux zéros ni de graphiques au premier chargement", () => {
    state.status = "LoadingFirstPage"
    state.batches = []
    render(<Page />)
    expect(screen.getByRole("status").textContent).toBe(
      "Chargement des données…"
    )
    expect(screen.queryAllByRole("definition")).toHaveLength(0)
    expect(screen.queryAllByRole("application")).toHaveLength(0)
    expect(screen.queryByText("Aucune donnée sur cette période")).toBeNull()
  })

  it("présente une action utile pour une période vide", () => {
    state.batches = []
    render(<Page />)
    expect(
      screen.getByRole("heading", { name: "Aucune donnée sur cette période" })
    ).not.toBeNull()
    expect(screen.queryAllByRole("definition")).toHaveLength(0)
    fireEvent.click(
      screen.getByRole("button", { name: "Voir tout l’historique" })
    )
    expect(
      state.queries
        .filter(
          (q) => q.name === "statistics:transactionsPage" && q.args !== "skip"
        )
        .at(-1)?.args
    ).toEqual({ from: undefined, to: undefined })
  })

  it("ne charge aucun historique pour un accès limité aux commandes", () => {
    state.writer = false
    state.sections = ["statistics", "orders"]
    render(<Page />)
    expect(screen.getAllByRole("tab")).toHaveLength(1)
    expect(screen.queryByRole("combobox", { name: "Période" })).toBeNull()
    expect(
      state.queries
        .filter((q) => q.name === "statistics:transactionsPage")
        .every((q) => q.args === "skip")
    ).toBe(true)
    expect(
      state.queries.find((q) => q.name === "statistics:ordersPage")?.args
    ).toEqual({ todayStartsAt: new Date().setUTCHours(0, 0, 0, 0) })
  })

  it("explique un accès statistique sans rubrique source et ne lance aucune lecture", () => {
    state.writer = false
    state.sections = ["statistics"]
    render(<Page />)
    expect(
      screen.getByRole("heading", { name: "Aucune activité consultable" })
    ).not.toBeNull()
    expect(screen.queryAllByRole("tab")).toHaveLength(0)
    expect(state.queries.every((q) => q.args === "skip")).toBe(true)
  })

  it("cesse de consulter un onglet lorsque ses droits sont retirés", () => {
    state.writer = false
    const page = render(<Page />)
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Commandes" }), {
      button: 0,
      ctrlKey: false,
    })
    state.sections = ["statistics", "transactions"]
    page.rerender(<Page />)
    expect(screen.queryByRole("tab", { name: "Commandes" })).toBeNull()
    expect(
      screen
        .getByRole("tab", { name: "Activité" })
        .getAttribute("aria-selected")
    ).toBe("true")
    expect(
      state.queries.filter((q) => q.name === "statistics:ordersPage").at(-1)
        ?.args
    ).toBe("skip")
  })

  it("distingue une recherche vide et permet de la réinitialiser", () => {
    render(<Page />)
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Produits & lots" }), {
      button: 0,
      ctrlKey: false,
    })
    fireEvent.change(
      screen.getByRole("textbox", { name: "Rechercher un produit ou un lot" }),
      { target: { value: "absent" } }
    )
    expect(
      screen.getByRole("heading", { name: "Aucune référence trouvée" })
    ).not.toBeNull()
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Exporter en CSV" })
        .disabled
    ).toBe(true)
    fireEvent.click(
      screen.getByRole("button", { name: "Effacer la recherche" })
    )
    expect(screen.getByRole("cell", { name: "Blé" })).not.toBeNull()
  })

  it("protège les cellules CSV contre les formules et conserve les décimales françaises", () => {
    state.batches[0]!.products[0]!.name = '  =HYPERLINK("test")'
    state.batches[0]!.products[0]!.sold = 1.5
    const { result } = renderHook(() => useStatistics())
    const csv = statisticsCsv({ ...result.current, tab: "products" })
    expect(csv.startsWith("\uFEFF")).toBe(true)
    expect(csv).toContain('"\'  =HYPERLINK(""test"")";"1,5";"100"')
    expect(csv).not.toContain('"  =HYPERLINK')
  })

  it("exclut les montants masqués des exports et sépare l’export des commandes", () => {
    state.writer = false
    state.prices = false
    const { result } = renderHook(() => useStatistics())
    const activityCsv = statisticsCsv(result.current)
    expect(activityCsv).not.toMatch(
      /septims|Entrées \(|Sorties \(|Solde des mouvements/
    )
    const ordersCsv = statisticsCsv({ ...result.current, tab: "orders" })
    expect(ordersCsv).toContain("Situation actuelle des commandes")
    expect(ordersCsv).not.toMatch(
      /Montant prévu|Période précédente|Date \(UTC\)/
    )
  })
})
