import { convexQuery } from "@convex-dev/react-query"
import { useForm } from "@tanstack/react-form"
import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useMutation, useQuery as useConvexQuery } from "convex/react"
import { type FunctionReturnType } from "convex/server"
import {
  AlertTriangle,
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  Coins,
  History,
  MessageSquareText,
  PackageCheck,
  Pencil,
  Repeat2,
  Store,
} from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { ContactManagerDialog } from "@/components/contact-manager-dialog"
import { DatePicker } from "@/components/date-picker"
import { OrderDialog } from "@/components/order-dialog"
import { OrderPreparationDetails } from "@/components/order-preparation-details"
import { PageError } from "@/components/page-error"
import { PageHeader } from "@/components/page-header"
import { PageSkeleton } from "@/components/page-skeleton"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { api } from "../../../convex/_generated/api"
import { type Doc } from "../../../convex/_generated/dataModel"
import { getUserFacingErrorMessage } from "@/lib/errors"
import { orderProcessingFormSchema } from "@/lib/form-schemas"
import {
  formatDate,
  formatNumber,
  formatOrderStatus,
  formatSeptims,
  formatUnitPrice,
} from "@/lib/format"
import { calculateOrderPreparation } from "@/lib/order-preparation"
import { cn } from "@/lib/utils"
import {
  clientOrderStatuses,
  normalizeOrderStatus,
  orderStatusesForKind,
} from "../../../shared/order-status"
import {
  orderIsHistorical,
  orderIsOverdue,
  orderNeedsAttention,
} from "../../../shared/order-attention"

type Order = NonNullable<FunctionReturnType<typeof api.orders.getById>>
type Recipe = FunctionReturnType<typeof api.recipes.list>[number]
type OrderStatus = Order["status"]
type OrderKind = Order["kind"]
type OrderView = "attention" | "history" | OrderKind

const HISTORY_PAGE_SIZE = 20

interface HistoryPaginationState {
  cursor: string | null
  previousCursors: Array<string | null>
}

const orderToneClasses: Readonly<Record<OrderStatus, string>> = {
  cancelled: "border-t-[#8a4233]",
  delivered: "border-t-[#81613d]",
  open: "border-t-[#81613d]",
  ready: "border-t-[#4f6a4e]",
}

const statusBadgeClasses: Readonly<Record<OrderStatus, string>> = {
  cancelled: "border-[#8a4233]/30 text-[#8a4233]",
  delivered: "border-[#81613d]/30 text-[#81613d]",
  open: "border-[#81613d]/30 text-[#81613d]",
  ready: "border-[#4f6a4e]/30 text-[#4f6a4e]",
}

function isOrderStatus(value: string): value is OrderStatus {
  return clientOrderStatuses.includes(value as OrderStatus)
}

function historyQueryArgs(cursor: string | null) {
  return { paginationOpts: { cursor, numItems: HISTORY_PAGE_SIZE } }
}

function isOrderKind(value: string): value is OrderKind {
  return value === "client" || value === "supplier"
}

function isOrderView(value: string): value is OrderView {
  return value === "attention" || value === "history" || isOrderKind(value)
}

function validateOrderSearch(search: Record<string, unknown>) {
  return {
    view:
      typeof search.view === "string" && isOrderView(search.view)
        ? search.view
        : ("client" as const),
  }
}

export const Route = createFileRoute("/_app/commandes")({
  component: OrdersPage,
  errorComponent: PageError,
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(
        convexQuery(api.orders.listAttention, {})
      ),
      context.queryClient.ensureQueryData(
        convexQuery(api.orders.listHistoryPage, historyQueryArgs(null))
      ),
      context.queryClient.ensureQueryData(convexQuery(api.contacts.list, {})),
      context.queryClient.ensureQueryData(
        convexQuery(api.products.selectable, {})
      ),
      context.queryClient.ensureQueryData(convexQuery(api.characters.list, {})),
      context.queryClient.ensureQueryData(convexQuery(api.recipes.list, {})),
    ])
  },
  pendingComponent: PageSkeleton,
  validateSearch: validateOrderSearch,
})

