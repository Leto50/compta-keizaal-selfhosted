import { readFile } from "node:fs/promises"
import {
  test as base,
  expect,
  type Page,
  type TestInfo,
} from "@playwright/test"

const test = base.extend({
  page: async ({ page }, runTest) => {
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.message))
    await runTest(page)
    expect(errors).toEqual([])
  },
})

async function evidence(page: Page, info: TestInfo, name: string) {
  await page.evaluate(() => document.fonts.ready)
  await page.evaluate(() => window.scrollTo(0, 0))
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
  const path = info.outputPath(`${name}.png`)
  await page.screenshot({ path, fullPage: true })
  await info.attach(name, { path, contentType: "image/png" })
}

test("activité, cumul et période personnalisée inclusive", async ({
  page,
}, info) => {
  await page.goto("/")
  await expect(
    page.getByRole("heading", { name: "Statistiques", exact: true })
  ).toBeVisible()
  await expect(
    page.getByRole("figure", { name: "Évolution des entrées et sorties" })
  ).toBeVisible()
  await evidence(page, info, "activite")
  await page.getByRole("button", { name: "Cumul", exact: true }).click()
  await expect(
    page.getByRole("figure", { name: "Solde cumulé", exact: true })
  ).toBeVisible()
  await expect(
    page.getByRole("figure", { name: "Évolution des entrées et sorties" })
  ).toHaveCount(0)
  await page.getByRole("combobox", { name: "Période", exact: true }).click()
  await page
    .getByRole("option", { name: "Tout l’historique", exact: true })
    .click()
  await expect(page.getByText(/Comparaison du/)).toHaveCount(0)
  await page.getByRole("combobox", { name: "Période", exact: true }).click()
  await page
    .getByRole("option", { name: "Période personnalisée", exact: true })
    .click()
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const dayLabel = new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "full",
  }).format(yesterday)
  await page
    .getByRole("button", { name: "Début de la période", exact: true })
    .click()
  if (
    (await page
      .getByRole("button", { name: new RegExp(dayLabel, "i") })
      .count()) === 0
  )
    await page
      .getByRole("button", { name: "Aller au mois suivant", exact: true })
      .click()
  await page.getByRole("button", { name: new RegExp(dayLabel, "i") }).click()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await page
    .getByRole("button", { name: "Fin de la période", exact: true })
    .click()
  if (
    (await page
      .getByRole("button", { name: new RegExp(dayLabel, "i") })
      .count()) === 0
  )
    await page
      .getByRole("button", { name: "Aller au mois précédent", exact: true })
      .click()
  await page.getByRole("button", { name: new RegExp(dayLabel, "i") }).click()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await expect(page.getByRole("status")).toContainText("1 opération")
  await expect(page.getByText("Période invalide", { exact: true })).toHaveCount(
    0
  )
  await evidence(page, info, "periode-un-jour")
})

test("classement, recherche, parts stables et export des résultats", async ({
  page,
}, info) => {
  await page.goto("/")
  await page.getByRole("tab", { name: "Produits & lots", exact: true }).click()
  const row = page
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name: "Blé", exact: true }) })
  const share = await row.getByRole("cell").last().innerText()
  await page
    .getByRole("textbox", {
      name: "Rechercher un produit ou un lot",
      exact: true,
    })
    .fill("Blé")
  await expect(page.getByRole("row")).toHaveCount(2)
  await expect(row.getByRole("cell").last()).toHaveText(share)
  await page.getByRole("combobox", { name: "Classer par", exact: true }).click()
  await page
    .getByRole("option", { name: "Encaissements ventilés", exact: true })
    .click()
  const downloadEvent = page.waitForEvent("download")
  await page
    .getByRole("button", { name: "Exporter en CSV", exact: true })
    .click()
  const download = await downloadEvent
  const csv = await readFile(await download.path(), "utf8")
  expect(csv).toContain('"Blé"')
  expect(csv).toContain("Part de la période (%)")
  expect(csv).not.toContain("Potion de vigueur")
  await evidence(page, info, "produits-filtres")
  await page
    .getByRole("textbox", {
      name: "Rechercher un produit ou un lot",
      exact: true,
    })
    .fill("introuvable")
  await expect(
    page.getByRole("heading", { name: "Aucune référence trouvée", exact: true })
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Exporter en CSV", exact: true })
  ).toBeDisabled()
  await page
    .getByRole("button", { name: "Effacer la recherche", exact: true })
    .click()
  await expect(page.getByRole("row")).toHaveCount(11)
  await evidence(page, info, "produits")
})

