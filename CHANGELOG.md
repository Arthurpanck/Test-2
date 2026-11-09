# Historique des versions

Une section par version, la plus récente en premier. Les sections décrivent l'état au moment de la version : une fonction décrite ici a pu être modifiée ou retirée depuis (voir les versions suivantes).

## 3.23.0 — Réglages dans l'ordre de Grist, lignes Excel lisibles
- **Réglages généraux** dans l'ordre : permissions avancées, règle pour les propriétaires, éditeurs et structure, permissions visibles par tous (onglet Accès, Word, Excel). L'alerte qui invite à cocher la règle pour les propriétaires reste au-dessus des réglages.
- **Exports Excel** : chaque ligne qui contient un texte long renvoyé à la ligne reçoit une hauteur adaptée. Excel ne la recalcule pas à l'ouverture, et les explications étaient coupées.

## 3.22.0 — Un seul export Excel des droits d'accès
- **Export Excel de l'onglet Accès** (bouton « Exporter en Excel » de la barre d'outils) : présenté comme l'export des tables. La première feuille « Droits d'accès » a un titre, puis un bloc par sujet avec son filet bleu : réglages généraux (la règle pour les propriétaires en tête), attributs utilisateur, droits par défaut, puis chaque table avec ses groupes de colonnes. En-têtes gris et pastilles Autorisé / Refusé.
- Les onglets suivants : « Toutes les règles » (tableau filtrable), puis « Qui peut faire quoi », « Détail par case » et « Paramètres » de la matrice. Le bouton Excel propre à la matrice est retiré.
- **Onglets Accès et Vues** : le bouton « points d'attention » est retiré du bandeau ; les chiffres restent. Les constats sont dans l'onglet Analyse.

## 3.21.0 — Propriétaires et sous-rôles dans une même fonction
- **Règle pour les propriétaires** : « Ajouter automatiquement une règle pour les propriétaires » passe en tête des réglages généraux. Non cochée, elle apparaît en **alerte au-dessus des réglages**, qui invite à l'activer.
- **Nouveau constat à corriger** « Les propriétaires n'ont pas d'office tous les droits » :
  - d'abord la bonne pratique (les propriétaires gardent tous les droits), puis l'explication : cette vue lit le document avec les droits de la personne qui l'ouvre, donc là où un propriétaire n'a pas tous les droits, l'audit est incomplet ;
  - signale la case non cochée, l'absence de toute règle « propriétaires » (ni par défaut, ni sur aucune table), et liste les tables et colonnes où un propriétaire peut perdre un droit (« Lire et modifier : refusé, sauf si leur habilitation le permet »), règles de colonne comprises.
- **Sous-rôles dans une même fonction** (« Fonction == 'RH' and Grade == 'Manager' ») : la matrice affiche « RH · Grade Manager », « RH · Grade Gestionnaire »… Le rôle est la colonne citée en premier dans les conditions ; avec les habilitations lues, la colonne « autre » prend le nom de la valeur réelle (« RH · Grade Assistant ») ou disparaît si personne n'est concerné.

## 3.20.0 — Rapport, exports Excel et sous-rôles des droits d'accès
- **Rapport Word** : le résumé ne renvoie plus vers des « étapes ci-dessous » absentes. Il indique où sont les étapes de correction : la partie « Analyse » si elle est cochée, sinon l'onglet « Analyse » du widget (de même dans la partie Vues).
- **Structure modifiable par les éditeurs** : le réglage général et le constat disent maintenant la même chose. Sans règle, la case de Grist est **cochée** (réglage par défaut, avec un avertissement) ; le constat demande de la décocher.
- **« Documentée ? »** : « — » pour une colonne sans formule (au lieu de « Non concerné »), à l'écran, dans le Word et dans l'Excel.
- **Export Excel des tables** : présenté comme celui de la matrice (titre, chiffres de chaque table, en-têtes gris, pastilles « Documentée » / « Pas de documentation », impression en paysage), avec une colonne **Description** (tables et colonnes) et une feuille « Paramètres » qui explique chaque colonne.
- **Export des règles d'accès** : un classeur Excel au nom du document (au lieu d'un CSV « regles-acces-document.csv ») : une ligne par condition, dans l'ordre où Grist les applique, avec les réglages généraux et les attributs utilisateur.
- **« Qui peut faire quoi ? »** :
  - un rôle précisé par une deuxième colonne de l'habilitation (« Fonction == 'Manager' and Pole == 'RH' ») se divise en **sous-rôles** : « Manager · Pole RH », « Manager · Pole Finances », « Manager · autre Pole ». Avant, la case affichait « Pole » comme si le pôle devait seulement être renseigné ;
  - des valeurs que les règles citent toujours ensemble (« Commercial » et « Commerciale ») forment une seule colonne « Commercial ou Commerciale ».
