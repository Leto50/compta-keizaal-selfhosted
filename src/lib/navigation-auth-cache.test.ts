import { describe, expect, it, vi } from "vitest"

import {
  createNavigationAuthCache,
  primeNavigationAuthCache,
  resolveNavigationAuth,
} from "./navigation-auth-cache"

describe("navigationAuthCache", () => {
  it("ne partage jamais le résultat entre deux requêtes serveur", async () => {
    const cache = createNavigationAuthCache()
    const loadToken = vi
      .fn<() => Promise<null | string>>()
      .mockResolvedValueOnce("premier-token")
      .mockResolvedValueOnce(null)

    await expect(
      resolveNavigationAuth(cache, loadToken, { isClient: false })
    ).resolves.toEqual({ isAuthenticated: true, token: "premier-token" })
    await expect(
      resolveNavigationAuth(cache, loadToken, { isClient: false })
    ).resolves.toEqual({ isAuthenticated: false, token: null })
    expect(loadToken).toHaveBeenCalledTimes(2)
  })

  it("réutilise côté client l’état transmis par le rendu initial", async () => {
    const cache = createNavigationAuthCache()
    const loadToken = vi
      .fn<() => Promise<string>>()
      .mockResolvedValue("inutile")
    primeNavigationAuthCache(cache, {
      isAuthenticated: true,
      token: "token-initial",
    })

    await expect(
      resolveNavigationAuth(cache, loadToken, { isClient: true })
    ).resolves.toEqual({ isAuthenticated: true, token: "token-initial" })
    expect(loadToken).not.toHaveBeenCalled()
  })

  it("ne bloque pas la reprise après une longue période d’inactivité", async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date("2026-09-01T08:00:00Z"))
      const cache = createNavigationAuthCache()
      const loadToken = vi
        .fn<() => Promise<string>>()
        .mockResolvedValue("inutile")
      primeNavigationAuthCache(cache, {
        isAuthenticated: true,
        token: "token-initial",
      })

      vi.setSystemTime(new Date("2026-09-02T08:00:00Z"))
      await expect(
        resolveNavigationAuth(cache, loadToken, { isClient: true })
      ).resolves.toEqual({ isAuthenticated: true, token: "token-initial" })
      expect(loadToken).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it("déduplique deux contrôles clients simultanés", async () => {
    const cache = createNavigationAuthCache()
    let release: ((token: string) => void) | undefined
    const loadToken = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          release = resolve
        })
    )

    const first = resolveNavigationAuth(cache, loadToken, { isClient: true })
    const second = resolveNavigationAuth(cache, loadToken, { isClient: true })
    release?.("nouveau-token")

    await expect(Promise.all([first, second])).resolves.toEqual([
      { isAuthenticated: true, token: "nouveau-token" },
      { isAuthenticated: true, token: "nouveau-token" },
    ])
    expect(loadToken).toHaveBeenCalledOnce()
  })
})
