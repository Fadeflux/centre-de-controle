# Centre de contrôle

Poste de pilotage unique : tous les outils du business sur une page, avec voyant
en ligne/hors ligne, chiffres clés en direct et bouton « Ouvrir ». PWA installable.

- `index.html` — la page (autonome, aucune dépendance externe).
- `manifest.json` + `icon.svg` — installation sur téléphone.

## Configuration (en haut de `index.html`)

- `HUB_URL` — adresse du « cerveau » (`/api/hub` de stats-tracker). Vide = mode démo.
- `TOOLS` — la liste des outils (nom, catégorie, `openUrl`, métriques).

Les vrais chiffres et l'état des outils viennent de l'endpoint `/api/hub`
(protégé par le header `x-hub-token`). Sans connexion, la page affiche des
chiffres d'exemple (mode démo).
