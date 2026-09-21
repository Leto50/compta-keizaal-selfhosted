export const ACCOUNT_IDENTIFIER_MIN_LENGTH = 3
export const ACCOUNT_IDENTIFIER_MAX_LENGTH = 30

const ACCOUNT_IDENTIFIER_PATTERN = /^[a-z0-9._-]+$/
const INTERNAL_ACCOUNT_DOMAIN = "accounts.eauderoche.invalid"

export function normalizeAccountIdentifier(value: string): string {
  return value.trim().toLowerCase()
}

export function isAccountIdentifier(value: string): boolean {
  const normalized = normalizeAccountIdentifier(value)
  return (
    normalized.length >= ACCOUNT_IDENTIFIER_MIN_LENGTH &&
    normalized.length <= ACCOUNT_IDENTIFIER_MAX_LENGTH &&
    ACCOUNT_IDENTIFIER_PATTERN.test(normalized)
  )
}

export function internalAccountEmail(identifier: string): string {
  return `${normalizeAccountIdentifier(identifier)}@${INTERNAL_ACCOUNT_DOMAIN}`
}
