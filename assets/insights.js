/**
 * Constats sur la structure du document, rédigés pour l'utilisateur : ce qui se passe,
 * pourquoi c'est important, comment corriger dans Grist. Source unique pour la page
 * Analyse et pour le rapport Word.
 */

const DBML_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const SEVERITIES = {
  blocking: { label: 'À corriger', short: 'Bloquant', order: 0 },
  check: { label: 'À vérifier', short: 'À vérifier', order: 1 },
  info: { label: 'Bon à savoir', short: 'Info', order: 2 },
};

const REFRESH_STEP = 'Revenez dans ce widget et cliquez sur « Relire le document ».';

/** Libellé lisible d'un type DBML (« default » n'a pas de sens pour l'utilisateur). */
export function typeLabel(base) {
  return base === 'default' ? 'sans type' : base;
}

/**
 * @param {Array} tables  tables de la conversion ({ name, kind, columns: [{ name, base, isFormula, ref }] })
 * @returns {{ verdict, counts, items, checks }}
 */
export function buildInsights(tables) {
  const items = [];
  const names = new Set(tables.map((t) => t.name));

  // 1. Liens vers une table absente : l'import échoue.
  const brokenRefs = [];
  for (const t of tables) {
    for (const c of t.columns) if (c.ref && !names.has(c.ref.table)) brokenRefs.push({ table: t.name, column: c.name, target: c.ref.table });
  }
  if (brokenRefs.length) {
    items.push({
      id: 'broken-ref',
      severity: 'blocking',
      title: brokenRefs.length > 1 ? `${brokenRefs.length} liens vers une table introuvable` : 'Un lien vers une table introuvable',
      summary: 'Ces colonnes pointent vers une table qui n\'existe plus dans le document (supprimée ou renommée).',
      why: 'dbdiagram.io et les autres outils refusent un lien vers une table absente : l\'import du DBML échoue.',
      steps: [
        'Ouvrez la table concernée et sélectionnez la colonne.',
        'Dans le panneau de droite, rubrique Colonne, choisissez une table existante dans « Tableau de référence », ou changez le type de la colonne.',
        REFRESH_STEP,
      ],
      targets: brokenRefs.map((r) => ({ table: r.table, column: r.column, note: `vers « ${r.target} »` })),
    });
  }

  // 2. Noms refusés par le format DBML.
  const badNames = [];
  for (const t of tables) {
    if (!DBML_IDENTIFIER.test(t.name)) badNames.push({ table: t.name });
    for (const c of t.columns) if (!DBML_IDENTIFIER.test(c.name)) badNames.push({ table: t.name, column: c.name });
  }
  if (badNames.length) {
    items.push({
      id: 'bad-name',
      severity: 'blocking',
      title: badNames.length > 1 ? `${badNames.length} noms refusés par le format DBML` : 'Un nom refusé par le format DBML',
      summary: 'Ces identifiants contiennent des caractères que le DBML n\'accepte pas (espace, accent, tiret…).',
      why: 'L\'import du DBML échoue tant que ces noms ne sont pas corrigés.',
      steps: [
        'Sélectionnez la colonne (ou la table) dans Grist.',
        'Dans le panneau de droite, modifiez son identifiant : lettres sans accent, chiffres et « _ » uniquement.',
        REFRESH_STEP,
      ],
      targets: badNames,
    });
  }

  // 3. Colonnes en double.
  const dups = [];
  for (const t of tables) {
    const seen = new Set(['id']);
    for (const c of t.columns) {
      if (seen.has(c.name)) dups.push({ table: t.name, column: c.name });
      seen.add(c.name);
    }
  }
  if (dups.length) {
    items.push({
      id: 'duplicate',
      severity: 'blocking',
      title: dups.length > 1 ? `${dups.length} colonnes présentes deux fois` : 'Une colonne présente deux fois',
      summary: 'Une même table déclare deux colonnes avec le même identifiant.',
      why: 'Le DBML n\'accepte qu\'une colonne par nom dans une table : l\'import échoue.',
      steps: ['Renommez l\'une des deux colonnes dans Grist.', REFRESH_STEP],
      targets: dups,
    });
  }

  // 4. Formules sans type : le schéma est moins précis.
  const untyped = [];
  for (const t of tables) for (const c of t.columns) if (c.isFormula && c.base === 'default') untyped.push({ table: t.name, column: c.name });
  if (untyped.length) {
    items.push({
      id: 'untyped',
      severity: 'check',
      title: untyped.length > 1 ? `${untyped.length} colonnes de formule sans type` : 'Une colonne de formule sans type',
      summary: 'Grist ne sait pas quel genre de valeur ces formules renvoient : le schéma les affiche « sans type ».',
      why: 'Le DBML s\'importe, mais le schéma est moins précis pour les personnes qui le lisent.',
      steps: [
        'Sélectionnez la colonne dans sa table.',
        'Dans le panneau de droite, rubrique Colonne, choisissez un « Type de colonne » (Texte, Numérique, Date…).',
        REFRESH_STEP,
      ],
      targets: untyped,
    });
  }

  // 5. Tables sans aucun lien.
  const linked = new Set();
  for (const t of tables) for (const c of t.columns) if (c.ref) { linked.add(t.name); linked.add(c.ref.table); }
  const isolated = tables.filter((t) => !linked.has(t.name)).map((t) => ({ table: t.name }));
  if (isolated.length && tables.length > 1) {
    items.push({
      id: 'isolated',
      severity: 'check',
      title: isolated.length > 1 ? `${isolated.length} tables reliées à aucune autre` : 'Une table reliée à aucune autre',
      summary: 'C\'est normal pour une table de paramètres ou de notes. Sinon, il manque peut-être une colonne de référence.',
      why: 'Sur le schéma, ces tables apparaissent seules, sans trait vers le reste du document.',
      steps: [
        'Si la table doit être reliée : ajoutez-y une colonne de type « Référence » vers l\'autre table.',
        REFRESH_STEP,
      ],
      targets: isolated,
    });
  }

  // 6. Tables de synthèse.
  const summaries = tables.filter((t) => t.kind === 'summary').map((t) => ({ table: t.name }));
  if (summaries.length) {
    items.push({
      id: 'summary',
      severity: 'info',
      title: summaries.length > 1 ? `${summaries.length} tables de synthèse` : 'Une table de synthèse',
      summary: 'Les totaux calculés par Grist (tables de synthèse) apparaissent sous le nom de leur table d\'origine suivi de « _Summary ».',
      why: 'Elles sont dessinées en violet sur le schéma ; leurs colonnes sont toutes des formules.',
      steps: [],
      targets: summaries,
    });
  }

  items.sort((a, b) => SEVERITIES[a.severity].order - SEVERITIES[b.severity].order);
  const counts = { blocking: 0, check: 0, info: 0 };
  for (const it of items) counts[it.severity] += 1;

  const has = (id) => items.some((i) => i.id === id);
  const checks = [
    { label: 'Tous les liens pointent vers une table existante', ok: !has('broken-ref') },
    { label: 'Tous les noms sont acceptés par le DBML', ok: !has('bad-name') },
    { label: 'Aucune colonne en double', ok: !has('duplicate') },
    { label: 'Toutes les formules ont un type', ok: !has('untyped') },
  ];

  let verdict;
  if (counts.blocking) {
    const n = items.filter((i) => i.severity === 'blocking').reduce((s, i) => s + i.targets.length, 0);
    verdict = { level: 'blocking', title: 'Le DBML ne s\'importera pas encore', text: `${n} élément${n > 1 ? 's' : ''} à corriger dans Grist avant l'import. Suivez les étapes ci-dessous.` };
  } else if (counts.check) {
    verdict = { level: 'ready', title: 'Prêt pour l\'import', text: `Le DBML s'importe tel quel. ${counts.check} point${counts.check > 1 ? 's' : ''} à vérifier pour un schéma plus précis.` };
  } else {
    verdict = { level: 'ready', title: 'Prêt pour l\'import', text: 'Le DBML s\'importe tel quel et décrit fidèlement le document.' };
  }
  return { verdict, counts, items, checks };
}

/** Libellé court d'une cible (« Table.colonne »). */
export function targetLabel(t) {
  return t.column ? `${t.table}.${t.column}` : t.table;
}
