import { CircleAlert } from "lucide-react"

import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { Button } from "@/components/ui/button"

export function PageError() {
  return (
    <Alert
      className="border-[#8a3e2f]/35 bg-[#8a3e2f]/[0.05] py-3 has-data-[slot=alert-action]:pr-32"
      variant="destructive"
    >
      <CircleAlert aria-hidden="true" />
      <AlertTitle>La page ne répond pas</AlertTitle>
      <AlertDescription>
        Les données n’ont pas pu être chargées. Les informations déjà
        enregistrées ne sont pas modifiées.
      </AlertDescription>
      <AlertAction>
        <Button
          onClick={() => window.location.reload()}
          size="sm"
          type="button"
          variant="outline"
        >
          Relire la page
        </Button>
      </AlertAction>
    </Alert>
  )
}
