# Audit de structure — widget Grist

Widget personnalisé Grist, conforme au Système de design de l'État (DSFR), qui décrit et audite le document où il est installé : schéma, tables et colonnes, droits d'accès, vues, constats, rapport Word.

L'historique des versions est dans [CHANGELOG.md](CHANGELOG.md).

## Installation dans Grist

1. **Ajouter un widget ▸ Personnalisé**, sur n'importe quelle table.
2. Dans le panneau de droite, **URL personnalisée** : l'adresse d'un commit publié, par exemple
   ```
   https://raw.githack.com/Arthurpanck/Test-2/<commit>/index.html?v=<version>
   ```
   Utilisez toujours l'adresse d'un commit (et non d'une branche) : elle change à chaque version, ce qui garantit que le navigateur charge des fichiers d'une seule et même version.
3. Accordez l'accès **« Accès complet au document »** (nécessaire pour lire la structure et les règles).

Le widget mémorise ses réglages (disposition du schéma, liens et tables affichés, constats « voulus ») dans les options du widget : Grist affiche alors **Enregistrer** dans l'en-tête du widget.

## Ce que fait le widget

Six onglets : décrire le document (Schéma, Tables, Accès, Vues), le diagnostiquer (Analyse), produire (Rapport). **Relire le document** relit tout à la demande.

- **Schéma** — tables en cartes, relations de colonne à colonne avec leur cardinalité, disposition automatique (ELK), glisser-déposer mémorisé, zoom, mini-carte, « Aller à une table », export PNG.
  - Trois vues : **Relations** (clé et colonnes de référence, par défaut), **Colonnes**, **Tables**.
  - Menu **Tables** : tables, tables de synthèse (violet) et tables de droits (rouge, cadenas), affichées ou masquées avec leurs liens.
  - Menu **Liens** : références (par défaut), lookups (`lookupOne` en orange, `lookupRecords` en vert, par défaut) et calculs (colonne calculée → colonnes que sa formule lit, désactivés par défaut).
- **Tables** — une table par carte, au format « Table pour exportation » : colonne, nom affiché, type SQLite, type Grist, rôle (Clé primaire, Donnée, Calculée), calculé ?, formule, documentée ? ; description de la table et des colonnes ; index qui suit le défilement ; export Excel.
- **Accès** — réglages généraux (permissions avancées activées ou non, et les trois cases de Grist : règle ajoutée pour les propriétaires, structure modifiable par les éditeurs, permissions visibles par tous), matrice « Qui peut faire quoi ? » par profil, attributs utilisateur, règles par défaut puis règles de chaque table et de ses colonnes, en clair ; exports Excel.
- **Vues** — widgets non officiels, widgets personnalisés de la galerie (accès, colonnes associées), fiches, graphiques et formulaires par page, tables sans page.
- **Analyse** — un verdict et des constats en quatre niveaux : *À corriger* (ouvert par défaut), *À améliorer*, *Choix à confirmer* (le bouton **C'est voulu** les retire des comptes), *Bon à savoir* ; recherche.
- **Rapport** — rapport Word (.docx) : résumé, schéma (vue Relations, références seules, sans les tables de synthèse), tables et colonnes, vues, analyse (décochée par défaut), droits d'accès, code DBML ; sommaire cliquable ; aperçu identique au fichier.

Les constats sur les données lisent les lignes des tables (un échantillon au-delà de 2 000 lignes par table), à l'ouverture et sur « Relire le document » ; ils portent sur ce que la personne connectée peut voir. La structure vient des métadonnées (`_grist_Tables`, `_grist_Tables_column`, `_grist_Views_section`, `_grist_Views`, `_grist_Pages`), les droits de `_grist_ACLResources` et `_grist_ACLRules`.

## Architecture

Aucune étape de compilation : `index.html` et les modules ES de `assets/` sont servis tels quels. Les bibliothèques externes (ELK pour la disposition, docx pour le Word) sont chargées à la demande.

| Module | Rôle |
|---|---|
| `app.js` | Interface et intégration Grist : lecture du document, état, rendu des onglets, événements |
| `util.js` | Utilitaires communs : échappement HTML, pluriels, comparaison sans accents, dates, colonnes techniques, JSON, métadonnées |
| `theme.js` | **Seule source des couleurs et polices** des documents (Word, exports, tables et liens du schéma), posées en variables CSS `--doc-*` |
| `python-text.js` | **Seul lecteur des formules Python** : commentaires, chaînes et f-strings, parenthèses, arguments, `$Colonne`, appels de lookups |
| `acl-model.js` | **Seul modèle des droits** : lecture des règles, permissions, attributs, conditions (analyse fermée, sans exécution), droit effectif d'un rôle |
| `converter.js` | Lecture des métadonnées, conversion en DBML, statistiques |
| `converter-code.js` | Portage strict de l'ancienne formule Python et Vue du code (tests de parité ; non chargé par le widget) |
| `access.js` | Onglet Accès : règles en clair, réglages généraux, constats sur les droits |
| `rights-matrix.js` | Matrice « Qui peut faire quoi ? » (évaluation des conditions par profil) |
| `table-format.js`, `types.js` | Présentation des tables et des types de colonnes |
| `lookups.js`, `formula-deps.js` | Liens de formule : lookups, colonnes lues par les calculs |
| `insights.js`, `datacheck.js`, `audit-engine.js`, `usage-audit.js`, `filter-audit.js`, `pages.js` | Constats de l'onglet Analyse : structure, données, contrôles du catalogue, usages, filtres, vues |
| `audit-catalog.js` | Les contrôles retenus (textes, niveaux). Le registre complet des décisions est dans `tests/audit-decisions.mjs` |
| `report.js` | Rapport : sections, aperçu HTML, rendu Word |
| `erd.js`, `erd-geometry.js` | Visualiseur de schéma ; géométrie (tracés, cardinalités, graphe ELK), testée sous Node |
| `tables-export.js`, `rights-export.js`, `xlsx.js` | Exports Excel |
| `styles.css`, `dsfr-icons.css` | Compléments au DSFR ; sous-ensemble des icônes (`npm run build:icons`) |

## Développement

```sh
npm ci                      # dépendances de développement (docx, jszip, prettier)
npm test                    # tests unitaires (convertisseur, droits, formules, analyse, rapport, exports)
npm run test:ui -- captures/    # interface dans Chromium (Playwright), Grist simulé
npm run test:erd -- captures/   # visualiseur de schéma : disposition, liens, glisser, zoom, exports
npm run test:deployed -- <url du widget> captures/ [fixture.json]   # version publiée
npm run format              # mise en forme (Prettier) ; npm run lint pour vérifier
```

Les tests unitaires sont dans `tests/` (un fichier par module) ; `tests/revues/` garde les arbitrages des revues des constats (niveaux, formulations, retraits), et `tests/removed-findings.test.mjs` fait tourner toute l'analyse sur chaque document de `tests/fixtures/` pour vérifier qu'aucun constat retiré ne réapparaît.

Le test de parité exécute l'ancienne formule Python (`tests/reference/grist_dbml_reference.py`, Python 3 requis) sur plus de 3 000 entrées et vérifie que `converter-code.js` produit exactement la même sortie.

### Publier une version

1. `npm run version -- 3.x.y` : met à jour `package.json` et le paramètre `?v=` de `index.html` (les modules internes n'en portent pas : le numéro est à un seul endroit).
2. Ajouter la section de la version en tête de `CHANGELOG.md`.
3. `npm test`, `npm run lint`, puis commit et push.
4. Dans Grist, pointer le widget vers `https://raw.githack.com/Arthurpanck/Test-2/<commit>/index.html?v=3.x.y` (accès complet).

## Licences et crédits

- Formule de conversion d'origine : [grist-db-parser](https://github.com/arnaud-robin/grist-db-parser) (Arnaud Robin), adaptée dans le document Conversion-DBML.
- Page Accès inspirée du widget [tables-et-permissions](https://github.com/jtab87/grist-plugins/tree/main/tables-et-permissions).
- [DSFR](https://www.systeme-de-design.gouv.fr/) v1.15.4 — usage réservé aux services de l'État (voir ses conditions d'utilisation).
- [ELK.js](https://github.com/kieler/elkjs) (EPL-2.0) pour la disposition du schéma, [docx](https://github.com/dolanmiu/docx) (MIT) pour le rapport Word.
