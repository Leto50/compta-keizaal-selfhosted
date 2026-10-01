import { afterEach, describe, expect, it, vi } from "vitest"

import { components, internal } from "./_generated/api"
import { createTestBackend } from "./test.helpers"

const password = "mot-de-passe-test-solide"

function accountId(value: unknown): string {
  if (
    typeof value !== "object" ||
    value === null ||
    !("_id" in value) ||
    typeof value._id !== "string"
  ) {
    throw new Error("Compte de test introuvable")
  }
  return value._id
}

afterEach(() => vi.unstubAllEnvs())

async function post(
  backend: ReturnType<typeof createTestBackend>,
  path: string,
  body: Record<string, unknown>,
  cookie?: string
) {
  return backend.fetch(`/api/auth${path}`, {
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost:3000",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    method: "POST",
  })
}

async function signIn(
  backend: ReturnType<typeof createTestBackend>,
  username: string
) {
  const response = await post(backend, "/sign-in/username", {
    password,
    username,
  })
  expect(response.status).toBe(200)
  const cookie = response.headers
    .get("set-cookie")
    ?.match(/(?:^|,\s*)((?:__Secure-)?better-auth\.session_token=[^;]+)/)?.[1]
  if (!cookie) throw new Error("Cookie de session de test introuvable")
  return cookie
}

async function createAdmin() {
  vi.stubEnv("BETTER_AUTH_SECRET", "secret-auth-reserve-aux-tests-integration")
  vi.stubEnv("INITIAL_ADMIN_IDENTIFIER", "admin")
  vi.stubEnv("INITIAL_ADMIN_PASSWORD", password)
  vi.stubEnv("CONVEX_SITE_URL", "http://localhost:3211")
  const backend = createTestBackend()
  await backend.mutation(internal.auth.bootstrapAdmin, { name: "Admin" })
  const cookie = await signIn(backend, "admin")
  return { backend, cookie }
}

describe("rôle lecteur via Better Auth", () => {
  it("crée et connecte un lecteur, puis refuse les endpoints admin et l’élévation de rôle", async () => {
    const { backend, cookie } = await createAdmin()
    const created = await post(
      backend,
      "/admin/create-user",
      {
        data: { username: "lecteur" },
        email: "lecteur@accounts.eauderoche.invalid",
        name: "Lecteur",
        password,
        role: "reader",
      },
      cookie
    )
    expect(created.status).toBe(200)
    const account: unknown = await backend.query(
      components.betterAuth.adapter.findOne,
      {
        model: "user",
        where: [{ field: "username", value: "lecteur" }],
      }
    )
    expect(account).toMatchObject({ role: "reader" })
    const userId = accountId(account)
    const readerCookie = await signIn(backend, "lecteur")
    const list = await backend.fetch("/api/auth/admin/list-users", {
      headers: { Cookie: readerCookie },
    })
    expect(list.status).toBe(403)
    const role = await post(
      backend,
      "/admin/set-role",
      { role: "admin", userId },
      readerCookie
    )
    expect(role.status).toBe(403)
    const update = await post(
      backend,
      "/admin/update-user",
      { data: { role: "admin" }, userId },
      readerCookie
    )
    expect(update.status).toBe(403)
    const create = await post(
      backend,
      "/admin/create-user",
      {
        data: { username: "intrus" },
        email: "intrus@accounts.eauderoche.invalid",
        name: "Intrus",
        password,
        role: "admin",
      },
      readerCookie
    )
    expect(create.status).toBe(403)
    expect(
      await backend.query(components.betterAuth.adapter.findOne, {
        model: "user",
        where: [{ field: "_id", value: userId }],
      })
    ).toMatchObject({ role: "reader" })
  })

  it("permet à l’admin de passer un employé en lecteur et inversement", async () => {
    const { backend, cookie } = await createAdmin()
    const created = await post(
      backend,
      "/admin/create-user",
      {
        data: { username: "employe" },
        email: "employe@accounts.eauderoche.invalid",
        name: "Employé",
        password,
        role: "user",
      },
      cookie
    )
    expect(created.status).toBe(200)
    const account: unknown = await backend.query(
      components.betterAuth.adapter.findOne,
      {
        model: "user",
        where: [{ field: "username", value: "employe" }],
      }
    )
    const userId = accountId(account)
    for (const role of ["reader", "user"]) {
      expect(
        (await post(backend, "/admin/set-role", { role, userId }, cookie))
          .status
      ).toBe(200)
      expect(
        await backend.query(components.betterAuth.adapter.findOne, {
          model: "user",
          where: [{ field: "_id", value: userId }],
        })
      ).toMatchObject({ role })
    }
  })
})
