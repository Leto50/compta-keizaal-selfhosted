import { priceRatioFromValue } from "./prices"

const numberFormatter = new Intl.NumberFormat("fr-FR", {
  maximumFractionDigits: 2,
})

const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "short",
  year: "numeric",
})

export function formatNumber(value: number): string {
  return numberFormatter.format(value)
}

export function formatQuantity(value: number): string {
  return `${formatNumber(value)} ${Math.abs(value) === 1 ? "unité" : "unités"}`
}

export function formatSeptims(value: number): string {
  const sign = value < 0 ? "−" : ""
  const ratio = priceRatioFromValue(Math.abs(value))
  const whole = Math.floor(ratio.septims / ratio.units)
  const remainder = ratio.septims % ratio.units
  const amount =
    remainder === 0
      ? formatNumber(whole)
      : whole === 0
        ? `${formatNumber(remainder)}/${formatNumber(ratio.units)}`
        : `${formatNumber(whole)} ${formatNumber(remainder)}/${formatNumber(ratio.units)}`

  return `${sign}${amount} sept.`
}

export function formatDecimalSeptims(value: number): string {
  const sign = value < 0 ? "−" : ""
  return `${sign}${formatNumber(Math.abs(value))} sept.`
}

export function formatUnitPrice(value: number): string {
  const ratio = priceRatioFromValue(value)
  const septimLabel = ratio.septims === 1 ? "septim" : "septims"

  return ratio.units === 1
    ? `${formatNumber(ratio.septims)} ${septimLabel} l’unité`
    : `${formatNumber(ratio.septims)} ${septimLabel} pour ${formatNumber(ratio.units)}`
}

export function formatDate(value: number): string {
  return dateFormatter.format(new Date(value))
}

export const categoryLabels = {
  annexe: "Potion",
  ingredient: "Ingrédient",
  potion: "Potion",
  service: "Service",
} as const

export const operationLabels = {
  adjustment: "Ajustement",
  bundle: "Lot",
  exchange: "Échange",
  order: "Commande",
  production: "Production",
  purchase: "Achat",
  sale: "Vente",
  service: "Service",
} as const

export const orderStatusLabels = {
  cancelled: "Annulée",
  delivered: "Livrée",
  open: "À préparer",
  ready: "Prête",
} as const

const supplierOrderStatusLabels = {
  cancelled: "Annulée",
  delivered: "Reçue",
  open: "À recevoir",
  // Legacy supplier orders may still carry the client-only `ready` value.
  ready: "À recevoir",
} as const

export function formatOrderStatus(
  status: keyof typeof orderStatusLabels,
  kind: "client" | "supplier"
): string {
  return kind === "supplier"
    ? supplierOrderStatusLabels[status]
    : orderStatusLabels[status]
}