function OrdersPage() {
  const { view } = Route.useSearch()
  const navigate = Route.useNavigate()
  const [historyPagination, setHistoryPagination] =
    useState<HistoryPaginationState>({ cursor: null, previousCursors: [] })
  const { data: attentionOrders } = useSuspenseQuery(
    convexQuery(api.orders.listAttention, {})
  )
  const { data: initialHistoryPage } = useSuspenseQuery(
    convexQuery(api.orders.listHistoryPage, historyQueryArgs(null))
  )
  const liveHistoryPage = useConvexQuery(
    api.orders.listHistoryPage,
    historyQueryArgs(historyPagination.cursor)
  )
  const historyPage =
    liveHistoryPage ??
    (historyPagination.cursor === null ? initialHistoryPage : undefined)
  const historicalOrders = historyPage?.page ?? []
  const isFetchingHistoryPage = liveHistoryPage === undefined
  const { data: contacts } = useSuspenseQuery(
    convexQuery(api.contacts.list, {})
  )
  const { data: products } = useSuspenseQuery(
    convexQuery(api.products.selectable, {})
  )
  const { data: characters } = useSuspenseQuery(
    convexQuery(api.characters.list, {})
  )
  const { data: recipes } = useSuspenseQuery(convexQuery(api.recipes.list, {}))
  const updateStatus = useMutation(api.orders.updateStatus)
  const kind = view === "supplier" ? "supplier" : "client"
  const selectedOrders =
    view === "history"
      ? historicalOrders
      : view === "attention"
        ? attentionOrders
        : attentionOrders.filter((order) => order.kind === view)
  const visibleOrders = [...selectedOrders].sort((left, right) => {
    if (view === "history") return 0

    const leftNeedsAttention = orderNeedsAttention(left)
    const rightNeedsAttention = orderNeedsAttention(right)
    const attentionOrder =
      Number(rightNeedsAttention) - Number(leftNeedsAttention)
    if (attentionOrder !== 0) return attentionOrder

    if (leftNeedsAttention) {
      return (
        Number(orderIsOverdue(right)) - Number(orderIsOverdue(left)) ||
        (left.dueAt ?? Number.MAX_SAFE_INTEGER) -
          (right.dueAt ?? Number.MAX_SAFE_INTEGER)
      )
    }

    return right._creationTime - left._creationTime
  })
  const visibleCount = visibleOrders.length

  async function handleStatusChange(order: Order, value: string) {
    if (
      !isOrderStatus(value) ||
      !orderStatusesForKind(order.kind).includes(value)
    )
      return
    try {
      await updateStatus({ orderId: order._id, status: value })
      const updatedOrder = { ...order, status: value }
      if (value === "cancelled") {
        toast.success("Commande annulée et déplacée dans l’historique.")
      } else if (
        orderIsHistorical(order) &&
        orderNeedsAttention(updatedOrder)
      ) {
        toast.success("Commande replacée dans les commandes à traiter.")
      } else if (!orderNeedsAttention(updatedOrder)) {
        toast.success("Commande terminée et déplacée dans l’historique.")
      } else if (
        order.kind === "client" &&
        value === "delivered" &&
        !order.transactionId
      ) {
        toast.success(
          "Commande livrée. Enregistrez le paiement pour la terminer."
        )
      } else {
        toast.success("L’état de la commande a été mis à jour.")
      }
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(
          error,
          "Impossible de modifier cette commande."
        )
      )
    }
  }

  function handleViewChange(value: string) {
    if (!isOrderView(value)) return
    void navigate({ replace: true, search: { view: value } })
  }

  function showPreviousHistoryPage() {
    const previousCursor = historyPagination.previousCursors.at(-1)
    if (previousCursor === undefined) return
    setHistoryPagination({
      cursor: previousCursor,
      previousCursors: historyPagination.previousCursors.slice(0, -1),
    })
  }

  function showNextHistoryPage() {
    if (!historyPage || historyPage.isDone) return
    setHistoryPagination({
      cursor: historyPage.continueCursor,
      previousCursors: [
        ...historyPagination.previousCursors,
        historyPagination.cursor,
      ],
    })
  }

  return (
    <div className="animate-in duration-300 fade-in slide-in-from-bottom-1 motion-reduce:animate-none">
      <PageHeader
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ContactManagerDialog />
            <OrderDialog
              characters={characters}
              contacts={contacts}
              initialKind={kind}
              products={products}
              recipes={recipes}
            />
          </div>
        }
        eyebrow="Suivi des commandes"
        title="Commandes"
      >
        Les commandes clients et les achats attendus des fournisseurs.
      </PageHeader>

      <div className="mt-7 flex flex-wrap items-center justify-between gap-4 border-y border-border/70 py-3">
        <Tabs
          className="max-w-full min-w-0"
          onValueChange={handleViewChange}
          value={view}
        >
          <TabsList
            aria-label="Vue des commandes"
            className="max-w-full [scrollbar-width:none] justify-start overflow-x-auto overflow-y-hidden bg-[#6e5330]/8 max-sm:[&_svg]:hidden [&::-webkit-scrollbar]:hidden"
          >
            <TabsTrigger value="attention">
              <AlertTriangle aria-hidden="true" />À traiter
            </TabsTrigger>
            <TabsTrigger value="client">
              <PackageCheck aria-hidden="true" />
              Clients
            </TabsTrigger>
            <TabsTrigger value="supplier">
              <Store aria-hidden="true" />
              Fournisseurs
            </TabsTrigger>
            <TabsTrigger value="history">
              <History aria-hidden="true" />
              Historique
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <p className="text-sm text-muted-foreground">
          <strong className="font-display text-lg text-foreground">
            {visibleCount}
          </strong>{" "}
          {view === "history"
            ? visibleCount === 1
              ? "commande sur cette page"
              : "commandes sur cette page"
            : visibleCount === 1
              ? "commande à traiter"
              : "commandes à traiter"}
        </p>
      </div>

      {visibleOrders.length > 0 ? (
        <div className="mt-6 grid gap-5 xl:grid-cols-2">
          {visibleOrders.map((order) => (
            <OrderEntry
              characters={characters}
              contacts={contacts}
              key={order._id}
              onStatusChange={(value) => handleStatusChange(order, value)}
              order={order}
              products={products}
              recipes={recipes}
            />
          ))}
        </div>
      ) : (
        <Alert className="mt-6 border-[#6a4f2e]/30 bg-card/35">
          {view === "history" ? (
            <History aria-hidden="true" />
          ) : kind === "client" ? (
            <PackageCheck aria-hidden="true" />
          ) : (
            <Store aria-hidden="true" />
          )}
          <AlertTitle>
            {view === "history" ? "Historique vide" : "Aucune commande"}
          </AlertTitle>
          <AlertDescription>
            {view === "history"
              ? "Les commandes terminées ou annulées apparaîtront ici."
              : view === "attention"
                ? "Aucune préparation, réception ou paiement ne demande votre attention."
                : "Aucune commande de ce type ne demande votre attention."}
          </AlertDescription>
        </Alert>
      )}
      {view === "history" ? (
        <nav
          aria-label="Pagination de l’historique des commandes"
          className="mt-5 flex items-center justify-between gap-3 border-t border-[#5b462b]/20 pt-4"
        >
          <Button
            disabled={
              historyPagination.previousCursors.length === 0 ||
              isFetchingHistoryPage
            }
            onClick={showPreviousHistoryPage}
            size="sm"
            type="button"
            variant="outline"
          >
            <ChevronLeft aria-hidden="true" />
            Précédente
          </Button>
          <span className="text-xs text-muted-foreground">
            Page {historyPagination.previousCursors.length + 1}
          </span>
          <Button
            disabled={
              !historyPage || historyPage.isDone || isFetchingHistoryPage
            }
            onClick={showNextHistoryPage}
            size="sm"
            type="button"
            variant="outline"
          >
            Suivante
            <ChevronRight aria-hidden="true" />
          </Button>
        </nav>
      ) : null}
    </div>
  )
}

