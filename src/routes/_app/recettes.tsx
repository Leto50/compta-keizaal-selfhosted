import { convexQuery } from "@convex-dev/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { type FunctionReturnType } from "convex/server"
import {
  BookMarked,
  Boxes,
  Hammer,
  PackageOpen,
  Pencil,
  Search,
  Sparkles,
} from "lucide-react"
import { useState } from "react"
import { useQuery } from "convex/react"
import { readerRouteAccess, withReaderAccess } from "@/lib/reader-route-access"
import { useVisibleAmounts } from "@/hooks/use-visible-amounts"
import { cn } from "@/lib/utils"
import { canReadSection } from "../../../shared/reader-access"
import { canWrite as roleCanWrite } from "../../../shared/account-roles"

import { BundleArchivesDialog, BundleDialog } from "@/components/bundle-dialog"
import { OperationDialog } from "@/components/operation-dialog"
import { PageError } from "@/components/page-error"
import { PageHeader } from "@/components/page-header"
import { PageSkeleton } from "@/components/page-skeleton"
import { usePermissions } from "@/hooks/use-permissions"
import { ProductDialog } from "@/components/product-dialog"
import { RecipeArchivesDialog, RecipeDialog } from "@/components/recipe-dialog"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { api } from "../../../convex/_generated/api"
import { type Doc } from "../../../convex/_generated/dataModel"
import { calculateBundleCost } from "@/lib/bundle-cost"
import { formatNumber } from "@/lib/format"
import {
  isRecipeFamily,
  recipeFamilies,
  type RecipeFamily,
} from "@/lib/recipe-families"
import { bundleMatchesSearch, recipeMatchesSearch } from "@/lib/recipe-catalog"

type Recipe = FunctionReturnType<typeof api.recipes.list>[number]
type Bundle = FunctionReturnType<typeof api.recipes.listBundles>[number]
type CatalogView = "bundles" | "recipes"

interface CatalogSearch {
  family?: RecipeFamily
  q?: string
  view: CatalogView
}

function validateCatalogSearch(search: Record<string, unknown>): CatalogSearch {
  const q =
    typeof search.q === "string" && search.q.trim()
      ? search.q.slice(0, 100)
      : undefined
  return {
    ...(typeof search.family === "string" && isRecipeFamily(search.family)
      ? { family: search.family }
      : {}),
    ...(q ? { q } : {}),
    view: search.view === "bundles" ? "bundles" : "recipes",
  }
}

export const Route = createFileRoute("/_app/recettes")({
  beforeLoad: readerRouteAccess("recipes", "bundles"),
  component: withReaderAccess(RecipesPage, "recipes", "bundles"),
  errorComponent: PageError,
  loader: async ({ context }) => {
    const user = await context.queryClient.fetchQuery(
      convexQuery(api.auth.getCurrentUser, {})
    )
    await Promise.all([
      ...(canReadSection(user?.role, user?.readerAccess, "recipes")
        ? [
            context.queryClient.ensureQueryData(
              convexQuery(api.recipes.list, {})
            ),
          ]
        : []),
      ...(canReadSection(user?.role, user?.readerAccess, "bundles")
        ? [
            context.queryClient.ensureQueryData(
              convexQuery(api.recipes.listBundles, {})
            ),
          ]
        : []),
      context.queryClient.ensureQueryData(
        convexQuery(api.products.catalog, {})
      ),
      ...(roleCanWrite(user?.role)
        ? [
            context.queryClient.ensureQueryData(
              convexQuery(api.characters.list, {})
            ),
            context.queryClient.ensureQueryData(
              convexQuery(api.recipes.listLinkedProductIds, {})
            ),
          ]
        : []),
    ])
  },
  pendingComponent: PageSkeleton,
  validateSearch: validateCatalogSearch,
})

