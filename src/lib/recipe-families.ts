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

export function isRecipeFamily(value: string): value is RecipeFamily {
  return recipeFamilies.some((family) => family === value)
}
