# Audit de structure — widget Grist

Widget personnalisé Grist, conforme au Système de design de l'État (DSFR), qui audite le document où il est installé : structure, formules, droits d'accès, conversion en [DBML](https://dbml.dbdiagram.io/docs/) et rapport Word.

Six pages, en plein écran, dans cet ordre : décrire le document (Schéma, Tables, Accès, Widgets), le diagnostiquer (Analyse), produire (Rapport). Les onglets et le bouton « Relire le document » partagent la même ligne ; la barre d'outils de chaque page est juste dessous.

- **Schéma** : tables en cartes, relations de colonne à colonne avec leur cardinalité, disposition automatique (ELK), glisser-déposer mémorisé, zoom, « Aller à une table », export SVG ;
- **Tables** : chaque table avec son nombre de lignes, ses colonnes, leur type (libellés de Grist) et leurs liens ; formules, formules d'initialisation et leur déclenchement, choix, listes filtrées et descriptions ; export CSV ;
- **Accès** : les règles d'accès avancées en clair — réglages généraux, attributs utilisateur, règles par défaut, puis les règles de chaque table et de ses colonnes, avec « Autorisé / Refusé » par permission et les messages de refus ; filtre et export CSV ;
- **Widgets** : les widgets autres que les tableaux (comptés mais pas détaillés). D'abord les **widgets non officiels** — ajoutés par leur adresse ou créés dans le document — avec leur origine, l'accès accordé et l'adresse ; puis les **widgets personnalisés** de la galerie Grist, réduits à l'accès et à la liste des colonnes associées (« champ attendu → colonne », champs encore à associer en rouge) ; puis les fiches, listes de fiches, graphiques et formulaires par page ; enfin les pages qui ne contiennent que des tableaux et les tables affichées sur aucune page ;
- **Analyse** : un verdict, puis les constats sur la structure, les données et les droits d'accès, en quatre niveaux :
  - *À corriger* — ne fonctionne pas comme prévu (lien vers une table introuvable, condition sur un attribut inexistant, copie non protégée d'une table protégée…) ;
  - *À améliorer* — fonctionne, mais une bonne pratique éviterait des erreurs (liens écrits à la main au lieu d'une référence, nombres / dates / oui-non saisis en texte, valeurs répétées sans liste de choix, valeurs hors liste, noms par défaut, e-mails écrits dans les règles…) ;
  - *Choix à confirmer* — souvent volontaire (formule « Non défini », table isolée, table vide, colonne jamais remplie, table très large, tables en double, table sans règle propre…) : chaque carte dit « Si c'est voulu » et « Sinon, dans Grist » ; le bouton **C'est voulu** retire le point des comptes (mémorisé dans le widget) ;
  - *Bon à savoir*.
- **Rapport** : un rapport Word (.docx) qui reprend tout, avec un sommaire cliquable, un aperçu et le choix des sections ;

Les constats sur les données lisent les lignes des tables (pas des synthèses) à l'ouverture et sur « Relire le document » ; ils portent sur ce que la personne connectée peut voir.

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

La structure est lue dans les métadonnées du document (`_grist_Tables`, `_grist_Tables_column`, `_grist_Views_section`, `_grist_Views`, `_grist_Pages`) et les règles d'accès dans `_grist_ACLResources` et `_grist_ACLRules`, à l'ouverture puis à chaque modification de la table du widget ; **Relire le document** les relit à la demande. Seuls les propriétaires (ou les personnes autorisées à voir les règles) peuvent lire les règles d'accès : pour les autres, la page Accès l'indique.

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

## Droits d'accès : reprise de « Tables et permissions »

La page **Accès** reprend le rapport du widget [tables-et-permissions](https://github.com/jtab87/grist-plugins/tree/main/tables-et-permissions) (tables, formules, choix, conditions de liste, règles d'accès) et l'améliore :

| Widget d'origine | Ici |
|---|---|
| Permissions brutes (`+R-CD`) colorées | Une colonne par permission : Lire, Modifier, Créer, Supprimer, Structure, « Autorisé / Refusé / — » |
| Conditions affichées telles quelles | Traduites quand la forme est connue (« Éditeurs et propriétaires », « Personnes dont Habilitation.Role vaut RH »…), formule gardée dessous |
| Règles triées par chaîne (`table + colonnes + rulePos`) : « 10 » avant « 9 » | Ordre réel d'application (`rulePos` numérique) |
| Règles par défaut (`*`) et réglages spéciaux mélangés aux tables | Sections distinctes : réglages généraux, attributs utilisateur, règles par défaut |
| Nom de la première table jamais affiché | Une carte par table, liée à ses colonnes et au schéma |
| Colonnes de déclenchement : la première colonne du document ignorée (`indexOf > 0`) | Déclenchement en clair (« aux nouvelles lignes et quand cette colonne change : Statut ») |
| Texte des formules inséré sans échappement HTML | Tout est échappé |
| Export HTML | Export CSV et rapport Word |
| — | Contrôles : attribut ou colonne introuvable, condition sur un attribut inexistant, éditeurs pouvant contourner les restrictions de lecture par formule, copie complète ouverte à tous, adresses e-mail écrites dans les règles, refus sans message, tables sans règle propre |

Grist refuse d'enregistrer une règle sur une colonne inexistante ou placée après la règle « Tous les autres » ; les contrôles du widget couvrent ce qui se casse ensuite (suppression, renommage) et ce que Grist accepte sans le vérifier (attribut `user.X` inconnu).

## Rapport Word adaptatif

Le rapport est décrit une seule fois, puis rendu deux fois : en aperçu HTML dans la page Rapport et en fichier Word (bibliothèque [docx](https://docx.js.org/), chargée à la demande).

- **Sections** : `REPORT_SECTIONS` dans `assets/report.js`. Chaque section renvoie des blocs neutres (titre, paragraphe, chiffres clés, encadré, tableau, image, liste, code). Ajouter, retirer ou réordonner une section met à jour à la fois le bouton de sélection, l'aperçu et le Word.
- **Table des matières** : titres numérotés (1., 1.1…), points de conduite et numéros de page (champs PAGEREF, que Word propose de mettre à jour à l'ouverture) ; chaque titre reçoit un signet ; le sommaire, placé après le titre, renvoie vers ces signets (liens internes dans le Word, ancres dans l'aperçu). Il est construit à partir des sections retenues.
- **Contenu** : les constats viennent de `assets/insights.js`, la même source que la page Analyse ; l'image est le schéma tel qu'il est disposé à l'écran.
- **Police** : Calibri 11 (variable `--doc-font`).
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
assets/access.js      droits d'accès : lecture des règles, conditions en clair, contrôles
assets/types.js       libellés français des types de colonnes, détails (formules, choix…)
assets/datacheck.js   profil des données et défauts d'un document mal structuré
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
npm run test:ui -- captures/   # interface dans Chromium (Playwright), Grist simulé : document de 22 tables avec règles d'accès, et document « mal structuré » de 26 tables avec données (tests/fixtures/mal-structure.mjs)
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
