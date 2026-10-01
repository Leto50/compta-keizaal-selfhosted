import { ConvexError } from "convex/values"

import { authComponent } from "../auth"
import { type MutationCtx, type QueryCtx } from "../_generated/server"
import { canWrite, hasAccountRole } from "../../shared/account-roles"

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
  if (!hasAccountRole(user.role, "admin")) {
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "Cette action est réservée aux administrateurs.",
    })
  }
  return user
}

export async function requireWriter(ctx: MutationCtx) {
  const user = await requireUser(ctx)
  if (!canWrite(user.role)) {
    throw new ConvexError({
      code: "FORBIDDEN",
      message:
        "Votre accès est en lecture seule. Vous ne pouvez pas modifier les données.",
    })
  }
  return user
}
