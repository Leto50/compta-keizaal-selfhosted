import { convexClient } from "@convex-dev/better-auth/client/plugins"
import { adminClient, usernameClient } from "better-auth/client/plugins"
import { createAuthClient } from "better-auth/react"
import { authRoles } from "../../shared/auth-permissions"

export const authClient = createAuthClient({
  plugins: [
    convexClient(),
    usernameClient(),
    adminClient({ roles: authRoles }),
  ],
})
