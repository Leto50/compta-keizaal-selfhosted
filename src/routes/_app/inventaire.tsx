import { convexQuery } from "@convex-dev/react-query"
import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import {
  BookOpenText,
  CircleAlert,
  Pencil,
  Search,
  SlidersHorizontal,
} from "lucide-react"
import { useState } from "react"

import { PageError } from "@/components/page-error"
import { PageHeader } from "@/components/page-header"
import { PageSkeleton } from "@/components/page-skeleton"
import {
  ProductArchivesDialog,
  ProductDialog,
} from "@/components/product-dialog"
import { RecipeDialog } from "@/components/recipe-dialog"
import { SortableTableHead } from "@/components/sortable-table-head"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { api } from "../../../convex/_generated/api"
import { type Doc, type Id } from "../../../convex/_generated/dataModel"
import { categoryLabels, formatNumber, formatUnitPrice } from "@/lib/format"
import {
  canonicalProductCategory,
  isProductCraftable,
  type ProductCategory,
} from "@/lib/product-categories"
import {
  sortInventoryEntries,
  type InventorySortKey,
  type SortDirection,
} from "@/lib/table-sorting"
import { cn } from "@/lib/utils"
import { normalizeName } from "../../../shared/text"

type CategoryFilter = "all" | ProductCategory
type StockFilter = "low"
type InventorySortOption =
  | "name-asc"
  | "name-desc"
  | "price-asc"
  | "price-desc"
  | "status-asc"
  | "status-desc"
  | "stock-asc"
  | "stock-desc"

interface InventoryRouteSearch {
  category?: CategoryFilter
  q?: string
  sort?: InventorySortOption
  stock?: StockFilter
}

const categoryFilters: readonly {
  label: string
  value: CategoryFilter
}[] = [
  { label: "Tout", value: "all" },
  { label: "Potions", value: "potion" },
  { label: "Ingrédients", value: "ingredient" },
  { label: "Services", value: "service" },
]

const inventorySortOptions: readonly {
  label: string
  value: InventorySortOption
}[] = [
  { label: "Nom · A à Z", value: "name-asc" },
  { label: "Nom · Z à A", value: "name-desc" },
  { label: "Stock · plus élevé", value: "stock-desc" },
  { label: "Stock · plus faible", value: "stock-asc" },
  { label: "Prix · plus élevé", value: "price-desc" },
  { label: "Prix · plus faible", value: "price-asc" },
  { label: "État · à surveiller", value: "status-asc" },
  { label: "État · disponible", value: "status-desc" },
]

function isCategoryFilter(value: string): value is CategoryFilter {
  return categoryFilters.some((filter) => filter.value === value)
}

function isInventorySortOption(value: string): value is InventorySortOption {
  return inventorySortOptions.some((option) => option.value === value)
}

function validateInventorySearch(
  search: Record<string, unknown>
): InventoryRouteSearch {
  const category =
    typeof search.category === "string" && isCategoryFilter(search.category)
      ? search.category
      : undefined
  const q =
    typeof search.q === "string" && search.q.trim()
      ? search.q.slice(0, 100)
      : undefined
  const sort =
    typeof search.sort === "string" && isInventorySortOption(search.sort)
      ? search.sort
      : undefined
  return {
    ...(category && category !== "all" ? { category } : {}),
    ...(q ? { q } : {}),
    ...(sort && sort !== "name-asc" ? { sort } : {}),
    ...(search.stock === "low" ? { stock: "low" as const } : {}),
  }
}

export const Route = createFileRoute("/_app/inventaire")({
  component: InventoryPage,
  errorComponent: PageError,
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(convexQuery(api.products.list, {})),
      context.queryClient.ensureQueryData(
        convexQuery(api.recipes.listLinkedProductIds, {})
      ),
      context.queryClient.ensureQueryData(
        convexQuery(api.recipes.listActiveLinkedProductIds, {})
      ),
    ])
  },
  pendingComponent: PageSkeleton,
  validateSearch: validateInventorySearch,
})

