import { convexQuery } from "@convex-dev/react-query"
import { useSuspenseQuery } from "@tanstack/react-query"

import { api } from "../../convex/_generated/api"

export function useSiteName() {
  const { data } = useSuspenseQuery(
    convexQuery(api.administration.getSiteName, {})
  )
  return data
}
