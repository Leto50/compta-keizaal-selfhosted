// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import { getFunctionName, type FunctionReference } from "convex/server"
import { type ComponentType, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import type * as ReactQuery from "@tanstack/react-query"
import { QueryClient } from "@tanstack/react-query"
import { convexQuery } from "@convex-dev/react-query"
import type * as ReactRouter from "@tanstack/react-router"
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

import { api } from "../convex/_generated/api"
import { type Doc } from "../convex/_generated/dataModel"
import { asAuthenticatedUser, createTestBackend } from "../convex/test.helpers"
import { AppShell } from "./components/app-shell"
import { SiteMetadata } from "./components/site-metadata"
import { TooltipProvider } from "./components/ui/tooltip"
import { Route as DashboardRoute } from "./routes/_app/index"
import { Route as InventoryRoute } from "./routes/_app/inventaire"
import { Route as JournalRoute } from "./routes/_app/journal"
import { Route as OrdersRoute } from "./routes/_app/commandes"
import { Route as RecipesRoute } from "./routes/_app/recettes"
import { Route as AccountRoute } from "./routes/_app/compte"
import { Route as AdministrationRoute } from "./routes/_app/administration"
import { Route as CharactersRoute } from "./routes/_app/personnages"
import { Route as AuthenticationRoute } from "./routes/connexion"
import { DEFAULT_SITE_NAME } from "../shared/site-name"
import { defaultReaderAccess, type ReaderAccess } from "../shared/reader-access"
import { AccountAccessDialog } from "./components/account-access-dialog"

const state = vi.hoisted<{
  data: Map<string, unknown>
  mutations: Map<string, ReturnType<typeof vi.fn>>
  pathname: string
  role: string | undefined
  access: ReaderAccess | undefined
  search: Record<string, unknown>
}>(() => ({
  data: new Map<string, unknown>(),
  mutations: new Map<string, ReturnType<typeof vi.fn>>(),
  pathname: "/inventaire",
  role: "reader",
  access: undefined,
  search: {},
}))

const originalFonts = Object.getOwnPropertyDescriptor(document, "fonts")

vi.mock("convex/react", () => ({
  useMutation: (reference: FunctionReference<"mutation">) => {
    const name = getFunctionName(reference)
    if (!state.mutations.has(name)) state.mutations.set(name, vi.fn())
    return state.mutations.get(name)
  },
  useQuery: (reference: FunctionReference<"query">, args?: unknown) => {
    if (args === "skip") return undefined
    const name = getFunctionName(reference)
    if (name === "auth:getCurrentUser") {
      return state.role
        ? { role: state.role, readerAccess: state.access }
        : undefined
    }
    return state.data.get(name)
  },
}))

vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof ReactQuery>()),
  useSuspenseQuery: ({ queryKey }: { queryKey: [string, string] }) => ({
    data: state.data.get(queryKey[1]),
  }),
}))

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof ReactRouter>()),
  createFileRoute: () => (options: unknown) => ({
    options,
    useLoaderData: () => ({ queryArgs: {} }),
    useNavigate: () => vi.fn(),
    useSearch: () => state.search,
  }),
  Link: ({
    to,
    children,
    search: _search,
    ...props
  }: {
    to: string
    children: ReactNode
    search?: unknown
  }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useRouterState: () => state.pathname,
}))

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({
      data: { user: { id: "reader", name: "Lecteur test", role: state.role } },
      isPending: false,
    }),
  },
}))

