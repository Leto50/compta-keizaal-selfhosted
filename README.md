# L’eau d’Roche

Application de gestion de la boutique RP Skyrim L’eau d’Roche. Le frontend
utilise TanStack Start et le backend utilise un déploiement Convex auto-hébergé.

Ce dépôt contient le code applicatif, les fonctions Convex et le `Dockerfile` de
l’application web. La configuration du serveur — Docker Compose, PostgreSQL,
volumes, domaines, reverse proxy et sauvegardes — est gérée séparément.

## Développement

Prérequis : Node.js 22, pnpm 11 et l’accès à un déploiement Convex.

```bash
cp .env.example .env.local
cp .env.convex.example .env.convex.local
pnpm install
```

Renseigner dans `.env.local` les URL publiques de Convex ainsi que la clé
administrateur utilisée par le CLI. Les secrets lus par les fonctions Convex se
trouvent dans `.env.convex.local`.

```bash
pnpm selfhost:configure
pnpm selfhost:deploy
pnpm dev
```

L’application de développement est disponible sur <http://localhost:3000>.

## Construction

Les valeurs `VITE_CONVEX_URL` et `VITE_CONVEX_SITE_URL` sont intégrées au bundle
du navigateur. Un changement de domaine exige donc une nouvelle construction.

```bash
docker build \
  --build-arg VITE_CONVEX_URL=https://convex.example.com \
  --build-arg VITE_CONVEX_SITE_URL=https://convex-site.example.com \
  -t eau-de-roche .
```

Le rendu serveur peut utiliser `CONVEX_INTERNAL_URL` et
`CONVEX_INTERNAL_SITE_URL` pour joindre Convex sur le réseau privé de la
plateforme de déploiement.

Le workflow de production utilise `.env` pour L’eau d’Roche et `.env.site2` pour
La Fiole du Voyageur. L’origine publique de La Fiole du Voyageur est passée
explicitement à `deploy_convex`, qui l’enregistre dans l’environnement de ses
fonctions Convex avant de les déployer :

```env
SITE_URL=https://fiole-voyageur.parvos.fyi
```

Cette valeur doit être enregistrée dans l’environnement des **fonctions Convex**.
La passer au conteneur web ou au CLI ne suffit pas. Le troisième argument
facultatif de `deploy_convex` permet de la synchroniser avec `convex env set SITE_URL`
sur le backend correspondant. Sans cet argument, l’origine configurée est conservée.
Pour corriger une instance déjà déployée, modifier `SITE_URL` dans les variables
d’environnement du tableau de bord Convex de cette instance. Une valeur absente
ou différente de l’origine du navigateur provoque un refus `403 INVALID_ORIGIN`
sur les requêtes d’authentification avec une session.

## Vérification

```bash
pnpm check
pnpm build
```

## Commandes utiles

| Commande                  | Rôle                                         |
| ------------------------- | -------------------------------------------- |
| `pnpm dev`                | Lance Convex et le serveur web               |
| `pnpm selfhost:configure` | Envoie `.env.convex.local` au backend Convex |
| `pnpm selfhost:deploy`    | Déploie le schéma et les fonctions Convex    |
| `pnpm seed -- '{…}'`      | Importe le jeu de données initial            |
| `pnpm check`              | Lance formatage, lint, types et tests        |
| `pnpm build`              | Produit le serveur Node.js dans `.output`    |

## Règles métier

- Les données métier exigent une session valide. Seul le nom public du site
  est consultable avant la connexion.
- Un administrateur peut modifier le nom dans « Accès & réglages → Site ».
  Le nom doit contenir entre 1 et 24 caractères.
  Le changement est enregistré dans l’audit et actualise la navigation, la page
  de connexion et le titre de l’onglet. Chaque instance conserve son propre nom.
- La configuration des personnages, paramètres et accès est réservée aux
  administrateurs.
- Le rôle « Lecteur » permet de consulter les données métier et les archives,
  sans accès à l’administration. Toute modification est refusée côté serveur, y compris
  par un appel direct à l’API. Un administrateur peut attribuer ce rôle lors de
  la création d’un compte ou depuis « Gérer l’accès ».
- L’administrateur choisit, pour chaque lecteur, les rubriques accessibles,
  la visibilité des prix d’achat/coûts de fabrication, des prix de vente, des
  montants et des stocks/seuils, les produits
  autorisés et les types d’opérations consultables. Les restrictions sont
  appliquées côté serveur, aux archives, aux détails et aux résumés de l’accueil.
  Une recette, un lot, une commande ou une opération contenant un produit
  interdit est entièrement masqué. Les montants du compte sont calculés sur
  les opérations autorisées ; les soldes globaux de caisse et des fonds ne sont
  pas affichés lorsque cette sélection est restreinte.
  Les lecteurs existants conservent leurs accès tant qu’ils ne sont pas configurés.
  Masquer un type de prix masque également les montants et totaux dérivés.
- Chaque échange enregistre atomiquement l’opération, ses lignes, les mouvements
  et les stocks.
- Une opération qui rendrait un stock négatif est refusée.
- L’inscription publique est désactivée côté Better Auth.
- Les comptes lecteurs et employés sont créés par un administrateur depuis
  l’application.
