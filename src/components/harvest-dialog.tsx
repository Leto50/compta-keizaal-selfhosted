import { useForm } from "@tanstack/react-form"
import { useMutation } from "convex/react"
import { Leaf, Plus, Trash2 } from "lucide-react"
import { useId, useState } from "react"
import { toast } from "sonner"

import { DatePicker } from "@/components/date-picker"
import { ProductPicker } from "@/components/product-picker"
import { HarvestValueSummary } from "@/components/harvest-value-summary"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { formatDateValue, parseDateValue } from "@/lib/date-values"
import { getUserFacingErrorMessage } from "@/lib/errors"
import {
  harvestFormSchema,
  MAX_DYNAMIC_LINES,
  MAX_QUANTITY,
} from "@/lib/form-schemas"
import { formatDate } from "@/lib/format"
import { api } from "../../convex/_generated/api"
import { type Doc, type Id } from "../../convex/_generated/dataModel"

function initialValues() {
  return {
    characterId: "",
    comment: "",
    date: formatDateValue(new Date()),
    lines: [{ productId: "", quantity: "1" }],
  }
}

export function HarvestDialog({
  characters,
  products,
}: Readonly<{
  characters: readonly Doc<"characters">[]
  products: readonly Doc<"products">[]
}>) {
  const recordHarvest = useMutation(api.harvests.record)
  const fieldId = useId()
  const [open, setOpen] = useState(false)
  const form = useForm({
    defaultValues: initialValues(),
    validators: { onSubmit: harvestFormSchema },
    onSubmit: async ({ value }) => {
      const date = parseDateValue(value.date)
      if (!date) return
      try {
        await recordHarvest({
          characterId: value.characterId as Id<"characters">,
          ...(value.comment.trim() ? { comment: value.comment.trim() } : {}),
          occurredAt: date.getTime(),
          lines: value.lines.map((line) => ({
            productId: line.productId as Id<"products">,
            quantity: Number(line.quantity),
          })),
        })
        toast.success(
          "Récolte enregistrée. Les ingrédients ont été ajoutés au stock."
        )
        setOpen(false)
      } catch (error) {
        toast.error(
          getUserFacingErrorMessage(
            error,
            "Impossible d’enregistrer la récolte."
          )
        )
      }
    },
  })
  const ingredients = products.filter(
    (product) =>
      product.active && product.category === "ingredient" && product.tracksStock
  )
  const unavailable = characters.length === 0 || ingredients.length === 0

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (form.state.isSubmitting) return
        if (nextOpen) form.reset(initialValues())
        setOpen(nextOpen)
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus aria-hidden="true" />
          Nouvelle récolte
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-[0.2rem] border-[#6a5436] bg-[#eee1c7] ring-0 sm:max-w-2xl">
        <DialogHeader className="pr-8">
          <p className="text-[0.66rem] font-bold tracking-[0.2em] text-primary uppercase">
            Entrée de stock
          </p>
          <DialogTitle className="font-display text-2xl">
            Enregistrer une récolte
          </DialogTitle>
          <DialogDescription>
            Indiquez les ingrédients collectés. Leurs quantités seront ajoutées
            au stock de la boutique.
          </DialogDescription>
        </DialogHeader>
        {unavailable ? (
          <Alert>
            <AlertTitle>
              {characters.length === 0
                ? "Aucun personnage actif"
                : "Aucun ingrédient disponible"}
            </AlertTitle>
            <AlertDescription>
              {characters.length === 0
                ? "Un administrateur doit créer un personnage avant la première récolte."
                : "Ajoutez un ingrédient suivi en stock à l’inventaire avant de saisir une récolte."}
            </AlertDescription>
          </Alert>
        ) : null}
        <form
          className="grid gap-5"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            void form.handleSubmit()
          }}
        >
          <fieldset
            className="grid min-w-0 gap-5 disabled:opacity-60"
            disabled={unavailable}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <form.Field name="characterId">
                {(field) => (
                  <Field data-invalid={!field.state.meta.isValid}>
                    <FieldLabel htmlFor={`${fieldId}-character`}>
                      Personnage
                    </FieldLabel>
                    <Select
                      value={field.state.value}
                      onValueChange={field.handleChange}
                    >
                      <SelectTrigger
                        id={`${fieldId}-character`}
                        onBlur={field.handleBlur}
                        aria-invalid={!field.state.meta.isValid}
                        className="w-full"
                      >
                        <SelectValue placeholder="Qui a récolté ?" />
                      </SelectTrigger>
                      <SelectContent>
                        {characters.map((character) => (
                          <SelectItem key={character._id} value={character._id}>
                            {character.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FieldError errors={field.state.meta.errors} />
                  </Field>
                )}
              </form.Field>
              <form.Field name="date">
                {(field) => (
                  <Field data-invalid={!field.state.meta.isValid}>
                    <FieldLabel htmlFor={`${fieldId}-date`}>
                      Date de récolte
                    </FieldLabel>
                    <DatePicker
                      id={`${fieldId}-date`}
                      ariaLabel="Date de récolte"
                      ariaInvalid={!field.state.meta.isValid}
                      max={formatDateValue(new Date())}
                      required
                      value={field.state.value}
                      onChange={field.handleChange}
                      onBlur={field.handleBlur}
                    />
                    <FieldError errors={field.state.meta.errors} />
                  </Field>
                )}
              </form.Field>
            </div>
            <form.Field name="lines" mode="array">
              {(linesField) => (
                <div className="grid gap-3">
                  <p className="text-sm font-semibold">Ingrédients récoltés</p>
                  {linesField.state.value.map((_, index) => (
                    <div
                      className="grid grid-cols-[minmax(0,1fr)_5rem_auto] items-start gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_auto]"
                      key={index}
                    >
                      <form.Field name={`lines[${index}].productId`}>
                        {(field) => (
                          <Field
                            className="min-w-0"
                            data-invalid={!field.state.meta.isValid}
                          >
                            <FieldLabel
                              htmlFor={`${fieldId}-ingredient-${index}`}
                            >
                              Ingrédient {index + 1}
                            </FieldLabel>
                            <div className="flex min-w-0">
                              <ProductPicker
                                id={`${fieldId}-ingredient-${index}`}
                                ariaLabel={`Ingrédient ${index + 1}`}
                                ariaInvalid={!field.state.meta.isValid}
                                placeholder="Choisir un ingrédient…"
                                products={ingredients.filter(
                                  (product) =>
                                    product._id === field.state.value ||
                                    !linesField.state.value.some(
                                      (line) => line.productId === product._id
                                    )
                                )}
                                selectedProductId={field.state.value}
                                onBlur={field.handleBlur}
                                onChange={(id) => field.handleChange(id ?? "")}
                              />
                            </div>
                            <FieldError errors={field.state.meta.errors} />
                          </Field>
                        )}
                      </form.Field>
                      <form.Field name={`lines[${index}].quantity`}>
                        {(field) => (
                          <Field data-invalid={!field.state.meta.isValid}>
                            <FieldLabel
                              htmlFor={`${fieldId}-quantity-${index}`}
                            >
                              Quantité
                            </FieldLabel>
                            <Input
                              className="h-9"
                              id={`${fieldId}-quantity-${index}`}
                              aria-label={`Quantité ${index + 1}`}
                              aria-invalid={!field.state.meta.isValid}
                              type="number"
                              inputMode="numeric"
                              min={1}
                              max={MAX_QUANTITY}
                              step={1}
                              required
                              value={field.state.value}
                              onBlur={field.handleBlur}
                              onChange={(event) =>
                                field.handleChange(event.target.value)
                              }
                            />
                            <FieldError errors={field.state.meta.errors} />
                          </Field>
                        )}
                      </form.Field>
                      <Button
                        className="mt-6 size-9"
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Retirer l’ingrédient ${index + 1}`}
                        disabled={linesField.state.value.length === 1}
                        onClick={() => linesField.removeValue(index)}
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    </div>
                  ))}
                  <FieldError errors={linesField.state.meta.errors} />
                  <Button
                    className="justify-self-start"
                    type="button"
                    variant="outline"
                    disabled={
                      linesField.state.value.length >= MAX_DYNAMIC_LINES ||
                      linesField.state.value.length >= ingredients.length
                    }
                    onClick={() =>
                      linesField.pushValue({ productId: "", quantity: "1" })
                    }
                  >
                    <Plus aria-hidden="true" />
                    Ajouter un ingrédient
                  </Button>
                </div>
              )}
            </form.Field>
            <form.Subscribe selector={(state) => state.values.lines}>
              {(lines) => {
                const complete = lines.every(
                  (line) =>
                    ingredients.some(
                      (product) => product._id === line.productId
                    ) &&
                    Number.isInteger(Number(line.quantity)) &&
                    Number(line.quantity) > 0 &&
                    Number(line.quantity) <= MAX_QUANTITY
                )
                return complete ? (
                  <div className="grid gap-2">
                    <HarvestValueSummary
                      lines={lines.map((line) => ({
                        quantity: Number(line.quantity),
                        purchaseUnitPrice: ingredients.find(
                          (product) => product._id === line.productId
                        )?.purchasePrice,
                      }))}
                    />
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      Quantités × prix d’achat actuels. Ces tarifs seront
                      conservés avec la récolte.
                    </p>
                  </div>
                ) : null
              }}
            </form.Subscribe>
            <form.Field name="comment">
              {(field) => (
                <Field data-invalid={!field.state.meta.isValid}>
                  <FieldLabel htmlFor={`${fieldId}-comment`}>
                    Commentaire (facultatif)
                  </FieldLabel>
                  <Textarea
                    id={`${fieldId}-comment`}
                    maxLength={500}
                    rows={2}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    aria-invalid={!field.state.meta.isValid}
                    placeholder="Lieu de récolte, précisions…"
                  />
                  <FieldError errors={field.state.meta.errors} />
                </Field>
              )}
            </form.Field>
          </fieldset>
          <form.Subscribe selector={(state) => state.isSubmitting}>
            {(isSubmitting) => (
              <DialogFooter>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={isSubmitting}
                  onClick={() => setOpen(false)}
                >
                  Annuler
                </Button>
                <Button type="submit" disabled={isSubmitting || unavailable}>
                  {isSubmitting ? (
                    <Spinner aria-hidden="true" />
                  ) : (
                    <Leaf aria-hidden="true" />
                  )}
                  Enregistrer la récolte
                </Button>
              </DialogFooter>
            )}
          </form.Subscribe>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function DeleteHarvestDialog({
  harvest,
}: Readonly<{ harvest: Doc<"transactions"> }>) {
  const removeTransaction = useMutation(api.transactions.remove)
  const [open, setOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  async function removeHarvest() {
    setIsDeleting(true)
    try {
      await removeTransaction({ transactionId: harvest._id })
      toast.success(
        "Récolte supprimée. Les quantités ont été retirées du stock."
      )
      setOpen(false)
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Impossible de supprimer la récolte.")
      )
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!isDeleting) setOpen(nextOpen)
      }}
    >
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Supprimer la récolte de ${harvest.actorName} du ${formatDate(harvest.occurredAt)}`}
        >
          <Trash2 aria-hidden="true" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="rounded-[0.2rem] border-[#6a5436] bg-[#eee1c7]">
        <AlertDialogHeader>
          <AlertDialogTitle>Supprimer cette récolte ?</AlertDialogTitle>
          <AlertDialogDescription>
            Les ingrédients récoltés par {harvest.actorName} le{" "}
            {formatDate(harvest.occurredAt)} seront retirés du stock. La
            suppression sera refusée si le stock restant est insuffisant.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Conserver</AlertDialogCancel>
          <AlertDialogAction
            disabled={isDeleting}
            onClick={(event) => {
              event.preventDefault()
              void removeHarvest()
            }}
          >
            {isDeleting ? <Spinner aria-hidden="true" /> : null}Supprimer la
            récolte
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
