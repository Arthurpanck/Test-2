# Structure en DBML — widget Grist

Widget personnalisé Grist, conforme au Système de design de l'État (DSFR), qui montre la structure du document où il est installé et la convertit en [DBML](https://dbml.dbdiagram.io/docs/).

Cinq pages, en plein écran, avec leur barre d'outils juste sous les onglets :

- **Schéma** : tables en cartes, relations de colonne à colonne avec leur cardinalité, disposition automatique (ELK), glisser-déposer mémorisé, zoom, mini-carte, « Aller à une table », export SVG ;
- **Tables** : chaque table avec ses colonnes, ses types et ses liens, filtres (relations, formules), export CSV ;
- **Analyse** : un verdict (« Prêt pour l'import » ou « Le DBML ne s'importera pas encore »), puis chaque constat classé *À corriger*, *À vérifier* ou *Bon à savoir*, avec les éléments concernés, pourquoi c'est important et les étapes pour corriger dans Grist ;
- **DBML** : le code, à copier ou télécharger ;
- **Rapport** : un rapport Word (.docx) qui reprend le résumé, l'image du schéma, les tables et colonnes, l'analyse et le code DBML, avec un aperçu et le choix des sections.

La conversion lit la structure réelle du document : les relations, booléens, dates-heures et formules sont fidèles. Elle corrige les défauts de l'ancienne formule du tableau Conversion-DBML (relations perdues quand un nom de table contient « Int » ou « Date », colonnes fantômes), qui reste testée comme référence dans `tests/`.

## Installation dans Grist

1. Ajoutez un widget à une page : **Ajouter un widget ▸ Personnalisé**, sur n'importe quelle table.
2. Dans le panneau de droite, choisissez **URL personnalisée** et saisissez :

   ```
   https://arthurpanck.github.io/Test-2/
   ```

3. Accordez l'accès **« Accès complet au document »** (nécessaire pour lire la structure).

Le widget mémorise la disposition du schéma dans le document : comme pour tout widget, Grist affiche alors **Enregistrer** dans l'en-tête du widget ; cliquez dessus pour la conserver.

## Utilisation

La structure est lue dans les métadonnées du document (`_grist_Tables`, `_grist_Tables_column`) à l'ouverture, puis à chaque modification de la table du widget ; **Relire le document** la relit à la demande (après l'ajout d'une colonne dans une autre table, par exemple).

## Schéma interactif

L'onglet **Schéma** dessine la base comme dbdiagram.io, aux couleurs du DSFR :

