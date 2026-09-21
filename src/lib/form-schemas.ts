import { z } from "zod"

import { parseDateValue } from "./date-values"
import { priceDraftToValue } from "./prices"
import { isRecipeFamily, recipeFamilies } from "./recipe-families"
import {
  ACCOUNT_IDENTIFIER_MAX_LENGTH,
  ACCOUNT_IDENTIFIER_MIN_LENGTH,
  isAccountIdentifier,
} from "../../shared/account-identifiers"

export const MAX_AMOUNT = 1_000_000_000
export const MAX_QUANTITY = 1_000_000
export const MAX_DYNAMIC_LINES = 50

function trimmedLength(value: string): number {
  return value.trim().length
}

export function requiredText(label: string, maximum: number) {
  return z
    .string()
    .refine((value) => trimmedLength(value) > 0, `${label} est obligatoire.`)
    .refine(
      (value) => trimmedLength(value) <= maximum,
      `${label} ne peut pas dépasser ${maximum} caractères.`
    )
}

export function optionalText(label: string, maximum: number) {
  return z
    .string()
    .refine(
      (value) => trimmedLength(value) <= maximum,
      `${label} ne peut pas dépasser ${maximum} caractères.`
    )
}

export function wholeNumberInput(
  label: string,
  minimum: number,
  maximum: number
) {
  return z.string().refine((value) => {
    if (!value.trim()) return false
    const parsed = Number(value)
    return (
      Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    )
  }, `${label} doit être un nombre entier compris entre ${minimum} et ${maximum}.`)
}

export function optionalWholeNumberInput(
  label: string,
  minimum: number,
  maximum: number
) {
  return z.string().refine((value) => {
    if (!value.trim()) return true
    const parsed = Number(value)
    return (
      Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    )
  }, `${label} doit être un nombre entier compris entre ${minimum} et ${maximum}.`)
}

export function finiteNumberInput(
  label: string,
  minimum: number,
  maximum: number,
  optional = false
) {
  return z.string().refine((value) => {
    if (!value.trim()) return optional
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum
  }, `${label} doit être compris entre ${minimum} et ${maximum}.`)
}

export const requiredDateInput = z
  .string()
  .refine((value) => parseDateValue(value), "Choisissez une date valide.")

export const optionalDateInput = z
  .string()
  .refine(
    (value) => !value || parseDateValue(value),
    "Choisissez une date valide."
  )

export const operationDateInput = requiredDateInput.refine((value) => {
  const date = parseDateValue(value)
  if (!date) return false
  const endOfToday = new Date()
  endOfToday.setHours(23, 59, 59, 999)
  return date.getTime() <= endOfToday.getTime()
}, "La date ne peut pas être située dans le futur.")

export const priceDraftSchema = z
  .object({
    septims: z.string(),
    units: z.string(),
  })
  .superRefine((value, context) => {
    const price = priceDraftToValue(value)
    if (price === null) return
    if (!Number.isFinite(price)) {
      context.addIssue({
        code: "custom",
        message:
          "Indiquez des nombres entiers de septims et d’unités strictement positives.",
      })
      return
    }
    if (price > MAX_AMOUNT) {
      context.addIssue({
        code: "custom",
        message: `Le prix ne peut pas dépasser ${MAX_AMOUNT} septims par unité.`,
      })
    }
  })

const accountIdentifierSchema = z
  .string()
  .trim()
  .min(
    ACCOUNT_IDENTIFIER_MIN_LENGTH,
    `L’identifiant doit contenir au moins ${ACCOUNT_IDENTIFIER_MIN_LENGTH} caractères.`
  )
  .max(
    ACCOUNT_IDENTIFIER_MAX_LENGTH,
    `L’identifiant ne peut pas dépasser ${ACCOUNT_IDENTIFIER_MAX_LENGTH} caractères.`
  )
  .refine((value) => {
    const length = value.trim().length
    return (
      length < ACCOUNT_IDENTIFIER_MIN_LENGTH ||
      length > ACCOUNT_IDENTIFIER_MAX_LENGTH ||
      isAccountIdentifier(value)
    )
  }, "Utilisez uniquement des lettres sans accent, chiffres, points, tirets ou tirets bas.")

export const loginFormSchema = z.object({
  identifier: z
    .string()
    .trim()
    .min(1, "L’identifiant est obligatoire.")
    .max(254, "L’identifiant est trop long.")
    .refine(
      (value) =>
        !value ||
        value.length > 254 ||
        isAccountIdentifier(value) ||
        z.email().safeParse(value).success,
      "Saisissez un identifiant valide."
    ),
  password: z
    .string()
    .min(1, "Le mot de passe est obligatoire.")
    .max(128, "Le mot de passe est trop long."),
})

