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

### Interface (v3)

Tous les onglets suivent les mêmes règles, décrites en tête de `assets/styles.css` :
- onglets soulignés, avec le nombre de points à corriger sur « Analyse » ; « Relire le document » sur la même ligne ;
- une barre d'outils grise sous les onglets : recherche, filtres segmentés et boutons de 40 px, exports à droite ;
- un en-tête de page (titre, une phrase, chiffres clés, « points d'attention ») et des en-têtes de section (titre, compteur, une ligne d'aide) ;
- des cartes au même modèle ; les badges (MAJUSCULES) donnent un état, les pastilles (arrondies) désignent un élément du document, lilas quand elles mènent quelque part ;
- 6 tailles de texte, des espacements sur une grille de 4 px, les couleurs du DSFR (le thème sombre suit).

Particularités : un index des tables dans « Tables » ; dans « Analyse », les compteurs servent de filtres, un filtre par domaine, une recherche, et la « Couverture des contrôles » mène au constat concerné ; « Contrôles et règles métier » s'ouvre depuis la barre d'outils ; dans « Rapport », un panneau à cases à cocher choisit les sections.

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

## Audit enrichi 2.7.0

L’analyse applique les 58 propositions retenues lors de la revue du 27 octobre 2026. Les 12 propositions écartées ne sont pas activées. `assets/audit-engine.js` porte les calculs, `assets/audit-catalog.js` les explications et méthodes, `assets/audit-config.js` valide les seules conventions métier acceptées. Les anciennes cartes impossibles à produire dans l’interface normale (identifiants invalides ou dupliqués) sont retirées du verdict.

Chaque nouvelle carte expose sa méthode, l’observation et les limites ; le rapport Word reprend ces informations. Le domaine Données est distinct de Structure, Accès et Pages. Une table ou une ligne non visible n’est jamais déclarée supprimée. Une ressemblance de copie n’est plus considérée comme une fuite prouvée. Les confirmations « C’est voulu » sont invalidées si la version ou la preuve change.

Le profilage est borné : 2000 lignes par table, 100000 cellules pour le document, 200000 caractères de formules. Les ids sont sélectionnés par hachage déterministe, répartis sur les lignes ; cela limite le calcul, pas la quantité transférée par fetchTable. Deux tables sont lues simultanément. Les formules et conditions d’accès ne sont jamais exécutées par le widget. L’analyse des droits reste inconnue pour les expressions non comprises.

Dans Analyse, ouvrir « Règles métier et couverture des contrôles ». Déclarer une clé avec la table et ses colonnes (une seule fiche par tuple). Les règles avancées des options du widget utilisent :

```json
{
  "keys": [{"table": "Clients", "columns": ["Code"]}],
  "dateBounds": [{"table": "Cotisations", "column": "Date", "min": "2024-01-01", "max": "2030-12-31"}],
  "totals": [{"table": "Commandes", "total": "Total_saisi", "quantity": "Quantite", "price": "Prix"}],
  "copies": [{"table": "Commandes", "column": "Ville_actuelle", "reference": "Client", "source": "Ville"}]
}
```

Ces exemples doivent être adaptés aux identifiants réels. Aucune clé, période, formule de total ou obligation de synchroniser une copie n’est déduite silencieusement des noms de champs. Une copie historique n’est pas une copie courante. Sans règle déclarée, le contrôle est « À configurer », pas « correct ». Les contrôles de pièces jointes demandent leurs métadonnées facultatives. Les montants, courriels et jetons observés ne sont pas ajoutés aux preuves : seulement des ids de lignes et des comptes.

Validation : `npm test` exécute les tests existants, les 58 déclencheurs et leurs cas limites. La vérification MCP utilise les trois documents d’essai ; une correction aller-retour a été contrôlée sur N01, N03, N04 et N29, avec restauration des données. Les 58 contrôles n’ont pas tous un scénario de manipulation réelle des ACL : les cas sensibles sont simulés et le périmètre des vérifications doit rester explicite.

## Filtres visibles 2.8.1

