# Velvet Casino — Blackjack & Roulette

Casino multijoueur en temps réel pour jouer entre amis dans des salons privés.
Les jetons sont fictifs, sans valeur monétaire : aucun dépôt, paiement ou retrait.

## Les jeux

### Blackjack européen

- Sabot de huit jeux, sept sièges ; un joueur peut occuper plusieurs sièges.
- Règles européennes sans carte cachée initiale au croupier (ENHC).
- Tirer, rester, doubler et séparer ; jusqu’à trois splits par siège par défaut.
- Blackjack naturel payé 3:2 et croupier restant à soft 17 par défaut.
- Assurance, mises secondaires Perfect Pairs et 21+3.
- Mises préparées puis verrouillées par les joueurs ; départ lancé par l’hôte.
- Décisions anticipées pour une main, répétition des mises et distribution animée synchronisée.
- Délai de décision serveur ; rester automatiquement à l’expiration du tour.

### Roulette européenne

- Roue de 37 numéros (0 à 36), avec un seul zéro.
- Paris pleins, chevaux, transversales, carrés, sixains, premiers quatre,
  couleurs, pair/impair, manque/passe, douzaines et colonnes.
- Annulation, déplacement, effacement et répétition des mises pendant leur ouverture.
- Cycle automatique : mises, fermeture, rotation et résultats.
- Roue animée synchronisée, historique des 20 derniers numéros et statistiques.
- Gains nets de 35:1 pour un plein à 1:1 pour une chance simple ;
  aucune règle La Partage ou En Prison.

### Fonctionnalités communes

Salons privés avec code à six caractères, pseudonymes, portefeuille partagé entre
les jeux, 10 000 jetons initiaux et recharges fictives de 1 à 10 000 jetons.
L’hôte peut exclure un participant ; les engagements en cours sont réglés avant
son départ. L’interface est adaptée aux mobiles et propose des réglages de son
et de réduction des animations. Le poker affiché à l’accueil est une annonce,
pas un jeu disponible.

Les résultats, soldes et validations sont calculés côté serveur. Les sessions
utilisent un jeton conservé dans le navigateur ; son empreinte SHA-256 est stockée
avec les soldes et statistiques dans un fichier JSON écrit atomiquement.
Les salons et manches restent en mémoire : ils ne reprennent pas après redémarrage.
Les mises non réglées sont remboursées lors du rechargement des portefeuilles.

## Technologies

| Composant | Technologies |
| --- | --- |
| Interface | React 19, TypeScript, Vite 7, CSS, Lucide React, SVG |
| Serveur | Node.js 24, Express 5, Socket.IO 4 |
| Validation et protection | Zod 4, Helmet, express-rate-limit |
| Journalisation et configuration | Pino, dotenv |
| Hasard | `node:crypto.randomInt` et mélange Fisher–Yates |
| Tests | Node Test Runner avec tsx, Playwright |
| Déploiement | Docker Compose, images Node Alpine et Nginx non privilégié |

## Installation et lancement local

Prérequis : Node.js 24 et npm (ou Docker avec Compose pour le déploiement).

```bash
git clone https://github.com/pez-ou/casino.git
cd casino
npm ci
```

Depuis la racine, dans un premier terminal :

```bash
PORT=3000 PUBLIC_ORIGIN=http://localhost:5173 DATA_FILE=./data/accounts.json TRUST_PROXY=false npm run dev:server
```

Dans un second terminal :

```bash
npm run dev:web -- --port 5173 --strictPort
```

Ouvrir **http://localhost:5173**. Vite relaie `/socket.io` et `/health` vers le
backend sur le port 3000. `BACKEND_URL` permet de changer cette destination.
Les variables explicites ci-dessus conviennent au développement, y compris si
un `.env` existe déjà ; ne remplacez pas une configuration de production.

## Docker Compose

Sur une **nouvelle installation**, créer la configuration locale :

```bash
cp .env.example .env
```

Adapter `PUBLIC_ORIGIN` à l’origine exacte utilisée dans le navigateur (sans slash
final) et `WEB_PORT` au port souhaité. Le modèle utilise `http://localhost:8097`.

