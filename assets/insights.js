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
import { accessInsights } from './access.js?v=3.1.0';
import { structureSmells } from './datacheck.js?v=3.1.0';
import { runAudit } from './audit-engine.js?v=3.1.0';
import { pageInsights } from './pages.js?v=3.1.0';
import { REMOVED_FINDING_IDS } from './audit-policy.js?v=3.1.0';


export const SEVERITIES = {
  blocking: { label: 'À corriger', order: 0 },
  improve: { label: 'À améliorer', order: 1 },
  choice: { label: 'Choix à confirmer', order: 2 },
  info: { label: 'Bon à savoir', order: 3 },
};
export const LEVELS = Object.keys(SEVERITIES);

const REFRESH_STEP = 'Revenez dans ce widget et cliquez sur « Relire le document ».';

/** Domaines des constats. */
export const AREAS = { structure: 'Structure', data: 'Données', access: 'Droits d\'accès', pages: 'Widgets' };

/** Clé d'un constat, pour mémoriser qu'il est « voulu » : change si les éléments concernés changent. */
export function insightKey(it) {
  return `${it.id}${it.evidence ? ':v' + it.evidence.version + ':' + it.evidence.signature : ''}:${it.targets.map((t) => `${t.table}.${t.column || ''}`).sort().join('|')}`;
}

/**
 * @param {Array} tables   tables de la conversion ({ name, kind, columns: [{ name, base, isFormula, ref }] })
 * @param {object} [access] buildAccess() : ajoute les constats sur les droits d'accès
 * @param {object} [opts]  { profiles: profileTables(), accepted: Set de insightKey() }
 * @returns {{ verdict, counts, items, accepted, checks }}
 */
export function buildInsights(tables, access = null, { profiles = null, accepted = null, pages = null, audit = null } = {}) {
  const items = [];
  // 4. Colonnes vides (ni type ni formule), comme A, B, C d'une table créée par défaut.
  const empty = [];
  for (const t of tables) for (const c of t.columns) if (c.empty) empty.push({ table: t.name, column: c.name });
  if (empty.length) {
    items.push({
      id: 'empty', severity: 'improve',
      title: empty.length > 1 ? `${empty.length} colonnes non typées` : 'Une colonne non typée',
      summary: 'Le type de ces colonnes est « Non défini » et elles ne contiennent pas de formule. Cela ne prouve pas qu’elles n’ont jamais servi.',
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
      why: 'Dans Grist, contrairement à un tableur classique, une liste déroulante simple ne nécessite pas une table dédiée : les types Choix et Choix multiple suffisent. Une table de référence reste utile si chaque option possède ses propres informations.',
      intended: 'Table de paramètres, de notes ou journal indépendant : rien à faire.',
      steps: [
        'Pour une simple liste déroulante, utilisez le type « Choix » ou « Choix multiple ». Si les options sont de vraies fiches à décrire, gardez une table et reliez-la avec une colonne « Référence ».',
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
  const auditResult = audit ? runAudit({ ...audit, access, pages }) : null;
  items.push(...pageInsights(pages).filter(i => !(auditResult && i.id === 'table-without-page')));
  if (auditResult) items.push(...auditResult.items);
  // Les doublons de choix multiples remplacent la carte générique sur les mêmes colonnes.
  if (auditResult?.items.some(i => i.id === 'N64')) { /* ChoiceList est traité uniquement par le moteur détaillé. */ }
  for (let i=items.length-1;i>=0;i--) if(REMOVED_FINDING_IDS.has(items[i].id)) items.splice(i,1);
  items.sort((a, b) => SEVERITIES[a.severity].order - SEVERITIES[b.severity].order);

  const acceptedItems = accepted ? items.filter((it) => it.severity === 'choice' && accepted.has(insightKey(it))) : [];
  const active = items.filter((it) => !acceptedItems.includes(it));
  const counts = Object.fromEntries(LEVELS.map((l) => [l, 0]));
  for (const it of active) counts[it.severity] += 1;

  const has = (id) => items.some((i) => i.id === id);
  const checks = [
    { id: 'text-ref', label: 'Les relations utilisent des colonnes de référence' },
  ];
  if (profiles) checks.push({ id: 'typed-as-text', label: 'Nombres, dates et oui/non ont le bon type' });
  if (profiles) checks.push({ id: 'choice-outside', label: 'Les listes de choix sont respectées' });
  if (access && access.hasRules) {
    checks.push(
      { id: 'acl-unknown-attribute', label: 'Les conditions n\'utilisent que des attributs définis' },
      { id: 'acl-hidden', label: 'Les éléments des droits d’accès sont lisibles dans le périmètre de l’audit' },
    );
    if (access.restrictsRead) checks.push({ id: 'acl-bypass', label: 'Les données cachées ne sont pas lisibles par formule' });
  }
  if (pages) checks.push({ id: 'widget-unmapped', label: 'Les widgets personnalisés ont leurs colonnes' });
  // ok : aucun constat de ce contrôle (y compris les choix confirmés, qui restent des constats).
  for (const c of checks) c.ok = !has(c.id);

  const blockingItems = active.filter((i) => i.severity === 'blocking');
  let verdict;
  if (counts.blocking) {
    // Le titre compte les constats (les cartes) : le même chiffre que l'onglet et le compteur « À corriger ».
    const n = counts.blocking;
    const parts = [
      blockingItems.some((i) => i.area === 'structure') ? 'des liens ou des colonnes ne fonctionnent pas comme prévu' : '',
      blockingItems.some((i) => i.area === 'data') ? 'des valeurs ou des calculs doivent être corrigés' : '',
      blockingItems.some((i) => i.area === 'access') ? 'des droits d\'accès doivent être vérifiés' : '',
      blockingItems.some((i) => i.area === 'pages') ? 'des widgets ne s\'affichent pas comme prévu' : '',
    ].filter(Boolean);
    const sentence = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} et ${parts[parts.length - 1]}` : (parts[0] || 'des éléments ne fonctionnent pas comme prévu');
    verdict = { level: 'blocking', title: `${n} point${n > 1 ? 's' : ''} à corriger`, text: `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}. Suivez les étapes ci-dessous.` };
  } else {
    const rest = [
      counts.improve ? `${counts.improve} point${counts.improve > 1 ? 's' : ''} à améliorer` : '',
      counts.choice ? `${counts.choice} choix à confirmer` : '',
    ].filter(Boolean);
    verdict = { level: 'ready', title: 'Aucun problème bloquant détecté', text: rest.length ? `${rest.join(' et ')} dans les éléments analysés.` : 'Aucun problème détecté dans les éléments analysés.' };
  }
  return { verdict, counts, items: active, accepted: acceptedItems, checks, audit: auditResult };
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


