import { useForm, useStore } from "@tanstack/react-form"
import { useMutation, useQuery } from "convex/react"
import { type FunctionReturnType } from "convex/server"
import {
  Archive,
  ArchiveRestore,
  BookPlus,
  Calculator,
  CircleAlert,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react"
import { useId, useMemo, useRef, useState, type ReactElement } from "react"
import { toast } from "sonner"

import { ProductPicker } from "@/components/product-picker"
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
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { api } from "../../convex/_generated/api"
import { type Doc, type Id } from "../../convex/_generated/dataModel"
import { getUserFacingErrorMessage } from "@/lib/errors"
import { MAX_DYNAMIC_LINES, recipeFormSchema } from "@/lib/form-schemas"
import { formatDecimalSeptims } from "@/lib/format"
import { isProductCraftable } from "@/lib/product-categories"
import {
  isRecipeFamily,
  recipeFamilies,
  type RecipeFamily,
} from "@/lib/recipe-families"

type Recipe = FunctionReturnType<typeof api.recipes.list>[number]

interface IngredientDraft {
  key: number
  productId: string
  quantity: string
}

export function RecipeDialog({
  initialProduct,
  linkedProductIds = [],
  onOpenChange,
  open: controlledOpen,
  products,
  recipe,
  trigger,
}: Readonly<{
  initialProduct?: Doc<"products">
  linkedProductIds?: readonly Id<"products">[]
  onOpenChange?: (open: boolean) => void
  open?: boolean
  products: readonly Doc<"products">[]
  recipe?: Recipe
  trigger?: ReactElement | null
}>) {
  const saveRecipe = useMutation(api.recipes.save)
  const setRecipeActive = useMutation(api.recipes.setActive)
  const fieldId = useId()
  const nextLineKey = useRef(1)
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const [isArchiving, setIsArchiving] = useState(false)
  const ingredientProducts = useMemo(
    () => products.filter((product) => product.tracksStock),
    [products]
  )
  const linkedProducts = useMemo(
    () => new Set(linkedProductIds),
    [linkedProductIds]
  )
  const outputProducts = useMemo(
    () =>
      products.filter(
        (product) =>
          isProductCraftable(product, linkedProducts.has(product._id)) &&
          (!linkedProducts.has(product._id) ||
            recipe?.productId === product._id ||
            initialProduct?._id === product._id)
      ),
    [initialProduct, linkedProducts, products, recipe]
  )
  const showOutputProductSelect =
    !recipe && (initialProduct !== undefined || outputProducts.length > 0)

  function recipeValues() {
    return {
      effect: recipe?.effect ?? "",
      family:
        recipe && isRecipeFamily(recipe.family)
          ? recipe.family
          : ("" as RecipeFamily | ""),
      ingredients: recipe?.ingredients.length
        ? recipe.ingredients.map((ingredient, index) => ({
            key: index,
            productId: ingredient.productId ?? "",
            quantity: ingredient.quantity.toString(),
          }))
        : [{ key: 0, productId: "", quantity: "1" }],
      name: recipe?.name ?? initialProduct?.name ?? "",
      outputProductId: recipe?.productId ?? initialProduct?._id ?? "new",
    }
  }

  const form = useForm({
    defaultValues: recipeValues(),
    validators: { onSubmit: recipeFormSchema },
    onSubmit: async ({ value }) => {
      if (!isRecipeFamily(value.family)) return
      const selectedOutputProduct = outputProducts.find(
        (product) => product._id === value.outputProductId
      )
      try {
        await saveRecipe({
          effect: value.effect.trim(),
          family: value.family,
          ingredients: value.ingredients.map((ingredient) => ({
            productId: ingredient.productId as Id<"products">,
            quantity: Number(ingredient.quantity),
          })),
          name: selectedOutputProduct?.name ?? value.name.trim(),
          ...(!recipe && selectedOutputProduct
            ? { outputProductId: selectedOutputProduct._id }
            : {}),
          ...(recipe ? { recipeId: recipe._id } : {}),
        })
        toast.success(recipe ? "Recette mise à jour." : "Recette créée.")
        handleOpenChange(false)
      } catch (error) {
        toast.error(
          getUserFacingErrorMessage(
            error,
            "Impossible d’enregistrer la recette."
          )
        )
      }
    },
  })
  const formValues = useStore(form.store, (state) => state.values)
  const costCalculation = useMemo(() => {
    const missingPrices = new Set<string>()
    let complete = formValues.ingredients.length > 0
    let value = 0

    for (const ingredient of formValues.ingredients) {
      const product = ingredientProducts.find(
        (entry) => entry._id === ingredient.productId
      )
      const quantity = Number(ingredient.quantity)
      if (
        !product ||
        !Number.isFinite(quantity) ||
        !Number.isInteger(quantity) ||
        quantity <= 0
      ) {
        complete = false
        continue
      }
      if (product.purchasePrice === undefined) {
        missingPrices.add(product.name)
        continue
      }
      value += product.purchasePrice * quantity
    }

    return {
      cost:
        complete &&
        missingPrices.size === 0 &&
        formValues.ingredients.length > 0
          ? value
          : undefined,
      missingPrices: [...missingPrices].sort((left, right) =>
        left.localeCompare(right, "fr")
      ),
    }
  }, [formValues.ingredients, ingredientProducts])

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen && !open) {
      form.reset(recipeValues())
      nextLineKey.current = Math.max(1, recipe?.ingredients.length ?? 0)
    }
    if (controlledOpen === undefined) setInternalOpen(nextOpen)
    onOpenChange?.(nextOpen)
  }

  function updateIngredient(key: number, patch: Partial<IngredientDraft>) {
    form.setFieldValue("ingredients", (current) =>
      current.map((ingredient) =>
        ingredient.key === key ? { ...ingredient, ...patch } : ingredient
      )
    )
  }

  function addIngredient() {
    const key = nextLineKey.current
    nextLineKey.current += 1
    form.setFieldValue("ingredients", (current) => [
      ...current,
      { key, productId: "", quantity: "1" },
    ])
  }

  function removeIngredient(key: number) {
    form.setFieldValue("ingredients", (current) =>
      current.filter((ingredient) => ingredient.key !== key)
    )
  }

  async function archiveRecipe() {
    if (!recipe) return
    setIsArchiving(true)
    try {
      await setRecipeActive({ active: false, recipeId: recipe._id })
      toast.success("Recette archivée.")
      handleOpenChange(false)
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Impossible d’archiver la recette.")
      )
    } finally {
      setIsArchiving(false)
    }
  }

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      {trigger === null ? null : (
        <DialogTrigger asChild>
          {trigger ?? (
            <Button>
              <BookPlus aria-hidden="true" />
              Nouvelle recette
            </Button>
          )}
        </DialogTrigger>
      )}
      <DialogContent className="max-h-[94svh] overflow-y-auto rounded-[0.2rem] border-[#6a5436] bg-[#eee1c7] ring-0 sm:max-w-2xl">
        <DialogHeader className="pr-8">
          <p className="text-[0.66rem] font-bold tracking-[0.2em] text-primary uppercase">
            Registre de fabrication
          </p>
          <DialogTitle className="font-display text-2xl">
            {recipe
              ? "Modifier la recette"
              : initialProduct
                ? `Recette de ${initialProduct.name}`
                : "Créer une recette"}
          </DialogTitle>
          <DialogDescription>
            Nommez la préparation et indiquez les ingrédients consommés pour la
            fabriquer.
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
          <div className="grid gap-4 sm:grid-cols-2">
            {recipe || !showOutputProductSelect ? (
              <form.Field name="name">
                {(field) => {
                  const invalid =
                    field.state.meta.isTouched && !field.state.meta.isValid
                  return (
                    <Field data-invalid={invalid}>
                      <FieldLabel htmlFor={`${fieldId}-name`}>
                        Nom du produit
                      </FieldLabel>
                      <Input
                        aria-invalid={invalid}
                        autoComplete="off"
                        id={`${fieldId}-name`}
                        maxLength={100}
                        name="recipe-name"
                        onBlur={field.handleBlur}
                        onChange={(event) =>
                          field.handleChange(event.target.value)
                        }
                        placeholder="Élixir du veilleur"
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
            ) : (
              <form.Field name="outputProductId">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor={`${fieldId}-output`}>
                      Produit obtenu
                    </FieldLabel>
                    <Select
                      disabled={initialProduct !== undefined}
                      name={field.name}
                      onValueChange={(value) => {
                        field.handleChange(value)
                        const product = outputProducts.find(
                          (entry) => entry._id === value
                        )
                        form.setFieldValue("name", product?.name ?? "")
                      }}
                      value={field.state.value}
                    >
                      <SelectTrigger
                        className="w-full"
                        id={`${fieldId}-output`}
                        onBlur={field.handleBlur}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="new">
                          Créer une nouvelle potion
                        </SelectItem>
                        {outputProducts.length > 0 ? (
                          <SelectGroup>
                            <SelectLabel>
                              Produits fabricables sans recette
                            </SelectLabel>
                            {outputProducts.map((product) => (
                              <SelectItem key={product._id} value={product._id}>
                                {product.name}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        ) : null}
                      </SelectContent>
                    </Select>
                  </Field>
                )}
              </form.Field>
            )}
            <form.Field name="family">
              {(field) => {
                const invalid =
                  field.state.meta.isTouched && !field.state.meta.isValid
                return (
                  <Field data-invalid={invalid}>
                    <FieldLabel htmlFor={`${fieldId}-family`}>
                      Catégorie
                    </FieldLabel>
                    <Select
                      name={field.name}
                      onValueChange={(value) => {
                        if (isRecipeFamily(value)) field.handleChange(value)
                      }}
                      value={field.state.value}
                    >
                      <SelectTrigger
                        aria-invalid={invalid}
                        className="w-full"
                        id={`${fieldId}-family`}
                        onBlur={field.handleBlur}
                      >
                        <SelectValue placeholder="Choisir une catégorie…" />
                      </SelectTrigger>
                      <SelectContent>
                        {recipeFamilies.map((entry) => (
                          <SelectItem key={entry} value={entry}>
                            {entry}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {invalid ? (
                      <FieldError errors={field.state.meta.errors} />
                    ) : null}
                  </Field>
                )
              }}
            </form.Field>
            {showOutputProductSelect && formValues.outputProductId === "new" ? (
              <form.Field name="name">
                {(field) => {
                  const invalid =
                    field.state.meta.isTouched && !field.state.meta.isValid
                  return (
                    <Field className="sm:col-span-2" data-invalid={invalid}>
                      <FieldLabel htmlFor={`${fieldId}-name`}>
                        Nom du produit
                      </FieldLabel>
                      <Input
                        aria-invalid={invalid}
                        autoComplete="off"
                        id={`${fieldId}-name`}
                        maxLength={100}
                        name="recipe-name"
                        onBlur={field.handleBlur}
                        onChange={(event) =>
                          field.handleChange(event.target.value)
                        }
                        placeholder="Élixir du veilleur"
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
            ) : null}
          </div>

          <form.Field name="effect">
            {(field) => {
              const invalid =
                field.state.meta.isTouched && !field.state.meta.isValid
              return (
                <Field data-invalid={invalid}>
                  <FieldLabel htmlFor={`${fieldId}-effect`}>
                    Effet ou usage
                  </FieldLabel>
                  <Textarea
                    aria-invalid={invalid}
                    id={`${fieldId}-effect`}
                    maxLength={500}
                    name={field.name}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder="Décrivez l’effet utile de cette préparation."
                    value={field.state.value}
                  />
                  {invalid ? (
                    <FieldError errors={field.state.meta.errors} />
                  ) : null}
                </Field>
              )
            }}
          </form.Field>

          <Separator />
          <div className="grid gap-3">
            <div className="flex items-end justify-between gap-3">
              <div>
                <FieldLabel>Ingrédients</FieldLabel>
                <p className="mt-1 text-xs text-muted-foreground">
                  Quantités consommées pour une fabrication.
                </p>
              </div>
              <Button
                disabled={formValues.ingredients.length >= MAX_DYNAMIC_LINES}
                onClick={addIngredient}
                size="sm"
                type="button"
                variant="outline"
              >
                <Plus aria-hidden="true" />
                Ajouter
              </Button>
            </div>

            {formValues.ingredients.map((ingredient, index) => (
              <div
                className="flex items-end gap-2 border-l-2 border-primary/35 pl-3"
                key={ingredient.key}
              >
                <form.Field name={`ingredients[${index}].productId`}>
                  {(field) => {
                    const invalid =
                      field.state.meta.isTouched && !field.state.meta.isValid
                    return (
                      <Field className="min-w-0 flex-1" data-invalid={invalid}>
                        <FieldLabel>Ingrédient {index + 1}</FieldLabel>
                        <ProductPicker
                          ariaInvalid={invalid}
                          name={field.name}
                          onBlur={field.handleBlur}
                          onChange={(value) =>
                            updateIngredient(ingredient.key, {
                              productId: value ?? "",
                            })
                          }
                          products={ingredientProducts}
                          selectedProductId={field.state.value}
                        />
                        {invalid ? (
                          <FieldError errors={field.state.meta.errors} />
                        ) : null}
                      </Field>
                    )
                  }}
                </form.Field>
                <form.Field name={`ingredients[${index}].quantity`}>
                  {(field) => {
                    const invalid =
                      field.state.meta.isTouched && !field.state.meta.isValid
                    return (
                      <Field className="w-24" data-invalid={invalid}>
                        <FieldLabel
                          htmlFor={`${fieldId}-quantity-${ingredient.key}`}
                        >
                          Quantité
                        </FieldLabel>
                        <Input
                          aria-invalid={invalid}
                          id={`${fieldId}-quantity-${ingredient.key}`}
                          min="1"
                          name={field.name}
                          onBlur={field.handleBlur}
                          onChange={(event) =>
                            updateIngredient(ingredient.key, {
                              quantity: event.target.value,
                            })
                          }
                          required
                          step="1"
                          type="number"
                          value={field.state.value}
                        />
                        {invalid ? (
                          <FieldError errors={field.state.meta.errors} />
                        ) : null}
                      </Field>
                    )
                  }}
                </form.Field>
                <Button
                  aria-label={`Retirer l’ingrédient ${index + 1}`}
                  disabled={formValues.ingredients.length === 1}
                  onClick={() => removeIngredient(ingredient.key)}
                  size="icon-lg"
                  type="button"
                  variant="ghost"
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
            ))}
          </div>

          <Card className="gap-0 rounded-none border-primary/20 bg-primary/[0.035] py-0 ring-0">
            <CardContent className="flex items-center justify-between gap-4 p-4">
              <div className="flex min-w-0 items-center gap-3">
                <Calculator
                  aria-hidden="true"
                  className="size-5 shrink-0 text-primary"
                />
                <div className="min-w-0">
                  <p className="text-sm font-semibold">Coût matière calculé</p>
                  <p className="text-xs text-muted-foreground">
                    Quantités × prix d’achat actuels des ingrédients.
                  </p>
                </div>
              </div>
              <output className="shrink-0 font-display text-lg text-primary tabular-nums">
                {costCalculation.cost === undefined
                  ? "—"
                  : formatDecimalSeptims(costCalculation.cost)}
              </output>
            </CardContent>
          </Card>

          {costCalculation.missingPrices.length > 0 ? (
            <Alert className="border-[#8a4233]/30 bg-[#8a4233]/5">
              <CircleAlert aria-hidden="true" />
              <AlertTitle>Prix d’achat manquant</AlertTitle>
              <AlertDescription>
                Renseignez dans l’inventaire le prix d’achat manquant pour :{" "}
                {costCalculation.missingPrices.join(", ")}.
              </AlertDescription>
            </Alert>
          ) : null}

          <DialogFooter className="gap-2 sm:justify-between">
            <div>
              {recipe ? (
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
                        Archiver « {recipe.name} » ?
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        La recette sera retirée du registre courant, mais son
                        contenu restera disponible dans les archives.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Conserver</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => {
                          void archiveRecipe()
                        }}
                      >
                        Archiver la recette
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              ) : null}
            </div>
            <div className="flex justify-end gap-2">
              <Button
                onClick={() => handleOpenChange(false)}
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
                    ) : recipe ? (
                      <Pencil aria-hidden="true" />
                    ) : (
                      <BookPlus aria-hidden="true" />
                    )}
                    {recipe ? "Enregistrer" : "Créer la recette"}
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

export function RecipeArchivesDialog() {
  const archivedRecipes = useQuery(api.recipes.listArchived)
  const setRecipeActive = useMutation(api.recipes.setActive)
  const [restoringId, setRestoringId] = useState<string>()

  async function restoreRecipe(recipe: Recipe) {
    setRestoringId(recipe._id)
    try {
      await setRecipeActive({ active: true, recipeId: recipe._id })
      toast.success(`« ${recipe.name} » est de nouveau disponible.`)
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Impossible de réactiver la recette.")
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
      <DialogContent className="rounded-[0.2rem] border-[#6a5436] bg-[#eee1c7] ring-0 sm:max-w-lg">
        <DialogHeader className="pr-8">
          <p className="text-[0.66rem] font-bold tracking-[0.2em] text-primary uppercase">
            Registre de fabrication
          </p>
          <DialogTitle className="font-display text-2xl">
            Recettes archivées
          </DialogTitle>
          <DialogDescription>
            Réactivez une recette pour la faire réapparaître dans le registre.
          </DialogDescription>
        </DialogHeader>

        {archivedRecipes === undefined ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Chargement des archives…
          </p>
        ) : archivedRecipes.length === 0 ? (
          <Alert className="border-primary/20 bg-primary/[0.04]">
            <ArchiveRestore aria-hidden="true" />
            <AlertTitle>Aucune recette archivée</AlertTitle>
            <AlertDescription>
              Les recettes retirées du registre apparaîtront ici.
            </AlertDescription>
          </Alert>
        ) : (
          <ScrollArea className="max-h-80 pr-3">
            <div className="grid divide-y divide-border/70">
              {archivedRecipes.map((recipe) => (
                <div
                  className="flex items-center justify-between gap-3 py-3"
                  key={recipe._id}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">
                      {recipe.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {recipe.family}
                      {recipe.cost === undefined
                        ? " · coût incomplet"
                        : ` · ${formatDecimalSeptims(recipe.cost)}`}
                    </p>
                  </div>
                  <Button
                    disabled={restoringId !== undefined}
                    onClick={() => {
                      void restoreRecipe(recipe)
                    }}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {restoringId === recipe._id ? (
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
