# CLAUDE.md — Rituel de dessin matinal

> Contexte de projet pour Claude Code. Ce fichier résume le concept, l'architecture,
> les décisions prises et la feuille de route. Le langage de l'interface est le **français**.

---

## 1. Concept

Application personnelle et **ultra-minimale** : un rituel de dessin quotidien.
Chaque matin, l'app présente **une image** tirée d'une collection de références
(peintures), en plein écran. L'utilisateur la dessine, valide, et la suivante
n'arrive que le lendemain. L'app existe pour ne **jamais laisser passer une image
sans qu'elle ait été dessinée** (verrou anti-oubli).

Usage strictement **personnel** (un seul utilisateur, non commercial).

Principe directeur de design : **l'image est toute l'interface**. Pas de boutons,
pas de menus, pas de texte superflu. Tout passe par des gestes.

---

## 2. Architecture

Tout est hébergé sur **Vercel** (plan Hobby gratuit, usage perso), consolidé
volontairement au même endroit que les autres projets de l'utilisateur.

- **Front-end** : fichiers statiques (`index.html`, `styles.css`, `app.js`) servis à la racine.
- **Back-end** : une fonction serverless `api/data.js` exposée à `/api/data`.
  Elle lit le channel are.na **privé** côté serveur (le jeton n'est jamais exposé
  au navigateur) et renvoie `{ count, images: [{ id, src }] }`.
- **Même origine** front + back → pas de CORS, pas de bac à sable qui bloque.
  (C'est la raison d'être de cette structure : une app 100 % navigateur ne pouvait
  pas lire un channel are.na privé.)

Historique : un premier prototype tournait sur un **Cloudflare Worker**. Il a servi
à valider la mécanique are.na, puis a été remplacé par Vercel. **À retirer** une fois
Vercel confirmé en production.

### Structure des fichiers
```
/
├── index.html        # structure de l'app (aucune logique)
├── styles.css        # design (fond galerie, feedback des gestes, motion de chargement)
├── app.js            # logique : fetch /api/data, verrou journalier, modes test, gestes
├── api/
│   └── data.js       # backend serverless : lecture are.na v3, jeton caché
└── CLAUDE.md
```
Ne **pas** déplacer `data.js` hors du dossier `api/` : c'est cette arborescence qui
crée l'endpoint `/api/data` sur Vercel. Aucun `package.json` requis (zéro build,
statique + fonction). Preset Vercel : **Other**.

---

## 3. Variables d'environnement (Vercel → Settings → Environment Variables)

| Nom            | Rôle                                   |
|----------------|----------------------------------------|
| `ARENA_TOKEN`  | Personal Access Token are.na (secret)  |
| `CHANNEL_SLUG` | `paintings_references`                 |

Le jeton se crée sur `are.na/developers/personal-access-tokens`. Il donne accès au
compte : à traiter comme un mot de passe, jamais dans le code ni côté client.

---

## 4. Source de données — are.na (API v3)

- Endpoint : `GET https://api.are.na/v3/channels/{slug}/contents?per=100&page=N`
- Auth : en-tête `Authorization: Bearer <ARENA_TOKEN>`
- Pagination : boucler tant que `meta.has_more_pages` est vrai.
- Réponse : `{ data: [...], meta: {...} }` (⚠️ **v3**, pas v2 : la v2 renvoyait 401
  avec les nouveaux jetons — bug déjà rencontré et corrigé).
- On ne garde que les blocs `type === "Image"`. L'URL d'image est extraite par
  `pickImageUrl()` (robuste à la forme exacte de l'objet image, préfère la plus
  grande résolution).
- Channel actuel : `paintings_references` (~467 images, **privé**).

**Cosmos** : outil de capture quotidien principal de l'utilisateur, mais **pas d'API
officielle**. Le transfert Cosmos → are.na est **manuel** (export ZIP d'un cluster,
ou double-enregistrement au moment de sauver). Hors périmètre de l'app elle-même.

---

## 5. Fonctionnalités actuelles

