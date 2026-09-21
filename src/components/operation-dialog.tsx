import { useForm, useStore } from "@tanstack/react-form"
import { useMutation } from "convex/react"
import { type FunctionReturnType } from "convex/server"
import {
  AlertTriangle,
  ArrowDownToLine,
  ChevronDown,
  ChevronsUpDown,
  Coins,
  Hammer,
  PackageOpen,
  Pencil,
  Plus,
  ReceiptText,
  ShoppingBasket,
  Trash2,
} from "lucide-react"
import { useId, useState, type ReactElement, type ReactNode } from "react"
import { toast } from "sonner"

import { DatePicker } from "@/components/date-picker"
import { PriceInput } from "@/components/price-input"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Label } from "@/components/ui/label"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { getUserFacingErrorMessage } from "@/lib/errors"
import { MAX_DYNAMIC_LINES, operationFormSchema } from "@/lib/form-schemas"
import { categoryLabels, formatNumber, formatSeptims } from "@/lib/format"
import {
  canonicalProductCategory,
  productCategories,
} from "@/lib/product-categories"
import {
  priceDraftFromValue,
  priceDraftToValue,
  roundSeptimsDown,
  type PriceDraft,
} from "@/lib/prices"
import { cn } from "@/lib/utils"
import { calculateProductionPlan } from "../../shared/production"
import { normalizeName } from "../../shared/text"
import { api } from "../../convex/_generated/api"
import { type Doc, type Id } from "../../convex/_generated/dataModel"

export type OperationKind =
  "exchange" | "production" | "purchase" | "sale" | "service"

type Bundle = FunctionReturnType<typeof api.recipes.listBundles>[number]
type Recipe = FunctionReturnType<typeof api.recipes.list>[number]
type Transaction = NonNullable<
  FunctionReturnType<typeof api.transactions.getDetails>
>
type TradeDirection = "incoming" | "outgoing"

interface TradeLine {
  direction: TradeDirection
  id: string
  kind: "bundle" | "product"
  name: string
  quantity: string
  unitPrice: PriceDraft
}

type TradeMutationLine =
  | {
      direction: TradeDirection
      kind: "product"
      productId: Id<"products">
      quantity: number
      unitPrice?: number
    }
  | {
      bundleId: Id<"bundles">
      direction: "outgoing"
      kind: "bundle"
      quantity: number
      unitPrice?: number
    }

function todayInputValue(): string {
  const today = new Date()
  const year = today.getFullYear()
  const month = String(today.getMonth() + 1).padStart(2, "0")
  const day = String(today.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function dateInputToTimestamp(value: string): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return undefined
  const timestamp = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    12
  ).getTime()
  return Number.isFinite(timestamp) ? timestamp : undefined
}

