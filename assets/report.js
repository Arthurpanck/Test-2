/**
 * Rapport de structure du document, en deux rendus d'un même contenu :
 *  - l'aperçu HTML de la page Rapport ;
 *  - le fichier Word (.docx), produit avec la bibliothèque « docx » (MIT).
 *
 * Pour que le rapport suive le design sans retouche :
 *  - le CONTENU est décrit une seule fois, sous forme de blocs neutres (titre, paragraphe,
 *    tableau, image, encadré, liste, code), par les sections du registre REPORT_SECTIONS ;
 *    ajouter une section ou modifier un texte change l'aperçu et le Word en même temps ;
 *  - les COULEURS et POLICES viennent des variables CSS --doc-* (assets/styles.css), lues à
 *    l'exécution par readTheme() : changer une couleur du design change le Word.
 *
 * Module pur (sans DOM, sauf readTheme) : la génération Word est testée sous Node.
 */
import { SEVERITIES, AREAS, targetLabel, stepsAfterIntended } from './insights.js?v=3.5.0';
import { AUDIT_CATALOG } from './audit-catalog.js?v=3.5.0';
import { columnTypeLabel, detailLines, ID_TYPE_LABEL } from './types.js?v=3.5.0';
import { TABLE_COLUMNS, tableRows } from './table-format.js?v=3.5.0';
import { BITS, PERMISSION_LABEL } from './access.js?v=3.5.0';
import { originText, typeCounts, columnLines, ACCESS_LABELS } from './pages.js?v=3.5.0';
import { ACTIONS as MX_ACTIONS, cellText, cellTone, unknownCases } from './rights-matrix.js?v=3.5.0';

export const DOCX_URL = 'https://cdn.jsdelivr.net/npm/docx@9.10.0/dist/index.iife.js';

// ---------------------------------------------------------------------------
// Thème : variables CSS --doc-*
// ---------------------------------------------------------------------------

export const THEME_KEYS = {
  font: 'Calibri', mono: 'Consolas',
  primary: '#000091', onPrimary: '#ffffff', summary: '#6e445a',
  text: '#161616', muted: '#666666', border: '#dddddd', surface: '#f6f6f6',
  type: '#18753c', formula: '#a558a0', key: '#b34000',
  blocking: '#ce0500', improve: '#b34000', choice: '#a558a0', info: '#0063cb', ready: '#18753c',
  neutral: '#3a3a3a', fillOk: '#dffee6', fillKo: '#ffe9e9', fillUk: '#eeeeee',
  lookupOne: '#d64d00', lookupRecords: '#009081',
};
/** Cases colorées (matrice des droits) : fond et texte. */
const FILLS = { ok: ['fillOk', 'ready'], ko: ['fillKo', 'blocking'], uk: ['fillUk', 'neutral'], surface: ['surface', 'text'] };

const toKebab = (k) => k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);