- **Conditions composées en clair** : « Personnes dont « Habilitation.Fonction » vaut « Manager » et « Habilitation.Pole » vaut « RH » », « …, sur les lignes où « Service » correspond à son « Habilitation.Service » » (au lieu de « Selon une condition »).
- **Word** : colonnes « Qui » et « Attribut » plus larges, pour que les conditions ne soient plus coupées en plein mot.

## 3.19.0 — Nettoyage du code, suite et fin
Le widget affiche et exporte la même chose qu'en 3.18.0 (vérifié sur les six documents de test, en clair et en sombre : contenu des six onglets, aperçu du rapport, Word, Excel et 120 captures), à trois corrections près :

- **Rapport** : la marge intérieure de la page Rapport est rétablie (une règle CSS orpheline, laissée en 3.16.0, faisait ignorer la suivante par le navigateur).
- **Mode sombre** : les traits d'exemple du menu **Liens** prennent les couleurs sombres.
- **Aperçu du rapport** : il n'est plus reconstruit quand rien n'a changé (onglet rouvert, schéma déjà dessiné), et l'arrivée de l'image du schéma ne remplace plus que l'image ; la position de lecture et le focus clavier sont gardés, y compris dans la liste des sections.

Dans le code :

- **Couleurs à un seul endroit** (`assets/theme.js`) : le Word, les exports Excel, les tables et les liens du schéma lisent les mêmes valeurs, posées en variables CSS `--doc-*`.
- **Liens de formule du schéma** : lookups et calculs passent par une seule mécanique (une table de familles de liens), comme les cases du menu **Liens**.
- **Code formaté** avec Prettier (`npm run format`, `npm run lint`) ; les événements sont regroupés par onglet et les actions de clic décrites dans une table ; CSS valide, sans doublon.
- **Numéro de version à un seul endroit** : `npm run version -- x.y.z` met à jour `package.json` et `index.html` ; les modules internes ne portent plus `?v=`. Le README devient une documentation ; l'historique passe dans ce fichier.
- **Tests** : attentes de l'interface mises à jour (onglet Vues, sections du rapport, niveaux d'analyse), plantage intermittent corrigé à la source, tests des revues rangés dans `tests/revues/` sous des noms descriptifs ; les tests qui cherchaient des noms dans le code source sont remplacés par l'analyse complète de chaque document de test (`tests/removed-findings.test.mjs`).

## 3.18.0 — Nettoyage du code, sans changement visible
Le widget affiche et exporte exactement la même chose qu'en 3.17.0 (vérifié octet par octet sur les six documents de test : les six onglets, l'aperçu du rapport, le Word et les deux Excel). Il charge 27 % de code en moins.

- **Droits d'accès : un seul modèle** (`assets/acl-model.js`) pour la lecture des règles, des permissions et des attributs utilisateur, l'analyse des conditions et le droit effectif d'un rôle, partagé par l'onglet Accès, la matrice et les contrôles. La question « les éditeurs peuvent-ils modifier la structure ? » a désormais une seule réponse ; deux cas limites, absents des documents de test, sont corrigés : une règle `-S` qui ne vise que les lecteurs ne retire plus rien aux éditeurs dans les réglages généraux, et l'ancien réglage spécial `SchemaEdit` compte aussi pour les réglages et le constat.
- **Formules : un seul lecteur** (`assets/python-text.js`) pour les commentaires, les chaînes (simples, triples, f-strings), les parenthèses, les arguments, les `$Colonne` et les appels de lookups. Une chaîne simple jamais refermée s'arrête désormais à la fin de sa ligne, comme en Python.
- **Calculs faits une fois** : le portage strict de la formule de conversion (et la Vue du code) passe dans `assets/converter-code.js`, que le widget ne charge plus ; l'échantillon des données est tiré une seule fois et repris par l'analyse ; les statistiques sont calculées une fois par lecture.
- **Code mort retiré** : `audit-config.js`, `annual-columns.js`, `audit-policy.js` ; le catalogue des contrôles chargé par le widget ne garde que les 15 retenus (le registre complet des décisions passe dans `tests/audit-decisions.mjs`) ; les « Vérifications principales » encore calculées sans être affichées ; les textes inutilisés des réglages spéciaux.
- **Utilitaires communs** (`assets/util.js`) : échappement HTML, pluriels, comparaison sans accents, dates, colonnes techniques, options JSON, lignes des métadonnées, types de colonnes.

