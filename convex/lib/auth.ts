import { ConvexError } from "convex/values"

import { authComponent } from "../auth"
import { type MutationCtx, type QueryCtx } from "../_generated/server"

type AuthenticatedContext = MutationCtx | QueryCtx

export async function requireUser(ctx: AuthenticatedContext) {
  const user = await authComponent.safeGetAuthUser(ctx)
  if (!user) {
    throw new ConvexError({
      code: "UNAUTHENTICATED",
      message: "Vous devez être connecté pour accéder à ces données.",
    })
  }
  return user
}

export async function requireAdmin(ctx: AuthenticatedContext) {
  const user = await requireUser(ctx)
  const roles = typeof user.role === "string" ? user.role.split(",") : []
  if (!roles.includes("admin")) {
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "Cette action est réservée aux administrateurs.",
    })
  }
  return user
}
