import { ChevronsUpDown } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { type Doc, type Id } from "../../convex/_generated/dataModel"
import { formatNumber } from "@/lib/format"

export function ProductPicker({
  ariaInvalid = false,
  clearLabel,
  name,
  onBlur,
  onChange,
  placeholder = "Choisir un produit…",
  products,
  selectedProductId,
  showStock = true,
}: Readonly<{
  ariaInvalid?: boolean
  clearLabel?: string
  name?: string
  onBlur?: () => void
  onChange: (productId: Id<"products"> | undefined) => void
  placeholder?: string
  products: readonly Doc<"products">[]
  selectedProductId?: string
  showStock?: boolean
}>) {
  const [open, setOpen] = useState(false)
  const selectedProduct = products.find(
    (product) => product._id === selectedProductId
  )

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <Button
          aria-expanded={open}
          aria-invalid={ariaInvalid}
          className="h-9 min-w-0 flex-1 justify-between bg-background/50 px-3 font-normal"
          name={name}
          onBlur={onBlur}
          role="combobox"
          type="button"
          variant="outline"
        >
          <span className="truncate">
            {selectedProduct?.name ?? placeholder}
          </span>
          <ChevronsUpDown aria-hidden="true" className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] rounded-[0.2rem] border-[#6a5436] bg-[#f4e8cf] p-0"
      >
        <Command className="rounded-[0.2rem] bg-transparent">
          <CommandInput placeholder="Nom du produit…" />
          <CommandList>
            <CommandEmpty>Aucun produit trouvé.</CommandEmpty>
            {clearLabel ? (
              <CommandItem
                data-checked={!selectedProductId}
                onSelect={() => {
                  onChange(undefined)
                  setOpen(false)
                }}
                value={clearLabel}
              >
                {clearLabel}
              </CommandItem>
            ) : null}
            {products.map((product) => (
              <CommandItem
                data-checked={selectedProductId === product._id}
                key={product._id}
                onSelect={() => {
                  onChange(product._id)
                  setOpen(false)
                }}
                value={product.name}
              >
                <span className="min-w-0 flex-1 truncate">{product.name}</span>
                {showStock && product.tracksStock ? (
                  <span className="text-[0.68rem] text-muted-foreground tabular-nums">
                    {formatNumber(product.currentStock)} en stock
                  </span>
                ) : null}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
