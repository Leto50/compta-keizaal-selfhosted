// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import {
  getFunctionName,
  type FunctionReference,
  type FunctionReturnType,
} from "convex/server"
import { ConvexError } from "convex/values"
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
import { RecipeDialog } from "./components/recipe-dialog"
import { RecipeCategoryManagerDialog } from "./components/recipe-category-manager-dialog"
import { HarvestValueSummary } from "./components/harvest-value-summary"
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
import { Route as HarvestsRoute } from "./routes/_app/recoltes"
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
  queries: unknown[][]
}>(() => ({
  data: new Map<string, unknown>(),
  mutations: new Map<string, ReturnType<typeof vi.fn>>(),
  pathname: "/inventaire",
  role: "reader",
  access: undefined,
  search: {},
  queries: [],
}))

const originalFonts = Object.getOwnPropertyDescriptor(document, "fonts")
const originalScrollIntoView = Object.getOwnPropertyDescriptor(
  Element.prototype,
  "scrollIntoView"
)

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
  useSuspenseQuery: ({ queryKey }: { queryKey: [string, string, unknown] }) => {
    state.queries.push(queryKey)
    return { data: state.data.get(queryKey[1]) }
  },
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
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  })
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
    api.recipes.listFamilies,
    api.recipes.listCategories,
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
  state.queries = []
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

describe("catégories personnalisées de recettes", () => {
  function editRecipe() {
    const recipes = state.data.get("recipes:list") as FunctionReturnType<
      typeof api.recipes.list
    >
    const products = state.data.get("products:selectable") as Doc<"products">[]
    state.role = "user"
    return render(
      <RecipeDialog
        open
        products={products}
        recipe={recipes[0]}
        trigger={null}
      />
    )
  }

  it("permet de saisir une nouvelle catégorie et de l’enregistrer avec la recette", async () => {
    editRecipe()
    fireEvent.click(screen.getByRole("button", { name: "Nouvelle catégorie" }))
    const input = screen.getByRole("textbox", { name: "Catégorie" })
    expect(input.getAttribute("maxlength")).toBe("100")
    expect(
      screen.queryByText(/restera disponible même sans recette/)
    ).not.toBeNull()
    fireEvent.change(input, { target: { value: "Régénération de santé" } })
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }))
    await waitFor(() =>
      expect(state.mutations.get("recipes:save")).toHaveBeenCalledWith(
        expect.objectContaining({
          family: "Régénération de santé",
          createFamily: true,
        })
      )
    )
  })

  it("affiche une erreur et conserve la fenêtre si la nouvelle catégorie est vide", async () => {
    editRecipe()
    fireEvent.click(screen.getByRole("button", { name: "Nouvelle catégorie" }))
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }))
    await waitFor(() =>
      expect(
        screen
          .getByRole("textbox", { name: "Catégorie" })
          .getAttribute("aria-invalid")
      ).toBe("true")
    )
    expect(state.mutations.get("recipes:save")).not.toHaveBeenCalled()
    expect(screen.queryByRole("dialog")).not.toBeNull()
  })

  it("revient au choix d’une catégorie existante", () => {
    editRecipe()
    fireEvent.click(screen.getByRole("button", { name: "Nouvelle catégorie" }))
    fireEvent.change(screen.getByRole("textbox", { name: "Catégorie" }), {
      target: { value: "Force" },
    })
    fireEvent.click(
      screen.getByRole("button", { name: "Choisir une catégorie existante" })
    )
    expect(screen.queryByRole("textbox", { name: "Catégorie" })).toBeNull()
    expect(
      screen.getByRole("combobox", { name: "Catégorie" }).textContent
    ).toBe("Choisir une catégorie…")
  })

  it.each([
    ["Force", "Force"],
    ["  RÉGÉNÉRATION DE SANTÉ  ", "Régénération de santé"],
    ["all", undefined],
    ["x".repeat(101), undefined],
  ])("conserve le filtre partageable %s en %s", (family, expected) => {
    const validateSearch = RecipesRoute.options.validateSearch as (
      search: Record<string, unknown>
    ) => Record<string, unknown>
    expect(validateSearch({ family, q: "Potion", view: "recipes" })).toEqual({
      ...(expected ? { family: expected } : {}),
      q: "Potion",
      view: "recipes",
    })
  })

  it.each([
    ["Force", "Force", "Potion de force", "Potion de régénération"],
    [
      "Regeneration",
      "Régénération",
      "Potion de régénération",
      "Potion de force",
    ],
  ])(
    "affiche et filtre la catégorie %s pour un lecteur",
    (family, label, visible, hidden) => {
      const recipes = state.data.get("recipes:list") as FunctionReturnType<
        typeof api.recipes.list
      >
      const families = state.data.get("recipes:listFamilies")
      state.data.set("recipes:listFamilies", ["Force", "Régénération"])
      state.data.set("recipes:list", [
        { ...recipes[0], family: "Force", name: "Potion de force" },
        {
          ...recipes[0],
          _id: "regeneration" as Doc<"recipes">["_id"],
          family: "Régénération",
          name: "Potion de régénération",
        },
      ])
      state.search = { family, view: "recipes" }
      try {
        render(page(RecipesRoute))
        expect(screen.queryByText(visible)).not.toBeNull()
        expect(screen.queryByText(hidden)).toBeNull()
        expect(
          screen.getByRole("combobox", { name: "Famille de recettes" })
            .textContent
        ).toBe(label)
        expect(
          screen.queryByRole("button", { name: "Nouvelle recette" })
        ).toBeNull()
      } finally {
        state.data.set("recipes:list", recipes)
        state.data.set("recipes:listFamilies", families)
      }
    }
  )
})