Les tables des données sont toujours lues en entier avant d'être échantillonnées : l'API des widgets Grist (`fetchTable`) ne permet pas d'en lire une partie, et l'échantillon dépend de tous les identifiants.

## 3.17.0 — Références, recherches et récapitulations
Cinq contrôles validés sont intégrés, tous classés À corriger : U01 (utiliser les lignes du groupe), U02 (champ rapporté plutôt que recherche redondante), U03 (bilan manuel de groupes), U06 (table utilisée uniquement comme liste de choix), U07 (sélection manuelle pour un calcul par critères déclarés). U04 reste retiré. Les messages ne comportent pas d’exemples de données.

Le parseur accepte seulement des expressions complètes et des égalités simples. Les commentaires et chaînes ne sont jamais pris pour du code ; aucune formule Python n’est exécutée dans le navigateur. Les critères supplémentaires, recherches ordonnées, tables avec des informations propres, référentiels partagés ou protégés et références calculées sont exclus selon le contrôle. U01 ne réécrit pas automatiquement un lookupOne destiné à sélectionner une ligne ; le constat N31 reste responsable des recherches ambiguës.

Les budgets sont explicites : 200 tables, 10 000 colonnes, 100 index, 200 lignes de départ et 2 000 lignes cibles par index, 100 000 cellules d’index et 200 000 caractères de formules. Les index identiques sont réutilisés. Les contrôles utilisent l’échantillon déjà préparé par l’audit et n’ajoutent aucune lecture réseau.

### Déclarer l’intention pour U07

Une sélection manuelle peut être volontaire : sans critères déclarés, U07 est **non vérifiable**, pas validé par défaut. Pour une colonne calculant uniquement un résultat attendu par critères, une ligne de sa description peut préciser ce contrat :

```text
@audit-lookup {"table":"Operations","selection":"Selection_manuelle","criteria":{"Annee":"Annee","Region":"Region"},"aggregate":"SUM","field":"Montant"}
```

Les clés de `criteria` sont les colonnes de la table recherchée ; les valeurs sont les colonnes de la table courante. La déclaration est strictement validée et ne contient aucun code exécutable. La formule doit être une agrégation reconnue sur cette sélection. Une formule utilisant déjà la recherche correspondant au contrat ou une référence calculée n’est pas signalée. Ce mécanisme n’invente jamais les critères à partir des noms de colonnes.

L’aperçu et le rapport Word utilisent les mêmes constats. « Code DBML » est décoché au démarrage du rapport et reste sélectionnable. Les évolutions 3.15/3.16 sont conservées, notamment le retrait des vérifications principales de l’analyse et du rapport.

Validation 3.17.0 : 234 tests réussis, dont 32 tests des usages. Les cinq contrôles ont été observés via MCP dans le laboratoire Grist. Les corrections U01/U02/U06/U07 ont supprimé les cibles concernées, puis les cas ont été rétablis et relus. Pour U03, la vraie synthèse issue de la même source est un contre-exemple sans alerte ; le bilan manuel reste disponible pour démonstration.

## 3.16.0 — Sans « Vérifications principales »
- L'onglet Analyse n'affiche plus le panneau « Vérifications principales » : la liste des constats prend toute la largeur. Le rapport Word perd la liste correspondante (« Ce qui a été vérifié »).

## 3.15.0 — Analyse sans filtre par domaine
- La barre de l'onglet Analyse ne garde que la recherche : le filtre « Domaine » (Tous, Structure, Données, Droits d'accès, Vues) et le bouton « Ce qui a été examiné » (avec son panneau) sont retirés. Chaque carte garde son domaine en étiquette.

## 3.14.0 — Dernière revue du 4 novembre
Le constat des tables sans référence explique les informations rapportées entre tables et les vues reliées dynamiquement ; le cas volontaire est une table de droit d’équipe. `wide-table` est renommé « Table avec de nombreuses colonnes (plus de 20 colonnes) » et se déclenche strictement à partir de 21 colonnes.

