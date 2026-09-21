export function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/œ/giu, "oe")
    .replace(/æ/giu, "ae")
    .replace(/[’']/g, " ")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLocaleLowerCase("fr")
}

export function normalizeCatalogName(value: string): string {
  const compactName = value.normalize("NFC").trim().replace(/\s+/gu, " ")
  if (!compactName) return ""

  const lowercaseName = compactName.toLocaleLowerCase("fr")
  const [firstCharacter = "", ...remainingCharacters] = lowercaseName
  return `${firstCharacter.toLocaleUpperCase("fr")}${remainingCharacters.join("")}`
}
