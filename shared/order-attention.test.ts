import { describe, expect, it } from "vitest"

import {
  orderIsHistorical,
  orderIsOverdue,
  orderNeedsAttention,
  summarizeOrderAttention,
} from "./order-attention"

const NOW = Date.parse("2026-08-26T12:00:00.000Z")

describe("order attention", () => {
  it("conserve les commandes dont le travail logistique ou financier reste à faire", () => {
    expect(
      orderNeedsAttention({
        kind: "client",
        status: "open",
        transactionId: "paid",
      })
    ).toBe(true)
    expect(orderNeedsAttention({ kind: "client", status: "delivered" })).toBe(
      true
    )
    expect(
      orderNeedsAttention({
        kind: "supplier",
        status: "delivered",
        transactionId: "received",
      })
    ).toBe(false)
    expect(orderNeedsAttention({ kind: "client", status: "cancelled" })).toBe(
      false
    )
  })

  it("classe dans l’historique uniquement les commandes terminées ou annulées", () => {
    expect(
      orderIsHistorical({
        kind: "client",
        status: "delivered",
        transactionId: "paid",
      })
    ).toBe(true)
    expect(
      orderIsHistorical({
        kind: "supplier",
        status: "delivered",
        transactionId: "received",
      })
    ).toBe(true)
    expect(
      orderIsHistorical({
        kind: "client",
        status: "ready",
        transactionId: "paid",
      })
    ).toBe(false)
    expect(orderIsHistorical({ kind: "client", status: "delivered" })).toBe(
      false
    )
    expect(orderIsHistorical({ kind: "supplier", status: "cancelled" })).toBe(
      true
    )
  })

  it("ne considère en retard que les commandes à traiter avant aujourd’hui", () => {
    expect(
      orderIsOverdue(
        {
          dueAt: Date.parse("2026-08-25T12:00:00.000Z"),
          kind: "client",
          status: "open",
        },
        NOW
      )
    ).toBe(true)
    expect(
      orderIsOverdue(
        {
          dueAt: Date.parse("2026-08-26T12:00:00.000Z"),
          kind: "client",
          status: "open",
        },
        NOW
      )
    ).toBe(false)
  })

  it("résume les tâches sans compter deux fois une commande", () => {
    expect(
      summarizeOrderAttention(
        [
          { kind: "client", status: "open" },
          { kind: "client", status: "delivered" },
          { kind: "supplier", status: "ready" },
          {
            kind: "supplier",
            status: "delivered",
            transactionId: "received",
          },
        ],
        NOW
      )
    ).toEqual({ client: 2, overdue: 0, supplier: 1, total: 3 })
  })
})
