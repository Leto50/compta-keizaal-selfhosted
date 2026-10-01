import { normalizeCatalogName, normalizeName } from "./text"

export const MAX_RECIPE_FAMILY_LENGTH = 100

export const recipeFamilies = [
  "Alcool",
  "Berserker",
  "Destruction",
  "Fortifiant",
  "Guérisseur",
  "Guerrier",
  "Magie accrue",
  "Mana",
  "Médicinale",
  "Pied léger",
  "Poison",
  "Puissance durable",
  "Récupération",
  "Résistance magique",
  "Sel",
  "Soin",
  "Utilitaire",
  "Vigueur",
  "Vigueur améliorée",
] as const

const recipeFamilyAliases = new Map<string, string>([
  ...recipeFamilies.map((family) => [normalizeName(family), family] as const),
  ["fortifiants", "Fortifiant"],
  ["mana accru", "Magie accrue"],
  ["medicinal", "Médicinale"],
  ["poisons", "Poison"],
  ["resistance magie", "Résistance magique"],
  ["soins", "Soin"],
  ["utilitaires", "Utilitaire"],
  ["vigueur accru", "Vigueur améliorée"],
])

export function isRecipeFamily(value: string): boolean {
  const name = normalizeCatalogName(value)
  const normalizedName = normalizeName(name)
  return (
    name.length > 0 &&
    name.length <= MAX_RECIPE_FAMILY_LENGTH &&
    normalizedName.length > 0 &&
    normalizedName !== "all"
  )
}

export function canonicalRecipeFamily(value: string): string | undefined {
  if (!isRecipeFamily(value)) return undefined
  return (
    recipeFamilyAliases.get(normalizeName(value)) ?? normalizeCatalogName(value)
  )
}

export function getRecipeFamilies(existing: readonly string[]): string[] {
  const families = new Map<string, string>()
  for (const value of [...recipeFamilies, ...existing]) {
    const family = canonicalRecipeFamily(value)
    if (!family) continue
    const key = normalizeName(family)
    if (!families.has(key)) families.set(key, family)
  }
  return [...families.values()].sort((left, right) =>
    left.localeCompare(right, "fr")
  )
}
