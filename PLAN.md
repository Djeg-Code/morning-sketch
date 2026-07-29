# PLAN.md — Consignes d'implémentation pour Claude Code

> À lire avec `CLAUDE.md` (qui porte tout le contexte). **Faire UNE étape à la fois**,
> sur demande explicite. Après chaque étape : cocher la case dans `CLAUDE.md`, commit, push.
> Ne pas anticiper les étapes suivantes.
>
> Légende : **(D)** = décision à confirmer · **(A)** = asset fourni par l'utilisateur.

---

## Étape 1 — Format iPhone 15, image au plus grand — ✅ FAIT & POUSSÉ
- Plein écran réel `dvw`/`dvh`, image maximisée **jamais rognée**, full-bleed, fond `#0A0A0B`.
- Rotation des paysages traitée séparément (étape 4) ; marges noires des paysages normales ici.

## Étape 2 — Zéro texte
Retirer **tout** texte d'interface. Le remplacer par du purement visuel :
- Chargement : garder seulement le motion (`#load-mark`), retirer « Chargement… ».
- Validation (double-tap) : garder l'anneau + la coche en lumière, **sans** légende (`#fxcap`).
- État « dessiné aujourd'hui » : écran sombre vide pour l'instant (il accueillera le fond
  teinté + la citation aux étapes 5–6).
- Appui long : garder le fondu d'image, sans légende.
- Pool épuisée / erreur : un signe visuel discret (petit point/marque) au lieu de texte.
- **Exceptions autorisées — les SEULES occurrences de texte dans toute l'app** :
  1. Les deux petits CTA de l'écran de première utilisation (« seed » + valider — étape 3).
  2. La citation-récompense (étape 6).

## Étape 3 — Écran de première utilisation (choix de la première image) — confirmé
Au **tout premier lancement uniquement** (flag `firstPicked` absent). Écran piloté par deux
petits **CTA texte**, en **linéale simple et élégante** (sans-serif neutre, discret,
minuscules), posés sobrement par-dessus l'image :
- **CTA « seed »** : à chaque clic, tire et affiche une **nouvelle image candidate** au
  hasard, **jamais déjà vue pendant cette sélection** (ensemble `seedSeen`) et jamais déjà
  dessinée. L'utilisateur clique jusqu'à obtenir l'image qu'il veut comme toute première.
- **CTA « valider »** : verrouille l'image affichée comme **première image du rituel**,
  enregistre `firstPicked=true`, puis **bascule dans le mode définitif : tirage aléatoire,
  une image par jour** (verrou 1/jour conservé — confirmé).
- ⚠️ Ce « valider » = « c'est mon image de départ » ; à NE PAS confondre avec le double-tap
  « j'ai dessiné » du mode normal. Après validation on passe en mode normal, cette image
  devenant l'image du jour (que l'utilisateur dessine puis valide au double-tap).
- Cet écran ne réapparaît jamais ensuite (sauf `?reset=1`, qui efface `firstPicked`).
- But : démarrer sur une image nette et forte, mettre l'app en valeur.

## Étape 4 — Rotation des images paysage
- Si l'image chargée est au format paysage (`naturalWidth > naturalHeight`), la faire
  pivoter de **90°** pour l'afficher au plus grand sur l'écran portrait (l'utilisateur
  tourne physiquement le téléphone pour dessiner).
- Intégrer la rotation comme **transformation de base** composée AVEC le zoom/déplacement,
  pour que les gestes (pincer, déplacer) fonctionnent dans le repère tourné.
- Recalculer l'ajustement après rotation (dimensions effectives inversées).
- Portrait / carré : inchangé.

## Étape 5 — ~~Fond teinté par la dominante~~ **ABANDONNÉE**
- Idée de fond coloré par la dominante **abandonnée** (jugée peu élégante). **Ne rien
  calculer** : pas de canvas, pas de couleur extraite, pas de `mix-blend-mode`. Si du code de
  dominante a déjà été ajouté (étape 5 précédente), **le retirer**.
