import { DAY_IN_MILLISECONDS, WEEK_IN_MILLISECONDS } from "../../shared/time"

const weekDateFormatter = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "UTC",
})

export function formatHarvestWeek(startsAt: number): string {
  return `Du ${weekDateFormatter.format(startsAt)} au ${weekDateFormatter.format(startsAt + WEEK_IN_MILLISECONDS - DAY_IN_MILLISECONDS)}`
}