beforeAll(async () => {
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: new EventTarget(),
  })
  const backend = createTestBackend()
  const employee = await asAuthenticatedUser(backend)
  const reader = await asAuthenticatedUser(backend, "reader")
  const productId = await employee.mutation(api.products.save, {
    active: true,
    category: "ingredient",
    minimumStock: 0,
    name: "Blé test",
    purchasePrice: 1,
    salePrice: 2,
    targetStock: 10,
  })
  await employee.mutation(api.recipes.save, {
    effect: "Restaure la santé",
    family: "Utilitaire",
    ingredients: [{ productId, quantity: 1 }],
    name: "Soin test",
  })
  await employee.mutation(api.bundles.save, {
    items: [{ productId, quantity: 2 }],
    name: "Lot test",
    price: 4,
  })
  await backend.run(async (ctx) => {
    await ctx.db.insert("products", {
      active: false,
      category: "ingredient",
      currentStock: 0,
      minimumStock: 0,
      name: "Ingrédient archivé",
      normalizedName: "ingredient archive",
      tracksStock: true,
    })
    await ctx.db.insert("recipes", {
      active: false,
      family: "Utilitaire",
      name: "Recette archivée",
    })
    await ctx.db.insert("bundles", { active: false, name: "Lot archivé" })
  })
  const characterId = await backend.run(async (ctx) =>
    ctx.db.insert("characters", { active: true, name: "Personnage test" })
  )
  await employee.mutation(api.transactions.recordTrade, {
    characterId,
    kind: "sale",
    lines: [{ kind: "product", productId, quantity: 1 }],
    occurredAt: Date.now(),
  })
  await employee.mutation(api.orders.save, {
    contactName: "Client test",
    dueAt: null,
    kind: "client",
    lines: [{ productId, quantity: 1, unitPrice: 2 }],
    notes: "À consulter",
    status: "open",
    total: 2,
  })
  const queries = [
    api.dashboard.overview,
    api.accounts.overview,
    api.products.list,
    api.products.selectable,
    api.products.catalog,
    api.products.listArchived,
    api.recipes.list,
    api.recipes.listBundles,
    api.recipes.listArchived,
    api.bundles.listArchived,
    api.recipes.listLinkedProductIds,
    api.recipes.listActiveLinkedProductIds,
    api.characters.list,
    api.contacts.list,
    api.orders.listAttention,
  ] as const
  for (const reference of queries)
    state.data.set(
      getFunctionName(reference),
      await reader.query(reference, {})
    )
  state.data.set(
    "orders:listHistoryPage",
    await reader.query(api.orders.listHistoryPage, {
      paginationOpts: { cursor: null, numItems: 30 },
    })
  )
  state.data.set(
    "transactions:listPage",
    await reader.query(api.transactions.listPage, {
      paginationOpts: { cursor: null, numItems: 30 },
    })
  )
})