describe("gestion des catégories de recettes", () => {
  let originalCategories: unknown
  beforeEach(() => {
    originalCategories = state.data.get("recipes:listCategories")
  })
  afterEach(() => {
    state.data.set("recipes:listCategories", originalCategories)
  })
  function manager(
    recipeCount = 0,
    archivedRecipeCount = 0,
    onCategoryChange = vi.fn()
  ) {
    state.role = "user"
    state.data.set("recipes:listCategories", [
      { name: "Force", recipeCount, archivedRecipeCount },
    ])
    const view = render(
      <RecipeCategoryManagerDialog onCategoryChange={onCategoryChange} />
    )
    fireEvent.click(screen.getByRole("button", { name: "Catégories" }))
    return { view, onCategoryChange }
  }

  it("crée une catégorie indépendamment d’une recette", async () => {
    manager()
    fireEvent.change(
      screen.getByRole("textbox", { name: "Nouvelle catégorie" }),
      { target: { value: "Régénération de santé" } }
    )
    fireEvent.click(screen.getByRole("button", { name: "Créer" }))
    await waitFor(() =>
      expect(
        state.mutations.get("recipes:createCategory")
      ).toHaveBeenCalledWith({ name: "Régénération de santé" })
    )
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLInputElement>("textbox", {
          name: "Nouvelle catégorie",
        }).value
      ).toBe("")
    )
    expect(state.mutations.has("recipes:save")).toBe(false)
  })

  it("refuse une création vide et indique le champ à corriger", async () => {
    manager()
    fireEvent.click(screen.getByRole("button", { name: "Créer" }))
    await waitFor(() =>
      expect(
        screen
          .getByRole("textbox", { name: "Nouvelle catégorie" })
          .getAttribute("aria-invalid")
      ).toBe("true")
    )
    expect(state.mutations.get("recipes:createCategory")).not.toHaveBeenCalled()
  })

  it("renomme une catégorie utilisée et actualise le filtre courant", async () => {
    const { onCategoryChange } = manager(2, 1)
    state.mutations
      .get("recipes:renameCategory")!
      .mockResolvedValue("Force accrue")
    fireEvent.click(screen.getByRole("button", { name: "Renommer Force" }))
    fireEvent.change(
      screen.getByRole("textbox", { name: "Nouveau nom de Force" }),
      { target: { value: "Force accrue" } }
    )
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer le nom" }))
    await waitFor(() =>
      expect(
        state.mutations.get("recipes:renameCategory")
      ).toHaveBeenCalledWith({ family: "Force", name: "Force accrue" })
    )
    await waitFor(() =>
      expect(onCategoryChange).toHaveBeenCalledWith("Force", "Force accrue")
    )
  })

  it.each([
    [1, 0],
    [1, 1],
  ])(
    "bloque la suppression d’une catégorie utilisée : %s recette, %s archivée",
    (recipeCount, archivedRecipeCount) => {
      manager(recipeCount, archivedRecipeCount)
      const remove = screen.getByRole<HTMLButtonElement>("button", {
        name: "Supprimer Force",
      })
      expect(remove.disabled).toBe(true)
      expect(remove.title).toContain("y compris archivées")
      expect(
        state.mutations.get("recipes:removeCategory")
      ).not.toHaveBeenCalled()
    }
  )

  it("demande une confirmation avant de supprimer une catégorie sans recette", async () => {
    const { onCategoryChange } = manager()
    fireEvent.click(screen.getByRole("button", { name: "Supprimer Force" }))
    expect(screen.queryByRole("alertdialog")).not.toBeNull()
    expect(state.mutations.get("recipes:removeCategory")).not.toHaveBeenCalled()
    fireEvent.click(
      screen.getByRole("button", { name: "Supprimer la catégorie" })
    )
    await waitFor(() =>
      expect(
        state.mutations.get("recipes:removeCategory")
      ).toHaveBeenCalledWith({ family: "Force" })
    )
    await waitFor(() => expect(onCategoryChange).toHaveBeenCalledWith("Force"))
  })

  it("conserve la saisie si le serveur refuse un nom en doublon", async () => {
    manager()
    state.mutations
      .get("recipes:createCategory")!
      .mockRejectedValue(new Error("Une catégorie portant ce nom existe déjà."))
    const input = screen.getByRole<HTMLInputElement>("textbox", {
      name: "Nouvelle catégorie",
    })
    fireEvent.change(input, { target: { value: "Force" } })
    fireEvent.click(screen.getByRole("button", { name: "Créer" }))
    await waitFor(() =>
      expect(state.mutations.get("recipes:createCategory")).toHaveBeenCalled()
    )
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>("button", { name: "Créer" })
          .disabled
      ).toBe(false)
    )
    expect(input.value).toBe("Force")
  })

  it("masque la gestion aux lecteurs et retire une fenêtre lors d’une rétrogradation", () => {
    const { view } = manager()
    expect(screen.queryByRole("dialog")).not.toBeNull()
    state.role = "reader"
    view.rerender(<RecipeCategoryManagerDialog />)
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(screen.queryByRole("button", { name: "Catégories" })).toBeNull()
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

afterAll(() => {
  if (originalScrollIntoView)
    Object.defineProperty(
      Element.prototype,
      "scrollIntoView",
      originalScrollIntoView
    )
  else Reflect.deleteProperty(Element.prototype, "scrollIntoView")
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
  it("retire seulement les salaires et les totaux qui les révèlent, même avec des données en cache", () => {
    state.access = defaultReaderAccess
    const view = render(page(AccountRoute))
    expect(screen.getByRole("columnheader", { name: /Salaire/ })).not.toBeNull()
    expect(screen.getByText("Total des charges")).not.toBeNull()
    state.access = { ...defaultReaderAccess, showSalaries: false }
    view.rerender(page(AccountRoute))
    expect(screen.queryByText(/salaire/i)).toBeNull()
    expect(screen.queryByText("Total des charges")).toBeNull()
    expect(screen.queryByText("Résultat courant après charges")).toBeNull()
    expect(screen.queryByText("Masqué")).toBeNull()
    for (const name of [
      "Caisse déclarée",
      "Fonds",
      "Solde du journal",
      "Loyer",
      "Cens",
      "Taxe",
    ])
      expect(screen.getByText(name)).not.toBeNull()
    expect(
      screen.getByRole("columnheader", { name: /Chiffre encaissé/ })
    ).not.toBeNull()
    expect(screen.getByRole("columnheader", { name: /Achats/ })).not.toBeNull()
    expect(screen.getByText("Bilan hebdomadaire")).not.toBeNull()
    fireEvent.click(
      screen.getByRole("combobox", { name: "Trier l’activité par personnage" })
    )
    expect(screen.queryByRole("option", { name: /Salaire/ })).toBeNull()
  })

  it("conserve le tri autorisé quand un lecteur triant par salaire perd ce droit", () => {
    state.access = defaultReaderAccess
    const view = render(page(AccountRoute))
    fireEvent.click(
      screen
        .getByRole("columnheader", { name: /Salaire/ })
        .querySelector("button")!
    )
    state.access = { ...defaultReaderAccess, showSalaries: false }
    view.rerender(page(AccountRoute))
    expect(screen.queryByRole("columnheader", { name: /Salaire/ })).toBeNull()
    expect(
      screen
        .getByRole("columnheader", { name: /Chiffre encaissé/ })
        .getAttribute("aria-sort")
    ).toBe("descending")
  })
  it("montre les prix de vente sans colonne de prix d’achat", () => {
    state.access = { ...defaultReaderAccess, showPurchasePrices: false }
    render(page(InventoryRoute))
    const row = screen.getByRole("row", { name: /Blé test/ })
    expect(within(row).queryByText("Prix d’achat")).toBeNull()
    expect(within(row).getByText("2 septims l’unité")).not.toBeNull()
    expect(
      screen.queryByRole("columnheader", { name: /Prix d’achat/ })
    ).toBeNull()
  })
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
    expect(within(row).getAllByRole("cell")).toHaveLength(2)
    expect(screen.queryByRole("button", { name: "Stocks faibles" })).toBeNull()
    expect(
      screen.queryByRole("columnheader", { name: /Stock|Seuil|Prix|État/ })
    ).toBeNull()
    expect(screen.queryByText("Masqué")).toBeNull()
  })

  it.each([
    { route: DashboardRoute, search: {} },
    { route: JournalRoute, search: {} },
    { route: AccountRoute, search: {} },
    { route: OrdersRoute, search: { view: "client" } },
    { route: RecipesRoute, search: { view: "recipes" } },
    { route: RecipesRoute, search: { view: "bundles" } },
  ])(
    "retire les informations financières de la page autorisée",
    ({ route, search }) => {
      state.access = {
        ...defaultReaderAccess,
        showPrices: false,
        showStock: false,
      }
      state.search = search
      render(page(route))
      expect(screen.queryByText("Masqué")).toBeNull()
      expect(screen.queryByText(/septim/i)).toBeNull()
      expect(
        screen.queryByText(
          /^(Prix d’achat|Prix de vente|Montant|Coût matière|Coût de composition|Total convenu|Caisse déclarée|Fonds|Solde du journal|Charges de la semaine en cours)$/
        )
      ).toBeNull()
      if (route === AccountRoute) {
        expect(screen.getByText("Activité hebdomadaire")).not.toBeNull()
        expect(
          screen.getAllByRole("columnheader", { name: "Opérations" }).length
        ).toBeGreaterThan(0)
      }
    }
  )

  it("retire immédiatement les champs quand leurs droits sont révoqués", () => {
    state.access = defaultReaderAccess
    const view = render(page(InventoryRoute))
    expect(screen.getByText("1 septim l’unité")).not.toBeNull()
    state.access = {
      ...defaultReaderAccess,
      showPrices: false,
      showStock: false,
    }
    view.rerender(page(InventoryRoute))
    expect(screen.queryByText("1 septim l’unité")).toBeNull()
    expect(screen.getAllByRole("columnheader")).toHaveLength(2)
    expect(screen.queryByText("Masqué")).toBeNull()
  })

  it("permet de poursuivre le journal après une page sans opération autorisée", () => {
    const originalPage = state.data.get("transactions:listPage")
    state.data.set("transactions:listPage", {
      page: [],
      isDone: false,
      continueCursor: "next-visible-page",
    })
    const view = render(page(JournalRoute))
    expect(
      screen.getByText("Aucune opération visible sur cette page")
    ).not.toBeNull()
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Suivante" })
        .disabled
    ).toBe(false)
    fireEvent.click(screen.getByRole("button", { name: "Suivante" }))
    expect(screen.getByText("Page 2")).not.toBeNull()
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Précédente" })
        .disabled
    ).toBe(false)
    state.data.set("transactions:listPage", {
      page: [],
      isDone: true,
      continueCursor: "done",
    })
    view.rerender(page(JournalRoute))
    expect(
      screen.getByText("Aucune opération autorisée à afficher")
    ).not.toBeNull()
    expect(
      screen.queryByText(
        "Ajoutez une première opération pour commencer l’historique."
      )
    ).toBeNull()
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Précédente" })
        .disabled
    ).toBe(false)
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Suivante" })
        .disabled
    ).toBe(true)
    state.data.set("transactions:listPage", originalPage)
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
    expect(screen.queryByRole("checkbox", { name: "Ajustement" })).toBeNull()
    expect(screen.queryByRole("checkbox", { name: "Production" })).toBeNull()
    for (const name of [
      "Achat",
      "Vente",
      "Échange",
      "Commande",
      "Lot",
      "Service",
    ])
      expect(screen.getByRole("checkbox", { name })).not.toBeNull()
    fireEvent.click(screen.getByRole("checkbox", { name: "Voir les salaires" }))
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
          showSalaries: false,
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
    expect(screen.queryByRole("link", { name: "Récoltes" })).toBeNull()
    expect(screen.queryByText("Lecteur · lecture seule")).not.toBeNull()
  })

  it.each([undefined, defaultReaderAccess])(
    "propose Récoltes décoché pour un lecteur avec la configuration %s et enregistre seulement une activation explicite",
    async (readerAccess) => {
      state.role = "admin"
      render(
        <AccountAccessDialog
          account={{
            id: "reader",
            identifier: "reader",
            name: "Lecteur",
            role: "reader",
            banned: false,
            readerAccess,
          }}
          isLastActiveAdmin={false}
          trigger={<button>Gérer l’accès test</button>}
        />
      )
      fireEvent.click(
        screen.getByRole("button", { name: "Gérer l’accès test" })
      )
      const checkbox = screen.getByRole<HTMLInputElement>("checkbox", {
        name: "Récoltes",
      })
      expect(checkbox.checked).toBe(false)
      fireEvent.click(checkbox)
      fireEvent.click(
        screen.getByRole("button", { name: "Enregistrer l’accès" })
      )
      await waitFor(() =>
        expect(
          state.mutations.get("administration:saveAccountAccess")
        ).toHaveBeenCalledWith({
          userId: "reader",
          role: "reader",
          access: {
            ...defaultReaderAccess,
            sections: [...defaultReaderAccess.sections, "harvests"],
          },
        })
      )
    }
  )

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
    "consulte les archives des $label sans prix ni possibilité de réactivation",
    ({ route, view, name }) => {
      state.access = {
        ...defaultReaderAccess,
        showPrices: false,
        showStock: false,
      }
      state.search = view ? { view } : {}
      render(page(route))
      fireEvent.click(screen.getByRole("button", { name: "Archives" }))
      expect(screen.queryByText(name)).not.toBeNull()
      expect(screen.queryByRole("button", { name: "Réactiver" })).toBeNull()
      const dialog = within(screen.getByRole("dialog"))
      expect(
        dialog.queryByText(/septim|Masqué|coût incomplet|Prix non renseigné/i)
      ).toBeNull()
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

describe("rubrique récoltes", () => {
  let originalProducts: unknown
  beforeEach(() => {
    state.role = "user"
    state.data.set("harvests:listWeeks", [
      Date.UTC(2026, 9, 5),
      Date.UTC(2026, 8, 28),
    ])
    originalProducts = state.data.get("products:list")
    const ingredient = (originalProducts as Doc<"products">[])[0]!
    state.data.set("products:list", [
      ingredient,
      {
        ...ingredient,
        _id: "salt" as Doc<"products">["_id"],
        name: "Sel de feu",
      },
      {
        ...ingredient,
        _id: "potion" as Doc<"products">["_id"],
        name: "Potion exclue",
        category: "potion",
      },
      {
        ...ingredient,
        _id: "archived" as Doc<"products">["_id"],
        name: "Ingrédient exclu",
        active: false,
      },
    ])
    state.data.set("harvests:listPage", {
      page: [],
      isDone: true,
      continueCursor: "done",
    })
  })
  afterEach(() => {
    state.data.set("products:list", originalProducts)
  })

  it.each([true, false])(
    "consulte les récoltes avec ce seul droit, sans catalogues ni actions et respecte la visibilité des prix d’achat (%s)",
    (showPurchasePrices) => {
      state.role = "reader"
      state.access = {
        ...defaultReaderAccess,
        sections: ["harvests"],
        operationKinds: [],
        showPurchasePrices,
        showSalePrices: false,
      }
      state.data.set("harvests:listPage", {
        page: [
          {
            _id: "harvest",
            actorName: "Mira",
            occurredAt: Date.UTC(2026, 9, 8, 12),
            lines: [
              {
                _id: "line",
                productName: "Lys bleu",
                quantity: 3,
                purchaseUnitPrice: 4,
              },
            ],
          },
        ],
        isDone: true,
        continueCursor: "done",
      })
      state.data.set("harvests:listGroups", {
        groups: [
          {
            key: "mira",
            character: { name: "Mira" },
            harvestCount: 1,
            quantity: 3,
            knownValue: 12,
            lineCount: 1,
            unpricedLineCount: 0,
          },
        ],
        page: 0,
        pageCount: 1,
      })
      const view = render(
        <TooltipProvider>
          <AppShell>{page(HarvestsRoute)}</AppShell>
        </TooltipProvider>
      )
      expect(screen.getByRole("link", { name: "Récoltes" })).not.toBeNull()
      expect(screen.getByText("Lys bleu")).not.toBeNull()
      expect(screen.queryByRole("columnheader", { name: "Actions" })).toBeNull()
      expect(
        screen.queryByRole("columnheader", { name: "Économie estimée" }) !==
          null
      ).toBe(showPurchasePrices)
      expect(
        screen.queryByRole("button", {
          name: /Nouvelle récolte|Modifier|Supprimer/,
        })
      ).toBeNull()
      expect(
        state.queries.some(
          (query) =>
            query[1] === "products:list" || query[1] === "characters:list"
        )
      ).toBe(false)
      fireEvent.click(screen.getByRole("combobox", { name: "Regrouper par" }))
      fireEvent.click(screen.getByRole("option", { name: "Personnage" }))
      expect(screen.queryByText("Économie estimée à l’achat") !== null).toBe(
        showPurchasePrices
      )
      if (!showPurchasePrices)
        expect(
          screen.queryByText(/septim|Tarif d’achat|Valeur partielle/)
        ).toBeNull()
      fireEvent.click(
        screen.getByRole("button", { name: "Voir les récoltes : Mira" })
      )
      expect(screen.getByText("Lys bleu")).not.toBeNull()
      state.access = { ...state.access, sections: [] }
      view.rerender(
        <TooltipProvider>
          <AppShell>{page(HarvestsRoute)}</AppShell>
        </TooltipProvider>
      )
      expect(screen.queryByText("Lys bleu")).toBeNull()
      expect(screen.queryByRole("link", { name: "Récoltes" })).toBeNull()
      expect(screen.getByText("Accès non autorisé")).not.toBeNull()
    }
  )

  it("précharge seulement les données de récoltes pour un lecteur autorisé", async () => {
    const queries: string[] = []
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          queryFn: async ({ queryKey }) => {
            const name = queryKey[1] as string
            queries.push(name)
            if (name === "auth:getCurrentUser")
              return {
                role: "reader",
                readerAccess: {
                  ...defaultReaderAccess,
                  sections: ["harvests"],
                },
              }
            if (name === "products:list" || name === "characters:list")
              throw new Error("Catalogue interdit")
            return state.data.get(name)
          },
        },
      },
    })
    const loader = HarvestsRoute.options.loader as unknown as (options: {
      context: { queryClient: QueryClient }
    }) => Promise<unknown>
    await loader({ context: { queryClient } })
    expect(queries.sort()).toEqual([
      "auth:getCurrentUser",
      "harvests:listPage",
      "harvests:listWeeks",
    ])
  })

  it.each([false, true])(
    "regroupe par personnage avec un filtre de semaine indépendant (filtre actif : %s)",
    async (filtered) => {
      const characters = state.data.get(
        "characters:list"
      ) as Doc<"characters">[]
      const products = state.data.get("products:list") as Doc<"products">[]
      const character = { id: characters[0]!._id, name: characters[0]!.name }
      const weekStartsAt = filtered ? Date.UTC(2026, 9, 5) : undefined
      state.data.set("harvests:listGroups", {
        page: 0,
        pageCount: 1,
        groups: [
          {
            key: "group",
            character,
            harvestCount: 32,
            quantity: 224,
            knownValue: 384,
            lineCount: 64,
            unpricedLineCount: 32,
          },
        ],
      })
      state.data.set("harvests:listPage", {
        page: [
          {
            _id: "harvest",
            actorCharacterId: characters[0]!._id,
            actorName: characters[0]!.name,
            occurredAt: Date.UTC(2026, 9, 8, 12),
            lines: [
              {
                _id: "line",
                productId: products[0]!._id,
                productName: products[0]!.name,
                quantity: 3,
                purchaseUnitPrice: 4,
              },
            ],
          },
        ],
        isDone: false,
        continueCursor: "more-harvests",
      })
      render(page(HarvestsRoute))
      if (filtered) {
        fireEvent.click(screen.getByRole("combobox", { name: "Semaine" }))
        fireEvent.click(
          screen.getByRole("option", { name: "Du 05/10/2026 au 11/10/2026" })
        )
      }
      fireEvent.click(screen.getByRole("combobox", { name: "Regrouper par" }))
      expect(screen.queryByRole("option", { name: "Semaine" })).toBeNull()
      expect(
        screen.queryByRole("option", { name: "Semaine et personnage" })
      ).toBeNull()
      fireEvent.click(screen.getByRole("option", { name: "Personnage" }))
      expect(state.queries).toContainEqual([
        "convexQuery",
        "harvests:listGroups",
        { weekStartsAt, page: 0 },
      ])
      expect(screen.getByText("32 récoltes")).not.toBeNull()
      expect(screen.getByText("384 sept.")).not.toBeNull()
      expect(screen.getByText("Partielle · 32 prix manquants")).not.toBeNull()
      expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
        character.name
      )
      expect(screen.queryByRole("table")).toBeNull()
      fireEvent.click(
        screen.getByRole("button", { name: /Voir les récoltes :/ })
      )
      expect(screen.getByRole("table", { name: /Récoltes :/ })).not.toBeNull()
      expect(state.queries).toContainEqual([
        "convexQuery",
        "harvests:listPage",
        {
          character,
          weekStartsAt,
          paginationOpts: { numItems: 30, cursor: null },
        },
      ])
      fireEvent.click(screen.getAllByRole("button", { name: "Suivante" })[0]!)
      expect(state.queries).toContainEqual([
        "convexQuery",
        "harvests:listPage",
        {
          character,
          weekStartsAt,
          paginationOpts: { numItems: 30, cursor: "more-harvests" },
        },
      ])
      expect(screen.getByText("384 sept.")).not.toBeNull()
      fireEvent.click(
        screen.getByRole("button", { name: /Modifier la récolte de/ })
      )
      expect(screen.getByRole("dialog")).not.toBeNull()
      fireEvent.click(
        within(screen.getByRole("dialog")).getByRole("button", {
          name: "Annuler",
        })
      )
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
      fireEvent.click(
        screen.getByRole("button", { name: /Masquer les récoltes :/ })
      )
      expect(screen.queryByRole("table")).toBeNull()
    }
  )

  it("réinitialise les pages au changement de semaine et conserve le filtre au changement d’affichage", () => {
    const weekStartsAt = Date.UTC(2026, 9, 5)
    state.data.set("harvests:listGroups", { page: 0, pageCount: 2, groups: [] })
    render(page(HarvestsRoute))
    fireEvent.click(screen.getByRole("combobox", { name: "Regrouper par" }))
    fireEvent.click(screen.getByRole("option", { name: "Personnage" }))
    fireEvent.click(screen.getByRole("button", { name: "Suivante" }))
    expect(state.queries).toContainEqual([
      "convexQuery",
      "harvests:listGroups",
      { weekStartsAt: undefined, page: 1 },
    ])
    fireEvent.click(screen.getByRole("combobox", { name: "Semaine" }))
    fireEvent.click(
      screen.getByRole("option", { name: "Du 05/10/2026 au 11/10/2026" })
    )
    expect(state.queries.at(-1)).toEqual([
      "convexQuery",
      "harvests:listGroups",
      { weekStartsAt, page: 0 },
    ])
    fireEvent.click(screen.getByRole("combobox", { name: "Regrouper par" }))
    fireEvent.click(screen.getByRole("option", { name: "Aucun regroupement" }))
    expect(screen.getByText("Aucune récolte cette semaine")).not.toBeNull()
    expect(state.queries.at(-1)).toEqual([
      "convexQuery",
      "harvests:listPage",
      {
        character: undefined,
        weekStartsAt,
        paginationOpts: { cursor: null, numItems: 30 },
      },
    ])
    fireEvent.click(screen.getByRole("combobox", { name: "Semaine" }))
    fireEvent.click(screen.getByRole("option", { name: "Toutes les semaines" }))
    expect(state.queries.at(-1)).toEqual([
      "convexQuery",
      "harvests:listPage",
      {
        character: undefined,
        weekStartsAt: undefined,
        paginationOpts: { cursor: null, numItems: 30 },
      },
    ])
  })

  it("affiche la rubrique aux employés et la retire lors d’une rétrogradation", () => {
    const view = render(
      <TooltipProvider>
        <AppShell>{page(HarvestsRoute)}</AppShell>
      </TooltipProvider>
    )
    expect(screen.getByRole("link", { name: "Récoltes" })).not.toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Nouvelle récolte" }))
    expect(screen.queryByRole("dialog")).not.toBeNull()
    state.role = "reader"
    view.rerender(
      <TooltipProvider>
        <AppShell>{page(HarvestsRoute)}</AppShell>
      </TooltipProvider>
    )
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(screen.queryByRole("link", { name: "Récoltes" })).toBeNull()
    expect(screen.queryByText("Accès non autorisé")).not.toBeNull()
  })

  it("redirige un lecteur même si le cache contient encore un rôle employé", async () => {
    const guard = HarvestsRoute.options.beforeLoad as unknown as (options: {
      context: { queryClient: QueryClient }
    }) => Promise<unknown>
    let currentRole = "reader"
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { queryFn: async () => ({ role: currentRole }) },
      },
    })
    const key = convexQuery(api.auth.getCurrentUser, {}).queryKey
    queryClient.setQueryData(key, { role: "user" })
    await expect(guard({ context: { queryClient } })).rejects.toMatchObject({
      options: { to: "/" },
    })
    currentRole = "user"
    queryClient.setQueryData(key, { role: "reader" })
    await expect(guard({ context: { queryClient } })).resolves.toBeUndefined()
  })

  it("préremplit la modification, conserve les tarifs et enregistre sans créer une seconde récolte", async () => {
    const products = state.data.get("products:list") as Doc<"products">[]
    const characters = state.data.get("characters:list") as Doc<"characters">[]
    const occurredAt = new Date(2026, 9, 8, 12, 41).getTime()
    state.data.set("harvests:listPage", {
      page: [
        {
          _id: "harvest",
          actorCharacterId: characters[0]!._id,
          actorName: characters[0]!.name,
          occurredAt,
          comment: "Ancien lieu",
          lines: [
            {
              _id: "line",
              productId: products[0]!._id,
              productName: products[0]!.name,
              quantity: 3,
              purchaseUnitPrice: 4,
            },
          ],
        },
      ],
      isDone: true,
      continueCursor: "done",
    })
    render(page(HarvestsRoute))
    fireEvent.click(
      screen.getByRole("button", { name: /Modifier la récolte de/ })
    )
    const dialog = within(screen.getByRole("dialog"))
    expect(
      dialog.getByRole("heading", { name: "Modifier la récolte" })
    ).not.toBeNull()
    expect(
      dialog.getByRole<HTMLButtonElement>("combobox", { name: "Personnage" })
        .textContent
    ).toContain(characters[0]!.name)
    expect(
      dialog.getByRole<HTMLButtonElement>("combobox", { name: "Ingrédient 1" })
        .textContent
    ).toContain(products[0]!.name)
    expect(
      dialog.getByRole<HTMLInputElement>("spinbutton", { name: "Quantité 1" })
        .value
    ).toBe("3")
    expect(
      dialog.getByRole<HTMLTextAreaElement>("textbox", {
        name: "Commentaire (facultatif)",
      }).value
    ).toBe("Ancien lieu")
    expect(dialog.getByText("12 sept.")).not.toBeNull()
    fireEvent.change(dialog.getByRole("spinbutton", { name: "Quantité 1" }), {
      target: { value: "5" },
    })
    expect(dialog.getByText("20 sept.")).not.toBeNull()
    fireEvent.click(
      dialog.getByRole("button", { name: "Ajouter un ingrédient" })
    )
    fireEvent.click(dialog.getByRole("combobox", { name: "Ingrédient 2" }))
    fireEvent.click(screen.getByRole("option", { name: /Sel de feu/ }))
    fireEvent.change(dialog.getByRole("spinbutton", { name: "Quantité 2" }), {
      target: { value: "2" },
    })
    expect(dialog.getByText("22 sept.")).not.toBeNull()
    fireEvent.change(
      dialog.getByRole("textbox", { name: "Commentaire (facultatif)" }),
      { target: { value: "" } }
    )
    let finishUpdate!: () => void
    state.mutations.get("harvests:update")!.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishUpdate = resolve
      })
    )
    fireEvent.click(
      dialog.getByRole("button", { name: "Enregistrer les modifications" })
    )
    await waitFor(() =>
      expect(state.mutations.get("harvests:update")).toHaveBeenCalledWith({
        transactionId: "harvest",
        characterId: characters[0]!._id,
        occurredAt,
        lines: [
          { productId: products[0]!._id, quantity: 5 },
          { productId: "salt", quantity: 2 },
        ],
      })
    )
    expect(
      dialog
        .getByRole<HTMLInputElement>("spinbutton", { name: "Quantité 1" })
        .matches(":disabled")
    ).toBe(true)
    expect(
      dialog.getByRole<HTMLButtonElement>("button", {
        name: "Enregistrer les modifications",
      }).disabled
    ).toBe(true)
    fireEvent.keyDown(document, { key: "Escape" })
    expect(screen.queryByRole("dialog")).not.toBeNull()
    finishUpdate()
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(state.mutations.get("harvests:record")).not.toHaveBeenCalled()
  })

  it("conserve les informations et affiche l’erreur lorsque la correction de stock est refusée", async () => {
    const products = state.data.get("products:list") as Doc<"products">[]
    const characters = state.data.get("characters:list") as Doc<"characters">[]
    state.data.set("harvests:listPage", {
      page: [
        {
          _id: "harvest",
          actorCharacterId: characters[0]!._id,
          actorName: characters[0]!.name,
          occurredAt: Date.now(),
          lines: [
            {
              _id: "line",
              productId: products[0]!._id,
              productName: products[0]!.name,
              quantity: 3,
              purchaseUnitPrice: 4,
            },
          ],
        },
      ],
      isDone: true,
      continueCursor: "done",
    })
    render(page(HarvestsRoute))
    fireEvent.click(
      screen.getByRole("button", { name: /Modifier la récolte de/ })
    )
    const dialog = within(screen.getByRole("dialog"))
    fireEvent.change(dialog.getByRole("spinbutton", { name: "Quantité 1" }), {
      target: { value: "1" },
    })
    state.mutations.get("harvests:update")!.mockRejectedValueOnce(
      new ConvexError({
        code: "INSUFFICIENT_STOCK",
        message: "Le stock deviendrait négatif.",
      })
    )
    fireEvent.click(
      dialog.getByRole("button", { name: "Enregistrer les modifications" })
    )
    await waitFor(() =>
      expect(dialog.getByText("Le stock deviendrait négatif.")).not.toBeNull()
    )
    expect(
      dialog.getByRole<HTMLInputElement>("spinbutton", { name: "Quantité 1" })
        .value
    ).toBe("1")
    expect(
      dialog.getByRole<HTMLButtonElement>("button", {
        name: "Enregistrer les modifications",
      }).disabled
    ).toBe(false)
    fireEvent.click(
      dialog.getByRole("button", { name: "Enregistrer les modifications" })
    )
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(state.mutations.get("harvests:update")).toHaveBeenCalledTimes(2)
  })

  it("préremplit les références archivées et garde une valeur inconnue malgré les tarifs actuels", async () => {
    const products = state.data.get("products:list") as Doc<"products">[]
    state.data.set("harvests:listPage", {
      page: [
        {
          _id: "harvest",
          actorCharacterId: "archived-character",
          actorName: "Personnage archivé",
          occurredAt: Date.now(),
          lines: [
            {
              _id: "line",
              productId: "archived-product",
              productName: "Ingrédient archivé",
              quantity: 3,
            },
            {
              _id: "known-product",
              productId: products[0]!._id,
              productName: products[0]!.name,
              quantity: 1,
            },
          ],
        },
      ],
      isDone: true,
      continueCursor: "done",
    })
    render(page(HarvestsRoute))
    fireEvent.click(
      screen.getByRole("button", { name: /Modifier la récolte de/ })
    )
    const dialog = within(screen.getByRole("dialog"))
    expect(
      dialog.getByRole<HTMLButtonElement>("combobox", { name: "Personnage" })
        .textContent
    ).toContain("Personnage archivé")
    expect(
      dialog.getByRole<HTMLButtonElement>("combobox", { name: "Ingrédient 1" })
        .textContent
    ).toContain("Ingrédient archivé")
    expect(dialog.getByText("Non renseignée")).not.toBeNull()
    expect(dialog.getByText(/2 ingrédients sans prix d’achat/)).not.toBeNull()
    fireEvent.click(dialog.getByRole("button", { name: "Annuler" }))
    expect(state.mutations.get("harvests:update")).not.toHaveBeenCalled()
  })

  it("valide les champs requis sans enregistrer une récolte incomplète", async () => {
    render(page(HarvestsRoute))
    fireEvent.click(screen.getByRole("button", { name: "Nouvelle récolte" }))
    fireEvent.click(
      screen.getByRole("button", { name: "Enregistrer la récolte" })
    )
    await waitFor(() =>
      expect(
        screen
          .getByRole("combobox", { name: "Personnage" })
          .getAttribute("aria-invalid")
      ).toBe("true")
    )
    expect(
      screen
        .getByRole("combobox", { name: "Ingrédient 1" })
        .getAttribute("aria-invalid")
    ).toBe("true")
    expect(state.mutations.get("harvests:record")).not.toHaveBeenCalled()
  })

  it("enregistre plusieurs ingrédients, exclut les produits indisponibles et empêche les doublons", async () => {
    render(page(HarvestsRoute))
    fireEvent.click(screen.getByRole("button", { name: "Nouvelle récolte" }))
    fireEvent.click(screen.getByRole("combobox", { name: "Personnage" }))
    fireEvent.click(screen.getByRole("option", { name: "Personnage test" }))
    fireEvent.click(screen.getByRole("combobox", { name: "Ingrédient 1" }))
    expect(
      screen.queryByRole("option", { name: /Potion exclue|Ingrédient exclu/ })
    ).toBeNull()
    fireEvent.click(screen.getByRole("option", { name: /Blé test/ }))
    fireEvent.change(screen.getByRole("spinbutton", { name: "Quantité 1" }), {
      target: { value: "3" },
    })
    fireEvent.click(
      screen.getByRole("button", { name: "Ajouter un ingrédient" })
    )
    fireEvent.click(screen.getByRole("combobox", { name: "Ingrédient 2" }))
    expect(screen.queryByRole("option", { name: /Blé test/ })).toBeNull()
    fireEvent.click(screen.getByRole("option", { name: /Sel de feu/ }))
    fireEvent.change(screen.getByRole("spinbutton", { name: "Quantité 2" }), {
      target: { value: "4" },
    })
    expect(screen.getByText("Économie estimée à l’achat")).not.toBeNull()
    expect(screen.getByText("7 sept.")).not.toBeNull()
    fireEvent.change(
      screen.getByRole("textbox", { name: "Commentaire (facultatif)" }),
      { target: { value: "  Blancherive  " } }
    )
    fireEvent.click(
      screen.getByRole("button", { name: "Enregistrer la récolte" })
    )
    const products = state.data.get("products:list") as Doc<"products">[]
    const characters = state.data.get("characters:list") as Doc<"characters">[]
    await waitFor(() =>
      expect(state.mutations.get("harvests:record")).toHaveBeenCalledWith({
        characterId: characters[0]!._id,
        comment: "Blancherive",
        occurredAt: expect.any(Number) as number,
        lines: [
          { productId: products[0]!._id, quantity: 3 },
          { productId: "salt", quantity: 4 },
        ],
      })
    )
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })

  it("affiche les récoltes et ne ferme pas la confirmation quand la suppression échoue", async () => {
    const products = state.data.get("products:list") as Doc<"products">[]
    const occurredAt = new Date(2026, 9, 8, 12).getTime()
    state.data.set("harvests:listPage", {
      page: [
        {
          _id: "harvest",
          actorName: "Alixard Veliane",
          occurredAt,
          comment: "Autour de Blancherive",
          lines: [
            {
              _id: "line",
              productName: products[0]!.name,
              quantity: 3,
              purchaseUnitPrice: 4,
            },
          ],
        },
      ],
      isDone: false,
      continueCursor: "next",
    })
    render(page(HarvestsRoute))
    expect(screen.queryByText("Alixard Veliane")).not.toBeNull()
    expect(screen.queryByText("+3 unités")).not.toBeNull()
    expect(
      screen.getByRole("table", { name: "Historique des récoltes" })
    ).not.toBeNull()
    expect(screen.queryByText("Autour de Blancherive")).toBeNull()
    const detail = screen.getByRole("button", {
      name: /Voir le détail de la récolte de/,
    })
    expect(detail.getAttribute("aria-expanded")).toBe("false")
    fireEvent.click(detail)
    expect(detail.getAttribute("aria-expanded")).toBe("true")
    expect(screen.getByText("Autour de Blancherive")).not.toBeNull()
    fireEvent.click(detail)
    expect(screen.queryByText("Autour de Blancherive")).toBeNull()
    expect(screen.getByText("Économie estimée à l’achat")).not.toBeNull()
    expect(screen.getByText("12 sept.")).not.toBeNull()
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Suivante" })
        .disabled
    ).toBe(false)
    fireEvent.click(
      screen.getByRole("button", { name: /Supprimer la récolte de/ })
    )
    state.mutations
      .get("transactions:remove")!
      .mockRejectedValueOnce(new Error("Stock insuffisant"))
    fireEvent.click(
      screen.getByRole("button", { name: "Supprimer la récolte" })
    )
    await waitFor(() =>
      expect(state.mutations.get("transactions:remove")).toHaveBeenCalledWith({
        transactionId: "harvest",
      })
    )
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>("button", {
          name: "Supprimer la récolte",
        }).disabled
      ).toBe(false)
    )
    expect(screen.queryByRole("alertdialog")).not.toBeNull()
  })

  it.each([
    {
      lines: [{ quantity: 3, purchaseUnitPrice: 1 / 3 }],
      label: "Économie estimée à l’achat",
      value: "1 sept.",
      incomplete: false,
    },
    {
      lines: [{ quantity: 3, purchaseUnitPrice: 4 }, { quantity: 1 }],
      label: "Valeur connue à l’achat",
      value: "12 sept.",
      incomplete: true,
    },
    {
      lines: [{ quantity: 3 }],
      label: "Valeur connue à l’achat",
      value: "Non renseignée",
      incomplete: true,
    },
    {
      lines: [{ quantity: 3, purchaseUnitPrice: 0 }],
      label: "Économie estimée à l’achat",
      value: "0 sept.",
      incomplete: false,
    },
  ])(
    "affiche la valeur $value et signale les estimations incomplètes",
    ({ lines, label, value, incomplete }) => {
      render(<HarvestValueSummary lines={lines} />)
      expect(screen.getByText(label)).not.toBeNull()
      expect(screen.getByText(value)).not.toBeNull()
      expect(screen.queryByText(/Estimation incomplète/) !== null).toBe(
        incomplete
      )
    }
  )
})
