import { convexQuery } from "@convex-dev/react-query"
import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { useQuery as useConvexQuery } from "convex/react"
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  CalendarDays,
  ChevronRight,
  Coins,
  Hammer,
  ScrollText,
} from "lucide-react"
import { useState, type ReactElement } from "react"

import { OperationDialog } from "@/components/operation-dialog"
import { PageError } from "@/components/page-error"
import { PageHeader } from "@/components/page-header"
import { PageSkeleton } from "@/components/page-skeleton"
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { api } from "../../../convex/_generated/api"
import {
  formatDate,
  formatDecimalSeptims,
  formatNumber,
  formatQuantity,
  formatSeptims,
  operationLabels,
} from "@/lib/format"
import { cn } from "@/lib/utils"
import { startOfUtcDay, startOfUtcWeek } from "../../../shared/time"

function dashboardQueryArgs(now = Date.now()) {
  return {
    currentWeekStartsAt: startOfUtcWeek(now),
    todayStartsAt: startOfUtcDay(now),
  }
}

export const Route = createFileRoute("/_app/")({
  component: DashboardPage,
  errorComponent: PageError,
  loader: async ({ context }) => {
    const queryArgs = dashboardQueryArgs()
    await context.queryClient.ensureQueryData(
      convexQuery(api.dashboard.overview, queryArgs)
    )
    return { queryArgs }
  },
  pendingComponent: PageSkeleton,
})

