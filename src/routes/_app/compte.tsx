import { convexQuery } from "@convex-dev/react-query"
import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import {
  ArrowDownLeft,
  ArrowUpRight,
  Coins,
  Landmark,
  ReceiptText,
  Scale,
  UsersRound,
} from "lucide-react"
import { useState } from "react"

import { AccountSettingsDialog } from "@/components/account-settings-dialog"
import { PageError } from "@/components/page-error"
import { PageHeader } from "@/components/page-header"
import { PageSkeleton } from "@/components/page-skeleton"
import { SortableTableHead } from "@/components/sortable-table-head"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
import { useHydrated } from "@/hooks/use-hydrated"
import { authClient } from "@/lib/auth-client"
import { formatDecimalSeptims, formatNumber, formatSeptims } from "@/lib/format"
import {
  sortActorEntries,
  type ActorSortKey,
  type SortDirection,
} from "@/lib/table-sorting"
import { cn } from "@/lib/utils"
import { startOfUtcWeek } from "../../../shared/time"

type ActorSortOption =
  | "incoming-asc"
  | "incoming-desc"
  | "name-asc"
  | "name-desc"
  | "net-asc"
  | "net-desc"
  | "operations-asc"
  | "operations-desc"
  | "outgoing-asc"
  | "outgoing-desc"
  | "salary-asc"
  | "salary-desc"

const actorSortOptions: readonly {
  label: string
  value: ActorSortOption
}[] = [
  { label: "Chiffre · plus élevé", value: "incoming-desc" },
  { label: "Chiffre · plus faible", value: "incoming-asc" },
  { label: "Nom · A à Z", value: "name-asc" },
  { label: "Nom · Z à A", value: "name-desc" },
  { label: "Achats · plus élevés", value: "outgoing-desc" },
  { label: "Achats · plus faibles", value: "outgoing-asc" },
  { label: "Solde · plus élevé", value: "net-desc" },
  { label: "Solde · plus faible", value: "net-asc" },
  { label: "Salaire · plus élevé", value: "salary-desc" },
  { label: "Salaire · plus faible", value: "salary-asc" },
  { label: "Opérations · plus", value: "operations-desc" },
  { label: "Opérations · moins", value: "operations-asc" },
]

function isActorSortOption(value: string): value is ActorSortOption {
  return actorSortOptions.some((option) => option.value === value)
}

const shortDateFormatter = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "2-digit",
})

function formatWeek(startsAt: number, endsAt: number): string {
  return `Du ${shortDateFormatter.format(startsAt)} au ${shortDateFormatter.format(endsAt)}`
}

export const Route = createFileRoute("/_app/compte")({
  component: AccountPage,
  errorComponent: PageError,
  loader: async ({ context }) => {
    const queryArgs = { currentWeekStartsAt: startOfUtcWeek(Date.now()) }
    await context.queryClient.ensureQueryData(
      convexQuery(api.accounts.overview, queryArgs)
    )
    return { queryArgs }
  },
  pendingComponent: PageSkeleton,
})

