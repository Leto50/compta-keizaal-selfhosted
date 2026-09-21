import { normalizeName } from "../../shared/text"

interface SearchableRecipe {
  effect?: string
  ingredients: readonly { ingredientName: string }[]
  name: string
}

interface SearchableBundle {
  items: readonly { productName: string }[]
  name: string
}

export function normalizeCatalogSearch(value: string): string {
  return normalizeName(value)
}

function catalogTextMatches(text: string, search: string): boolean {
  const tokenize = (value: string) =>
    normalizeCatalogSearch(value).split(" ").filter(Boolean)
  const queryTokens = tokenize(search)
  if (queryTokens.length === 0) return true
  const textTokens = tokenize(text)
  return queryTokens.every((queryToken) =>
    textTokens.some((textToken) => textToken.startsWith(queryToken))
  )
}

export function recipeMatchesSearch(
  recipe: SearchableRecipe,
  search: string
): boolean {
  return catalogTextMatches(
    [
      recipe.name,
      recipe.effect ?? "",
      ...recipe.ingredients.map((ingredient) => ingredient.ingredientName),
    ].join(" "),
    search
  )
}

export function bundleMatchesSearch(
  bundle: SearchableBundle,
  search: string
): boolean {
  return catalogTextMatches(
    [bundle.name, ...bundle.items.map((item) => item.productName)].join(" "),
    search
  )
}
