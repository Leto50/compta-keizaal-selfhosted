import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery } from "convex/react"
import { Check, Pencil, Plus, Tags, Trash2, X } from "lucide-react"
import { useState } from "react"
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
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { usePermissions } from "@/hooks/use-permissions"
import { getUserFacingErrorMessage } from "@/lib/errors"
import { recipeCategoryFormSchema } from "@/lib/form-schemas"
import { MAX_RECIPE_FAMILY_LENGTH } from "@/lib/recipe-families"
import { api } from "../../convex/_generated/api"

export function RecipeCategoryManagerDialog({
  onCategoryChange,
}: Readonly<{
  onCategoryChange?: (previousName: string, nextName?: string) => void
}>) {
  const { canWrite } = usePermissions()
  const [open, setOpen] = useState(false)
  const categories = useQuery(
    api.recipes.listCategories,
    open && canWrite ? {} : "skip"
  )
  const createCategory = useMutation(api.recipes.createCategory)
  const renameCategory = useMutation(api.recipes.renameCategory)
  const removeCategory = useMutation(api.recipes.removeCategory)
  const [editingName, setEditingName] = useState<string>()
  const [pending, setPending] = useState(false)
  const createForm = useForm({
    defaultValues: { name: "" },
    validators: { onSubmit: recipeCategoryFormSchema },
    onSubmit: async ({ value }) => {
      setPending(true)
      try {
        await createCategory({ name: value.name })
        createForm.reset()
        toast.success(
          "Catégorie créée. Elle reste disponible même sans recette."
        )
      } catch (error) {
        toast.error(
          getUserFacingErrorMessage(error, "Impossible de créer la catégorie.")
        )
      } finally {
        setPending(false)
      }
    },
  })
  const renameForm = useForm({
    defaultValues: { name: "" },
    validators: { onSubmit: recipeCategoryFormSchema },
    onSubmit: async ({ value }) => {
      if (!editingName) return
      setPending(true)
      try {
        const name = await renameCategory({
          family: editingName,
          name: value.name,
        })
        onCategoryChange?.(editingName, name)
        setEditingName(undefined)
        toast.success("Catégorie renommée dans toutes les recettes.")
      } catch (error) {
        toast.error(
          getUserFacingErrorMessage(
            error,
            "Impossible de renommer la catégorie."
          )
        )
      } finally {
        setPending(false)
      }
    },
  })

  async function remove(name: string) {
    setPending(true)
    try {
      await removeCategory({ family: name })
      onCategoryChange?.(name)
      toast.success("Catégorie supprimée.")
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(
          error,
          "Impossible de supprimer la catégorie."
        )
      )
    } finally {
      setPending(false)
    }
  }

  if (!canWrite) return null
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (nextOpen) {
          createForm.reset()
          setEditingName(undefined)
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <Tags aria-hidden="true" />
          Catégories
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[94svh] overflow-y-auto rounded-[0.2rem] border-[#6a5436] bg-[#eee1c7] ring-0 sm:max-w-2xl">
        <DialogHeader className="pr-8">
          <p className="text-[0.66rem] font-bold tracking-[0.2em] text-primary uppercase">
            Registre de fabrication
          </p>
          <DialogTitle className="font-display text-2xl">
            Gérer les catégories
          </DialogTitle>
          <DialogDescription>
            Les catégories restent disponibles même sans recette. Renommer une
            catégorie met à jour les recettes actives et archivées.
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex items-end gap-2"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            void createForm.handleSubmit()
          }}
        >
          <createForm.Field name="name">
            {(field) => {
              const invalid =
                field.state.meta.isTouched && !field.state.meta.isValid
              return (
                <Field className="min-w-0 flex-1" data-invalid={invalid}>
                  <FieldLabel htmlFor="new-recipe-category">
                    Nouvelle catégorie
                  </FieldLabel>
                  <Input
                    id="new-recipe-category"
                    aria-invalid={invalid}
                    autoComplete="off"
                    maxLength={MAX_RECIPE_FAMILY_LENGTH}
                    name="category-name"
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder="Régénération, Force…"
                    value={field.state.value}
                  />
                  {invalid ? (
                    <FieldError errors={field.state.meta.errors} />
                  ) : null}
                </Field>
              )
            }}
          </createForm.Field>
          <Button disabled={pending || categories === undefined} type="submit">
            <Plus aria-hidden="true" />
            Créer
          </Button>
        </form>

        <div className="max-h-[55svh] overflow-y-auto">
          {categories === undefined ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Chargement des catégories…
            </p>
          ) : categories.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Aucune catégorie. Créez-en une pour classer vos recettes.
            </p>
          ) : (
            categories.map((category) => (
              <div
                className="flex min-w-0 items-center gap-2 border-b border-border/60 py-3 last:border-b-0"
                key={category.name}
              >
                {editingName === category.name ? (
                  <form
                    className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto_auto] items-start gap-2"
                    noValidate
                    onSubmit={(event) => {
                      event.preventDefault()
                      void renameForm.handleSubmit()
                    }}
                  >
                    <renameForm.Field name="name">
                      {(field) => {
                        const invalid =
                          field.state.meta.isTouched &&
                          !field.state.meta.isValid
                        return (
                          <Field data-invalid={invalid}>
                            <Input
                              aria-label={`Nouveau nom de ${category.name}`}
                              aria-invalid={invalid}
                              autoComplete="off"
                              autoFocus
                              maxLength={MAX_RECIPE_FAMILY_LENGTH}
                              name="category-rename"
                              onBlur={field.handleBlur}
                              onChange={(event) =>
                                field.handleChange(event.target.value)
                              }
                              value={field.state.value}
                            />
                            {invalid ? (
                              <FieldError errors={field.state.meta.errors} />
                            ) : null}
                          </Field>
                        )
                      }}
                    </renameForm.Field>
                    <Button
                      aria-label="Enregistrer le nom"
                      disabled={pending}
                      size="icon"
                      type="submit"
                    >
                      <Check aria-hidden="true" />
                    </Button>
                    <Button
                      aria-label="Annuler le renommage"
                      disabled={pending}
                      onClick={() => setEditingName(undefined)}
                      size="icon"
                      type="button"
                      variant="ghost"
                    >
                      <X aria-hidden="true" />
                    </Button>
                  </form>
                ) : (
                  <>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium" title={category.name}>
                        {category.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {category.recipeCount === 0
                          ? "Aucune recette"
                          : `${category.recipeCount} ${category.recipeCount === 1 ? "recette" : "recettes"}`}
                        {category.archivedRecipeCount > 0
                          ? ` · ${category.archivedRecipeCount} ${category.archivedRecipeCount === 1 ? "archivée" : "archivées"}`
                          : ""}
                      </p>
                    </div>
                    <Button
                      aria-label={`Renommer ${category.name}`}
                      disabled={pending}
                      onClick={() => {
                        setEditingName(category.name)
                        renameForm.reset({ name: category.name })
                      }}
                      size="icon"
                      type="button"
                      variant="ghost"
                    >
                      <Pencil aria-hidden="true" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          aria-label={`Supprimer ${category.name}`}
                          disabled={pending || category.recipeCount > 0}
                          size="icon"
                          type="button"
                          variant="ghost"
                          title={
                            category.recipeCount > 0
                              ? "Réaffectez les recettes, y compris archivées, avant de supprimer cette catégorie."
                              : undefined
                          }
                        >
                          <Trash2 aria-hidden="true" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent className="rounded-[0.2rem] border-[#6a5436] bg-[#eee1c7]">
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            Supprimer « {category.name} » ?
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            Cette catégorie sans recette ne sera plus proposée.
                            Vous pourrez en créer une nouvelle si nécessaire.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Conserver</AlertDialogCancel>
                          <AlertDialogAction
                            disabled={pending}
                            onClick={() => {
                              void remove(category.name)
                            }}
                          >
                            Supprimer la catégorie
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </>
                )}
              </div>
            ))
          )}
        </div>
        {pending ? (
          <p
            className="flex items-center gap-2 text-sm text-muted-foreground"
            role="status"
          >
            <Spinner aria-hidden="true" />
            Enregistrement…
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
