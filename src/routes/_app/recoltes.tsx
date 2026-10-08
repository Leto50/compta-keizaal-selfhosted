import { convexQuery } from "@convex-dev/react-query"
import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useState } from "react"

import { HarvestDialog } from "@/components/harvest-dialog"
import {
  HarvestHistory,
  type HarvestHistoryProps,
} from "@/components/harvest-history"
import { HarvestGroups } from "@/components/harvest-groups"
import { PageError } from "@/components/page-error"
import { PageHeader } from "@/components/page-header"
import { PageSkeleton } from "@/components/page-skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { usePermissions } from "@/hooks/use-permissions"
import { formatHarvestWeek } from "@/lib/harvest-weeks"
import { readerRouteAccess, withReaderAccess } from "@/lib/reader-route-access"
import { api } from "../../../convex/_generated/api"
import { canWrite } from "../../../shared/account-roles"

const PAGE_SIZE = 30
const initialPageArgs = {
  paginationOpts: { cursor: null, numItems: PAGE_SIZE },
}

export const Route = createFileRoute("/_app/recoltes")({
  beforeLoad: readerRouteAccess("harvests"),
  component: withReaderAccess(HarvestPage, "harvests"),
  errorComponent: PageError,
  loader: async ({ context }) => {
    const user = await context.queryClient.ensureQueryData(
      convexQuery(api.auth.getCurrentUser, {})
    )
    await Promise.all([
      context.queryClient.ensureQueryData(
        convexQuery(api.harvests.listPage, initialPageArgs)
      ),
      canWrite(user?.role)
        ? context.queryClient.ensureQueryData(
            convexQuery(api.products.list, { category: "ingredient" })
          )
        : undefined,
      canWrite(user?.role)
        ? context.queryClient.ensureQueryData(
            convexQuery(api.characters.list, {})
          )
        : undefined,
      context.queryClient.ensureQueryData(
        convexQuery(api.harvests.listWeeks, {})
      ),
    ])
  },
  pendingComponent: PageSkeleton,
})

function HarvestPage() {
  const { canWrite } = usePermissions()
  return canWrite ? (
    <HarvestWriterPage />
  ) : (
    <HarvestsPage characters={[]} products={[]} />
  )
}

function HarvestWriterPage() {
  const { data: products } = useSuspenseQuery(
    convexQuery(api.products.list, { category: "ingredient" })
  )
  const { data: characters } = useSuspenseQuery(
    convexQuery(api.characters.list, {})
  )
  return <HarvestsPage characters={characters} products={products} />
}

function HarvestsPage({
  characters,
  products,
}: Pick<HarvestHistoryProps, "characters" | "products">) {
  const { canWrite } = usePermissions()
  const [groupBy, setGroupBy] = useState<"none" | "character">("none")
  const [selectedWeek, setSelectedWeek] = useState("all")
  const weekStartsAt = selectedWeek === "all" ? undefined : Number(selectedWeek)
  const { data: weeks } = useSuspenseQuery(
    convexQuery(api.harvests.listWeeks, {})
  )

  return (
    <div className="animate-in duration-300 fade-in slide-in-from-bottom-1 motion-reduce:animate-none">
      <PageHeader
        eyebrow="Entrées de stock"
        title="Récoltes"
        action={
          canWrite ? (
            <HarvestDialog characters={characters} products={products} />
          ) : undefined
        }
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
