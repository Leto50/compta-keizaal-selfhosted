import { convexQuery } from "@convex-dev/react-query"
import { useSuspenseQuery } from "@tanstack/react-query"
import { type FunctionReturnType } from "convex/server"
import { ChevronDown, Leaf } from "lucide-react"
import { useState } from "react"

import { DeleteHarvestDialog, HarvestDialog } from "@/components/harvest-dialog"
import { HarvestValueSummary } from "@/components/harvest-value-summary"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatDate, formatQuantity } from "@/lib/format"
import { usePermissions } from "@/hooks/use-permissions"
import { api } from "../../convex/_generated/api"

const PAGE_SIZE = 30
export type HarvestHistoryProps = Readonly<{
  characters: FunctionReturnType<typeof api.characters.list>
  products: FunctionReturnType<typeof api.products.list>
  character?: FunctionReturnType<
    typeof api.harvests.listGroups
  >["groups"][number]["character"]
  weekStartsAt?: number
  label?: string
}>

export function HarvestHistory({
  characters,
  products,
  character,
  weekStartsAt,
  label = "Historique des récoltes",
}: HarvestHistoryProps) {
  const { canWrite, showPurchasePrices } = usePermissions()
  const [pagination, setPagination] = useState<{
    cursor: string | null
    previousCursors: (string | null)[]
  }>({ cursor: null, previousCursors: [] })
  const { data: result } = useSuspenseQuery(
    convexQuery(api.harvests.listPage, {
      character,
      weekStartsAt,
      paginationOpts: { cursor: pagination.cursor, numItems: PAGE_SIZE },
    })
  )
  return (
    <div>
      {result.page.length === 0 ? (
        <Alert className="mt-7 border-primary/20 bg-primary/[0.04]">
          <Leaf aria-hidden="true" />
          <AlertTitle>
            {weekStartsAt !== undefined
              ? "Aucune récolte cette semaine"
              : pagination.cursor === null
                ? "Aucune récolte enregistrée"
                : "Aucune récolte sur cette page"}
          </AlertTitle>
          <AlertDescription>
            {canWrite
              ? "Utilisez « Nouvelle récolte » pour ajouter les ingrédients collectés au stock."
              : "Aucune récolte accessible avec les filtres sélectionnés."}
          </AlertDescription>
        </Alert>
      ) : (
        <div className="mt-7 border-y border-t-2 border-[#5b462b]/35">
          <Table aria-label={label} className="max-md:block">
            <TableHeader className="max-md:hidden">
              <TableRow className="border-b-[#5b462b]/50 bg-[#684f2d]/10 hover:bg-[#684f2d]/10">
                <TableHead scope="col" className="pl-4">
                  Date
                </TableHead>
                <TableHead scope="col">Personnage</TableHead>
                <TableHead scope="col">Ingrédients</TableHead>
                <TableHead scope="col" className="text-right">
                  Quantité
                </TableHead>
                {showPurchasePrices ? (
                  <TableHead scope="col" className="pr-4 text-right">
                    Économie estimée
                  </TableHead>
                ) : null}
                {canWrite ? (
                  <TableHead scope="col" className="text-right">
                    Actions
                  </TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody className="max-md:block">
              {result.page.map((harvest) => (
                <TableRow
                  className="border-[#5b462b]/20 hover:bg-[#fffdeb]/40 max-md:relative max-md:grid max-md:grid-cols-[minmax(0,1fr)_auto] max-md:gap-x-3 max-md:gap-y-1 max-md:p-4"
                  key={harvest._id}
                >
                  <TableCell className="pl-4 text-muted-foreground max-md:col-start-1 max-md:row-start-2 max-md:p-0">
                    <time dateTime={new Date(harvest.occurredAt).toISOString()}>
                      {formatDate(harvest.occurredAt)}
                    </time>
                  </TableCell>
                  <TableCell className="max-w-40 font-semibold break-words whitespace-normal max-md:col-span-2 max-md:col-start-1 max-md:row-start-1 max-md:max-w-none max-md:p-0 max-md:pr-16 max-md:font-display max-md:text-base">
                    {harvest.actorName}
                  </TableCell>
                  <TableCell className="max-w-72 whitespace-normal max-md:col-span-2 max-md:col-start-1 max-md:row-start-3 max-md:max-w-none max-md:p-0 max-md:pt-2">
                    <p className="break-words">
                      {harvest.lines[0]?.productName}
                      {harvest.lines.length > 1 ? (
                        <span className="text-muted-foreground">
                          {" "}
                          · +{harvest.lines.length - 1} ingrédient
                          {harvest.lines.length > 2 ? "s" : ""}
                        </span>
                      ) : null}
                    </p>
                    {harvest.lines.length > 1 || harvest.comment ? (
                      <Collapsible>
                        <CollapsibleTrigger asChild>
                          <Button
                            className="group mt-1 h-auto px-0 text-[0.68rem]"
                            type="button"
                            variant="link"
                            aria-label={`Voir le détail de la récolte de ${harvest.actorName} du ${formatDate(harvest.occurredAt)}`}
                          >
                            Voir le détail
                            <ChevronDown
                              aria-hidden="true"
                              className="transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none"
                            />
                          </Button>
                        </CollapsibleTrigger>
                        <CollapsibleContent className="pt-1">
                          <ul className="grid gap-1 border-l border-primary/30 pl-2 text-xs text-muted-foreground">
                            {harvest.lines.map((line) => (
                              <li
                                className="flex justify-between gap-3"
                                key={line._id}
                              >
                                <span className="min-w-0 break-words">
                                  {line.productName}
                                </span>
                                <span className="shrink-0 tabular-nums">
                                  +{formatQuantity(line.quantity)}
                                </span>
                              </li>
                            ))}
                          </ul>
                          {harvest.comment ? (
                            <p className="mt-2 text-xs break-words whitespace-pre-wrap text-muted-foreground">
                              {harvest.comment}
                            </p>
                          ) : null}
                        </CollapsibleContent>
                      </Collapsible>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right font-semibold text-[#405c43] tabular-nums max-md:col-start-1 max-md:row-start-4 max-md:self-start max-md:p-0 max-md:pt-2 max-md:text-left">
                    +
                    {formatQuantity(
                      harvest.lines.reduce(
                        (quantity, line) => quantity + line.quantity,
                        0
                      )
                    )}
                  </TableCell>
                  {showPurchasePrices ? (
                    <TableCell className="pr-4 text-right whitespace-normal max-md:col-start-2 max-md:row-start-4 max-md:p-0 max-md:pt-2">
                      <HarvestValueSummary compact lines={harvest.lines} />
                    </TableCell>
                  ) : null}
                  {canWrite ? (
                    <TableCell className="pr-2 text-right max-md:absolute max-md:top-3 max-md:right-3 max-md:p-0">
                      <div className="flex justify-end gap-1">
                        <HarvestDialog
                          characters={characters}
                          products={products}
                          harvest={harvest}
                        />
                        <DeleteHarvestDialog harvest={harvest} />
                      </div>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
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