`N41`, `acl-attribute`, `acl-unknown-attribute` et `acl-attr-unused` sont retirés, avec leurs calculs dédiés. Les déclarations d’attributs et le modèle de droits restent disponibles pour la matrice et les autres fonctions. `acl-uncovered` est renommé « Table non concernée par des règles avancées ».

`X13` parle de vues de tables et recommande des pages par usage (RH, finances, managers), avec des liens entre vues pour filtrer dynamiquement les tables. Son seuil de trois filtres est inchangé.

Validation : 202 tests. Métadonnées Grist relues : 31 tables ; constats retirés absents ; Personnel correspond au nouveau seuil ; deux déclarations d’attributs conservées dans le modèle des droits.

## 3.13.0 — Revue courante du 4 novembre
Les colonnes de saisie et de formule sans type sont regroupées dans `empty`, classé À corriger. `untyped` est fusionné. `N09` est retiré et ses calculs ne s’exécutent plus.

Les choix uniques et multiples sont réunis dans `choice-outside`, À corriger : chaque élément est comparé exactement aux modalités configurées. `N64` est fusionné et son ancien calcul est retiré du moteur enrichi. Les profils plafonnent les ensembles à 2 000 valeurs distinctes et ignorent les erreurs/censures.

`default-name`, `N41`, `N34` et `acl-bypass` passent À corriger ; `acl-uncovered` passe Bon à savoir. Le seuil `X13` est de trois champs affichés dans une même vue Tableau. Les textes courants parlent de vues. Les références, tables larges et colonnes vides ont des explications révisées ; les limites de lecture sont documentées dans les méthodes techniques.

Validation : 196 tests. MCP : trois filtres déclenchent, deux ne déclenchent pas ; les six initiaux sont rétablis. Une carte unique couvre deux colonnes de types Choice et ChoiceList, disparaît après correction, puis réapparaît après rétablissement des exemples. Aucun droit réel du document n’est modifié par ces essais.

## 3.12.0 — Calculs à la place des colonnes dérivées
- **Tables — colonne « Rôle » :** Clé primaire, Donnée ou Calculée. La notion de « Dérivée » est retirée partout (onglet Tables, rapport Word, export Excel, schéma).
  - **Donnée** : sans formule propre (saisie, import, automatisation) ; une formule d'initialisation ne propose qu'une première valeur, la colonne reste une donnée (« Calculé ? » indique « Initialisé ») ;
  - **Calculée** : produite par une formule.
- **Schéma — lien « Calculs »** (menu « Liens », désactivé par défaut, remplace « Colonnes dérivées ») : de chaque colonne calculée ou initialisée vers les colonnes que sa formule lit pour produire sa valeur :
  - dans la même table (`$Montant * (1 + $Taux_TVA)`, `f"{$Prenom} {$Nom}"`) : une boucle sur le côté de la table ;
  - par une référence (`$Service.Nom`, chaînes suivies) ou une liste de lignes (`SUM($group.Montant)`, `[a for a in $group if a.Temps_partiel]`) : vers la colonne de la table visée ;
  - les critères d'un lookup (`Exercice=$Annee`) comptent ; le lookup lui-même garde son lien orange ou vert.

## 3.11.0 — Revue du 4 novembre 2026
Les constats `acl-hidden`, `duplicate-table`, `text-ref`, `summary`, `N17`, `N28` et `N57` sont retirés ; leurs calculs dédiés ne s’exécutent plus. Le modèle de visibilité des droits et l’affichage des tables de synthèse restent nécessaires aux autres onglets.

Le constat `typed-as-text` est consacré aux nombres. `boolean-as-text` et `date-as-text` donnent des recommandations et exemples séparés. Les choix uniques (`choice-outside`) et multiples (`N64`) restent distincts. Le nom des pages est examiné aussi lorsqu’il reprend le nom d’une table affichée ; la recommandation propose un titre correspondant à un usage, sans renommage automatique.

Les explications des droits de structure des éditeurs, de l’activation des droits avancés et de la bulle de mémo sont précisées. Un attribut déclaré à source non lisible est distingué d’un nom d’attribut non déclaré.

Validation : 190 tests automatisés. Essai MCP dans `Audit_Types_Choix` : trois recommandations de type et les deux contrôles de choix observés ; correction des deux choix de la ligne 3 puis disparition contrôlée, exemples ensuite rétablis. Aucun droit d’accès réel n’a été modifié pour cet essai.

