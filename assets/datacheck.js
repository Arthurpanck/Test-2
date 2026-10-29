/**
 * Défauts courants d'un document qui a grandi sans plan, repérés à partir de la structure
 * et, quand elles sont lisibles, des données : noms par défaut, liens écrits en texte,
 * nombres / dates / oui-non saisis en texte, valeurs répétées sans liste de choix, valeurs
 * hors liste, tables en double, tables vides, colonnes sans valeur dans les lignes lues, tables très larges.
 *
 * Module pur : testé sous Node.
 */
import { columnarToRows } from './converter.js?v=3.1.0';

const MAX_DISTINCT = 2000;

const isEmpty = (v) => v === null || v === undefined || v === '' || (Array.isArray(v) && (v.length === 0 || (v[0] === 'L' && v.length === 1)));
const NUMBER = /^-?\d{1,3}([  .]?\d{3})*([.,]\d+)?\s*(€|%)?$|^-?\d+([.,]\d+)?\s*(€|%)?$/;
const DATE = /^(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}-\d{2}-\d{2})$/;
const BOOL = new Set(['oui', 'non', 'vrai', 'faux', 'yes', 'no', 'true', 'false', 'x', 'o', 'n']);

/** Profil d'une colonne à partir de ses valeurs. */
export function profileValues(values) {
  const p = { total: values.length, filled: 0, text: 0, numeric: 0, date: 0, bool: 0, list: 0, distinct: new Set(), items: new Set() };
  for (const v of values) {
    if (isEmpty(v)) continue;
    p.filled++;
    if (typeof v !== 'string') { if (p.distinct.size < MAX_DISTINCT) p.distinct.add(v); continue; }
    const s = v.trim();
    p.text++;
    if (p.distinct.size < MAX_DISTINCT) p.distinct.add(s);
    if (NUMBER.test(s)) p.numeric++;
    if (DATE.test(s)) p.date++;
    if (BOOL.has(s.toLowerCase())) p.bool++;
    if (/,\s*\S/.test(s)) {
      p.list++;
      for (const part of s.split(',')) if (part.trim() && p.items.size < MAX_DISTINCT) p.items.add(part.trim());
    }
  }
  return p;
}

/**
 * Profil des tables lues avec docApi.fetchTable().
 * @param {object} data  { tableId: données colonnaires }
 * @returns {Map} tableId → { rows, columns: Map colId → profil }
 */
export function profileTables(data) {
  const out = new Map();
  for (const [tableId, columnar] of Object.entries(data || {})) {
    if (!columnar) continue;
    const ids = Array.isArray(columnar.id) ? columnar.id : columnarToRows(columnar).map((r) => r.id);
    const columns = new Map();
    for (const [colId, values] of Object.entries(columnar)) {
      if (colId === 'id' || colId === 'manualSort' || colId.startsWith('gristHelper_')) continue;
      if (Array.isArray(values)) columns.set(colId, profileValues(values));
    }
    out.set(tableId, { rows: ids.length, columns });
  }
  return out;
}

const fold = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** Nom de table ramené à un radical : « Clients » → « client », « Services » → « service ». */
function stem(name) {
  let s = fold(name).replace(/^(id_|ref_|code_)/, '').replace(/(_id|_ref|_nom|_name|_code|_num)$/, '');
  if (s.length > 3 && /[sx]$/.test(s)) s = s.slice(0, -1);
  return s;
}
const baseName = (name) => fold(name).replace(/(_?(copie|copy|old|ancien|backup|bak|test|archive|import|v\d+)|_?\d{2,4}|_\d+)$/, '');

// Codes qui ressemblent à des nombres mais doivent rester du texte (zéros en tête, pas de calcul).
const CODE_NAME = /^(cp|code.*|.*postal.*|tel|tel_.*|telephone.*|portable|mobile|siret|siren|iban|zip|numero.*|num_.*|ref|reference.*|matricule)$/;
const DEFAULT_COLUMN = /^([A-Z]|(Colonne|Column|Col|Champ)_?\d+|Col_[A-Z])$/;