function InventoryPage() {
  const filters = Route.useSearch()
  const navigate = Route.useNavigate()
  const { data: products } = useSuspenseQuery(
    convexQuery(api.products.list, {})
  )
  const { data: linkedProductIds } = useSuspenseQuery(
    convexQuery(api.recipes.listLinkedProductIds, {})
  )
  const { data: activeLinkedProductIds } = useSuspenseQuery(
    convexQuery(api.recipes.listActiveLinkedProductIds, {})
  )
  const category = filters.category ?? "all"
  const search = filters.q ?? ""
  const lowOnly = filters.stock === "low"
  const sortOption = filters.sort ?? "name-asc"
  const [sortKey, sortDirection] = sortOption.split("-") as [
    InventorySortKey,
    SortDirection,
  ]
  const [recipeProductId, setRecipeProductId] = useState<string>()
  const recipeProduct = products.find(
    (product) => product._id === recipeProductId
  )
  const activeRecipeProducts = new Set(activeLinkedProductIds)
  const linkedProducts = new Set(linkedProductIds)
  const normalizedSearch = normalizeName(search)
  const filteredProducts = products.filter(
    (product) =>
      (category === "all" ||
        canonicalProductCategory(product.category) === category) &&
      (!lowOnly ||
        (product.tracksStock &&
          product.currentStock <= product.minimumStock)) &&
      (!normalizedSearch || product.normalizedName.includes(normalizedSearch))
  )
  const visibleProducts = sortInventoryEntries(
    filteredProducts,
    sortKey,
    sortDirection
  )

  function handleCategoryChange(value: string) {
    if (!isCategoryFilter(value)) return
    void navigate({
      replace: true,
      search: (previous) => ({
        ...previous,
        category: value === "all" ? undefined : value,
      }),
    })
  }

  function handleSort(key: InventorySortKey) {
    const direction: SortDirection =
      sortKey === key
        ? sortDirection === "asc"
          ? "desc"
          : "asc"
        : key === "name" || key === "status"
          ? "asc"
          : "desc"
    const nextSort = `${key}-${direction}` as InventorySortOption
    void navigate({
      replace: true,
      search: (previous) => ({
        ...previous,
        sort: nextSort === "name-asc" ? undefined : nextSort,
      }),
    })
  }

  return (
    <div className="animate-in duration-300 fade-in slide-in-from-bottom-1 motion-reduce:animate-none">
      <PageHeader
        action={
          <div className="flex flex-wrap justify-end gap-2">
            <ProductArchivesDialog />
            <ProductDialog onWriteRecipe={setRecipeProductId} />
          </div>
        }
        eyebrow="Gestion des stocks"
        title="Inventaire"
      >
        Les produits, ingrédients et services disponibles dans la boutique.
      </PageHeader>

      <section
        aria-label="Filtres de l'inventaire"
        className="mt-6 flex flex-col gap-3 border-y border-border/70 py-3 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <Search
            aria-hidden="true"
            className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label="Rechercher un produit"
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
            placeholder="Rechercher un produit…"
            type="search"
            value={search}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            aria-pressed={lowOnly}
            onClick={() =>
              void navigate({
                replace: true,
                search: (previous) => ({
                  ...previous,
                  stock: lowOnly ? undefined : "low",
                }),
              })
            }
            size="sm"
            type="button"
            variant={lowOnly ? "secondary" : "outline"}
          >
            <CircleAlert aria-hidden="true" />
            Stocks faibles
          </Button>
          <Tabs onValueChange={handleCategoryChange} value={category}>
            <TabsList
              aria-label="Catégories de l'inventaire"
              className="h-auto flex-wrap justify-start bg-[#6e5330]/8"
            >
              <SlidersHorizontal
                aria-hidden="true"
                className="mx-1 size-4 shrink-0 text-muted-foreground"
              />
              {categoryFilters.map((filter) => (
                <TabsTrigger
                  className="min-h-7 px-2.5 data-active:bg-primary data-active:text-primary-foreground"
                  key={filter.value}
                  value={filter.value}
                >
                  {filter.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <Select
            onValueChange={(value) => {
              if (!isInventorySortOption(value)) return
              void navigate({
                replace: true,
                search: (previous) => ({
                  ...previous,
                  sort: value === "name-asc" ? undefined : value,
                }),
              })
            }}
            value={sortOption}
          >
            <SelectTrigger
              aria-label="Trier l’inventaire"
              className="w-full bg-background/50 sm:w-48 md:hidden"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {inventorySortOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </section>

      <p className="mt-4 text-xs text-muted-foreground">
        {filteredProducts.length}{" "}
        {filteredProducts.length === 1 ? "référence" : "références"} sur{" "}
        {products.length}
      </p>

      {filteredProducts.length > 0 ? (
        <Card className="mt-4 rounded-none border-x-0 border-y border-t-2 border-[#5b462b]/35 bg-transparent py-0 ring-0 max-md:border-0">
          <CardContent className="px-0">
            <Table className="max-md:block">
              <TableHeader className="max-md:hidden">
                <TableRow className="border-b-[#5b462b]/50 bg-[#684f2d]/10 hover:bg-[#684f2d]/10">
                  <SortableTableHead
                    active={sortKey === "name"}
                    className="pl-4"
                    direction={sortDirection}
                    label="Référence"
                    onSort={() => handleSort("name")}
                  />
                  <TableHead>Catégorie</TableHead>
                  <SortableTableHead
                    active={sortKey === "stock"}
                    className="text-right"
                    direction={sortDirection}
                    inactiveDirection="desc"
                    label="Stock"
                    onSort={() => handleSort("stock")}
                  />
                  <TableHead className="text-right">Seuil</TableHead>
                  <SortableTableHead
                    active={sortKey === "price"}
                    className="text-right"
                    direction={sortDirection}
                    inactiveDirection="desc"
                    label="Prix"
                    onSort={() => handleSort("price")}
                  />
                  <SortableTableHead
                    active={sortKey === "status"}
                    className="pr-4 text-right"
                    direction={sortDirection}
                    label="État"
                    onSort={() => handleSort("status")}
                  />
                  <TableHead className="w-10">
                    <span className="sr-only">Modifier</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="max-md:grid max-md:gap-3">
                {visibleProducts.map((product) => (
                  <InventoryRow
                    hasAnyRecipe={linkedProducts.has(product._id)}
                    hasRecipe={activeRecipeProducts.has(product._id)}
                    key={product._id}
                    onWriteRecipe={setRecipeProductId}
                    product={product}
                  />
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : (
        <Alert className="mt-4 border-[#6a4f2e]/30 bg-card/35">
          <Search aria-hidden="true" />
          <AlertTitle>Aucun produit trouvé</AlertTitle>
          <AlertDescription>
            Modifiez la recherche, la catégorie ou le filtre de stock.
          </AlertDescription>
        </Alert>
      )}
      {recipeProduct ? (
        <RecipeDialog
          initialProduct={recipeProduct}
          linkedProductIds={linkedProductIds}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setRecipeProductId(undefined)
          }}
          open
          products={products}
          trigger={null}
        />
      ) : null}
    </div>
  )
}

function ProductState({ product }: Readonly<{ product: Doc<"products"> }>) {
  if (!product.tracksStock) {
    return (
      <Badge
        className="border-[#6b553a]/25 bg-[#6b553a]/[0.08] text-[#6b553a]"
        variant="outline"
      >
        Sur demande
      </Badge>
    )
  }

  const low = product.currentStock <= product.minimumStock

  return (
    <Badge
      className={cn(
        low
          ? "border-[#8a3f2f]/30 bg-[#8a3f2f]/[0.08] text-[#8a3f2f]"
          : "border-[#415741]/25 bg-[#415741]/[0.08] text-[#405541]"
      )}
      variant="outline"
    >
      {low ? <CircleAlert aria-hidden="true" /> : null}
      {low ? "Bas" : "Suffisant"}
    </Badge>
  )
}

function productPrice(product: Doc<"products">): string {
  const price = product.salePrice ?? product.purchasePrice
  return price === undefined ? "—" : formatUnitPrice(price)
}

function InventoryRow({
  hasAnyRecipe,
  hasRecipe,
  onWriteRecipe,
  product,
}: Readonly<{
  hasAnyRecipe: boolean
  hasRecipe: boolean
  onWriteRecipe: (productId: Id<"products">) => void
  product: Doc<"products">
}>) {
  const canWriteRecipe =
    isProductCraftable(product, hasAnyRecipe) && !hasAnyRecipe

  return (
    <TableRow className="border-[#5b462b]/20 hover:bg-[#fffdeb]/40 max-md:relative max-md:grid max-md:grid-cols-3 max-md:gap-x-3 max-md:gap-y-1 max-md:border max-md:border-[#5b462b]/35 max-md:bg-[#fff8e7]/30 max-md:p-4 max-md:shadow-[2px_3px_0_rgba(84,63,37,0.05)]">
      <TableCell className="max-w-80 pl-4 font-semibold max-md:col-span-2 max-md:col-start-1 max-md:row-start-1 max-md:max-w-none max-md:p-0 max-md:font-display max-md:text-base">
        <div className="flex min-w-0 items-center max-md:flex-wrap">
          <span className="truncate">{product.name}</span>
          {hasRecipe ? (
            <Button
              asChild
              className="ml-2 h-auto shrink-0 px-1 text-xs font-normal max-md:ml-1"
              size="sm"
              variant="link"
            >
              <Link
                search={{ q: product.name, view: "recipes" }}
                to="/recettes"
              >
                <BookOpenText aria-hidden="true" />
                Voir la recette
              </Link>
            </Button>
          ) : null}
        </div>
      </TableCell>
      <TableCell className="text-muted-foreground max-md:col-span-2 max-md:col-start-1 max-md:row-start-2 max-md:flex max-md:items-center max-md:gap-2 max-md:p-0">
        <span className="max-md:hidden">
          {categoryLabels[product.category]}
        </span>
        <Badge className="w-fit md:hidden" variant="secondary">
          {categoryLabels[product.category]}
        </Badge>
        {canWriteRecipe ? (
          <Button
            className="h-auto px-1 text-xs"
            onClick={() => onWriteRecipe(product._id)}
            size="sm"
            type="button"
            variant="link"
          >
            Écrire la recette
          </Button>
        ) : null}
      </TableCell>
      <TableCell className="text-right font-display text-base max-md:col-start-1 max-md:row-start-3 max-md:mt-3 max-md:p-0 max-md:text-left max-md:text-lg">
        <span className="mb-1 block font-sans text-xs text-muted-foreground md:hidden">
          Stock
        </span>
        {product.tracksStock ? formatNumber(product.currentStock) : "—"}
      </TableCell>
      <TableCell className="text-right text-muted-foreground max-md:col-start-2 max-md:row-start-3 max-md:mt-3 max-md:p-0 max-md:text-left max-md:font-display max-md:text-lg max-md:text-foreground">
        <span className="mb-1 block font-sans text-xs text-muted-foreground md:hidden">
          Seuil
        </span>
        {product.tracksStock ? formatNumber(product.minimumStock) : "—"}
      </TableCell>
      <TableCell className="text-right max-md:col-start-3 max-md:row-start-3 max-md:mt-3 max-md:p-0 max-md:text-left max-md:font-semibold">
        <span className="mb-1 block text-xs font-normal text-muted-foreground md:hidden">
          Prix
        </span>
        {productPrice(product)}
      </TableCell>
      <TableCell className="pr-4 text-right max-md:col-start-3 max-md:row-start-1 max-md:p-0 max-md:pr-9">
        <ProductState product={product} />
      </TableCell>
      <TableCell className="max-md:absolute max-md:top-2.5 max-md:right-2 max-md:p-0">
        <ProductDialog
          canWriteRecipe={canWriteRecipe}
          hasRecipe={hasAnyRecipe}
          onWriteRecipe={onWriteRecipe}
          product={product}
          trigger={
            <Button
              aria-label={`Modifier ${product.name}`}
              size="icon"
              variant="ghost"
            >
              <Pencil aria-hidden="true" />
            </Button>
          }
        />
      </TableCell>
    </TableRow>
  )
}
