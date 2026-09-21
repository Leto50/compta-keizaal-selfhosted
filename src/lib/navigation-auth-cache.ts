export interface NavigationAuthSnapshot {
  isAuthenticated: boolean
  token: null | string
}

export interface NavigationAuthCache {
  pending: Promise<NavigationAuthSnapshot> | undefined
  snapshot: NavigationAuthSnapshot | undefined
}

export function createNavigationAuthCache(): NavigationAuthCache {
  return {
    pending: undefined,
    snapshot: undefined,
  }
}

function snapshotFromToken(
  token: null | string | undefined
): NavigationAuthSnapshot {
  const normalizedToken = token ?? null
  return { isAuthenticated: Boolean(normalizedToken), token: normalizedToken }
}

export function primeNavigationAuthCache(
  cache: NavigationAuthCache,
  snapshot: NavigationAuthSnapshot
) {
  if (cache.snapshot) return

  cache.snapshot = snapshot
}

export async function resolveNavigationAuth(
  cache: NavigationAuthCache,
  loadToken: () => Promise<null | string | undefined>,
  options: {
    isClient: boolean
  }
): Promise<NavigationAuthSnapshot> {
  // Server routers are request-scoped: always read the current request cookies.
  if (!options.isClient) return snapshotFromToken(await loadToken())

  // ConvexBetterAuthProvider owns token refreshes for the lifetime of the tab.
  // Rechecking through Netlify here would reintroduce a cold start after idle.
  if (cache.snapshot) return cache.snapshot

  if (cache.pending) return cache.pending

  const pending = loadToken().then(snapshotFromToken)
  cache.pending = pending

  try {
    const snapshot = await pending
    cache.snapshot = snapshot
    return snapshot
  } finally {
    if (cache.pending === pending) cache.pending = undefined
  }
}