```bash
docker compose config --quiet
docker compose up -d --build
docker compose ps
curl --fail http://127.0.0.1:8097/health
```

L’interface est liée à `127.0.0.1:8097`. Le backend n’expose aucun port sur l’hôte ;
Nginx transmet les connexions Socket.IO et `/health` sur le réseau Docker.
Pour un VPS, utiliser un reverse proxy HTTPS existant vers ce port local, ou un
tunnel SSH `ssh -L 8097:127.0.0.1:8097 utilisateur@votre-vps`.

Le projet Compose s’appelle `velvet-casino`. Le volume nommé `wallets` conserve
les portefeuilles sous `/data/wallets.json`. Conserver ce volume et sauvegarder les
données avant toute maintenance. Les commandes de lancement ci-dessus concernent
une installation volontaire ; elles reconstruisent et démarrent les services.

## Configuration

Le fichier [.env.example](.env.example) contient uniquement des valeurs de démonstration.
Le `.env` réel, les portefeuilles, journaux et rapports de tests sont exclus de Git.

| Variable | Défaut serveur / configuration Docker | Rôle |
| --- | --- | --- |
| `PUBLIC_ORIGIN` | `http://localhost:8097` | Origine autorisée pour Socket.IO |
| `WEB_PORT` | `8097` | Port local Nginx dans Compose |
| `PORT` | `3001` / `3000` | Port du backend |
| `DATA_FILE` | `./data/accounts.json` / `/data/wallets.json` | Stockage des sessions |
| `TRUST_PROXY` | `false` / `true` dans le modèle | Confiance dans un proxy amont |
| `MIN_BET`, `MAX_BET` | `10`, `2000` | Mise principale blackjack |
| `MAX_SPLITS` | `3` | Splits autorisés par siège |
| `DOUBLE_AFTER_SPLIT` | `true` | Double après séparation |
| `HIT_SOFT_17` | `false` | Tirage du croupier à soft 17 |
| `BLACKJACK_PAYOUT` | `1.5` | Gain net d’un blackjack naturel |
| `CUT_RATIO` | `0.25` | Seuil de mélange du sabot |
| `TURN_SECONDS` | `20` | Délai de décision blackjack |
| `DEAL_CARD_MS`, `DEAL_LEAD_MS` | `320`, `1200` | Animation de distribution |
| `ROULETTE_BETTING_SECONDS` | `30` | Durée des mises roulette |
| `ROULETTE_SPIN_SECONDS` | `10` | Durée de rotation |
| `ROULETTE_RESULT_SECONDS` | `5` | Durée des résultats |
| `MAX_ROOMS` | `100` | Plafond de salons |
| `MAX_CONNECTIONS_PER_IP` | `12` | Connexions simultanées par IP |

`MAX_PLAYERS` et `BETTING_SECONDS` restent acceptés pour compatibilité ; le
blackjack conserve sept sièges et ses mises attendent le lancement de l’hôte.

## Vérifications

```bash
npm run build
npm test
```

Le build vérifie TypeScript et produit `apps/web/dist` ainsi que
`apps/server/dist`. Les tests réseau nécessitant `SERVER_URL` sont ignorés
si aucun serveur cible n’est défini. N’utilisez pas une instance de production
comme cible des tests : ils créent des sessions et des mises.

Pour les tests navigateur sur des serveurs locaux dédiés (ports 3097 et 5197) :

```bash
npx playwright install chromium
VELVET_LOCAL_TESTS=true npm run test:browser
```

Certains scénarios de capture ou d’assurance nécessitent les fixtures indiquées
dans les fichiers de tests (`VELVET_UX_FIXTURE`, `VELVET_INSURANCE_TESTS`).

## Organisation

```text
apps/web/           Interface React et configuration Vite
apps/server/        Serveur, salons, sessions et moteurs des deux jeux
packages/shared/    Types, règles et géométrie partagés
tests/              Tests des moteurs, réseau et navigateur
deploy/nginx.conf   Service des fichiers et proxy Socket.IO
compose.yaml        Services backend/frontend et volume des portefeuilles
```
