# Structure en DBML — widget Grist

Widget personnalisé Grist, conforme au Système de design de l'État (DSFR), qui montre la structure du document où il est installé et la convertit en [DBML](https://dbml.dbdiagram.io/docs/).

Quatre pages, en plein écran, avec leur barre d'outils juste sous les onglets :

- **Schéma** : tables en cartes, relations de colonne à colonne avec leur cardinalité, disposition automatique (ELK), glisser-déposer mémorisé, zoom, mini-carte, « Aller à une table », exports SVG et PNG ;
- **Tables** : chaque table avec ses colonnes, ses types et ses liens, filtres (relations, formules), export CSV ;
- **Analyse** : ce qui bloquerait l'import DBML (relation vers une table absente, nom invalide, colonne en double) et des informations utiles (tables isolées, formules sans type, tables de synthèse) ;
- **DBML** : le code, à copier, télécharger ou enregistrer dans une colonne du document.

La conversion lit la structure réelle du document : les relations, booléens, dates-heures et formules sont fidèles. Elle corrige les défauts de l'ancienne formule du tableau Conversion-DBML (relations perdues quand un nom de table contient « Int » ou « Date », colonnes fantômes), qui reste testée comme référence dans `tests/`.

## Installation dans Grist

1. Ajoutez un widget à une page : **Ajouter un widget ▸ Personnalisé**, sur n'importe quelle table.
2. Dans le panneau de droite, choisissez **URL personnalisée** et saisissez :

   ```
   https://arthurpanck.github.io/Test-2/
   ```

3. Accordez l'accès **« Accès complet au document »** (nécessaire pour lire la structure).

Le widget mémorise la disposition du schéma dans le document : comme pour tout widget, Grist affiche alors **Enregistrer** dans l'en-tête du widget ; cliquez dessus pour la conserver.

### Enregistrer le DBML dans une cellule

Facultatif : liez la colonne **DBML (destination)** du widget à une colonne de **données** de la table ; le bouton « Enregistrer dans … » de la page DBML y écrit le code de la ligne sélectionnée.

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
- **export SVG et PNG** (thème clair, prêt pour une documentation).

### Pourquoi ce choix technique

| Solution | Licence | Verdict |
|---|---|---|
| Mermaid (version précédente) | MIT | Pas de relation de colonne à colonne, disposition médiocre, aucune interaction |
| React Flow / xyflow (utilisé par ChartDB, Liam ERD) | MIT | Excellent, mais impose React et une étape de compilation |
| AntV X6, JointJS | MIT, MPL-2.0 | Moteurs complets mais lourds ; fonctions avancées de JointJS payantes |
| dbml-renderer (Graphviz) | MIT | Image statique, sans interaction |
| ChartDB, drawDB, Liam ERD, Azimutt | AGPL-3.0, Apache-2.0, MIT | Applications complètes, non intégrables dans un widget |
| **Rendu maison + ELK.js** | EPL-2.0 (ELK) | **Retenu** : sans compilation, rendu DSFR maîtrisé, disposition de qualité grâce aux ports |

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
assets/converter.js   conversion (moteurs strict et corrigé), analyse — sans dépendance
assets/erd.js         visualiseur de schéma (tables, relations, interactions, exports)
assets/erd-geometry.js géométrie du visualiseur (tracés, cardinalités, graphe ELK) — testée sous Node
assets/app.js         interface et intégration Grist (grist-plugin-api)
assets/styles.css     compléments au DSFR
assets/dsfr-icons.css sous-ensemble des icônes DSFR (scripts/build-icons.mjs)
tests/                tests du convertisseur et de l'interface
```

### Tests

```sh
npm test       # convertisseur : comparaison avec la formule Python d'origine (Python 3 requis)
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