function orderTotal(order: Order): number | undefined {
  if (order.total !== undefined) return order.total
  const lineTotals = order.lines
    .map((line) => line.total)
    .filter((value): value is number => value !== undefined)
  return lineTotals.length === order.lines.length && lineTotals.length > 0
    ? lineTotals.reduce((total, value) => total + value, 0)
    : undefined
}

function OrderEntry({
  characters,
  contacts,
  onStatusChange,
  order,
  products,
  recipes,
}: Readonly<{
  characters: readonly Doc<"characters">[]
  contacts: readonly Doc<"contacts">[]
  onStatusChange: (value: string) => void
  order: Order
  products: readonly Doc<"products">[]
  recipes: readonly Recipe[]
}>) {
  const total = orderTotal(order)
  const preparation = calculateOrderPreparation(order.lines, products, recipes)
  const overdue = orderIsOverdue(order)
  const displayedStatus = normalizeOrderStatus(order.kind, order.status)

  return (
    <Card
      className={cn(
        "rounded-none border-t-[3px] border-[#5b462b]/35 bg-[#fff8e7]/30 shadow-[3px_4px_0_rgba(76,56,32,0.05)] ring-0",
        orderToneClasses[displayedStatus],
        !orderNeedsAttention(order) && "opacity-75",
        overdue && "border-t-[#9a3f31]"
      )}
    >
      <CardHeader>
        <CardTitle className="font-display text-xl">
          {order.contactName}
        </CardTitle>
        {order.dueAt || order.dueLabel ? (
          <CardDescription>
            {order.dueAt
              ? order.kind === "client"
                ? "Livraison prévue"
                : "Réception prévue"
              : null}
            <span className="mt-1 flex items-center gap-1.5">
              <CalendarClock aria-hidden="true" className="size-3.5" />
              {order.dueAt ? formatDate(order.dueAt) : order.dueLabel}
            </span>
            {overdue ? (
              <Badge
                className="mt-2 border-[#9a3f31]/35 bg-[#9a3f31]/[0.08] text-[#8a3429]"
                variant="outline"
              >
                <AlertTriangle aria-hidden="true" /> En retard
              </Badge>
            ) : null}
          </CardDescription>
        ) : null}
        <CardAction className="flex items-center gap-1">
          <Select onValueChange={onStatusChange} value={displayedStatus}>
            <SelectTrigger
              aria-label={`État de la commande ${order.contactName}`}
              className="w-36 bg-background/40"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {orderStatusesForKind(order.kind).map((status) => (
                <SelectItem key={status} value={status}>
                  {formatOrderStatus(status, order.kind)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <OrderDialog
            characters={characters}
            contacts={contacts}
            order={order}
            products={products}
            recipes={recipes}
            trigger={
              <Button
                aria-label={`Modifier la commande de ${order.contactName}`}
                size="icon"
                variant="ghost"
              >
                <Pencil aria-hidden="true" />
              </Button>
            }
          />
        </CardAction>
      </CardHeader>

      <CardContent className="grid gap-4">
        <Table>
          <TableBody>
            {order.lines.map((line) => (
              <TableRow className="border-border/60" key={line._id}>
                <TableCell className="max-w-48 pl-0">
                  <p className="truncate font-semibold">{line.productName}</p>
                  {line.unitPrice !== undefined ? (
                    <p className="text-xs text-muted-foreground">
                      {formatUnitPrice(line.unitPrice)}
                    </p>
                  ) : null}
                </TableCell>
                <TableCell className="w-16 tabular-nums">
                  × {formatNumber(line.quantity)}
                </TableCell>
                <TableCell className="w-28 pr-0 text-right font-semibold tabular-nums">
                  {line.total === undefined ? "—" : formatSeptims(line.total)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {order.kind === "client" ? (
          <OrderPreparationDetails preparation={preparation} />
        ) : null}

        {order.notes ? (
          <Alert className="border-primary/25 bg-primary/[0.03]">
            <MessageSquareText aria-hidden="true" />
            <AlertDescription className="italic">
              {order.notes}
            </AlertDescription>
          </Alert>
        ) : null}
      </CardContent>

      <CardFooter className="flex-wrap justify-between gap-3 border-t border-border/60">
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            className={statusBadgeClasses[displayedStatus]}
            variant="outline"
          >
            {displayedStatus === "delivered" ? (
              <Check aria-hidden="true" />
            ) : null}
            {formatOrderStatus(displayedStatus, order.kind)}
          </Badge>
          <OrderProcessingDialog characters={characters} order={order} />
          {orderIsHistorical(order) ? (
            <OrderDialog
              characters={characters}
              contacts={contacts}
              copyFrom={order}
              products={products}
              recipes={recipes}
              trigger={
                <Button size="sm" type="button" variant="outline">
                  <Repeat2 aria-hidden="true" />
                  Renouveler
                </Button>
              }
            />
          ) : null}
        </div>
        <div className="text-right">
          <p className="text-[0.65rem] tracking-wider text-muted-foreground uppercase">
            Total convenu
          </p>
          <p className="font-display text-xl">
            {total === undefined ? "À convenir" : formatSeptims(total)}
          </p>
        </div>
      </CardFooter>
    </Card>
  )
}

function todayInputValue(): string {
  const today = new Date()
  const year = today.getFullYear()
  const month = String(today.getMonth() + 1).padStart(2, "0")
  const day = String(today.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function dateInputFromTimestamp(timestamp: number): string {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
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

function OrderProcessingDialog({
  characters,
  order,
}: Readonly<{
  characters: readonly Doc<"characters">[]
  order: Order
}>) {
  const processOrder = useMutation(api.orders.process)
  const [open, setOpen] = useState(false)
  const clientOrder = order.kind === "client"
  const processed = Boolean(order.transactionId && order.processedAt)

  const processingValues = () => ({
    characterId: order.linkedTransaction?.actorCharacterId ?? "",
    occurredOn: order.processedAt
      ? dateInputFromTimestamp(order.processedAt)
      : todayInputValue(),
  })

  const form = useForm({
    defaultValues: processingValues(),
    validators: { onSubmit: orderProcessingFormSchema },
    onSubmit: async ({ value }) => {
      const character = characters.find(
        (entry) => entry._id === value.characterId
      )
      const occurredAt = dateInputToTimestamp(value.occurredOn)
      if (!character || !occurredAt) return

      try {
        await processOrder({
          characterId: character._id,
          occurredAt,
          orderId: order._id,
        })
        if (processed) {
          toast.success(
            clientOrder ? "Paiement corrigé." : "Réception corrigée."
          )
        } else if (!clientOrder) {
          toast.success(
            "Réception ajoutée au journal et au stock. Commande déplacée dans l’historique."
          )
        } else if (order.status === "delivered") {
          toast.success(
            "Paiement ajouté au journal. Commande déplacée dans l’historique."
          )
        } else {
          toast.success(
            "Paiement ajouté au journal. Marquez la commande « Livrée » pour la terminer."
          )
        }
        setOpen(false)
      } catch (error) {
        toast.error(
          getUserFacingErrorMessage(
            error,
            "Impossible de traiter cette commande."
          )
        )
      }
    },
  })

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) form.reset(processingValues())
    setOpen(nextOpen)
  }

  if (!processed && order.status === "cancelled") return null

  if (!processed && order.lines.some((line) => line.unitPrice === undefined)) {
    return <Badge variant="outline">Prix à renseigner</Badge>
  }

  return (
    <AlertDialog onOpenChange={handleOpenChange} open={open}>
      <AlertDialogTrigger asChild>
        <Button
          aria-label={
            processed
              ? `${clientOrder ? "Corriger le paiement" : "Corriger la réception"} de ${order.contactName}`
              : undefined
          }
          size="sm"
          type="button"
          variant={processed ? "secondary" : "outline"}
        >
          {processed ? (
            <Pencil aria-hidden="true" />
          ) : clientOrder ? (
            <Coins aria-hidden="true" />
          ) : (
            <PackageCheck aria-hidden="true" />
          )}
          {processed && order.processedAt
            ? `${clientOrder ? "Payée" : "Reçue"} le ${formatDate(order.processedAt)}`
            : clientOrder
              ? "Enregistrer le paiement"
              : "Réceptionner"}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="border-[#6a5436] bg-[#eee1c7]" size="lg">
        <form
          className="grid gap-5"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            void form.handleSubmit()
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-2xl">
              {processed
                ? clientOrder
                  ? "Corriger le paiement"
                  : "Corriger la réception"
                : clientOrder
                  ? "Enregistrer le paiement"
                  : "Réceptionner la commande"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {processed
                ? "La transaction existante sera corrigée sans créer de doublon."
                : clientOrder
                  ? order.status === "delivered"
                    ? "Le paiement sera inscrit au journal et terminera la commande."
                    : "Le paiement sera inscrit au journal. La commande sera terminée lorsqu’elle sera également marquée « Livrée »."
                  : "La réception sera inscrite au journal, ajoutée au stock et la commande sera terminée."}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="grid gap-4 sm:grid-cols-[minmax(0,1.15fr)_minmax(11rem,0.85fr)]">
            <form.Field name="characterId">
              {(field) => {
                const invalid =
                  field.state.meta.isTouched && !field.state.meta.isValid
                return (
                  <Field className="min-w-0" data-invalid={invalid}>
                    <FieldLabel htmlFor={`order-character-${order._id}`}>
                      Personnage
                    </FieldLabel>
                    <Select
                      name={field.name}
                      onValueChange={field.handleChange}
                      value={field.state.value}
                    >
                      <SelectTrigger
                        aria-invalid={invalid}
                        className="w-full min-w-0"
                        id={`order-character-${order._id}`}
                        onBlur={field.handleBlur}
                      >
                        <SelectValue placeholder="Qui traite la commande ?" />
                      </SelectTrigger>
                      <SelectContent>
                        {characters.map((character) => (
                          <SelectItem key={character._id} value={character._id}>
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
            <form.Field name="occurredOn">
              {(field) => {
                const invalid =
                  field.state.meta.isTouched && !field.state.meta.isValid
                return (
                  <Field className="min-w-0" data-invalid={invalid}>
                    <FieldLabel htmlFor={`order-date-${order._id}`}>
                      {clientOrder ? "Date du paiement" : "Date de réception"}
                    </FieldLabel>
                    <DatePicker
                      ariaInvalid={invalid}
                      ariaLabel={
                        clientOrder ? "Date du paiement" : "Date de réception"
                      }
                      className="min-w-0"
                      id={`order-date-${order._id}`}
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

          <AlertDialogFooter>
            <AlertDialogCancel type="button">Retour</AlertDialogCancel>
            <form.Subscribe selector={(state) => state.isSubmitting}>
              {(isSubmitting) => (
                <Button disabled={isSubmitting} type="submit">
                  {isSubmitting ? (
                    <Spinner
                      aria-hidden="true"
                      className="motion-reduce:animate-none"
                    />
                  ) : clientOrder ? (
                    <Coins aria-hidden="true" />
                  ) : (
                    <PackageCheck aria-hidden="true" />
                  )}
                  {processed
                    ? "Enregistrer la correction"
                    : clientOrder
                      ? "Valider le paiement"
                      : "Valider la réception"}
                </Button>
              )}
            </form.Subscribe>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  )
}
