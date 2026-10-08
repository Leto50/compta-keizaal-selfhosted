import { convexQuery } from "@convex-dev/react-query"
import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, Link, redirect } from "@tanstack/react-router"
import { useState } from "react"

import { HarvestDialog } from "@/components/harvest-dialog"
import { HarvestHistory } from "@/components/harvest-history"
import { HarvestGroups } from "@/components/harvest-groups"
import { PageError } from "@/components/page-error"
import { PageHeader } from "@/components/page-header"
import { PageSkeleton } from "@/components/page-skeleton"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { usePermissions } from "@/hooks/use-permissions"
import { formatHarvestWeek } from "@/lib/harvest-weeks"
import { api } from "../../../convex/_generated/api"
import { canWrite } from "../../../shared/account-roles"

const PAGE_SIZE = 30
const initialPageArgs = {
  paginationOpts: { cursor: null, numItems: PAGE_SIZE },
}

export const Route = createFileRoute("/_app/recoltes")({
  beforeLoad: async ({ context }) => {
    const user = await context.queryClient.fetchQuery({
      ...convexQuery(api.auth.getCurrentUser, {}),
      staleTime: 0,
    })
    if (!canWrite(user?.role)) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw redirect({ to: "/" })
    }
  },
  component: HarvestAccessGuard,
  errorComponent: PageError,
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(
        convexQuery(api.harvests.listPage, initialPageArgs)
      ),
      context.queryClient.ensureQueryData(
        convexQuery(api.products.list, { category: "ingredient" })
      ),
      context.queryClient.ensureQueryData(convexQuery(api.characters.list, {})),
      context.queryClient.ensureQueryData(
        convexQuery(api.harvests.listWeeks, {})
      ),
    ])
  },
  pendingComponent: PageSkeleton,
})

function HarvestAccessGuard() {
  const { canWrite, isPending } = usePermissions()
  if (isPending) return <PageSkeleton />
  if (!canWrite)
    return (
      <Alert>
        <AlertTitle>Accès non autorisé</AlertTitle>
        <AlertDescription>
          Cette rubrique est réservée aux employés et administrateurs.{" "}
          <Link to="/" className="underline">
            Retour à l’accueil
          </Link>
        </AlertDescription>
      </Alert>
    )
  return <HarvestsPage />
}

function HarvestsPage() {
  const [groupBy, setGroupBy] = useState<"none" | "character">("none")
  const [selectedWeek, setSelectedWeek] = useState("all")
  const weekStartsAt = selectedWeek === "all" ? undefined : Number(selectedWeek)
  const { data: weeks } = useSuspenseQuery(
    convexQuery(api.harvests.listWeeks, {})
  )
  const { data: products } = useSuspenseQuery(
    convexQuery(api.products.list, { category: "ingredient" })
  )
  const { data: characters } = useSuspenseQuery(
    convexQuery(api.characters.list, {})
  )

  return (
    <div className="animate-in duration-300 fade-in slide-in-from-bottom-1 motion-reduce:animate-none">
      <PageHeader
        eyebrow="Entrées de stock"
        title="Récoltes"
        action={<HarvestDialog characters={characters} products={products} />}
      >
        Qui a récolté quoi, quand et en quelle quantité. Les ingrédients
        collectés rejoignent directement l’inventaire.
      </PageHeader>
      <div className="mt-7 flex flex-wrap items-end gap-x-6 gap-y-4">
        <div className="grid w-full gap-2 sm:w-auto">
          <label htmlFor="harvest-grouping" className="text-sm font-semibold">
            Regrouper par
          </label>
          <Select
            value={groupBy}
            onValueChange={(value) => {
              if (value === "none" || value === "character") setGroupBy(value)
            }}
          >
            <SelectTrigger id="harvest-grouping" className="w-full sm:w-60">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Aucun regroupement</SelectItem>
              <SelectItem value="character">Personnage</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid w-full gap-2 sm:w-auto">
          <label htmlFor="harvest-week" className="text-sm font-semibold">
            Semaine
          </label>
          <Select value={selectedWeek} onValueChange={setSelectedWeek}>
            <SelectTrigger id="harvest-week" className="w-full sm:w-80">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes les semaines</SelectItem>
              {weeks.map((week) => (
                <SelectItem key={week} value={week.toString()}>
                  {formatHarvestWeek(week)}
                </SelectItem>
              ))}
              {weekStartsAt !== undefined && !weeks.includes(weekStartsAt) ? (
                <SelectItem value={selectedWeek}>
                  {formatHarvestWeek(weekStartsAt)}
                </SelectItem>
              ) : null}
            </SelectContent>
          </Select>
        </div>
      </div>
      {groupBy === "none" ? (
        <HarvestHistory
          key={selectedWeek}
          characters={characters}
          products={products}
          weekStartsAt={weekStartsAt}
        />
      ) : (
        <HarvestGroups
          key={selectedWeek}
          weekStartsAt={weekStartsAt}
          characters={characters}
          products={products}
        />
      )}
    </div>
  )
}
