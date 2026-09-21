import { v } from "convex/values"

import { normalizeName } from "./text"

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

export type RecipeFamily = (typeof recipeFamilies)[number]

export const recipeFamily = v.union(
  v.literal("Alcool"),
  v.literal("Berserker"),
  v.literal("Destruction"),
  v.literal("Fortifiant"),
  v.literal("Guérisseur"),
  v.literal("Guerrier"),
  v.literal("Magie accrue"),
  v.literal("Mana"),
  v.literal("Médicinale"),
  v.literal("Pied léger"),
  v.literal("Poison"),
  v.literal("Puissance durable"),
  v.literal("Récupération"),
  v.literal("Résistance magique"),
  v.literal("Sel"),
  v.literal("Soin"),
  v.literal("Utilitaire"),
  v.literal("Vigueur"),
  v.literal("Vigueur améliorée")
)

const recipeFamilyAliases = new Map<string, RecipeFamily>([
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

export function canonicalRecipeFamily(value: string): RecipeFamily | undefined {
  return recipeFamilyAliases.get(normalizeName(value))
}
