import { ConvexError } from "convex/values"

function errorCode(error: unknown): string | undefined {
  if (!(error instanceof ConvexError)) return undefined

  const data: unknown = error.data
  if (typeof data !== "object" || data === null || !("code" in data)) {
    return undefined
  }

  return typeof data.code === "string" ? data.code : undefined
}

export function isAuthenticationError(error: unknown): boolean {
  if (errorCode(error) === "UNAUTHENTICATED") return true

  const message = error instanceof Error ? error.message : String(error)
  return /\b(unauthenticated|authentication required|not authenticated)\b/i.test(
    message
  )
}
