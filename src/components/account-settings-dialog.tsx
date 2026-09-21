import { useForm } from "@tanstack/react-form"
import { useMutation } from "convex/react"
import { type FunctionReturnType } from "convex/server"
import { Settings2 } from "lucide-react"
import { useId, useState } from "react"
import { toast } from "sonner"

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
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group"
import { Spinner } from "@/components/ui/spinner"
import { getUserFacingErrorMessage } from "@/lib/errors"
import { accountSettingsFormSchema } from "@/lib/form-schemas"
import { api } from "../../convex/_generated/api"

type Settings = FunctionReturnType<typeof api.accounts.overview>["settings"]

export function AccountSettingsDialog({
  settings,
}: Readonly<{ settings: Settings }>) {
  const saveSettings = useMutation(api.accounts.saveSettings)
  const fieldId = useId()
  const [open, setOpen] = useState(false)

  const settingsValues = () => ({
    cashBalance: settings.cashBalance.toString(),
    censusPerEmployee: settings.censusPerEmployee.toString(),
    employeeCount: settings.employeeCount.toString(),
    fundsBalance: settings.fundsBalance.toString(),
    salaryRatePercent: (settings.salaryRate * 100).toString(),
    taxRatePercent: (settings.taxRate * 100).toString(),
    weeklyRent: settings.weeklyRent.toString(),
  })

  const form = useForm({
    defaultValues: settingsValues(),
    validators: { onSubmit: accountSettingsFormSchema },
    onSubmit: async ({ value }) => {
      try {
        await saveSettings({
          cashBalance: Number(value.cashBalance),
          censusPerEmployee: Number(value.censusPerEmployee),
          employeeCount: Number(value.employeeCount),
          fundsBalance: Number(value.fundsBalance),
          salaryRate: Number(value.salaryRatePercent) / 100,
          taxRate: Number(value.taxRatePercent) / 100,
          weeklyRent: Number(value.weeklyRent),
        })
        toast.success("Les paramètres du compte ont été mis à jour.")
        setOpen(false)
      } catch (error) {
        toast.error(
          getUserFacingErrorMessage(
            error,
            "Impossible de modifier les paramètres du compte."
          )
        )
      }
    },
  })

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen && !open) form.reset(settingsValues())
    setOpen(nextOpen)
  }

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogTrigger asChild>
        <Button size="lg" variant="outline">
          <Settings2 aria-hidden="true" />
          Paramètres
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[94svh] overflow-y-auto rounded-[0.2rem] border-[#6a5436] bg-[#eee1c7] ring-0 sm:max-w-2xl">
        <DialogHeader className="pr-8">
          <p className="text-[0.66rem] font-bold tracking-[0.2em] text-primary uppercase">
            Tenue du compte
          </p>
          <DialogTitle className="font-display text-2xl">
            Paramètres comptables
          </DialogTitle>
          <DialogDescription>
            Mettez à jour les montants déclarés et les charges servant au calcul
            de la semaine courante.
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
          <Card className="gap-0 rounded-none border-primary/20 bg-primary/[0.035] py-0 ring-0">
            <CardContent className="grid gap-4 p-4 sm:grid-cols-2">
              <form.Field name="cashBalance">
                {(field) => {
                  const invalid =
                    field.state.meta.isTouched && !field.state.meta.isValid
                  return (
                    <Field data-invalid={invalid}>
                      <FieldLabel htmlFor={`${fieldId}-cash`}>
                        Caisse déclarée
                      </FieldLabel>
                      <InputGroup>
                        <InputGroupInput
                          aria-invalid={invalid}
                          id={`${fieldId}-cash`}
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
                        <InputGroupAddon align="inline-end">
                          <InputGroupText>septims</InputGroupText>
                        </InputGroupAddon>
                      </InputGroup>
                      {invalid ? (
                        <FieldError errors={field.state.meta.errors} />
                      ) : null}
                    </Field>
                  )
                }}
              </form.Field>
              <form.Field name="fundsBalance">
                {(field) => {
                  const invalid =
                    field.state.meta.isTouched && !field.state.meta.isValid
                  return (
                    <Field data-invalid={invalid}>
                      <FieldLabel htmlFor={`${fieldId}-funds`}>
                        Fonds disponibles
                      </FieldLabel>
                      <InputGroup>
                        <InputGroupInput
                          aria-invalid={invalid}
                          id={`${fieldId}-funds`}
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
                        <InputGroupAddon align="inline-end">
                          <InputGroupText>septims</InputGroupText>
                        </InputGroupAddon>
                      </InputGroup>
                      {invalid ? (
                        <FieldError errors={field.state.meta.errors} />
                      ) : null}
                    </Field>
                  )
                }}
              </form.Field>
            </CardContent>
          </Card>

          <div className="grid gap-4 sm:grid-cols-2">
            <form.Field name="employeeCount">
              {(field) => {
                const invalid =
                  field.state.meta.isTouched && !field.state.meta.isValid
                return (
                  <Field data-invalid={invalid}>
                    <FieldLabel htmlFor={`${fieldId}-employees`}>
                      Employés
                    </FieldLabel>
                    <Input
                      aria-invalid={invalid}
                      id={`${fieldId}-employees`}
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
            <form.Field name="weeklyRent">
              {(field) => {
                const invalid =
                  field.state.meta.isTouched && !field.state.meta.isValid
                return (
                  <Field data-invalid={invalid}>
                    <FieldLabel htmlFor={`${fieldId}-rent`}>
                      Loyer hebdomadaire
                    </FieldLabel>
                    <InputGroup>
                      <InputGroupInput
                        aria-invalid={invalid}
                        id={`${fieldId}-rent`}
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
                      <InputGroupAddon align="inline-end">
                        <InputGroupText>septims</InputGroupText>
                      </InputGroupAddon>
                    </InputGroup>
                    {invalid ? (
                      <FieldError errors={field.state.meta.errors} />
                    ) : null}
                  </Field>
                )
              }}
            </form.Field>
            <form.Field name="censusPerEmployee">
              {(field) => {
                const invalid =
                  field.state.meta.isTouched && !field.state.meta.isValid
                return (
                  <Field data-invalid={invalid}>
                    <FieldLabel htmlFor={`${fieldId}-census`}>
                      Cens par employé
                    </FieldLabel>
                    <InputGroup>
                      <InputGroupInput
                        aria-invalid={invalid}
                        id={`${fieldId}-census`}
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
                      <InputGroupAddon align="inline-end">
                        <InputGroupText>septims</InputGroupText>
                      </InputGroupAddon>
                    </InputGroup>
                    {invalid ? (
                      <FieldError errors={field.state.meta.errors} />
                    ) : null}
                  </Field>
                )
              }}
            </form.Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <form.Field name="salaryRatePercent">
              {(field) => {
                const invalid =
                  field.state.meta.isTouched && !field.state.meta.isValid
                return (
                  <Field data-invalid={invalid}>
                    <FieldLabel htmlFor={`${fieldId}-salary`}>
                      Commission sur les ventes
                    </FieldLabel>
                    <InputGroup>
                      <InputGroupInput
                        aria-invalid={invalid}
                        id={`${fieldId}-salary`}
                        inputMode="decimal"
                        max="100"
                        min="0"
                        name={field.name}
                        onBlur={field.handleBlur}
                        onChange={(event) =>
                          field.handleChange(event.target.value)
                        }
                        required
                        step="any"
                        type="number"
                        value={field.state.value}
                      />
                      <InputGroupAddon align="inline-end">
                        <InputGroupText>%</InputGroupText>
                      </InputGroupAddon>
                    </InputGroup>
                    <FieldDescription>
                      Appliquée aux ventes du salarié pendant la semaine, hors
                      commandes.
                    </FieldDescription>
                    {invalid ? (
                      <FieldError errors={field.state.meta.errors} />
                    ) : null}
                  </Field>
                )
              }}
            </form.Field>
            <form.Field name="taxRatePercent">
              {(field) => {
                const invalid =
                  field.state.meta.isTouched && !field.state.meta.isValid
                return (
                  <Field data-invalid={invalid}>
                    <FieldLabel htmlFor={`${fieldId}-tax`}>
                      Taxe sur les entrées
                    </FieldLabel>
                    <InputGroup>
                      <InputGroupInput
                        aria-invalid={invalid}
                        id={`${fieldId}-tax`}
                        inputMode="decimal"
                        max="100"
                        min="0"
                        name={field.name}
                        onBlur={field.handleBlur}
                        onChange={(event) =>
                          field.handleChange(event.target.value)
                        }
                        required
                        step="any"
                        type="number"
                        value={field.state.value}
                      />
                      <InputGroupAddon align="inline-end">
                        <InputGroupText>%</InputGroupText>
                      </InputGroupAddon>
                    </InputGroup>
                    {invalid ? (
                      <FieldError errors={field.state.meta.errors} />
                    ) : null}
                  </Field>
                )
              }}
            </form.Field>
          </div>

          <DialogFooter>
            <Button
              onClick={() => setOpen(false)}
              type="button"
              variant="ghost"
            >
              Annuler
            </Button>
            <form.Subscribe selector={(state) => state.isSubmitting}>
              {(isSubmitting) => (
                <Button disabled={isSubmitting} type="submit">
                  {isSubmitting ? (
                    <Spinner
                      aria-hidden="true"
                      className="motion-reduce:animate-none"
                    />
                  ) : (
                    <Settings2 aria-hidden="true" />
                  )}
                  Enregistrer
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
