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
- Fermeture intégrée à un en-tête stable, avec le corps de la fenêtre qui défile
  séparément. Le bouton rond flottant a été retiré.
- Menu sans fermeture visible et libellés de navigation en anglais.
- Cases de droits du lecteur dont la ligne cliquable était trop petite.
- Espacement des historiques de récolte inadapté aux nouvelles zones tactiles.

## Parcours d’enregistrement des achats et ventes

Complément de revue effectué sur la même copie du backend Convex, avec de vrais
enregistrements depuis le formulaire dans le navigateur. Ces essais ne modifient
pas la base originale.

| Parcours                 | Saisie et résultat constaté                                                                                                                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Vente                    | Deux Breuvages guerriers vendus à 18 septims l’unité : 36 septims encaissés, vente visible sur l’accueil et dans le journal.                                                                                                         |
| Achat                    | Trois unités de blé achetées au prix de 6 septims pour 2 unités : 9 septims payés, achat visible sur l’accueil et dans le journal.                                                                                                   |
| Échange mixte            | Un Breuvage guerrier vendu à 25 septims et quatre unités de blé achetées à 1 septim pour 2 unités : solde de 23 septims encaissés, les deux lignes sont conservées.                                                                  |
| Stock                    | Les trois enregistrements font passer le Breuvage guerrier de 6 à 3 unités et le blé de 913 à 920 unités. Les valeurs finales ont été contrôlées dans l’inventaire.                                                                  |
| Correction et répétition | Une validation sans personnage ramène au sélecteur et conserve les quantités et le prix. Après un enregistrement réussi, la réouverture présente un panier vide et conserve le dernier personnage malgré le rechargement des listes. |

Sur mobile, le choix « Vente » ou « Achat » affiche uniquement le panier choisi,
même lorsque les deux paniers contiennent des articles. Les saisies de l’autre
panier sont conservées. Le récapitulatif commun et le bouton de validation
utilisent toujours le solde des ventes moins les achats. La commutation a été
contrôlée avec une vente de 25 septims et un achat de 3 septims : le solde de
22 septims reste identique dans les deux vues. Un achat de 30 septims ramène ce
solde à 5 septims à payer, également depuis la vue vente. La
recherche dispose de la largeur de l’écran ; les prix du catalogue et la quantité
initiale de 1 sont préremplis et restent modifiables. Les détails facultatifs sont
repliés et le montant à encaisser ou à payer est explicite avant la validation.

Neuf tests de composant vérifient les données envoyées pour les achats, ventes
et échanges mixtes, la correction des champs invalides, le panier d’achat vide,
le blocage d’une vente dépassant le stock, la réouverture après succès et
l’ouverture du panier contenant un champ invalide avant sa correction. Ils
complètent les essais dans le navigateur ; ils ne vérifient pas l’apparence.

## Vérification et limites

`pnpm check` et `pnpm build` passent. Les 452 tests couvrent les règles métier,
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
