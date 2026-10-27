/**
 * Constats sur la structure, les données et les droits d'accès du document, rédigés pour
 * l'utilisateur : ce qui se passe, pourquoi c'est important, comment agir dans Grist.
 * Source unique pour la page Analyse et pour le rapport Word.
 *
 * Quatre niveaux :
 *  - À corriger : ne fonctionne pas comme prévu ;
 *  - À améliorer : fonctionne, mais une bonne pratique éviterait des erreurs ;
 *  - Choix à confirmer : souvent volontaire ; l'utilisateur confirme (« C'est voulu ») ou corrige ;
 *  - Bon à savoir : information.
 */
import { accessInsights } from './access.js?v=2.6.0';
import { structureSmells } from './datacheck.js?v=2.6.0';
import { pageInsights } from './pages.js?v=2.6.0';

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const SEVERITIES = {
  blocking: { label: 'À corriger', order: 0 },
  improve: { label: 'À améliorer', order: 1 },
  choice: { label: 'Choix à confirmer', order: 2 },
  info: { label: 'Bon à savoir', order: 3 },
};
export const LEVELS = Object.keys(SEVERITIES);

const REFRESH_STEP = 'Revenez dans ce widget et cliquez sur « Relire le document ».';

/** Domaines des constats. */
export const AREAS = { structure: 'Structure', access: 'Droits d\'accès', pages: 'Pages et widgets' };

/** Clé d'un constat, pour mémoriser qu'il est « voulu » : change si les éléments concernés changent. */
export function insightKey(it) {
  return `${it.id}:${it.targets.map((t) => `${t.table}.${t.column || ''}`).sort().join('|')}`;
}

/**
 * @param {Array} tables   tables de la conversion ({ name, kind, columns: [{ name, base, isFormula, ref }] })
 * @param {object} [access] buildAccess() : ajoute les constats sur les droits d'accès
 * @param {object} [opts]  { profiles: profileTables(), accepted: Set de insightKey() }
 * @returns {{ verdict, counts, items, accepted, checks }}
 */
