import { ConvexError } from "convex/values"

import { authComponent } from "../auth"
import { type MutationCtx, type QueryCtx } from "../_generated/server"
import { canWrite, hasAccountRole } from "../../shared/account-roles"
import { canReadSection, type ReaderSection } from "../../shared/reader-access"
import { readReaderAccess } from "./readerAccess"

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

export async function requireReadAccess(
  ctx: AuthenticatedContext,
  ...sections: ReaderSection[]
) {
  const user = await requireUser(ctx)
  const access = await readReaderAccess(ctx, user)
  if (!sections.some((section) => canReadSection(user.role, access, section))) {
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "Votre accès ne permet pas de consulter ces données.",
    })
  }
  return { user, access }
}
