import { convexQuery } from "@convex-dev/react-query"
import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useMutation, useQuery as useConvexQuery } from "convex/react"
import { type FunctionReturnType } from "convex/server"
import {
  CalendarRange,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Ellipsis,
  Pencil,
  Plus,
  Search,
  ScrollText,
  Trash2,
  X,
} from "lucide-react"
import { useState, type MouseEvent } from "react"
import { toast } from "sonner"

import { DatePicker } from "@/components/date-picker"
import {
  OperationDialog,
  type OperationKind,
} from "@/components/operation-dialog"
import { OrderDialog } from "@/components/order-dialog"
import { PageError } from "@/components/page-error"
import { PageHeader } from "@/components/page-header"
import { PageSkeleton } from "@/components/page-skeleton"
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
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
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
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { getUserFacingErrorMessage } from "@/lib/errors"
import {
  formatDate,
  formatNumber,
  formatQuantity,
  formatSeptims,
  operationLabels,
} from "@/lib/format"
import { cn } from "@/lib/utils"
import { api } from "../../../convex/_generated/api"
import { type Doc, type Id } from "../../../convex/_generated/dataModel"

const PAGE_SIZE = 30
type FinancialTransactionKind = Exclude<
  Doc<"transactions">["kind"],
  "adjustment" | "production"
>

const transactionKinds: readonly FinancialTransactionKind[] = [
  "bundle",
  "exchange",
  "order",
  "purchase",
  "sale",
  "service",
]

interface JournalRouteSearch {
  character?: string
  from?: string
  kind?: FinancialTransactionKind
  q?: string
  to?: string
}

interface PaginationState {
  cursor: string | null
  filterKey: string
  previousCursors: Array<string | null>
}

type Transaction = FunctionReturnType<
  typeof api.transactions.listPage
>["page"][number]

type EditorRequest =
  | {
      initialKind: OperationKind
      transactionId?: Id<"transactions">
      type: "operation"
    }
  | {
      orderId: Id<"orders">
      type: "order"
    }

function isTransactionKind(value: string): value is FinancialTransactionKind {
  return transactionKinds.includes(value as FinancialTransactionKind)
}

function isDateInput(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(year, month - 1, day)
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  )
}

function validateJournalSearch(
  search: Record<string, unknown>
): JournalRouteSearch {
  const q =
    typeof search.q === "string" && search.q.trim()
      ? search.q.slice(0, 100)
      : undefined
  const kind =
    typeof search.kind === "string" && isTransactionKind(search.kind)
      ? search.kind
      : undefined
  const character =
    typeof search.character === "string" && search.character
      ? search.character
      : undefined
  const from =
    typeof search.from === "string" && isDateInput(search.from)
      ? search.from
      : undefined
  const to =
    typeof search.to === "string" && isDateInput(search.to)
      ? search.to
      : undefined
  return {
    ...(character ? { character } : {}),
    ...(from ? { from } : {}),
    ...(kind ? { kind } : {}),
    ...(q ? { q } : {}),
    ...(to ? { to } : {}),
  }
}

function dateBoundary(value: string, nextDay = false): number {
  const [year, month, day] = value.split("-").map(Number)
  return new Date(year!, month! - 1, day! + Number(nextDay)).getTime()
}

function journalQueryArgs(filters: JournalRouteSearch, cursor: string | null) {
  return {
    ...(filters.character
      ? { characterId: filters.character as Id<"characters"> }
      : {}),
    ...(filters.from ? { from: dateBoundary(filters.from) } : {}),
    ...(filters.kind ? { kind: filters.kind } : {}),
    paginationOpts: { cursor, numItems: PAGE_SIZE },
    ...(filters.q ? { q: filters.q } : {}),
    ...(filters.to ? { to: dateBoundary(filters.to, true) } : {}),
  }
}

export const Route = createFileRoute("/_app/journal")({
  component: JournalPage,
  errorComponent: PageError,
  loader: async ({ context, deps }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(
        convexQuery(api.transactions.listPage, journalQueryArgs(deps, null))
      ),
      context.queryClient.ensureQueryData(convexQuery(api.characters.list, {})),
    ])
  },
  loaderDeps: ({ search }) => search,
  pendingComponent: PageSkeleton,
  validateSearch: validateJournalSearch,
})

const operationToneClasses: Readonly<
  Record<Doc<"transactions">["kind"], string>
