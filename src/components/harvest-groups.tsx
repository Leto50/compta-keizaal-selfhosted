import { convexQuery } from "@convex-dev/react-query"
import { useSuspenseQuery } from "@tanstack/react-query"
import { type FunctionReturnType } from "convex/server"
import { ChevronDown, Leaf } from "lucide-react"
import { useState } from "react"

import {
  HarvestHistory,
  type HarvestHistoryProps,
} from "@/components/harvest-history"
import { HarvestValueAmount } from "@/components/harvest-value-summary"
import { Alert, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { formatNumber, formatQuantity } from "@/lib/format"
import { usePermissions } from "@/hooks/use-permissions"
import { api } from "../../convex/_generated/api"

type Group = FunctionReturnType<
  typeof api.harvests.listGroups
>["groups"][number]
export function HarvestGroups({
  characters,
  products,
  weekStartsAt,
}: HarvestHistoryProps) {
  const [page, setPage] = useState(0)
  const { data: result } = useSuspenseQuery(
    convexQuery(api.harvests.listGroups, { weekStartsAt, page })
  )
  return (
    <div className="mt-7">
      <p className="mb-3 text-sm text-muted-foreground">
        {weekStartsAt === undefined
          ? "Totaux par personnage sur toutes les semaines."
          : "Totaux par personnage pour la semaine sélectionnée."}
      </p>
      {result.groups.length === 0 ? (
        <Alert>
          <Leaf aria-hidden="true" />
          <AlertTitle>
            {weekStartsAt === undefined
              ? "Aucune récolte enregistrée"
              : "Aucune récolte cette semaine"}
          </AlertTitle>
        </Alert>
      ) : (
        <div className="border-y border-t-2 border-[#5b462b]/35">
          {result.groups.map((group) => (
            <HarvestGroup
              key={group.key}
              group={group}
              characters={characters}
              products={products}
              weekStartsAt={weekStartsAt}
            />
          ))}
        </div>
      )}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Page {result.page + 1} sur {result.pageCount}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={result.page === 0}
            onClick={() => setPage(result.page - 1)}
          >
            Précédente
          </Button>
          <Button
            variant="outline"
            disabled={result.page + 1 >= result.pageCount}
            onClick={() => setPage(result.page + 1)}
          >
            Suivante
          </Button>
        </div>
      </div>
    </div>
  )
}

function HarvestGroup({
  group,
  characters,
  products,
  weekStartsAt,
}: HarvestHistoryProps & Readonly<{ group: Group }>) {
  const { showPurchasePrices } = usePermissions()
  const [open, setOpen] = useState(false)
  const label = group.character.name
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="border-b border-[#5b462b]/20 last:border-b-0"
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 bg-[#684f2d]/[0.06] p-4 md:grid-cols-[minmax(0,1fr)_auto_auto_auto] md:gap-x-6">
        <div className="min-w-0 max-md:col-span-2 max-md:col-start-1 max-md:row-start-1 max-md:pr-10">
          <h2 className="font-display text-sm font-semibold break-words">
            {label}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {formatNumber(group.harvestCount)} récolte
            {group.harvestCount > 1 ? "s" : ""}
          </p>
        </div>
        <p className="text-sm font-semibold text-[#405c43] tabular-nums">
          <span className="text-xs font-normal text-muted-foreground">
            Quantité{" "}
          </span>
          +{formatQuantity(group.quantity)}
        </p>
        {showPurchasePrices ? (
          <HarvestValueAmount
            compact
            showLabel
            knownValue={group.knownValue}
            unpricedLineCount={group.unpricedLineCount}
            lineCount={group.lineCount}
          />
        ) : null}
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="group max-md:col-start-2 max-md:row-start-1 max-md:justify-self-end"
            aria-label={`${open ? "Masquer" : "Voir"} les récoltes : ${label}`}
          >
            <ChevronDown
              aria-hidden="true"
              className="transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none"
            />
          </Button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent className="px-1 pb-4 md:px-4">
        {open ? (
          <HarvestHistory
            characters={characters}
            products={products}
            character={group.character}
            weekStartsAt={weekStartsAt}
            label={`Récoltes : ${label}`}
          />
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  )
}