- **tables en cartes** : clé `id`, colonnes et types, icône de relation, `ƒ` pour les formules ; tables de synthèse en violet, tables absentes du schéma en pointillés ;
- **relations de colonne à colonne**, tracées à angles droits arrondis, avec leur cardinalité : patte d'oie côté « plusieurs », barre côté « un » ;
- **disposition automatique** par [ELK](https://eclipse.dev/elk/) (algorithme en couches qui tient compte de la ligne exacte d'où part chaque relation), **Réorganiser** pour la recalculer ;
- **glisser les tables** (souris ou flèches du clavier) : la disposition est mémorisée avec le widget ;
- **survol ou clic** sur une table, une colonne ou une relation : ses liens sont mis en évidence, le reste s'estompe ;
- **zoom** (molette, boutons, touches `+` `-` `0`), **mini-carte** pour les grands schémas, **Aller à une table** ;
- trois niveaux de détail : **Colonnes**, **Relations** (clés seulement), **Tables** ;
- **export SVG** (thème clair, prêt pour une documentation) ; l'image PNG du schéma est intégrée au rapport Word.

### Pourquoi ce choix technique

| Solution | Licence | Verdict |
|---|---|---|
| Mermaid (version précédente) | MIT | Pas de relation de colonne à colonne, disposition médiocre, aucune interaction |
| React Flow / xyflow (utilisé par ChartDB, Liam ERD) | MIT | Excellent, mais impose React et une étape de compilation |
| AntV X6, JointJS | MIT, MPL-2.0 | Moteurs complets mais lourds ; fonctions avancées de JointJS payantes |
| dbml-renderer (Graphviz) | MIT | Image statique, sans interaction |
| ChartDB, drawDB, Liam ERD, Azimutt | AGPL-3.0, Apache-2.0, MIT | Applications complètes, non intégrables dans un widget |
| **Rendu maison + ELK.js** | EPL-2.0 (ELK) | **Retenu** : sans compilation, rendu DSFR maîtrisé, disposition de qualité grâce aux ports |

## Rapport Word adaptatif

Le rapport est décrit une seule fois, puis rendu deux fois : en aperçu HTML dans la page Rapport et en fichier Word (bibliothèque [docx](https://docx.js.org/), chargée à la demande).

- **Sections** : `REPORT_SECTIONS` dans `assets/report.js`. Chaque section renvoie des blocs neutres (titre, paragraphe, chiffres clés, encadré, tableau, image, liste, code). Ajouter, retirer ou réordonner une section met à jour à la fois le bouton de sélection, l'aperçu et le Word.
- **Contenu** : les constats viennent de `assets/insights.js`, la même source que la page Analyse ; l'image est le schéma tel qu'il est disposé à l'écran.
- **Charte** : couleurs et polices sont lues dans les variables CSS `--doc-*` de `assets/styles.css` (police, couleur principale, couleurs des types, des clés, des niveaux…). Modifier ces variables change l'aperçu, le fichier Word et l'export SVG du schéma, sans toucher au code.

## Défauts de l'ancienne formule, corrigés par le widget

| Défaut | Exemple | Effet |
|---|---|---|
| Types détectés par sous-chaîne | `grist.ReferenceList('Interventions')` contient « Int » | colonne `integer`, **relation perdue** |
| | `grist.Reference('Dates_cles')` contient « Date » | colonne `date`, relation perdue |
| Booléens non reconnus | `grist.Bool()` | `varchar` au lieu de `boolean` |
| Date-heure confondue avec date | `grist.DateTime('Europe/Paris')` | `date` au lieu de `timestamp` |
| `def` dans le corps d'une formule | fonction utilitaire dans une formule | **colonne fantôme** |
| `class X:` dans un texte multiligne | chaîne contenant `class Brouillon:` | **table fantôme**, et les colonnes suivantes changent de table |
| Décorateur orphelin | `@grist.formulaType` suivi d'une fonction exclue | type appliqué à la mauvaise colonne |

Le moteur « strict », qui reproduit cette formule à l'identique, n'est plus proposé dans l'interface : il sert d'oracle aux tests (`tests/converter.test.mjs`).

## Développement

Aucune étape de compilation : `index.html` et les modules de `assets/` sont servis tels quels.

```
assets/converter.js   conversion (moteurs strict et corrigé) — sans dépendance
assets/insights.js    constats de la page Analyse et du rapport (libellés, étapes de correction)
assets/report.js      rapport : sections, aperçu HTML, rendu Word, charte (--doc-*)
assets/erd.js         visualiseur de schéma (tables, relations, interactions, exports)
assets/erd-geometry.js géométrie du visualiseur (tracés, cardinalités, graphe ELK) — testée sous Node
assets/app.js         interface et intégration Grist (grist-plugin-api)
assets/styles.css     compléments au DSFR
assets/dsfr-icons.css sous-ensemble des icônes DSFR (scripts/build-icons.mjs)
tests/                tests du convertisseur et de l'interface
```

### Tests

```sh
npm ci         # dépendances de test (docx, jszip)
npm test       # convertisseur (comparaison avec la formule Python d'origine, Python 3 requis), géométrie, rapport Word
npm run test:ui -- captures/   # interface dans Chromium (Playwright), Grist simulé
npm run test:erd -- captures/  # visualiseur de schéma : disposition, relations, glisser, zoom, exports
npm run test:deployed -- <url du widget> captures/  # version publiée, métadonnées réelles d'un document

# Aperçu d'une branche avant fusion (ne pas utiliser en production) :
# https://raw.githack.com/Arthurpanck/Test-2/<branche>/index.html
```

Le test différentiel exécute la formule d'origine (`tests/reference/grist_dbml_reference.py`, copiée du document) sur plus de 3 000 entrées — fixtures, cas limites et Vues du code générées aléatoirement — et vérifie que le portage JavaScript produit exactement la même sortie ou la même erreur.

## Licences et crédits

- Formule de conversion : [grist-db-parser](https://github.com/arnaud-robin/grist-db-parser) (Arnaud Robin), adaptée dans le document Conversion-DBML.
- [DSFR](https://www.systeme-de-design.gouv.fr/) v1.15.4 — usage réservé aux services de l'État (voir ses conditions d'utilisation).
- [ELK.js](https://github.com/kieler/elkjs) (Eclipse Layout Kernel, EPL-2.0) pour la disposition automatique du schéma, chargé à la demande.
- [docx](https://github.com/dolanmiu/docx) (MIT) pour le rapport Word, chargé à la demande.