export const accountFormSchema = z.object({
  identifier: accountIdentifierSchema,
  name: requiredText("Le nom affiché", 100),
  password: z
    .string()
    .min(12, "Le mot de passe doit contenir au moins 12 caractères.")
    .max(128, "Le mot de passe ne peut pas dépasser 128 caractères."),
  role: z.enum(["admin", "user"]),
})

export const passwordResetFormSchema = z
  .object({
    confirmation: z.string(),
    password: z
      .string()
      .min(12, "Le mot de passe doit contenir au moins 12 caractères.")
      .max(128, "Le mot de passe ne peut pas dépasser 128 caractères."),
  })
  .refine((value) => value.password === value.confirmation, {
    message: "Les deux mots de passe ne correspondent pas.",
    path: ["confirmation"],
  })

export const namedEntityFormSchema = z.object({
  name: requiredText("Le nom", 100),
})

export const accountSettingsFormSchema = z.object({
  cashBalance: wholeNumberInput("Le solde de caisse", 0, MAX_AMOUNT),
  censusPerEmployee: wholeNumberInput("Le cens par employé", 0, MAX_AMOUNT),
  employeeCount: wholeNumberInput("Le nombre d’employés", 0, MAX_AMOUNT),
  fundsBalance: wholeNumberInput("Le solde des fonds", 0, MAX_AMOUNT),
  salaryRatePercent: finiteNumberInput("Le taux de salaire", 0, 100),
  taxRatePercent: finiteNumberInput("Le taux de taxe", 0, 100),
  weeklyRent: wholeNumberInput("Le loyer hebdomadaire", 0, MAX_AMOUNT),
})

export const productFormSchema = z
  .object({
    category: z.enum(["ingredient", "potion", "service"]),
    craftable: z.boolean(),
    minimumStock: z.string(),
    name: requiredText("Le nom de la référence", 100),
    purchasePrice: priceDraftSchema,
    salePrice: priceDraftSchema,
    targetStock: z.string(),
  })
  .superRefine((value, context) => {
    if (value.category !== "service") {
      const minimumStock = wholeNumberInput(
        "Le seuil minimum",
        0,
        MAX_QUANTITY
      ).safeParse(value.minimumStock)
      if (!minimumStock.success) {
        context.addIssue({
          code: "custom",
          message: minimumStock.error.issues[0]?.message ?? "Seuil invalide.",
          path: ["minimumStock"],
        })
      }
      const targetStock = wholeNumberInput(
        "Le stock",
        0,
        MAX_QUANTITY
      ).safeParse(value.targetStock)
      if (!targetStock.success) {
        context.addIssue({
          code: "custom",
          message: targetStock.error.issues[0]?.message ?? "Stock invalide.",
          path: ["targetStock"],
        })
      }
    }
  })

const catalogLineSchema = z.object({
  key: z.number(),
  productId: z.string().min(1, "Choisissez une référence."),
  quantity: wholeNumberInput("La quantité", 1, MAX_QUANTITY),
})

function addDuplicateProductIssues(
  lines: readonly { productId: string }[],
  context: z.RefinementCtx,
  path: "ingredients" | "items" | "lines"
) {
  const firstIndexByProduct = new Map<string, number>()
  lines.forEach((line, index) => {
    if (!line.productId) return
    const firstIndex = firstIndexByProduct.get(line.productId)
    if (firstIndex === undefined) {
      firstIndexByProduct.set(line.productId, index)
      return
    }
    context.addIssue({
      code: "custom",
      message: "Cette référence apparaît déjà dans le formulaire.",
      path: [path, index, "productId"],
    })
  })
}

export const bundleFormSchema = z
  .object({
    items: z
      .array(catalogLineSchema)
      .min(1, "Ajoutez au moins une référence.")
      .max(
        MAX_DYNAMIC_LINES,
        `Un lot est limité à ${MAX_DYNAMIC_LINES} lignes.`
      ),
    name: requiredText("Le nom du lot", 100),
    price: priceDraftSchema,
  })
  .superRefine((value, context) => {
    addDuplicateProductIssues(value.items, context, "items")
  })

