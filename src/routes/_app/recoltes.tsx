import { convexQuery } from "@convex-dev/react-query"
import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, Link, redirect } from "@tanstack/react-router"
import { Leaf } from "lucide-react"
import { useState } from "react"

import { DeleteHarvestDialog, HarvestDialog } from "@/components/harvest-dialog"
import { HarvestValueSummary } from "@/components/harvest-value-summary"
import { PageError } from "@/components/page-error"
import { PageHeader } from "@/components/page-header"
import { PageSkeleton } from "@/components/page-skeleton"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { usePermissions } from "@/hooks/use-permissions"
import { formatDate, formatQuantity } from "@/lib/format"
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
  const [pagination, setPagination] = useState<{
    cursor: string | null
    previousCursors: (string | null)[]
  }>({ cursor: null, previousCursors: [] })
  const { data: result } = useSuspenseQuery(
    convexQuery(api.harvests.listPage, {
      paginationOpts: { cursor: pagination.cursor, numItems: PAGE_SIZE },
    })
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
      {result.page.length === 0 ? (
        <Alert className="mt-7 border-primary/20 bg-primary/[0.04]">
          <Leaf aria-hidden="true" />
          <AlertTitle>
            {pagination.cursor === null
              ? "Aucune récolte enregistrée"
              : "Aucune récolte sur cette page"}
          </AlertTitle>
          <AlertDescription>
            Utilisez « J’ai récolté » pour ajouter les ingrédients collectés au
            stock.
          </AlertDescription>
        </Alert>
      ) : (
        <div className="mt-7 grid gap-4">
          {result.page.map((harvest) => (
            <article
              className="min-w-0 border border-[#5b462b]/30 bg-[#fff8e7]/30 p-4 sm:p-5"
              key={harvest._id}
            >
              <header className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">
                    {formatDate(harvest.occurredAt)}
                  </p>
                  <h2 className="mt-1 font-display text-lg font-medium break-words">
                    {harvest.actorName}
                  </h2>
                </div>
                <DeleteHarvestDialog harvest={harvest} />
              </header>
              <ul className="mt-3 grid gap-2 border-t border-border/70 pt-3">
                {harvest.lines.map((line) => (
                  <li
                    className="flex justify-between gap-3 text-sm"
                    key={line._id}
                  >
                    <span className="min-w-0 break-words">
                      {line.productName}
                    </span>
                    <span className="shrink-0 font-semibold text-[#405c43] tabular-nums">
                      +{formatQuantity(line.quantity)}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-3">
                <HarvestValueSummary lines={harvest.lines} />
              </div>
              {harvest.comment ? (
                <p className="mt-3 text-sm break-words whitespace-pre-wrap text-muted-foreground">
                  {harvest.comment}
                </p>
              ) : null}
            </article>
          ))}
        </div>
      )}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Page {pagination.previousCursors.length + 1}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={pagination.previousCursors.length === 0}
            onClick={() =>
              setPagination((current) => ({
                cursor: current.previousCursors.at(-1) ?? null,
                previousCursors: current.previousCursors.slice(0, -1),
              }))
            }
          >
            Précédente
          </Button>
          <Button
            variant="outline"
            disabled={result.isDone}
            onClick={() =>
              setPagination((current) => ({
                cursor: result.continueCursor,
                previousCursors: [...current.previousCursors, current.cursor],
              }))
            }
          >
            Suivante
          </Button>
        </div>
      </div>
    </div>
  )
}