const label = (t, c) => (c ? `${t}.${c}` : t);
const pct = (a, b) => (b ? a / b : 0);

/**
 * Constats de structure tirés des conventions et des données.
 * @param {Array} tables    tables de sortie du convertisseur
 * @param {Map} [profiles]  profileTables()
 * @param {object} [access] buildAccess() (pour repérer une copie non protégée)
 */
export function structureSmells(tables, profiles = null, access = null) {
  const items = [];
  const real = tables.filter((t) => t.kind !== 'summary');
  const byStem = new Map(real.map((t) => [stem(t.name), t]));
  const prof = (t) => (profiles ? profiles.get(t.name) : null);
  const colProf = (t, c) => prof(t)?.columns.get(c.name) || null;
  const steps = (...s) => [...s, 'Revenez dans ce widget et cliquez sur « Relire le document ».'];

  // Valeurs de référence de chaque table : sa première colonne de texte (celle que Grist propose
  // d'afficher), si elle identifie bien les lignes (valeurs presque toutes différentes).
  const keys = [];
  const keyOf = new Map();
  for (const t of real) {
    const p = prof(t);
    if (!p || !p.rows) continue;
    const key = t.columns.find((c) => !c.isFormula && c.gristType?.name === 'Text');
    const kp = key && p.columns.get(key.name);
    if (!kp) continue;
    keyOf.set(t.name, key.name);
    const unique = kp.distinct.size >= 3 && kp.distinct.size >= 0.8 * kp.filled;
    const plain = kp.bool < kp.text / 2 && kp.numeric < kp.text / 2 && kp.date < kp.text / 2;
    if (unique && plain) keys.push({ table: t.name, column: key.name, values: kp.distinct });
  }

  // 1. Noms par défaut
  const defaults = [];
  for (const t of real) {
    for (const c of t.columns) if (!c.empty && DEFAULT_COLUMN.test(c.name)) defaults.push({ table: t.name, column: c.name });
  }
  if (defaults.length) {
    items.push({
      id: 'default-name', severity: 'improve',
      title: defaults.length > 1 ? `${defaults.length} noms de colonnes laissés par défaut` : 'Un nom de colonne laissé par défaut',
      summary: 'Ces colonnes portent encore le nom donné automatiquement par Grist (A, B, Colonne1…).',
      why: 'Un nom parlant évite les erreurs dans les formules et rend le document compréhensible pour les autres.',
      steps: steps('Double-cliquez sur l\'en-tête de la colonne pour lui donner un nom qui explique son rôle.'),
      targets: defaults,
    });
  }

  // 2. Liens écrits en texte (ou en nombre) au lieu d'une colonne de référence
  const links = [];
  for (const t of real) {
    for (const c of t.columns) {
      const type = c.gristType?.name;
      if (c.isFormula || c.ref || !['Text', 'Int', 'Numeric', 'Choice', 'Any'].includes(type)) continue;
      const p = colProf(t, c);
      const byName = byStem.get(stem(c.name));
      // La colonne qui nomme les lignes de sa propre table n'est pas un lien… sauf si elle porte le nom d'une autre table.
      if (keyOf.get(t.name) === c.name && !(byName && byName.name !== t.name)) continue;
      let hit = null;
      if (p && p.text >= 2) {
        const vals = [...p.distinct].filter((v) => typeof v === 'string');
        const items2 = [...p.items];
        const hits = [];
        for (const k of keys) {
          if (k.table === t.name && k.column === c.name) continue;
          const single = vals.filter((v) => k.values.has(v)).length;
          if (vals.length >= 2 && pct(single, vals.length) >= 0.8) hits.push({ target: k.table, by: k.column, many: false, data: true, score: pct(single, vals.length) });
          else if (p.list >= 1 && items2.length >= 2 && pct(items2.filter((v) => k.values.has(v)).length, items2.length) >= 0.8) hits.push({ target: k.table, by: k.column, many: true, data: true, score: 0.8 });
        }
        hit = hits.find((h) => byName && h.target === byName.name) || hits.sort((a, b) => b.score - a.score)[0] || null;
      }
      if (!hit && byName && byName.name !== t.name && (type === 'Text' || type === 'Int')) hit = { target: byName.name, by: null, many: false, data: false };
      if (hit) links.push({ table: t.name, column: c.name, note: `vers ${hit.target}${hit.many ? ' (plusieurs)' : ''}`, hit });
    }
  }
  if (links.length) {
    items.push({
      id: 'text-ref', severity: 'improve',
      title: links.length > 1 ? `${links.length} liens écrits à la main au lieu d'une référence` : 'Un lien écrit à la main au lieu d\'une référence',
      summary: 'Ces colonnes contiennent le nom (ou le numéro) d\'une ligne d\'une autre table, saisi à la main.',
      why: 'Une faute de frappe ou un renommage casse le lien sans prévenir, et le schéma ne montre pas la relation. Une colonne « Référence » garde le lien à jour et permet les formules comme $Client.Ville.',
      steps: steps(
        'Sélectionnez la colonne, puis dans le panneau de droite choisissez le Type de colonne « Référence » (ou « Référence multiple » pour une liste).',
        'Choisissez la table visée et la colonne à afficher : Grist convertit les valeurs existantes et signale celles qu\'il ne trouve pas.',
      ),
      targets: links.map(({ table, column, note }) => ({ table, column, note })),
    });
  }

  // 3. Nombres, dates, oui/non saisis en texte ; valeurs répétées sans liste de choix
  const typed = [];
  const repeated = [];
  for (const t of real) {
    for (const c of t.columns) {
      if (c.isFormula || c.gristType?.name !== 'Text' || links.some((l) => l.table === t.name && l.column === c.name)) continue;
      const p = colProf(t, c);
      if (!p || p.text < 3) continue;
      const isCode = CODE_NAME.test(fold(c.name));
      if (pct(p.date, p.text) >= 0.8) typed.push({ table: t.name, column: c.name, note: `dates (${p.date}/${p.text})` });
      else if (pct(p.bool, p.text) >= 0.9 && p.distinct.size <= 3) typed.push({ table: t.name, column: c.name, note: 'oui / non' });
      else if (!isCode && pct(p.numeric, p.text) >= 0.8) typed.push({ table: t.name, column: c.name, note: `nombres (${p.numeric}/${p.text})` });
      else if (p.text >= 6 && p.distinct.size <= 6 && p.distinct.size <= p.text / 3 && p.list === 0) {
        const lower = new Set([...p.distinct].map((v) => fold(v)));
        repeated.push({ table: t.name, column: c.name, note: `${p.distinct.size} valeurs${lower.size < p.distinct.size ? ', dont des variantes de casse' : ''}` });
      }
    }
  }
  if (typed.length) {
    items.push({
      id: 'typed-as-text', severity: 'improve',
      title: typed.length > 1 ? `${typed.length} colonnes de nombres, dates ou oui/non saisies en texte` : 'Une colonne de nombres, dates ou oui/non saisie en texte',
      summary: 'Le contenu ressemble à des nombres, des dates ou des oui/non, mais la colonne est de type Texte.',
      why: 'En texte, on ne peut ni additionner, ni trier par date, ni filtrer correctement ; « deux » ou « 12,5 » passent sans alerte.',
      steps: steps(
        'Sélectionnez la colonne et choisissez le Type de colonne adapté : Numérique, Date ou Booléen.',
        'Grist montre un aperçu de la conversion : corrigez les valeurs qu\'il ne sait pas convertir (affichées en rouge).',
      ),
      targets: typed,
    });
  }
  if (repeated.length) {
    items.push({
      id: 'text-choice', severity: 'improve',
      title: repeated.length > 1 ? `${repeated.length} colonnes de texte qui devraient être des listes de choix` : 'Une colonne de texte qui devrait être une liste de choix',
      summary: 'Quelques valeurs reviennent sans cesse (statut, catégorie…), tapées à la main.',
      why: 'Une liste de choix évite les variantes (« en cours » / « En cours ») et colore les valeurs.',
      steps: steps('Sélectionnez la colonne et choisissez le Type de colonne « Choix unique » : Grist propose les valeurs existantes comme liste.'),
      targets: repeated,
    });
  }

  // 4. Valeurs hors de la liste de choix
  const outside = [];
  for (const t of real) {
    for (const c of t.columns) {
      if (c.gristType?.name !== 'Choice' || !c.details?.choices.length) continue;
      const p = colProf(t, c);
      if (!p) continue;
      const extra = [...p.distinct].filter((v) => typeof v === 'string' && !c.details.choices.includes(v));
      if (extra.length) outside.push({ table: t.name, column: c.name, note: extra.slice(0, 3).join(', ') });
    }
  }
  if (outside.length) {
    items.push({
      id: 'choice-outside', severity: 'improve',
      title: outside.length > 1 ? `${outside.length} listes de choix contournées` : 'Une liste de choix contournée',
      summary: 'Des cellules contiennent une valeur qui n\'est pas dans la liste de choix de la colonne.',
      why: 'Ces valeurs personnalisées ne figurent pas parmi les choix proposés. Vérifiez s’il s’agit de nouvelles catégories utiles ou de variantes de saisie.',
      steps: steps('Ajoutez la valeur à la liste (panneau de droite, « Choix »), ou corrigez les cellules concernées.'),
      targets: outside,
    });
  }

  // 5. Tables en double, et copie non protégée d'une table protégée
  const dups = [];
  for (let i = 0; i < real.length; i++) {
    for (let j = i + 1; j < real.length; j++) {
      const a = real[i]; const b = real[j];
      const meaningful = (cols) => cols.filter((c) => !c.empty && !DEFAULT_COLUMN.test(c.name)).map((c) => c.name);
      const ca = new Set(meaningful(a.columns)); const cb = meaningful(b.columns);
      const shared = cb.filter((c) => ca.has(c)).length;
      const small = Math.min(ca.size, cb.length);
      const sameBase = baseName(a.name) === baseName(b.name) || baseName(a.name).startsWith(baseName(b.name)) || baseName(b.name).startsWith(baseName(a.name));
      if ((small >= 3 && pct(shared, small) >= 0.8) || (sameBase && shared >= 2)) {
        const [orig, copy] = a.name.length <= b.name.length ? [a, b] : [b, a];
        dups.push({ orig: orig.name, copy: copy.name, shared });
      }
    }
  }
  const others = dups;
  if (others.length) {
    items.push({
      id: 'duplicate-table', severity: 'choice',
      title: others.length > 1 ? `${others.length} paires de tables de structure similaire` : 'Structures de deux tables similaires',
      summary: 'Deux tables partagent une grande partie de leurs colonnes, ou des noms et des colonnes proches. Leurs données ne sont pas comparées.',
      why: 'Une structure similaire peut être utile, mais elle peut aussi indiquer des tables créées pour des variantes d’un même besoin. Vérifiez leur rôle avant de les rapprocher.',
      intended: 'Archive volontaire (une année close, par exemple) : rien à faire, mais protégez-la comme l\'originale.',
      steps: steps('Sinon : gardez une seule table, et distinguez les versions par une colonne (Année, Statut…).', 'Supprimez la copie une fois les données regroupées.'),
      targets: others.map((d) => ({ table: d.copy, note: `≈ ${d.orig}` })),
    });
  }

  // 6. Tables vides, colonnes sans valeur dans les lignes lues (d'après les données lisibles)
  if (profiles) {
    const masked = (name) => (access?.tables || []).some((t) => t.tableId === name && [...t.rules, ...t.columns.flatMap((c) => c.rules)].some((r) => r.perms.R === 'deny'));
    const empty = real.filter((t) => prof(t) && prof(t).rows === 0).map((t) => ({ table: t.name, note: masked(t.name) ? 'ou lignes masquées pour vous par les droits d’accès' : undefined }));
    if (empty.length) {
      items.push({
        id: 'empty-table', severity: 'choice',
        title: empty.length > 1 ? `${empty.length} tables sans aucune ligne` : 'Une table sans aucune ligne',
        summary: 'Ces tables ne contiennent aucune ligne que vous puissiez voir : vides, ou entièrement masquées pour vous par les droits d’accès d\'accès.',
        why: 'Une table abandonnée encombre le document et le schéma.',
        intended: 'Table prête à recevoir des données, ou remplie par un import régulier : rien à faire.',
        steps: steps('Sinon : supprimez-la (« Données brutes » dans le menu de gauche ▸ menu de la table ▸ Supprimer).'),
        targets: empty,
      });
    }
    const unused = [];
    for (const t of real) {
      const p = prof(t);
      if (!p || !p.rows) continue;
      for (const c of t.columns) {
        if (c.isFormula || c.empty) continue;
        const cp = p.columns.get(c.name);
        if (cp && cp.filled === 0 && !p.sampled) unused.push({ table: t.name, column: c.name });
      }
    }
    if (unused.length) {
      items.push({
        id: 'never-filled', severity: 'choice',
        title: unused.length > 1 ? `${unused.length} colonnes sans valeur dans les lignes lues` : 'Une colonne sans valeur dans les lignes lues',
        summary: 'Ces colonnes sont vides parmi toutes les lignes que le widget a pu lire. Des valeurs peuvent exister sur des lignes masquées.',
        why: 'Elles alourdissent la saisie et les exports sans rien apporter.',
        intended: 'Colonne prévue pour plus tard, ou remplie seulement dans certains cas : rien à faire.',
        steps: steps('Sinon : clic droit sur l\'en-tête de la colonne ▸ « Supprimer la colonne ».'),
        targets: unused,
      });
    }
  }

  // 7. Tables très larges
  const wide = real.filter((t) => t.columns.length > 30).map((t) => ({ table: t.name, note: `${t.columns.length} colonnes` }));
  if (wide.length) {
    items.push({
      id: 'wide-table', severity: 'choice',
      title: wide.length > 1 ? `${wide.length} tables très larges` : 'Une table très large',
      summary: 'Ces tables ont plus de 30 colonnes.',
      why: 'Souvent le signe de plusieurs sujets mélangés, ou de colonnes numérotées (Champ_1, Champ_2…) qui devraient être des lignes d\'une autre table.',
      intended: 'Fiche complète d\'un même objet : rien à faire.',
      steps: steps('Sinon : déplacez les colonnes d\'un même sujet dans une nouvelle table, reliée par une colonne « Référence ».'),
      targets: wide,
    });
  }
  // 8. Attributs utilisateur qui ne trouveront personne, ou que rien n'utilise.
  if (access && access.attributes.length) {
    const formulas = [...access.defaults, ...access.tables.flatMap((t) => [...t.rules, ...t.columns.flatMap((c) => c.rules)]), ...access.special.flatMap((sp) => sp.rules)].map((r) => r.formula).join('\n');
    const unusedAttrs = [];
    for (const a of access.attributes) {
      if (a.problems.length) continue;
      if (!new RegExp(`\\buser\\.${a.name}\\b`).test(formulas)) unusedAttrs.push({ table: a.tableId, note: `user.${a.name}` });
    }
    if (unusedAttrs.length) {
      items.push({
        id: 'acl-attr-unused', severity: 'info', area: 'access',
        title: unusedAttrs.length > 1 ? `${unusedAttrs.length} attributs utilisateur inutilisés` : 'Un attribut utilisateur inutilisé',
        summary: 'Aucun droit d’accès ne se sert de ces attributs.',
        why: 'Ils peuvent être supprimés pour simplifier les règles d\'accès.',
        steps: [],
        targets: unusedAttrs,
      });
    }
  }
  return items.map((it) => ({ area: 'structure', ...it }));
}