- L'écran de récompense a un **fond fixe `#16161D`** à chaque fois (voir étape 6).

## Étape 6 — Citation-récompense **(A — fourni : citations.md)**
- Fichier fourni par l'utilisateur : **`citations.md` à la racine du dépôt** (~400+ citations).
  Format d'une ligne : `N. « citation » — Auteur` (guillemets français `« »`, séparées par
  des lignes vides).
- **Parsing** : pour chaque ligne non vide, extraire le texte entre `«` et `»` (la citation),
  puis, après le dernier `»`, l'auteur (retirer le « — » de tête). Construire un tableau
  `[{ text, author }]` (ou générer un `citations.json` au build). Ne pas modifier les textes.
- **Écran de récompense** (après double-tap « j'ai dessiné ») : **fond fixe `#16161D`**,
  une citation seule + auteur, **texte blanc** (pas de blend, pas de teinte).
- **Typographie** :
  - Citation : **slab serif moderne et très design** (recommandé : **Zilla Slab**, ou Roboto
    Slab / Bitter en variantes ; charger via Google Fonts). **Petite et élégante, ≤ 12px**,
    blanc, interligne aéré.
  - Auteur : **ferré à droite, en bas du bloc de citation** (comme une signature), plus petit,
    légèrement atténué (opacité ~0.7).
  - Bloc centré à l'écran, largeur max confortable ; citation alignée à gauche dans le bloc,
    auteur aligné à droite en dessous.
- **Attribution (unicité)** : la citation n'est PAS choisie par date, mais **assignée à
  l'image**. À la validation du seed (premier lancement), générer un **ordre de citations
  mélangé** persistant (`citationOrder` + `citationCursor`). Quand une image est dessinée,
  lui attribuer la **prochaine citation non utilisée** (`citationFor[imageId]`, persistant)
  → chaque citation n'apparaît **qu'une seule fois**, exactement comme les images. La
  récompense affiche la citation assignée à l'image dessinée (stable). Si les citations
  s'épuisent (images > citations), remélanger un nouveau cycle. En test : même mécanisme.
- ⚠️ Exception assumée au « zéro texte » (avec les 2 CTA de l'étape 3).

## Étape 7 — Icône d'app **(A)** — à clarifier quand atteint
- `apple-touch-icon` 180×180 + manifeste (icône 512) + `<link>`/manifest dans `index.html`.
- **(A)** Fichiers d'icône fournis ; Claude Code n'a qu'à les intégrer.

## Étape 8 — Motion de chargement **(A)** — à clarifier quand atteint
- Remplacer le placeholder (`#load-mark`) par un motion évoquant le **trait qui se dessine**.
- **(A)** SVG/CSS fourni.

---

### Rappels transverses
- UI en français, **minimalisme absolu**, aucun bouton/CTA hors les 2 exceptions (étape 3)
  et la citation (étape 6).
- Persistance via `localStorage` (`drawn`, `lastDone`, `todayPick`, `seenHint`, `firstPicked`,
  `citationOrder`, `citationCursor`, `citationFor`).
- ⚠️ **Invariant anti-répétition (crucial)** : une image validée OU passée (appui long) entre
  dans `drawn` et ne réapparaît **plus jamais** (aucun mode). TOUTE sélection (image du jour,
  test, candidats seed) puise dans `available()` = ALL − `drawn`. En test et en seed, suivre
  en plus un ensemble « déjà vues » de session pour ne pas répéter pendant l'essai. Les
  citations suivent la même règle via l'attribution (étape 6).
- ⚠️ **Mode test à CONSERVER en permanence** (exigence utilisateur) : `?test=1` = **aucun
  verrou journalier**, on enchaîne les images pour vérifier le comportement — outil parallèle
  à la fonctionnalité finale (1 image/jour), jamais un remplacement. `?reset=1` = efface la
  mémoire locale, y compris `firstPicked` (pour revoir l'écran de seed).
- Après chaque étape, mettre à jour la case correspondante dans `CLAUDE.md`.