## 3.10.0 — Réglages généraux de Grist, matrice plus lisible
- **Réglages généraux** (onglet Accès et rapport) : seulement l'état des permissions avancées (activées ou non) et les trois cases de la page « Règles d'accès » de Grist en version open source :
  - « Ajouter automatiquement une règle pour les propriétaires » (règle SeedRule) ;
  - « Autoriser les éditeurs à modifier la structure » : Non quand une règle par défaut retire la permission Structure (`user.Access != OWNER` → `-S`), sinon Oui ; si la case est décochée sans règle, le widget le précise ;
  - « Autoriser tout le monde à voir les permissions avancées » (AccessRules), avec les personnes visées.

  « Copier le document entier » (propre à la version hébergée) n'est plus affiché. Les réglages s'affichent aussi quand le document n'a aucune règle.
- **Rapport :** dans « Qui peut faire quoi ? », un trait épais sépare les rôles (blanc dans l'en-tête, bleu dans le tableau), dans l'aperçu comme dans le Word. La section Analyse est décochée par défaut. La note sur la police sous « Contenu du rapport » est retirée.
- **Schéma :** la légende s'étend sur toute la largeur.

## 3.9.0 — Menu « Tables » du schéma, schéma du rapport, contenu du rapport
- **Schéma :** un bouton « Tables », à côté de « Liens », ouvre un menu de trois bascules, toutes activées par défaut : Tables, Tables de synthèse, Tables de droits (avec le nombre de tables de chaque type). Une table masquée disparaît avec tous ses liens (références, lookups, colonnes dérivées) ; les autres tables restent à leur place. Le choix est mémorisé avec le schéma. Un seul menu est ouvert à la fois. La barre tient sur une ligne jusqu'à environ 1000 px de large (les deux menus perdent leur icône sous 1600 px).
- **Rapport — schéma :** l'image ne dépend plus des réglages de l'écran : vue « Relations » (clé et colonnes de référence, les autres colonnes comptées), références seules, sans les tables de synthèse, avec une disposition recalculée aux proportions d'une page A4 en portrait.
- **Rapport — contenu :** le panneau reprend le modèle de la liste des tables de l'onglet Tables : une ligne par section, avec une case pour l'inclure, son numéro dans le rapport (— si elle est exclue) et le compte en tête (7/7). Un clic sur le nom place l'aperçu sur la section (et l'ajoute si elle était exclue) ; la section lue est mise en avant pendant le défilement. La description de chaque section s'affiche au survol.