export const recipeFormSchema = z
  .object({
    effect: optionalText("La description de l’effet", 500),
    family: z
      .union([z.enum(recipeFamilies), z.literal("")])
      .refine(isRecipeFamily, "Choisissez une catégorie de recette."),
    ingredients: z
      .array(catalogLineSchema)
      .min(1, "Ajoutez au moins un ingrédient.")
      .max(
        MAX_DYNAMIC_LINES,
        `Une recette est limitée à ${MAX_DYNAMIC_LINES} ingrédients.`
      ),
    name: requiredText("Le nom de la recette", 100),
    outputProductId: z.string(),
  })
  .superRefine((value, context) => {
    addDuplicateProductIssues(value.ingredients, context, "ingredients")
    if (
      value.outputProductId !== "new" &&
      value.ingredients.some(
        (ingredient) => ingredient.productId === value.outputProductId
      )
    ) {
      const index = value.ingredients.findIndex(
        (ingredient) => ingredient.productId === value.outputProductId
      )
      context.addIssue({
        code: "custom",
        message: "Un produit ne peut pas être son propre ingrédient.",
        path: ["ingredients", index, "productId"],
      })
    }
  })

const orderLineSchema = catalogLineSchema.extend({
  unitPrice: priceDraftSchema,
})

export const orderFormSchema = z
  .object({
    agreedTotal: optionalWholeNumberInput("Le total convenu", 0, MAX_AMOUNT),
    contactId: z.string(),
    contactName: requiredText("Le nom du contact", 100),
    dueDate: optionalDateInput,
    kind: z.enum(["client", "supplier"]),
    lines: z
      .array(orderLineSchema)
      .min(1, "Ajoutez au moins une référence.")
      .max(
        MAX_DYNAMIC_LINES,
        `Une commande est limitée à ${MAX_DYNAMIC_LINES} lignes.`
      ),
    notes: optionalText("Les notes", 1_000),
    processedCharacterId: z.string(),
    processedDate: z.string(),
    requiresProcessedDetails: z.boolean(),
    status: z.enum(["cancelled", "delivered", "open", "ready"]),
    totalOverridden: z.boolean(),
  })
  .superRefine((value, context) => {
    addDuplicateProductIssues(value.lines, context, "lines")
    if (value.requiresProcessedDetails && !value.processedCharacterId) {
      context.addIssue({
        code: "custom",
        message: "Choisissez le personnage lié à la transaction.",
        path: ["processedCharacterId"],
      })
    }
    if (
      value.requiresProcessedDetails &&
      !operationDateInput.safeParse(value.processedDate).success
    ) {
      context.addIssue({
        code: "custom",
        message: "Choisissez une date de transaction valide.",
        path: ["processedDate"],
      })
    }
  })

const tradeLineSchema = z.object({
  direction: z.enum(["incoming", "outgoing"]),
  id: z.string().min(1, "Choisissez une référence."),
  kind: z.enum(["bundle", "product"]),
  name: z.string(),
  quantity: wholeNumberInput("La quantité", 1, MAX_QUANTITY),
  unitPrice: priceDraftSchema,
})

export const operationFormSchema = z
  .object({
    agreedTotal: z.string(),
    characterId: z.string().min(1, "Choisissez un personnage."),
    comment: optionalText("La note interne", 500),
    counterparty: optionalText("L’interlocuteur", 500),
    discount: finiteNumberInput("La remise", 0, MAX_AMOUNT, true),
    linkedOrderMode: z.boolean(),
    occurredOn: operationDateInput,
    productId: z.string(),
    productionMode: z.boolean(),
    quantity: z.string(),
    tradeLines: z
      .array(tradeLineSchema)
      .max(
        MAX_DYNAMIC_LINES,
        `Une opération est limitée à ${MAX_DYNAMIC_LINES} lignes.`
      ),
  })
  .superRefine((value, context) => {
    const totalSchema = value.linkedOrderMode
      ? wholeNumberInput("Le total convenu", 0, MAX_AMOUNT)
      : optionalWholeNumberInput("Le total convenu", 0, MAX_AMOUNT)
    const totalResult = totalSchema.safeParse(value.agreedTotal)
    if (!totalResult.success) {
      context.addIssue({
        code: "custom",
        message:
          totalResult.error.issues[0]?.message ?? "Total convenu invalide.",
        path: ["agreedTotal"],
      })
    }
    if (value.productionMode) {
      if (!value.productId) {
        context.addIssue({
          code: "custom",
          message: "Choisissez la potion produite.",
          path: ["productId"],
        })
      }
      const quantityResult = wholeNumberInput(
        "La quantité",
        1,
        MAX_QUANTITY
      ).safeParse(value.quantity)
      if (!quantityResult.success) {
        context.addIssue({
          code: "custom",
          message:
            quantityResult.error.issues[0]?.message ?? "Quantité invalide.",
          path: ["quantity"],
        })
      }
      return
    }
    if (value.tradeLines.length === 0) {
      context.addIssue({
        code: "custom",
        message: "Ajoutez au moins une ligne.",
        path: ["tradeLines"],
      })
    }
  })

export const orderProcessingFormSchema = z.object({
  characterId: z.string().min(1, "Choisissez un personnage."),
  occurredOn: operationDateInput,
})
