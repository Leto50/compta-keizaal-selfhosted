# L’eau d’Roche — auto-hébergée

Version autonome de l’application de gestion de la boutique RP Skyrim L’eau
d’Roche. Le frontend TanStack Start, le backend Convex et le dashboard Convex
s’exécutent sur la même machine avec Docker Compose.

## Architecture

| Service     | Port local | Rôle                                                |
| ----------- | ---------: | --------------------------------------------------- |
| `web`       |       3000 | Application TanStack Start servie par Node.js/Nitro |
| `backend`   |       3210 | API temps réel et WebSocket Convex                  |
| `backend`   |       3211 | Actions HTTP Convex, dont Better Auth               |
| `dashboard` |       6791 | Administration du déploiement Convex                |
| `postgres`  |    interne | Base PostgreSQL 17 de Convex                        |

Convex stocke ses données dans PostgreSQL 17. La base n’est pas publiée sur la
machine hôte : seul le backend Convex peut la joindre sur le réseau Docker. Les
volumes `postgres-data` et `convex-data` conservent respectivement la base et le
stockage local de Convex.

Le navigateur reçoit les URL publiques définies par `VITE_CONVEX_URL` et
`VITE_CONVEX_SITE_URL`. Le rendu serveur utilise directement `backend:3210` et
`backend:3211` sur le réseau Docker.

## Premier démarrage

Prérequis : Docker avec Compose, Node.js 22 et pnpm 11.

```bash
cp .env.example .env.local
cp .env.convex.example .env.convex.local
pnpm install
openssl rand -hex 32
```

Copier la valeur générée dans `POSTGRES_PASSWORD` de `.env.local`, puis lancer :

```bash
docker compose --env-file .env.local up -d postgres backend dashboard
pnpm selfhost:key
```

Copier la clé affichée dans `CONVEX_SELF_HOSTED_ADMIN_KEY` de `.env.local`.
Remplacer ensuite les secrets de `.env.convex.local`. Deux secrets peuvent être
générés ainsi :

```bash
openssl rand -base64 48
```

Configurer le déploiement, envoyer les fonctions puis construire l’application :

```bash
pnpm selfhost:configure
pnpm selfhost:deploy
pnpm selfhost:up
```

Initialiser les données et le premier administrateur :

```bash
pnpm seed -- '{"seedSecret":"la-valeur-de-SEED_SECRET"}'
pnpm convex run internal.auth.bootstrapAdmin '{"name":"Administrateur"}'
pnpm convex env remove INITIAL_ADMIN_PASSWORD
```

Supprimer également `INITIAL_ADMIN_PASSWORD` de `.env.convex.local` après cette
étape. L’application est disponible sur <http://localhost:3000> et le dashboard
Convex sur <http://localhost:6791>.

## Mise en ligne

Conserver `BIND_ADDRESS=127.0.0.1` et placer un reverse proxy HTTPS devant les
services :

| Domaine indicatif         | Destination locale | Particularité                    |
| ------------------------- | ------------------ | -------------------------------- |
| `app.example.com`         | `127.0.0.1:3000`   | Application web                  |
| `convex.example.com`      | `127.0.0.1:3210`   | Autoriser les WebSockets         |
| `convex-site.example.com` | `127.0.0.1:3211`   | Actions HTTP et authentification |

Le dashboard sur le port 6791 doit rester privé, par exemple derrière un VPN ou
un tunnel SSH.

Avant le build public, renseigner dans `.env.local` :

```dotenv
VITE_CONVEX_URL=https://convex.example.com
VITE_CONVEX_SITE_URL=https://convex-site.example.com
CONVEX_CLOUD_ORIGIN=https://convex.example.com
CONVEX_SITE_ORIGIN=https://convex-site.example.com
CONVEX_SELF_HOSTED_URL=https://convex.example.com
```

Renseigner aussi `SITE_URL=https://app.example.com` dans
`.env.convex.local`, puis relancer :

```bash
pnpm selfhost:configure
pnpm selfhost:deploy
pnpm selfhost:up
```

Les valeurs `VITE_*` sont intégrées au bundle navigateur. Tout changement de
domaine exige donc une nouvelle construction de l’image `web`.

## Données et sauvegardes

PostgreSQL est stocké dans le volume `postgres-data`. Les fichiers, index de
recherche, exports et modules Convex utilisent également `convex-data`. Ces deux
volumes survivent aux redémarrages et à `pnpm selfhost:down`. Ne pas utiliser
`docker compose down --volumes` en production.

Créer régulièrement un export Convex et une sauvegarde PostgreSQL :

```bash
mkdir -p backups
pnpm convex export --include-file-storage --path backups/convex.zip
docker compose --env-file .env.local exec -T postgres \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
  > backups/postgres.dump
```

La migration depuis une instance SQLite existante n’est pas automatique : faire
un export Convex avant le changement, redéployer les fonctions sur PostgreSQL,
puis importer l’export. Pour une haute disponibilité, le service `postgres` peut
être remplacé par un PostgreSQL managé situé dans la même région que Convex.

Les tags d’images Convex sont configurables avec `CONVEX_BACKEND_VERSION` et
`CONVEX_DASHBOARD_VERSION`. En production, les épingler à une version testée au
lieu de conserver `latest`.

## Développement

Le développement local classique reste disponible :

```bash
pnpm dev:convex
pnpm dev:web
```

Pour cibler la pile auto-hébergée depuis le CLI, conserver
`CONVEX_SELF_HOSTED_URL` et `CONVEX_SELF_HOSTED_ADMIN_KEY` dans `.env.local`.

## Vérification

```bash
pnpm check
pnpm build
docker compose --env-file .env.local config --quiet
docker build \
  --build-arg VITE_CONVEX_URL=http://localhost:3210 \
  --build-arg VITE_CONVEX_SITE_URL=http://localhost:3211 \
  .
```

## Commandes utiles

| Commande                  | Rôle                                         |
| ------------------------- | -------------------------------------------- |
| `pnpm selfhost:up`        | Construit et démarre toute la pile           |
| `pnpm selfhost:down`      | Arrête la pile sans supprimer les données    |
| `pnpm selfhost:logs`      | Suit les journaux des trois services         |
| `pnpm selfhost:key`       | Génère une clé administrateur Convex         |
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