/** Lit les variables --doc-* (repli sur les valeurs par défaut hors navigateur). */
export function readTheme(style = typeof document !== 'undefined' ? getComputedStyle(document.documentElement) : null) {
  const theme = {};
  for (const [key, fallback] of Object.entries(THEME_KEYS)) {
    let v = style ? style.getPropertyValue(`--doc-${toKebab(key)}`).trim() : '';
    if (key === 'font' || key === 'mono') v = (v || fallback).split(',')[0].replace(/["']/g, '').trim();
    theme[key] = v || fallback;
  }
  return theme;
}
const hex = (c) => String(c).replace('#', '').toUpperCase();

// ---------------------------------------------------------------------------
// Contenu : registre des sections
// ---------------------------------------------------------------------------

const plural = (n, one, many) => `${n.toLocaleString('fr-FR')} ${n > 1 ? many : one}`;

function relationsOf(tables) {
  const out = [];
  for (const t of tables) for (const c of t.columns) if (c.ref) out.push({ from: t.name, column: c.name, to: c.ref.table, many: c.ref.kind === '<>' });
  return out;
}

/** Phrase de synthèse des droits d'accès. */
export function accessSummary(a) {
  const protectedTables = a.tables.length;
  return [
    plural(a.ruleCount, 'condition de droits d’accès', 'conditions de droits d’accès'),
    protectedTables ? `${plural(protectedTables, 'table protégée', 'tables protégées')}` : 'aucune table protégée en particulier',
    a.attributes.length ? plural(a.attributes.length, 'attribut utilisateur', 'attributs utilisateur') : '',
    a.rowRules ? `${plural(a.rowRules, 'condition de droits d’accès', 'conditions de droits d’accès')} par ligne` : '',
  ].filter(Boolean).join(' · ') + '.';
}

/** Réglages généraux : structure, copies, lecture des règles. */
export function generalRows(a) {
  const rows = [[
    { text: 'Modifier la structure', bold: true },
    a.structureRestricted
      ? 'Restreinte par une règle par défaut (permission Structure refusée).'
      : 'Propriétaires et éditeurs (réglage par défaut de Grist). Les éditeurs peuvent aussi écrire des formules.',
  ]];
  for (const sp of a.special) {
    if (sp.id === 'SchemaEdit') continue;
    const who = sp.rules.filter((r) => Object.values(r.perms).includes('allow')).map((r) => r.who.text);
    rows.push([{ text: sp.label, bold: true }, who.length ? `${sp.allowed} Personnes visées : ${who.join(' ; ')}.` : sp.byDefault]);
  }
  for (const [id, label, byDefault] of [['FullCopies', 'Copier le document entier', 'Seuls les propriétaires peuvent copier le document entier.'], ['AccessRules', 'Voir les droits d’accès', 'Seuls les propriétaires voient les règles d\'accès.']]) {
    if (!a.special.some((sp) => sp.id === id)) rows.push([{ text: label, bold: true }, byDefault]);
  }
  return rows;
}

const PERM_CELL = { allow: { text: 'Autorisé', color: 'ready' }, deny: { text: 'Refusé', color: 'blocking' } };

/** Tableau d'un ensemble de règles (une ligne par règle, une colonne par permission). */
export function ruleTable(rules, bits) {
  const w = 13; // assez large pour « Supprimer » ou « Structure » sur une ligne
  const rest = 100 - w * bits.length;
  const who = Math.round(rest * 0.58);
  return {
    type: 'table',
    columns: [{ label: 'Qui', width: who }, ...bits.map((b) => ({ label: PERMISSION_LABEL[b], width: w })), { label: 'Message', width: rest - who }],
    rows: rules.map((r) => [
      { lines: [{ text: r.who.text, bold: true }, ...(r.formula && r.who.kind !== 'email' ? [{ text: r.formula, mono: true, color: 'muted' }] : []), ...r.problems.map((p) => ({ text: p.text, color: 'blocking' }))] },
      ...bits.map((b) => PERM_CELL[r.perms[b]] || { text: '—', color: 'muted' }),
      { text: r.memo || '', color: 'muted' },
    ]),
  };
}

const MX_GROUPS_PER_TABLE = 3; // 12 cases d'action : la largeur d'une page A4 en paysage

/** Une case de la matrice, pour un tableau du rapport. */
function matrixCell(c, span) {
  if (!c || c.state === 'na') return { text: '—', color: 'muted', align: 'center' };
  return { text: cellText(c), bold: true, fill: cellTone(c), align: 'center', ...(span ? { span } : {}) };
}

/**
 * « Qui peut faire quoi ? » : la matrice de l'onglet Accès (tables puis colonnes à règles),
 * en tableaux de trois rôles métier au plus, suivie des cases à vérifier dans Grist.
 */
export function matrixBlocks(mx) {
  if (!mx?.hasRules) return [];
  const blocks = [
    { type: 'heading', level: 2, text: 'Qui peut faire quoi ?' },
    { type: 'paragraph', color: 'muted', size: 'small', text: 'Pour chaque rôle métier, ce que permettent les règles à une personne de rôle Grist Éditeur. Une case verte qui nomme une colonne : oui, mais seulement sur les lignes où cette colonne correspond à la personne.' },
  ];
  for (let start = 0; start < mx.groups.length; start += MX_GROUPS_PER_TABLE) {
    const part = mx.groups.slice(start, start + MX_GROUPS_PER_TABLE).map((g, k) => ({ g, gi: start + k }));
    const n = part.length * MX_ACTIONS.length;
    const w = Math.floor((76 / n) * 10) / 10;
    const label = Math.round((100 - w * n) * 10) / 10;
    blocks.push({
      type: 'table', size: 'small', wide: true,
      groups: [{ label: '', span: 1 }, ...part.map(({ g }) => ({ label: g.name, sub: g.sub, span: MX_ACTIONS.length }))],
      columns: [{ label: 'Table', width: label }, ...part.flatMap(() => MX_ACTIONS.map(([, l]) => ({ label: l, width: w, align: 'center' })))],
      rows: mx.rows.map((row) => {
        if (row.kind === 'structure') {
          return [{ lines: [{ text: row.label, bold: true }, { text: row.sub, color: 'muted' }], fill: 'surface' },
            ...part.map(({ gi }) => matrixCell(mx.cell(row.key, gi, 'S'), MX_ACTIONS.length))];
        }
        const head = row.kind === 'column' ? { text: row.label, indent: true, color: 'neutral' } : { text: row.label, bold: true };
        return [head, ...part.flatMap(({ gi }) => MX_ACTIONS.map(([bit]) => matrixCell(mx.cell(row.key, gi, bit))))];
      }),
    });
  }
  blocks.push({ type: 'paragraph', color: 'muted', size: 'small', text: 'Lecture : Oui / Non pour toutes les lignes ; un nom de colonne en vert : seulement sur les lignes où cette colonne correspond à la personne ; en rouge : oui, sauf sur ces lignes ; « ? » : condition que le widget ne sait pas lire ; « — » : sans objet pour une colonne. Ordre appliqué : règles de la colonne, puis de la table, puis du document ; la première qui s\'applique décide, action par action.' });
  const unknown = unknownCases(mx);
  if (unknown.length) {
    blocks.push({ type: 'paragraph', runs: [{ text: 'À vérifier dans Grist', bold: true }] });
    blocks.push({ type: 'list', items: unknown.map((u) => `${u.row.kind === 'structure' ? 'Droits de structure' : u.row.kind === 'column' ? `${u.row.table}.${u.row.label}` : u.row.label} · ${u.actions.join(', ')}${u.groups.length < mx.groups.length ? ` (${u.groups.join(', ')})` : ''} : ${u.note || `la condition « ${u.formula} » utilise un attribut inexistant ou une forme non comprise`}.`) });
  }
  blocks.push({ type: 'paragraph', color: 'muted', size: 'small', text: 'Lecture des règles, sans connexion réelle : pour un cas sensible, vérifiez avec « Voir en tant que » dans Grist.' });
  return blocks;
}

/**
 * Sections du rapport, dans l'ordre des pages du widget. Chacune renvoie des blocs.
 * `ctx` : { docName, date, stats, tables, insights, access, profiles, pages, dbml, schema: { png, width, height } | null }
 */
export const REPORT_SECTIONS = [
  {
    id: 'summary',
    title: 'Résumé',
    description: 'Chiffres clés, verdict de l\'analyse et liste des tables',
    build(ctx) {
      return [
        { type: 'stats', items: [
          { value: ctx.stats.tables, label: ctx.stats.tables > 1 ? 'tables' : 'table' },
          { value: ctx.stats.columns, label: ctx.stats.columns > 1 ? 'colonnes' : 'colonne' },
          { value: ctx.stats.relations, label: ctx.stats.relations > 1 ? 'relations' : 'relation' },
          { value: ctx.stats.formulas, label: ctx.stats.formulas > 1 ? 'formules' : 'formule' },
        ] },
        { type: 'callout', level: ctx.insights.verdict.level, title: ctx.insights.verdict.title, text: ctx.insights.verdict.text },
        { type: 'heading', level: 2, text: 'Tables du document' },
        { type: 'table', columns: [{ label: 'Table', width: 60 }, { label: 'Lignes', width: 20 }, { label: 'Colonnes', width: 20 }],
          rows: ctx.tables.map((t) => [
            { text: t.name, bold: true, color: t.kind === 'summary' ? 'summary' : undefined },
            ctx.profiles?.has(t.name) ? String(ctx.profiles.get(t.name).rows) : '—',
            String(t.columns.length + 1),
          ]) },
      ];
    },
  },
  {
    id: 'schema',
    title: 'Schéma',
    description: 'Le schéma des tables et de leurs relations, tel qu\'affiché dans le widget',
    build(ctx) {
      if (!ctx.schema) return [{ type: 'paragraph', text: 'Le schéma n\'a pas pu être dessiné.', color: 'muted' }];
      return [
        { type: 'image', png: ctx.schema.png, width: ctx.schema.width, height: ctx.schema.height, alt: 'Schéma des tables et de leurs relations' },
        { type: 'paragraph', color: 'muted', size: 'small', text: `Lecture : chaque carte est une table (en-tête bleu ; violet pour une table de synthèse), la première ligne est sa clé « id ». Un trait relie une colonne de référence à la table visée ; la patte d'oie marque le côté « plusieurs lignes », la barre le côté « une ligne ». Les colonnes de formule sont précédées de « ƒ ».${ctx.schemaLookups ? ' Lookups des formules : orange tireté pour lookupOne, vert pointillé pour lookupRecords, flèche vers la table cherchée.' : ''}` },
      ];
    },
  },
  {
    id: 'tables',
    title: 'Tables et colonnes',
    description: 'Chaque table colonne par colonne : nom en base, nom affiché, types SQLite et Grist, rôle, formule',
    // Sept colonnes, formules comprises : pages en paysage.
    landscapeStart: () => true,
    build(ctx) {
      const blocks = [];
      const rel = relationsOf(ctx.tables);
      for (const t of ctx.tables) {
        const refs = rel.filter((r) => r.to === t.name).map((r) => `${r.from}.${r.column}`);
        blocks.push({ type: 'heading', level: 2, text: t.kind === 'summary' ? `${t.name} (synthèse)` : t.name });
        if (t.description) blocks.push({ type: 'paragraph', color: 'muted', size: 'small', text: t.description });
        const rows = tableRows(t);
        blocks.push({ type: 'table', size: 'small', header: t.kind === 'summary' ? 'summary' : 'primary',
          columns: TABLE_COLUMNS.map((label, i) => ({ label, width: [15, 14, 8, 15, 9, 7, 32][i] })),
          rows: rows.map((r) => [
            { text: r.name, bold: r.isKey },
            r.label,
            { text: r.sqlite, mono: true },
            { text: r.declared.text, color: r.column?.isFormula ? 'formula' : 'type' },
            r.role,
            { text: r.computed, color: 'formula', bold: Boolean(r.computed) },
            r.formula ? { text: r.formula, mono: true } : '',
          ]) });
        // Ce que le modèle n'a pas de colonne pour : choix, liste filtrée, déclenchement, description.
        const extras = [];
        for (const c of t.columns) {
          const lines = detailLines(c, { includeLabel: false }).filter((l) => !['Formule', 'Formule d\'initialisation'].includes(l.label));
          if (lines.length) extras.push(`${c.name} — ${lines.map((l) => `${l.label.toLowerCase()} : ${l.text}`).join(' ; ')}`);
        }
        if (extras.length) blocks.push({ type: 'list', items: extras });
        if (refs.length) blocks.push({ type: 'paragraph', color: 'muted', size: 'small', text: `Référencée par : ${refs.join(', ')}.` });
      }
      blocks.push({ type: 'orientation', landscape: false });
      return blocks;
    },
  },
  {
    id: 'pages',
    title: 'Widgets',
    description: 'Widgets personnalisés (origine, accès, colonnes), fiches, listes, graphiques et formulaires',
    build(ctx) {
      const m = ctx.pages;
      if (!m) return [{ type: 'paragraph', color: 'muted', text: 'Les pages du document n\'ont pas pu être lues.' }];
      const n = m.custom.length + m.views.length;
      const blocks = [{ type: 'paragraph', text: n
        ? `${plural(m.pages.length, 'page', 'pages')}, ${plural(n, 'widget', 'widgets')} hors tableaux (${typeCounts(m)}). Les ${plural(m.tableWidgetCount, 'tableau', 'tableaux')} ne sont pas détaillés ici.`
        : `${plural(m.pages.length, 'page', 'pages')}, uniquement des tableaux (${m.tableWidgetCount}).` }];
      const where = (w) => ({ lines: [{ text: w.page || '(sans nom)', bold: true }, ...(w.table ? [{ text: `table ${w.table}${w.summary ? ' (synthèse)' : ''}`, color: 'muted' }] : []), ...(w.linkedTo ? [{ text: `suit « ${w.linkedTo} »`, color: 'muted' }] : [])] });

      const colLine = (l, muted) => (l.missing ? { text: `• ${l.field} → à associer`, color: 'blocking' } : { text: `• ${l.field} → ${l.column}`, color: muted ? 'muted' : undefined });
      const accessCell = (c) => ({ text: ACCESS_LABELS[c.access] || c.access || '—', color: c.access === 'full' && c.origin === 'external' ? 'improve' : undefined });

      blocks.push({ type: 'heading', level: 2, text: 'Widgets non officiels' });
      if (!m.unofficial.length) blocks.push({ type: 'paragraph', color: 'muted', text: 'Aucun widget non officiel dans ce document.' });
      else {
        blocks.push({ type: 'paragraph', color: 'muted', size: 'small', text: 'Widgets ajoutés par leur adresse (site externe) ou créés dans Grist, dont le code est enregistré dans le document. L\'accès complet permet au widget de lire et de modifier tout le document.' });
        blocks.push({ type: 'table', columns: [{ label: 'Widget', width: 24 }, { label: 'Page', width: 18 }, { label: 'Origine', width: 34 }, { label: 'Accès', width: 24 }],
          rows: m.unofficial.map((w) => {
            const c = w.custom;
            return [
              { lines: [{ text: w.title || c.name || 'Widget', bold: true }, ...(w.description ? [{ text: w.description, color: 'muted' }] : []), ...columnLines(c).map((l) => colLine(l, true))] },
              where(w),
              { lines: [{ text: originText(c) }, ...(c.url && c.origin !== 'document' ? [{ text: c.url, mono: true, color: 'muted' }] : [])] },
              accessCell(c),
            ];
          }) });
      }

      blocks.push({ type: 'heading', level: 2, text: 'Widgets personnalisés' });
      if (!m.gallery.length) blocks.push({ type: 'paragraph', color: 'muted', text: 'Aucun widget de la galerie Grist dans ce document.' });
      else {
        blocks.push({ type: 'paragraph', color: 'muted', size: 'small', text: 'Widgets choisis dans la galerie de Grist, avec l\'accès accordé et la colonne associée à chaque champ attendu.' });
        blocks.push({ type: 'table', columns: [{ label: 'Widget', width: 26 }, { label: 'Page', width: 20 }, { label: 'Accès', width: 20 }, { label: 'Colonnes', width: 34 }],
          rows: m.gallery.map((w) => {
            const c = w.custom;
            const lines = columnLines(c);
            return [
              { lines: [{ text: w.title || c.name, bold: true },
                ...(w.title && w.title !== c.name ? [{ text: c.name, color: 'muted' }] : []),
                ...(c.maintained ? [] : [{ text: `Communauté${c.author ? ` (${c.author})` : ''}`, color: 'muted' }])] },
              where(w),
              accessCell(c),
              lines.length ? { lines: lines.map((l) => colLine(l, false)) } : { text: 'Aucune colonne à associer', color: 'muted' },
            ];
          }) });
      }

      blocks.push({ type: 'heading', level: 2, text: 'Fiches, listes, graphiques et formulaires' });
      if (!m.views.length) blocks.push({ type: 'paragraph', color: 'muted', text: 'Aucune autre vue que des tableaux.' });
      else {
        blocks.push({ type: 'table', columns: [{ label: 'Page', width: 22 }, { label: 'Widget', width: 28 }, { label: 'Type', width: 16 }, { label: 'Table', width: 16 }, { label: 'Suit la sélection de', width: 18 }],
          rows: m.views.map((w, i) => [
            i === 0 || m.views[i - 1].page !== w.page ? { text: w.page || '(sans nom)', bold: true } : '',
            { lines: [{ text: w.title || w.table || w.typeLabel }, ...(w.description ? [{ text: w.description, color: 'muted' }] : [])] },
            w.typeLabel,
            `${w.table}${w.summary ? ' (synthèse)' : ''}`,
            w.linkedTo || { text: '—', color: 'muted' },
          ]) });
      }

      const issues = (ctx.insights?.items || []).filter((i) => i.area === 'pages');
      if (issues.length) {
        blocks.push({ type: 'heading', level: 2, text: 'Points d\'attention' });
        blocks.push({ type: 'list', items: issues.map((i) => `${SEVERITIES[i.severity].label} — ${i.title}`) });
        if (ctx.sections?.includes('analysis') ?? true) blocks.push({ type: 'paragraph', color: 'muted', size: 'small', text: 'Le détail et la marche à suivre sont dans la partie « Analyse ».' });
      }
      const rest = [];
      if (m.tableOnlyPages.length) rest.push(`Pages qui ne contiennent que des tableaux : ${m.tableOnlyPages.join(', ')}.`);
      if (m.tablesWithoutPage.length) rest.push(`Tables affichées sur aucune page : ${m.tablesWithoutPage.join(', ')}.`);
      for (const t of rest) blocks.push({ type: 'paragraph', color: 'muted', size: 'small', text: t });
      return blocks;
    },
  },
  {
    id: 'analysis',
    title: 'Analyse',
    description: 'Ce qui bloque l\'import, ce qui est à vérifier et comment corriger',
    build(ctx) {
      const { verdict, items, checks } = ctx.insights;
      const accepted = ctx.insights.accepted || [];
      const blocks = [{ type: 'callout', level: verdict.level, title: verdict.title, text: verdict.text }];
      const counts = ctx.insights.counts;
      blocks.push({ type: 'stats', items: Object.keys(SEVERITIES).map((l) => ({ value: counts[l] || 0, label: SEVERITIES[l].label })) });
      for (const it of items) {
        blocks.push({ type: 'heading', level: 2, text: it.title, badge: { level: it.severity, text: SEVERITIES[it.severity].label } });
        if (it.area) blocks.push({ type: 'paragraph', color: 'muted', size: 'small', text: AREAS[it.area] });
        blocks.push({ type: 'paragraph', text: it.summary });
        blocks.push({ type: 'paragraph', runs: [{ text: 'Pourquoi c\'est important : ', bold: true }, { text: it.why }] });
        if (it.targets.length) blocks.push({ type: 'paragraph', runs: [{ text: 'Concerné : ', bold: true }, { text: it.targets.map((t) => targetLabel(t) + (t.note ? ` (${t.note})` : '')).join(', ') }] });
        if (it.method) { blocks.push({type:'paragraph',runs:[{text:'Comment ce constat est calculé : ',bold:true},{text:it.method}]}); blocks.push({type:'paragraph',runs:[{text:'Observation et limites : ',bold:true},{text:(it.calculation || '') + ' ' + (it.limitations || '')}]}); }
        if (it.intended) blocks.push({ type: 'paragraph', runs: [{ text: 'Si c\'est voulu : ', bold: true }, { text: it.intended }] });
        if (it.steps.length) {
          blocks.push({ type: 'paragraph', runs: [{ text: it.intended ? 'Sinon, dans Grist' : 'Comment corriger dans Grist', bold: true }] });
          blocks.push({ type: 'list', ordered: true, items: stepsAfterIntended(it) });
        }
      }
      if (accepted.length) {
        blocks.push({ type: 'heading', level: 2, text: 'Choix confirmés' });
        blocks.push({ type: 'paragraph', color: 'muted', size: 'small', text: 'Points marqués « C\'est voulu » dans le widget.' });
        blocks.push({ type: 'list', items: accepted.map((it) => `${it.title} — ${it.targets.map((t) => targetLabel(t)).join(', ')}`) });
      }
      if (ctx.insights.audit) {
        const STATE = { detected: 'constat trouvé', limited: 'examiné en partie', checked: 'examiné, rien trouvé', unavailable: 'impossible à vérifier ici' };
        const title = (id) => AUDIT_CATALOG.find((c) => c.id === id)?.title || id;
        blocks.push({ type: 'heading', level: 2, text: 'Ce que l\'analyse a examiné' });
        blocks.push({ type: 'paragraph', color: 'muted', size: 'small', text: 'Vérifications détaillées et leur résultat sur ce document. Données : au plus 2 000 lignes par table et 100 000 cellules en tout.' });
        blocks.push({ type: 'table', columns: [{ label: 'Vérification', width: 44 }, { label: 'Résultat', width: 20 }, { label: 'Précision', width: 36 }],
          rows: ctx.insights.audit.checks.map((c) => [{ lines: [{ text: title(c.id), bold: true }, { text: c.id, color: 'muted' }] },
            { text: STATE[c.state] || c.state, color: c.state === 'detected' ? 'blocking' : c.state === 'checked' ? 'ready' : 'muted' },
            { text: c.state === 'checked' ? '' : c.reason, color: 'muted' }]) });
      }
      blocks.push({ type: 'heading', level: 2, text: 'Ce qui a été vérifié' });
      blocks.push({ type: 'list', plain: true, items: checks.map((c) => `${c.ok ? '✓' : '✗'}  ${c.label}`) });
      return blocks;
    },
  },
  {
    id: 'access',
    title: 'Droits d\'accès',
    description: 'Qui peut faire quoi, réglages généraux, attributs utilisateur et règles de chaque table',
    // La matrice des droits tient sur des pages en paysage, au début de la section.
    landscapeStart: (ctx) => Boolean(ctx.access?.hasRules && ctx.matrix?.hasRules),
    build(ctx) {
      const a = ctx.access;
      if (!a) return [{ type: 'paragraph', color: 'muted', text: 'Les règles d\'accès n\'ont pas pu être lues.' }];
      if (!a.hasRules) {
        return [{ type: 'paragraph', text: 'Ce document n\'a aucune règle d\'accès avancée : chaque personne invitée voit et modifie tout selon son rôle de partage (propriétaire, éditeur, lecteur).' }];
      }
      const blocks = [{ type: 'paragraph', text: accessSummary(a) }];
      const matrix = matrixBlocks(ctx.matrix);
      if (matrix.length) blocks.push(...matrix, { type: 'orientation', landscape: false });
      blocks.push({ type: 'heading', level: 2, text: 'Réglages généraux' });
      blocks.push({ type: 'table', columns: [{ label: 'Réglage', width: 30 }, { label: 'Situation', width: 70 }], rows: generalRows(a) });
      if (a.attributes.length) {
        blocks.push({ type: 'heading', level: 2, text: 'Attributs utilisateur' });
        blocks.push({ type: 'paragraph', color: 'muted', size: 'small', text: 'Un attribut cherche la personne connectée dans une table ; les conditions l\'utilisent sous la forme user.Nom.Colonne.' });
        blocks.push({ type: 'table', columns: [{ label: 'Attribut', width: 22 }, { label: 'Cherché dans', width: 30 }, { label: 'Avec', width: 20 }, { label: 'État', width: 28 }],
          rows: a.attributes.map((x) => [
            { text: `user.${x.name}`, mono: true, bold: true },
            `${x.tableId}.${x.lookupColId}`,
            { text: `user.${x.charId}`, mono: true },
            x.problems.length ? { text: x.problems.join(', '), color: 'blocking' } : { text: 'Correct', color: 'ready' },
          ]) });
      }
      if (a.defaults.length) {
        blocks.push({ type: 'heading', level: 2, text: 'Droits d’accès par défaut (toutes les tables)' });
        blocks.push(ruleTable(a.defaults, BITS.defaults));
      }
      for (const t of a.tables) {
        blocks.push({ type: 'heading', level: 2, text: t.missing ? `${t.tableId} (invisible pour vous)` : t.tableId });
        if (t.rules.length) blocks.push(ruleTable(t.rules, BITS.table));
        for (const c of t.columns) {
          blocks.push({ type: 'paragraph', runs: [{ text: c.colIds.length > 1 ? 'Colonnes ' : 'Colonne ', bold: true }, { text: c.colIds.join(', ') },
            ...(c.missing.length ? [{ text: ` — invisible pour vous : ${c.missing.join(', ')}` }] : [])] });
          blocks.push(ruleTable(c.rules, BITS.column));
        }
      }
      if (a.uncovered.length) blocks.push({ type: 'paragraph', color: 'muted', size: 'small', text: `Sans règle propre (règles par défaut seulement) : ${a.uncovered.join(', ')}.` });
      blocks.push({ type: 'paragraph', color: 'muted', size: 'small', text: 'Lecture : les règles d\'une table s\'appliquent dans l\'ordre ; la première dont la condition est remplie décide pour chaque permission. « — » : aucun droit n’est décidé ici pour cette action, la condition suivante s’applique.' });
      return blocks;
    },
  },
  {
    id: 'dbml',
    title: 'Code DBML',
    description: 'Le code complet, à coller dans dbdiagram.io ou un autre outil',
    build(ctx) {
      if (!ctx.dbml) return [{ type: 'paragraph', color: 'muted', text: 'Le code DBML n\'a pas pu être produit.' }];
      return [
        { type: 'paragraph', color: 'muted', size: 'small', text: 'À coller dans un éditeur DBML (dbdiagram.io, par exemple) pour retrouver le schéma.' },
        { type: 'code', lines: ctx.dbml.replace(/\n+$/, '').split('\n') },
      ];
    },
  },
];

/** Blocs du rapport complet pour les sections choisies. */
export function buildReport(ctx, sectionIds = REPORT_SECTIONS.map((s) => s.id)) {
  const chosen = REPORT_SECTIONS.filter((s) => sectionIds.includes(s.id));
  const blocks = [{
    type: 'title',
    text: sectionIds.includes('access') ? 'Structure et droits d\'accès' : 'Structure du document',
    subtitle: ctx.docName || 'Document Grist',
    meta: `Rapport généré le ${ctx.date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })} à ${ctx.date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} · ${plural(ctx.stats.tables, 'table', 'tables')}, ${plural(ctx.stats.relations, 'relation', 'relations')}`,
  }];
  const body = [];
  chosen.forEach((s, i) => {
    if (s.landscapeStart?.(ctx)) body.push({ type: 'orientation', landscape: true }); // saut de section : nouvelle page
    else if (i > 0) body.push({ type: 'pagebreak' });
    body.push({ type: 'heading', level: 1, text: s.title });
    body.push(...s.build(ctx));
  });
  // Table des matières cliquable : chaque titre reçoit une ancre (signet dans le Word).
  // Titres numérotés « 1. », « 1.1 » ; chacun reçoit une ancre (signet dans le Word).
  let n = 0; let h1 = 0; let h2 = 0;
  const entries = [];
  for (const b of body) {
    if (b.type !== 'heading') continue;
    if (b.level === 1) { h1 += 1; h2 = 0; b.number = `${h1}.`; } else { h2 += 1; b.number = `${h1}.${h2}`; }
    b.anchor = `sec${++n}`;
    entries.push({ level: b.level, number: b.number, text: b.text, anchor: b.anchor });
  }
  if (entries.length > 1) blocks.push({ type: 'toc', title: 'Table des matières', entries }, { type: 'pagebreak' });
  return blocks.concat(body);
}

// ---------------------------------------------------------------------------
// Rendu HTML (aperçu)
// ---------------------------------------------------------------------------

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const cellOf = (c) => (typeof c === 'object' && c !== null ? c : { text: String(c ?? '') });
const lineClass = (l) => [l.mono ? 'doc__mono' : '', l.color ? `doc--${l.color}` : '', l.bold ? 'doc__b' : '', l.fill ? `doc__fill doc__fill--${l.fill}` : '', l.align === 'center' ? 'doc__center' : '', l.indent ? 'doc__indent' : ''].join(' ').trim();
function cellHtml(c) {
  if (!c.lines) return esc(c.text);
  return c.lines.map((l) => `<div class="doc__line ${lineClass(l)}">${l.label ? `<span class="doc__label">${esc(l.label)} : </span>` : ''}${esc(l.text)}</div>`).join('');
}

function runsHtml(b) {
  const runs = b.runs || [{ text: b.text }];
  return runs.map((r) => {
    let h = esc(r.text);
    if (r.bold) h = `<strong>${h}</strong>`;
    if (r.italic) h = `<em>${h}</em>`;
    return h;
  }).join('');
}

/** @param {Array} blocks  @param {object} urls  images : png → url (aperçu) */
export function renderHtml(blocks, { imageUrl } = {}) {
  return blocks.map((b) => {
    switch (b.type) {
      case 'title': return `<header class="doc__title"><p class="doc__kicker">${esc(b.subtitle)}</p><h1>${esc(b.text)}</h1><p class="doc__meta">${esc(b.meta)}</p></header>`;
      case 'toc': return `<nav class="doc__toc" aria-label="${esc(b.title)}"><p class="doc__toc-title">${esc(b.title)}</p><ol>${b.entries.map((e) => `<li class="doc__toc-l${e.level}"><a href="#doc-${e.anchor}" data-doc-anchor="doc-${e.anchor}"><span class="doc__toc-num">${esc(e.number || '')}</span><span class="doc__toc-text">${esc(e.text)}</span></a></li>`).join('')}</ol></nav>`;
      case 'heading': return `<h${b.level + 1} class="doc__h${b.level}"${b.anchor ? ` id="doc-${b.anchor}"` : ''}>${b.number ? `<span class="doc__num">${esc(b.number)}</span> ` : ''}${b.badge ? `<span class="doc__badge doc__badge--${b.badge.level}">${esc(b.badge.text)}</span> ` : ''}${esc(b.text)}</h${b.level + 1}>`;
      case 'paragraph': return `<p class="doc__p${b.color ? ` doc--${b.color}` : ''}${b.size === 'small' ? ' doc__p--small' : ''}">${runsHtml(b)}</p>`;
      case 'stats': return `<div class="doc__stats">${b.items.map((s) => `<div><strong>${esc(s.value)}</strong><span>${esc(s.label)}</span></div>`).join('')}</div>`;
      case 'callout': return `<div class="doc__callout doc__callout--${b.level}"><p><strong>${esc(b.title)}</strong></p><p>${esc(b.text)}</p></div>`;
      case 'table': {
        const groups = b.groups ? `<tr>${b.groups.map((g) => `<th colspan="${g.span}" class="doc__th-group">${esc(g.label)}${g.sub ? `<span>${esc(g.sub)}</span>` : ''}</th>`).join('')}</tr>` : '';
        const table = `<table class="doc__table doc__table--${b.header || 'primary'}${b.size === 'small' ? ' doc__table--small' : ''}"><thead>${groups}<tr>${b.columns.map((c) => `<th style="width:${c.width}%"${c.align === 'center' ? ' class="doc__center"' : ''}>${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${
          b.rows.map((r) => `<tr>${r.map((raw) => { const c = cellOf(raw); const cls = c.lines ? [c.fill ? `doc__fill doc__fill--${c.fill}` : ''].join('') : lineClass(c); return `<td${c.span ? ` colspan="${c.span}"` : ''} class="${cls}">${cellHtml(c)}</td>`; }).join('')}</tr>`).join('')}</tbody></table>`;
        return b.wide ? `<div class="doc__wide">${table}</div>` : table;
      }
      case 'orientation': return '';
      case 'image': return imageUrl ? `<figure class="doc__figure"><img src="${esc(imageUrl(b))}" alt="${esc(b.alt)}"></figure>` : '';
      case 'list': return `<${b.ordered ? 'ol' : 'ul'} class="doc__list${b.plain ? ' doc__list--plain' : ''}">${b.items.map((i) => `<li>${esc(i)}</li>`).join('')}</${b.ordered ? 'ol' : 'ul'}>`;
      case 'code': return `<pre class="doc__code">${esc(b.lines.join('\n'))}</pre>`;
      case 'pagebreak': return '<hr class="doc__break" aria-hidden="true">';
      default: return '';
    }
  }).join('');
}

// ---------------------------------------------------------------------------
// Rendu Word (.docx)
// ---------------------------------------------------------------------------

const PAGE_CONTENT_TWIPS = 11906 - 2 * 1134; // largeur utile, pour la tabulation des numéros de page
const PAGE_CONTENT_PX = 642; // A4, marges de 2 cm : 17 cm utiles à 96 ppp
const MAX_IMAGE_PX = 880;

/**
 * @param {Array} blocks  blocs de buildReport()
 * @param {object} theme  readTheme()
 * @param {object} d      la bibliothèque docx (window.docx ou import Node)
 * @returns {object} Document docx (à passer à d.Packer.toBlob / toBuffer)
 */
export function renderDocx(blocks, theme, d) {
  const color = (name) => hex(theme[name] || theme.text);
  const pt = (n) => n * 2; // demi-points
  const run = (r, base = {}) => new d.TextRun({
    text: r.text, bold: r.bold || base.bold, italics: r.italic,
    color: r.color ? color(r.color) : base.color, size: base.size,
    font: r.mono ? theme.mono : undefined,
  });
  // Texte sur plusieurs lignes (formules) : un saut de ligne Word par retour à la ligne.
  const runs = (r, base = {}) => String(r.text ?? '').split('\n').map((line, i) => new d.TextRun({
    text: line, break: i ? 1 : undefined, bold: r.bold || base.bold, italics: r.italic,
    color: r.color ? color(r.color) : base.color, size: base.size,
    font: r.mono ? theme.mono : undefined,
  }));
  const thinBorder = { style: d.BorderStyle.SINGLE, size: 4, color: color('border') };
  const borders = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };
  // Sections Word : une nouvelle à chaque changement d'orientation (matrice des droits en paysage).
  const sections = [{ landscape: false, children: [] }];
  let children = sections[0].children;
  const pageBreaks = new WeakSet();

  for (const b of blocks) {
    switch (b.type) {
      case 'title':
        children.push(new d.Paragraph({ children: [new d.TextRun({ text: b.subtitle, color: color('primary'), bold: true, size: pt(11) })], spacing: { after: 80 } }));
        children.push(new d.Paragraph({ heading: d.HeadingLevel.TITLE, children: [new d.TextRun({ text: b.text })], spacing: { before: 60, after: 120, line: 360 } }));
        children.push(new d.Paragraph({ children: [new d.TextRun({ text: b.meta, color: color('muted'), size: pt(9) })], spacing: { after: 240 },
          border: { bottom: { style: d.BorderStyle.SINGLE, size: 12, color: color('primary'), space: 8 } } }));
        break;
      case 'heading': {
        const runs = [];
        if (b.number) runs.push(new d.TextRun({ text: `${b.number}  `, color: color('primary') }));
        if (b.badge) runs.push(new d.TextRun({ text: ` ${b.badge.text.toUpperCase()} `, bold: true, size: pt(8), color: hex(theme.onPrimary), shading: { type: d.ShadingType.CLEAR, fill: color(b.badge.level), color: 'auto' } }), new d.TextRun({ text: '  ' }));
        runs.push(new d.TextRun({ text: b.text }));
        children.push(new d.Paragraph({
          heading: b.level === 1 ? d.HeadingLevel.HEADING_1 : d.HeadingLevel.HEADING_2,
          children: b.anchor ? [new d.Bookmark({ id: b.anchor, children: runs })] : runs,
          keepNext: true,
        }));
        break;
      }
      case 'toc':
        children.push(new d.Paragraph({
          children: [new d.TextRun({ text: b.title, bold: true, size: pt(20), color: color('primary') })],
          spacing: { after: 240 },
          border: { bottom: { style: d.BorderStyle.SINGLE, size: 8, color: color('primary'), space: 6 } },
        }));
        for (const e of b.entries) {
          const top = e.level === 1;
          const style = { bold: top, color: top ? color('primary') : color('text'), size: top ? pt(12) : pt(11) };
          children.push(new d.Paragraph({
            indent: { left: top ? 454 : 1191, hanging: top ? 454 : 624 },
            spacing: { before: top ? 200 : 30, after: top ? 60 : 30 },
            tabStops: [{ type: d.TabStopType.LEFT, position: top ? 454 : 1191 }, { type: d.TabStopType.RIGHT, position: PAGE_CONTENT_TWIPS, leader: d.LeaderType.DOT }],
            keepNext: top,
            children: [new d.InternalHyperlink({ anchor: e.anchor, children: [
              new d.TextRun({ ...style, text: `${e.number || ''}\t${e.text}\t` }),
              new d.SimpleField(`PAGEREF ${e.anchor} \\h`, '', ),
            ] })],
          }));
        }
        break;
      case 'paragraph':
        children.push(new d.Paragraph({
          children: (b.runs || [{ text: b.text }]).map((r) => run(r, { color: b.color ? color(b.color) : undefined, size: b.size === 'small' ? pt(9.5) : undefined })),
          spacing: { after: 120 },
        }));
        break;
      case 'stats':
        children.push(new d.Table({
          width: { size: 100, type: d.WidthType.PERCENTAGE },
          borders: { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder, insideHorizontal: thinBorder, insideVertical: thinBorder },
          rows: [new d.TableRow({ children: b.items.map((s) => new d.TableCell({
            width: { size: Math.floor(100 / b.items.length), type: d.WidthType.PERCENTAGE },
            margins: { top: 120, bottom: 120, left: 160, right: 160 },
            children: [
              new d.Paragraph({ children: [new d.TextRun({ text: String(s.value), bold: true, size: pt(20), color: color('primary') })] }),
              new d.Paragraph({ children: [new d.TextRun({ text: s.label, color: color('muted'), size: pt(9) })] }),
            ],
          })) })],
        }));
        children.push(new d.Paragraph({ text: '', spacing: { after: 120 } }));
        break;
      case 'callout': {
        const c = color(b.level === 'blocking' ? 'blocking' : 'ready');
        children.push(new d.Paragraph({
          children: [new d.TextRun({ text: b.title, bold: true, color: c, size: pt(12) })],
          border: { left: { style: d.BorderStyle.SINGLE, size: 36, color: c, space: 10 } },
          shading: { type: d.ShadingType.CLEAR, fill: color('surface'), color: 'auto' },
          spacing: { before: 120 }, indent: { left: 200 },
        }));
        children.push(new d.Paragraph({
          children: [new d.TextRun({ text: b.text })],
          border: { left: { style: d.BorderStyle.SINGLE, size: 36, color: c, space: 10 } },
          shading: { type: d.ShadingType.CLEAR, fill: color('surface'), color: 'auto' },
          spacing: { after: 240 }, indent: { left: 200 },
        }));
        break;
      }
      case 'table': {
        const headFill = color(b.header === 'summary' ? 'summary' : 'primary');
        const small = b.size === 'small';
        const textSize = small ? pt(8.5) : pt(10);
        const margins = small ? { top: 40, bottom: 40, left: 70, right: 70 } : { top: 60, bottom: 60, left: 100, right: 100 };
        const widthOf = (i, span) => Math.round(b.columns.slice(i, i + span).reduce((n, c) => n + c.width, 0) * 10) / 10;
        const cell = (raw, w, head, span = 1) => {
          const c = head ? { text: raw.label, bold: true, align: raw.align } : cellOf(raw);
          const fill = !head && c.fill ? FILLS[c.fill] : null;
          const alignment = c.align === 'center' ? d.AlignmentType.CENTER : undefined;
          const indent = c.indent ? { left: 227 } : undefined;
          const paragraphs = c.lines
            ? (c.lines.length ? c.lines : [{ text: '' }]).map((l) => new d.Paragraph({
              spacing: { after: 20 }, alignment, indent,
              children: [
                ...(l.label ? [new d.TextRun({ text: `${l.label} : `, bold: true, size: pt(9.5), color: color('muted') })] : []),
                run(l, { size: small ? pt(8) : pt(l.mono ? 9 : 10) }),
              ],
            }))
            : [new d.Paragraph({ alignment, indent, children: runs({ ...c, color: head ? undefined : (fill ? fill[1] : c.color) }, { color: head ? hex(theme.onPrimary) : undefined, size: c.mono && !head ? textSize - 1 : textSize, bold: head }) })];
          return new d.TableCell({
            width: { size: w, type: d.WidthType.PERCENTAGE },
            columnSpan: span > 1 ? span : undefined,
            verticalAlign: small ? d.VerticalAlign.CENTER : undefined,
            shading: head ? { type: d.ShadingType.CLEAR, fill: headFill, color: 'auto' } : fill ? { type: d.ShadingType.CLEAR, fill: color(fill[0]), color: 'auto' } : undefined,
            margins,
            borders,
            children: paragraphs,
          });
        };
        const rows = [];
        if (b.groups) {
          let at = 0;
          rows.push(new d.TableRow({ tableHeader: true, cantSplit: true, children: b.groups.map((g) => {
            const w = widthOf(at, g.span); at += g.span;
            return new d.TableCell({
              width: { size: w, type: d.WidthType.PERCENTAGE },
              columnSpan: g.span > 1 ? g.span : undefined,
              shading: { type: d.ShadingType.CLEAR, fill: headFill, color: 'auto' },
              margins, borders,
              children: [
                new d.Paragraph({ children: [new d.TextRun({ text: g.label, bold: true, size: pt(10), color: hex(theme.onPrimary) })] }),
                ...(g.sub ? [new d.Paragraph({ children: [new d.TextRun({ text: g.sub, size: pt(7.5), color: hex(theme.onPrimary) })] })] : []),
              ],
            });
          }) }));
        }
        rows.push(new d.TableRow({ tableHeader: true, cantSplit: true, children: b.columns.map((c) => cell(c, c.width, true)) }));
        for (const r of b.rows) {
          let at = 0;
          rows.push(new d.TableRow({
            cantSplit: !r.some((v) => v && v.lines && v.lines.length > 3),
            children: r.map((v) => { const span = cellOf(v).span || 1; const w = widthOf(at, span); at += span; return cell(v, w, false, span); }),
          }));
        }
        children.push(new d.Table({ width: { size: 100, type: d.WidthType.PERCENTAGE }, rows }));
        children.push(new d.Paragraph({ text: '', spacing: { after: 120 } }));
        break;
      }
      case 'orientation': {
        // Le saut de section ouvre une nouvelle page : un saut de page juste avant laisserait une page blanche.
        const cur = sections[sections.length - 1];
        if (pageBreaks.has(cur.children[cur.children.length - 1])) cur.children.pop();
        if (!cur.children.length) cur.landscape = b.landscape;
        else if (cur.landscape !== b.landscape) sections.push({ landscape: b.landscape, children: [] });
        children = sections[sections.length - 1].children;
        break;
      }
      case 'image': {
        const ratio = b.height / b.width;
        let w = Math.min(PAGE_CONTENT_PX, b.width);
        let h = Math.round(w * ratio);
        if (h > MAX_IMAGE_PX) { h = MAX_IMAGE_PX; w = Math.round(h / ratio); }
        children.push(new d.Paragraph({
          alignment: d.AlignmentType.CENTER,
          children: [new d.ImageRun({ type: 'png', data: b.png, transformation: { width: w, height: h }, altText: { title: b.alt, description: b.alt, name: 'schema' } })],
          spacing: { after: 120 },
        }));
        break;
      }
      case 'list':
        for (const [i, item] of b.items.entries()) {
          children.push(new d.Paragraph({
            children: [...(b.plain ? [] : [new d.TextRun({ text: b.ordered ? `${i + 1}.  ` : '•  ', bold: b.ordered, color: color('primary') })]), new d.TextRun({ text: item })],
            indent: { left: 360, hanging: 280 }, spacing: { after: 60 },
          }));
        }
        children.push(new d.Paragraph({ text: '', spacing: { after: 60 } }));
        break;
      case 'code':
        for (const line of b.lines) {
          children.push(new d.Paragraph({
            children: [new d.TextRun({ text: line || ' ', font: theme.mono, size: pt(8.5), color: /^Table /.test(line) ? color('primary') : color('text'), bold: /^Table /.test(line) })],
            shading: { type: d.ShadingType.CLEAR, fill: color('surface'), color: 'auto' },
            spacing: { after: 0, line: 240 },
          }));
        }
        break;
      case 'pagebreak': {
        // Juste après un saut de section (nouvelle page), un saut de page laisserait une page blanche.
        if (!sections[sections.length - 1].children.length) break;
        const p = new d.Paragraph({ children: [new d.PageBreak()] });
        pageBreaks.add(p);
        children.push(p);
        break;
      }
      default:
    }
  }

  return new d.Document({
    creator: 'Widget Grist « Audit de structure »',
    title: blocks.find((b) => b.type === 'title')?.text || 'Structure du document',
    description: 'Rapport de structure d\'un document Grist',
    features: { updateFields: true },
    styles: {
      default: { document: { run: { font: theme.font, size: pt(11), color: color('text') }, paragraph: { spacing: { line: 264 } } } },
      paragraphStyles: [
        { id: 'Title', name: 'Title', basedOn: 'Normal', next: 'Normal', run: { font: theme.font, size: pt(26), bold: true, color: color('text') }, paragraph: { spacing: { after: 80 } } },
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: theme.font, size: pt(18), bold: true, color: color('primary') }, paragraph: { spacing: { before: 240, after: 160 } } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: theme.font, size: pt(13), bold: true, color: color('text') }, paragraph: { spacing: { before: 240, after: 100 } } },
      ],
    },
    sections: sections.filter((x, i) => i === 0 || x.children.length).map((x) => ({
      properties: { page: {
        size: { width: 11906, height: 16838, orientation: x.landscape ? d.PageOrientation.LANDSCAPE : d.PageOrientation.PORTRAIT },
        margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 },
      } },
      footers: {
        default: new d.Footer({ children: [new d.Paragraph({ alignment: d.AlignmentType.RIGHT, children: [
          new d.TextRun({ text: `${blocks.find((b) => b.type === 'title')?.text || 'Structure du document'} · page `, color: color('muted'), size: pt(8) }),
          new d.TextRun({ children: [d.PageNumber.CURRENT], color: color('muted'), size: pt(8) }),
        ] })] }),
      },
      children: x.children,
    })),
  });
}

/** Charge la bibliothèque docx (navigateur) une seule fois. */
let docxPromise = null;
export function loadDocx(url = DOCX_URL) {
  if (typeof window !== 'undefined' && window.docx) return Promise.resolve(window.docx);
  if (!docxPromise) {
    docxPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = url;
      s.async = true;
      s.onload = () => (window.docx ? resolve(window.docx) : reject(new Error('bibliothèque docx introuvable')));
      s.onerror = () => { docxPromise = null; reject(new Error('chargement de la bibliothèque docx impossible')); };
      document.head.append(s);
    });
  }
  return docxPromise;
}