X13 compte les champs de filtre enregistrés, actifs et épinglés par vue Tableau affichée sur une page. À partir de cinq colonnes distinctes lisibles, un « Choix à confirmer » propose des vues préparées sur la même table. Les filtres masqués, les valeurs sélectionnées et les changements temporaires non enregistrés ne sont pas comptés. Le seuil est un indice d’ergonomie, pas une limite Grist. Aucun accès aux lignes métier supplémentaire. Les métadonnées absentes donnent « Non vérifiable », les propriétés ou colonnes censurées un contrôle limité. X04 (lignes vides d’espacement) est abandonné et n’est pas implémenté.


## Revue et purge du 29 octobre 2026 — 3.1.0

21 contrôles du catalogue enrichi restent actifs, dont X13. Les contrôles supprimés ne sont plus calculés : doublons de lignes et de clés, variantes de saisie, bornes de dates, comparaisons de totaux, graphes de cycles, divergences de copies et contrôles de droits d’accès retirés. N54 est fusionné dans N53. N67 quitte les constats et devient une section « Informations de la colonne » dans Tables, avec les métadonnées disponibles et la description. Les contrôles historiques retirés (référence non visible, copie possible, recherche de courriel d’habilitation, copie intégrale et deux alertes sur les widgets) sont également désactivés.

Les contrôles N06, N10, N13, N14, N36 et N38 restent disponibles pour arbitrage avec leur calcul expliqué. N13 est maintenant fondé uniquement sur le nom et le type de la colonne. N06, N09, N10 et N14 examinent au plus 200 cellules courtes de l’échantillon par colonne. N31 indexe au plus 100 appels simples de lookupOne et vérifie au plus 200 recherches sources par appel. Aucun des calculs retirés ne s’exécute en arrière-plan.

La récupération réseau reste inchangée : docApi.fetchTable lit la totalité des données que l’utilisateur peut lire, avant l’échantillonnage des calculs (2 000 lignes par table et 100 000 cellules globales). La réduction des calculs ne doit pas être présentée comme une réduction équivalente du téléchargement.

## Deuxième revue du 29 octobre 2026 — 3.3.0

N07, N10, N13, N14, N36, N38 et acl-emails sont retirés, calculs compris. Les niveaux ont été modifiés selon l’arbitrage : attribut inutilisé, source d’attribut absente, tables sans ligne lisible, colonnes sans valeur, espaces invisibles, listes textuelles, lookupOne ambigu, nombreuses pièces jointes, champs de droits modifiables et nom affiché passent à À corriger ; division potentielle par zéro et message de refus sans explication passent à À améliorer.

N41 est rétabli : au moins trois colonnes de saisie d’une même famille portant des années calendaires ou Année 1 / Année 2 / Année 3. Le contrôle ne lit aucune cellule. acl-hidden est conservé en attendant la décision de l’utilisateur après réexplication. Il désigne une limite des éléments lisibles, pas un défaut certain des droits d’accès. La différence entre absence de droits avancés au niveau document (acl-none), absence de règle propre à une table (acl-uncovered), attribut non déclaré et source déclarée introuvable est documentée dans le catalogue de revue.

## Qui peut faire quoi ? et gros documents — 3.2.0

**Matrice des droits (onglet Accès).** Avant les réglages généraux, une matrice donne, pour chaque rôle métier, ce que permettent les règles à une personne de rôle Grist Éditeur : Lire, Modifier, Créer, Supprimer par table et, au choix, par colonne à règles, plus les droits de structure. Le rôle métier est la colonne d'attribut comparée au plus grand nombre de valeurs dans les règles (par exemple `user.Habilitation.Role`). Les conditions sont lues dans un langage fermé (`assets/rights-matrix.js`) : aucun `eval`, aucune exécution de Python. Une condition non comprise donne « ? ». Le widget ne lit aucune ligne métier pour cela. Il lit seulement la table de l'attribut, pour compter les valeurs d'une colonne filtrante (« 7 services »), et ne modifie aucune règle. Une case ouvre le détail des règles examinées, dans l'ordre. Les flèches passent d'une case à l'autre, Échap referme le détail.

