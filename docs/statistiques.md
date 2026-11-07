# Statistiques de la boutique

La page répond à quatre questions : quels mouvements ont été enregistrés,
quelles références contribuent à l’activité, quels ingrédients ont été récoltés,
et quelles commandes restent à traiter aujourd’hui. Elle reprend la présentation
de l’application : parchemin, encre bleue, typographie et composants partagés.

## Lecture des indicateurs

- **Activité** : entrées et sorties du journal, solde avant charges et nombre
  d’opérations. Le graphique bascule entre flux et cumul ; les types d’opérations
  se comparent avec des barres et des nombres lisibles. La comparaison porte sur
  une période précédente de même durée, dont les dates sont affichées.
- **Produits et lots** : classement par quantité ou montant historique ventilé,
  recherche et tableau. Les parts restent rapportées à toute la période après
  recherche. Les huit premières références sont représentées ; l’export contient
  tous les résultats filtrés, y compris les lignes non encore affichées.
- **Récoltes** : volumes, nombre d’opérations, ingrédients et valeur estimée aux
  tarifs enregistrés. Les prix manquants ne sont pas remplacés par les prix
  actuels du catalogue.
- **Commandes** : situation actuelle des commandes clients et fournisseurs,
  retards et montants prévus restant à régler. Le filtre de période disparaît.
  La livraison et l’opération financière sont toutes deux nécessaires pour
  considérer une commande comme terminée.

La période par défaut couvre quatre semaines. Les dates sont en UTC et la date
de fin personnalisée est incluse. Le regroupement automatique réduit le nombre
de barres sur mobile. Les classements, répartitions et états de commandes
disposent de textes lisibles sans dépendre de la couleur ou du survol.

Un premier chargement affiche des squelettes ; un chargement supplémentaire
signale des résultats provisoires et désactive l’export. Une période vide
propose de consulter tout l’historique. Une recherche sans résultat possède sa
propre action de réinitialisation. Un accès lecteur sans rubrique source affiche
une explication et ne lance aucune lecture d’historique.

## Vérifications reproductibles

Les tests Convex vérifient les flux, les prix historiques, la pagination et les
droits côté serveur. Les tests de composants couvrent les filtres, les états, les
changements de permissions et les CSV, notamment les montants masqués et les
cellules susceptibles d’être interprétées comme des formules.

```sh
pnpm test shared/statistics.test.ts convex/statistics.test.ts src/components/statistics.test.tsx
pnpm check
pnpm build
```

Une entrée Vite séparée permet de vérifier les vrais composants et la navigation
de l’application avec des données fictives. Ses alias de test sont propres à sa
configuration ; elle ne modifie ni l’authentification ni les appels de production.

```sh
pnpm preview:statistics
# http://127.0.0.1:3100

pnpm exec playwright install chromium
pnpm test:statistics:visual

# Alternative avec Chromium déjà installé :
STATISTICS_CHROMIUM_PATH=/usr/bin/chromium pnpm test:statistics:visual

pnpm exec playwright show-report .output/statistics-validation/report
```

La suite navigateur exécute les parcours sur ordinateur (1440 × 1000) et mobile
(390 × 664 avec émulation iPhone). Elle conserve des captures des onglets,
grands montants, noms longs, états vides et chargements dans
`.output/statistics-validation/results`. Elle vérifie aussi les téléchargements
CSV et l’absence d’erreurs JavaScript et de débordement horizontal de la page.
Les captures sont des preuves de rendu à examiner, sans comparaison automatique
à une image de référence. Les scénarios se sélectionnent uniquement dans l’URL
de cette entrée de test, avec `?scenario=empty`, `loading`, `partial`,
`incomplete`, `reader`, `orders`, `harvests`, `none` ou `large`.

La prévisualisation prouve les interactions et le rendu des composants avec ces
jeux de données. La validation d’une session authentifiée et des données réelles
nécessite un déploiement Convex accessible.

## Validation du 17 octobre 2026

- `pnpm check` : formatage, lint, types et 490 tests dans 47 fichiers réussis.
- `pnpm build` : construction réussie.
- `pnpm test:statistics:visual` avec Chromium système : 12 parcours réussis,
  captures examinées sur ordinateur, mobile et à 320 px.
- Les captures ont conduit à corriger le regroupement des barres sur mobile,
  les graduations des grands montants et la largeur du tableau.
- La session sur données réelles n’a pas été validée : les deux adresses Convex
  de l’environnement local renvoient `ECONNREFUSED`.