beforeEach(() => {
  state.role = "reader"
  state.access = undefined
  state.search = {}
  state.pathname = "/inventaire"
  state.mutations.clear()
  state.data.set("administration:getSiteName", DEFAULT_SITE_NAME)
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
    }
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

afterAll(() => {
  if (originalFonts) Object.defineProperty(document, "fonts", originalFonts)
  else Reflect.deleteProperty(document, "fonts")
})

function page(route: { options: { component?: ComponentType } }) {
  const Component = route.options.component!
  return <Component />
}

describe("réglage du nom du site", () => {
  beforeEach(() => {
    state.role = "admin"
    state.search = { view: "site" }
    state.data.set("administration:listAccounts", [])
  })

  it("attend l’activation du formulaire de connexion avant de permettre l’envoi", () => {
    const html = renderToStaticMarkup(page(AuthenticationRoute))
    const document = new DOMParser().parseFromString(html, "text/html")
    expect(
      document.querySelector('button[type="submit"]')?.hasAttribute("disabled")
    ).toBe(true)
    expect(document.querySelector("form")?.getAttribute("method")).toBe("post")
  })

  it("charge le nom actuel et enregistre le changement depuis l’administration", async () => {
    state.data.set("administration:getSiteName", "La Fiole du Voyageur")
    render(page(AdministrationRoute))
    const input = screen.getByRole<HTMLInputElement>("textbox", {
      name: "Nom du site",
    })
    expect(input.value).toBe("La Fiole du Voyageur")
    const save = state.mutations.get("administration:saveSiteName")
    save?.mockResolvedValue("L’Échoppe du Voyageur")
    fireEvent.change(input, { target: { value: " L’Échoppe du Voyageur " } })
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }))
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({ name: "L’Échoppe du Voyageur" })
    )
    await waitFor(() => expect(input.value).toBe("L’Échoppe du Voyageur"))
  })

  it("affiche une erreur pour un nom vide avant d’appeler le serveur", async () => {
    render(page(AdministrationRoute))
    const input = screen.getByRole("textbox", { name: "Nom du site" })
    fireEvent.change(input, { target: { value: "   " } })
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }))
    await waitFor(() => expect(input.getAttribute("aria-invalid")).toBe("true"))
    expect(screen.queryByText("Le nom du site est obligatoire.")).not.toBeNull()
    expect(
      state.mutations.get("administration:saveSiteName")
    ).not.toHaveBeenCalled()
  })

  it("affiche la limite de 24 caractères et accepte un nom à cette limite", async () => {
    render(page(AdministrationRoute))
    const input = screen.getByRole<HTMLInputElement>("textbox", {
      name: "Nom du site",
    })
    const name = "La fiole du grand voyage"
    expect(input.maxLength).toBe(24)
    expect(screen.getByText("24 caractères maximum.").id).toBe(
      input.getAttribute("aria-describedby")
    )
    const save = state.mutations.get("administration:saveSiteName")
    save?.mockResolvedValue(name)
    fireEvent.change(input, { target: { value: name } })
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }))
    await waitFor(() => expect(save).toHaveBeenCalledWith({ name }))
  })

  it("refuse 25 caractères côté formulaire avant d’appeler le serveur", async () => {
    render(page(AdministrationRoute))
    const input = screen.getByRole("textbox", { name: "Nom du site" })
    fireEvent.change(input, { target: { value: "x".repeat(25) } })
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }))
    await waitFor(() => expect(input.getAttribute("aria-invalid")).toBe("true"))
    expect(
      screen.queryByText("Le nom du site ne peut pas dépasser 24 caractères.")
    ).not.toBeNull()
    expect(
      state.mutations.get("administration:saveSiteName")
    ).not.toHaveBeenCalled()
  })

  it("conserve la saisie après un échec d’enregistrement", async () => {
    render(page(AdministrationRoute))
    const input = screen.getByRole<HTMLInputElement>("textbox", {
      name: "Nom du site",
    })
    const save = state.mutations.get("administration:saveSiteName")
    save?.mockRejectedValue(new Error("Indisponible"))
    fireEvent.change(input, { target: { value: "Nouveau nom" } })
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }))
    await waitFor(() => expect(save).toHaveBeenCalled())
    await waitFor(() => expect(input.disabled).toBe(false))
    expect(input.value).toBe("Nouveau nom")
  })

  it("masque les réglages aux lecteurs", () => {
    state.role = "reader"
    render(page(AdministrationRoute))
    expect(screen.queryByRole("textbox", { name: "Nom du site" })).toBeNull()
    expect(screen.queryByRole("tab", { name: "Site" })).toBeNull()
  })

  it("actualise le nom dans les navigations et la page de connexion", () => {
    const view = render(
      <TooltipProvider>
        <AppShell>Contenu</AppShell>
      </TooltipProvider>
    )
    expect(screen.getAllByText(DEFAULT_SITE_NAME).length).toBeGreaterThan(0)
    state.data.set("administration:getSiteName", "La Fiole du Voyageur")
    view.rerender(
      <TooltipProvider>
        <AppShell>Contenu</AppShell>
      </TooltipProvider>
    )
    expect(screen.queryByText(DEFAULT_SITE_NAME)).toBeNull()
    expect(screen.getAllByText("La Fiole du Voyageur").length).toBeGreaterThan(
      0
    )
    view.unmount()
    render(page(AuthenticationRoute))
    expect(
      screen.queryByRole("heading", { name: "La Fiole du Voyageur" })
    ).not.toBeNull()
    expect(screen.queryByText(DEFAULT_SITE_NAME)).toBeNull()
  })

  it("actualise le titre et la description, y compris sur la connexion", () => {
    const view = render(<SiteMetadata />)
    expect(document.title).toBe(DEFAULT_SITE_NAME)
    state.data.set("administration:getSiteName", "La Fiole du Voyageur")
    view.rerender(<SiteMetadata />)
    expect(document.title).toBe("La Fiole du Voyageur")
    expect(
      document
        .querySelector('meta[name="description"]')
        ?.getAttribute("content")
    ).toContain("La Fiole du Voyageur")
    state.pathname = "/connexion"
    view.rerender(<SiteMetadata />)
    expect(document.title).toBe("Connexion · La Fiole du Voyageur")
  })
})