function DashboardPage() {
  const { queryArgs } = Route.useLoaderData()
  const { data } = useSuspenseQuery(
    convexQuery(api.dashboard.overview, queryArgs)
  )

  return (
    <div className="animate-in duration-300 fade-in slide-in-from-bottom-1 motion-reduce:animate-none">
      <PageHeader eyebrow="Registre du jour" title="La boutique aujourd’hui">
        Enregistrez une transaction ou une production, puis voyez immédiatement
        ce qui demande votre attention.
      </PageHeader>

      <Card className="mt-6 border border-[#5b462b]/35 bg-[#f8edd5]/55 shadow-[0_10px_28px_rgba(70,48,25,0.06)] ring-0">
        <CardHeader className="border-b border-border/65">
          <CardTitle className="font-display text-lg font-[580] text-[#34291e]">
            Actions rapides
          </CardTitle>
          <CardDescription>Que voulez-vous enregistrer ?</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2">
          <DashboardOperationDialog
            trigger={
              <Button
                className="h-20 w-full flex-col gap-1.5 px-3 text-center text-sm whitespace-normal shadow-sm"
                size="lg"
              >
                <ArrowLeftRight aria-hidden="true" className="size-5" />
                Enregistrer un échange
              </Button>
            }
          />
          <DashboardOperationDialog
            initialKind="production"
            trigger={
              <Button
                className="h-20 w-full flex-col gap-1.5 border-[#6a5436]/40 bg-background/35 px-3 text-center text-sm whitespace-normal"
                size="lg"
                variant="outline"
              >
                <Hammer aria-hidden="true" className="size-5" />
                Enregistrer une production
              </Button>
            }
          />
        </CardContent>
      </Card>

      <section
        aria-label="Priorités de la boutique"
        className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(16rem,0.6fr)]"
      >
        <Card className="border border-[#644c2c]/35 bg-[#f9f0db]/45 ring-0">
          <CardHeader>
            <CardTitle className="font-display text-lg font-[580] text-[#34291e]">
              À traiter
            </CardTitle>
            <CardDescription>
              Les points qui peuvent ralentir la boutique
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            <Link
              className="group block h-full rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
              search={{ stock: "low" }}
              to="/inventaire"
            >
              <Alert
                className={cn(
                  "h-full min-h-24 border-[#6a5436]/30 bg-background/35 p-4 pr-14 transition-colors group-hover:border-primary/45 group-hover:bg-accent/60 group-focus-visible:border-primary/50 group-focus-visible:bg-accent/60",
                  data.lowStockCount > 0 &&
                    "border-[#9a4b32]/30 bg-[#9a4b32]/[0.04]"
                )}
              >
                <AlertTriangle
                  aria-hidden="true"
                  className={cn(
                    "size-5 text-primary",
                    data.lowStockCount > 0 && "text-[#9a4b32]"
                  )}
                />
                <AlertTitle className="text-sm font-semibold text-foreground">
                  {data.lowStockCount > 0
                    ? `${formatNumber(data.lowStockCount)} stocks faibles`
                    : "Stocks à jour"}
                </AlertTitle>
                <AlertDescription>
                  {data.lowStockCount > 0
                    ? "Ouvrir la liste filtrée dans l’inventaire"
                    : "Aucune référence sous son seuil"}
                </AlertDescription>
                <AlertAction aria-hidden="true" className="top-3 right-3">
                  <ChevronRight className="size-5 text-muted-foreground transition-[color,transform] group-hover:translate-x-0.5 group-hover:text-primary group-focus-visible:translate-x-0.5 group-focus-visible:text-primary motion-reduce:transform-none" />
                </AlertAction>
              </Alert>
            </Link>

            <Link
              className="group block h-full rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
              search={{ view: "attention" }}
              to="/commandes"
            >
              <Alert className="h-full min-h-24 border-primary/20 bg-primary/[0.035] p-4 pr-14 transition-colors group-hover:border-primary/45 group-hover:bg-accent/60 group-focus-visible:border-primary/50 group-focus-visible:bg-accent/60">
                <ScrollText
                  aria-hidden="true"
                  className="size-5 text-primary"
                />
                <AlertTitle className="text-sm font-semibold text-foreground">
                  {formatNumber(data.orderAttention.total)}{" "}
                  {data.orderAttention.total === 1
                    ? "commande à traiter"
                    : "commandes à traiter"}
                </AlertTitle>
                <AlertDescription>
                  {formatNumber(data.orderAttention.client)} client
                  {data.orderAttention.client === 1 ? "" : "s"} ·{" "}
                  {formatNumber(data.orderAttention.supplier)} fournisseur
                  {data.orderAttention.supplier === 1 ? "" : "s"}
                  {data.orderAttention.overdue > 0
                    ? ` · ${formatNumber(data.orderAttention.overdue)} en retard`
                    : ""}
                </AlertDescription>
                <AlertAction aria-hidden="true" className="top-3 right-3">
                  <ChevronRight className="size-5 text-muted-foreground transition-[color,transform] group-hover:translate-x-0.5 group-hover:text-primary group-focus-visible:translate-x-0.5 group-focus-visible:text-primary motion-reduce:transform-none" />
                </AlertAction>
              </Alert>
            </Link>
          </CardContent>
        </Card>

        <Card className="border border-primary/20 bg-primary/[0.045] ring-0">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-display text-lg font-[580] text-[#34291e]">
              <Coins aria-hidden="true" className="size-4 text-primary" />
              Repères
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-[0.68rem] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
              Valeur estimée du stock
            </p>
            <p className="mt-1 font-display text-2xl leading-none font-[600] text-primary tabular-nums">
              {formatDecimalSeptims(data.stockValue)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Prix d’achat, ou de vente à défaut
            </p>
            <Separator className="my-3 bg-primary/15" />
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                  <CalendarDays
                    aria-hidden="true"
                    className="size-3.5 text-primary"
                  />
                  Cette semaine
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {formatNumber(data.weeklyTransactionCount)}{" "}
                  {data.weeklyTransactionCount === 1
                    ? "mouvement"
                    : "mouvements"}
                </p>
              </div>
              <p
                className={cn(
                  "font-display text-lg font-[600] tabular-nums",
                  data.weeklyBalance >= 0 ? "text-[#456044]" : "text-[#8a3e2f]"
                )}
              >
                {data.weeklyBalance >= 0 ? "+" : ""}
                {formatSeptims(data.weeklyBalance)}
              </p>
            </div>
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="recent-activity-title" className="mt-6">
        <Card className="border border-[#644c2c]/35 bg-[#f9f0db]/45 py-0 shadow-[inset_0_0_24px_rgba(107,79,40,0.03)] ring-0">
          <CardHeader className="border-b border-border/60">
            <CardTitle
              className="font-display text-xl font-[580] text-[#3b2f22]"
              id="recent-activity-title"
            >
              Dernières transactions
            </CardTitle>
            <CardDescription>Les derniers flux financiers</CardDescription>
            <CardAction>
              <Button asChild size="sm" variant="ghost">
                <Link to="/journal">
                  Voir le journal
                  <ChevronRight aria-hidden="true" />
                </Link>
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-[#684f2d]/8 hover:bg-[#684f2d]/8">
                  <TableHead>Transaction</TableHead>
                  <TableHead className="hidden sm:table-cell">
                    Personnage
                  </TableHead>
                  <TableHead className="text-right">Montant</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.recentTransactions.map((transaction) => {
                  const positive = transaction.total >= 0
                  const DirectionIcon = positive ? ArrowUpRight : ArrowDownLeft

                  return (
                    <TableRow key={transaction._id}>
                      <TableCell>
                        <div className="flex min-w-0 items-center gap-3">
                          <div
                            className={cn(
                              "grid size-8 shrink-0 place-items-center rounded-full border border-current [&_svg]:size-3.5",
                              positive
                                ? "bg-[#4d664b]/[0.07] text-[#4e684d]"
                                : "bg-[#8c4936]/[0.07] text-[#8c4936]"
                            )}
                          >
                            <DirectionIcon aria-hidden="true" />
                          </div>
                          <div className="min-w-0">
                            <Link
                              aria-label={`Voir les mouvements liés à ${transaction.productName}`}
                              className="block truncate font-semibold underline-offset-4 hover:underline"
                              search={{ q: transaction.productName }}
                              to="/journal"
                            >
                              {transaction.productName}
                            </Link>
                            <p className="text-xs text-muted-foreground">
                              {operationLabels[transaction.kind]} ·{" "}
                              {formatQuantity(transaction.quantity)}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground sm:table-cell">
                        {transaction.actorName}
                        <span className="block text-xs">
                          {formatDate(transaction.occurredAt)}
                        </span>
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right font-semibold tabular-nums",
                          positive ? "text-[#456044]" : "text-[#8a3e2f]"
                        )}
                      >
                        {transaction.total > 0 ? "+" : ""}
                        {formatSeptims(transaction.total)}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>
    </div>
  )
}

function DashboardOperationDialog({
  initialKind = "exchange",
  trigger,
}: Readonly<{
  initialKind?: "exchange" | "production"
  trigger: ReactElement
}>) {
  const [open, setOpen] = useState(false)
  const productionMode = initialKind === "production"
  const products = useConvexQuery(api.products.selectable, open ? {} : "skip")
  const characters = useConvexQuery(api.characters.list, open ? {} : "skip")
  const bundles = useConvexQuery(
    api.recipes.listBundles,
    open && !productionMode ? {} : "skip"
  )
  const recipes = useConvexQuery(
    api.recipes.list,
    open && productionMode ? {} : "skip"
  )
  const loading =
    open &&
    (products === undefined ||
      characters === undefined ||
      (productionMode ? recipes === undefined : bundles === undefined))

  return (
    <OperationDialog
      bundles={bundles ?? []}
      characters={characters ?? []}
      initialKind={initialKind}
      loading={loading}
      onOpenChange={setOpen}
      open={open}
      products={products ?? []}
      recipes={recipes ?? []}
      trigger={trigger}
    />
  )
}