**Rapport Word.** La matrice ouvre la section « Droits d'accès », sur des pages en paysage (trois rôles par tableau). Les cas à vérifier dans Grist sont listés après la matrice.

**Export Excel.** Le bouton « Exporter en Excel » de la matrice produit un classeur `.xlsx` écrit sans bibliothèque (`assets/xlsx.js`), avec trois feuilles :
- la matrice, avec ses couleurs, des filtres, des volets figés et l'impression en paysage ;
- « Détail par case », un tableau Excel filtrable avec une ligne par rôle, table, colonne et action : résultat, colonnes qui décident, explication, règle qui tranche, règles examinées ;
- « Paramètres », avec les hypothèses, la légende et les cas à vérifier.

**Gros documents.** Chaque table est réduite à son échantillon dès sa lecture : seuls ses ids restent en mémoire, avec la progression affichée et l'interface qui reste fluide entre deux tables. Le téléchargement par `fetchTable` est inchangé. La mémoire gardée et le temps d'analyse baissent nettement. Les constats sont identiques à ceux calculés sur les tables complètes.


La revue finale est livrée en 3.3.0 pour conserver simultanément les modifications de constats et les ajouts parallèles de matrice, exports Word/Excel et préparation des échantillons en mémoire.

## Retouches — 3.4.0

- **Schéma :** « Relations » est la vue par défaut et le premier bouton, avant « Colonnes » puis « Tables ». Le choix fait à la main reste mémorisé. La légende est complète : clé, référence, formule, « plusieurs lignes », « une ligne » et table de synthèse.
- **Tables :** l'index des tables défile avec la page, sans barre de défilement propre. Les noms longs vont à la ligne.
- **Accès :**
  - le bouton « Exporter en Excel » a le même gabarit que la bascule ;
  - la feuille matrice du classeur reprend la vue « Par table et par colonne » ;
  - « SRH + SRH » devient « SRH » (même colonne de la personne côté ligne et côté profil) ;
  - les effets de règle sont formulés « autorise lire et modifier » ;
  - les réglages « Modifier la structure » et « Règles ajoutées d'office » (`*SPECIAL:SeedRule`) sont expliqués.
- **Analyse :** « Périmètre des contrôles » devient « Ce qui a été examiné ». Chaque vérification y figure en clair, rangée selon son résultat. Le rapport reprend ce tableau.

## Schéma, tables et lookups — 3.5.0

- **Légende du schéma :** elle distingue la table (en-tête bleu) de la table de synthèse (violet). L'export du schéma se fait en image PNG, à la place du SVG.
- **Lookups :** une case « Lookups », décochée par défaut, se trouve entre « Aller à une table » et l'export. Le choix est mémorisé.
  - Elle affiche les `lookupOne` (orange tireté) et les `lookupRecords` (vert pointillé) écrits dans les formules et les formules d'initialisation, de la colonne vers la table cherchée.
  - La lecture est textuelle, sans exécution : les chaînes et les commentaires sont ignorés.
  - Une table de synthèse cherchée (`X_summary_Y`) est rattachée à `X_Summary`.
  - Ces traits ne changent pas la disposition du schéma.
- **Tables :** chaque table suit le modèle « Table pour exportation » : Colonne (nom en base), Nom affiché, Type SQLite, Type déclaré (Grist), Rôle, Calculé ?, Formule.
  - Le type SQLite suit `DocStorage._getSqlType()` de grist-core. Par exemple, `DateTime:Europe/Paris` est stocké en BLOB.
  - Le type déclaré est en français.
  - Le rôle vaut Clé primaire, Dérivé (v_*) ou Donnée.
  - La colonne « Calculé ? » vaut Calculé, ou Initialisé pour une formule d'initialisation.
  - L'export de l'onglet devient un classeur Excel dans ce format.
- **Rapport :** la section « Tables et colonnes » reprend ce format, en pages paysage. La lecture du schéma mentionne les lookups quand ils sont affichés.
