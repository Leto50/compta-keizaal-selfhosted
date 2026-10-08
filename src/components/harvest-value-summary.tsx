import { formatDecimalSeptims } from "@/lib/format"
import {
  calculateHarvestValue,
  type HarvestValueLine,
} from "../../shared/harvest-value"

export function HarvestValueSummary({
  lines,
}: Readonly<{ lines: readonly HarvestValueLine[] }>) {
  const { knownValue, unpricedLineCount } = calculateHarvestValue(lines)
  const hasKnownPrices = unpricedLineCount < lines.length

  return (
    <div className="grid gap-1 border-t border-border/70 pt-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
        <p>
          {unpricedLineCount === 0
            ? "Économie estimée à l’achat"
            : "Valeur connue à l’achat"}
        </p>
        <p className="font-semibold text-[#405c43] tabular-nums">
          {hasKnownPrices ? formatDecimalSeptims(knownValue) : "Non renseignée"}
        </p>
      </div>
      {unpricedLineCount > 0 ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          Estimation incomplète : {unpricedLineCount} ingrédient
          {unpricedLineCount > 1 ? "s" : ""} sans prix d’achat.
        </p>
      ) : null}
    </div>
  )
}
