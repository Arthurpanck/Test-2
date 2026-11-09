# Bibliothèques copiées dans le widget

Ces fichiers sont ceux publiés sur npm par leurs auteurs, **sans retouche** (déjà minifiés quand ils le sont à la source).
Ils sont copiés ici pour que le widget fonctionne sans CDN : il ne dépend que de l'endroit où il est publié,
et de `grist-plugin-api.js`, servi par Grist lui-même (il doit suivre la version de Grist).

| Dossier | Paquet | Version | Rôle | Licence |
|---|---|---|---|---|
| `dsfr/` | [@gouvfr/dsfr](https://www.npmjs.com/package/@gouvfr/dsfr/v/1.15.4) | 1.15.4 | Système de design de l'État : styles, polices Marianne et Spectral, icônes | `LICENSE.md` |
| `elkjs/` | [elkjs](https://www.npmjs.com/package/elkjs/v/0.12.0) | 0.12.0 | Disposition automatique du schéma (moteur dans un Web Worker, repli sur le fil principal) | `LICENSE.md` |
| `docx/` | [docx](https://www.npmjs.com/package/docx/v/9.10.0) | 9.10.0 | Export Word du rapport (chargé au premier export) | `LICENSE` |

Le DSFR n'est copié qu'en partie : la feuille de style principale, ses polices, les icônes qu'elle appelle et celles
utilisées par le widget (liste dans `scripts/vendor.mjs`, règles CSS générées dans `assets/dsfr-icons.css`).

**Ne pas modifier ces fichiers à la main.** Pour changer de version : modifier `LIBS` dans `scripts/vendor.mjs`,
lancer `npm run vendor`, vérifier le widget (`npm run test:ui`, `npm run test:erd`, un export Word), puis
noter le changement dans `CHANGELOG.md`.
