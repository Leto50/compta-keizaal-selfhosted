import { normalizeName } from "./text"

interface TransactionSearchFields {
  actorName: string
  comment?: string
  counterparty?: string
  productName: string
}

export function buildTransactionSearchText(
  transaction: TransactionSearchFields
): string {
  return normalizeName(
    [
      transaction.productName,
      transaction.actorName,
      transaction.counterparty,
      transaction.comment,
    ]
      .filter(Boolean)
      .join(" ")
  )
}