function timestampToDateInput(timestamp: number): string {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function productMatches(product: Doc<"products">, query: string): boolean {
  if (!query) return true
  return normalizeName(
    `${product.name} ${categoryLabels[product.category]}`
  ).includes(query)
}

function bundleMatches(bundle: Bundle, query: string): boolean {
  if (!query) return true
  return normalizeName(`${bundle.name} lot`).includes(query)
}

function getDefaultDirection(kind: OperationKind): TradeDirection {
  return kind === "purchase" ? "incoming" : "outgoing"
}

function initialTradeLines(
  transaction: Transaction | undefined,
  initialKind: OperationKind
): TradeLine[] {
  const fallbackDirection = getDefaultDirection(
    transaction?.kind === "purchase" ? "purchase" : initialKind
  )
  const existingLines = transaction?.lines.flatMap<TradeLine>((line) => {
    const id = line.kind === "bundle" ? line.bundleId : line.productId
    if (!id) return []
    return [
      {
        direction: line.direction ?? fallbackDirection,
        id,
        kind: line.kind,
        name: line.productName,
        quantity: line.quantity.toString(),
        unitPrice: priceDraftFromValue(line.unitPrice),
      },
    ]
  })
  const legacyLine =
    transaction &&
    transaction.kind !== "production" &&
    transaction.productId &&
    existingLines?.length === 0
      ? [
          {
            direction: fallbackDirection,
            id: transaction.productId,
            kind: "product" as const,
            name: transaction.productName,
            quantity: transaction.quantity.toString(),
            unitPrice: priceDraftFromValue(transaction.unitPrice),
          },
        ]
      : []
  return existingLines?.length ? existingLines : legacyLine
}

interface ProductPickerProps {
  ariaInvalid?: boolean
  label: string
  name?: string
  onBlur?: () => void
  onProductChange: (productId: string) => void
  products: readonly Doc<"products">[]
  selectedProduct: Doc<"products"> | undefined
}

function ProductPicker({
  ariaInvalid = false,
  label,
  name,
  onBlur,
  onProductChange,
  products,
  selectedProduct,
}: Readonly<ProductPickerProps>) {
  const [open, setOpen] = useState(false)
  const triggerId = useId()

  return (
    <div className="grid gap-2">
      <Label htmlFor={triggerId}>{label}</Label>
      <Popover onOpenChange={setOpen} open={open}>
        <PopoverTrigger asChild>
          <Button
            aria-expanded={open}
            aria-invalid={ariaInvalid}
            className="h-10 w-full justify-between bg-background/50 px-3 text-left text-sm font-normal"
            id={triggerId}
            name={name}
            onBlur={onBlur}
            role="combobox"
            type="button"
            variant="outline"
          >
            <span className="min-w-0 truncate">
              {selectedProduct?.name ?? "Rechercher un produit…"}
            </span>
            <span className="ml-auto flex shrink-0 items-center gap-2 pl-3 text-xs text-muted-foreground">
              {selectedProduct
                ? `${formatNumber(selectedProduct.currentStock)} en stock`
                : null}
              <ChevronsUpDown aria-hidden="true" className="size-3.5" />
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[var(--radix-popover-trigger-width)] rounded-[0.2rem] border-[#6a5436] bg-[#f4e8cf] p-0"
        >
          <Command className="rounded-[0.2rem] bg-transparent">
            <CommandInput placeholder="Nom du produit…" />
            <CommandList>
              <CommandEmpty>Aucun produit trouvé.</CommandEmpty>
              {productCategories.map((category) => {
                const entries = products.filter(
                  (product) =>
                    canonicalProductCategory(product.category) === category
                )
                if (entries.length === 0) return null

                return (
                  <CommandGroup
                    heading={categoryLabels[category]}
                    key={category}
                  >
                    {entries.map((product) => (
                      <CommandItem
                        data-checked={selectedProduct?._id === product._id}
                        key={product._id}
                        keywords={[product.name, categoryLabels[category]]}
                        onSelect={() => {
                          onProductChange(product._id)
                          setOpen(false)
                        }}
                        value={product._id}
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {product.name}
                        </span>
                        <span className="text-[0.68rem] text-muted-foreground tabular-nums">
                          {formatNumber(product.currentStock)} en stock
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )
              })}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
}

function TradeReferencePicker({
  bundles,
  direction,
  onSelect,
  products,
  usedReferences,
}: Readonly<{
  bundles: readonly Bundle[]
  direction: TradeDirection
  onSelect: (line: TradeLine) => void
  products: readonly Doc<"products">[]
  usedReferences: ReadonlySet<string>
}>) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const triggerId = useId()
  const normalizedQuery = normalizeName(query)
  const availableProducts = products.filter(
    (product) =>
      (direction === "outgoing" || product.tracksStock) &&
      !usedReferences.has(`${direction}:product:${product._id}`) &&
      productMatches(product, normalizedQuery)
  )
  const availableBundles =
    direction === "outgoing"
      ? bundles.filter(
          (bundle) =>
            !usedReferences.has(`${direction}:bundle:${bundle._id}`) &&
            bundleMatches(bundle, normalizedQuery)
        )
      : []

  return (
    <Popover
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) setQuery("")
      }}
      open={open}
    >
      <PopoverTrigger asChild>
        <Button
          aria-expanded={open}
          className="h-10 w-full justify-between bg-background/50 px-3 text-left text-sm font-normal"
          id={triggerId}
          role="combobox"
          type="button"
          variant="outline"
        >
          <span className="truncate">
            {direction === "outgoing"
              ? "Ajouter un produit, un service ou un lot…"
              : "Ajouter un produit acheté…"}
          </span>
          <ChevronsUpDown aria-hidden="true" className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] rounded-[0.2rem] border-[#6a5436] bg-[#f4e8cf] p-0"
      >
        <Command
          className="rounded-[0.2rem] bg-transparent"
          shouldFilter={false}
        >
          <CommandInput
            onValueChange={setQuery}
            placeholder={
              direction === "outgoing"
                ? "Produit, service ou lot…"
                : "Produit acheté…"
            }
            value={query}
          />
          <CommandList>
            <CommandEmpty>Aucune autre référence disponible.</CommandEmpty>
            {productCategories.map((category) => {
              const entries = availableProducts.filter(
                (product) =>
                  canonicalProductCategory(product.category) === category
              )
              if (entries.length === 0) return null

              return (
                <CommandGroup heading={categoryLabels[category]} key={category}>
                  {entries.map((product) => (
                    <CommandItem
                      key={product._id}
                      onSelect={() => {
                        onSelect({
                          direction,
                          id: product._id,
                          kind: "product",
                          name: product.name,
                          quantity: "1",
                          unitPrice: priceDraftFromValue(
                            direction === "incoming"
                              ? product.purchasePrice
                              : product.salePrice
                          ),
                        })
                        setOpen(false)
                      }}
                      value={`${direction}:product:${product._id}`}
                    >
                      {product.category === "service" ? (
                        <ReceiptText aria-hidden="true" />
                      ) : (
                        <ShoppingBasket aria-hidden="true" />
                      )}
                      <span className="min-w-0 flex-1 truncate">
                        {product.name}
                      </span>
                      {product.tracksStock ? (
                        <span className="text-[0.68rem] text-muted-foreground tabular-nums">
                          {formatNumber(product.currentStock)} en stock
                        </span>
                      ) : (
                        <span className="text-[0.68rem] text-muted-foreground">
                          Service
                        </span>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )
            })}
            {availableBundles.length > 0 ? (
              <CommandGroup heading="Lots préparés">
                {availableBundles.map((bundle) => (
                  <CommandItem
                    key={bundle._id}
                    onSelect={() => {
                      onSelect({
                        direction: "outgoing",
                        id: bundle._id,
                        kind: "bundle",
                        name: bundle.name,
                        quantity: "1",
                        unitPrice: priceDraftFromValue(bundle.price),
                      })
                      setOpen(false)
                    }}
                    value={`outgoing:bundle:${bundle._id}`}
                  >
                    <PackageOpen aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">
                      {bundle.name}
                    </span>
                    <span className="text-[0.68rem] text-muted-foreground">
                      Lot
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function TradeCart({
  bundles,
  direction,
  lines,
  onAdd,
  onRemove,
  onUpdate,
  products,
  renderLineFields,
}: Readonly<{
  bundles: readonly Bundle[]
  direction: TradeDirection
  lines: readonly TradeLine[]
  onAdd: (line: TradeLine) => void
  onRemove: (line: TradeLine) => void
  onUpdate: (line: TradeLine, patch: Partial<TradeLine>) => void
  products: readonly Doc<"products">[]
  renderLineFields?: (line: TradeLine, index: number) => ReactNode
}>) {
  const visibleLines = lines.filter((line) => line.direction === direction)
  const usedReferences = new Set(
    lines.map((line) => `${line.direction}:${line.kind}:${line.id}`)
  )
  const outgoing = direction === "outgoing"

  return (
    <Card className="gap-0 rounded-none border-[#5b462b]/30 bg-background/25 py-0 ring-0">
      <CardHeader className="gap-1 border-b border-border/60 p-4">
        <CardTitle className="flex items-center gap-2 font-display text-lg font-medium">
          {outgoing ? (
            <ShoppingBasket aria-hidden="true" className="size-4" />
          ) : (
            <ArrowDownToLine aria-hidden="true" className="size-4" />
          )}
          {outgoing ? "La boutique vend" : "La boutique achète"}
        </CardTitle>
        <CardDescription>
          {outgoing
            ? "Produits, services et lots remis au client."
            : "Produits reçus du client ou du fournisseur."}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 p-4">
        <TradeReferencePicker
          bundles={bundles}
          direction={direction}
          onSelect={onAdd}
          products={products}
          usedReferences={usedReferences}
        />
        {visibleLines.length > 0 ? (
          <div className="divide-y divide-border/70 border-y border-border/70">
            {visibleLines.map((line) => {
              const lineIndex = lines.indexOf(line)
              const inputPrefix = `${line.direction}-${line.kind}-${line.id}`
              const product =
                line.kind === "product"
                  ? products.find((entry) => entry._id === line.id)
                  : undefined
              const lineType =
                line.kind === "bundle"
                  ? "Lot préparé"
                  : product?.category === "service"
                    ? "Service"
                    : "Produit"

              return (
                <div className="grid gap-3 py-3" key={inputPrefix}>
                  <div className="flex min-w-0 items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">
                        {line.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {lineType}
                      </p>
                    </div>
                    <Button
                      aria-label={`Retirer ${line.name}`}
                      onClick={() => onRemove(line)}
                      size="icon-sm"
                      type="button"
                      variant="ghost"
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </div>
                  {renderLineFields ? (
                    renderLineFields(line, lineIndex)
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-[5.5rem_minmax(0,1fr)]">
                      <div className="grid gap-1.5">
                        <Label htmlFor={`${inputPrefix}-quantity`}>
                          Quantité
                        </Label>
                        <Input
                          id={`${inputPrefix}-quantity`}
                          min="1"
                          onChange={(event) =>
                            onUpdate(line, { quantity: event.target.value })
                          }
                          required
                          step="1"
                          type="number"
                          value={line.quantity}
                        />
                      </div>
                      <div className="grid gap-1.5">
                        <Label htmlFor={`${inputPrefix}-price`}>
                          Prix unitaire
                        </Label>
                        <PriceInput
                          id={`${inputPrefix}-price`}
                          onValueChange={(value) =>
                            onUpdate(line, { unitPrice: value })
                          }
                          value={line.unitPrice}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <p className="py-1 text-sm text-muted-foreground">
            {outgoing ? "Rien à remettre au client." : "Rien à réceptionner."}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

export function OperationDialog({
  bundles = [],
  characters,
  initialKind = "exchange",
  initialProductId,
  loading = false,
  onOpenChange,
  open: controlledOpen,
  products,
  recipes = [],
  transaction,
  trigger,
}: Readonly<{
  bundles?: readonly Bundle[]
  characters: readonly Doc<"characters">[]
  initialKind?: OperationKind
  initialProductId?: Id<"products">
  loading?: boolean
  onOpenChange?: (open: boolean) => void
  open?: boolean
  products: readonly Doc<"products">[]
  recipes?: readonly Recipe[]
  transaction?: Transaction
  trigger?: ReactElement | null
}>) {
  const recordProduction = useMutation(api.transactions.record)
  const recordExchange = useMutation(api.transactions.recordExchange)
  const updateExchange = useMutation(api.transactions.updateExchange)
  const updateTransaction = useMutation(api.transactions.update)
  const formId = useId()
  const productionMode =
    transaction?.kind === "production" || initialKind === "production"
  const linkedOrderMode = Boolean(transaction?.orderId)
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const [detailsOpen, setDetailsOpen] = useState(Boolean(transaction))

  function operationValues() {
    return {
      agreedTotal: transaction?.orderId
        ? Math.abs(transaction.total).toString()
        : "",
      characterId: transaction?.actorCharacterId ?? "",
      comment: transaction?.comment ?? "",
      counterparty: transaction?.counterparty ?? "",
      discount: transaction?.discount?.toString() ?? "",
      linkedOrderMode,
      occurredOn: transaction
        ? timestampToDateInput(transaction.occurredAt)
        : todayInputValue(),
      productId: transaction?.productId ?? initialProductId ?? "",
      productionMode,
      quantity: transaction?.quantity.toString() ?? "1",
      tradeLines: initialTradeLines(transaction, initialKind),
    }
  }

  const form = useForm({
    defaultValues: operationValues(),
    validators: { onSubmit: operationFormSchema },
    onSubmit: async ({ value }) => {
      const character = characters.find(
        (entry) => entry._id === value.characterId
      )
      const occurredAt = dateInputToTimestamp(value.occurredOn)
      if (!character || !occurredAt) return

      try {
        if (productionMode) {
          const product = productionProducts.find(
            (entry) => entry._id === value.productId
          )
          if (!product) return
          const args = {
            characterId: character._id,
            ...(value.comment.trim() ? { comment: value.comment.trim() } : {}),
            ...(transaction?.kind === "production" && transaction.counterparty
              ? { counterparty: transaction.counterparty }
              : {}),
            kind: "production" as const,
            occurredAt,
            productId: product._id,
            quantity: Number(value.quantity),
          }
          if (transaction) {
            await updateTransaction({ ...args, transactionId: transaction._id })
          } else {
            await recordProduction(args)
          }
        } else {
          const lines = prepareTradeLines(value.tradeLines)
          if (!lines?.length || invalidAgreedTotal || invalidDiscount) return
          const args = {
            ...(linkedOrderMode
              ? { agreedTotal: Number(value.agreedTotal) }
              : {}),
            characterId: character._id,
            ...(value.comment.trim() ? { comment: value.comment.trim() } : {}),
            ...(value.counterparty.trim()
              ? { counterparty: value.counterparty.trim() }
              : {}),
            ...(!linkedOrderMode && Number(value.discount) > 0
              ? { discount: Number(value.discount) }
              : {}),
            lines,
            occurredAt,
          }
          if (transaction) {
            await updateExchange({ ...args, transactionId: transaction._id })
          } else {
            await recordExchange(args)
          }
        }
        toast.success(
          transaction
            ? "Opération mise à jour."
            : productionMode
              ? "Production enregistrée : ingrédients consommés et stock mis à jour."
              : "Échange enregistré."
        )
        if (controlledOpen === undefined) setInternalOpen(false)
        onOpenChange?.(false)
      } catch (error) {
        toast.error(
          getUserFacingErrorMessage(
            error,
            "Impossible d’enregistrer cette opération."
          )
        )
      }
    },
  })
  const formValues = useStore(form.store, (state) => state.values)

  const previousDeltas = new Map(
    transaction?.stockDeltas.map((entry) => [entry.productId, entry.delta]) ??
      []
  )
  const correctedProducts = products.map((product) => {
    const previousDelta = previousDeltas.get(product._id) ?? 0
    return previousDelta === 0
      ? product
      : { ...product, currentStock: product.currentStock - previousDelta }
  })
  const craftableProducts = new Set(
    recipes.flatMap((recipe) => (recipe.productId ? [recipe.productId] : []))
  )
  const productionProducts = correctedProducts.filter(
    (product) =>
      product.tracksStock &&
      (craftableProducts.has(product._id) ||
        transaction?.productId === product._id)
  )
  const selectedProduct = productionProducts.find(
    (product) => product._id === formValues.productId
  )
  const selectedRecipe = recipes.find(
    (recipe) => recipe.productId === selectedProduct?._id
  )
  const parsedQuantity = Number(formValues.quantity)
  const previewQuantity =
    Number.isFinite(parsedQuantity) && parsedQuantity > 0 ? parsedQuantity : 0
  const validProductionQuantity =
    Number.isInteger(parsedQuantity) && parsedQuantity > 0
  const productionPlan = calculateProductionPlan(
    selectedRecipe,
    correctedProducts,
    parsedQuantity
  )
  const parsedDiscount = formValues.discount.trim()
    ? Number(formValues.discount)
    : 0
  const previewDiscount = Number.isFinite(parsedDiscount) ? parsedDiscount : 0
  const parsedAgreedTotal = Number(formValues.agreedTotal)
  const previewAgreedTotal = Number.isSafeInteger(parsedAgreedTotal)
    ? parsedAgreedTotal
    : 0

  function lineTotal(line: TradeLine): number {
    const quantityValue = Number(line.quantity)
    const fallbackPrice =
      line.kind === "bundle"
        ? bundles.find((bundle) => bundle._id === line.id)?.price
        : line.direction === "incoming"
          ? correctedProducts.find((product) => product._id === line.id)
              ?.purchasePrice
          : correctedProducts.find((product) => product._id === line.id)
              ?.salePrice
    const price = priceDraftToValue(line.unitPrice) ?? fallbackPrice ?? 0
    return Number.isFinite(quantityValue) && Number.isFinite(price)
      ? quantityValue * price
      : 0
  }

  const outgoingGross = formValues.tradeLines
    .filter((line) => line.direction === "outgoing")
    .reduce((sum, line) => sum + lineTotal(line), 0)
  const incomingGross = formValues.tradeLines
    .filter((line) => line.direction === "incoming")
    .reduce((sum, line) => sum + lineTotal(line), 0)
  const hasOutgoingLines = formValues.tradeLines.some(
    (line) => line.direction === "outgoing"
  )
  const hasIncomingLines = formValues.tradeLines.some(
    (line) => line.direction === "incoming"
  )
  const outgoingTotal =
    linkedOrderMode && hasOutgoingLines
      ? previewAgreedTotal
      : roundSeptimsDown(Math.max(0, outgoingGross - previewDiscount))
  const incomingTotal =
    linkedOrderMode && hasIncomingLines
      ? previewAgreedTotal
      : roundSeptimsDown(incomingGross)
  const netTotal = outgoingTotal - incomingTotal
  const roundingTolerance =
    Number.EPSILON * Math.max(1, outgoingGross, incomingGross) * 8
  const isPreviewRounded =
    !linkedOrderMode &&
    (Math.abs(outgoingTotal - (outgoingGross - previewDiscount)) >
      roundingTolerance ||
      Math.abs(incomingTotal - incomingGross) > roundingTolerance)

  const stockDeltas = new Map<string, number>()
  for (const line of formValues.tradeLines) {
    const lineQuantity = Number(line.quantity)
    if (!Number.isFinite(lineQuantity) || lineQuantity <= 0) continue
    if (line.kind === "product") {
      const product = correctedProducts.find((entry) => entry._id === line.id)
      if (!product?.tracksStock) continue
      stockDeltas.set(
        line.id,
        (stockDeltas.get(line.id) ?? 0) +
          (line.direction === "incoming" ? lineQuantity : -lineQuantity)
      )
      continue
    }
    const bundle = bundles.find((entry) => entry._id === line.id)
    for (const item of bundle?.items ?? []) {
      if (!item.productId) continue
      stockDeltas.set(
        item.productId,
        (stockDeltas.get(item.productId) ?? 0) - item.quantity * lineQuantity
      )
    }
  }
  const insufficientProducts = correctedProducts.filter(
    (product) => product.currentStock + (stockDeltas.get(product._id) ?? 0) < 0
  )
  const productionStock = selectedProduct
    ? selectedProduct.currentStock + previewQuantity
    : undefined
  const invalidDiscount =
    !Number.isFinite(parsedDiscount) ||
    parsedDiscount < 0 ||
    parsedDiscount > outgoingGross
  const invalidAgreedTotal =
    linkedOrderMode &&
    (!Number.isSafeInteger(parsedAgreedTotal) || parsedAgreedTotal < 0)

  function updateTradeLine(line: TradeLine, patch: Partial<TradeLine>) {
    form.setFieldValue("tradeLines", (current) =>
      current.map((entry) =>
        entry.direction === line.direction &&
        entry.kind === line.kind &&
        entry.id === line.id
          ? { ...entry, ...patch }
          : entry
      )
    )
  }

  function removeTradeLine(line: TradeLine) {
    form.setFieldValue("tradeLines", (current) =>
      current.filter(
        (entry) =>
          entry.direction !== line.direction ||
          entry.kind !== line.kind ||
          entry.id !== line.id
      )
    )
  }

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen && !open) {
      form.reset(operationValues())
      setDetailsOpen(Boolean(transaction))
    }
    if (controlledOpen === undefined) setInternalOpen(nextOpen)
    onOpenChange?.(nextOpen)
  }

  function prepareTradeLines(
    tradeLines: readonly TradeLine[]
  ): TradeMutationLine[] | undefined {
    const prepared = tradeLines.flatMap<TradeMutationLine>((line) => {
      const lineQuantity = Number(line.quantity)
      const linePrice = priceDraftToValue(line.unitPrice) ?? undefined
      if (
        !Number.isFinite(lineQuantity) ||
        !Number.isInteger(lineQuantity) ||
        lineQuantity <= 0 ||
        (linePrice !== undefined &&
          (!Number.isFinite(linePrice) || linePrice < 0))
      ) {
        return []
      }
      if (line.kind === "product") {
        const product = correctedProducts.find((entry) => entry._id === line.id)
        return product
          ? [
              {
                direction: line.direction,
                kind: "product" as const,
                productId: product._id,
                quantity: lineQuantity,
                ...(linePrice === undefined ? {} : { unitPrice: linePrice }),
              },
            ]
          : []
      }
      const bundle = bundles.find((entry) => entry._id === line.id)
      return bundle && line.direction === "outgoing"
        ? [
            {
              bundleId: bundle._id,
              direction: "outgoing" as const,
              kind: "bundle" as const,
              quantity: lineQuantity,
              ...(linePrice === undefined ? {} : { unitPrice: linePrice }),
            },
          ]
        : []
    })
    return prepared.length === tradeLines.length ? prepared : undefined
  }

  const dialogTitle = productionMode
    ? transaction
      ? "Modifier la production"
      : "Enregistrer une production"
    : transaction
      ? linkedOrderMode
        ? "Modifier la transaction de commande"
        : "Modifier l’échange"
      : "Enregistrer un échange"
  const submitLabel =
    netTotal > 0
      ? `Encaisser ${formatSeptims(netTotal)}`
      : netTotal < 0
        ? `Payer ${formatSeptims(Math.abs(netTotal))}`
        : "Valider l’échange"

  function renderTradeLineFields(line: TradeLine, index: number) {
    const inputPrefix = `${line.direction}-${line.kind}-${line.id}`
    return (
      <div className="grid gap-3 sm:grid-cols-[5.5rem_minmax(0,1fr)]">
        <form.Field name={`tradeLines[${index}].quantity`}>
          {(field) => {
            const invalid =
              field.state.meta.isTouched && !field.state.meta.isValid
            return (
              <Field data-invalid={invalid}>
                <FieldLabel htmlFor={`${inputPrefix}-quantity`}>
                  Quantité
                </FieldLabel>
                <Input
                  aria-invalid={invalid}
                  id={`${inputPrefix}-quantity`}
                  min="1"
                  name={field.name}
                  onBlur={field.handleBlur}
                  onChange={(event) =>
                    updateTradeLine(line, { quantity: event.target.value })
                  }
                  required
                  step="1"
                  type="number"
                  value={field.state.value}
                />
                {invalid ? (
                  <FieldError errors={field.state.meta.errors} />
                ) : null}
              </Field>
            )
          }}
        </form.Field>
        <form.Field name={`tradeLines[${index}].unitPrice`}>
          {(field) => {
            const invalid =
              field.state.meta.isTouched && !field.state.meta.isValid
            return (
              <Field data-invalid={invalid}>
                <FieldLabel htmlFor={`${inputPrefix}-price`}>
                  Prix unitaire
                </FieldLabel>
                <PriceInput
                  ariaInvalid={invalid}
                  id={`${inputPrefix}-price`}
                  name={field.name}
                  onBlur={field.handleBlur}
                  onValueChange={(value) =>
                    updateTradeLine(line, { unitPrice: value })
                  }
                  value={field.state.value}
                />
                {invalid ? (
                  <FieldError errors={field.state.meta.errors} />
                ) : null}
              </Field>
            )
          }}
        </form.Field>
      </div>
    )
  }

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      {trigger === null ? null : (
        <DialogTrigger asChild>
          {trigger ?? (
            <Button size="lg">
              <Plus aria-hidden="true" />
              {productionMode ? "Nouvelle production" : "Nouvel échange"}
            </Button>
          )}
        </DialogTrigger>
      )}
      <DialogContent className="max-h-[94svh] overflow-y-auto rounded-[0.2rem] border-[#6a5436] bg-[#eee1c7] ring-0 sm:max-w-3xl">
        <DialogHeader className="pr-8">
          <p className="text-[0.66rem] font-bold tracking-[0.2em] text-primary uppercase">
            {productionMode
              ? "Atelier de production"
              : "Transaction financière"}
          </p>
          <DialogTitle className="font-display text-2xl">
            {dialogTitle}
          </DialogTitle>
          <DialogDescription>
            {transaction
              ? "Le stock et les montants seront recalculés à partir de cette correction."
              : productionMode
                ? "Fabriquez depuis une recette : les ingrédients seront consommés et le produit fini ajouté au stock."
                : "Réunissez dans le même panier tout ce qui entre et sort de la boutique."}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div
            aria-live="polite"
            className="flex min-h-56 items-center justify-center gap-2 text-sm text-muted-foreground"
          >
            <Spinner
              aria-hidden="true"
              className="motion-reduce:animate-none"
            />
            Chargement des données…
          </div>
        ) : null}
        <form
          aria-hidden={loading || undefined}
          className={cn("mt-1 grid gap-5", loading && "hidden")}
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            void form.handleSubmit()
          }}
        >
          {productionMode ? (
            <>
              <form.Field name="productId">
                {(field) => {
                  const invalid =
                    field.state.meta.isTouched && !field.state.meta.isValid
                  return (
                    <Field data-invalid={invalid}>
                      <ProductPicker
                        ariaInvalid={invalid}
                        label="Produit fabriqué"
                        name={field.name}
                        onBlur={field.handleBlur}
                        onProductChange={field.handleChange}
                        products={productionProducts}
                        selectedProduct={selectedProduct}
                      />
                      {invalid ? (
                        <FieldError errors={field.state.meta.errors} />
                      ) : null}
                    </Field>
                  )
                }}
              </form.Field>
              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_9rem]">
                <form.Field name="characterId">
                  {(field) => {
                    const invalid =
                      field.state.meta.isTouched && !field.state.meta.isValid
                    return (
                      <Field data-invalid={invalid}>
                        <FieldLabel htmlFor={`${formId}-character`}>
                          Personnage
                        </FieldLabel>
                        <Select
                          name={field.name}
                          onValueChange={field.handleChange}
                          value={field.state.value}
                        >
                          <SelectTrigger
                            aria-invalid={invalid}
                            className="h-10 w-full bg-background/50"
                            id={`${formId}-character`}
                            onBlur={field.handleBlur}
                          >
                            <SelectValue placeholder="Qui réalise la production ?" />
                          </SelectTrigger>
                          <SelectContent>
                            {characters.map((character) => (
                              <SelectItem
                                key={character._id}
                                value={character._id}
                              >
                                {character.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {invalid ? (
                          <FieldError errors={field.state.meta.errors} />
                        ) : null}
                      </Field>
                    )
                  }}
                </form.Field>
                <form.Field name="quantity">
                  {(field) => {
                    const invalid =
                      field.state.meta.isTouched && !field.state.meta.isValid
                    return (
                      <Field data-invalid={invalid}>
                        <FieldLabel htmlFor={`${formId}-quantity`}>
                          Quantité
                        </FieldLabel>
                        <Input
                          aria-invalid={invalid}
                          id={`${formId}-quantity`}
                          min="1"
                          name={field.name}
                          onBlur={field.handleBlur}
                          onChange={(event) =>
                            field.handleChange(event.target.value)
                          }
                          required
                          step="1"
                          type="number"
                          value={field.state.value}
                        />
                        {invalid ? (
                          <FieldError errors={field.state.meta.errors} />
                        ) : null}
                      </Field>
                    )
                  }}
                </form.Field>
              </div>
              {selectedProduct ? (
                <Alert
                  className={cn(
                    productionPlan.complete &&
                      (!validProductionQuantity || productionPlan.canProduce)
                      ? "border-primary/25 bg-primary/[0.045]"
                      : "border-destructive/35 bg-destructive/[0.045]"
                  )}
                  variant={
                    productionPlan.complete &&
                    (!validProductionQuantity || productionPlan.canProduce)
                      ? "default"
                      : "destructive"
                  }
                >
                  {productionPlan.complete &&
                  (!validProductionQuantity || productionPlan.canProduce) ? (
                    <Hammer aria-hidden="true" />
                  ) : (
                    <AlertTriangle aria-hidden="true" />
                  )}
                  <AlertTitle>
                    {!productionPlan.complete
                      ? "Recette incomplète"
                      : validProductionQuantity && !productionPlan.canProduce
                        ? "Ingrédients insuffisants"
                        : `${formatNumber(productionPlan.maximumQuantity)} fabricable${productionPlan.maximumQuantity === 1 ? "" : "s"} au maximum`}
                  </AlertTitle>
                  <AlertDescription className="grid gap-2">
                    <span>
                      Stock du produit fini :{" "}
                      {formatNumber(selectedProduct.currentStock)} →{" "}
                      {formatNumber(
                        productionStock ?? selectedProduct.currentStock
                      )}
                    </span>
                    <span className="grid gap-1 border-t border-current/15 pt-2">
                      {productionPlan.requirements.map((requirement) => {
                        const insufficient =
                          requirement.available === undefined ||
                          (validProductionQuantity &&
                            requirement.required > requirement.available)
                        return (
                          <span
                            className={cn(
                              "flex justify-between gap-3",
                              insufficient && "font-semibold"
                            )}
                            key={
                              requirement.productId ??
                              requirement.ingredientName
                            }
                          >
                            <span>{requirement.ingredientName}</span>
                            <span className="text-right tabular-nums">
                              {validProductionQuantity
                                ? `${formatNumber(requirement.required)} requis`
                                : `${formatNumber(requirement.requiredPerUnit)} par unité`}{" "}
                              ·{" "}
                              {requirement.available === undefined
                                ? "stock introuvable"
                                : `${formatNumber(requirement.available)} en stock`}
                            </span>
                          </span>
                        )
                      })}
                    </span>
                  </AlertDescription>
                </Alert>
              ) : null}
            </>
          ) : (
            <>
              <form.Field name="tradeLines">
                {(field) => {
                  const invalid =
                    field.state.meta.isTouched && !field.state.meta.isValid
                  return (
                    <Field data-invalid={invalid}>
                      <div className="grid gap-4 md:grid-cols-2">
                        <TradeCart
                          bundles={bundles}
                          direction="outgoing"
                          lines={formValues.tradeLines}
                          onAdd={(line) => {
                            if (
                              formValues.tradeLines.length >= MAX_DYNAMIC_LINES
                            )
                              return
                            form.setFieldValue("tradeLines", (current) => [
                              ...current,
                              line,
                            ])
                          }}
                          onRemove={removeTradeLine}
                          onUpdate={updateTradeLine}
                          products={correctedProducts}
                          renderLineFields={renderTradeLineFields}
                        />
                        <TradeCart
                          bundles={bundles}
                          direction="incoming"
                          lines={formValues.tradeLines}
                          onAdd={(line) => {
                            if (
                              formValues.tradeLines.length >= MAX_DYNAMIC_LINES
                            )
                              return
                            form.setFieldValue("tradeLines", (current) => [
                              ...current,
                              line,
                            ])
                          }}
                          onRemove={removeTradeLine}
                          onUpdate={updateTradeLine}
                          products={correctedProducts}
                          renderLineFields={renderTradeLineFields}
                        />
                      </div>
                      {invalid ? (
                        <FieldError errors={field.state.meta.errors} />
                      ) : null}
                    </Field>
                  )
                }}
              </form.Field>

              <form.Field name="characterId">
                {(field) => {
                  const invalid =
                    field.state.meta.isTouched && !field.state.meta.isValid
                  return (
                    <Field data-invalid={invalid}>
                      <FieldLabel htmlFor={`${formId}-character`}>
                        Personnage
                      </FieldLabel>
                      <Select
                        name={field.name}
                        onValueChange={field.handleChange}
                        value={field.state.value}
                      >
                        <SelectTrigger
                          aria-invalid={invalid}
                          className="h-10 w-full bg-background/50"
                          id={`${formId}-character`}
                          onBlur={field.handleBlur}
                        >
                          <SelectValue placeholder="Qui réalise l’échange ?" />
                        </SelectTrigger>
                        <SelectContent>
                          {characters.map((character) => (
                            <SelectItem
                              key={character._id}
                              value={character._id}
                            >
                              {character.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {invalid ? (
                        <FieldError errors={field.state.meta.errors} />
                      ) : null}
                    </Field>
                  )
                }}
              </form.Field>

              {formValues.tradeLines.length > 0 ? (
                <Alert
                  className={cn(
                    insufficientProducts.length > 0
                      ? "border-destructive/35 bg-destructive/[0.045]"
                      : "border-primary/25 bg-primary/[0.045]"
                  )}
                  variant={
                    insufficientProducts.length > 0 ? "destructive" : "default"
                  }
                >
                  <Coins aria-hidden="true" />
                  <AlertTitle>
                    {insufficientProducts.length > 0
                      ? "Stock insuffisant"
                      : netTotal > 0
                        ? `À encaisser : ${formatSeptims(netTotal)}`
                        : netTotal < 0
                          ? `À payer : ${formatSeptims(Math.abs(netTotal))}`
                          : "Échange équilibré"}
                  </AlertTitle>
                  <AlertDescription className="flex flex-wrap gap-x-5 gap-y-1">
                    {insufficientProducts.length > 0 ? (
                      <span>
                        À corriger :{" "}
                        {insufficientProducts
                          .map((product) => product.name)
                          .join(", ")}
                      </span>
                    ) : (
                      <>
                        {outgoingGross > 0 ? (
                          <span>Vendu : {formatSeptims(outgoingTotal)}</span>
                        ) : null}
                        {incomingGross > 0 ? (
                          <span>Acheté : {formatSeptims(incomingTotal)}</span>
                        ) : null}
                        {isPreviewRounded ? (
                          <span className="text-muted-foreground">
                            Arrondi au septim inférieur
                          </span>
                        ) : null}
                      </>
                    )}
                  </AlertDescription>
                </Alert>
              ) : null}
            </>
          )}

          <Collapsible onOpenChange={setDetailsOpen} open={detailsOpen}>
            <CollapsibleTrigger asChild>
              <Button
                className="w-full justify-between border-y border-border/70 px-1"
                type="button"
                variant="ghost"
              >
                {productionMode
                  ? "Date et détails facultatifs"
                  : linkedOrderMode
                    ? "Date, total convenu et détails"
                    : "Date, remise et détails facultatifs"}
                <ChevronDown
                  aria-hidden="true"
                  className={cn(
                    "transition-transform",
                    detailsOpen && "rotate-180"
                  )}
                />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="animate-in pt-4 duration-200 fade-in slide-in-from-top-1 motion-reduce:animate-none">
              <div
                className={cn(
                  "grid gap-4",
                  !productionMode && "sm:grid-cols-2"
                )}
              >
                {!productionMode ? (
                  linkedOrderMode ? (
                    <form.Field name="agreedTotal">
                      {(field) => {
                        const invalid =
                          field.state.meta.isTouched &&
                          !field.state.meta.isValid
                        return (
                          <Field data-invalid={invalid}>
                            <FieldLabel htmlFor={`${formId}-agreed-total`}>
                              Total convenu de la commande
                            </FieldLabel>
                            <Input
                              aria-invalid={invalid}
                              id={`${formId}-agreed-total`}
                              min="0"
                              name={field.name}
                              onBlur={field.handleBlur}
                              onChange={(event) =>
                                field.handleChange(event.target.value)
                              }
                              placeholder="0"
                              step="1"
                              type="number"
                              value={field.state.value}
                            />
                            {invalid ? (
                              <FieldError errors={field.state.meta.errors} />
                            ) : null}
                          </Field>
                        )
                      }}
                    </form.Field>
                  ) : (
                    <form.Field
                      name="discount"
                      validators={{
                        onSubmit: ({ value }) => {
                          const parsed = value.trim() ? Number(value) : 0
                          return !Number.isFinite(parsed) ||
                            parsed < 0 ||
                            parsed > outgoingGross
                            ? "La remise doit rester comprise dans le total vendu."
                            : undefined
                        },
                      }}
                    >
                      {(field) => {
                        const invalid =
                          field.state.meta.isTouched &&
                          !field.state.meta.isValid
                        return (
                          <Field data-invalid={invalid}>
                            <FieldLabel htmlFor={`${formId}-discount`}>
                              Remise sur ce qui est vendu
                            </FieldLabel>
                            <Input
                              aria-invalid={invalid}
                              id={`${formId}-discount`}
                              min="0"
                              name={field.name}
                              onBlur={field.handleBlur}
                              onChange={(event) =>
                                field.handleChange(event.target.value)
                              }
                              placeholder="0"
                              step="any"
                              type="number"
                              value={field.state.value}
                            />
                            {invalid ? (
                              <FieldError errors={field.state.meta.errors} />
                            ) : null}
                          </Field>
                        )
                      }}
                    </form.Field>
                  )
                ) : null}
                <form.Field name="occurredOn">
                  {(field) => {
                    const invalid =
                      field.state.meta.isTouched && !field.state.meta.isValid
                    return (
                      <Field data-invalid={invalid}>
                        <FieldLabel htmlFor={`${formId}-date`}>Date</FieldLabel>
                        <DatePicker
                          ariaInvalid={invalid}
                          ariaLabel="Date de l’opération"
                          id={`${formId}-date`}
                          max={todayInputValue()}
                          name={field.name}
                          onBlur={field.handleBlur}
                          onChange={field.handleChange}
                          required
                          value={field.state.value}
                        />
                        {invalid ? (
                          <FieldError errors={field.state.meta.errors} />
                        ) : null}
                      </Field>
                    )
                  }}
                </form.Field>
              </div>

              <Separator className="my-4" />
              <div
                className={cn(
                  "grid gap-4",
                  !productionMode && "sm:grid-cols-2"
                )}
              >
                {!productionMode ? (
                  <form.Field name="counterparty">
                    {(field) => {
                      const invalid =
                        field.state.meta.isTouched && !field.state.meta.isValid
                      return (
                        <Field data-invalid={invalid}>
                          <FieldLabel htmlFor={`${formId}-counterparty`}>
                            Client, fournisseur ou interlocuteur
                          </FieldLabel>
                          <Input
                            aria-invalid={invalid}
                            autoComplete="off"
                            id={`${formId}-counterparty`}
                            maxLength={500}
                            name="transaction-counterparty"
                            onBlur={field.handleBlur}
                            onChange={(event) =>
                              field.handleChange(event.target.value)
                            }
                            placeholder="Facultatif"
                            value={field.state.value}
                          />
                          {invalid ? (
                            <FieldError errors={field.state.meta.errors} />
                          ) : null}
                        </Field>
                      )
                    }}
                  </form.Field>
                ) : null}
                <form.Field name="comment">
                  {(field) => {
                    const invalid =
                      field.state.meta.isTouched && !field.state.meta.isValid
                    return (
                      <Field data-invalid={invalid}>
                        <FieldLabel htmlFor={`${formId}-comment`}>
                          Note interne
                        </FieldLabel>
                        <Textarea
                          aria-invalid={invalid}
                          id={`${formId}-comment`}
                          maxLength={500}
                          name={field.name}
                          onBlur={field.handleBlur}
                          onChange={(event) =>
                            field.handleChange(event.target.value)
                          }
                          placeholder="Informations utiles…"
                          rows={2}
                          value={field.state.value}
                        />
                        {invalid ? (
                          <FieldError errors={field.state.meta.errors} />
                        ) : null}
                      </Field>
                    )
                  }}
                </form.Field>
              </div>
            </CollapsibleContent>
          </Collapsible>

          <DialogFooter>
            <Button
              onClick={() => handleOpenChange(false)}
              type="button"
              variant="ghost"
            >
              Annuler
            </Button>
            <form.Subscribe selector={(state) => state.isSubmitting}>
              {(isSubmitting) => (
                <Button
                  disabled={
                    isSubmitting ||
                    (productionMode &&
                      Boolean(selectedProduct) &&
                      validProductionQuantity &&
                      !productionPlan.canProduce) ||
                    insufficientProducts.length > 0
                  }
                  type="submit"
                >
                  {isSubmitting ? (
                    <Spinner
                      aria-hidden="true"
                      className="motion-reduce:animate-none"
                    />
                  ) : transaction ? (
                    <>
                      <Pencil aria-hidden="true" />
                      Enregistrer les modifications
                    </>
                  ) : productionMode ? (
                    <>
                      <Hammer aria-hidden="true" />
                      Enregistrer la production
                    </>
                  ) : (
                    submitLabel
                  )}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
