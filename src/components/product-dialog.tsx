import { useForm, useStore } from "@tanstack/react-form"
import { useMutation, useQuery } from "convex/react"
import {
  Archive,
  ArchiveRestore,
  BookPlus,
  PackagePlus,
  Pencil,
} from "lucide-react"
import { useId, useRef, useState, type ReactElement } from "react"
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
import { PriceInput } from "@/components/price-input"
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
import { Spinner } from "@/components/ui/spinner"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { api } from "../../convex/_generated/api"
import { type Doc } from "../../convex/_generated/dataModel"
import { getUserFacingErrorMessage } from "@/lib/errors"
import { productFormSchema } from "@/lib/form-schemas"
import { categoryLabels } from "@/lib/format"
import {
  canonicalProductCategory,
  isProductCraftable,
  productCategories,
  type ProductCategory,
} from "@/lib/product-categories"
import { priceDraftFromValue, priceDraftToValue } from "@/lib/prices"

function isProductCategory(value: string): value is ProductCategory {
  return productCategories.some((category) => category === value)
}

export function ProductDialog({
  canWriteRecipe = false,
  hasRecipe = false,
  onWriteRecipe,
  product,
  trigger,
}: Readonly<{
  canWriteRecipe?: boolean
  hasRecipe?: boolean
  onWriteRecipe?: (productId: Doc<"products">["_id"]) => void
  product?: Doc<"products">
  trigger?: ReactElement
}>) {
  const saveProduct = useMutation(api.products.save)
  const setProductActive = useMutation(api.products.setActive)
  const fieldId = useId()
  const [open, setOpen] = useState(false)
  const [isArchiving, setIsArchiving] = useState(false)
  const submitAction = useRef<"save" | "write-recipe">("save")

  const productValues = () => ({
    category: product
      ? canonicalProductCategory(product.category)
      : ("potion" as ProductCategory),
    craftable: product ? isProductCraftable(product, hasRecipe) : true,
    minimumStock: product?.minimumStock.toString() ?? "0",
    name: product?.name ?? "",
    purchasePrice: priceDraftFromValue(product?.purchasePrice),
    salePrice: priceDraftFromValue(product?.salePrice),
    targetStock: product?.currentStock.toString() ?? "0",
  })

  const form = useForm({
    defaultValues: productValues(),
    validators: { onSubmit: productFormSchema },
    onSubmit: async ({ value }) => {
      const productId = await persist(value)
      if (productId && submitAction.current === "write-recipe") {
        onWriteRecipe?.(productId)
      }
      submitAction.current = "save"
    },
  })
  const formValues = useStore(form.store, (state) => state.values)
  const tracksStock = formValues.category !== "service"

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen && !open) form.reset(productValues())
    setOpen(nextOpen)
  }

  async function persist(value: typeof formValues) {
    const submittedTracksStock = value.category !== "service"
    const submittedMinimum = submittedTracksStock
      ? Number(value.minimumStock)
      : 0
    const submittedStock = submittedTracksStock ? Number(value.targetStock) : 0
    const submittedPurchasePrice = priceDraftToValue(value.purchasePrice)
    const submittedSalePrice = priceDraftToValue(value.salePrice)
    try {
      const productId = await saveProduct({
        active: true,
        category: value.category,
        ...(submittedTracksStock ? { craftable: value.craftable } : {}),
        minimumStock: submittedMinimum,
        name: value.name.trim(),
        ...(product ? { productId: product._id } : {}),
        purchasePrice: submittedPurchasePrice,
        salePrice: submittedSalePrice,
        targetStock: submittedStock,
      })
      toast.success(product ? "Référence mise à jour." : "Référence créée.")
      setOpen(false)
      return productId
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(
          error,
          "Impossible d’enregistrer la référence."
        )
      )
      return undefined
    }
  }

  async function archiveProduct() {
    if (!product) return
    setIsArchiving(true)
    try {
      await setProductActive({ active: false, productId: product._id })
      toast.success("Référence archivée.")
      setOpen(false)
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Impossible d’archiver la référence.")
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
            <PackagePlus aria-hidden="true" />
            Nouvelle référence
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[94svh] overflow-y-auto rounded-[0.2rem] border-[#6a5436] bg-[#eee1c7] ring-0 sm:max-w-xl">
        <DialogHeader className="pr-8">
          <p className="text-[0.66rem] font-bold tracking-[0.2em] text-primary uppercase">
            Catalogue de la boutique
          </p>
          <DialogTitle className="font-display text-2xl">
            {product ? "Modifier la référence" : "Créer une référence"}
          </DialogTitle>
          <DialogDescription>
            Renseignez ses prix et, si nécessaire, son niveau de stock.
          </DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-5"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            submitAction.current = "save"
            void form.handleSubmit()
          }}
        >
          <form.Field name="name">
            {(field) => {
              const invalid =
                field.state.meta.isTouched && !field.state.meta.isValid
              return (
                <Field data-invalid={invalid}>
                  <FieldLabel htmlFor={`${fieldId}-name`}>Nom</FieldLabel>
                  <Input
                    aria-invalid={invalid}
                    autoComplete="off"
                    id={`${fieldId}-name`}
                    maxLength={100}
                    name="product-name"
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder="Potion de vigueur"
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

          <div className="grid gap-4 sm:grid-cols-2">
            <form.Field name="category">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor={`${fieldId}-category`}>
                    Catégorie
                  </FieldLabel>
                  <Select
                    name={field.name}
                    onValueChange={(value) => {
                      if (isProductCategory(value)) field.handleChange(value)
                    }}
                    value={field.state.value}
                  >
                    <SelectTrigger
                      className="w-full"
                      id={`${fieldId}-category`}
                      onBlur={field.handleBlur}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {productCategories.map((entry) => (
                        <SelectItem key={entry} value={entry}>
                          {categoryLabels[entry]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
            </form.Field>
            {tracksStock ? (
              <form.Field name="craftable">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor={`${fieldId}-craftable`}>
                      Mode d’obtention
                    </FieldLabel>
                    <Select
                      name={field.name}
                      onValueChange={(value) =>
                        field.handleChange(value === "recipe")
                      }
                      value={field.state.value ? "recipe" : "loot"}
                    >
                      <SelectTrigger
                        className="w-full"
                        id={`${fieldId}-craftable`}
                        onBlur={field.handleBlur}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="recipe">Fabricable</SelectItem>
                        <SelectItem value="loot">
                          {formValues.category === "potion"
                            ? "Trouvée uniquement"
                            : "Non fabricable"}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                )}
              </form.Field>
            ) : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <form.Field name="purchasePrice">
              {(field) => {
                const invalid =
                  field.state.meta.isTouched && !field.state.meta.isValid
                return (
                  <Field data-invalid={invalid}>
                    <FieldLabel htmlFor={`${fieldId}-purchase-price`}>
                      Prix d’achat
                    </FieldLabel>
                    <PriceInput
                      ariaInvalid={invalid}
                      id={`${fieldId}-purchase-price`}
                      name={field.name}
                      onBlur={field.handleBlur}
                      onValueChange={field.handleChange}
                      value={field.state.value}
                    />
                    {invalid ? (
                      <FieldError errors={field.state.meta.errors} />
                    ) : null}
                  </Field>
                )
              }}
            </form.Field>
            <form.Field name="salePrice">
              {(field) => {
                const invalid =
                  field.state.meta.isTouched && !field.state.meta.isValid
                return (
                  <Field data-invalid={invalid}>
                    <FieldLabel htmlFor={`${fieldId}-sale-price`}>
                      Prix de vente
                    </FieldLabel>
                    <PriceInput
                      ariaInvalid={invalid}
                      id={`${fieldId}-sale-price`}
                      name={field.name}
                      onBlur={field.handleBlur}
                      onValueChange={field.handleChange}
                      value={field.state.value}
                    />
                    {invalid ? (
                      <FieldError errors={field.state.meta.errors} />
                    ) : null}
                  </Field>
                )
              }}
            </form.Field>
          </div>

          {tracksStock ? (
            <div className="grid gap-4 border-y border-border/70 py-4 sm:grid-cols-2">
              <>
                <form.Field name="targetStock">
                  {(field) => {
                    const invalid =
                      field.state.meta.isTouched && !field.state.meta.isValid
                    return (
                      <Field data-invalid={invalid}>
                        <FieldLabel htmlFor={`${fieldId}-stock`}>
                          Stock actuel
                        </FieldLabel>
                        <Input
                          aria-invalid={invalid}
                          id={`${fieldId}-stock`}
                          min="0"
                          name={field.name}
                          onBlur={field.handleBlur}
                          onChange={(event) =>
                            field.handleChange(event.target.value)
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
                <form.Field name="minimumStock">
                  {(field) => {
                    const invalid =
                      field.state.meta.isTouched && !field.state.meta.isValid
                    return (
                      <Field data-invalid={invalid}>
                        <FieldLabel htmlFor={`${fieldId}-minimum-stock`}>
                          Seuil d’alerte
                        </FieldLabel>
                        <Input
                          aria-invalid={invalid}
                          id={`${fieldId}-minimum-stock`}
                          min="0"
                          name={field.name}
                          onBlur={field.handleBlur}
                          onChange={(event) =>
                            field.handleChange(event.target.value)
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
              </>
            </div>
          ) : null}

          <DialogFooter className="gap-2 sm:justify-between">
            <div>
              {product ? (
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
                        Archiver « {product.name} » ?
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        La référence ne sera plus proposée dans les nouvelles
                        opérations. Son historique sera conservé.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Conserver</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => {
                          void archiveProduct()
                        }}
                      >
                        Archiver la référence
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              ) : null}
            </div>
            <div className="grid w-full gap-2 sm:flex sm:w-auto sm:justify-end">
              <Button
                onClick={() => setOpen(false)}
                type="button"
                variant="ghost"
              >
                Annuler
              </Button>
              {tracksStock &&
              formValues.craftable &&
              onWriteRecipe &&
              (!product || canWriteRecipe) ? (
                <form.Subscribe selector={(state) => state.isSubmitting}>
                  {(isSubmitting) => (
                    <Button
                      disabled={isSubmitting || isArchiving}
                      onClick={() => {
                        submitAction.current = "write-recipe"
                        void form.handleSubmit()
                      }}
                      type="button"
                      variant="outline"
                    >
                      <BookPlus aria-hidden="true" />
                      {product ? "Écrire la recette" : "Créer puis écrire"}
                    </Button>
                  )}
                </form.Subscribe>
              ) : null}
              <form.Subscribe selector={(state) => state.isSubmitting}>
                {(isSubmitting) => (
                  <Button disabled={isSubmitting || isArchiving} type="submit">
                    {isSubmitting ? (
                      <Spinner
                        aria-hidden="true"
                        className="motion-reduce:animate-none"
                      />
                    ) : product ? (
                      <Pencil aria-hidden="true" />
                    ) : (
                      <PackagePlus aria-hidden="true" />
                    )}
                    {product ? "Enregistrer" : "Créer la référence"}
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

export function ProductArchivesDialog() {
  const archivedProducts = useQuery(api.products.listArchived)
  const setProductActive = useMutation(api.products.setActive)
  const [restoringId, setRestoringId] = useState<string>()

  async function restoreProduct(product: Doc<"products">) {
    setRestoringId(product._id)
    try {
      await setProductActive({ active: true, productId: product._id })
      toast.success(`« ${product.name} » est de nouveau disponible.`)
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(
          error,
          "Impossible de réactiver la référence."
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
      <DialogContent className="rounded-[0.2rem] border-[#6a5436] bg-[#eee1c7] ring-0 sm:max-w-lg">
        <DialogHeader className="pr-8">
          <p className="text-[0.66rem] font-bold tracking-[0.2em] text-primary uppercase">
            Catalogue de la boutique
          </p>
          <DialogTitle className="font-display text-2xl">
            Références archivées
          </DialogTitle>
          <DialogDescription>
            Réactivez une référence pour la rendre à nouveau disponible.
          </DialogDescription>
        </DialogHeader>

        {archivedProducts === undefined ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Chargement des archives…
          </p>
        ) : archivedProducts.length === 0 ? (
          <Alert className="border-primary/20 bg-primary/[0.04]">
            <ArchiveRestore aria-hidden="true" />
            <AlertTitle>Aucune référence archivée</AlertTitle>
            <AlertDescription>
              Les références retirées du catalogue apparaîtront ici.
            </AlertDescription>
          </Alert>
        ) : (
          <ScrollArea className="max-h-80 pr-3">
            <div className="grid divide-y divide-border/70">
              {archivedProducts.map((product) => (
                <div
                  className="flex items-center justify-between gap-3 py-3"
                  key={product._id}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">
                      {product.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {categoryLabels[product.category]}
                    </p>
                  </div>
                  <Button
                    disabled={restoringId !== undefined}
                    onClick={() => {
                      void restoreProduct(product)
                    }}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {restoringId === product._id ? (
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
