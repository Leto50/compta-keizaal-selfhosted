# Revue UX/UI mobile

Revue du 14 octobre 2026, réalisée avec le frontend réel et une copie du backend
Convex local. Les corrections conservent le thème existant et utilisent l’échelle
de tailles Tailwind.

## Périmètre parcouru

| Rubrique          | Contrôles effectués                                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Connexion         | Disposition du formulaire, taille et lisibilité des champs, erreurs sur les champs obligatoires.                                |
| Navigation        | Ouverture du menu, rubriques visibles, libellés accessibles et fermeture.                                                       |
| Aujourd’hui       | Actions rapides, alertes, indicateurs et dernières transactions ; formulaires d’échange et de production.                       |
| Inventaire        | Actions, recherche, catégories, tri, cartes, création d’une référence et archives.                                              |
| Transactions      | Filtres, dates, cartes et lisibilité des références et des montants.                                                            |
| Compte            | Indicateurs, sélection de semaine, tri, bilan hebdomadaire et formulaire des paramètres.                                        |
| Commandes         | Cartes, onglets, lignes, préparation, contacts et formulaire de création.                                                       |
| Recettes et lots  | Les deux vues, actions, cartes, catégories, archives et formulaires de création.                                                |
| Récoltes          | État vide, filtres, formulaire, sélection d’un ingrédient et messages de validation ; revue du code des historiques et groupes. |
| Personnages       | Liste, actions, formulaire de création et archives.                                                                             |
| Accès et réglages | Comptes, audit, site, création d’un compte et configuration des droits du rôle lecteur.                                         |

Les pages ont été parcourues dans des aperçus de téléphone. Les dispositions
modifiées ont également été contrôlées à différentes largeurs, notamment 320 et
390 px, et comparées aux dispositions tablette et bureau. Les captures ont été
complétées par la lecture du DOM et des interactions lorsque l’outil de capture
du navigateur partagé échouait ou renvoyait une image périmée.

## Problèmes corrigés

- Zones tactiles trop petites et texte des champs trop petit sur mobile.
- Actions principales de largeur ou d’ordre incohérents selon les pages.
- Boutons du catalogue répartis sans alignement et icônes décoratives isolées.
- Onglets d’inventaire et d’administration qui se répartissaient mal sur les
  petits écrans.
- Noms d’articles et de transactions tronqués dans les vues de consultation.
- Montants ou quantités nécessitant un défilement horizontal dans les dernières
  transactions et les lignes de commande.
- Filtres du compte trop étroits pour afficher la semaine sélectionnée.
- Fenêtres et calendriers dépassant la hauteur disponible.
- Défilement horizontal dans les formulaires de recette et de lot : le produit
  et la quantité sont désormais organisés en lignes sur mobile.
- Fermeture des longues fenêtres qui disparaissait pendant le défilement.
- Menu sans fermeture visible et libellés de navigation en anglais.
- Cases de droits du lecteur dont la ligne cliquable était trop petite.
- Espacement des historiques de récolte inadapté aux nouvelles zones tactiles.

## Vérification et limites

`pnpm check` et `pnpm build` passent. Les 443 tests couvrent les règles métier,
les permissions et les composants existants ; ils ne constituent pas une preuve
de qualité visuelle.

Cette revue ne garantit pas que chaque combinaison de données ou chaque état
conditionnel a été testé. En particulier, l’enregistrement complet d’une récolte
et son historique rempli n’ont pas été validés de bout en bout dans le
navigateur ; leur disposition a aussi été revue dans le code. Aucun parcours
complet avec une session lecteur distincte n’est revendiqué.

Il s’agit d’aperçus Chromium redimensionnés, sans essai sur un téléphone physique,
Safari iOS ou avec un clavier mobile réel. La revue constate et corrige les
défauts observés ; elle ne remplace pas ces essais ni une appréciation subjective
de chaque détail graphique.
