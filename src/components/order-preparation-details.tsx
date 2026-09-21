import { ChevronDown, CircleAlert, FlaskConical } from "lucide-react"
import { useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Separator } from "@/components/ui/separator"
import { formatDecimalSeptims, formatNumber } from "@/lib/format"
import { type OrderPreparation } from "@/lib/order-preparation"
import { cn } from "@/lib/utils"

export function OrderPreparationDetails({
  defaultOpen = false,
  preparation,
}: Readonly<{
  defaultOpen?: boolean
  preparation: OrderPreparation
}>) {
  const [open, setOpen] = useState(defaultOpen)
  if (preparation.referenceCount === 0) return null

  return (
    <Collapsible onOpenChange={setOpen} open={open}>
      <Card className="gap-0 rounded-none border-[#5b462b]/25 bg-[#fffbed]/35 py-0 ring-0">
        <CardContent className="p-0">
          <CollapsibleTrigger asChild>
            <Button
              className="h-auto w-full justify-between rounded-none px-3 py-2.5 text-left"
              type="button"
              variant="ghost"
            >
              <span className="flex min-w-0 items-center gap-2">
                <FlaskConical
                  aria-hidden="true"
                  className="size-4 shrink-0 text-primary"
                />
                <span className="min-w-0">
                  <span className="block text-[0.64rem] font-bold tracking-[0.14em] text-muted-foreground uppercase">
                    Préparation
                  </span>
                  <span className="block truncate text-xs font-semibold">
                    {preparation.ingredients.length}{" "}
                    {preparation.ingredients.length === 1
                      ? "ingrédient"
                      : "ingrédients"}
                    {preparation.productionCost === undefined
                      ? " · coût matière incomplet"
                      : ` · coût matière : ${formatDecimalSeptims(preparation.productionCost)}`}
                  </span>
                </span>
              </span>
              <ChevronDown
                aria-hidden="true"
                className={cn(
                  "size-4 shrink-0 transition-transform",
                  open && "rotate-180"
                )}
              />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="animate-in duration-200 fade-in slide-in-from-top-1 motion-reduce:animate-none">
            <Separator />
            <div className="grid gap-3 p-3">
              {preparation.ingredients.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {preparation.ingredients.map((ingredient) => (
                    <Badge
                      className="border-[#614b2c]/20 bg-[#6b5939]/[0.07] text-[#5a4b37]"
                      key={ingredient.productId ?? ingredient.ingredientName}
                      variant="outline"
                    >
                      <strong>{formatNumber(ingredient.quantity)}</strong>{" "}
                      {ingredient.ingredientName}
                    </Badge>
                  ))}
                </div>
              ) : null}
              {preparation.missingRecipeReferences.length > 0 ? (
                <p className="flex items-start gap-2 text-xs text-muted-foreground">
                  <CircleAlert
                    aria-hidden="true"
                    className="mt-0.5 size-3.5 shrink-0 text-[#8a4233]"
                  />
                  Recette à renseigner pour :{" "}
                  {preparation.missingRecipeReferences.join(", ")}.
                </p>
              ) : null}
              {preparation.productionCost === undefined &&
              preparation.missingCostReferences.length > 0 ? (
                <p className="text-xs text-muted-foreground">
                  Le coût matière restera incomplet tant que le coût de{" "}
                  {preparation.missingCostReferences.join(", ")} n’est pas
                  renseigné.
                </p>
              ) : null}
            </div>
          </CollapsibleContent>
        </CardContent>
      </Card>
    </Collapsible>
  )
}
