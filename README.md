# L’eau d’Roche 2

Application de gestion de la boutique RP Skyrim L’eau d’Roche 2. Le frontend
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

- Toutes les requêtes et mutations applicatives exigent une session valide.
- La configuration des personnages, paramètres et accès est réservée aux
  administrateurs.
- Chaque échange enregistre atomiquement l’opération, ses lignes, les mouvements
  et les stocks.
- Une opération qui rendrait un stock négatif est refusée.
- L’inscription publique est désactivée côté Better Auth.
- Les comptes employés sont créés par un administrateur depuis l’application.
