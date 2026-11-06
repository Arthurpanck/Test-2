/**
 * Défauts courants d'un document qui a grandi sans plan, repérés à partir de la structure
 * et, quand elles sont lisibles, des données : noms par défaut,
 * nombres / dates / oui-non saisis en texte, valeurs répétées sans liste de choix, valeurs
 * hors liste, tables en double, tables vides, colonnes sans valeur dans les lignes lues, tables très larges.
 *
 * Module pur : testé sous Node.
 */
import { columnarToRows, fold, isVisibleColumn } from './util.js?v=3.18.0';

const MAX_DISTINCT = 2000;

const isEmpty = (v) =>
  v === null || v === undefined || v === '' || (Array.isArray(v) && (v.length === 0 || (v[0] === 'L' && v.length === 1)));
const NUMBER = /^-?\d{1,3}([  .]?\d{3})*([.,]\d+)?\s*(€|%)?$|^-?\d+([.,]\d+)?\s*(€|%)?$/;
const DATE = /^(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}-\d{2}-\d{2})$/;
const BOOL = new Set(['oui', 'non', 'vrai', 'faux', 'yes', 'no', 'true', 'false', 'x', 'o', 'n']);

/** Profil d'une colonne à partir de ses valeurs. */
export function profileValues(values) {
  const p = {
    total: values.length,
    filled: 0,
    text: 0,
    numeric: 0,
    date: 0,
    bool: 0,
    list: 0,
    distinct: new Set(),
    items: new Set(),
    choiceValues: new Set(),
    choiceItems: new Set(),
  };
  for (const v of values) {
    if (isEmpty(v)) continue;
    p.filled++;
    if (Array.isArray(v)) {
      // fetchTable encodes lists with L; accept decoded string arrays too, but not error/censored objects.
      const list =
        v[0] === 'L'
          ? v.slice(1)
          : v.every((x) => typeof x === 'string') && !['C', 'E', 'U', 'D', 'd', 'R', 'r', 'O'].includes(v[0])
            ? v
            : [];
      if (list.length && typeof list[0] === 'string')
        for (const item of list) {
          if (p.choiceItems.size >= MAX_DISTINCT) break;
          if (typeof item === 'string') p.choiceItems.add(item);
        }
      continue;
    }
    if (typeof v !== 'string') {
      if (p.distinct.size < MAX_DISTINCT) p.distinct.add(v);
      continue;
    }
    if (p.choiceValues.size < MAX_DISTINCT) p.choiceValues.add(v);
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
      if (!isVisibleColumn(colId)) continue;
      if (Array.isArray(values)) columns.set(colId, profileValues(values));
    }
    out.set(tableId, { rows: ids.length, columns });
  }
  return out;
}

// Codes qui ressemblent à des nombres mais doivent rester du texte (zéros en tête, pas de calcul).
const CODE_NAME =
  /^(cp|code.*|.*postal.*|tel|tel_.*|telephone.*|portable|mobile|siret|siren|iban|zip|numero.*|num_.*|ref|reference.*|matricule)$/;
