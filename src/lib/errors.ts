import { ConvexError } from "convex/values"

export function getUserFacingErrorMessage(
  error: unknown,
  fallback: string
): string {
  if (!(error instanceof ConvexError)) return fallback

  const data: unknown = error.data
  if (typeof data === "string" && data.trim()) return data
  if (
    typeof data === "object" &&
    data !== null &&
    "message" in data &&
    typeof data.message === "string" &&
    data.message.trim()
  ) {
    return data.message
  }

  return fallback
}
