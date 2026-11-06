/** Références, recherches et récapitulations. Grammaire fermée : aucun Python exécuté. */
export const USAGE_IDS = ['U01', 'U02', 'U03', 'U06', 'U07'];
export const USAGE_LIMITS = Object.freeze({
  tables: 200,
  columns: 10000,
  calls: 100,
  sourceRows: 200,
  targetRows: 2000,
  indexCells: 100000,
  formulaChars: 200000,
  targets: 100,
});
import { columnarToRows as metadataRows, TECHNICAL_COLUMN as TECH, splitColType } from './util.js';
import { scanPython, splitTopLevel } from './python-text.js';
const NAME = /^[A-Za-z_]\w*$/;
const isFormula = (c) => Boolean(c.isFormula && String(c.formula || '').trim());
const type = (c) => splitColType(c.type).base;
const destination = (c) => splitColType(c.type).arg;
const list = (v) => (Array.isArray(v) && v[0] === 'L' ? v.slice(1) : Array.isArray(v) && v[0] === 'r' && Array.isArray(v[2]) ? v[2] : null);
const scalar = (v) => (Array.isArray(v) && v[0] === 'R' ? v[2] : v);
const usable = (v) => v !== null && v !== undefined && v !== '' && !Array.isArray(v) && (typeof v !== 'number' || Number.isFinite(v));
const keyOf = (a) => JSON.stringify(a);
/** Expression sans commentaires ni « return » ; null si une chaîne est triple ou ne se referme pas. */
function comments(code) {
  const sc = scanPython(code);
  if (sc.hasTriple || sc.unterminated) return null;
  return sc.stripped.trim().replace(/^return\s+/, '');
}
/** Arguments de premier niveau (au plus 8) ; null si une chaîne ne se referme pas. */
function splitArgs(s) {
  const sc = scanPython(s);
  if (sc.unterminated) return null;
  const out = [];
  let at = 0;
  for (const part of splitTopLevel(sc.masked)) {
    out.push(s.slice(at, at + part.length).trim());
    at += part.length + 1;
  }
  if (out.length && !out[out.length - 1]) out.pop();
  return out.length <= 8 ? out : null;
}
/** Une expression entière, avec égalités simples ; jamais une occurrence dans une chaîne. */
export function parseUsageLookup(code) {
  if (typeof code !== 'string' || code.length > 8192) return null;
  let expr = comments(code);
  if (!expr) return null;
  let aggregate = null;
  const outer = /^(SUM|AVERAGE|MIN|MAX|COUNT|len)\s*\(([\s\S]*)\)$/.exec(expr);
  if (outer) {
    aggregate = outer[1];
    expr = outer[2].trim();
  }
  const m = /^([A-Za-z_]\w*)\.(lookupOne|lookupRecords)\s*\(([\s\S]*)\)\s*(?:\.\s*([A-Za-z_]\w*))?$/.exec(expr);
  if (!m) return null;
  const args = splitArgs(m[3]);
  if (!args) return null;
  const terms = [];
  const seen = new Set();
  for (const arg of args) {
    const a = /^([A-Za-z_]\w*)\s*=\s*([\s\S]+)$/.exec(arg);
    if (!a || ['order_by', 'sort_by'].includes(a[1]) || seen.has(a[1])) return null;
    seen.add(a[1]);
    const value = a[2].trim();
    const local = /^\$([A-Za-z_]\w*)(?:\.([A-Za-z_]\w*))?$/.exec(value);
    const literal = /^(['"])([^'"\\]{0,120})\1$/.exec(value);
    if (local) terms.push({ key: a[1], local: local[1], field: local[2] || null });
    else if (/^-?\d+(?:\.\d+)?$/.test(value)) terms.push({ key: a[1], value: Number(value) });
    else if (value === 'True' || value === 'False') terms.push({ key: a[1], value: value === 'True' });
    else if (literal) terms.push({ key: a[1], value: literal[2] });
    else return null;
  }
  return { table: m[1], method: m[2], field: m[4] || null, aggregate, terms };
}
function selectedAggregate(code) {
  const expr = comments(String(code || ''));
  const m = /^(SUM|AVERAGE|MIN|MAX|COUNT|len)\s*\(\s*\$([A-Za-z_]\w*)(?:\.([A-Za-z_]\w*))?\s*\)$/.exec(expr || '');
  return m ? { aggregate: m[1], selection: m[2], field: m[3] || null } : null;
}
/** Déclaration de l'intention dans la description de la colonne, bornée et validée. */
export function usageContract(description) {
  const lines = String(description || '')
    .slice(0, 4096)
    .split('\n');
  const line = lines.find((l) => l.trim().startsWith('@audit-lookup '));
  if (!line) return null;
  try {
    const c = JSON.parse(line.trim().slice(14));
    if (
      !c ||
      !NAME.test(c.table) ||
      !NAME.test(c.selection) ||
      !['SUM', 'AVERAGE', 'MIN', 'MAX', 'COUNT', 'len'].includes(c.aggregate) ||
      (c.field !== null && c.field !== undefined && !NAME.test(c.field))
    )
      return null;
    if (!c.criteria || Array.isArray(c.criteria) || typeof c.criteria !== 'object') return null;
    const entries = Object.entries(c.criteria);
    if (!entries.length || entries.length > 8 || entries.some(([a, b]) => !NAME.test(a) || !NAME.test(b))) return null;
    return { table: c.table, selection: c.selection, aggregate: c.aggregate, field: c.field || null, criteria: entries };
  } catch {
    return null;
  }
}

export function inspectUsage({ schema = new Map(), data = {}, coverage = [], meta = {}, access = null, limits = USAGE_LIMITS } = {}) {
  const budget = { ...USAGE_LIMITS, ...limits },
    signals = [],
    checks = new Map(USAGE_IDS.map((id) => [id, { id, state: 'checked', reason: 'Aucun signal dans les formes reconnues.' }]));
  const cov = new Map(coverage.map((x) => [x.table, x]));
  const limited = (id, reason) => {
    const c = checks.get(id);
    if (c.state === 'checked') checks.set(id, { id, state: 'limited', reason });
  };
  let calls = 0,
    cells = 0,
    chars = 0,
    ncols = 0,
    contracts = 0;
  const emit = (id, table, column, note, rows = []) => {
    if (signals.length < budget.targets) signals.push({ id, table, column, note, rows });
    else limited(id, 'Limite de cibles atteinte.');
  };
  const cols = (t) =>
    [...t.columns.values()].filter((c) => !TECH.test(c.colId) && !(t.summarySourceTable && ['group', 'count'].includes(c.colId)));
  const visible = (t) => data[t]?.id || [];
  const complete = (t) => Boolean(data[t] && !cov.get(t)?.sampled && visible(t).length <= budget.targetRows);
  const mt = metadataRows(meta.tables),
    mc = metadataRows(meta.columns),
    sections = metadataRows(meta.sections);
  const tableNames = new Map(mt.map((t) => [t.id, t.tableId]));
  const hidden = new Set(mc.filter((c) => !c.colId).map((c) => tableNames.get(c.parentId)));
  const referenced = new Map();
  const formulas = new Map();
  const tableList = [...schema.values()].filter((t) => t.tableId && !t.tableId.startsWith('_grist_')).slice(0, budget.tables);
  if (schema.size > budget.tables) for (const id of USAGE_IDS) limited(id, 'Limite de tables atteinte.');
  for (const t of tableList)
    for (const c of cols(t)) {
      if (++ncols > budget.columns) {
        for (const id of USAGE_IDS) limited(id, 'Limite de colonnes atteinte.');
        break;
      }
      if (['Ref', 'RefList'].includes(type(c))) {
        const dest = destination(c);
        if (!referenced.has(dest)) referenced.set(dest, []);
        referenced.get(dest).push({ table: t, column: c });
      }
      if (!isFormula(c)) continue;
      const code = String(c.formula);
      chars += code.length;
      if (chars > budget.formulaChars) {
        for (const id of ['U01', 'U02', 'U03', 'U07']) limited(id, 'Budget de formules atteint.');
        continue;
      }
      formulas.set(t.tableId + '.' + c.colId, { code, parsed: parseUsageLookup(code), selected: selectedAggregate(code) });
    }
  const indexes = new Map();
  const metadataComplete = schema.size <= budget.tables && ncols <= budget.columns && chars <= budget.formulaChars;
  function index(table, keys) {
    const cacheKey = keyOf([table, keys]);
    if (indexes.has(cacheKey)) return indexes.get(cacheKey);
    if (++calls > budget.calls) {
      for (const id of USAGE_IDS) limited(id, 'Budget d’index atteint.');
      return null;
    }
    const d = data[table];
    if (!d || keys.some((k) => !Array.isArray(d[k]))) return null;
    const take = Math.min(d.id.length, budget.targetRows),
      cost = take * (keys.length + 1);
    if (cells + cost > budget.indexCells) {
      for (const id of USAGE_IDS) limited(id, 'Budget de cellules d’index atteint.');
      return null;
    }
    cells += cost;
    const out = new Map();
    for (let i = 0; i < take; i++) {
      const values = keys.map((k) => scalar(d[k][i]));
      if (!values.every(usable)) continue;
      const key = keyOf(values);
      if (!out.has(key)) out.set(key, []);
      out.get(key).push(i);
    }
    indexes.set(cacheKey, out);
    return out;
  }
  for (const t of tableList) {
    const cs = cols(t),
      name = t.tableId;
    // U01 : seules les recherches agrégées reproduisant exactement les clés du groupe.
    if (t.summarySourceTable) {
      const source = t.summarySourceTableId || tableNames.get(t.summarySourceTable);
      const groups = [...t.columns.values()].filter((c) => c.summarySourceColId);
      if (source && schema.has(source) && !hidden.has(name))
        for (const c of cs) {
          const p = formulas.get(name + '.' + c.colId)?.parsed;
          if (!p || p.table !== source || p.method !== 'lookupRecords' || !p.aggregate) continue;
          if (
            p.terms.length !== groups.length ||
            p.terms.some((a) => a.field || !a.local || !groups.some((g) => g.colId === a.local && g.summarySourceColId === a.key))
          )
            continue;
          if (p.field && !schema.get(source).columns.has(p.field)) continue;
          if (!p.field && !['SUM', 'len'].includes(p.aggregate)) continue;
          emit(
            'U01',
            name,
            c.colId,
            p.field || p.aggregate === 'len'
              ? 'La recherche reproduit exactement les critères de regroupement ; $group fournit déjà ces lignes.'
              : 'La somme porte sur les lignes sans choisir leur champ numérique.',
          );
        }
      for (const c of cs)
        if (/^SUM\s*\(\s*\$group\s*\)$/.test(comments(String(c.formula || '')) || ''))
          emit('U01', name, c.colId, 'La somme utilise le groupe sans choisir le champ numérique à additionner.');
    }
    // U02 : une recherche pure qui réutilise la référence et rapporte un champ.
    for (const c of cs) {
      const p = formulas.get(name + '.' + c.colId)?.parsed;
      if (!p || p.method !== 'lookupOne' || p.aggregate || !p.field || p.terms.length !== 1) continue;
      const a = p.terms[0],
        ref = t.columns.get(a.local),
        target = schema.get(p.table);
      if (!ref || type(ref) !== 'Ref' || destination(ref) !== p.table || !target?.columns.has(p.field) || !a.field) continue;
      if (a.key === 'id' && a.field === 'id') {
        emit('U02', name, c.colId, 'Recherche par l’identifiant de la référence déjà présente.');
        continue;
      }
      if (a.key !== a.field || !target.columns.has(a.key)) continue;
      if (!complete(p.table)) {
        limited('U02', 'Recherche par libellé : table cible partielle ou indisponible.');
        continue;
      }
      const ix = index(p.table, [a.key]);
      if (!ix) continue;
      const d = data[name],
        td = data[p.table];
      if (!d?.[a.local] || !td[p.field]) continue;
      const rowById = new Map(td.id.map((id, i) => [id, i]));
      let same = 0,
        divergent = [];
      for (let i = 0; i < Math.min(d.id.length, budget.sourceRows); i++) {
        const j = rowById.get(scalar(d[a.local][i]));
        if (j === undefined) continue;
        const v = scalar(td[a.key][j]);
        if (!usable(v)) continue;
        const matches = ix.get(keyOf([v])) || [];
        if (matches.length === 1 && matches[0] === j) same++;
        else if (usable(d[c.colId]?.[i]) && usable(td[p.field][j]) && d[c.colId][i] !== td[p.field][j]) divergent.push(d.id[i]);
      }
      if (divergent.length)
        emit('U02', name, c.colId, 'Le résultat de la recherche diffère du champ de la référence utilisée pour son critère.', divergent);
      else if (same) emit('U02', name, c.colId, 'La recherche retrouve la référence déjà disponible dans les lignes examinées.');
    }
    // U03 : une table réduite à ses critères et à des agrégations du même ensemble.
    if (!t.summarySourceTable && !hidden.has(name)) {
      const manual = cs.filter((c) => !isFormula(c)),
        calculated = cs.filter(isFormula);
      const parsed = calculated.map((c) => formulas.get(name + '.' + c.colId)?.parsed);
      if (
        manual.length &&
        calculated.length &&
        parsed.every(
          (p) =>
            p &&
            p.method === 'lookupRecords' &&
            p.aggregate &&
            p.terms.length &&
            p.terms.every((a) => a.local && !a.field && a.local !== 'id'),
        )
      ) {
        const first = parsed[0],
          signature = (p) => keyOf(p.terms.map((a) => [a.key, a.local]).sort());
        const keys = new Set(first.terms.map((a) => a.local));
        if (
          schema.has(first.table) &&
          first.table !== name &&
          keys.size === manual.length &&
          manual.every((c) => keys.has(c.colId)) &&
          parsed.every(
            (p) =>
              p.table === first.table &&
              signature(p) === signature(first) &&
              p.terms.every((a) => schema.get(p.table).columns.has(a.key)) &&
              (!p.field || schema.get(p.table).columns.has(p.field)),
          )
        ) {
          const d = data[name];
          const groupKeys = manual.map((c) => c.colId);
          if (d?.id.length >= 2 && groupKeys.every((k) => Array.isArray(d[k]))) {
            const seen = new Set();
            for (let i = 0; i < Math.min(d.id.length, budget.sourceRows); i++) {
              const vals = groupKeys.map((k) => scalar(d[k][i]));
              if (vals.every(usable)) seen.add(keyOf(vals));
            }
            if (seen.size >= 2)
              emit(
                'U03',
                name,
                null,
                'La table ne contient que des critères saisis et des agrégations de la même table source ; ses lignes de regroupement restent manuelles.',
              );
          } else limited('U03', 'Lignes de regroupement insuffisantes ou indisponibles.');
        }
      }
    }
    // U06 : petite table d’intitulés, un seul usage de sélection, aucun rôle connu supplémentaire.
    if (
      metadataComplete &&
      NAME.test(name) &&
      !t.summarySourceTable &&
      !hidden.has(name) &&
      cs.length === 1 &&
      !isFormula(cs[0]) &&
      ['Text', 'Choice'].includes(type(cs[0]))
    ) {
      const incoming = referenced.get(name) || [],
        only = incoming[0];
      const protectedTable = access?.tables?.some((a) => a.tableId === name) || access?.attributes?.some((a) => a.tableId === name);
      const linkedView = sections.some((s) => tableNames.get(s.tableRef) === name && s.linkSrcSectionRef);
      const usedByFormula = [...formulas.values()].some(
        (f) => f.parsed?.table === name || new RegExp('\\b' + name + '\\.(?:lookupOne|lookupRecords|all)\\b').test(f.code),
      );
      if (
        incoming.length === 1 &&
        only &&
        !isFormula(only.column) &&
        !only.column.reverseColId &&
        !protectedTable &&
        !linkedView &&
        !usedByFormula &&
        complete(name)
      ) {
        const vals = data[name]?.[cs[0].colId];
        if (
          vals &&
          vals.length >= 2 &&
          vals.length <= 20 &&
          vals.every((v) => typeof v === 'string' && v.trim() && v.length <= 120) &&
          new Set(vals).size === vals.length
        )
          emit(
            'U06',
            only.table.tableId,
            only.column.colId,
            'Destination « ' + name + ' » : une seule colonne d’intitulés, une seule colonne de sélection et aucun autre rôle reconnu.',
          );
      }
    }
    // U07 : intention explicite, car une sélection volontaire est indéductible des valeurs seules.
    for (const c of cs) {
      const contract = usageContract(c.description);
      if (!contract) continue;
      contracts++;
      const expression = formulas.get(name + '.' + c.colId),
        s = expression?.selected,
        selection = t.columns.get(contract.selection),
        target = schema.get(contract.table);
      const automatic = expression?.parsed;
      if (
        automatic &&
        automatic.method === 'lookupRecords' &&
        automatic.table === contract.table &&
        automatic.aggregate === contract.aggregate &&
        automatic.field === contract.field &&
        automatic.terms.length === contract.criteria.length &&
        automatic.terms.every((a) => !a.field && contract.criteria.some(([k, l]) => k === a.key && l === a.local))
      )
        continue;
      if (
        !s ||
        s.selection !== contract.selection ||
        s.field !== contract.field ||
        s.aggregate !== contract.aggregate ||
        !selection ||
        isFormula(selection) ||
        !['Ref', 'RefList'].includes(type(selection)) ||
        destination(selection) !== contract.table ||
        !target ||
        contract.criteria.some(([a, b]) => !target.columns.has(a) || !t.columns.has(b))
      ) {
        limited('U07', 'Déclaration de recherche incompatible avec la formule ou les colonnes.');
        continue;
      }
      if (contract.field && !target.columns.has(contract.field)) {
        limited('U07', 'Champ à calculer indisponible.');
        continue;
      }
      const ix = index(
        contract.table,
        contract.criteria.map(([a]) => a),
      );
      const d = data[name],
        td = data[contract.table];
      if (!ix || !d?.[contract.selection]) {
        limited('U07', 'Données nécessaires à la comparaison indisponibles.');
        continue;
      }
      let candidates = 0;
      const differing = [];
      for (let i = 0; i < Math.min(d.id.length, budget.sourceRows); i++) {
        const vals = contract.criteria.map(([, b]) => scalar(d[b]?.[i]));
        if (!vals.every(usable)) continue;
        const raw = d[contract.selection][i];
        const chosen =
          type(selection) === 'RefList' ? list(raw) : typeof scalar(raw) === 'number' ? (scalar(raw) ? [scalar(raw)] : []) : null;
        if (!chosen || chosen.some((v) => typeof v !== 'number' || v < 0)) continue;
        candidates++;
        const expected = (ix.get(keyOf(vals)) || []).map((j) => td.id[j]);
        if (expected.some((id) => !chosen.includes(id))) differing.push(d.id[i]);
      }
      if (candidates)
        emit(
          'U07',
          name,
          c.colId,
          differing.length
            ? 'Les critères déclarés retrouvent des lignes absentes de la sélection manuelle.'
            : 'La sélection manuelle alimente uniquement une recherche par critères explicitement déclarée.',
          differing,
        );
    }
  }
  if (!contracts)
    checks.set('U07', {
      id: 'U07',
      state: 'unavailable',
      reason: 'Intention et critères de recherche non déclarés ; aucune erreur n’est déduite d’une sélection manuelle.',
    });
  if (coverage.some((c) => c.sampled))
    for (const id of ['U02', 'U03', 'U06', 'U07']) limited(id, 'Comparaison limitée aux lignes de l’échantillon.');
  return {
    signals,
    checks: [...checks.values()],
    counters: { calls, cells, formulaChars: Math.min(chars, budget.formulaChars), contracts },
  };
}
