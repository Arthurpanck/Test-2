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
import { accessInsights } from './access.js?v=3.18.0';
import { structureSmells } from './datacheck.js?v=3.18.0';
import { runAudit } from './audit-engine.js?v=3.18.0';
import { pageInsights } from './pages.js?v=3.18.0';

export const SEVERITIES = {
  blocking: { label: 'À corriger', order: 0 },
  improve: { label: 'À améliorer', order: 1 },
  choice: { label: 'Choix à confirmer', order: 2 },
  info: { label: 'Bon à savoir', order: 3 },
};
export const LEVELS = Object.keys(SEVERITIES);

const REFRESH_STEP = 'Revenez dans cette vue et cliquez sur « Relire le document ».';

/** Domaines des constats. */
export const AREAS = { structure: 'Structure', data: 'Données', access: "Droits d'accès", pages: 'Vues' };

/** Clé d'un constat, pour mémoriser qu'il est « voulu » : change si les éléments concernés changent. */
export function insightKey(it) {
  return `${it.id}${it.evidence ? ':v' + it.evidence.version + ':' + it.evidence.signature : ''}:${it.targets
    .map((t) => `${t.table}.${t.column || ''}`)
    .sort()
    .join('|')}`;
}

/**
 * @param {Array} tables   tables de la conversion ({ name, kind, columns: [{ name, base, isFormula, ref }] })
 * @param {object} [access] buildAccess() : ajoute les constats sur les droits d'accès
 * @param {object} [opts]  { profiles: profileTables(), accepted: Set de insightKey() }
 * @returns {{ verdict, counts, items, accepted, audit }}
 */
export function buildInsights(tables, access = null, { profiles = null, accepted = null, pages = null, audit = null } = {}) {
  const items = [];
  // 4. Colonnes vides (ni type ni formule), comme A, B, C d'une table créée par défaut.
  const empty = [];
  for (const t of tables)
    for (const c of t.columns)
      if (c.empty || c.gristType?.name === 'Any' || (c.isFormula && c.base === 'default')) empty.push({ table: t.name, column: c.name });
  if (empty.length) {
    items.push({
      id: 'empty',
      severity: 'blocking',
      title: empty.length > 1 ? `${empty.length} colonnes non typées` : 'Une colonne non typée',
      summary: 'Le type de ces colonnes est « Non défini », qu’elles contiennent une formule ou des valeurs saisies.',
      why: 'Un type explicite indique ce que la colonne doit contenir et permet un affichage, un tri et des calculs adaptés : texte, nombre, date, case à cocher ou référence.',
      steps: [
        'Si la colonne ne sert pas : clic droit sur son en-tête ▸ « Supprimer la colonne ».',
        'Sinon : renommez-la et choisissez son « Type de colonne » dans le panneau de droite.',
        REFRESH_STEP,
      ],
      targets: empty,
    });
  }

  // 6. Tables sans aucun lien.
  const linked = new Set();
  for (const t of tables)
    for (const c of t.columns)
      if (c.ref) {
        linked.add(t.name);
        linked.add(c.ref.table);
      }
  const isolated = tables.filter((t) => !linked.has(t.name)).map((t) => ({ table: t.name }));
  if (isolated.length && tables.length > 1) {
    items.push({
      id: 'isolated',
      severity: 'choice',
      title: isolated.length > 1 ? `${isolated.length} tables reliées à aucune autre` : 'Une table reliée à aucune autre',
      summary: 'Aucune colonne de référence ne relie ces tables au reste du document.',
      why: 'Les références relient différentes tables entre elles. Elles permettent de rapporter les informations de la table liée et d’éviter de les ressaisir, ainsi que de créer des vues reliées dynamiquement entre elles. Ne créez pas une table sans informations propres uniquement pour fournir une liste déroulante : les types Choix et Choix multiple sont prévus pour cela.',
      intended: 'Table de droit d’équipe : ne rien faire.',
      steps: [
        'Pour une simple liste déroulante, utilisez le type « Choix » ou « Choix multiple ». Si les options sont de vraies fiches à décrire, gardez une table et reliez-la avec une colonne « Référence ».',
        REFRESH_STEP,
      ],
      targets: isolated,
    });
  }

  for (const it of items) it.area = 'structure';
  items.push(...structureSmells(tables, profiles, access));
  items.push(...accessInsights(access));
  const auditResult = audit ? runAudit({ ...audit, access, pages }) : null;
  items.push(...pageInsights(pages).filter((i) => !(auditResult && i.id === 'table-without-page')));
  if (auditResult) items.push(...auditResult.items);
  items.sort((a, b) => SEVERITIES[a.severity].order - SEVERITIES[b.severity].order);

  const acceptedItems = accepted ? items.filter((it) => it.severity === 'choice' && accepted.has(insightKey(it))) : [];
  const active = items.filter((it) => !acceptedItems.includes(it));
  const counts = Object.fromEntries(LEVELS.map((l) => [l, 0]));
  for (const it of active) counts[it.severity] += 1;

  const blockingItems = active.filter((i) => i.severity === 'blocking');
  let verdict;
  if (counts.blocking) {
    // Le titre compte les constats (les cartes) : le même chiffre que l'onglet et le compteur « À corriger ».
    const n = counts.blocking;
    const parts = [
      blockingItems.some((i) => i.area === 'structure') ? 'des liens ou des colonnes ne fonctionnent pas comme prévu' : '',
      blockingItems.some((i) => i.area === 'data') ? 'des valeurs ou des calculs doivent être corrigés' : '',
      blockingItems.some((i) => i.area === 'access') ? "des droits d'accès doivent être vérifiés" : '',
      blockingItems.some((i) => i.area === 'pages') ? "des vues ne s'affichent pas comme prévu" : '',
    ].filter(Boolean);
    const sentence =
      parts.length > 1
        ? `${parts.slice(0, -1).join(', ')} et ${parts[parts.length - 1]}`
        : parts[0] || 'des éléments ne fonctionnent pas comme prévu';
    verdict = {
      level: 'blocking',
      title: `${n} point${n > 1 ? 's' : ''} à corriger`,
      text: `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}. Suivez les étapes ci-dessous.`,
    };
  } else {
    const rest = [
      counts.improve ? `${counts.improve} point${counts.improve > 1 ? 's' : ''} à améliorer` : '',
      counts.choice ? `${counts.choice} choix à confirmer` : '',
    ].filter(Boolean);
    verdict = {
      level: 'ready',
      title: 'Aucun problème bloquant détecté',
      text: rest.length ? `${rest.join(' et ')} dans les éléments analysés.` : 'Aucun problème détecté dans les éléments analysés.',
    };
  }
  return { verdict, counts, items: active, accepted: acceptedItems, audit: auditResult };
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
