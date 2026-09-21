import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group"
import { type PriceDraft } from "@/lib/prices"

export function PriceInput({
  ariaInvalid = false,
  id,
  name,
  onBlur,
  onValueChange,
  value,
}: Readonly<{
  ariaInvalid?: boolean
  id: string
  name?: string
  onBlur?: () => void
  onValueChange: (value: PriceDraft) => void
  value: PriceDraft
}>) {
  return (
    <div className="grid min-w-0 grid-cols-[minmax(4.5rem,1fr)_auto_minmax(4.5rem,1fr)] items-center gap-2">
      <InputGroup className="h-9 bg-background/50">
        <InputGroupInput
          aria-invalid={ariaInvalid}
          aria-label="Nombre de septims"
          id={id}
          min="0"
          name={name ? `${name}.septims` : undefined}
          onBlur={onBlur}
          onChange={(event) =>
            onValueChange({ ...value, septims: event.target.value })
          }
          placeholder="1"
          step="1"
          type="number"
          value={value.septims}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupText>sept.</InputGroupText>
        </InputGroupAddon>
      </InputGroup>
      <span className="text-xs text-muted-foreground">pour</span>
      <InputGroup className="h-9 bg-background/50">
        <InputGroupInput
          aria-invalid={ariaInvalid}
          aria-label="Nombre d’unités couvertes par le prix"
          min="1"
          name={name ? `${name}.units` : undefined}
          onBlur={onBlur}
          onChange={(event) =>
            onValueChange({ ...value, units: event.target.value })
          }
          placeholder="1"
          required={Boolean(value.septims.trim())}
          step="1"
          type="number"
          value={value.units}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupText>
            {value.units === "1" ? "unité" : "unités"}
          </InputGroupText>
        </InputGroupAddon>
      </InputGroup>
    </div>
  )
}