## 3.8.0 — Colonnes dérivées sur le schéma, table de droits en rouge
- **Schéma :**
  - le menu « Liens » a une troisième bascule, « Colonnes dérivées », désactivée par défaut : elle relie chaque colonne dont le rôle est « Dérivée » (même règle que l'onglet Tables) à la colonne qu'elle reprend, en trait mixte violet terminé par une flèche ;
    - dans la même table (`f"{$Prenom} {$Nom}"`), le lien est une petite boucle sur le côté droit de la table ;
    - par une référence (`$Service.Nom`, chaînes suivies : `$Service.Direction.Nom`), il va vers la colonne de la table visée ;
    - par un lookup dont on lit une colonne (`Sites.lookupOne(Code=$Code).Ville`), il va vers cette colonne ; les critères du lookup ne comptent pas ;
  - en vue « Relations », les colonnes reliées s'affichent quand la bascule est active ; la légende, l'export PNG et le rapport Word reprennent ces liens ;
  - les tables de droits passent en rouge (#c9191e) pour trancher avec le bleu des tables et le violet des tables de synthèse.
- **Tables :** une comparaison (`$Statut == "Faite"`, `!=`, `>=`) est bien « Calculée » (elle sortait « Dérivée » en 3.7.0).

## 3.7.0 — Menu « Liens », table de droits, nature des colonnes
- **Schéma :**
  - un bouton « Liens » remplace les deux cases : il ouvre un petit menu avec deux interrupteurs, « Références » et « Lookups », tous deux activés par défaut et désactivables ; le compteur (2/2, 1/2…) rappelle ce qui est affiché, et le choix est mémorisé avec le schéma ;
  - les tables qui servent aux règles d'accès avancées (attributs d'utilisateur) sont signalées par une couleur propre (rouge depuis la 3.8.0) et un cadenas ; la légende, l'export PNG et le rapport Word reprennent cette couleur « table de droits ».
- **Tables — colonne « Rôle » :** Clé primaire, puis la nature de la valeur :
  - **Donnée** : sans formule propre (saisie, import, automatisation) ; une formule d'initialisation qui ne reprend aucune information du document (`NOW()`, `user.Email`) reste une donnée ;
  - **Calculée** : produite par une formule qui calcule (agrégat, compte, date, arithmétique, condition) ;
  - **Dérivée** : obtenue d'informations existantes par recopie, extraction, combinaison ou transformation (`$Service.Nom`, `Clients.lookupOne(…).Ville`, `f"{$Prenom} {$Nom}"`, `UPPER($Nom)`).
- **Interface :** les champs de recherche s'étendent sur la largeur disponible (sauf sur le schéma) ; les contrôles segmentés et les boutons ont un vrai cadre, entier au clic à tous les zooms.

## 3.6.0 — Lookups de colonne à colonne, documentation des formules
- **Schéma :**
  - deux cases encadrées : « Références », cochée par défaut, puis « Lookups », décochée ;
  - chaque lookup relie la colonne de formule à la colonne de la table cherchée qui donne la donnée : la colonne lue sur le résultat (`.Ville`, `d.Montant for d in …`, `c = …lookupOne(…)` puis `c.Nom`), sinon les colonnes de critère, sinon la table ;
  - en vue « Relations », les colonnes reliées par un lookup s'affichent quand les lookups sont cochés ;
  - le bouton d'export s'appelle « Télécharger en PNG ».
- **Tables :**
  - « Calculé ? » vaut Calculé, Initialisé (avec le moment où la formule s'applique) ou Non calculé ;
  - nouvelle colonne « Documentée ? » : Non concerné sans formule, Documentée si la formule contient un commentaire `#` ou une chaîne de documentation, sinon Pas de documentation ;
  - la description de la colonne s'affiche sous le nom affiché quand elle est renseignée.

  Le rapport Word et l'export Excel reprennent ces colonnes.

## 3.5.0 — Schéma, tables et lookups
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

## 3.4.0 — Retouches
- **Schéma :** « Relations » est la vue par défaut et le premier bouton, avant « Colonnes » puis « Tables ». Le choix fait à la main reste mémorisé. La légende est complète : clé, référence, formule, « plusieurs lignes », « une ligne » et table de synthèse.
- **Tables :** l'index des tables défile avec la page, sans barre de défilement propre. Les noms longs vont à la ligne.
- **Accès :**
  - le bouton « Exporter en Excel » a le même gabarit que la bascule ;
  - la feuille matrice du classeur reprend la vue « Par table et par colonne » ;
  - « SRH + SRH » devient « SRH » (même colonne de la personne côté ligne et côté profil) ;
  - les effets de règle sont formulés « autorise lire et modifier » ;
  - les réglages « Modifier la structure » et « Règles ajoutées d'office » (`*SPECIAL:SeedRule`) sont expliqués.
- **Analyse :** « Périmètre des contrôles » devient « Ce qui a été examiné ». Chaque vérification y figure en clair, rangée selon son résultat. Le rapport reprend ce tableau.

## 3.3.0 — Deuxième revue du 29 octobre 2026
N07, N10, N13, N14, N36, N38 et acl-emails sont retirés, calculs compris. Les niveaux ont été modifiés selon l’arbitrage : attribut inutilisé, source d’attribut absente, tables sans ligne lisible, colonnes sans valeur, espaces invisibles, listes textuelles, lookupOne ambigu, nombreuses pièces jointes, champs de droits modifiables et nom affiché passent à À corriger ; division potentielle par zéro et message de refus sans explication passent à À améliorer.

N41 est rétabli : au moins trois colonnes de saisie d’une même famille portant des années calendaires ou Année 1 / Année 2 / Année 3. Le contrôle ne lit aucune cellule. acl-hidden est conservé en attendant la décision de l’utilisateur après réexplication. Il désigne une limite des éléments lisibles, pas un défaut certain des droits d’accès. La différence entre absence de droits avancés au niveau document (acl-none), absence de règle propre à une table (acl-uncovered), attribut non déclaré et source déclarée introuvable est documentée dans le catalogue de revue.

## 3.2.0 — Qui peut faire quoi ? et gros documents
**Matrice des droits (onglet Accès).** Avant les réglages généraux, une matrice donne, pour chaque rôle métier, ce que permettent les règles à une personne de rôle Grist Éditeur : Lire, Modifier, Créer, Supprimer par table et, au choix, par colonne à règles, plus les droits de structure. Le rôle métier est la colonne d'attribut comparée au plus grand nombre de valeurs dans les règles (par exemple `user.Habilitation.Role`). Les conditions sont lues dans un langage fermé (`assets/rights-matrix.js`) : aucun `eval`, aucune exécution de Python. Une condition non comprise donne « ? ». Le widget ne lit aucune ligne métier pour cela. Il lit seulement la table de l'attribut, pour compter les valeurs d'une colonne filtrante (« 7 services »), et ne modifie aucune règle. Une case ouvre le détail des règles examinées, dans l'ordre. Les flèches passent d'une case à l'autre, Échap referme le détail.

**Rapport Word.** La matrice ouvre la section « Droits d'accès », sur des pages en paysage (trois rôles par tableau). Les cas à vérifier dans Grist sont listés après la matrice.

**Export Excel.** Le bouton « Exporter en Excel » de la matrice produit un classeur `.xlsx` écrit sans bibliothèque (`assets/xlsx.js`), avec trois feuilles :
- la matrice, avec ses couleurs, des filtres, des volets figés et l'impression en paysage ;
- « Détail par case », un tableau Excel filtrable avec une ligne par rôle, table, colonne et action : résultat, colonnes qui décident, explication, règle qui tranche, règles examinées ;
- « Paramètres », avec les hypothèses, la légende et les cas à vérifier.

**Gros documents.** Chaque table est réduite à son échantillon dès sa lecture : seuls ses ids restent en mémoire, avec la progression affichée et l'interface qui reste fluide entre deux tables. Le téléchargement par `fetchTable` est inchangé. La mémoire gardée et le temps d'analyse baissent nettement. Les constats sont identiques à ceux calculés sur les tables complètes.


La revue finale est livrée en 3.3.0 pour conserver simultanément les modifications de constats et les ajouts parallèles de matrice, exports Word/Excel et préparation des échantillons en mémoire.

## 3.1.0 — Revue et purge du 29 octobre 2026
21 contrôles du catalogue enrichi restent actifs, dont X13. Les contrôles supprimés ne sont plus calculés : doublons de lignes et de clés, variantes de saisie, bornes de dates, comparaisons de totaux, graphes de cycles, divergences de copies et contrôles de droits d’accès retirés. N54 est fusionné dans N53. N67 quitte les constats et devient une section « Informations de la colonne » dans Tables, avec les métadonnées disponibles et la description. Les contrôles historiques retirés (référence non visible, copie possible, recherche de courriel d’habilitation, copie intégrale et deux alertes sur les widgets) sont également désactivés.

Les contrôles N06, N10, N13, N14, N36 et N38 restent disponibles pour arbitrage avec leur calcul expliqué. N13 est maintenant fondé uniquement sur le nom et le type de la colonne. N06, N09, N10 et N14 examinent au plus 200 cellules courtes de l’échantillon par colonne. N31 indexe au plus 100 appels simples de lookupOne et vérifie au plus 200 recherches sources par appel. Aucun des calculs retirés ne s’exécute en arrière-plan.

La récupération réseau reste inchangée : docApi.fetchTable lit la totalité des données que l’utilisateur peut lire, avant l’échantillonnage des calculs (2 000 lignes par table et 100 000 cellules globales). La réduction des calculs ne doit pas être présentée comme une réduction équivalente du téléchargement.

## 2.8.1 — Filtres visibles
X13 compte les champs de filtre enregistrés, actifs et épinglés par vue Tableau affichée sur une page. À partir de cinq colonnes distinctes lisibles, un « Choix à confirmer » propose des vues préparées sur la même table. Les filtres masqués, les valeurs sélectionnées et les changements temporaires non enregistrés ne sont pas comptés. Le seuil est un indice d’ergonomie, pas une limite Grist. Aucun accès aux lignes métier supplémentaire. Les métadonnées absentes donnent « Non vérifiable », les propriétés ou colonnes censurées un contrôle limité. X04 (lignes vides d’espacement) est abandonné et n’est pas implémenté.

## 2.7.0 — Audit enrichi
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