> = {
  adjustment: "border-[#1E374F]/25 bg-[#1E374F]/[0.08] text-[#1E374F]",
  bundle: "border-[#6c5738]/25 bg-[#6c5738]/[0.08] text-[#6c5738]",
  exchange: "border-[#1E374F]/25 bg-[#1E374F]/[0.08] text-[#1E374F]",
  order: "border-[#6c5738]/25 bg-[#6c5738]/[0.08] text-[#6c5738]",
  production: "border-[#5d5276]/25 bg-[#5d5276]/[0.07] text-[#5d5276]",
  purchase: "border-[#83513b]/25 bg-[#83513b]/[0.07] text-[#83513b]",
  sale: "border-[#405c43]/25 bg-[#405c43]/[0.08] text-[#405c43]",
  service: "border-[#6c5738]/25 bg-[#6c5738]/[0.08] text-[#6c5738]",
}

function JournalPage() {
  const filters = Route.useSearch()
  const navigate = Route.useNavigate()
  const filterKey = JSON.stringify(filters)
  const [pagination, setPagination] = useState<PaginationState>({
    cursor: null,
    filterKey,
    previousCursors: [],
  })
  const activePagination =
    pagination.filterKey === filterKey
      ? pagination
      : { cursor: null, filterKey, previousCursors: [] }
  const [editor, setEditor] = useState<EditorRequest | null>(null)
  const { data: initialPage } = useSuspenseQuery(
    convexQuery(api.transactions.listPage, journalQueryArgs(filters, null))
  )
  const { data: characters } = useSuspenseQuery(
    convexQuery(api.characters.list, {})
  )
  const livePage = useConvexQuery(
    api.transactions.listPage,
    journalQueryArgs(filters, activePagination.cursor)
  )
  const page =
    livePage ?? (activePagination.cursor === null ? initialPage : undefined)
  const isFetchingPage = livePage === undefined
  const transactions = page?.page ?? []
  const hasFilters = Object.keys(filters).length > 0
  const showActions = transactions.some(
    (transaction) => transaction.canManage || transaction.canDelete
  )

  function showPreviousPage() {
    const previousCursor = activePagination.previousCursors.at(-1)
    if (previousCursor === undefined) return
    setPagination({
      cursor: previousCursor,
      filterKey,
      previousCursors: activePagination.previousCursors.slice(0, -1),
    })
  }

  function showNextPage() {
    if (!page || page.isDone) return
    setPagination({
      cursor: page.continueCursor,
      filterKey,
      previousCursors: [
        ...activePagination.previousCursors,
        activePagination.cursor,
      ],
    })
  }

  function updateFilter(next: Partial<JournalRouteSearch>) {
    void navigate({
      replace: true,
      search: (previous) => ({ ...previous, ...next }),
    })
  }

  function updateDate(field: "from" | "to", value: string) {
    void navigate({
      replace: true,
      search: (previous) => {
        const next = { ...previous, [field]: value || undefined }
        if (field === "from" && next.to && value > next.to) {
          next.to = undefined
        }
        if (field === "to" && next.from && value < next.from) {
          next.from = undefined
        }
        return next
      },
    })
  }

  return (
    <div className="animate-in duration-300 fade-in slide-in-from-bottom-1 motion-reduce:animate-none">
      <PageHeader
        action={
          <Button
            onClick={() =>
              setEditor({ initialKind: "exchange", type: "operation" })
            }
            size="lg"
          >
            <Plus aria-hidden="true" />
            Nouvelle transaction
          </Button>
        }
        eyebrow="Registre financier"
        title="Transactions"
      >
        Retrouvez les ventes, achats, services, commandes et échanges déjà
        enregistrés.
      </PageHeader>

      <section
        aria-label="Filtres du journal"
        className="mt-6 border-y border-border/70 py-3"
      >
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(15rem,1.5fr)_minmax(10rem,0.8fr)_minmax(12rem,1fr)_auto] xl:items-end">
          <div className="space-y-1.5 md:col-span-2 xl:col-span-1">
            <Label htmlFor="journal-search">Recherche</Label>
            <div className="relative">
              <Search
                aria-hidden="true"
                className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                className="h-9 bg-background/50 pl-9"
                id="journal-search"
                onChange={(event) =>
                  updateFilter({ q: event.target.value || undefined })
                }
                placeholder="Référence, contrepartie, commentaire…"
                type="search"
                value={filters.q ?? ""}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="journal-kind">Type</Label>
            <Select
              onValueChange={(value) =>
                updateFilter({
                  kind: isTransactionKind(value) ? value : undefined,
                })
              }
              value={filters.kind ?? "all"}
            >
              <SelectTrigger
                className="w-full bg-background/50"
                id="journal-kind"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les types</SelectItem>
                {transactionKinds.map((kind) => (
                  <SelectItem key={kind} value={kind}>
                    {operationLabels[kind]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="journal-character">Personnage</Label>
            <Select
              onValueChange={(value) =>
                updateFilter({
                  character: value === "all" ? undefined : value,
                })
              }
              value={filters.character ?? "all"}
            >
              <SelectTrigger
                className="w-full bg-background/50"
                id="journal-character"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les personnages</SelectItem>
                {characters.map((character) => (
                  <SelectItem key={character._id} value={character._id}>
                    {character.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2 md:col-span-2 xl:col-span-1">
            <div className="space-y-1.5">
              <Label htmlFor="journal-from">Du</Label>
              <DatePicker
                ariaLabel="Date de début"
                className="h-9 bg-background/50"
                display="short"
                id="journal-from"
                max={filters.to}
                onChange={(value) => updateDate("from", value)}
                placeholder="Date"
                value={filters.from ?? ""}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="journal-to">Au</Label>
              <DatePicker
                ariaLabel="Date de fin"
                className="h-9 bg-background/50"
                display="short"
                id="journal-to"
                min={filters.from}
                onChange={(value) => updateDate("to", value)}
                placeholder="Date"
                value={filters.to ?? ""}
              />
            </div>
          </div>
        </div>
        <div className="mt-3 flex min-h-8 flex-wrap items-center justify-between gap-2 border-t border-border/45 pt-3">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarRange aria-hidden="true" className="size-3.5" />
            {hasFilters
              ? `${transactions.length} résultat${transactions.length === 1 ? "" : "s"} sur cette page`
              : "Transactions les plus récentes en premier"}
          </p>
          {hasFilters ? (
            <Button
              onClick={() => void navigate({ replace: true, search: {} })}
              size="sm"
              type="button"
              variant="ghost"
            >
              <X aria-hidden="true" />
              Effacer les filtres
            </Button>
          ) : null}
        </div>
      </section>

      {!page ? (
        <PageSkeleton />
      ) : transactions.length > 0 ? (
        <>
          <Card
            aria-busy={isFetchingPage}
            className={cn(
              "mt-7 rounded-none border-x-0 border-y border-t-2 border-[#5b462b]/35 bg-transparent py-0 ring-0 transition-opacity max-md:border-0",
              isFetchingPage && "opacity-70"
            )}
          >
            <CardContent className="px-0">
              <Table className="max-md:block">
                <TableHeader className="max-md:hidden">
                  <TableRow className="border-b-[#5b462b]/50 bg-[#684f2d]/10 hover:bg-[#684f2d]/10">
                    <TableHead className="pl-4">Date</TableHead>
                    <TableHead>Opération</TableHead>
                    <TableHead>Référence</TableHead>
                    <TableHead>Personnage</TableHead>
                    <TableHead className="text-right">Quantité</TableHead>
                    <TableHead className="pr-4 text-right">Montant</TableHead>
                    {showActions ? (
                      <TableHead className="text-right">Actions</TableHead>
                    ) : null}
                  </TableRow>
                </TableHeader>
                <TableBody className="max-md:grid max-md:gap-3">
                  {transactions.map((transaction) => (
                    <JournalRow
                      key={transaction._id}
                      onEdit={(selectedTransaction) =>
                        setEditor(
                          selectedTransaction.orderId
                            ? {
                                orderId: selectedTransaction.orderId,
                                type: "order",
                              }
                            : {
                                initialKind: "exchange",
                                transactionId: selectedTransaction._id,
                                type: "operation",
                              }
                        )
                      }
                      showActions={showActions}
                      transaction={transaction}
                    />
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="mt-4 flex items-center justify-between gap-3 border-t border-[#5b462b]/20 pt-4">
            <p className="text-xs tracking-wide text-muted-foreground">
              Page {activePagination.previousCursors.length + 1}
            </p>
            <div className="flex gap-2">
              <Button
                disabled={
                  activePagination.previousCursors.length === 0 ||
                  isFetchingPage
                }
                onClick={showPreviousPage}
                size="sm"
                type="button"
                variant="outline"
              >
                <ChevronLeft aria-hidden="true" />
                Précédente
              </Button>
              <Button
                disabled={page.isDone || isFetchingPage}
                onClick={showNextPage}
                size="sm"
                type="button"
                variant="outline"
              >
                Suivante
                <ChevronRight aria-hidden="true" />
              </Button>
            </div>
          </div>
        </>
      ) : (
        <Alert className="mt-7 border-[#6a4f2e]/30 bg-card/35">
          <ScrollText aria-hidden="true" />
          <AlertTitle>
            {hasFilters
              ? "Aucune opération ne correspond"
              : "Aucune opération enregistrée"}
          </AlertTitle>
          <AlertDescription>
            {hasFilters
              ? "Élargissez la période ou effacez un filtre pour retrouver d’autres opérations."
              : "Ajoutez une première opération pour commencer l’historique."}
          </AlertDescription>
        </Alert>
      )}

      {editor ? (
        <ActivityEditor onClose={() => setEditor(null)} request={editor} />
      ) : null}
    </div>
  )
}

function isEditableTransaction(transaction: Transaction): boolean {
  return (
    Boolean(transaction.orderId) ||
    transaction.kind === "exchange" ||
    transaction.kind === "purchase" ||
    transaction.kind === "sale" ||
    transaction.kind === "service"
  )
}

function OperationPill({
  kind,
}: Readonly<{ kind: Doc<"transactions">["kind"] }>) {
  return (
    <Badge
      className={cn("font-bold tracking-[0.04em]", operationToneClasses[kind])}
      variant="outline"
    >
      {operationLabels[kind]}
    </Badge>
  )
}

function JournalRow({
  onEdit,
  showActions,
  transaction,
}: Readonly<{
  onEdit: (transaction: Transaction) => void
  showActions: boolean
  transaction: Transaction
}>) {
  return (
    <TableRow className="border-[#5b462b]/20 hover:bg-[#fffdeb]/40 max-md:relative max-md:grid max-md:grid-cols-[minmax(0,1fr)_auto] max-md:gap-x-3 max-md:gap-y-1 max-md:border max-md:border-[#5b462b]/35 max-md:bg-[#fff8e7]/30 max-md:p-4 max-md:shadow-[2px_3px_0_rgba(84,63,37,0.05)]">
      <TableCell className="pl-4 text-muted-foreground max-md:col-start-1 max-md:row-start-2 max-md:p-0 max-md:pt-3">
        <time className="text-xs">{formatDate(transaction.occurredAt)}</time>
        {transaction.orderId ? null : (
          <span className="mt-1 block text-xs md:hidden">
            {formatQuantity(transaction.quantity)}
          </span>
        )}
      </TableCell>
      <TableCell className="max-md:absolute max-md:top-4 max-md:right-4 max-md:p-0">
        <OperationPill kind={transaction.kind} />
      </TableCell>
      <TableCell className="max-w-72 max-md:col-span-2 max-md:col-start-1 max-md:row-start-1 max-md:max-w-none max-md:p-0 max-md:pr-24 max-md:whitespace-normal">
        <span className="block truncate font-semibold max-md:font-display max-md:text-base">
          {transaction.productName}
        </span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground md:hidden">
          {transaction.actorName}
          {transaction.counterparty && !transaction.orderId
            ? ` · ${transaction.counterparty}`
            : ""}
        </span>
        {transaction.counterparty && !transaction.orderId ? (
          <span className="block truncate text-xs text-muted-foreground max-md:hidden">
            {transaction.counterparty}
          </span>
        ) : null}
        {transaction.orderId ? null : (
          <TransactionLines
            lineCount={transaction.lineCount ?? 0}
            transactionId={transaction._id}
          />
        )}
      </TableCell>
      <TableCell className="max-w-40 truncate text-muted-foreground max-md:hidden">
        {transaction.actorName}
      </TableCell>
      <TableCell className="text-right max-md:hidden">
        {transaction.orderId ? "—" : formatNumber(transaction.quantity)}
      </TableCell>
      <TableCell
        className={cn(
          "pr-4 text-right font-semibold tabular-nums max-md:col-start-2 max-md:row-start-2 max-md:self-end max-md:p-0 max-md:pt-3 max-md:font-display max-md:text-lg",
          transaction.total >= 0 ? "text-[#456044]" : "text-[#8a3e2f]"
        )}
      >
        {transaction.total > 0 ? "+" : ""}
        {formatSeptims(transaction.total)}
      </TableCell>
      {showActions ? (
        <TableCell className="pr-2 text-right max-md:col-span-2 max-md:col-start-1 max-md:row-start-3 max-md:p-0 max-md:pt-2">
          {transaction.canManage || transaction.canDelete ? (
            <TransactionActions onEdit={onEdit} transaction={transaction} />
          ) : null}
        </TableCell>
      ) : null}
    </TableRow>
  )
}

function TransactionActions({
  onEdit,
  transaction,
}: Readonly<{
  onEdit: (transaction: Transaction) => void
  transaction: Transaction
}>) {
  const canEdit = transaction.canManage && isEditableTransaction(transaction)
  const removeTransaction = useMutation(api.transactions.remove)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleDelete(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    setIsSubmitting(true)
    try {
      await removeTransaction({ transactionId: transaction._id })
      toast.success("Opération supprimée et stock corrigé.")
      setDeleteOpen(false)
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(
          error,
          "Impossible de supprimer cette opération."
        )
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <>
      <Popover onOpenChange={setActionsOpen} open={actionsOpen}>
        <PopoverTrigger asChild>
          <Button
            aria-label={`Gérer ${operationLabels[transaction.kind]} — ${transaction.productName}`}
            className="h-8 px-2"
            size="sm"
            type="button"
            variant="ghost"
          >
            <Ellipsis aria-hidden="true" />
            <span className="md:sr-only">Gérer</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-44 gap-1 p-1.5">
          {canEdit ? (
            <Button
              className="justify-start"
              onClick={() => {
                setActionsOpen(false)
                onEdit(transaction)
              }}
              size="sm"
              type="button"
              variant="ghost"
            >
              <Pencil aria-hidden="true" />
              Modifier
            </Button>
          ) : null}
          {transaction.canDelete ? (
            <Button
              className="justify-start text-destructive hover:text-destructive"
              onClick={() => {
                setActionsOpen(false)
                setDeleteOpen(true)
              }}
              size="sm"
              type="button"
              variant="ghost"
            >
              <Trash2 aria-hidden="true" />
              Supprimer
            </Button>
          ) : null}
        </PopoverContent>
      </Popover>
      <AlertDialog onOpenChange={setDeleteOpen} open={deleteOpen}>
        <AlertDialogContent className="rounded-[0.2rem] border-[#6a5436] bg-[#eee1c7]">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Supprimer définitivement cette opération ?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Elle disparaîtra du journal avec ses lignes et ses mouvements. Le
              stock sera corrigé et seule une trace d’audit sera conservée.
              Cette action est irréversible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel type="button">Conserver</AlertDialogCancel>
            <AlertDialogAction
              disabled={isSubmitting}
              onClick={handleDelete}
              type="button"
              variant="destructive"
            >
              {isSubmitting ? (
                <Spinner
                  aria-hidden="true"
                  className="motion-reduce:animate-none"
                />
              ) : (
                <Trash2 aria-hidden="true" />
              )}
              Supprimer définitivement
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function TransactionLines({
  lineCount,
  transactionId,
}: Readonly<{
  lineCount: number
  transactionId: Id<"transactions">
}>) {
  const [open, setOpen] = useState(false)
  if (lineCount <= 1) return null

  return (
    <Collapsible onOpenChange={setOpen} open={open}>
      <CollapsibleTrigger asChild>
        <Button
          className="mt-1 h-auto px-0 text-[0.68rem]"
          type="button"
          variant="link"
        >
          Voir le détail · {lineCount} lignes
          <ChevronDown
            aria-hidden="true"
            className={cn("transition-transform", open && "rotate-180")}
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-1 max-md:col-span-2">
        {open ? <TransactionLineContent transactionId={transactionId} /> : null}
      </CollapsibleContent>
    </Collapsible>
  )
}

function TransactionLineContent({
  transactionId,
}: Readonly<{ transactionId: Id<"transactions"> }>) {
  const details = useConvexQuery(api.transactions.getDetails, {
    transactionId,
  })
  if (details === undefined) {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Spinner aria-hidden="true" className="motion-reduce:animate-none" />
        Chargement…
      </span>
    )
  }
  if (!details) {
    return (
      <p className="text-xs text-destructive">
        Impossible de charger les lignes.
      </p>
    )
  }

  return (
    <ul className="grid gap-1 border-l border-primary/30 pl-2 text-xs text-muted-foreground">
      {details.lines.map((line) => (
        <li className="flex flex-wrap justify-between gap-2" key={line._id}>
          <span className="flex flex-wrap items-center gap-1.5">
            {line.direction ? (
              <Badge className="px-1.5 py-0 text-[0.58rem]" variant="outline">
                {line.direction === "incoming" ? "Acheté" : "Vendu"}
              </Badge>
            ) : null}
            {line.productName} · {formatQuantity(line.quantity)}
          </span>
          <span className="font-semibold text-foreground tabular-nums">
            {line.direction === "incoming" ? "−" : ""}
            {formatSeptims(line.total)}
          </span>
        </li>
      ))}
    </ul>
  )
}

function ActivityEditor({
  onClose,
  request,
}: Readonly<{
  onClose: () => void
  request: EditorRequest
}>) {
  return request.type === "order" ? (
    <OrderActivityEditor onClose={onClose} request={request} />
  ) : (
    <OperationActivityEditor onClose={onClose} request={request} />
  )
}

function OperationActivityEditor({
  onClose,
  request,
}: Readonly<{
  onClose: () => void
  request: Extract<EditorRequest, { type: "operation" }>
}>) {
  const products = useConvexQuery(api.products.selectable)
  const characters = useConvexQuery(api.characters.list)
  const bundles = useConvexQuery(api.recipes.listBundles)
  const recipes = useConvexQuery(api.recipes.list)
  const transaction = useConvexQuery(
    api.transactions.getDetails,
    request.transactionId ? { transactionId: request.transactionId } : "skip"
  )

  const isLoading =
    products === undefined ||
    characters === undefined ||
    bundles === undefined ||
    recipes === undefined ||
    (request.transactionId !== undefined && transaction === undefined)
  const missingEntity =
    !isLoading && request.transactionId !== undefined && transaction === null

  if (missingEntity || isLoading) {
    return <EditorLoadingDialog failed={missingEntity} onClose={onClose} />
  }
  return (
    <OperationDialog
      bundles={bundles}
      characters={characters}
      initialKind={request.initialKind}
      key={request.transactionId ?? request.initialKind}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose()
      }}
      open
      products={products}
      recipes={recipes}
      transaction={transaction ?? undefined}
      trigger={null}
    />
  )
}

function OrderActivityEditor({
  onClose,
  request,
}: Readonly<{
  onClose: () => void
  request: Extract<EditorRequest, { type: "order" }>
}>) {
  const products = useConvexQuery(api.products.selectable)
  const characters = useConvexQuery(api.characters.list)
  const contacts = useConvexQuery(api.contacts.list)
  const recipes = useConvexQuery(api.recipes.list)
  const order = useConvexQuery(api.orders.getById, {
    orderId: request.orderId,
  })
  const isLoading =
    products === undefined ||
    characters === undefined ||
    contacts === undefined ||
    recipes === undefined ||
    order === undefined
  const missingEntity = !isLoading && order === null

  if (missingEntity || isLoading) {
    return <EditorLoadingDialog failed={missingEntity} onClose={onClose} />
  }
  if (!order) {
    return <EditorLoadingDialog failed onClose={onClose} />
  }

  return (
    <OrderDialog
      characters={characters}
      contacts={contacts}
      key={request.orderId}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose()
      }}
      open
      order={order}
      products={products}
      recipes={recipes}
      trigger={null}
    />
  )
}

function EditorLoadingDialog({
  failed,
  onClose,
}: Readonly<{
  failed: boolean
  onClose: () => void
}>) {
  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose()
      }}
      open
    >
      <DialogContent className="rounded-[0.2rem] border-[#6a5436] bg-[#eee1c7] ring-0 sm:max-w-xl">
        <DialogHeader>
          <p className="text-[0.66rem] font-bold tracking-[0.2em] text-primary uppercase">
            Registre financier
          </p>
          <DialogTitle className="font-display text-2xl">
            {failed ? "Modification indisponible" : "Préparation du registre"}
          </DialogTitle>
          <DialogDescription>
            {failed
              ? "Les informations de cette opération n’ont pas pu être retrouvées."
              : "Les références nécessaires sont chargées à la demande."}
          </DialogDescription>
        </DialogHeader>
        {failed ? (
          <Alert variant="destructive">
            <AlertTitle>Chargement impossible</AlertTitle>
            <AlertDescription>
              Fermez cette fenêtre puis réessayez.
            </AlertDescription>
          </Alert>
        ) : (
          <div className="grid gap-3" aria-label="Chargement" role="status">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-10 w-2/3" />
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
