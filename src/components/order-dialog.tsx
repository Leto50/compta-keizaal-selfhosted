import { useForm, useStore } from "@tanstack/react-form"
import { useMutation } from "convex/react"
import { type FunctionReturnType } from "convex/server"
import { ClipboardPlus, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react"
import { useId, useRef, useState, type ReactElement } from "react"
import { toast } from "sonner"

import { DatePicker } from "@/components/date-picker"
import { PriceInput } from "@/components/price-input"
import { OrderPreparationDetails } from "@/components/order-preparation-details"
import { ProductPicker } from "@/components/product-picker"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
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
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group"
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
import { api } from "../../convex/_generated/api"
import { type Doc } from "../../convex/_generated/dataModel"
import { getUserFacingErrorMessage } from "@/lib/errors"
import {
  MAX_AMOUNT,
  MAX_DYNAMIC_LINES,
  orderFormSchema,
} from "@/lib/form-schemas"
import { formatOrderStatus, formatSeptims } from "@/lib/format"
import { calculateOrderPreparation } from "@/lib/order-preparation"
import {
  priceDraftFromValue,
  priceDraftToValue,
  roundSeptimsDown,
  type PriceDraft,
} from "@/lib/prices"
import {
  normalizeOrderStatus,
  orderStatusesForKind,
} from "../../shared/order-status"

type Order = NonNullable<FunctionReturnType<typeof api.orders.getById>>
type Recipe = FunctionReturnType<typeof api.recipes.list>[number]
type OrderKind = Order["kind"]
type OrderStatus = Order["status"]

interface OrderLineDraft {
  key: number
  productId: string
  quantity: string
  unitPrice: PriceDraft
}

function dateInputFromTimestamp(timestamp: number | undefined): string {
  if (timestamp === undefined) return ""
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function timestampFromDateInput(value: string): number | null {
  if (!value) return null
  const timestamp = new Date(`${value}T12:00:00`).getTime()
  return Number.isFinite(timestamp) ? timestamp : Number.NaN
}

function defaultPrice(product: Doc<"products">, kind: OrderKind) {
  return kind === "client" ? product.salePrice : product.purchasePrice
}

function initialOrderLines(order: Order | undefined): OrderLineDraft[] {
  if (order?.lines.length) {
    return order.lines.map((line, index) => ({
      key: index,
      productId: line.productId ?? "",
      quantity: line.quantity.toString(),
      unitPrice: priceDraftFromValue(line.unitPrice),
    }))
  }
  return [
    {
      key: 0,
      productId: "",
      quantity: "1",
      unitPrice: priceDraftFromValue(undefined),
    },
  ]
}

export function OrderDialog({
  characters,
  contacts,
  copyFrom,
  initialKind = "client",
  onOpenChange,
  open: controlledOpen,
  order,
  products,
  recipes,
  trigger,
}: Readonly<{
  characters: readonly Doc<"characters">[]
  contacts: readonly Doc<"contacts">[]
  copyFrom?: Order
  initialKind?: OrderKind
  onOpenChange?: (open: boolean) => void
  open?: boolean
  order?: Order
  products: readonly Doc<"products">[]
  recipes: readonly Recipe[]
  trigger?: ReactElement | null
}>) {
  const saveOrder = useMutation(api.orders.save)
  const removeOrder = useMutation(api.orders.remove)
  const fieldId = useId()
  const sourceOrder = order ?? copyFrom
  const isRenewal = !order && copyFrom !== undefined
  const nextLineKey = useRef(sourceOrder?.lines.length ?? 1)
  const [internalOpen, setInternalOpen] = useState(false)
  const [todayValue] = useState(() => dateInputFromTimestamp(Date.now()))
  const open = controlledOpen ?? internalOpen
  const [isDeleting, setIsDeleting] = useState(false)

  function orderValues() {
    return {
      agreedTotal: sourceOrder?.total?.toString() ?? "",
      contactId: sourceOrder?.contactId ?? "",
      contactName: sourceOrder?.contactName ?? "",
      dueDate: isRenewal ? "" : dateInputFromTimestamp(order?.dueAt),
      kind: sourceOrder?.kind ?? initialKind,
      lines: initialOrderLines(sourceOrder),
      notes: sourceOrder?.notes ?? "",
      processedCharacterId: order?.linkedTransaction?.actorCharacterId ?? "",
      processedDate: dateInputFromTimestamp(
        order?.processedAt ?? order?.linkedTransaction?.occurredAt
      ),
      requiresProcessedDetails: Boolean(order?.transactionId),
      status: order
        ? normalizeOrderStatus(order.kind, order.status)
        : ("open" as const),
      totalOverridden: sourceOrder?.total !== undefined,
    }
  }

  const form = useForm({
    defaultValues: orderValues(),
    validators: { onSubmit: orderFormSchema },
    onSubmit: async ({ value }) => {
      const submittedDueAt = timestampFromDateInput(value.dueDate)
      const submittedProcessedAt = timestampFromDateInput(value.processedDate)
      const submittedTotal = value.totalOverridden
        ? value.agreedTotal
        : (automaticTotal?.toString() ?? "")
      const agreedTotalValue = submittedTotal.trim()
        ? Number(submittedTotal)
        : null

      try {
        await saveOrder({
          ...(order?.transactionId
            ? {
                actorCharacterId:
                  value.processedCharacterId as Doc<"characters">["_id"],
                processedAt: submittedProcessedAt!,
              }
            : {}),
          ...(value.contactId
            ? { contactId: value.contactId as Doc<"contacts">["_id"] }
            : {}),
          contactName: value.contactName.trim(),
          dueAt: submittedDueAt,
          kind: value.kind,
          lines: value.lines.map((line) => ({
            productId: line.productId as Doc<"products">["_id"],
            quantity: Number(line.quantity),
            unitPrice: priceDraftToValue(line.unitPrice),
          })),
          notes: value.notes.trim(),
          ...(order ? { orderId: order._id } : {}),
          status: value.status,
          total: agreedTotalValue,
        })
        toast.success(
          order?.transactionId
            ? "Commande, transaction et stock mis à jour."
            : order
              ? "Commande mise à jour."
              : isRenewal
                ? "Nouvelle commande créée."
                : "Commande créée."
        )
        if (controlledOpen === undefined) setInternalOpen(false)
        onOpenChange?.(false)
      } catch (error) {
        toast.error(
          getUserFacingErrorMessage(
            error,
            "Impossible d’enregistrer la commande."
          )
        )
      }
    },
  })
  const formValues = useStore(form.store, (state) => state.values)

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen && !open) {
      form.reset(orderValues())
      nextLineKey.current = Math.max(1, sourceOrder?.lines.length ?? 0)
    }
    if (controlledOpen === undefined) setInternalOpen(nextOpen)
    onOpenChange?.(nextOpen)
  }

  function updateLine(key: number, patch: Partial<OrderLineDraft>) {
    form.setFieldValue("lines", (current) =>
      current.map((line) => (line.key === key ? { ...line, ...patch } : line))
    )
  }

  function selectProduct(key: number, productId: string | undefined) {
    const product = products.find((entry) => entry._id === productId)
    updateLine(key, {
      productId: product?._id ?? "",
      unitPrice: priceDraftFromValue(
        product ? defaultPrice(product, formValues.kind) : undefined
      ),
    })
  }

  function addLine() {
    const key = nextLineKey.current
    nextLineKey.current += 1
    form.setFieldValue("lines", (current) => [
      ...current,
      {
        key,
        productId: "",
        quantity: "1",
        unitPrice: priceDraftFromValue(undefined),
      },
    ])
  }

  function removeLine(key: number) {
    form.setFieldValue("lines", (current) =>
      current.filter((line) => line.key !== key)
    )
  }

  const lineValues = formValues.lines.map((line) => ({
    quantity: Number(line.quantity),
    unitPrice: priceDraftToValue(line.unitPrice),
  }))
  const gross = lineValues.reduce(
    (sum, line) => sum + line.quantity * (line.unitPrice ?? 0),
    0
  )
  const automaticTotal = lineValues.every(
    (line) =>
      Number.isFinite(line.quantity) &&
      line.quantity > 0 &&
      line.unitPrice !== null &&
      Number.isFinite(line.unitPrice)
  )
    ? roundSeptimsDown(gross)
    : undefined
  const displayedTotal = formValues.totalOverridden
    ? formValues.agreedTotal
    : (automaticTotal?.toString() ?? "")
  const preparation = calculateOrderPreparation(
    formValues.lines.map((line) => ({
      productId: line.productId || undefined,
      productName:
        products.find((product) => product._id === line.productId)?.name ??
        "Référence non choisie",
      quantity: Number(line.quantity),
    })),
    products,
    recipes
  )
  const suggestedContacts = contacts.filter(
    (contact) => contact.kind === formValues.kind
  )

  function updateContactName(value: string) {
    form.setFieldValue("contactName", value)
    form.setFieldValue(
      "contactId",
      suggestedContacts.find((contact) => contact.name === value)?._id ?? ""
    )
  }

  async function deleteOrder() {
    if (!order) return
    setIsDeleting(true)
    try {
      await removeOrder({ orderId: order._id })
      toast.success("Commande supprimée.")
      if (controlledOpen === undefined) setInternalOpen(false)
      onOpenChange?.(false)
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Impossible de supprimer la commande.")
      )
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      {trigger === null ? null : (
        <DialogTrigger asChild>
          {trigger ?? (
            <Button>
              <ClipboardPlus aria-hidden="true" />
              Nouvelle commande
            </Button>
          )}
        </DialogTrigger>
      )}
      <DialogContent className="max-h-[94svh] overflow-y-auto rounded-[0.2rem] border-[#6a5436] bg-[#eee1c7] ring-0 sm:max-w-3xl">
        <DialogHeader className="pr-8">
          <p className="text-[0.66rem] font-bold tracking-[0.2em] text-primary uppercase">
            Suivi des commandes
          </p>
          <DialogTitle className="font-display text-2xl">
            {order
              ? "Modifier la commande"
              : isRenewal
                ? "Renouveler la commande"
                : "Créer une commande"}
          </DialogTitle>
          <DialogDescription>
            {order?.transactionId
              ? "Corrigez la commande sans perdre la transaction déjà associée."
              : isRenewal
                ? "Une nouvelle commande indépendante est créée à partir de l’ancienne."
                : "Une commande prépare un échange futur et ne modifie pas encore le stock."}
          </DialogDescription>
        </DialogHeader>

        {order?.transactionId ? (
          <Alert className="border-primary/30 bg-primary/[0.04]">
            <RefreshCw aria-hidden="true" />
            <AlertTitle>Correction synchronisée</AlertTitle>
            <AlertDescription>
              Les lignes, le total, le personnage, la date, la transaction et le
              stock seront corrigés ensemble.
            </AlertDescription>
          </Alert>
        ) : null}

        <form
          className="grid gap-5"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            void form.handleSubmit()
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <form.Field name="kind">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor={`${fieldId}-kind`}>
                    Type de commande
                  </FieldLabel>
                  <Select
                    name={field.name}
                    onValueChange={(value) => {
                      if (value === "client" || value === "supplier") {
                        if (value !== field.state.value) {
                          form.setFieldValue("contactId", "")
                          form.setFieldValue("contactName", "")
                          if (
                            !orderStatusesForKind(value).includes(
                              formValues.status
                            )
                          ) {
                            form.setFieldValue("status", "open")
                          }
                        }
                        field.handleChange(value)
                      }
                    }}
                    value={field.state.value}
                  >
                    <SelectTrigger
                      className="w-full"
                      id={`${fieldId}-kind`}
                      onBlur={field.handleBlur}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="client">Commande client</SelectItem>
                      <SelectItem value="supplier">
                        Commande fournisseur
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              )}
            </form.Field>
            <form.Field name="contactName">
              {(field) => {
                const invalid =
                  field.state.meta.isTouched && !field.state.meta.isValid
                return (
                  <Field data-invalid={invalid}>
                    <FieldLabel htmlFor={`${fieldId}-contact`}>
                      {formValues.kind === "client" ? "Client" : "Fournisseur"}
                    </FieldLabel>
                    <Input
                      aria-invalid={invalid}
                      autoComplete="off"
                      id={`${fieldId}-contact`}
                      list={`${fieldId}-contact-suggestions`}
                      maxLength={100}
                      name="order-contact-name"
                      onBlur={field.handleBlur}
                      onChange={(event) =>
                        updateContactName(event.target.value)
                      }
                      placeholder={
                        formValues.kind === "client"
                          ? "Nom du client"
                          : "Nom du fournisseur"
                      }
                      required
                      value={field.state.value}
                    />
                    <datalist id={`${fieldId}-contact-suggestions`}>
                      {suggestedContacts.map((contact) => (
                        <option key={contact._id} value={contact.name} />
                      ))}
                    </datalist>
                    <FieldDescription>
                      {suggestedContacts.length > 0
                        ? "Choisissez un contact existant ou saisissez un nouveau nom."
                        : "Ce nom sera ajouté au carnet après l’enregistrement."}
                    </FieldDescription>
                    {invalid ? (
                      <FieldError errors={field.state.meta.errors} />
                    ) : null}
                  </Field>
                )
              }}
            </form.Field>
          </div>

          {order?.transactionId ? (
            <Card className="gap-0 rounded-none border-primary/25 bg-primary/[0.035] py-0 ring-0">
              <CardContent className="grid gap-4 p-3 sm:grid-cols-2">
                <form.Field name="processedCharacterId">
                  {(field) => {
                    const invalid =
                      field.state.meta.isTouched && !field.state.meta.isValid
                    return (
                      <Field className="min-w-0" data-invalid={invalid}>
                        <FieldLabel htmlFor={`${fieldId}-processed-character`}>
                          Personnage de la transaction
                        </FieldLabel>
                        <Select
                          name={field.name}
                          onValueChange={field.handleChange}
                          value={field.state.value}
                        >
                          <SelectTrigger
                            aria-invalid={invalid}
                            className="w-full"
                            id={`${fieldId}-processed-character`}
                            onBlur={field.handleBlur}
                          >
                            <SelectValue placeholder="Choisir un personnage" />
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
                <form.Field name="processedDate">
                  {(field) => {
                    const invalid =
                      field.state.meta.isTouched && !field.state.meta.isValid
                    return (
                      <Field data-invalid={invalid}>
                        <FieldLabel htmlFor={`${fieldId}-processed-date`}>
                          {formValues.kind === "client"
                            ? "Date du paiement"
                            : "Date de réception"}
                        </FieldLabel>
                        <DatePicker
                          ariaInvalid={invalid}
                          ariaLabel={
                            formValues.kind === "client"
                              ? "Date du paiement"
                              : "Date de réception"
                          }
                          id={`${fieldId}-processed-date`}
                          max={todayValue}
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
              </CardContent>
            </Card>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <form.Field name="dueDate">
              {(field) => {
                const invalid =
                  field.state.meta.isTouched && !field.state.meta.isValid
                return (
                  <Field data-invalid={invalid}>
                    <FieldLabel htmlFor={`${fieldId}-due-date`}>
                      {formValues.kind === "client"
                        ? "Livraison prévue"
                        : "Réception prévue"}
                    </FieldLabel>
                    <DatePicker
                      ariaInvalid={invalid}
                      ariaLabel={
                        formValues.kind === "client"
                          ? "Livraison prévue"
                          : "Réception prévue"
                      }
                      id={`${fieldId}-due-date`}
                      name={field.name}
                      onBlur={field.handleBlur}
                      onChange={field.handleChange}
                      value={field.state.value}
                    />
                    {invalid ? (
                      <FieldError errors={field.state.meta.errors} />
                    ) : null}
                  </Field>
                )
              }}
            </form.Field>
            <form.Field name="status">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor={`${fieldId}-status`}>État</FieldLabel>
                  <Select
                    name={field.name}
                    onValueChange={(value) => {
                      if (
                        orderStatusesForKind(formValues.kind).includes(
                          value as OrderStatus
                        )
                      ) {
                        field.handleChange(value as OrderStatus)
                      }
                    }}
                    value={field.state.value}
                  >
                    <SelectTrigger
                      className="w-full"
                      id={`${fieldId}-status`}
                      onBlur={field.handleBlur}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {orderStatusesForKind(formValues.kind).map((entry) => (
                        <SelectItem key={entry} value={entry}>
                          {formatOrderStatus(entry, formValues.kind)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
            </form.Field>
          </div>

          <Separator />
          <div className="grid gap-3">
            <div className="flex items-end justify-between gap-3">
              <div>
                <FieldLabel>Contenu</FieldLabel>
                <p className="mt-1 text-xs text-muted-foreground">
                  Le prix peut être laissé vide s’il reste à convenir.
                </p>
              </div>
              <Button
                disabled={formValues.lines.length >= MAX_DYNAMIC_LINES}
                onClick={addLine}
                size="sm"
                type="button"
                variant="outline"
              >
                <Plus aria-hidden="true" />
                Ajouter
              </Button>
            </div>

            {formValues.lines.map((line, index) => (
              <div
                className="grid gap-3 border-l-2 border-primary/35 pl-3 sm:grid-cols-[minmax(10rem,1fr)_6rem_minmax(14rem,1fr)_auto] sm:items-end"
                key={line.key}
              >
                <form.Field name={`lines[${index}].productId`}>
                  {(field) => {
                    const invalid =
                      field.state.meta.isTouched && !field.state.meta.isValid
                    return (
                      <Field className="min-w-0" data-invalid={invalid}>
                        <FieldLabel>Produit {index + 1}</FieldLabel>
                        <ProductPicker
                          ariaInvalid={invalid}
                          name={field.name}
                          onBlur={field.handleBlur}
                          onChange={(value) => selectProduct(line.key, value)}
                          products={
                            formValues.kind === "supplier"
                              ? products.filter(
                                  (product) => product.tracksStock
                                )
                              : products
                          }
                          selectedProductId={field.state.value}
                        />
                        {invalid ? (
                          <FieldError errors={field.state.meta.errors} />
                        ) : null}
                      </Field>
                    )
                  }}
                </form.Field>
                <form.Field name={`lines[${index}].quantity`}>
                  {(field) => {
                    const invalid =
                      field.state.meta.isTouched && !field.state.meta.isValid
                    return (
                      <Field data-invalid={invalid}>
                        <FieldLabel htmlFor={`${fieldId}-quantity-${line.key}`}>
                          Quantité
                        </FieldLabel>
                        <Input
                          aria-invalid={invalid}
                          id={`${fieldId}-quantity-${line.key}`}
                          min="1"
                          name={field.name}
                          onBlur={field.handleBlur}
                          onChange={(event) =>
                            updateLine(line.key, {
                              quantity: event.target.value,
                            })
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
                <form.Field name={`lines[${index}].unitPrice`}>
                  {(field) => {
                    const invalid =
                      field.state.meta.isTouched && !field.state.meta.isValid
                    return (
                      <Field data-invalid={invalid}>
                        <FieldLabel htmlFor={`${fieldId}-price-${line.key}`}>
                          Prix unitaire
                        </FieldLabel>
                        <PriceInput
                          ariaInvalid={invalid}
                          id={`${fieldId}-price-${line.key}`}
                          name={field.name}
                          onBlur={field.handleBlur}
                          onValueChange={(value) =>
                            updateLine(line.key, { unitPrice: value })
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
                <Button
                  aria-label={`Retirer le produit ${index + 1}`}
                  disabled={formValues.lines.length === 1}
                  onClick={() => removeLine(line.key)}
                  size="icon-lg"
                  type="button"
                  variant="ghost"
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
            ))}
          </div>

          {formValues.kind === "client" ? (
            <OrderPreparationDetails
              defaultOpen={!order}
              preparation={preparation}
            />
          ) : null}

          <form.Field name="notes">
            {(field) => {
              const invalid =
                field.state.meta.isTouched && !field.state.meta.isValid
              return (
                <Field data-invalid={invalid}>
                  <FieldLabel htmlFor={`${fieldId}-notes`}>Notes</FieldLabel>
                  <Textarea
                    aria-invalid={invalid}
                    id={`${fieldId}-notes`}
                    maxLength={1000}
                    name={field.name}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder="Détails utiles pour préparer ou remettre la commande."
                    value={field.state.value}
                  />
                  {invalid ? (
                    <FieldError errors={field.state.meta.errors} />
                  ) : null}
                </Field>
              )
            }}
          </form.Field>

          <Card className="gap-0 rounded-none border-primary/25 bg-primary/[0.035] py-0 ring-0">
            <CardContent className="grid gap-4 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(13rem,0.8fr)] sm:items-end">
              <div>
                <p className="text-[0.65rem] tracking-wider text-muted-foreground uppercase">
                  Total des lignes
                </p>
                <p className="mt-1 font-display text-xl">
                  {automaticTotal === undefined
                    ? "À calculer"
                    : formatSeptims(automaticTotal)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Base indicative avant négociation du montant final.
                </p>
              </div>
              <form.Field
                name="agreedTotal"
                validators={{
                  onSubmit: ({ value }) => {
                    const submitted = formValues.totalOverridden
                      ? value
                      : (automaticTotal?.toString() ?? "")
                    if (!submitted.trim()) return undefined
                    const parsed = Number(submitted)
                    return !Number.isSafeInteger(parsed) ||
                      parsed < 0 ||
                      parsed > MAX_AMOUNT
                      ? `Le total convenu doit être un nombre entier compris entre 0 et ${MAX_AMOUNT}.`
                      : undefined
                  },
                }}
              >
                {(field) => {
                  const invalid =
                    field.state.meta.isTouched && !field.state.meta.isValid
                  return (
                    <Field className="min-w-0" data-invalid={invalid}>
                      <div className="flex items-center justify-between gap-2">
                        <FieldLabel htmlFor={`${fieldId}-agreed-total`}>
                          Total convenu
                        </FieldLabel>
                        {formValues.totalOverridden &&
                        automaticTotal !== undefined ? (
                          <Button
                            className="h-auto px-1 py-0 text-xs"
                            onClick={() => {
                              field.handleChange("")
                              form.setFieldValue("totalOverridden", false)
                            }}
                            type="button"
                            variant="link"
                          >
                            <RefreshCw aria-hidden="true" />
                            Reprendre le calcul
                          </Button>
                        ) : null}
                      </div>
                      <InputGroup className="bg-background/50">
                        <InputGroupInput
                          aria-invalid={invalid}
                          id={`${fieldId}-agreed-total`}
                          min="0"
                          name={field.name}
                          onBlur={field.handleBlur}
                          onChange={(event) => {
                            field.handleChange(event.target.value)
                            form.setFieldValue("totalOverridden", true)
                          }}
                          placeholder="À convenir"
                          step="1"
                          type="number"
                          value={displayedTotal}
                        />
                        <InputGroupAddon align="inline-end">
                          <InputGroupText>septims</InputGroupText>
                        </InputGroupAddon>
                      </InputGroup>
                      {invalid ? (
                        <FieldError errors={field.state.meta.errors} />
                      ) : null}
                    </Field>
                  )
                }}
              </form.Field>
            </CardContent>
          </Card>

          <DialogFooter className="gap-2 sm:justify-between">
            <div>
              {order && !order.transactionId ? (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button type="button" variant="ghost">
                      <Trash2 aria-hidden="true" />
                      Supprimer
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent className="rounded-[0.2rem] border-[#6a5436] bg-[#eee1c7]">
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        Supprimer la commande de « {order.contactName} » ?
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        La commande et ses lignes seront supprimées. Aucun
                        mouvement de stock n’est lié à cette préparation.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Conserver</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => {
                          void deleteOrder()
                        }}
                      >
                        Supprimer la commande
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              ) : null}
            </div>
            <div className="flex justify-end gap-2">
              <Button
                onClick={() => handleOpenChange(false)}
                type="button"
                variant="ghost"
              >
                Annuler
              </Button>
              <form.Subscribe selector={(state) => state.isSubmitting}>
                {(isSubmitting) => (
                  <Button disabled={isSubmitting || isDeleting} type="submit">
                    {isSubmitting ? (
                      <Spinner
                        aria-hidden="true"
                        className="motion-reduce:animate-none"
                      />
                    ) : order ? (
                      <Pencil aria-hidden="true" />
                    ) : (
                      <ClipboardPlus aria-hidden="true" />
                    )}
                    {order ? "Enregistrer" : "Créer la commande"}
                  </Button>
                )}
              </form.Subscribe>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