test("récoltes et commandes ont des périmètres distincts", async ({
  page,
}, info) => {
  await page.goto("/")
  await page.getByRole("tab", { name: "Récoltes", exact: true }).click()
  await expect(
    page.getByRole("figure", { name: "Unités récoltées", exact: true })
  ).toBeVisible()
  await evidence(page, info, "recoltes")
  await page.getByRole("tab", { name: "Commandes", exact: true }).click()
  await expect(
    page.getByRole("combobox", { name: "Période", exact: true })
  ).toHaveCount(0)
  await expect(
    page.getByRole("heading", {
      name: "Situation actuelle des commandes",
      exact: true,
    })
  ).toBeVisible()
  await expect(page.getByText("1 850 sept.", { exact: true })).toBeVisible()
  const downloadEvent = page.waitForEvent("download")
  await page
    .getByRole("button", { name: "Exporter en CSV", exact: true })
    .click()
  const download = await downloadEvent
  const csv = await readFile(await download.path(), "utf8")
  expect(csv).toContain("Indépendante de la période")
  expect(csv).not.toContain("Période précédente")
  await evidence(page, info, "commandes")
})

test("vide, premier chargement et historique partiel", async ({
  page,
}, info) => {
  await page.goto("/?scenario=empty")
  await expect(
    page.getByRole("heading", {
      name: "Aucune donnée sur cette période",
      exact: true,
    })
  ).toBeVisible()
  await expect(page.getByRole("application")).toHaveCount(0)
  await evidence(page, info, "vide")
  await page
    .getByRole("button", { name: "Voir tout l’historique", exact: true })
    .click()
  await expect(
    page.getByRole("heading", {
      name: "Aucune donnée sur cette période",
      exact: true,
    })
  ).toBeVisible()
  await page.goto("/?scenario=loading")
  await expect(page.getByRole("status")).toHaveText("Chargement des données…")
  await expect(page.getByRole("definition")).toHaveCount(0)
  await evidence(page, info, "chargement")
  await page.goto("/?scenario=partial")
  await expect(page.getByRole("status")).toContainText("résultats provisoires")
  await expect(
    page.getByRole("button", { name: "Exporter en CSV", exact: true })
  ).toBeDisabled()
  await evidence(page, info, "historique-partiel")
})

test("accès lecteurs et montants masqués dans la page et le CSV", async ({
  page,
}, info) => {
  await page.goto("/?scenario=reader")
  await expect(
    page.getByRole("figure", { name: "Évolution des entrées et sorties" })
  ).toHaveCount(0)
  await expect(
    page.getByText("Encaissements du journal", { exact: true })
  ).toHaveCount(0)
  await page.getByRole("tab", { name: "Produits & lots", exact: true }).click()
  await page.getByRole("combobox", { name: "Classer par", exact: true }).click()
  await expect(
    page.getByRole("option", { name: "Encaissements ventilés", exact: true })
  ).toHaveCount(0)
  await page.keyboard.press("Escape")
  const downloadEvent = page.waitForEvent("download")
  await page
    .getByRole("button", { name: "Exporter en CSV", exact: true })
    .click()
  const download = await downloadEvent
  const csv = await readFile(await download.path(), "utf8")
  expect(csv).not.toMatch(/septim|encaissement|décaissement|sans ventilation/i)
  await evidence(page, info, "lecteur-produits")
  await page.goto("/?scenario=orders")
  await expect(page.getByRole("tab")).toHaveCount(1)
  await expect(
    page.getByRole("combobox", { name: "Période", exact: true })
  ).toHaveCount(0)
  await page.goto("/?scenario=harvests")
  await expect(page.getByRole("tab")).toHaveCount(3)
  await page.getByRole("tab", { name: "Produits & lots", exact: true }).click()
  await expect(
    page.getByRole("combobox", { name: "Classer par", exact: true })
  ).toContainText("Unités récoltées")
  await page.goto("/?scenario=none")
  await expect(
    page.getByRole("heading", {
      name: "Aucune activité consultable",
      exact: true,
    })
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Exporter en CSV", exact: true })
  ).toHaveCount(0)
})

test("historiques incomplets, longs libellés et grands montants", async ({
  page,
}, info) => {
  await page.goto("/?scenario=incomplete")
  await expect(
    page.getByText("Flux historiques incomplets", { exact: true })
  ).toBeVisible()
  await page.getByRole("tab", { name: "Produits & lots", exact: true }).click()
  await expect(
    page.getByText("Ventilation partielle des références", { exact: true })
  ).toBeVisible()
  await evidence(page, info, "ventilation-incomplete")
  await page.goto("/?scenario=large")
  await evidence(page, info, "grands-montants")
  await page.getByRole("tab", { name: "Produits & lots", exact: true }).click()
  await evidence(page, info, "longs-libelles")
  await page.setViewportSize({ width: 320, height: 720 })
  expect(
    await page
      .locator('[data-slot="table-container"]')
      .evaluate((element) => element.scrollWidth <= element.clientWidth)
  ).toBe(true)
  await evidence(page, info, "longs-libelles-320px")
})
