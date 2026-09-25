import {
  ConvexBetterAuthProvider,
  type AuthClient,
} from "@convex-dev/better-auth/react"
import { type ConvexQueryClient } from "@convex-dev/react-query"
import { type QueryClient } from "@tanstack/react-query"
import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  Scripts,
  useRouteContext,
} from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { type ReactNode } from "react"

import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { authClient } from "@/lib/auth-client"
import { getToken } from "@/lib/auth-server"
import {
  type NavigationAuthCache,
  primeNavigationAuthCache,
  resolveNavigationAuth,
} from "@/lib/navigation-auth-cache"
import appCss from "@/styles.css?url"

const getAuthToken = createServerFn({ method: "GET" }).handler(async () =>
  getToken()
)

export interface RouterContext {
  convexQueryClient: ConvexQueryClient
  navigationAuth: NavigationAuthCache
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<RouterContext>()({
  beforeLoad: async ({ context }) => {
    const auth = await resolveNavigationAuth(
      context.navigationAuth,
      getAuthToken,
      { isClient: typeof document !== "undefined" }
    )
    if (auth.token) {
      context.convexQueryClient.serverHttpClient?.setAuth(auth.token)
    }
    return auth
  },
  component: RootComponent,
  head: () => ({
    links: [
      { href: appCss, rel: "stylesheet" },
      { href: "/favicon.ico", rel: "icon" },
    ],
    meta: [
      { charSet: "utf-8" },
      {
        content: "width=device-width, initial-scale=1, viewport-fit=cover",
        name: "viewport",
      },
      {
        content:
          "L’application de gestion de L’eau d’Roche : inventaire, opérations, commandes et recettes.",
        name: "description",
      },
      { title: "L’eau d’Roche" },
      { content: "#1c1a15", name: "theme-color" },
    ],
  }),
  notFoundComponent: () => (
    <main className="grid min-h-svh place-items-center bg-[#171510] p-6 text-[#eadfca]">
      <div className="max-w-md text-center">
        <p className="font-display text-6xl text-[#7895a8]">404</p>
        <h1 className="mt-3 font-display text-2xl">Page introuvable</h1>
        <p className="mt-2 text-[#bdb09a]">
          Cette adresse ne correspond à aucune page de l’application.
        </p>
      </div>
    </main>
  ),
})

function RootComponent() {
  const context = useRouteContext({ from: Route.id })
  primeNavigationAuthCache(context.navigationAuth, {
    isAuthenticated: context.isAuthenticated,
    token: context.token,
  })

  return (
    <ConvexBetterAuthProvider
      // Better Auth 1.6.x keeps the runtime contract but narrows plugin
      // inference for clients extended with adminClient.
      authClient={authClient as unknown as AuthClient}
      client={context.convexQueryClient.convexClient}
      initialToken={context.token}
    >
      <RootDocument>
        <Outlet />
      </RootDocument>
    </ConvexBetterAuthProvider>
  )
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="fr">
      <head>
        <HeadContent />
      </head>
      <body className="min-w-80 bg-background text-foreground antialiased selection:bg-primary selection:text-primary-foreground">
        <TooltipProvider>{children}</TooltipProvider>
        <Toaster theme="light" />
        <Scripts />
      </body>
    </html>
  )
}
