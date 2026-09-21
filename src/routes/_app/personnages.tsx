import { convexQuery } from "@convex-dev/react-query"
import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { Pencil, UserRound } from "lucide-react"

import {
  CharacterArchivesDialog,
  CharacterDialog,
} from "@/components/character-dialog"
import { PageError } from "@/components/page-error"
import { PageHeader } from "@/components/page-header"
import { PageSkeleton } from "@/components/page-skeleton"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardHeader, CardTitle } from "@/components/ui/card"
import { api } from "../../../convex/_generated/api"

export const Route = createFileRoute("/_app/personnages")({
  component: CharactersPage,
  errorComponent: PageError,
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(
      convexQuery(api.characters.listForAdmin, {})
    )
  },
  pendingComponent: PageSkeleton,
})

function CharactersPage() {
  const { data: characters } = useSuspenseQuery(
    convexQuery(api.characters.listForAdmin, {})
  )

  return (
    <div className="animate-in duration-300 fade-in slide-in-from-bottom-1 motion-reduce:animate-none">
      <PageHeader
        action={
          <div className="flex items-center gap-2">
            <CharacterArchivesDialog />
            <CharacterDialog />
          </div>
        }
        eyebrow="Administration"
        title="Personnages"
      >
        Les identités de jeu proposées lors des ventes, achats et productions.
      </PageHeader>

      {characters.length > 0 ? (
        <div className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {characters.map((character) => (
            <Card
              className="rounded-none border-[#5b462b]/30 bg-[#fff8e7]/30 ring-0"
              key={character._id}
            >
              <CardHeader>
                <div className="flex items-center gap-3">
                  <UserRound
                    aria-hidden="true"
                    className="size-5 text-primary"
                  />
                  <CardTitle className="font-display text-lg font-medium">
                    {character.name}
                  </CardTitle>
                </div>
                <CardAction>
                  <CharacterDialog
                    character={character}
                    trigger={
                      <Button
                        aria-label={`Modifier ${character.name}`}
                        size="icon"
                        variant="ghost"
                      >
                        <Pencil aria-hidden="true" />
                      </Button>
                    }
                  />
                </CardAction>
              </CardHeader>
            </Card>
          ))}
        </div>
      ) : (
        <Alert className="mt-7 border-primary/20 bg-primary/[0.04]">
          <UserRound aria-hidden="true" />
          <AlertTitle>Aucun personnage actif</AlertTitle>
          <AlertDescription>
            Créez le premier personnage proposé lors des opérations.
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}
