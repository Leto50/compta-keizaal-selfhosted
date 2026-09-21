import { convexBetterAuthReactStart } from "@convex-dev/better-auth/react-start"

import { isAuthenticationError } from "@/lib/auth-errors"

// The browser uses the public URLs baked into its bundle. In Docker, the SSR
// server can reach Convex directly over the private Compose network.
const convexUrl =
  process.env.CONVEX_INTERNAL_URL ?? import.meta.env.VITE_CONVEX_URL
const convexSiteUrl =
  process.env.CONVEX_INTERNAL_SITE_URL ?? import.meta.env.VITE_CONVEX_SITE_URL

if (!convexUrl || !convexSiteUrl) {
  throw new Error(
    "VITE_CONVEX_URL et VITE_CONVEX_SITE_URL doivent être configurées."
  )
}

export const { getToken, handler } = convexBetterAuthReactStart({
  convexSiteUrl,
  convexUrl,
  jwtCache: {
    enabled: true,
    expirationToleranceSeconds: 0,
    isAuthError: isAuthenticationError,
  },
})
