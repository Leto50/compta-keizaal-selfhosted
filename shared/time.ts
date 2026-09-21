export const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1_000
export const WEEK_IN_MILLISECONDS = 7 * DAY_IN_MILLISECONDS

export function startOfUtcDay(timestamp: number): number {
  const date = new Date(timestamp)
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

export function startOfUtcWeek(timestamp: number): number {
  const date = new Date(timestamp)
  const dayFromMonday = (date.getUTCDay() + 6) % 7
  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() - dayFromMonday
  )
}
