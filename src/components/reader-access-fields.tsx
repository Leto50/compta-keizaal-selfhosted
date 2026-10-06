import { useQuery } from "convex/react"
import { useState } from "react"
import { api } from "../../convex/_generated/api"
import { type Id } from "../../convex/_generated/dataModel"
import {
  readerSections,
  readerSectionLabels,
  readerOperationKinds,
  type ReaderAccess,
} from "../../shared/reader-access"
import { operationLabels } from "@/lib/format"
import { Input } from "./ui/input"

export function readerAccessArgs(access: ReaderAccess) {
  return {
    ...access,
    productIds: access.productIds as Id<"products">[] | undefined,
  }
}

export function ReaderAccessFields({
  value,
  onChange,
  disabled = false,
}: Readonly<{
  value: ReaderAccess
  onChange: (value: ReaderAccess) => void
  disabled?: boolean
}>) {
  const products = useQuery(api.products.list, {})
  const archived = useQuery(api.products.listArchived, {})
  const [search, setSearch] = useState("")
  const options = [...(products ?? []), ...(archived ?? [])].filter((product) =>
    product.name
      .toLocaleLowerCase("fr")
      .includes(search.toLocaleLowerCase("fr"))
  )
  return (
    <fieldset
      className="grid gap-4 rounded border border-border/70 bg-background/30 p-4"
      disabled={disabled}
    >
      <legend className="px-1 font-display">
        Données visibles pour ce lecteur
      </legend>
      <p className="text-xs text-muted-foreground">
        Les éléments non autorisés sont masqués dans les pages, les détails et
        l’accueil.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {readerSections.map((section) => (
          <Check
            key={section}
            checked={value.sections.includes(section)}
            label={readerSectionLabels[section]}
            onChange={(checked) =>
              onChange({
                ...value,
                sections: checked
                  ? [...value.sections, section]
                  : value.sections.filter((entry) => entry !== section),
              })
            }
          />
        ))}
      </div>
      <div className="grid gap-2 border-t border-border/60 pt-3">
        <Check
          checked={value.showPrices}
          label="Voir les prix, coûts et montants"
          onChange={(showPrices) => onChange({ ...value, showPrices })}
        />
        <Check
          checked={value.showStock}
          label="Voir les stocks et les seuils"
          onChange={(showStock) => onChange({ ...value, showStock })}
        />
        {value.showPrices ? (
          <>
            <Check
              checked={value.showPurchasePrices !== false}
              label="Voir les prix d’achat et les coûts de fabrication"
              onChange={(showPurchasePrices) =>
                onChange({ ...value, showPurchasePrices })
              }
            />
            <Check
              checked={value.showSalePrices !== false}
              label="Voir les prix de vente"
              onChange={(showSalePrices) =>
                onChange({ ...value, showSalePrices })
              }
            />
            <p className="text-xs text-muted-foreground">
              Masquer un type de prix masque aussi les montants des opérations
              et les totaux financiers.
            </p>
          </>
        ) : null}
      </div>
      <div className="grid gap-2 border-t border-border/60 pt-3">
        <p className="text-sm font-semibold">Produits visibles</p>
        <Check
          checked={value.productIds === undefined}
          label="Tous les produits, y compris les futurs produits"
          onChange={(checked) =>
            onChange({ ...value, productIds: checked ? undefined : [] })
          }
        />
        {value.productIds !== undefined ? (
          <>
            <Input
              aria-label="Rechercher un produit à autoriser"
              placeholder="Rechercher un produit…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <div
              className="grid max-h-48 gap-2 overflow-y-auto pr-2"
              aria-label="Sélection des produits"
            >
              {options.map((product) => (
                <Check
                  key={product._id}
                  checked={value.productIds!.includes(product._id)}
                  label={`${product.name}${product.active ? "" : " (archivé)"}`}
                  onChange={(checked) =>
                    onChange({
                      ...value,
                      productIds: checked
                        ? [...value.productIds!, product._id]
                        : value.productIds!.filter((id) => id !== product._id),
                    })
                  }
                />
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {value.productIds.length} produit(s) autorisé(s). Une recette, un
              lot ou une opération contenant un autre produit est entièrement
              masqué.
            </p>
          </>
        ) : null}
      </div>
      <div className="grid gap-2 border-t border-border/60 pt-3">
        <p className="text-sm font-semibold">Types d’opérations visibles</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {readerOperationKinds.map((kind) => (
            <Check
              key={kind}
              checked={value.operationKinds.includes(kind)}
              label={operationLabels[kind]}
              onChange={(checked) =>
                onChange({
                  ...value,
                  operationKinds: checked
                    ? [...value.operationKinds, kind]
                    : value.operationKinds.filter((entry) => entry !== kind),
                })
              }
            />
          ))}
        </div>
      </div>
    </fieldset>
  )
}

function Check({
  checked,
  label,
  onChange,
}: Readonly<{
  checked: boolean
  label: string
  onChange: (checked: boolean) => void
}>) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-sm leading-5">
      <input
        className="mt-0.5 size-4 shrink-0 accent-primary"
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
    </label>
  )
}
