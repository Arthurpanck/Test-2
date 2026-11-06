// Contrôles retenus de l'analyse (textes, niveau, domaine, étapes). Le registre complet des décisions
// (contrôles écartés, fusionnés, retirés) est dans tests/audit-decisions.mjs.
export const AUDIT_CATALOG = [
  {
    id: 'N01',
    severity: 'blocking',
    level: 'À corriger',
    domain: 'données',
    title: 'Des calculs renvoient une erreur',
    detection:
      'Dans une colonne avec formule, repérer les valeurs d’erreur encodées par Grist (E), hors erreur de permission ou censure. Aucun texte littéral « #ERROR » n’est considéré comme une erreur. Le contrôle spécialisé des cycles N61 est retiré ; une cellule calculée en erreur reste un résultat d’erreur pour N01.',
    false_positives: 'Exclure texte littéral #ERROR et valeur censurée ; ne pas évaluer le code.',
    summary: 'Certaines cellules calculées affichent une erreur.',
    why: 'Les totaux et les colonnes qui en dépendent peuvent devenir incomplets.',
    intended: null,
    steps: [
      'Ouvrez les cellules indiquées, lisez le détail de l’erreur, corrigez la donnée ou la formule puis vérifiez les résultats.',
      'Revenez dans la vue et cliquez sur « Relire le document ».',
    ],
    example: 'Audit_Calculs ligne 1 : 12 / 0 renvoie ZeroDivisionError.',
    justification: 'Un calcul échoue réellement.',
    decision: 'Retenu',
    status: 'implémenté',
    source: 'Métadonnées et données',
    area: 'data',
    ruleVersion: 1,
    calculationSteps: [
      'Dans une colonne avec formule, repérer les valeurs d’erreur encodées par Grist (E), hors erreur de permission ou censure. Aucun texte littéral « #ERROR » n’est considéré comme une erreur. Le contrôle spécialisé des cycles N61 est retiré ; une cellule calculée en erreur reste un résultat d’erreur pour N01.',
    ],
    implementation: 'Automatique sur le sous-ensemble décrit',
    typology: 'Erreur observée',
    testEvidence:
      'Test de déclenchement ou de non-régression après la revue du 29 octobre. Les scénarios réels observés sont indiqués dans Vérifications & portée.',
    verification: {
      unitaire: true,
      observeMCP: false,
      correctionMCP: false,
    },
    reviewStage: '',
    reviewQuestion: '',
  },
  {
    id: 'N02',
    severity: 'blocking',
    level: 'À corriger',
    domain: 'données',
    title: 'Des valeurs ne correspondent pas au type de colonne',
    detection:
      'Comparer chaque valeur lisible non vide avec le type Grist déclaré : nombre fini pour Numérique, entier pour Entier, vrai/faux pour Booléen, valeur temporelle numérique ou encodée pour Date, identifiant positif ou nul pour Référence. Décoder les listes avant vérification. Exclure erreurs et cellules censurées. Une incompatibilité suffit.',
    false_positives: 'Ne pas utiliser typeof seul pour dates et références décodées ; exclure E et censures.',
    summary: 'Certaines valeurs sont signalées comme invalides dans leur colonne.',
    why: 'Les calculs peuvent les ignorer ou produire une erreur.',
    intended: null,
    steps: [
      'Filtrez les cellules indiquées ; corrigez leur contenu ou choisissez le type adapté dans le panneau Colonne ; vérifiez l’aperçu de conversion.',
      'Revenez dans la vue et cliquez sur « Relire le document ».',
    ],
    example: 'Audit_Imports.Montant = « douze ».',
    justification: 'Incompatibilité constatée et non simple ressemblance.',
    decision: 'Retenu',
    status: 'implémenté',
    source: 'Métadonnées et données',
    area: 'data',
    ruleVersion: 1,
    calculationSteps: [
      'Comparer chaque valeur lisible non vide avec le type Grist déclaré : nombre fini pour Numérique, entier pour Entier, vrai/faux pour Booléen, valeur temporelle numérique ou encodée pour Date, identifiant positif ou nul pour Référence',
      'Décoder les listes avant vérification',
      'Exclure erreurs et cellules censurées',
      'Une incompatibilité suffit.',
    ],
    implementation: 'Automatique sur le sous-ensemble décrit',
    typology: 'Erreur observée',
    testEvidence:
      'Test de déclenchement ou de non-régression après la revue du 29 octobre. Les scénarios réels observés sont indiqués dans Vérifications & portée.',
    verification: {
      unitaire: true,
      observeMCP: false,
      correctionMCP: false,
    },
    reviewStage: '',
    reviewQuestion: '',
  },
  {
    id: 'N06',
    severity: 'blocking',
    level: 'À corriger',
    domain: 'données',
    title: 'Des espaces invisibles gênent les comparaisons',
    detection:
      'Dans les colonnes dont le nom évoque un code, une référence, un courriel, un statut, une catégorie ou un nom : examiner au plus 200 cellules échantillonnées, de 120 caractères maximum et sans retour à la ligne. Repérer un espace au début ou à la fin, ou un espace insécable / fin / invisible. Déclencher dès deux cellules, ou si au moins 5 % des cellules non vides examinées sont concernées. Ne pas examiner les notes, descriptions et adresses.',
    false_positives:
      'Un espace peut faire partie d’un texte légitime. Les textes longs, les paragraphes et les adresses sont exclus. Aucun rapprochement entre lignes : au plus 24 000 caractères testés par colonne éligible.',
    summary:
      'Des cellules courtes contiennent des espaces en bordure ou des caractères invisibles. Ils peuvent faire échouer une recherche ou une comparaison.',
    why: 'Deux valeurs qui semblent identiques peuvent ne pas correspondre.',
    intended: null,
    steps: [
      'Ouvrez les cellules indiquées et retirez les espaces parasites ; nettoyez les colonnes dans une copie avant le prochain import.',
      'Revenez dans la vue et cliquez sur « Relire le document ».',
    ],
    example: 'Audit_Imports.Nom = « Bob  ».',
    justification: 'Cela perturbe les correspondances mais reste corrigeable.',
    decision: 'Retenu',
    status: 'implémenté',
    source: 'Données',
    area: 'data',
    ruleVersion: 2,
    calculationSteps: [
      'Choisir les colonnes de codes, références, courriels, statuts, catégories ou noms.',
      'Garder au plus 200 cellules de l’échantillon, chacune courte (120 caractères), sans paragraphe.',
      'Compter les cellules contenant les caractères visés ; déclencher à deux cellules, ou à 5 % des cellules non vides examinées.',
    ],
    implementation: 'Automatique sur le sous-ensemble décrit',
    typology: 'Qualité de saisie ou de structure',
    testEvidence:
      'Test de déclenchement ou de non-régression après la revue du 29 octobre. Les scénarios réels observés sont indiqués dans Vérifications & portée.',
    reviewNote: 'Niveau modifié selon la deuxième revue du 29 octobre 2026.',
    calculationCost:
      'Test de caractères, sans comparaison entre fiches : au plus 200 cellules × 120 caractères par colonne éligible. Le téléchargement des tables reste complet avant cet échantillonnage.',
    reviewStage: '',
    reviewQuestion: '',
    verification: {
      unitaire: true,
      observeMCP: false,
      correctionMCP: false,
    },
  },
  {
    id: 'N31',
    severity: 'blocking',
    level: 'À corriger',
    domain: 'structure',
    title: 'Un lookup renvoie uniquement la première valeur, alors que plusieurs sont disponibles',
    detection:
      'Lire les formules simples Table.lookupOne(Colonne=$Champ) ou avec un littéral. Construire une fois par appel un index des critères dans les données échantillonnées de la table cible, puis chercher les critères non uniques utilisés par les lignes sources. Maximum 100 appels indexés et 200 recherches sources par appel ; les clés de texte dépassant 120 caractères, expressions dynamiques et order_by ne sont pas analysées. Un signal exige au moins deux lignes cibles distinctes réellement lues ; l’absence de signal sur l’échantillon ne prouve pas l’unicité.',
    false_positives:
      'Choix volontaire du premier avec ordre explicitement défini ; clés composées et casse exactes ; correspondances cachées inconnues.',
    summary: 'Une formule utilise lookupOne, mais plusieurs fiches correspondent à ses critères dans les lignes examinées.',
    why: 'lookupOne conserve une seule fiche. Si plusieurs correspondent, la formule peut retenir une fiche différente de celle attendue.',
    intended: null,
    steps: [
      'Ouvrez la formule et regardez les critères transmis à lookupOne.',
      'Si une seule fiche est attendue, ajoutez un critère qui permet de l’identifier sans ambiguïté.',
      'Si plusieurs résultats sont attendus, utilisez lookupRecords puis choisissez explicitement comment les afficher ou les regrouper.',
      'Utilisez « Relire le document » pour vérifier.',
    ],
    example: 'Clients.lookupOne(Nom=$Client) avec deux Dupont.',
    justification: 'Ambiguïté réelle sur une recherche présente.',
    decision: 'Retenu',
    status: 'implémenté',
    source: 'Métadonnées et données',
    area: 'structure',
    ruleVersion: 2,
    calculationSteps: [
      'Lire les formules simples Table.lookupOne(Colonne=$Champ) ou avec un littéral. Construire une fois par appel un index des critères dans les données échantillonnées de la table cible, puis chercher les critères non uniques utilisés par les lignes sources. Maximum 100 appels indexés et 200 recherches sources par appel ; les clés de texte dépassant 120 caractères, expressions dynamiques et order_by ne sont pas analysées. Un signal exige au moins deux lignes cibles distinctes réellement lues ; l’absence de signal sur l’échantillon ne prouve pas l’unicité.',
    ],
    implementation: 'Automatique sur le sous-ensemble décrit',
    typology: 'Qualité de saisie ou de structure',
    testEvidence:
      'Test de déclenchement ou de non-régression après la revue du 29 octobre. Les scénarios réels observés sont indiqués dans Vérifications & portée.',
    reviewNote: 'Niveau modifié selon la deuxième revue du 29 octobre 2026.',
    calculationCost:
      'Au plus 100 index d’appels lookupOne simples. Pour chaque appel : index sur l’échantillon cible (au plus 2 000 lignes, dans le plafond global de 100 000 cellules) puis au plus 200 recherches sources. Aucun produit cartésien de toutes les lignes.',
    verification: {
      unitaire: true,
      observeMCP: false,
      correctionMCP: false,
    },
    reviewStage: '',
    reviewQuestion: '',
  },
  {
    id: 'N34',
    severity: 'blocking',
    level: 'À corriger',
    domain: 'structure',
    title: 'Un calcul pourrait diviser par zéro',
    detection:
      'Reconnaître une division simple par $Colonne ; vérifier qu’un diviseur visible vaut exactement zéro. Ne pas émettre le constat si la colonne calculée contient déjà une erreur E, ou si le code contient if, IF ou IFERROR. Les gardes complexes restent hors périmètre.',
    false_positives: 'Analyse Python limitée, court circuit et gardes ; ne pas annoncer de risque certain sur une expression non comprise.',
    summary: 'Le calcul divise par une valeur qui peut être nulle.',
    why: 'Certaines lignes peuvent ne pas donner de résultat.',
    intended: 'Si la formule traite déjà ce cas dans une autre branche, vérifiez le puis confirmez.',
    steps: [
      'Ouvrez la formule et repérez la valeur utilisée comme diviseur.',
      'Ajoutez un test if / else avant la division. Exemple : if $Quantite != 0:\n    return $Montant / $Quantite\nelse:\n    return 0',
      'Retournez 0 dans le else seulement si 0 est bien le résultat attendu lorsqu’on ne peut pas diviser. Sinon, choisissez une valeur vide ou un message adapté.',
      'Vérifiez les lignes où le diviseur vaut 0, puis utilisez « Relire le document ».',
    ],
    example: '$Montant / $Participants, Participants = 0.',
    justification: 'Risque seulement sans erreur observée.',
    decision: 'Retenu',
    status: 'implémenté',
    source: 'Métadonnées et données',
    area: 'structure',
    ruleVersion: 3,
    calculationSteps: [
      'Reconnaître une division simple par $Colonne ; vérifier qu’un diviseur visible vaut exactement zéro. Ne pas émettre le constat si la colonne calculée contient déjà une erreur E, ou si le code contient if, IF ou IFERROR. Les gardes complexes restent hors périmètre.',
    ],
    implementation: 'Automatique sur le sous-ensemble décrit',
    typology: 'Indice à vérifier',
    testEvidence:
      'Test de déclenchement ou de non-régression après la revue du 29 octobre. Les scénarios réels observés sont indiqués dans Vérifications & portée.',
    reviewNote: 'Niveau modifié selon la deuxième revue du 29 octobre 2026.',
    verification: {
      unitaire: true,
      observeMCP: false,
      correctionMCP: false,
    },
    reviewStage: '',
    reviewQuestion: '',
  },
  {
    id: 'N47',
    severity: 'info',
    level: 'Bon à savoir',
    domain: 'structure',
    title: 'Une table ne figure dans aucune page de saisie',
    detection:
      'Utiliser les pages et sections réellement lisibles pour former l’ensemble des tables affichées dans des sections de page. Exclure les tables techniques et synthèses. Une table ordinaire absente de cet ensemble donne une information de navigation, pas une table abandonnée.',
    false_positives: 'Référentiel, table utilisée uniquement par formules et droits masquant pages ; pas de conclusion d’abandon.',
    summary: 'Cette table est lisible dans les données brutes mais n’a pas de vue de saisie repérée.',
    why: 'Elle peut être difficile à trouver pour la maintenir.',
    intended: null,
    steps: [
      'Ajoutez une page ou une vue basé sur cette table si l’équipe doit la modifier régulièrement.',
      'Revenez dans la vue et cliquez sur « Relire le document ».',
    ],
    example: 'Tarifs lus par formules, aucune section de page.',
    justification: 'Information de navigation, pas anomalie.',
    decision: 'Retenu',
    status: 'implémenté',
    source: 'Métadonnées',
    area: 'structure',
    ruleVersion: 1,
    calculationSteps: [
      'Utiliser les pages et sections réellement lisibles pour former l’ensemble des tables affichées dans des sections de page',
      'Exclure les tables techniques et synthèses',
      'Une table ordinaire absente de cet ensemble donne une information de navigation, pas une table abandonnée.',
    ],
    implementation: 'Automatique sur le sous-ensemble décrit',
    typology: 'Information de contexte',
    testEvidence:
      'Test de déclenchement ou de non-régression après la revue du 29 octobre. Les scénarios réels observés sont indiqués dans Vérifications & portée.',
    verification: {
      unitaire: true,
      observeMCP: false,
      correctionMCP: false,
    },
    reviewStage: '',
    reviewQuestion: '',
  },
  {
    id: 'N50',
    severity: 'blocking',
    level: 'À corriger',
    domain: 'données',
    title: 'Certaines cellules regroupent beaucoup de pièces jointes',
    detection:
      'Décoder les listes d’identifiants des colonnes Pièces jointes. Déclencher à vingt pièces dans une cellule ou mille liens de pièces au total dans une colonne échantillonnée. Aucun téléchargement et aucune estimation de taille binaire.',
    false_positives: 'Dossier d’archives légitime ; doublons de contenu indétectables avec les seuls ids.',
    summary: 'Certaines cellules regroupent beaucoup de fichiers.',
    why: 'De nombreuses pièces jointes peuvent alourdir le document, ralentir son utilisation et occuper son espace de stockage.',
    intended: null,
    steps: [
      'Regroupez et classez les fichiers utiles ; évitez de joindre plusieurs fois le même document.',
      'Pour des ensembles volumineux, privilégiez une solution de partage de fichiers adaptée plutôt que de tout stocker dans Grist, afin de ne pas saturer le document.',
      'Conservez dans Grist des liens durables vers ces fichiers. Vérifiez que les personnes concernées ont accès à la solution de partage.',
      'Utilisez « Relire le document » pour revoir ce point.',
    ],
    example: 'Une ligne contient 25 reçus.',
    justification: 'Conseil de classement sans présumer du poids des fichiers.',
    decision: 'Retenu',
    status: 'implémenté',
    source: 'Métadonnées et données',
    area: 'data',
    ruleVersion: 2,
    calculationSteps: [
      'Décoder les listes d’identifiants des colonnes Pièces jointes. Déclencher à vingt pièces dans une cellule ou mille liens de pièces au total dans une colonne échantillonnée. Aucun téléchargement et aucune estimation de taille binaire.',
    ],
    implementation: 'Automatique sur le sous-ensemble décrit',
    typology: 'Information de contexte',
    testEvidence:
      'Test de déclenchement ou de non-régression après la revue du 29 octobre. Les scénarios réels observés sont indiqués dans Vérifications & portée.',
    reviewNote: 'Niveau modifié selon la deuxième revue du 29 octobre 2026.',
    verification: {
      unitaire: true,
      observeMCP: false,
      correctionMCP: false,
    },
    reviewStage: '',
    reviewQuestion: '',
  },
  {
    id: 'N53',
    severity: 'blocking',
    level: 'À corriger',
    domain: 'droits d’accès',
    title: 'Des champs utilisés pour les droits d’accès sont modifiables',
    detection:
      'Fusion N53 + N54. Métadonnées uniquement. Repérer les colonnes de saisie citées comme rec.Colonne dans une condition de droits d’accès de lecture ou modification. Repérer aussi, dans chaque table d’attribut utilisateur, la clé de recherche et les colonnes utilisées comme user.Attribut.Colonne. Vérifier symboliquement les droits de modification et, pour la table d’habilitation, de création, pour les rôles Éditeur et Lecteur. Signaler seulement une autorisation reconnue par le sous-ensemble analysé ; les conditions dépendant de la personne ou d’une ligne restent non vérifiables. Regrouper toutes ces cibles dans une seule carte.',
    false_positives:
      'Réaffectation volontaire, newRec protégeant transition, contrôle par autre règle ; ne pas annoncer une escalade sans simulation.',
    summary:
      'Une colonne utilisée pour déterminer les droits d’accès, ou une information de la table des habilitations, semble modifiable par un rôle non propriétaire.',
    why: 'Modifier cette information peut changer les droits attribués. Il faut vérifier que cette possibilité est réservée aux bonnes personnes.',
    intended:
      'Des gestionnaires habilités doivent administrer ces champs. Vérifiez que les conditions de modification couvrent uniquement les personnes prévues.',
    steps: [
      'Dans « Règles d’accès », repérez les colonnes signalées et la table des habilitations.',
      'Vérifiez qui peut modifier ces colonnes ou créer une nouvelle habilitation.',
      'Réservez ces actions aux personnes chargées d’administrer les droits d’accès.',
      'Utilisez « Voir en tant que » pour vérifier les profils, puis relisez le document dans l’audit.',
    ],
    example:
      'Habilitations.Email sert à retrouver la personne, et Habilitations.Role détermine ses droits. Si un éditeur peut modifier Role ou créer librement une habilitation, les deux situations figurent dans la même carte.',
    justification: 'Chemin d’accès potentiel, à confirmer.',
    decision: 'Retenu',
    status: 'implémenté',
    source: 'Métadonnées et données',
    area: 'access',
    ruleVersion: 3,
    calculationSteps: [
      'Fusion N53 + N54. Métadonnées uniquement. Repérer les colonnes de saisie citées comme rec.Colonne dans une condition de droits d’accès de lecture ou modification. Repérer aussi, dans chaque table d’attribut utilisateur, la clé de recherche et les colonnes utilisées comme user.Attribut.Colonne. Vérifier symboliquement les droits de modification et, pour la table d’habilitation, de création, pour les rôles Éditeur et Lecteur. Signaler seulement une autorisation reconnue par le sous-ensemble analysé ; les conditions dépendant de la personne ou d’une ligne restent non vérifiables. Regrouper toutes ces cibles dans une seule carte.',
    ],
    implementation: 'Automatique sur le sous-ensemble décrit',
    typology: 'Indice à vérifier',
    testEvidence:
      'Test de déclenchement ou de non-régression après la revue du 29 octobre. Les scénarios réels observés sont indiqués dans Vérifications & portée.',
    reviewNote: 'Niveau modifié selon la deuxième revue du 29 octobre 2026.',
    verification: {
      unitaire: true,
      observeMCP: false,
      correctionMCP: false,
    },
    reviewStage: '',
    reviewQuestion: '',
  },
  {
    id: 'N69',
    severity: 'info',
    level: 'Bon à savoir',
    domain: 'droits d’accès',
    title: 'Un filtre de page ne remplace pas un droit d’accès',
    detection:
      'Si _grist_Filters est lisible et contient au moins un filtre enregistré non vide, afficher un conseil unique : le filtre organise la vue, il ne remplace pas une permission. Aucun constat de fuite réelle n’est déduit de sa présence.',
    false_positives: 'Tout filtre sert normalement à la navigation ; ne pas classer comme fuite ; absence de filtre ne prouve rien.',
    summary: 'Cette page affiche une sélection de lignes.',
    why: 'Un filtre organise l’affichage et ne définit pas à lui seul les droits de lecture.',
    intended: null,
    steps: [
      'Si des lignes doivent rester confidentielles, vérifiez les règles d’accès et testez aussi les données brutes avec Voir en tant que.',
      'Revenez dans la vue et cliquez sur « Relire le document ».',
    ],
    example: 'Vue « Mes dossiers » filtrée par service.',
    justification: 'Conseil de portée générale attaché au contexte.',
    decision: 'Retenu',
    status: 'implémenté',
    source: 'Métadonnées',
    area: 'access',
    ruleVersion: 1,
    calculationSteps: [
      'Si _grist_Filters est lisible et contient au moins un filtre enregistré non vide, afficher un conseil unique : le filtre organise la vue, il ne remplace pas une permission. Aucun constat de fuite réelle n’est déduit de sa présence.',
    ],
    implementation: 'Automatique sur le sous-ensemble décrit',
    typology: 'Information de contexte',
    testEvidence:
      'Test de déclenchement ou de non-régression après la revue du 29 octobre. Les scénarios réels observés sont indiqués dans Vérifications & portée.',
    reviewNote: 'Modifié lors de la revue du 29 octobre 2026.',
    verification: {
      unitaire: true,
      observeMCP: false,
      correctionMCP: false,
    },
    reviewStage: '',
    reviewQuestion: '',
  },
  {
    id: 'X13',
    title: 'Une vue affiche beaucoup de filtres à régler',
    level: 'Choix à confirmer',
    severity: 'choice',
    domain: 'Pages et vues',
    status: 'implémenté',
    decision: 'Retenu',
    typology: 'Ergonomie de navigation',
    summary:
      'Au moins trois champs de filtre sont affichés dans une même vue de table. Vérifiez si des pages préparées pour chaque usage faciliteraient le travail.',
    why: 'Dans Grist, plutôt que de proposer une seule page avec toutes les vues filtrées, il est généralement plus ergonomique de créer une page par usage : une page pour les RH, une page pour les finances, une page pour les managers. Chacun retrouve ainsi les pages utiles à son travail. Vous pouvez aussi relier les vues entre elles pour filtrer leurs tables dynamiquement à partir d’une sélection.',
    intended:
      'Une page d’exploration peut conserver plusieurs filtres visibles si cette souplesse est utile. Gardez-la en complément des pages préparées pour les usages courants.',
    steps: [
      'Repérez les usages récurrents : suivi RH, finances ou suivi des équipes par les managers.',
      'Créez une page pour chaque usage et ajoutez-y les vues nécessaires sur les tables existantes, sans copier les tables.',
      'Préparez les filtres utiles à chaque page. Masquez les filtres fixes de la barre ; ils restent appliqués. Gardez visibles les champs que les personnes doivent ajuster.',
      'Quand les tables sont reliées par des références, liez leurs vues : sélectionner un service ou une équipe dans une vue peut filtrer dynamiquement la table affichée dans une autre vue.',
      'Revenez dans cette vue et cliquez sur « Relire le document ».',
    ],
    example:
      'Une seule vue Dossiers affiche six filtres : Statut, Service, Responsable, Année, Priorité, Commune. Chaque matin, l’équipe doit remettre Statut = Ouvert et Service = Accueil pour retrouver sa liste de travail.',
    detection:
      'Joindre _grist_Filters à _grist_Views_section par viewSectionRef, aux colonnes par colRef et aux tables par tableRef. Garder les vues de table (parentKey = record) placées sur une page (parentId > 0), les tables et colonnes nommées lisibles et les colonnes de cette même table. Compter les colRef distincts dont pinned vaut true ou 1 et dont filter est une chaîne différente de chaîne vide et de « null » (ancien filtre vide Grist). Dès trois champs affichés dans une même vue, signaler cette vue et son nombre de champs. Ne pas compter les valeurs sélectionnées, les filtres masqués, les vues brutes hors page ou les autres types de vues. Coût linéaire dans les métadonnées, aucune ligne métier lue pour ce contrôle. Sources absentes : non vérifiable ; propriété pinned absente ou filtre censuré : contrôle limité, aucune valeur devinée. Les réglages temporaires non enregistrés dans Grist ne sont pas visibles.',
    calculationSteps: [
      'Relier les filtres à leur vue de table, à la table et à la colonne lisible correspondantes.',
      'Ne conserver que les filtres enregistrés, épinglés (pinned = true ou 1) et actifs (filter différent de chaîne vide et de « null »).',
      'Compter les colonnes distinctes par vue, jamais les valeurs choisies dans un filtre ni les filtres de toute la page.',
      'Déclencher à partir de trois champs dans une vue ; indiquer page, titre de vue, numéro, nombre et champs lisibles.',
      'Ignorer les filtres masqués et les vues brutes. Signaler la limite de lecture si pinned ou une colonne ne peut pas être lu. Aucun calcul sur les lignes métier.',
      'Exemple de vérification : six filtres épinglés déclenchent ; après désépinglage de quatre champs, deux restent affichés et X13 disparaît. Le cas limite de trois champs déclenche, celui de deux ne déclenche pas.',
    ],
    false_positives:
      'Une vue d’exploration peut légitimement afficher six critères. Le seuil de trois est un seuil proposé par cet audit, pas une limite Grist. Le nombre ne prouve pas que des réglages sont refaits au quotidien. Les réglages temporaires non enregistrés et les champs masqués par les droits ne sont pas comptés. Masquer un filtre conserve son effet et ne modifie pas les droits d’accès.',
    justification: 'Choix à confirmer : trois filtres affichés constituent un indice d’ergonomie, sans prouver une gêne réelle.',
    source:
      'Métadonnées seulement : _grist_Filters, _grist_Views_section, _grist_Tables, _grist_Tables_column et noms des pages dans _grist_Views si lisibles.',
    implementation: 'Automatique sur les filtres enregistrés et lisibles',
    reviewNote: 'Retenue et intégrée au widget 2.8.1 le 27 octobre 2026.',
    verification: {
      unitaire: true,
      observeMCP: false,
      correctionMCP: false,
    },
    testEvidence:
      'Test de déclenchement ou de non-régression après la revue du 29 octobre. Les scénarios réels observés sont indiqués dans Vérifications & portée.',
    exampleDetail: {
      context: 'La table Dossiers contient toutes les demandes de l’association. La même table peut être présentée dans plusieurs vues.',
      before: {
        title: 'Avant — une seule vue, six filtres visibles',
        headers: ['Vue', 'Filtres affichés', 'Réglage répété'],
        rows: [
          [
            'Dossiers',
            'Statut · Service · Responsable · Année · Priorité · Commune',
            'Chaque matin : Statut = Ouvert et Service = Accueil',
          ],
        ],
      },
      after: {
        title: 'Après — des vues prêtes pour les usages courants',
        headers: ['Vue ou page', 'Filtre préparé', 'Filtres laissés visibles'],
        rows: [
          ['À traiter — Accueil', 'Statut = Ouvert ; Service = Accueil', 'Responsable · Priorité'],
          ['Dossiers terminés', 'Statut = Terminé', 'Année'],
          ['Exploration', 'Aucun périmètre imposé', 'Les six filtres, si utiles'],
        ],
      },
      explanation:
        'Ces trois vues utilisent la même table Dossiers. Les filtres fixes restent appliqués lorsqu’on masque leur affichage. On évite de refaire les mêmes réglages, sans créer trois copies de données.',
      counterexample:
        'Un analyste qui combine souvent les six critères a intérêt à conserver sa vue Exploration. Le constat demande de confirmer le besoin, pas de supprimer automatiquement des filtres.',
    },
    area: 'pages',
    ruleVersion: 3,
    reviewStage: '',
    reviewQuestion: '',
  },
  {
    status: 'implémenté',
    decision: 'Retenu',
    implementation: 'Implémenté dans le widget 3.17.0 — sous-ensemble décrit',
    domain: 'structure',
    area: 'structure',
    source: 'Métadonnées et données — méthode envisagée, non implémentée',
    typology: 'Contrôle d’usage',
    reviewStage: '',
    reviewQuestion: '',
    readingGroup: 'Références, recherches et récapitulations',
    ruleVersion: 4,
    id: 'U06',
    severity: 'blocking',
    level: 'À corriger',
    title: 'Une table sert uniquement de liste de choix',
    readingOrder: 313,
    situation:
      'Une table contient seulement des intitulés destinés à être sélectionnés dans une ou plusieurs colonnes. Ses lignes ne portent aucune information propre et n’ont aucun autre rôle.',
    summary: 'Des colonnes Référence ou Liste de références utilisent cette table pour proposer de simples modalités de saisie.',
    why: 'Les types Choix et Choix multiple servent directement à proposer des modalités dans une colonne. Une référence sert à relier une ligne à une véritable fiche d’une autre table. Lorsque la table ne fournit qu’une liste déroulante, elle ajoute une structure à entretenir sans apporter d’information supplémentaire.',
    intended:
      'Conservez la table lorsqu’elle centralise volontairement un référentiel, porte des informations propres, sert à des vues reliées ou répond à des besoins de droits d’accès. Ce fonctionnement dépasse alors celui d’une simple liste de modalités.',
    shortText:
      'Cette table sert uniquement à fournir des modalités de saisie. Utilisez le type Choix pour une modalité par cellule, ou Choix multiple pour plusieurs. Conservez une référence lorsque vous devez désigner une fiche possédant ses propres informations ou répondant à un autre usage.',
    levelReason:
      'À corriger lorsque le rôle de simple liste déroulante est confirmé et que la table n’apporte ni information propre ni autre usage. Le seul fait de trouver une table à une colonne ne suffit pas à établir ce rôle.',
    steps: [
      'Vérifiez le contenu de la table et ses utilisations dans les colonnes, les formules et les vues. Confirmez qu’elle sert uniquement à proposer des modalités.',
      'Ajoutez une colonne Choix si chaque cellule doit contenir une seule modalité, ou Choix multiple si plusieurs sont possibles.',
      'Configurez la liste des modalités autorisées.',
      'Reportez les libellés des sélections existantes et vérifiez que les informations sont conservées ; ne recopiez pas les identifiants internes des références.',
      'Vérifiez les dépendances avant de retirer les anciennes colonnes ou leur table.',
    ],
    detection:
      'Repérer une table ordinaire entièrement examinée avec une seule colonne utile de saisie Texte ou Choix et de 2 à 20 intitulés courts, non vides et distincts. Exiger une seule colonne de référence entrante, saisie manuellement, sans lien inverse, usage de recherche connu, vue reliée ni rôle spécifique connu dans les droits d’accès. Les référentiels partagés et les tables à colonnes masquées sont exclus.',
    calculationSteps: [
      'Identifier les destinations des références sur l’ensemble des métadonnées examinées. Si le budget de métadonnées ou de formules est dépassé, ne pas produire ce constat.',
      'Conserver une seule colonne utile de saisie Texte ou Choix, sans colonne masquée ni information propre supplémentaire.',
      'Exiger une lecture non échantillonnée et de 2 à 20 intitulés distincts, de 120 caractères maximum chacun.',
      'Exclure les références calculées, références réciproques, référentiels utilisés par plusieurs colonnes, recherches connues vers cette table, vues reliées et usages spécifiques connus des droits d’accès.',
      'Présenter le conseil sur la colonne de sélection et nommer sa table de destination. Les autres usages métier restent à vérifier avant une suppression.',
    ],
    calculationCost:
      'Métadonnées et au plus 20 intitulés pour une candidate entièrement examinée. Aucun rapprochement entre paires de lignes.',
    false_positives:
      'Référentiel partagé volontairement, vues reliées, droits d’accès ou informations propres présentes ou prévues. La taille de la table et le nombre de colonnes sont des indices, pas une preuve que les références sont inadaptées.',
    distinction:
      'Ce conseil figure déjà dans le texte de « Table sans référence ». U06 en propose un constat dédié lorsque le rôle de simple liste est confirmé. Il ne traite pas des modalités manquantes dans une colonne de type Choix.',
    usageFamily: true,
  },
  {
    status: 'implémenté',
    decision: 'Retenu',
    severity: 'blocking',
    level: 'À corriger',
    implementation: 'Implémenté dans le widget 3.17.0 — sous-ensemble décrit',
    domain: 'structure',
    area: 'structure',
    source: 'Métadonnées et données — méthode envisagée, non implémentée',
    typology: 'Contrôle d’usage',
    reviewStage: '',
    reviewQuestion: '',
    readingGroup: 'Références, recherches et récapitulations',
    ruleVersion: 4,
    id: 'U01',
    readingOrder: 310,
    title: 'Les calculs n’utilisent pas les possibilités de la table récapitulative',
    situation:
      'Vous utilisez une table récapitulative Grist pour calculer une somme, une moyenne ou un nombre à partir des lignes réunies dans chaque groupe. Vous cherchez à récupérer des informations de ces mêmes lignes dans la table d’origine avec un lookup.',
    summary:
      'La formule utilise une recherche lookup pour retrouver dans la table d’origine les lignes que Grist a déjà réunies dans la table récapitulative.',
    why: 'Chaque ligne récapitulative conserve un lien vers les lignes d’origine qui composent son groupe. Dans les formules, cet ensemble est accessible avec $group. Refaire une recherche lookup oblige à reproduire les critères de regroupement et peut sélectionner trop de lignes ou en oublier. Utiliser $group permet au calcul de suivre directement le groupe affiché.',
    intended:
      'Conservez les recherches qui consultent une autre table ou un ensemble différent du groupe courant. Si le calcul doit porter sur une partie du groupe, conservez cette condition lorsque vous réécrivez la formule.',
    shortText:
      'Pour calculer à partir des lignes du groupe courant, utilisez $group. Choisissez ensuite le champ à calculer et l’opération à effectuer. Une nouvelle recherche dans la table d’origine n’est pas nécessaire pour retrouver ces mêmes lignes.',
    levelReason:
      'À corriger pour une recherche qui reproduit inutilement le groupe courant ou qui ne respecte pas son périmètre. Si elle donne déjà le bon résultat, la correction simplifie la formule ; elle ne signifie pas qu’un total faux a été constaté.',
    steps: [
      'Vérifiez les colonnes qui définissent le regroupement de la table récapitulative.',
      'Ouvrez la formule lookup et vérifiez qu’elle cherche à retrouver les lignes du groupe courant dans la table d’origine.',
      'Remplacez cette recherche par $group. Accédez au champ à calculer, puis appliquez la somme, la moyenne ou le comptage correspondant au résultat attendu.',
    ],
    detection:
      'Métadonnées : vraie table récapitulative, table d’origine et colonnes regroupées. Reconnaître une agrégation simple de lookupRecords qui reproduit exactement toutes les clés du groupe, ou SUM($group) sans champ. Les recherches sur un autre périmètre, les filtres supplémentaires et les recherches ordonnées sont exclues. lookupOne et la sélection de la première ligne ne sont pas réécrits automatiquement.',
    calculationSteps: [
      'Identifier la table d’origine et les colonnes regroupées à partir de summarySourceTable et summarySourceCol.',
      'Accepter seulement une expression complète reconnue : agrégation d’une recherche lookupRecords avec égalités simples.',
      'Vérifier que chaque critère correspond exactement à une colonne regroupée, sans critère supplémentaire ni critère manquant.',
      'Signaler la recherche redondante ou une somme de lignes sans champ. Ne pas affirmer que le résultat d’une recherche équivalente était faux.',
      'Conserver les sélections, recherches ordonnées, formules complexes et autres périmètres ; N31 reste disponible pour les lookupOne ambigus.',
    ],
    calculationCost:
      'Métadonnées et grammaire fermée ; aucune donnée n’est nécessaire pour U01. Budget partagé : 200 tables, 10 000 colonnes, 200 000 caractères de formules ; au plus 8 critères par appel et 8 192 caractères par expression.',
    false_positives:
      'Une recherche vers une autre table, un total général ou un sous-ensemble volontaire reste légitime. Un lookup correct n’implique pas un résultat erroné. Une lecture partielle ne permet pas de garantir l’exhaustivité d’une comparaison.',
    distinction:
      'U01 concerne les calculs d’une table récapitulative déjà créée. U03 concerne un bilan dont les groupes sont entretenus dans une table ordinaire. Un lookup vers une autre table ou un autre périmètre peut rester nécessaire.',
    usageFamily: true,
  },
  {
    status: 'implémenté',
    decision: 'Retenu',
    severity: 'blocking',
    level: 'À corriger',
    implementation: 'Implémenté dans le widget 3.17.0 — sous-ensemble décrit',
    domain: 'structure',
    area: 'structure',
    source: 'Métadonnées et données — méthode envisagée, non implémentée',
    typology: 'Contrôle d’usage',
    reviewStage: '',
    reviewQuestion: '',
    readingGroup: 'Références, recherches et récapitulations',
    ruleVersion: 4,
    id: 'U02',
    readingOrder: 311,
    title: 'Une formule lookup redouble un lien de référence',
    situation:
      'Une colonne de référence relie déjà la ligne à une ligne d’une autre table. Vous voulez afficher une information de cette même ligne.',
    summary: 'La formule recherche à nouveau la ligne liée au lieu de rapporter directement le champ de la référence existante.',
    why: 'Une référence désigne une ligne précise. Un champ rapporté lit directement l’information de cette ligne. Une nouvelle recherche reproduit une relation qui existe déjà et peut désigner une autre ligne lorsque le critère utilisé n’est pas unique. Le champ rapporté évite cette seconde correspondance.',
    intended:
      'Une recherche peut représenter une autre relation vers la même table. Dans ce cas, identifiez clairement le rôle de chaque relation et conservez le calcul nécessaire.',
    shortText:
      'Cette ligne est déjà reliée à la ligne de l’autre table dont vous voulez afficher une information. Rapportez le champ depuis la référence existante plutôt que de rechercher à nouveau cette même ligne avec un lookup.',
    levelReason:
      'À corriger lorsque la référence existante et le lookup représentent bien la même relation. Si les deux retrouvent la même fiche, la correction simplifie l’accès à l’information. S’ils désignent deux fiches différentes, vérifiez d’abord laquelle correspond à la relation attendue.',
    steps: [
      'Dans la vue de la table, cliquez sur « + » pour ajouter une colonne.',
      'Dans la section « Champ rapporté », passez la souris sur la colonne de référence concernée.',
      'Sélectionnez le champ à rapporter.',
    ],
    detection:
      'Reconnaître une formule entière de type lookupOne suivie d’un champ, avec un seul critère provenant d’une référence existante vers la même table. Un critère id=$Reference.id suffit. Pour une recherche sur un champ de la référence, vérifier l’unicité dans la table cible entièrement examinée ou une divergence observable avec le champ lié. Ne pas doubler N31 sur la même colonne.',
    calculationSteps: [
      'Vérifier la destination de la référence et l’existence du champ rapporté.',
      'Reconnaître une recherche par l’identifiant de la référence, ou un critère utilisant son même champ dans la table cible.',
      'Pour le second cas, exiger une lecture cible non échantillonnée dans la limite de 2 000 lignes. Construire un index réutilisable.',
      'Sur 200 lignes sources au maximum, retrouver la ligne liée et constater soit l’équivalence non ambiguë, soit une différence entre le résultat de la formule et le champ de cette référence.',
      'Exclure les autres critères, conditions supplémentaires, ordres de recherche et relations qui ne proviennent pas de la référence.',
    ],
    calculationCost:
      'Au plus 200 lignes sources et 2 000 lignes cibles par index ; 100 index et 100 000 cellules d’index au total. Les index de mêmes critères sont réutilisés.',
    false_positives:
      'Deux relations différentes vers la même table peuvent être nécessaires. Une référence mal renseignée doit être vérifiée avant de remplacer la recherche. Les données masquées ou les formules non reconnues peuvent empêcher la comparaison.',
    distinction:
      'U02 rapporte une information d’une ligne déjà liée. U07 concerne un résultat à déterminer selon des critères de recherche, sans entretenir une sélection manuelle de références uniquement pour ce calcul.',
    usageFamily: true,
  },
  {
    status: 'implémenté',
    decision: 'Retenu',
    severity: 'blocking',
    level: 'À corriger',
    implementation: 'Implémenté dans le widget 3.17.0 — sous-ensemble décrit',
    domain: 'structure',
    area: 'structure',
    source: 'Métadonnées et données — méthode envisagée, non implémentée',
    typology: 'Contrôle d’usage',
    reviewStage: '',
    reviewQuestion: '',
    readingGroup: 'Références, recherches et récapitulations',
    ruleVersion: 4,
    id: 'U03',
    readingOrder: 312,
    title: 'Des formules sont utilisées à la place d’une table récapitulative',
    situation:
      'Une table ordinaire est utilisée pour présenter un bilan complet, avec une ligne par combinaison de critères et des calculs sur les données d’une autre table.',
    summary:
      'Les lignes de regroupement sont ajoutées à la main. Les formules lookup actualisent les résultats des lignes présentes, mais ne créent pas les lignes correspondant à de nouveaux groupes.',
    why: 'Une table récapitulative Grist construit automatiquement les groupes à partir des données d’origine. Lorsqu’une nouvelle combinaison apparaît, sa ligne est créée et ses calculs sont mis à jour. Un bilan entretenu manuellement peut rester incomplet sans afficher d’erreur de formule.',
    intended:
      'Conservez une table indépendante lorsqu’elle porte des informations saisies propres à chaque groupe, prévoit des groupes sans activité ou présente une sélection volontaire. Une table de fiches peut aussi utiliser des recherches pour compléter ses informations sans devoir devenir une table récapitulative.',
    shortText:
      'Ce bilan dépend de lignes de regroupement ajoutées à la main. Pour couvrir automatiquement tous les groupes présents dans les données, créez une table récapitulative et choisissez les colonnes de regroupement. Grist entretiendra les groupes et leurs calculs.',
    levelReason:
      'À corriger lorsque la table sert à un bilan exhaustif dont les groupes sont entretenus manuellement. Le constat porte sur la construction du bilan ; une omission déjà démontrée doit être indiquée séparément.',
    steps: [
      'Confirmez que la table sert à un bilan complet et identifiez les informations saisies à la main qui doivent être conservées.',
      'Ajoutez une vue de la table contenant les données à regrouper, puis choisissez le type Table.',
      'Activez le regroupement avec l’icône Σ et sélectionnez les colonnes qui définissent les groupes.',
      'Vérifiez les calculs de la table récapitulative en utilisant les lignes accessibles avec $group.',
      'Comparez les résultats à l’ancien bilan et conservez séparément les informations manuelles qui ne relèvent pas de l’agrégation.',
    ],
    detection:
      'Dans une table ordinaire, exiger que toutes les colonnes utiles saisies soient exactement les critères de regroupement et que toutes les colonnes utiles calculées soient des agrégations simples de lookupRecords sur la même table et les mêmes critères. Exiger au moins deux combinaisons distinctes observées. Une information propre, une formule non reconnue ou une colonne masquée exclut la recommandation.',
    calculationSteps: [
      'Exclure les tables récapitulatives et les tables comportant des colonnes masquées.',
      'Séparer les critères saisis des colonnes calculées, hors identifiants et colonnes techniques de Grist.',
      'Vérifier que chaque formule utile est une agrégation reconnue de la même table source et des mêmes critères, sans champ source inexistant.',
      'Vérifier que toutes les colonnes utiles de saisie servent de critères ; une colonne de commentaire, de budget ou toute autre information propre empêche le déclenchement.',
      'Observer au moins deux groupes distincts dans les 200 premières lignes de l’échantillon. Signaler l’entretien manuel des groupes, sans prétendre avoir démontré l’absence de lignes cachées.',
    ],
    calculationCost:
      'Métadonnées et au plus 200 lignes du bilan déjà échantillonnées ; pas de comparaison de toutes les paires de lignes et pas de recherche exhaustive de groupes manquants.',
    false_positives:
      'Groupes sélectionnés volontairement, informations manuelles propres aux groupes ou lignes sans activité à conserver. La présence d’un lookup d’agrégation dans une table ordinaire ne suffit pas à déclencher le constat.',
    distinction:
      'U03 concerne un bilan complet dont les lignes de regroupement sont ajoutées à la main. U01 concerne les calculs d’une table récapitulative déjà créée. U07 concerne une information calculée par critères dans une table ayant son propre rôle, sans créer un bilan complet de groupes.',
    usageFamily: true,
  },
  {
    status: 'implémenté',
    decision: 'Retenu',
    severity: 'blocking',
    level: 'À corriger',
    implementation: 'Implémenté dans le widget 3.17.0 — sous-ensemble décrit',
    domain: 'structure',
    area: 'structure',
    source: 'Métadonnées et données ; critères de recherche et rôle de la colonne à confirmer',
    typology: 'Contrôle d’usage',
    reviewStage: '',
    reviewQuestion: '',
    readingGroup: 'Références, recherches et récapitulations',
    readingOrder: 314,
    ruleVersion: 4,
    id: 'U07',
    title: 'Des références sont utilisées uniquement pour calculer une information',
    situation:
      'Vous voulez obtenir une information à partir d’une ou de plusieurs lignes d’une autre table qui répondent à des critères. Le résultat doit suivre ces critères, sans qu’une personne ait à choisir les lignes concernées.',
    summary:
      'Une Référence ou une Liste de références est sélectionnée à la main uniquement pour alimenter le calcul. La sélection doit être revue lorsque les critères changent ou que de nouvelles lignes répondent à la recherche.',
    why: 'Une référence sélectionnée à la main désigne les lignes choisies ; elle ne décrit pas les critères qui doivent déterminer le résultat. Une recherche lookup retrouve les lignes correspondantes au moment du calcul et permet d’en extraire l’information utile. Vous évitez ainsi d’entretenir une sélection supplémentaire uniquement pour produire ce résultat.',
    shortText:
      'Cette colonne doit produire une information à partir de critères de recherche, mais le calcul dépend de références sélectionnées à la main. Utilisez un lookup pour retrouver les lignes correspondantes et calculer directement le résultat attendu. Une référence reste adaptée lorsqu’elle représente un lien à conserver ou une sélection volontaire.',
    levelReason:
      'À corriger lorsque les critères et le résultat attendu sont établis et que la sélection manuelle sert uniquement à reproduire cette recherche. La présence de plusieurs lignes ou le seul fait de rapporter une information ne suffisent pas à conclure que les références sont inadaptées.',
    intended:
      'Conservez une référence lorsqu’elle représente un lien métier stable ou une sélection volontaire. Une référence calculée par un lookup peut aussi être utile pour réutiliser les résultats dans plusieurs calculs : elle n’est pas à remplacer systématiquement.',
    steps: [
      'Définissez les critères qui doivent déterminer les lignes à consulter et le résultat attendu : une valeur, un nombre ou un calcul sur plusieurs lignes.',
      'Ajoutez une colonne calculée qui recherche les lignes dans la table concernée en utilisant ces critères.',
      'Utilisez lookupRecords lorsque plusieurs lignes peuvent correspondre, puis appliquez le comptage ou le calcul nécessaire. Une liste de résultats n’est pas à elle seule un total.',
      'Utilisez lookupOne uniquement lorsqu’une seule ligne est attendue et que son choix est déterminé sans ambiguïté.',
      'Vérifiez que le résultat suit les changements de critères et de données. Retirez la sélection manuelle uniquement si elle n’a pas d’autre usage et si ses dépendances ont été vérifiées.',
    ],
    distinction:
      'U02 lit une information depuis un lien déjà établi et attendu. U07 calcule une information à partir de critères qui déterminent les lignes à consulter. U03 crée tous les groupes d’un bilan ; U07 ne demande pas de remplacer une table métier par un bilan. La référence et le lookup ne sont pas incompatibles : un lookup peut remplir une colonne de type Référence ou Liste de références.',
    detection:
      'Le résultat attendu doit être déclaré dans la description de la colonne de résultat, sur une ligne @audit-lookup suivie d’un objet JSON validé. Il décrit table, selection, criteria, aggregate et field. Reconnaître ensuite l’agrégation simple d’une sélection Référence ou Liste de références manuelle et la comparer aux critères déclarés. Sans déclaration, le contrôle est non vérifiable et n’affirme aucune erreur.',
    calculationSteps: [
      'Lire une ligne @audit-lookup dans la description de la colonne de résultat ; la lecture est bornée à 4 096 caractères. Aucun code Python n’est exécuté.',
      'Valider table et selection comme identifiants existants. criteria associe les colonnes de la table recherchée aux colonnes locales ; de 1 à 8 égalités sont admises.',
      'Valider aggregate parmi SUM, AVERAGE, MIN, MAX, COUNT ou len, et field comme champ calculé, ou null pour un comptage de lignes.',
      'Vérifier que la formule entière correspond à cette agrégation sur une sélection manuelle du bon type et de la bonne destination. Sans critères déclarés, conserver l’état non vérifiable.',
      'Construire un index sur les critères ; examiner 200 lignes sources au maximum et 2 000 lignes cibles par index. Montrer seulement les lignes retrouvées mais absentes de la sélection.',
      'Une formule déjà réécrite avec la recherche correspondante ou une référence calculée intermédiaire n’est pas signalée. Une déclaration incompatible est indiquée comme contrôle limité.',
    ],
    calculationCost:
      'Mêmes budgets partagés : 100 index et 100 000 cellules d’index. Pas d’inférence de l’intention à partir des noms de colonnes, ni de sélection arbitraire d’une première ligne.',
    false_positives:
      'Référence métier stable, sélection volontaire, sélection figée pour conserver un historique, référence calculée réutilisée par plusieurs formules, ou besoin d’afficher le détail des lignes liées. Plusieurs lignes possibles ne rendent pas une Liste de références incorrecte. Sans intention de recherche confirmée, aucun diagnostic automatique certain.',
    documentation: 'https://support.getgrist.com/fr/references-lookups/',
    usageFamily: true,
  },
];
export const RETAINED_IDS = AUDIT_CATALOG.map((x) => x.id);