describe("interface lecteur", () => {
  it.each([
    InventoryRoute,
    JournalRoute,
    AccountRoute,
    OrdersRoute,
    RecipesRoute,
  ])(
    "refuse une URL directe même si les anciens droits sont encore en cache",
    async (route) => {
      const guard = route.options.beforeLoad as unknown as (options: {
        context: { queryClient: QueryClient }
      }) => Promise<unknown>
      const queryClient = new QueryClient({
        defaultOptions: {
          queries: {
            queryFn: async () => ({
              role: "reader",
              readerAccess: { ...defaultReaderAccess, sections: [] },
            }),
          },
        },
      })
      queryClient.setQueryData(
        convexQuery(api.auth.getCurrentUser, {}).queryKey,
        { role: "reader", readerAccess: defaultReaderAccess }
      )
      await expect(guard({ context: { queryClient } })).rejects.toMatchObject({
        options: { to: "/" },
      })
    }
  )
  it("masque les prix et stocks même pendant le rafraîchissement des données", () => {
    state.access = {
      ...defaultReaderAccess,
      showPrices: false,
      showStock: false,
    }
    render(page(InventoryRoute))
    const row = screen.getByRole("row", { name: /Blé test/ })
    expect(within(row).queryByText("1 septim l’unité")).toBeNull()
    expect(within(row).queryByText("2 septims l’unité")).toBeNull()
    expect(within(row).getAllByText("Masqué")).toHaveLength(5)
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Stocks faibles" })
        .disabled
    ).toBe(true)
  })

  it("ne propose que les rubriques autorisées et garde un accueil sans données interdites", () => {
    state.access = {
      ...defaultReaderAccess,
      sections: ["recipes"],
      showPrices: false,
    }
    render(
      <TooltipProvider>
        <AppShell>{page(DashboardRoute)}</AppShell>
      </TooltipProvider>
    )
    expect(screen.queryByRole("link", { name: "Inventaire" })).toBeNull()
    expect(screen.queryByRole("link", { name: "Transactions" })).toBeNull()
    expect(screen.queryByRole("link", { name: "Compte" })).toBeNull()
    expect(screen.queryByText("Dernières transactions")).toBeNull()
    expect(screen.queryByText("Stocks faibles")).toBeNull()
    expect(
      screen.queryByRole("link", { name: "Recettes & lots" })
    ).not.toBeNull()
  })

  it("sépare les droits recettes et lots, y compris sur une URL demandant une vue interdite", () => {
    state.access = {
      ...defaultReaderAccess,
      sections: ["bundles"],
      showPrices: false,
    }
    state.search = { view: "recipes" }
    render(page(RecipesRoute))
    expect(screen.queryByText("Lot test")).not.toBeNull()
    expect(screen.queryByText("Soin test")).toBeNull()
    expect(screen.queryByRole("tab", { name: "Recettes" })).toBeNull()
    expect(
      screen.queryByRole("link", { name: "Voir dans l’inventaire" })
    ).toBeNull()
  })

  it("retire le contenu d’une rubrique quand ses droits sont révoqués en cours de session", () => {
    const view = render(page(InventoryRoute))
    expect(screen.queryByText("Blé test")).not.toBeNull()
    state.access = { ...defaultReaderAccess, sections: [] }
    view.rerender(page(InventoryRoute))
    expect(screen.queryByText("Blé test")).toBeNull()
    expect(screen.queryByText("Accès non autorisé")).not.toBeNull()
  })

  it("enregistre les choix détaillés depuis Gérer l’accès", async () => {
    state.role = "admin"
    render(
      <AccountAccessDialog
        account={{
          id: "reader",
          identifier: "reader",
          name: "Lecteur",
          role: "reader",
          banned: false,
          readerAccess: defaultReaderAccess,
        }}
        isLastActiveAdmin={false}
        trigger={<button>Gérer l’accès test</button>}
      />
    )
    fireEvent.click(screen.getByRole("button", { name: "Gérer l’accès test" }))
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Voir les prix, coûts et montants" })
    )
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Voir les stocks et les seuils" })
    )
    fireEvent.click(screen.getByRole("checkbox", { name: "Transactions" }))
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer l’accès" }))
    await waitFor(() =>
      expect(
        state.mutations.get("administration:saveAccountAccess")
      ).toHaveBeenCalledWith({
        userId: "reader",
        role: "reader",
        access: {
          ...defaultReaderAccess,
          sections: defaultReaderAccess.sections.filter(
            (section) => section !== "transactions"
          ),
          showPrices: false,
          showStock: false,
        },
      })
    )
  })

  it("conserve la navigation métier et masque l’administration", () => {
    render(
      <TooltipProvider>
        <AppShell>
          <p>Contenu métier</p>
        </AppShell>
      </TooltipProvider>
    )
    expect(screen.queryByRole("link", { name: "Inventaire" })).not.toBeNull()
    expect(screen.queryByRole("link", { name: "Accès & réglages" })).toBeNull()
    expect(screen.queryByRole("link", { name: "Personnages" })).toBeNull()
    expect(screen.queryByText("Lecteur · lecture seule")).not.toBeNull()
  })

  it("affiche l’inventaire avec ses filtres et sans modification", () => {
    render(page(InventoryRoute))
    expect(screen.queryByText("Blé test")).not.toBeNull()
    const headers = screen.getAllByRole("columnheader")
    expect(headers.map((header) => header.textContent)).toEqual([
      "Référence",
      "Catégorie",
      "Stock",
      "Seuil",
      "Prix d’achat",
      "Prix de vente",
      "État",
    ])
    const row = screen.getByRole("row", { name: /Blé test/ })
    const cells = within(row).getAllByRole("cell")
    expect(cells[4]?.textContent).toBe("Prix d’achat1 septim l’unité")
    expect(cells[5]?.textContent).toBe("Prix de vente2 septims l’unité")
    expect(
      screen.queryByRole("textbox", { name: "Rechercher un produit" }) ??
        screen.queryByRole("searchbox", { name: "Rechercher un produit" })
    ).not.toBeNull()
    expect(
      screen.queryByRole("button", { name: "Stocks faibles" })
    ).not.toBeNull()
    expect(
      screen.queryByRole("button", { name: /Modifier|Ajouter|Archiver|Écrire/ })
    ).toBeNull()
  })

  it.each([
    {
      purchasePrice: undefined,
      salePrice: 2,
      purchase: "—",
      sale: "2 septims l’unité",
    },
    {
      purchasePrice: 1,
      salePrice: undefined,
      purchase: "1 septim l’unité",
      sale: "—",
    },
    {
      purchasePrice: undefined,
      salePrice: undefined,
      purchase: "—",
      sale: "—",
    },
    {
      purchasePrice: 0,
      salePrice: 0,
      purchase: "0 septims l’unité",
      sale: "0 septims l’unité",
    },
    {
      purchasePrice: 1 / 3,
      salePrice: 2 / 3,
      purchase: "1 septim pour 3",
      sale: "2 septims pour 3",
    },
  ])(
    "affiche séparément les tarifs d’achat $purchasePrice et de vente $salePrice",
    ({ purchasePrice, salePrice, purchase, sale }) => {
      const products = state.data.get("products:list") as Doc<"products">[]
      state.data.set("products:list", [
        { ...products[0], purchasePrice, salePrice },
      ])
      try {
        render(page(InventoryRoute))
        const cells = within(
          screen.getByRole("row", { name: /Blé test/ })
        ).getAllByRole("cell")
        expect(cells[4]?.textContent).toBe(`Prix d’achat${purchase}`)
        expect(cells[5]?.textContent).toBe(`Prix de vente${sale}`)
      } finally {
        state.data.set("products:list", products)
      }
    }
  )

  it.each([
    ["purchasePrice-asc", "purchasePrice-asc"],
    ["purchasePrice-desc", "purchasePrice-desc"],
    ["salePrice-asc", "salePrice-asc"],
    ["salePrice-desc", "salePrice-desc"],
    ["price-asc", "salePrice-asc"],
    ["price-desc", "salePrice-desc"],
    ["invalid-desc", undefined],
  ])("valide le tri d’inventaire %s en %s", (sort, expected) => {
    const validateSearch = InventoryRoute.options.validateSearch as (
      search: Record<string, unknown>
    ) => Record<string, unknown>
    expect(
      validateSearch({ sort, category: "ingredient", q: "Blé", stock: "low" })
    ).toEqual({
      category: "ingredient",
      q: "Blé",
      stock: "low",
      ...(expected ? { sort: expected } : {}),
    })
  })

  it("consulte les recettes et les ingrédients sans actions de production ou d’édition", () => {
    state.search = { view: "recipes" }
    render(page(RecipesRoute))
    expect(screen.queryByText("Soin test")).not.toBeNull()
    expect(screen.queryByText("Blé test")).not.toBeNull()
    expect(
      screen.queryByRole("link", { name: "Voir dans l’inventaire" })
    ).not.toBeNull()
    expect(
      screen.queryByRole("button", {
        name: /Produire|Modifier|Nouvelle|Réactiver/,
      })
    ).toBeNull()
  })

  it("consulte les lots sans édition", () => {
    state.search = { view: "bundles" }
    render(page(RecipesRoute))
    expect(screen.queryByText("Lot test")).not.toBeNull()
    expect(
      screen.queryByRole("button", { name: /Modifier|Nouveau|Réactiver/ })
    ).toBeNull()
  })

  it.each([
    {
      label: "références",
      route: InventoryRoute,
      view: undefined,
      name: "Ingrédient archivé",
    },
    {
      label: "recettes",
      route: RecipesRoute,
      view: "recipes",
      name: "Recette archivée",
    },
    {
      label: "lots",
      route: RecipesRoute,
      view: "bundles",
      name: "Lot archivé",
    },
  ])(
    "consulte les archives des $label sans pouvoir réactiver les entrées",
    ({ route, view, name }) => {
      state.search = view ? { view } : {}
      render(page(route))
      fireEvent.click(screen.getByRole("button", { name: "Archives" }))
      expect(screen.queryByText(name)).not.toBeNull()
      expect(screen.queryByRole("button", { name: "Réactiver" })).toBeNull()
    }
  )

  it("consulte le journal sans nouvelle transaction ni gestion", () => {
    render(page(JournalRoute))
    expect(
      screen.queryByRole("heading", { name: "Transactions" })
    ).not.toBeNull()
    expect(screen.queryByText("Blé test")).not.toBeNull()
    expect(
      screen.queryByRole("button", {
        name: /Nouvelle transaction|Gérer|Supprimer/,
      })
    ).toBeNull()
  })

  it("consulte les commandes avec un statut affiché sans pouvoir le changer", () => {
    state.search = { view: "client" }
    render(page(OrdersRoute))
    expect(screen.queryByText("Client test")).not.toBeNull()
    expect(screen.queryByText("À consulter")).not.toBeNull()
    expect(
      screen.queryByRole("combobox", { name: /État de la commande/ })
    ).toBeNull()
    expect(
      screen.queryByRole("button", {
        name: /Modifier|Réceptionner|paiement|commande|contact|Renouveler/,
      })
    ).toBeNull()
  })

  it("consulte le tableau de bord et le compte sans réglages ni actions rapides", () => {
    const view = render(page(DashboardRoute))
    expect(
      screen.queryByRole("heading", { name: "La boutique aujourd’hui" })
    ).not.toBeNull()
    expect(screen.queryByText("Actions rapides")).toBeNull()
    view.unmount()
    render(page(AccountRoute))
    expect(screen.queryByRole("heading", { name: "Compte" })).not.toBeNull()
    expect(
      screen.queryByRole("button", { name: /Paramètres|Configurer/ })
    ).toBeNull()
  })

  it("retire une fenêtre d’écriture lors d’une rétrogradation et attend le rôle avant d’autoriser l’écriture", () => {
    state.role = "user"
    const view = render(page(InventoryRoute))
    fireEvent.click(screen.getByRole("button", { name: "Modifier Blé test" }))
    expect(screen.queryByRole("dialog")).not.toBeNull()
    state.role = "reader"
    view.rerender(page(InventoryRoute))
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(
      screen.queryByRole("button", { name: "Modifier Blé test" })
    ).toBeNull()
    state.role = undefined
    view.rerender(page(InventoryRoute))
    expect(
      screen.queryByRole("button", { name: "Modifier Blé test" })
    ).toBeNull()
  })

  it.each([AdministrationRoute, CharactersRoute])(
    "redirige un lecteur même si le cache de navigation contient encore le rôle admin",
    async (route) => {
      const guard = route.options.beforeLoad as unknown as (options: {
        context: {
          queryClient: ReactQuery.QueryClient
        }
      }) => Promise<unknown>
      let currentRole = "reader"
      const queryClient = new QueryClient({
        defaultOptions: {
          queries: { queryFn: async () => ({ role: currentRole }) },
        },
      })
      queryClient.setQueryData(
        convexQuery(api.auth.getCurrentUser, {}).queryKey,
        {
          role: "admin",
        }
      )
      const options = {
        context: { queryClient },
      }
      await expect(guard(options)).rejects.toMatchObject({
        options: { to: "/" },
      })
      currentRole = "admin"
      queryClient.setQueryData(
        convexQuery(api.auth.getCurrentUser, {}).queryKey,
        { role: "reader" }
      )
      await expect(guard(options)).resolves.toBeUndefined()
    }
  )
})