function RecipesPage() {
  const { canWrite, canRead } = usePermissions()
  const filters = Route.useSearch()
  const navigate = Route.useNavigate()
  const recipes =
    useQuery(api.recipes.list, canRead("recipes") ? {} : "skip") ?? []
  const bundles =
    useQuery(api.recipes.listBundles, canRead("bundles") ? {} : "skip") ?? []
  const products = useQuery(api.products.catalog, {}) ?? []
  const characters = useQuery(api.characters.list, canWrite ? {} : "skip") ?? []
  const linkedProductIds =
    useQuery(api.recipes.listLinkedProductIds, canWrite ? {} : "skip") ?? []
  const [productionProductId, setProductionProductId] =
    useState<Doc<"products">["_id"]>()
  const search = filters.q ?? ""
  const family = filters.family ?? "all"
  const view =
    filters.view === "bundles" && canRead("bundles")
      ? "bundles"
      : canRead("recipes")
        ? "recipes"
        : "bundles"
  const families = recipeFamilies.filter((entry) =>
    recipes.some((recipe) => recipe.family === entry)
  )
  const visibleRecipes = recipes.filter(
    (recipe) =>
      (family === "all" || recipe.family === family) &&
      recipeMatchesSearch(recipe, search)
  )
  const visibleBundles = bundles.filter((bundle) =>
    bundleMatchesSearch(bundle, search)
  )

  function handleViewChange(value: string) {
    if (value !== "recipes" && value !== "bundles") return
    void navigate({
      replace: true,
      search: (previous) => ({ ...previous, view: value }),
    })
  }
  return (
    <div className="animate-in duration-300 fade-in slide-in-from-bottom-1 motion-reduce:animate-none">
      <PageHeader eyebrow="Production" title="Recettes & lots">
        Les ingrédients nécessaires aux recettes et les lots vendus en boutique.
      </PageHeader>

      <div className="mt-7 flex flex-wrap items-center justify-between gap-3 border-y border-border/70 py-3">
        <Tabs onValueChange={handleViewChange} value={view}>
          <TabsList aria-label="Vue du catalogue" className="bg-[#6e5330]/8">
            {canRead("recipes") ? (
              <TabsTrigger value="recipes">
                <BookMarked aria-hidden="true" />
                Recettes
              </TabsTrigger>
            ) : null}
            {canRead("bundles") ? (
              <TabsTrigger value="bundles">
                <PackageOpen aria-hidden="true" />
                Lots
              </TabsTrigger>
            ) : null}
          </TabsList>
        </Tabs>
        <p className="text-sm text-muted-foreground">
          <strong className="font-display text-lg text-foreground">
            {view === "recipes" ? visibleRecipes.length : visibleBundles.length}
          </strong>{" "}
          {view === "recipes"
            ? visibleRecipes.length === 1
              ? "recette affichée"
              : "recettes affichées"
            : visibleBundles.length === 1
              ? "lot affiché"
              : "lots affichés"}
        </p>
      </div>

      <div
        className={
          view === "recipes"
            ? "mt-4 grid gap-3 sm:grid-cols-[1fr_14rem]"
            : "mt-4"
        }
      >
        <div className="relative">
          <Search
            aria-hidden="true"
            className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label={
              view === "recipes"
                ? "Rechercher une recette"
                : "Rechercher un lot"
            }
            className="h-9 bg-background/50 pl-9"
            onChange={(event) => {
              const value = event.target.value
              void navigate({
                replace: true,
                search: (previous) => ({
                  ...previous,
                  q: value || undefined,
                }),
              })
            }}
            placeholder={
              view === "recipes"
                ? "Nom, effet ou ingrédient…"
                : "Nom ou composition du lot…"
            }
            type="search"
            value={search}
          />
        </div>
        {view === "recipes" ? (
          <Select
            onValueChange={(value) => {
              if (value !== "all" && !isRecipeFamily(value)) return
              void navigate({
                replace: true,
                search: (previous) => ({
                  ...previous,
                  family: value === "all" ? undefined : value,
                }),
              })
            }}
            value={family}
          >
            <SelectTrigger
              aria-label="Famille de recettes"
              className="w-full bg-background/50"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes les familles</SelectItem>
              {families.map((entry) => (
                <SelectItem key={entry} value={entry}>
                  {entry}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>

      {view === "recipes" ? (
        <section aria-labelledby="recipes-title" className="mt-7">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <p className="text-[0.66rem] font-bold tracking-[0.2em] text-primary uppercase">
                {visibleRecipes.length} recettes
              </p>
              <h2
                className="mt-1 font-display text-xl font-[580] text-[#3b2f22]"
                id="recipes-title"
              >
                Recettes
              </h2>
            </div>
            <div className="flex items-center gap-2">
              <RecipeArchivesDialog />
              {canWrite ? (
                <RecipeDialog
                  linkedProductIds={linkedProductIds}
                  products={products}
                />
              ) : null}
              <BookMarked aria-hidden="true" className="size-5 text-primary" />
            </div>
          </div>
          {visibleRecipes.length > 0 ? (
            <div className="grid grid-cols-3 gap-3 max-xl:grid-cols-2 max-md:grid-cols-1">
              {visibleRecipes.map((recipe) => (
                <RecipeEntry
                  key={recipe._id}
                  linkedProductIds={linkedProductIds}
                  onProduce={setProductionProductId}
                  products={products}
                  recipe={recipe}
                />
              ))}
            </div>
          ) : (
            <Alert className="border-[#6a4f2e]/30 bg-card/35">
              <Search aria-hidden="true" />
              <AlertTitle>Aucune recette trouvée</AlertTitle>
              <AlertDescription>
                Modifiez la recherche ou choisissez une autre famille.
              </AlertDescription>
            </Alert>
          )}
        </section>
      ) : (
        <section aria-labelledby="bundles-title" className="mt-7">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <p className="text-[0.66rem] font-bold tracking-[0.2em] text-primary uppercase">
                Vente groupée
              </p>
              <h2
                className="mt-1 font-display text-xl font-[580] text-[#3b2f22]"
                id="bundles-title"
              >
                Lots préparés
              </h2>
            </div>
            <div className="flex items-center gap-2">
              <BundleArchivesDialog />
              {canWrite ? <BundleDialog products={products} /> : null}
              <PackageOpen aria-hidden="true" className="size-5 text-primary" />
            </div>
          </div>
          {visibleBundles.length > 0 ? (
            <div className="grid grid-cols-4 gap-3 max-xl:grid-cols-2 max-md:grid-cols-1">
              {visibleBundles.map((bundle) => (
                <BundleEntry
                  bundle={bundle}
                  key={bundle._id}
                  products={products}
                  recipes={recipes}
                />
              ))}
            </div>
          ) : (
            <Alert className="border-[#6a4f2e]/30 bg-card/35">
              <Search aria-hidden="true" />
              <AlertTitle>Aucun lot trouvé</AlertTitle>
              <AlertDescription>
                Modifiez la recherche pour retrouver un lot par son nom ou sa
                composition.
              </AlertDescription>
            </Alert>
          )}
        </section>
      )}

      {canWrite && productionProductId ? (
        <OperationDialog
          characters={characters}
          initialKind="production"
          initialProductId={productionProductId}
          key={productionProductId}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setProductionProductId(undefined)
          }}
          open
          products={products}
          recipes={recipes}
          trigger={null}
        />
      ) : null}
    </div>
  )
}

function RecipeEntry({
  linkedProductIds,
  onProduce,
  products,
  recipe,
}: Readonly<{
  linkedProductIds: readonly Doc<"products">["_id"][]
  onProduce: (productId: Doc<"products">["_id"]) => void
  products: readonly Doc<"products">[]
  recipe: Recipe
}>) {
  const { formatCost: formatDecimalSeptims, formatSalePrice: formatUnitPrice } =
    useVisibleAmounts()
  const { canWrite, canRead, showPurchasePrices, showSalePrices } =
    usePermissions()
  const outputProduct = recipe.productId
    ? products.find((product) => product._id === recipe.productId)
    : undefined

  return (
    <Card
      className={cn(
        "gap-0 rounded-none border-[#5b462b]/30 border-t-[#684f2d]/60 bg-linear-to-br from-[#fffbed]/60 to-[#e3d3b3]/20 py-0 ring-0",
        (showPurchasePrices || showSalePrices) && "min-h-48"
      )}
    >
      <CardHeader className="p-4 pb-0">
        <p className="text-[0.65rem] font-semibold tracking-[0.16em] text-primary uppercase">
          {recipe.family}
        </p>
        <CardTitle className="font-display text-lg font-medium">
          {recipe.name}
        </CardTitle>
        {canWrite ? (
          <CardAction>
            <RecipeDialog
              linkedProductIds={linkedProductIds}
              products={products}
              recipe={recipe}
              trigger={
                <Button
                  aria-label={`Modifier ${recipe.name}`}
                  size="icon"
                  variant="ghost"
                >
                  <Pencil aria-hidden="true" />
                </Button>
              }
            />
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col p-4 pt-3">
        {showPurchasePrices || showSalePrices ? (
          <dl
            className={cn(
              "mb-4 grid gap-3 border-y border-border/60 py-2 text-xs",
              showPurchasePrices && showSalePrices
                ? "grid-cols-2"
                : "grid-cols-1"
            )}
          >
            {showPurchasePrices ? (
              <div>
                <dt className="text-muted-foreground">Coût matière</dt>
                <dd className="mt-0.5 font-semibold text-foreground">
                  {recipe.cost === undefined ? (
                    <Badge variant="outline">Incomplet</Badge>
                  ) : (
                    formatDecimalSeptims(recipe.cost)
                  )}
                </dd>
              </div>
            ) : null}
            {showSalePrices ? (
              <div>
                <dt className="text-muted-foreground">Prix de vente</dt>
                <dd className="mt-0.5 font-semibold text-foreground">
                  {outputProduct?.salePrice === undefined
                    ? "—"
                    : formatUnitPrice(outputProduct.salePrice)}
                </dd>
              </div>
            ) : null}
          </dl>
        ) : null}
        {recipe.effect ? (
          <p className="flex gap-2 text-xs leading-relaxed text-muted-foreground italic">
            <Sparkles
              aria-hidden="true"
              className="mt-0.5 size-3.5 shrink-0 text-primary"
            />
            {recipe.effect}
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-1.5">
          {recipe.ingredients.map((ingredient) => {
            const product = ingredient.productId
              ? products.find((entry) => entry._id === ingredient.productId)
              : undefined
            const content = (
              <>
                <strong>{formatNumber(ingredient.quantity)}</strong>{" "}
                {ingredient.ingredientName}
              </>
            )

            return canWrite && product ? (
              <ProductDialog
                hasRecipe={linkedProductIds.includes(product._id)}
                key={ingredient._id}
                product={product}
                trigger={
                  <Button
                    aria-label={`Modifier l’ingrédient ${ingredient.ingredientName}`}
                    className="h-5 w-fit cursor-pointer touch-manipulation rounded-full border-[#614b2c]/20 bg-[#6b5939]/[0.07] px-2 py-0.5 text-[0.625rem] font-medium text-[#5a4b37] hover:border-primary/35 hover:bg-primary/[0.09] hover:text-[#443522] active:bg-primary/[0.14]"
                    size="xs"
                    type="button"
                    variant="outline"
                  >
                    {content}
                  </Button>
                }
              />
            ) : (
              <Badge
                className="border-[#614b2c]/20 bg-[#6b5939]/[0.07] text-[#5a4b37]"
                key={ingredient._id}
                variant="outline"
              >
                {content}
              </Badge>
            )
          })}
        </div>
        {recipe.productId ? (
          <div className="mt-auto grid gap-2 pt-4">
            {canWrite ? (
              <Button
                className="w-full"
                onClick={() => onProduce(recipe.productId!)}
                size="sm"
                type="button"
                variant="outline"
              >
                <Hammer aria-hidden="true" />
                Produire cette recette
              </Button>
            ) : null}
            {canRead("inventory") ? (
              <Button asChild className="w-full" size="sm" variant="ghost">
                <Link search={{ q: recipe.name }} to="/inventaire">
                  <Boxes aria-hidden="true" />
                  Voir dans l’inventaire
                </Link>
              </Button>
            ) : null}
          </div>
        ) : (
          <p className="mt-auto pt-4 text-xs text-muted-foreground">
            Reliez cette recette à une potion pour pouvoir la produire.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function BundleEntry({
  bundle,
  products,
  recipes,
}: Readonly<{
  bundle: Bundle
  products: readonly Doc<"products">[]
  recipes: readonly Recipe[]
}>) {
  const { formatCost: formatDecimalSeptims, formatSaleAmount: formatSeptims } =
    useVisibleAmounts()
  const { canWrite, showPurchasePrices, showSalePrices } = usePermissions()
  const cost = calculateBundleCost(bundle.items, products, recipes)

  return (
    <Card className="gap-0 rounded-none border-0 border-l-2 border-l-[#755832]/55 bg-[#795f38]/5 py-0 ring-0">
      <CardHeader className="p-4 pb-0">
        <CardTitle className="font-display text-base font-medium">
          {bundle.name}
        </CardTitle>
        {canWrite ? (
          <CardAction>
            <BundleDialog
              bundle={bundle}
              products={products}
              trigger={
                <Button
                  aria-label={`Modifier ${bundle.name}`}
                  size="icon"
                  variant="ghost"
                >
                  <Pencil aria-hidden="true" />
                </Button>
              }
            />
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="p-4 pt-3">
        {showPurchasePrices || showSalePrices ? (
          <dl
            className={cn(
              "mb-3 grid gap-3 border-y border-border/60 py-2 text-xs",
              showPurchasePrices && showSalePrices
                ? "grid-cols-2"
                : "grid-cols-1"
            )}
          >
            {showPurchasePrices ? (
              <div>
                <dt className="text-muted-foreground">Coût de composition</dt>
                <dd className="mt-0.5 font-semibold text-foreground">
                  {cost === undefined ? (
                    <Badge variant="outline">Incomplet</Badge>
                  ) : (
                    formatDecimalSeptims(cost)
                  )}
                </dd>
              </div>
            ) : null}
            {showSalePrices ? (
              <div>
                <dt className="text-muted-foreground">Prix de vente</dt>
                <dd className="mt-0.5 font-semibold text-foreground">
                  {bundle.price === undefined
                    ? "—"
                    : formatSeptims(bundle.price)}
                </dd>
              </div>
            ) : null}
          </dl>
        ) : null}
        <ul className="grid gap-1 text-xs text-muted-foreground">
          {bundle.items.map((item) => (
            <li className="flex justify-between gap-3" key={item._id}>
              <span>{item.productName}</span>
              <strong className="text-foreground">
                × {formatNumber(item.quantity)}
              </strong>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
