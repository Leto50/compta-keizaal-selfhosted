import { useForm, useStore } from "@tanstack/react-form"
import { useMutation, useQuery } from "convex/react"
import { type FunctionReturnType } from "convex/server"
import {
  Archive,
  ArchiveRestore,
  PackagePlus,
  Pencil,
  Plus,
  Trash2,
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
import { ProductPicker } from "@/components/product-picker"
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
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import { api } from "../../convex/_generated/api"
import { type Doc } from "../../convex/_generated/dataModel"
import { getUserFacingErrorMessage } from "@/lib/errors"
import { bundleFormSchema, MAX_DYNAMIC_LINES } from "@/lib/form-schemas"
import { formatSeptims } from "@/lib/format"
import { priceDraftFromValue, priceDraftToValue } from "@/lib/prices"

type Bundle = FunctionReturnType<typeof api.recipes.listBundles>[number]

interface BundleItemDraft {
  key: number
  productId: string
  quantity: string
}

export function BundleDialog({
  bundle,
  products,
  trigger,
}: Readonly<{
  bundle?: Bundle
  products: readonly Doc<"products">[]
  trigger?: ReactElement
}>) {
  const saveBundle = useMutation(api.bundles.save)
  const setBundleActive = useMutation(api.bundles.setActive)
  const fieldId = useId()
  const nextLineKey = useRef(1)
  const [open, setOpen] = useState(false)
  const [isArchiving, setIsArchiving] = useState(false)
  const availableProducts = products.filter((product) => product.tracksStock)

  function bundleValues() {
    if (bundle?.items.length) {
      return {
        items: bundle.items.map((item, index) => ({
          key: index,
          productId: item.productId ?? "",
          quantity: item.quantity.toString(),
        })),
        name: bundle.name,
        price: priceDraftFromValue(bundle.price),
      }
    }
    return {
      items: [{ key: 0, productId: "", quantity: "1" }],
      name: "",
      price: priceDraftFromValue(undefined),
    }
  }

  const form = useForm({
    defaultValues: bundleValues(),
    validators: { onSubmit: bundleFormSchema },
    onSubmit: async ({ value }) => {
      try {
        await saveBundle({
          ...(bundle ? { bundleId: bundle._id } : {}),
          items: value.items.map((item) => ({
            productId: item.productId as Doc<"products">["_id"],
            quantity: Number(item.quantity),
          })),
          name: value.name.trim(),
          price: priceDraftToValue(value.price),
        })
        toast.success(bundle ? "Lot mis à jour." : "Lot créé.")
        setOpen(false)
      } catch (error) {
        toast.error(
          getUserFacingErrorMessage(error, "Impossible d’enregistrer le lot.")
        )
      }
    },
  })
  const formValues = useStore(form.store, (state) => state.values)

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen && !open) {
      form.reset(bundleValues())
      nextLineKey.current = Math.max(1, bundle?.items.length ?? 0)
    }
    setOpen(nextOpen)
  }

  function updateItem(key: number, patch: Partial<BundleItemDraft>) {
    form.setFieldValue("items", (current) =>
      current.map((item) => (item.key === key ? { ...item, ...patch } : item))
    )
  }

  function addItem() {
    const key = nextLineKey.current
    nextLineKey.current += 1
    form.setFieldValue("items", (current) => [
      ...current,
      { key, productId: "", quantity: "1" },
    ])
  }

  function removeItem(key: number) {
    form.setFieldValue("items", (current) =>
      current.filter((item) => item.key !== key)
    )
  }

  async function archiveBundle() {
    if (!bundle) return
    setIsArchiving(true)
    try {
      await setBundleActive({ active: false, bundleId: bundle._id })
      toast.success("Lot archivé.")
      setOpen(false)
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Impossible d’archiver le lot.")
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
            Nouveau lot
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[94svh] overflow-y-auto rounded-[0.2rem] border-[#6a5436] bg-[#eee1c7] ring-0 sm:max-w-2xl">
        <DialogHeader className="pr-8">
          <p className="text-[0.66rem] font-bold tracking-[0.2em] text-primary uppercase">
            Vente groupée
          </p>
          <DialogTitle className="font-display text-2xl">
            {bundle ? "Modifier le lot" : "Créer un lot"}
          </DialogTitle>
          <DialogDescription>
            Un lot possède son propre prix et déstocke ses composants à la
            vente.
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
            <form.Field name="name">
              {(field) => {
                const invalid =
                  field.state.meta.isTouched && !field.state.meta.isValid
                return (
                  <Field data-invalid={invalid}>
                    <FieldLabel htmlFor={`${fieldId}-name`}>
                      Nom du lot
                    </FieldLabel>
                    <Input
                      aria-invalid={invalid}
                      autoComplete="off"
                      id={`${fieldId}-name`}
                      maxLength={100}
                      name="bundle-name"
                      onBlur={field.handleBlur}
                      onChange={(event) =>
                        field.handleChange(event.target.value)
                      }
                      placeholder="Nécessaire d’exploration"
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
            <form.Field name="price">
              {(field) => {
                const invalid =
                  field.state.meta.isTouched && !field.state.meta.isValid
                return (
                  <Field data-invalid={invalid}>
                    <FieldLabel htmlFor={`${fieldId}-price`}>
                      Prix du lot
                    </FieldLabel>
                    <PriceInput
                      ariaInvalid={invalid}
                      id={`${fieldId}-price`}
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

          <Separator />
          <div className="grid gap-3">
            <div className="flex items-end justify-between gap-3">
              <div>
                <FieldLabel>Composition</FieldLabel>
                <p className="mt-1 text-xs text-muted-foreground">
                  Quantité consommée pour un lot vendu.
                </p>
              </div>
              <Button
                disabled={formValues.items.length >= MAX_DYNAMIC_LINES}
                onClick={addItem}
                size="sm"
                type="button"
                variant="outline"
              >
                <Plus aria-hidden="true" />
                Ajouter
              </Button>
            </div>

            {formValues.items.map((item, index) => {
              return (
                <div
                  className="flex items-end gap-2 border-l-2 border-primary/35 pl-3"
                  key={item.key}
                >
                  <form.Field name={`items[${index}].productId`}>
                    {(field) => {
                      const invalid =
                        field.state.meta.isTouched && !field.state.meta.isValid
                      return (
                        <Field
                          className="min-w-0 flex-1"
                          data-invalid={invalid}
                        >
                          <FieldLabel>Produit {index + 1}</FieldLabel>
                          <ProductPicker
                            ariaInvalid={invalid}
                            name={field.name}
                            onBlur={field.handleBlur}
                            onChange={(productId) =>
                              updateItem(item.key, {
                                productId: productId ?? "",
                              })
                            }
                            products={availableProducts}
                            selectedProductId={field.state.value}
                          />
                          {invalid ? (
                            <FieldError errors={field.state.meta.errors} />
                          ) : null}
                        </Field>
                      )
                    }}
                  </form.Field>
                  <form.Field name={`items[${index}].quantity`}>
                    {(field) => {
                      const invalid =
                        field.state.meta.isTouched && !field.state.meta.isValid
                      return (
                        <Field className="w-24" data-invalid={invalid}>
                          <FieldLabel
                            htmlFor={`${fieldId}-quantity-${item.key}`}
                          >
                            Quantité
                          </FieldLabel>
                          <Input
                            aria-invalid={invalid}
                            id={`${fieldId}-quantity-${item.key}`}
                            min="1"
                            name={field.name}
                            onBlur={field.handleBlur}
                            onChange={(event) =>
                              updateItem(item.key, {
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
                    aria-label={`Retirer le produit ${index + 1}`}
                    disabled={formValues.items.length === 1}
                    onClick={() => removeItem(item.key)}
                    size="icon-lg"
                    type="button"
                    variant="ghost"
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
              )
            })}
          </div>

          <DialogFooter className="gap-2 sm:justify-between">
            <div>
              {bundle ? (
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
                        Archiver « {bundle.name} » ?
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        Le lot ne sera plus proposé lors des ventes. Les ventes
                        précédentes resteront dans le journal.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Conserver</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => {
                          void archiveBundle()
                        }}
                      >
                        Archiver le lot
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
                    ) : bundle ? (
                      <Pencil aria-hidden="true" />
                    ) : (
                      <PackagePlus aria-hidden="true" />
                    )}
                    {bundle ? "Enregistrer" : "Créer le lot"}
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

export function BundleArchivesDialog() {
  const archivedBundles = useQuery(api.bundles.listArchived)
  const setBundleActive = useMutation(api.bundles.setActive)
  const [restoringId, setRestoringId] = useState<string>()

  async function restoreBundle(bundle: Doc<"bundles">) {
    setRestoringId(bundle._id)
    try {
      await setBundleActive({ active: true, bundleId: bundle._id })
      toast.success(`« ${bundle.name} » est de nouveau disponible.`)
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Impossible de réactiver le lot.")
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
            Vente groupée
          </p>
          <DialogTitle className="font-display text-2xl">
            Lots archivés
          </DialogTitle>
          <DialogDescription>
            Réactivez un lot pour le proposer à nouveau lors des ventes.
          </DialogDescription>
        </DialogHeader>

        {archivedBundles === undefined ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Chargement des archives…
          </p>
        ) : archivedBundles.length === 0 ? (
          <Alert className="border-primary/20 bg-primary/[0.04]">
            <ArchiveRestore aria-hidden="true" />
            <AlertTitle>Aucun lot archivé</AlertTitle>
            <AlertDescription>
              Les lots retirés de la vente apparaîtront ici.
            </AlertDescription>
          </Alert>
        ) : (
          <ScrollArea className="max-h-80 pr-3">
            <div className="grid divide-y divide-border/70">
              {archivedBundles.map((bundle) => (
                <div
                  className="flex items-center justify-between gap-3 py-3"
                  key={bundle._id}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">
                      {bundle.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {bundle.price === undefined
                        ? "Prix non renseigné"
                        : formatSeptims(bundle.price)}
                    </p>
                  </div>
                  <Button
                    disabled={restoringId !== undefined}
                    onClick={() => {
                      void restoreBundle(bundle)
                    }}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {restoringId === bundle._id ? (
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