### Gestes (aucun bouton)
- **Pincer** → zoom (et déplacement quand l'image est zoomée). Molette = zoom sur ordinateur.
- **Double-tap** → valider « j'ai dessiné aujourd'hui ».
- **Appui long** → « déjà dessinée avant » : exclut l'image définitivement et en sert une autre.
- Pas d'action au tap simple (pour ne pas gêner le double-tap).

### Verrou journalier (mode réel)
- Une image par jour, **stable** tant qu'elle n'est pas validée (on ne peut pas la « sauter »).
- Choix déterministe par date (même image toute la journée, même après rechargement).
- Après validation → écran « Dessiné » jusqu'au lendemain.
- Les images validées **ou** écartées quittent la rotation définitivement.

### Modes de test (paramètres d'URL)
- `?test=1` → **désactive le verrou** : chaque geste enchaîne une nouvelle image
  aléatoire, **sans rien consommer** (pour vérifier gestes/animations sur plusieurs images).
- `?reset=1` → efface la mémoire locale (`drawn`, `lastDone`, `todayPick`, `seenHint`).

### États / panneaux
`loading` (avec motion), `stage` (image), `done` (dessiné du jour), `empty` (pool épuisée), `error`.

### Persistance
`localStorage` : `drawn` (ids exclus), `lastDone` (date), `todayPick` (image du jour), `seenHint`.

---

## 6. Langage de design

- **Esthétique galerie**, façon Photos iOS. Fond quasi-noir, l'image en `contain`
  (jamais rognée — essentiel pour dessiner).
- Couleurs : fond `#0A0A0B`, encre `#EDEAE3` (blanc cassé chaud), gris sourd `#6B6A66`,
  filet `rgba(237,234,227,0.12)`.
- Typo : **Fraunces** (serif à caractère, pour les rares titres) + **Space Mono**
  (utilitaire, pour les micro-textes). Chargées via Google Fonts.
- **Signature** : les retours de gestes en **lumière pure sur le noir** (anneau + coche
  à la validation, fondu à l'écart). Aucune couleur d'UI ailleurs.
- `prefers-reduced-motion` respecté. Zones de sécurité iOS (`env(safe-area-inset-*)`) gérées.
- Ton des textes : sobre, français, **sans CTA**.

---

## 7. Feuille de route — ordre par priorité (du plus important au détail)

`[x]` = fait · `[~]` = en cours · `[ ]` = à faire.

1. **[x] Format mobile iPhone 15, images au plus grand.** *(fait & poussé)* Cible unique : iPhone 15
   (~393×852 pt, écran ~2,17:1). Image maximisée **mais jamais rognée** (c'est une
   référence de dessin). Plein écran en unités dynamiques (`dvw`/`dvh`). Les grandes
   marges noires des paysages seront réglées par la **rotation** (point 4), pas par du rognage.
2. **[x] Zéro texte.** *(fait & poussé)* Supprimer TOUT texte d'interface : « Chargement… », états
   (« Dessiné », « Tout est dessiné »), messages d'erreur, indice de gestes, légendes de
   feedback. Tout devient visuel. **Exceptions (seules occurrences de texte) : les 2 CTA de
   l'écran de première utilisation (point 3) et la citation-récompense (point 6).**
3. **[x] Écran de première utilisation (choix de la 1re image).** *(fait & poussé)* Au tout premier lancement,
   deux petits **CTA texte** en linéale sobre : **« seed »** (chaque clic tire une nouvelle
   image candidate) et **« valider »** (verrouille l'image de départ, puis bascule dans le
   mode définitif : **tirage aléatoire, une image par jour** — verrou 1/jour conservé, confirmé).
   Ne réapparaît jamais ensuite (sauf `?reset=1`). Détail dans PLAN.md.
4. **[x] Rotation des images paysage.** *(fait & poussé)* Tourner 90° les images au format paysage pour les
   afficher au plus grand ; l'utilisateur tourne physiquement le téléphone pour les dessiner.
5. **[ ] Fond teinté par la dominante colorimétrique** de l'image, affiché au **double-tap**
   (validation). Calcul côté navigateur si le CDN are.na autorise la lecture des pixels,
   sinon côté serveur (`/api`). Voie robuste.
6. **[ ] Citation-récompense** posée sur ce fond teinté (remplace l'ancien texte « à demain »).
   **L'utilisateur fournit sa propre pool** (déjà produite ailleurs) — ne pas en écrire soi-même.
   Cadence : **une par jour** (« citation du jour »), liée à la date.
7. **[ ] Icône d'app** (`apple-touch-icon` 180×180 + manifeste 512). Marque minimale sur
   noir profond. À designer.
8. **[ ] Motion de chargement** évoquant le trait qui se dessine. À designer.

**Plus tard** : Vercel Cron 1×/jour (~6 h Paris, exprimé en **UTC**) pour une tâche matinale
/ notifications. Non critique (l'image du jour est calculée côté app).

---

## 8. Décisions & garde-fous

- **Vercel plutôt que Cloudflare** : consolidation sur une plateforme déjà maîtrisée.
  Le gratuit couvre tout (statique + fonction + cron 1×/jour), usage perso uniquement.
- **Backend obligatoire** pour un channel are.na privé : le jeton reste côté serveur.
- **API are.na v3** impérativement (la v2 renvoie 401 avec les jetons actuels).
- **Citations** : le régime « usage perso » de Vercel est commercial, il ne donne aucun
  droit d'auteur. Rester sur domaine public + lignes originales + liste fournie par l'utilisateur.
- **Minimalisme** non négociable : pas de boutons, pas de CTA, l'image d'abord.

---

## 9. Déploiement & test

- Push sur `main` → Vercel déploie automatiquement.
- Vérifier le backend : `https://<projet>.vercel.app/api/data` doit renvoyer `{"count":467,...}`.
- Vérifier l'app : `https://<projet>.vercel.app/` affiche une peinture plein écran.
- Parcourir plusieurs images : ajouter `?test=1`.
- Repartir de zéro : `?reset=1`.
- Sur iPhone : ouvrir dans Safari → Partager → « Sur l'écran d'accueil » pour une vraie app.