function AccountPage() {
  const { queryArgs } = Route.useLoaderData()
  const { data: session } = authClient.useSession()
  const isHydrated = useHydrated()
  const { data } = useSuspenseQuery(
    convexQuery(api.accounts.overview, queryArgs)
  )
  const isAdmin =
    isHydrated && (session?.user.role?.split(",").includes("admin") ?? false)
  const currentWeek = data.weeks[0]
  const resultAfterCharges = (currentWeek?.net ?? 0) - data.charges.total
  const [selectedWeekStartsAt, setSelectedWeekStartsAt] = useState(
    currentWeek?.startsAt.toString() ?? ""
  )
  const [actorSortOption, setActorSortOption] =
    useState<ActorSortOption>("incoming-desc")
  const selectedWeek =
    data.weeks.find(
      (week) => week.startsAt.toString() === selectedWeekStartsAt
    ) ?? currentWeek
  const [actorSortKey, actorSortDirection] = actorSortOption.split("-") as [
    ActorSortKey,
    SortDirection,
  ]
  const sortedActors = sortActorEntries(
    selectedWeek?.actors ?? [],
    actorSortKey,
    actorSortDirection
  )

  function handleActorSort(key: ActorSortKey) {
    const direction: SortDirection =
      actorSortKey === key
        ? actorSortDirection === "asc"
          ? "desc"
          : "asc"
        : key === "name"
          ? "asc"
          : "desc"
    setActorSortOption(`${key}-${direction}` as ActorSortOption)
  }

  return (
    <div className="animate-in duration-300 fade-in slide-in-from-bottom-1 motion-reduce:animate-none">
      <PageHeader
        action={
          isAdmin ? <AccountSettingsDialog settings={data.settings} /> : null
        }
        eyebrow="Tenue de boutique"
        title="Compte"
      >
        Suivez les entrées, les sorties et les charges de L’eau d’Roche sans
        refaire les calculs du classeur.
      </PageHeader>

      <section className="mt-7 grid gap-4 md:grid-cols-3">
        <AccountMetric
          description="Montant compté manuellement"
          icon={Coins}
          label="Caisse déclarée"
          value={formatDecimalSeptims(data.settings.cashBalance)}
        />
        <AccountMetric
          description="Réserve disponible déclarée"
          icon={Landmark}
          label="Fonds"
          value={formatDecimalSeptims(data.settings.fundsBalance)}
        />
        <AccountMetric
          description="Somme de toutes les transactions"
          icon={Scale}
          label="Solde du journal"
          tone={data.journalBalance >= 0 ? "positive" : "negative"}
          value={formatSeptims(data.journalBalance)}
        />
      </section>

      <Card className="mt-5 rounded-none border-[#5b462b]/35 bg-[#fff8e7]/30 py-0 ring-0">
        <CardHeader className="border-b border-border/60">
          <CardTitle className="flex items-center gap-2 font-display text-xl">
            <UsersRound aria-hidden="true" className="size-5 text-primary" />
            Activité par personnage
          </CardTitle>
          <CardDescription>
            Le chiffre, les achats et le salaire calculé sur les ventes hors
            commande de chaque membre de la boutique.
          </CardDescription>
          <CardAction className="flex flex-wrap justify-end gap-2 max-sm:col-span-2 max-sm:row-start-3">
            <Select
              onValueChange={setSelectedWeekStartsAt}
              value={selectedWeek?.startsAt.toString() ?? ""}
            >
              <SelectTrigger
                aria-label="Semaine détaillée"
                className="w-52 max-w-full bg-background/50"
              >
                <SelectValue placeholder="Choisir une semaine" />
              </SelectTrigger>
              <SelectContent>
                {data.weeks.map((week, index) => (
                  <SelectItem
                    key={week.startsAt}
                    value={week.startsAt.toString()}
                  >
                    {formatWeek(week.startsAt, week.endsAt)}
                    {index === 0 ? " · en cours" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              onValueChange={(value) => {
                if (isActorSortOption(value)) setActorSortOption(value)
              }}
              value={actorSortOption}
            >
              <SelectTrigger
                aria-label="Trier l’activité par personnage"
                className="w-52 max-w-full bg-background/50 md:hidden"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {actorSortOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardAction>
        </CardHeader>

        {selectedWeek && selectedWeek.actors.length > 0 ? (
          <>
            <CardContent className="px-0 max-md:hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-[#684f2d]/8 hover:bg-[#684f2d]/8">
                    <SortableTableHead
                      active={actorSortKey === "name"}
                      className="pl-4"
                      direction={actorSortDirection}
                      label="Personnage"
                      onSort={() => handleActorSort("name")}
                    />
                    <SortableTableHead
                      active={actorSortKey === "incoming"}
                      className="text-right"
                      direction={actorSortDirection}
                      inactiveDirection="desc"
                      label="Chiffre encaissé"
                      onSort={() => handleActorSort("incoming")}
                    />
                    <SortableTableHead
                      active={actorSortKey === "outgoing"}
                      className="text-right"
                      direction={actorSortDirection}
                      inactiveDirection="desc"
                      label="Achats"
                      onSort={() => handleActorSort("outgoing")}
                    />
                    <SortableTableHead
                      active={actorSortKey === "salary"}
                      className="text-right"
                      direction={actorSortDirection}
                      inactiveDirection="desc"
                      label={`Salaire (${formatNumber(data.settings.salaryRate * 100)} %)`}
                      onSort={() => handleActorSort("salary")}
                    />
                    <SortableTableHead
                      active={actorSortKey === "net"}
                      className="text-right"
                      direction={actorSortDirection}
                      inactiveDirection="desc"
                      label="Solde"
                      onSort={() => handleActorSort("net")}
                    />
                    <SortableTableHead
                      active={actorSortKey === "operations"}
                      className="pr-4 text-right"
                      direction={actorSortDirection}
                      inactiveDirection="desc"
                      label="Opérations"
                      onSort={() => handleActorSort("operations")}
                    />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedActors.map((actor) => (
                    <TableRow
                      className="border-[#5b462b]/20"
                      key={actor.actorCharacterId ?? actor.actorName}
                    >
                      <TableCell className="pl-4 font-semibold">
                        {actor.actorName}
                      </TableCell>
                      <TableCell className="text-right font-semibold text-[#456044] tabular-nums">
                        {formatSeptims(actor.incoming)}
                      </TableCell>
                      <TableCell className="text-right font-semibold text-[#8a3e2f] tabular-nums">
                        {formatSeptims(actor.outgoing)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <p className="font-semibold text-primary">
                          {formatDecimalSeptims(actor.salary)}
                        </p>
                        <p className="text-[0.68rem] text-muted-foreground">
                          sur {formatSeptims(actor.salaryRevenue)}
                        </p>
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right font-display tabular-nums",
                          actor.net >= 0 ? "text-[#456044]" : "text-[#8a3e2f]"
                        )}
                      >
                        {actor.net > 0 ? "+" : ""}
                        {formatSeptims(actor.net)}
                      </TableCell>
                      <TableCell className="pr-4 text-right text-muted-foreground tabular-nums">
                        {formatNumber(actor.transactionCount)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>

            <CardContent className="grid divide-y divide-border/70 px-0 py-0 md:hidden">
              {sortedActors.map((actor) => (
                <div
                  className="grid gap-3 p-4"
                  key={actor.actorCharacterId ?? actor.actorName}
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-semibold">{actor.actorName}</p>
                    <Badge variant="outline">
                      {formatNumber(actor.transactionCount)} opération
                      {actor.transactionCount === 1 ? "" : "s"}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-right">
                    <ActorAmount
                      label="Chiffre"
                      tone="positive"
                      value={actor.incoming}
                    />
                    <ActorAmount
                      label="Achats"
                      tone="negative"
                      value={actor.outgoing}
                    />
                    <ActorAmount
                      label="Solde"
                      signed
                      tone={actor.net >= 0 ? "positive" : "negative"}
                      value={actor.net}
                    />
                    <ActorAmount
                      decimal
                      detail={`sur ${formatSeptims(actor.salaryRevenue)}`}
                      label={`Salaire · ${formatNumber(data.settings.salaryRate * 100)} %`}
                      tone="positive"
                      value={actor.salary}
                    />
                  </div>
                </div>
              ))}
            </CardContent>
          </>
        ) : (
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Aucun mouvement enregistré pour cette semaine.
          </CardContent>
        )}
      </Card>

      <section className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(19rem,0.65fr)]">
        <Card className="rounded-none border-[#5b462b]/35 bg-[#fff8e7]/30 py-0 ring-0">
          <CardHeader className="border-b border-border/60">
            <CardTitle className="flex items-center gap-2 font-display text-xl">
              <ReceiptText aria-hidden="true" className="size-5 text-primary" />
              Bilan hebdomadaire
            </CardTitle>
            <CardDescription>
              Les huit dernières semaines, calculées depuis le journal.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0 max-md:hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-[#684f2d]/8 hover:bg-[#684f2d]/8">
                  <TableHead className="pl-4">Semaine</TableHead>
                  <TableHead className="text-right">Entrées</TableHead>
                  <TableHead className="text-right">Sorties</TableHead>
                  <TableHead className="pr-4 text-right">Solde</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.weeks.map((week, index) => (
                  <TableRow className="border-[#5b462b]/20" key={week.startsAt}>
                    <TableCell className="pl-4">
                      <p className="font-semibold">
                        {formatWeek(week.startsAt, week.endsAt)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatNumber(week.transactionCount)} mouvement
                        {week.transactionCount === 1 ? "" : "s"}
                      </p>
                      {index === 0 ? (
                        <Badge className="mt-1" variant="outline">
                          Semaine en cours
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right font-semibold text-[#456044] tabular-nums">
                      {formatSeptims(week.incoming)}
                    </TableCell>
                    <TableCell className="text-right font-semibold text-[#8a3e2f] tabular-nums">
                      {formatSeptims(week.outgoing)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "pr-4 text-right font-display text-base tabular-nums",
                        week.net >= 0 ? "text-[#456044]" : "text-[#8a3e2f]"
                      )}
                    >
                      {week.net > 0 ? "+" : ""}
                      {formatSeptims(week.net)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
          <CardContent className="grid divide-y divide-border/70 px-0 py-0 md:hidden">
            {data.weeks.map((week, index) => (
              <div className="grid gap-3 p-4" key={week.startsAt}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">
                      {formatWeek(week.startsAt, week.endsAt)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatNumber(week.transactionCount)} mouvement
                      {week.transactionCount === 1 ? "" : "s"}
                    </p>
                  </div>
                  {index === 0 ? (
                    <Badge variant="outline">En cours</Badge>
                  ) : null}
                </div>
                <div className="grid grid-cols-3 gap-2 text-right">
                  <div>
                    <p className="text-[0.62rem] font-bold tracking-wider text-muted-foreground uppercase">
                      Entrées
                    </p>
                    <p className="mt-1 text-sm font-semibold text-[#456044] tabular-nums">
                      {formatSeptims(week.incoming)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[0.62rem] font-bold tracking-wider text-muted-foreground uppercase">
                      Sorties
                    </p>
                    <p className="mt-1 text-sm font-semibold text-[#8a3e2f] tabular-nums">
                      {formatSeptims(week.outgoing)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[0.62rem] font-bold tracking-wider text-muted-foreground uppercase">
                      Solde
                    </p>
                    <p
                      className={cn(
                        "mt-1 font-display text-sm tabular-nums",
                        week.net >= 0 ? "text-[#456044]" : "text-[#8a3e2f]"
                      )}
                    >
                      {week.net > 0 ? "+" : ""}
                      {formatSeptims(week.net)}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="h-fit rounded-none border-t-[3px] border-[#5b462b]/35 border-t-primary/60 bg-[#fff8e7]/30 ring-0">
          <CardHeader>
            <CardTitle className="font-display text-xl">
              Charges de la semaine
            </CardTitle>
            <CardDescription>
              Estimation avec les paramètres comptables actuels.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <ChargeRow
              icon={Landmark}
              label="Loyer"
              value={data.charges.rent}
            />
            <ChargeRow
              detail={`${formatNumber(data.settings.employeeCount)} employé${data.settings.employeeCount === 1 ? "" : "s"}`}
              icon={UsersRound}
              label="Cens"
              value={data.charges.census}
            />
            <ChargeRow
              detail={`${formatNumber(data.settings.taxRate * 100)} % des entrées`}
              icon={ArrowUpRight}
              label="Taxe"
              value={data.charges.tax}
            />
            <ChargeRow
              detail={`${formatNumber(data.settings.salaryRate * 100)} % de ${formatDecimalSeptims(currentWeek?.salaryRevenue ?? 0)} de ventes hors commande`}
              icon={ArrowDownLeft}
              label="Salaires"
              value={data.charges.salary}
            />
            <Separator className="my-1" />
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-[0.65rem] font-bold tracking-[0.14em] text-muted-foreground uppercase">
                  Total des charges
                </p>
                <p className="mt-1 font-display text-2xl text-primary tabular-nums">
                  {formatDecimalSeptims(data.charges.total)}
                </p>
              </div>
            </div>
            <Separator className="my-1" />
            <div>
              <p className="text-xs text-muted-foreground">
                Résultat courant après charges
              </p>
              <p
                className={cn(
                  "mt-1 font-display text-xl tabular-nums",
                  resultAfterCharges >= 0 ? "text-[#456044]" : "text-[#8a3e2f]"
                )}
              >
                {resultAfterCharges > 0 ? "+" : ""}
                {formatDecimalSeptims(resultAfterCharges)}
              </p>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  )
}

function ActorAmount({
  decimal = false,
  detail,
  label,
  signed = false,
  tone,
  value,
}: Readonly<{
  decimal?: boolean
  detail?: string
  label: string
  signed?: boolean
  tone: "negative" | "positive"
  value: number
}>) {
  return (
    <div>
      <p className="text-[0.62rem] font-bold tracking-wider text-muted-foreground uppercase">
        {label}
      </p>
      <p
        className={cn(
          "mt-1 text-sm font-semibold tabular-nums",
          tone === "positive" ? "text-[#456044]" : "text-[#8a3e2f]"
        )}
      >
        {signed && value > 0 ? "+" : ""}
        {decimal ? formatDecimalSeptims(value) : formatSeptims(value)}
      </p>
      {detail ? (
        <p className="mt-0.5 text-[0.68rem] text-muted-foreground">{detail}</p>
      ) : null}
    </div>
  )
}

function AccountMetric({
  description,
  icon: Icon,
  label,
  tone,
  value,
}: Readonly<{
  description: string
  icon: typeof Coins
  label: string
  tone?: "negative" | "positive"
  value: string
}>) {
  return (
    <Card className="rounded-none border-[#5b462b]/35 bg-[#fff8e7]/30 ring-0">
      <CardHeader>
        <CardDescription className="flex items-center gap-2">
          <Icon aria-hidden="true" className="size-4 text-primary" />
          {label}
        </CardDescription>
        <CardTitle
          className={cn(
            "font-display text-2xl tabular-nums",
            tone === "positive" && "text-[#456044]",
            tone === "negative" && "text-[#8a3e2f]"
          )}
        >
          {value}
        </CardTitle>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground">
        {description}
      </CardContent>
    </Card>
  )
}

function ChargeRow({
  detail,
  icon: Icon,
  label,
  value,
}: Readonly<{
  detail?: string
  icon: typeof Coins
  label: string
  value: number
}>) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-2">
        <Icon aria-hidden="true" className="size-4 shrink-0 text-primary" />
        <div className="min-w-0">
          <p className="text-sm font-semibold">{label}</p>
          {detail ? (
            <p className="truncate text-xs text-muted-foreground">{detail}</p>
          ) : null}
        </div>
      </div>
      <p className="shrink-0 font-semibold tabular-nums">
        {formatDecimalSeptims(value)}
      </p>
    </div>
  )
}
