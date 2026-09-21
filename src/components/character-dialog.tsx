import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery } from "convex/react"
import { Archive, ArchiveRestore, Pencil, UserRoundPlus } from "lucide-react"
import { useId, useState, type ReactElement } from "react"
import { toast } from "sonner"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Spinner } from "@/components/ui/spinner"
import { getUserFacingErrorMessage } from "@/lib/errors"
import { namedEntityFormSchema } from "@/lib/form-schemas"
import { api } from "../../convex/_generated/api"
import { type Doc } from "../../convex/_generated/dataModel"

export function CharacterDialog({
  character,
  trigger,
}: Readonly<{
  character?: Doc<"characters">
  trigger?: ReactElement
}>) {
  const saveCharacter = useMutation(api.characters.save)
  const setCharacterActive = useMutation(api.characters.setActive)
  const fieldId = useId()
  const [open, setOpen] = useState(false)
  const [isArchiving, setIsArchiving] = useState(false)
  const form = useForm({
    defaultValues: { name: character?.name ?? "" },
    onSubmit: async ({ value }) => {
      try {
        await saveCharacter({
          ...(character ? { characterId: character._id } : {}),
          name: value.name.trim(),
        })
        toast.success(character ? "Personnage mis à jour." : "Personnage créé.")
        setOpen(false)
      } catch (error) {
        toast.error(
          getUserFacingErrorMessage(
            error,
            "Impossible d’enregistrer le personnage."
          )
        )
      }
    },
    validators: { onSubmit: namedEntityFormSchema },
  })

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen && !open) form.reset({ name: character?.name ?? "" })
    setOpen(nextOpen)
  }

  async function archiveCharacter() {
    if (!character) return
    setIsArchiving(true)
    try {
      await setCharacterActive({
        active: false,
        characterId: character._id,
      })
      toast.success("Personnage archivé.")
      setOpen(false)
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Impossible d’archiver le personnage.")
      )
    } finally {
      setIsArchiving(false)
    }
  }

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <UserRoundPlus aria-hidden="true" />
            Nouveau personnage
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="rounded-[0.2rem] border-[#6a5436] bg-[#eee1c7] ring-0 sm:max-w-md">
        <DialogHeader className="pr-8">
          <p className="text-[0.66rem] font-bold tracking-[0.2em] text-primary uppercase">
            Personnages de la boutique
          </p>
          <DialogTitle className="font-display text-2xl">
            {character ? "Modifier le personnage" : "Créer un personnage"}
          </DialogTitle>
          <DialogDescription>
            Les employés choisissent ce nom lorsqu’ils enregistrent une
            opération de jeu.
          </DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-5"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            void form.handleSubmit()
          }}
        >
          <form.Field name="name">
            {(field) => {
              const invalid =
                field.state.meta.isTouched && !field.state.meta.isValid
              return (
                <Field data-invalid={invalid}>
                  <FieldLabel htmlFor={`${fieldId}-name`}>
                    Nom du personnage
                  </FieldLabel>
                  <Input
                    aria-invalid={invalid}
                    autoComplete="off"
                    id={`${fieldId}-name`}
                    maxLength={100}
                    name="character-name"
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder="Nom utilisé en jeu"
                    required
                    value={field.state.value}
                  />
                  {invalid ? (
                    <FieldError errors={field.state.meta.errors} />
                  ) : null}
                </Field>
              )
            }}
          </form.Field>

          <DialogFooter className="gap-2 sm:justify-between">
            <div>
              {character ? (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button type="button" variant="ghost">
                      <Archive aria-hidden="true" />
                      Archiver
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent className="rounded-[0.2rem] border-[#6a5436] bg-[#eee1c7]">
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        Archiver « {character.name} » ?
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        Ce personnage ne sera plus proposé dans les nouvelles
                        opérations. Son nom restera dans l’historique.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Conserver</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => {
                          void archiveCharacter()
                        }}
                      >
                        Archiver le personnage
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              ) : null}
            </div>
            <div className="flex justify-end gap-2">
              <Button
                onClick={() => setOpen(false)}
                type="button"
                variant="ghost"
              >
                Annuler
              </Button>
              <form.Subscribe selector={(state) => state.isSubmitting}>
                {(isSubmitting) => (
                  <Button disabled={isSubmitting || isArchiving} type="submit">
                    {isSubmitting ? (
                      <Spinner
                        aria-hidden="true"
                        className="motion-reduce:animate-none"
                      />
                    ) : character ? (
                      <Pencil aria-hidden="true" />
                    ) : (
                      <UserRoundPlus aria-hidden="true" />
                    )}
                    {character ? "Enregistrer" : "Créer le personnage"}
                  </Button>
                )}
              </form.Subscribe>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function CharacterArchivesDialog() {
  const archivedCharacters = useQuery(api.characters.listArchived)
  const setCharacterActive = useMutation(api.characters.setActive)
  const [restoringId, setRestoringId] = useState<string>()

  async function restoreCharacter(character: Doc<"characters">) {
    setRestoringId(character._id)
    try {
      await setCharacterActive({
        active: true,
        characterId: character._id,
      })
      toast.success(`« ${character.name} » est de nouveau disponible.`)
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(
          error,
          "Impossible de réactiver le personnage."
        )
      )
    } finally {
      setRestoringId(undefined)
    }
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">
          <ArchiveRestore aria-hidden="true" />
          Archives
        </Button>
      </DialogTrigger>
      <DialogContent className="rounded-[0.2rem] border-[#6a5436] bg-[#eee1c7] ring-0 sm:max-w-md">
        <DialogHeader className="pr-8">
          <p className="text-[0.66rem] font-bold tracking-[0.2em] text-primary uppercase">
            Personnages de la boutique
          </p>
          <DialogTitle className="font-display text-2xl">
            Personnages archivés
          </DialogTitle>
          <DialogDescription>
            Réactivez un personnage pour le proposer à nouveau lors des
            opérations.
          </DialogDescription>
        </DialogHeader>

        {archivedCharacters === undefined ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Chargement des archives…
          </p>
        ) : archivedCharacters.length === 0 ? (
          <Alert className="border-primary/20 bg-primary/[0.04]">
            <ArchiveRestore aria-hidden="true" />
            <AlertTitle>Aucun personnage archivé</AlertTitle>
            <AlertDescription>
              Les personnages retirés apparaîtront ici.
            </AlertDescription>
          </Alert>
        ) : (
          <ScrollArea className="max-h-80 pr-3">
            <div className="grid divide-y divide-border/70">
              {archivedCharacters.map((character) => (
                <div
                  className="flex items-center justify-between gap-3 py-3"
                  key={character._id}
                >
                  <p className="truncate text-sm font-semibold">
                    {character.name}
                  </p>
                  <Button
                    disabled={restoringId !== undefined}
                    onClick={() => {
                      void restoreCharacter(character)
                    }}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {restoringId === character._id ? (
                      <Spinner
                        aria-hidden="true"
                        className="motion-reduce:animate-none"
                      />
                    ) : (
                      <ArchiveRestore aria-hidden="true" />
                    )}
                    Réactiver
                  </Button>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  )
}