const DEFAULT_COLUMN = /^([A-Z]|(Colonne|Column|Col|Champ)_?\d+|Col_[A-Z])$/;

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
  const prof = (t) => (profiles ? profiles.get(t.name) : null);
  const colProf = (t, c) => prof(t)?.columns.get(c.name) || null;
  const steps = (...s) => [...s, 'Revenez dans cette vue et cliquez sur « Relire le document ».'];

  // 1. Noms par défaut
  const defaults = [];
  for (const t of real) {
    for (const c of t.columns) if (!c.empty && DEFAULT_COLUMN.test(c.name)) defaults.push({ table: t.name, column: c.name });
  }
  if (defaults.length) {
    items.push({
      id: 'default-name',
      severity: 'blocking',
      title: defaults.length > 1 ? `${defaults.length} noms de colonnes laissés par défaut` : 'Un nom de colonne laissé par défaut',
      summary: 'Ces colonnes portent encore le nom donné automatiquement par Grist (A, B, Colonne1…).',
      why: 'Un nom parlant évite les erreurs dans les formules et rend le document compréhensible pour les autres.',
      steps: steps("Double-cliquez sur l'en-tête de la colonne pour lui donner un nom qui explique son rôle."),
      targets: defaults,
    });
  }

  // 3. Nombres, dates, oui/non saisis en texte ; valeurs répétées sans liste de choix
  const numbers = [];
  const booleans = [];
  const dates = [];
  const repeated = [];
  for (const t of real) {
    for (const c of t.columns) {
      if (c.isFormula || c.gristType?.name !== 'Text') continue;
      const p = colProf(t, c);
      if (!p || p.text < 3) continue;
      const isCode = CODE_NAME.test(fold(c.name));
      if (pct(p.date, p.text) >= 0.8) dates.push({ table: t.name, column: c.name, note: `dates (${p.date}/${p.text})` });
      else if (pct(p.bool, p.text) >= 0.9 && p.distinct.size <= 3) booleans.push({ table: t.name, column: c.name, note: 'oui / non' });
      else if (!isCode && pct(p.numeric, p.text) >= 0.8)
        numbers.push({ table: t.name, column: c.name, note: `nombres (${p.numeric}/${p.text})` });
      else if (p.text >= 6 && p.distinct.size <= 6 && p.distinct.size <= p.text / 3 && p.list === 0) {
        const lower = new Set([...p.distinct].map((v) => fold(v)));
        repeated.push({
          table: t.name,
          column: c.name,
          note: `${p.distinct.size} valeurs${lower.size < p.distinct.size ? ', dont des variantes de casse' : ''}`,
        });
      }
    }
  }
  const typeFindings = [
    {
      id: 'typed-as-text',
      targets: numbers,
      title:
        numbers.length > 1 ? `${numbers.length} colonnes devraient être de type numérique` : 'Une colonne devrait être de type numérique',
      summary: 'La plupart des valeurs ressemblent à des nombres, mais la colonne est de type Texte.',
      why: 'Le type numérique permet les sommes et le tri par valeur. En texte, le classement peut placer « 100 » avant « 20 ».',
      correction:
        'Dans le panneau Colonne, choisissez « Numérique » ou « Entier ». Contrôlez les séparateurs décimaux et les valeurs que Grist ne peut pas convertir.',
    },
    {
      id: 'boolean-as-text',
      targets: booleans,
      title:
        booleans.length > 1 ? `${booleans.length} colonnes devraient être de type booléen` : 'Une colonne devrait être de type booléen',
      summary: 'La plupart des valeurs expriment oui ou non, mais elles sont conservées dans une colonne de texte.',
      why: 'Une case à cocher représente clairement deux états et évite les variantes comme « oui », « Oui » ou « vrai ».',
      correction:
        'Dans le panneau Colonne, choisissez « Booléen » et un affichage en case à cocher. Vérifiez que oui devient coché et non devient décoché ; ne transformez pas une valeur inconnue en non.',
    },
    {
      id: 'date-as-text',
      targets: dates,
      title: dates.length > 1 ? `${dates.length} colonnes devraient être de type date` : 'Une colonne devrait être de type date',
      summary: 'La plupart des textes ont une forme de date, mais la colonne est de type Texte.',
      why: 'Le type Date permet un classement chronologique et les calculs de durée.',
      correction:
        'Dans le panneau Colonne, choisissez « Date » et le format adapté à la source. Vérifiez plusieurs jours connus, notamment les dates comme 03/04/2026.',
    },
  ];
  for (const finding of typeFindings)
    if (finding.targets.length) {
      const { correction, ...fields } = finding;
      items.push({
        ...fields,
        severity: 'improve',
        steps: steps(
          'Sélectionnez la colonne concernée.',
          correction,
          'Contrôlez les valeurs signalées en rouge avant de valider la conversion.',
        ),
      });
    }
  if (repeated.length) {
    items.push({
      id: 'text-choice',
      severity: 'improve',
      title: repeated.length > 1 ? `${repeated.length} colonnes devraient être de type choix` : 'Une colonne devrait être de type choix',
      summary: 'Cette colonne de texte sert à sélectionner quelques catégories qui reviennent souvent, comme un statut ou un service.',
      why: 'Une liste de choix évite les variantes (« en cours » / « En cours ») et colore les valeurs.',
      steps: steps(
        'Sélectionnez la colonne et choisissez le Type de colonne « Choix unique » si chaque cellule contient une seule catégorie. Préparez la liste des valeurs autorisées. Pour plusieurs catégories dans une même cellule, utilisez « Choix multiple ».',
      ),
      targets: repeated,
    });
  }

  // 4. Valeurs hors de la liste de choix
  const outside = [];
  for (const t of real) {
    for (const c of t.columns) {
      if (!['Choice', 'ChoiceList'].includes(c.gristType?.name) || !c.details?.choices.length) continue;
      const p = colProf(t, c);
      if (!p) continue;
      const allowed = new Set(c.details.choices);
      const candidates = c.gristType.name === 'ChoiceList' ? p.choiceItems : p.choiceValues;
      const extra = [...(candidates || [])].filter((v) => typeof v === 'string' && !allowed.has(v));
      if (extra.length) outside.push({ table: t.name, column: c.name, note: extra.slice(0, 3).join(', ') });
    }
  }
  if (outside.length) {
    items.push({
      id: 'choice-outside',
      severity: 'blocking',
      area: 'data',
      title: 'Des modalités manquent dans la liste des choix',
      summary:
        'Certaines valeurs utilisées ne figurent pas dans les modalités proposées par leur colonne de type Choix unique ou Choix multiple.',
      why: 'La liste proposée ne correspond plus aux valeurs utilisées. Une modalité utile doit être ajoutée ; une faute ou une variante doit être corrigée pour conserver des catégories cohérentes.',
      steps: steps('Ajoutez la valeur à la liste (panneau de droite, « Choix »), ou corrigez les cellules concernées.'),
      targets: outside,
    });
  }

  // 6. Tables vides, colonnes sans valeur dans les lignes lues (d'après les données lisibles)
  if (profiles) {
    const empty = real.filter((t) => prof(t) && prof(t).rows === 0).map((t) => ({ table: t.name }));
    if (empty.length) {
      items.push({
        id: 'empty-table',
        severity: 'blocking',
        title: empty.length > 1 ? `${empty.length} tables sans aucune ligne` : 'Une table sans aucune ligne',
        summary: 'Ces tables ne contiennent aucune ligne.',
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
        id: 'never-filled',
        severity: 'blocking',
        title: unused.length > 1 ? `${unused.length} colonnes vides` : 'Une colonne vide',
        summary: 'Ces colonnes ne contiennent aucune valeur.',
        why: 'Elles alourdissent la saisie et les exports sans rien apporter.',
        intended: 'Colonne prévue pour plus tard, ou remplie seulement dans certains cas : rien à faire.',
        steps: steps("Sinon : clic droit sur l'en-tête de la colonne ▸ « Supprimer la colonne »."),
        targets: unused,
      });
    }
  }

  // 7. Tables très larges
  const wide = real.filter((t) => t.columns.length > 20).map((t) => ({ table: t.name, note: `${t.columns.length} colonnes` }));
  if (wide.length) {
    items.push({
      id: 'wide-table',
      severity: 'choice',
      title: 'Table avec de nombreuses colonnes (plus de 20 colonnes)',
      summary: 'Ces tables contiennent plus de 20 colonnes.',
      why: 'Grist repose sur un modèle de base de données : chaque table décrit une entité, par exemple des clients, des commandes ou des produits. Une très grande table mélange souvent plusieurs entités ; répartissez-les dans des tables plus petites reliées par des références. Pour plusieurs modalités d’une même information, utilisez une colonne Choix multiple plutôt que Choix_1, Choix_2, Choix_3. Pour plusieurs fiches ou événements ayant leurs propres informations, créez des lignes dans une table liée.',
      intended:
        'La table provient d’une requête ou d’un export d’un autre système d’information et doit en conserver la structure : gardez la table source si nécessaire, puis préparez des vues et des tables adaptées aux usages dans Grist.',
      steps: steps(
        'Repérez les entités mélangées dans la table : clients, commandes, produits ou événements.',
        'Créez une table par entité et reliez les fiches avec des colonnes Référence.',
        'Remplacez les colonnes de modalités numérotées par un Choix multiple. Si chaque élément possède ses propres dates, montants ou autres informations, utilisez une table liée avec une ligne par élément.',
      ),
      targets: wide,
    });
  }
  return items.map((it) => ({ area: 'structure', ...it }));
}