export function buildInsights(tables, access = null, { profiles = null, accepted = null, pages = null } = {}) {
  const items = [];
  const names = new Set(tables.map((t) => t.name));

  // 1. Liens vers une table absente.
  const brokenRefs = [];
  for (const t of tables) {
    for (const c of t.columns) if (c.ref && !names.has(c.ref.table)) brokenRefs.push({ table: t.name, column: c.name, target: c.ref.table });
  }
  if (brokenRefs.length) {
    items.push({
      id: 'broken-ref', severity: 'blocking',
      title: brokenRefs.length > 1 ? `${brokenRefs.length} liens vers une table introuvable` : 'Un lien vers une table introuvable',
      summary: 'Ces colonnes de référence pointent vers une table qui n\'apparaît pas (supprimée, renommée ou masquée pour vous).',
      why: 'Les cellules ne mènent nulle part : les formules qui s\'appuient sur ce lien renvoient des erreurs.',
      steps: [
        'Ouvrez la table concernée et sélectionnez la colonne.',
        'Dans le panneau de droite, rubrique Colonne, choisissez une table existante dans « Tableau de référence », ou changez le type de la colonne.',
        REFRESH_STEP,
      ],
      targets: brokenRefs.map((r) => ({ table: r.table, column: r.column, note: `vers « ${r.target} »` })),
    });
  }

  // 2. Identifiants avec accents, espaces ou tirets.
  const badNames = [];
  for (const t of tables) {
    if (!IDENTIFIER.test(t.name)) badNames.push({ table: t.name });
    for (const c of t.columns) if (!IDENTIFIER.test(c.name)) badNames.push({ table: t.name, column: c.name });
  }
  if (badNames.length) {
    items.push({
      id: 'bad-name', severity: 'blocking',
      title: badNames.length > 1 ? `${badNames.length} identifiants avec accents ou espaces` : 'Un identifiant avec accent ou espace',
      summary: 'Ces identifiants contiennent des caractères (espace, accent, tiret…) mal acceptés par les formules et les outils externes.',
      why: 'Les formules, l\'API et les exports qui utilisent ces identifiants risquent d\'échouer.',
      steps: [
        'Sélectionnez la colonne (ou la table) dans Grist.',
        'Dans le panneau de droite, modifiez son identifiant : lettres sans accent, chiffres et « _ » uniquement. Le libellé affiché peut garder ses accents.',
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
      id: 'duplicate', severity: 'blocking',
      title: dups.length > 1 ? `${dups.length} colonnes présentes deux fois` : 'Une colonne présente deux fois',
      summary: 'Une même table déclare deux colonnes avec le même identifiant.',
      why: 'On ne sait plus laquelle une formule utilise.',
      steps: ['Renommez l\'une des deux colonnes dans Grist.', REFRESH_STEP],
      targets: dups,
    });
  }

  // 4. Colonnes vides (ni type ni formule), comme A, B, C d'une table créée par défaut.
  const empty = [];
  for (const t of tables) for (const c of t.columns) if (c.empty) empty.push({ table: t.name, column: c.name });
  if (empty.length) {
    items.push({
      id: 'empty', severity: 'improve',
      title: empty.length > 1 ? `${empty.length} colonnes créées mais jamais utilisées` : 'Une colonne créée mais jamais utilisée',
      summary: 'Ces colonnes n\'ont encore ni type ni formule, comme les colonnes A, B, C d\'une table créée par défaut.',
      why: 'Elles encombrent la saisie et le schéma. Grist leur choisira un type à la première saisie, pas forcément le bon.',
      steps: [
        'Si la colonne ne sert pas : clic droit sur son en-tête ▸ « Supprimer la colonne ».',
        'Sinon : renommez-la et choisissez son « Type de colonne » dans le panneau de droite.',
        REFRESH_STEP,
      ],
      targets: empty,
    });
  }

  // 5. Formules sans type : souvent un choix (valeurs de types différents).
  const untyped = [];
  for (const t of tables) for (const c of t.columns) if (c.isFormula && c.base === 'default') untyped.push({ table: t.name, column: c.name });
  if (untyped.length) {
    items.push({
      id: 'untyped', severity: 'choice',
      title: untyped.length > 1 ? `${untyped.length} formules de type « Non défini »` : 'Une formule de type « Non défini »',
      summary: 'Le type de colonne de ces formules est resté « Non défini » : Grist ne sait pas quel genre de valeur elles renvoient.',
      why: 'Typée, une formule s\'affiche mieux (dates, montants…) et se filtre et se trie correctement.',
      intended: 'La formule renvoie volontairement des valeurs de genres différents (texte ou nombre selon les lignes) : rien à faire.',
      steps: [
        'Sinon : sélectionnez la colonne et, dans le panneau de droite, choisissez son « Type de colonne » (Texte, Numérique, Date…).',
        REFRESH_STEP,
      ],
      targets: untyped,
    });
  }

  // 6. Tables sans aucun lien.
  const linked = new Set();
  for (const t of tables) for (const c of t.columns) if (c.ref) { linked.add(t.name); linked.add(c.ref.table); }
  const isolated = tables.filter((t) => !linked.has(t.name)).map((t) => ({ table: t.name }));
  if (isolated.length && tables.length > 1) {
    items.push({
      id: 'isolated', severity: 'choice',
      title: isolated.length > 1 ? `${isolated.length} tables reliées à aucune autre` : 'Une table reliée à aucune autre',
      summary: 'Aucune colonne de référence ne relie ces tables au reste du document.',
      why: 'Sur le schéma, elles apparaissent seules ; si elles parlent des mêmes choses que d\'autres tables, il manque un lien.',
      intended: 'Table de paramètres, de notes ou journal indépendant : rien à faire.',
      steps: [
        'Sinon : ajoutez une colonne de type « Référence » vers la table concernée (voir aussi les liens écrits à la main signalés plus haut).',
        REFRESH_STEP,
      ],
      targets: isolated,
    });
  }

  // 7. Tables de synthèse.
  const summaries = tables.filter((t) => t.kind === 'summary').map((t) => ({ table: t.name }));
  if (summaries.length) {
    items.push({
      id: 'summary', severity: 'info',
      title: summaries.length > 1 ? `${summaries.length} tables de synthèse` : 'Une table de synthèse',
      summary: 'Grist calcule ces tables automatiquement à partir d\'une table source (totaux, regroupements) ; leurs colonnes sont des formules.',
      why: 'Elles sont dessinées en violet sur le schéma et reliées à leur table source.',
      steps: [],
      targets: summaries,
    });
  }

  for (const it of items) it.area = 'structure';
  items.push(...structureSmells(tables, profiles, access));
  items.push(...accessInsights(access));
  items.push(...pageInsights(pages));
  items.sort((a, b) => SEVERITIES[a.severity].order - SEVERITIES[b.severity].order);

  const acceptedItems = accepted ? items.filter((it) => it.severity === 'choice' && accepted.has(insightKey(it))) : [];
  const active = items.filter((it) => !acceptedItems.includes(it));
  const counts = Object.fromEntries(LEVELS.map((l) => [l, 0]));
  for (const it of active) counts[it.severity] += 1;

  const has = (id) => items.some((i) => i.id === id);
  const checks = [
    { label: 'Les liens pointent vers des tables existantes', ok: !has('broken-ref') },
    { label: 'Les identifiants sont sans accent ni espace', ok: !has('bad-name') },
    { label: 'Les relations utilisent des colonnes de référence', ok: !has('text-ref') },
  ];
  if (profiles) checks.push({ label: 'Nombres, dates et oui/non ont le bon type', ok: !has('typed-as-text') });
  if (profiles) checks.push({ label: 'Les listes de choix sont respectées', ok: !has('choice-outside') });
  if (access && access.hasRules) {
    checks.push(
      { label: 'Les conditions n\'utilisent que des attributs définis', ok: !has('acl-unknown-attribute') },
      { label: 'Les copies de tables protégées sont protégées', ok: !has('acl-copy-leak') },
      { label: 'Vous voyez tout ce que les règles protègent', ok: !has('acl-hidden') },
    );
    if (access.restrictsRead) checks.push({ label: 'Les données cachées ne sont pas lisibles par formule', ok: !has('acl-bypass') });
  }

  const blockingItems = active.filter((i) => i.severity === 'blocking');
  let verdict;
  if (counts.blocking) {
    const n = blockingItems.reduce((s, i) => s + Math.max(1, i.targets.length), 0);
    const parts = [
      blockingItems.some((i) => i.area === 'structure') ? 'des liens ou des colonnes ne fonctionnent pas comme prévu' : '',
      blockingItems.some((i) => i.area === 'access') ? 'des règles d\'accès ne protègent pas comme prévu' : '',
    ].filter(Boolean).join(', et ');
    verdict = { level: 'blocking', title: `${n} point${n > 1 ? 's' : ''} à corriger`, text: `${parts.charAt(0).toUpperCase()}${parts.slice(1)}. Suivez les étapes ci-dessous.` };
  } else {
    const rest = [
      counts.improve ? `${counts.improve} point${counts.improve > 1 ? 's' : ''} à améliorer` : '',
      counts.choice ? `${counts.choice} choix à confirmer` : '',
    ].filter(Boolean);
    verdict = { level: 'ready', title: 'Aucun point bloquant', text: rest.length ? `Le document fonctionne. ${rest.join(' et ')} ci-dessous.` : 'La structure et les droits d\'accès sont cohérents.' };
  }
  return { verdict, counts, items: active, accepted: acceptedItems, checks };
}

/** Étapes affichées sous « Sinon » : sans le « Sinon : » de tête, qui ferait doublon. */
export function stepsAfterIntended(it) {
  if (!it.intended) return it.steps;
  return it.steps.map((x) => x.replace(/^Sinon\s*[:,]\s*/, '').replace(/^./, (c) => c.toUpperCase()));
}

/** Libellé court d'une cible (« Table.colonne »). */
export function targetLabel(t) {
  return t.column ? `${t.table}.${t.column}` : t.table;
}
