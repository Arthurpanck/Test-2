# Structure en DBML — widget Grist

Widget personnalisé Grist, conforme au Système de design de l'État (DSFR), qui convertit la structure d'un document Grist en [DBML](https://dbml.dbdiagram.io/docs/) pour l'ouvrir dans [dbdiagram.io](https://dbdiagram.io/d) ou tout autre éditeur DBML.

Il reprend exactement le traitement du tableau Grist **Conversion-DBML** (formule Python basée sur [grist-db-parser](https://github.com/arnaud-robin/grist-db-parser) d'Arnaud Robin), et y ajoute :

- **la lecture directe de la structure du document** : plus besoin de copier-coller la Vue du code ;
- **une analyse** qui signale les défauts de la formule d'origine et ce qui empêcherait l'import ;
- **une conversion corrigée**, en option ;
- un aperçu des tables et un **schéma entité-relation** (Mermaid), téléchargeable en SVG ;
- copie, téléchargement `.dbml`, ouverture de dbdiagram.io, enregistrement dans une colonne.

## Installation dans Grist

1. Ajoutez un widget à une page : **Ajouter un widget ▸ Personnalisé**, sur n'importe quelle table.
2. Dans le panneau de droite, choisissez **URL personnalisée** et saisissez :

   ```
   https://arthurpanck.github.io/Test-2/
   ```

3. Accordez l'accès **« Accès complet au document »** (nécessaire pour lire la structure).

Les réglages (mode strict, source, code collé) sont enregistrés avec le widget dans le document.

### Reproduire l'usage du tableau Conversion-DBML

Le widget peut lire et écrire des cellules, comme le document d'origine :

| Colonne du widget | Rôle |
|---|---|
| **Code Grist (source)** | colonne contenant le texte de la Vue du code ; lue sur la ligne sélectionnée en mode « Code collé » |
| **DBML (destination)** | colonne de **données** où le bouton « Enregistrer dans … » écrit le DBML |

Les deux liaisons sont facultatives.

## Utilisation

- **Ce document** : la structure est lue dans les métadonnées (`_grist_Tables`, `_grist_Tables_column`) et la Vue du code est reconstituée à l'identique (même ordre des tables et des colonnes, mêmes types, tables de synthèse, références bidirectionnelles). « Modifier comme code » copie ce code dans l'onglet « Code collé ».
- **Code collé** : collez le contenu de **Vue du code** (panneau de gauche de Grist).
- **Reproduire exactement la formule d'origine** (activé par défaut) : la sortie est identique, octet par octet, à celle de la formule. Désactivé, la conversion corrige les défauts listés ci-dessous.

## Défauts de la formule d'origine (corrigés en option)

| Défaut | Exemple | Effet |
|---|---|---|
| Types détectés par sous-chaîne | `grist.ReferenceList('Interventions')` contient « Int » | colonne `integer`, **relation perdue** |
| | `grist.Reference('Dates_cles')` contient « Date » | colonne `date`, relation perdue |
| Booléens non reconnus | `grist.Bool()` | `varchar` au lieu de `boolean` |
| Date-heure confondue avec date | `grist.DateTime('Europe/Paris')` | `date` au lieu de `timestamp` |
| `def` dans le corps d'une formule | fonction utilitaire dans une formule | **colonne fantôme** |
| `class X:` dans un texte multiligne | chaîne contenant `class Brouillon:` | **table fantôme**, et les colonnes suivantes changent de table |
| Décorateur orphelin | `@grist.formulaType` suivi d'une fonction exclue | type appliqué à la mauvaise colonne |

L'onglet **Analyse** liste ces écarts pour le document courant, avec un lien vers la ligne du DBML et du code concernées, ainsi que les erreurs qui bloqueraient l'import (relation vers une table absente, nom invalide, colonne en double).

## Développement

Aucune étape de compilation : `index.html` et les modules de `assets/` sont servis tels quels.

```
assets/converter.js   conversion (moteurs strict et corrigé), analyse, Mermaid — sans dépendance
assets/app.js         interface et intégration Grist (grist-plugin-api)
assets/styles.css     compléments au DSFR
assets/dsfr-icons.css sous-ensemble des icônes DSFR (scripts/build-icons.mjs)
tests/                tests du convertisseur et de l'interface
```

### Tests

```sh
npm test       # convertisseur : comparaison avec la formule Python d'origine (Python 3 requis)
npm run test:ui -- captures/   # interface dans Chromium (Playwright), Grist simulé
```

Le test différentiel exécute la formule d'origine (`tests/reference/grist_dbml_reference.py`, copiée du document) sur plus de 3 000 entrées — fixtures, cas limites et Vues du code générées aléatoirement — et vérifie que le portage JavaScript produit exactement la même sortie ou la même erreur.

## Licences et crédits

- Formule de conversion : [grist-db-parser](https://github.com/arnaud-robin/grist-db-parser) (Arnaud Robin), adaptée dans le document Conversion-DBML.
- [DSFR](https://www.systeme-de-design.gouv.fr/) v1.15.4 — usage réservé aux services de l'État (voir ses conditions d'utilisation).
- [Mermaid](https://mermaid.js.org/) pour le schéma, chargé à la demande.
