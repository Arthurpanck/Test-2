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
import { SEVERITIES, AREAS, targetLabel, stepsAfterIntended } from './insights.js?v=2.3.0';
import { columnTypeLabel, detailLines, ID_TYPE_LABEL } from './types.js?v=2.3.0';
import { BITS, PERMISSION_LABEL } from './access.js?v=2.3.0';

export const DOCX_URL = 'https://cdn.jsdelivr.net/npm/docx@9.10.0/dist/index.iife.js';

// ---------------------------------------------------------------------------
// Thème : variables CSS --doc-*
// ---------------------------------------------------------------------------

export const THEME_KEYS = {
  font: 'Marianne', mono: 'Consolas',
  primary: '#000091', onPrimary: '#ffffff', summary: '#6e445a',
  text: '#161616', muted: '#666666', border: '#dddddd', surface: '#f6f6f6',
  type: '#18753c', formula: '#a558a0', key: '#b34000',
  blocking: '#ce0500', improve: '#b34000', choice: '#a558a0', info: '#0063cb', ready: '#18753c',
};

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
    plural(a.ruleCount, 'règle', 'règles'),
    protectedTables ? `${plural(protectedTables, 'table protégée', 'tables protégées')}` : 'aucune table protégée en particulier',
    a.attributes.length ? plural(a.attributes.length, 'attribut utilisateur', 'attributs utilisateur') : '',
    a.rowRules ? `${plural(a.rowRules, 'règle', 'règles')} par ligne` : '',
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
    if (sp.id === 'SeedRules' || sp.id === 'SchemaEdit') continue;
    const who = sp.rules.filter((r) => Object.values(r.perms).includes('allow')).map((r) => r.who.text);
    rows.push([{ text: sp.label, bold: true }, who.length ? `${sp.allowed} Personnes visées : ${who.join(' ; ')}.` : sp.byDefault]);
  }
  for (const [id, label, byDefault] of [['FullCopies', 'Copier le document entier', 'Seuls les propriétaires peuvent copier le document entier.'], ['AccessRules', 'Voir les règles d\'accès', 'Seuls les propriétaires voient les règles d\'accès.']]) {
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

/**
 * Sections du rapport, dans l'ordre des pages du widget. Chacune renvoie des blocs.
 * `ctx` : { docName, date, stats, tables, insights, access, profiles, dbml, schema: { png, width, height } | null }
 */
export const REPORT_SECTIONS = [
  {
    id: 'summary',
    title: 'Résumé',
    description: 'Chiffres clés, état de l\'import et liste des tables',
    build(ctx) {
      const rel = relationsOf(ctx.tables);
      const incoming = new Map();
      for (const r of rel) incoming.set(r.to, (incoming.get(r.to) || 0) + 1);
      return [
        { type: 'stats', items: [
          { value: ctx.stats.tables, label: ctx.stats.tables > 1 ? 'tables' : 'table' },
          { value: ctx.stats.columns, label: ctx.stats.columns > 1 ? 'colonnes' : 'colonne' },
          { value: ctx.stats.relations, label: ctx.stats.relations > 1 ? 'relations' : 'relation' },
          { value: ctx.stats.formulas, label: ctx.stats.formulas > 1 ? 'formules' : 'formule' },
        ] },
        { type: 'callout', level: ctx.insights.verdict.level, title: ctx.insights.verdict.title, text: ctx.insights.verdict.text },
        { type: 'heading', level: 2, text: 'Tables du document' },
        { type: 'table', columns: [{ label: 'Table', width: 36 }, { label: 'Colonnes', width: 14 }, { label: 'Lignes', width: 14 }, { label: 'Liens sortants', width: 18 }, { label: 'Référencée par', width: 18 }],
          rows: ctx.tables.map((t) => [
            { text: t.name, bold: true, color: t.kind === 'summary' ? 'summary' : undefined },
            String(t.columns.length + 1),
            ctx.profiles?.has(t.name) ? String(ctx.profiles.get(t.name).rows) : '',
            String(t.columns.filter((c) => c.ref).length),
            String(incoming.get(t.name) || 0),
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
        { type: 'paragraph', color: 'muted', size: 'small', text: 'Lecture : chaque carte est une table, la première ligne est sa clé « id ». Un trait relie une colonne de référence à la table visée ; la patte d\'oie marque le côté « plusieurs ». Les colonnes de formule sont précédées de « ƒ ».' },
      ];
    },
  },
  {
    id: 'tables',
    title: 'Tables et colonnes',
    description: 'Chaque table avec ses colonnes, leurs types, leurs liens, formules et choix',
    build(ctx) {
      const blocks = [];
      const rel = relationsOf(ctx.tables);
      for (const t of ctx.tables) {
        const refs = rel.filter((r) => r.to === t.name).map((r) => `${r.from}.${r.column}`);
        blocks.push({ type: 'heading', level: 2, text: t.kind === 'summary' ? `${t.name} (synthèse)` : t.name });
        if (t.description) blocks.push({ type: 'paragraph', color: 'muted', size: 'small', text: t.description });
        blocks.push({ type: 'table', header: t.kind === 'summary' ? 'summary' : 'primary',
          columns: [{ label: 'Colonne', width: 24 }, { label: 'Type', width: 18 }, { label: 'Lien vers', width: 18 }, { label: 'Détails', width: 40 }],
          rows: [
            [{ text: 'id', bold: true }, { text: ID_TYPE_LABEL, color: 'type' }, '', { text: 'Clé de la ligne', color: 'muted' }],
            ...t.columns.map((c) => [
              { lines: [{ text: c.name, bold: true }, ...(c.label && c.label !== c.name ? [{ text: c.label, color: 'muted' }] : [])] },
              { lines: [{ text: columnTypeLabel(c), color: c.isFormula ? 'formula' : 'type' }, ...(c.isFormula ? [{ text: 'formule', color: 'formula' }] : [])] },
              c.ref ? `${c.ref.table}${c.ref.kind === '<>' ? ' (plusieurs)' : ''}` : '',
              { lines: detailLines(c, { includeLabel: false }).map((d) => ({ label: d.label, text: d.text, mono: d.mono })) },
            ]),
          ] });
        if (refs.length) blocks.push({ type: 'paragraph', color: 'muted', size: 'small', text: `Référencée par : ${refs.join(', ')}.` });
      }
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
      blocks.push({ type: 'heading', level: 2, text: 'Ce qui a été vérifié' });
      blocks.push({ type: 'list', plain: true, items: checks.map((c) => `${c.ok ? '✓' : '✗'}  ${c.label}`) });
      return blocks;
    },
  },
  {
    id: 'access',
    title: 'Droits d\'accès',
    description: 'Réglages généraux, attributs utilisateur et règles de chaque table',
    build(ctx) {
      const a = ctx.access;
      if (!a) return [{ type: 'paragraph', color: 'muted', text: 'Les règles d\'accès n\'ont pas pu être lues.' }];
      if (!a.hasRules) {
        return [{ type: 'paragraph', text: 'Ce document n\'a aucune règle d\'accès avancée : chaque personne invitée voit et modifie tout selon son rôle de partage (propriétaire, éditeur, lecteur).' }];
      }
      const blocks = [{ type: 'paragraph', text: accessSummary(a) }];
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
        blocks.push({ type: 'heading', level: 2, text: 'Règles par défaut (toutes les tables)' });
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
      blocks.push({ type: 'paragraph', color: 'muted', size: 'small', text: 'Lecture : les règles d\'une table s\'appliquent dans l\'ordre ; la première dont la condition est remplie décide pour chaque permission. « — » : la règle ne dit rien, la suivante décide.' });
      return blocks;
    },
  },
  {
    id: 'dbml',
    title: 'Code DBML',
    description: 'Le code complet, à coller dans dbdiagram.io ou un autre outil',
    build(ctx) {
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
  chosen.forEach((s, i) => {
    if (i > 0 && s.id !== 'summary') blocks.push({ type: 'pagebreak' });
    blocks.push({ type: 'heading', level: 1, text: s.title });
    blocks.push(...s.build(ctx));
  });
  return blocks;
}

// ---------------------------------------------------------------------------
// Rendu HTML (aperçu)
// ---------------------------------------------------------------------------

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const cellOf = (c) => (typeof c === 'object' && c !== null ? c : { text: String(c ?? '') });
const lineClass = (l) => [l.mono ? 'doc__mono' : '', l.color ? `doc--${l.color}` : '', l.bold ? 'doc__b' : ''].join(' ').trim();
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
      case 'heading': return `<h${b.level + 1} class="doc__h${b.level}">${b.badge ? `<span class="doc__badge doc__badge--${b.badge.level}">${esc(b.badge.text)}</span> ` : ''}${esc(b.text)}</h${b.level + 1}>`;
      case 'paragraph': return `<p class="doc__p${b.color ? ` doc--${b.color}` : ''}${b.size === 'small' ? ' doc__p--small' : ''}">${runsHtml(b)}</p>`;
      case 'stats': return `<div class="doc__stats">${b.items.map((s) => `<div><strong>${esc(s.value)}</strong><span>${esc(s.label)}</span></div>`).join('')}</div>`;
      case 'callout': return `<div class="doc__callout doc__callout--${b.level}"><p><strong>${esc(b.title)}</strong></p><p>${esc(b.text)}</p></div>`;
      case 'table': return `<table class="doc__table doc__table--${b.header || 'primary'}"><thead><tr>${b.columns.map((c) => `<th style="width:${c.width}%">${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${
        b.rows.map((r) => `<tr>${r.map((raw) => { const c = cellOf(raw); return `<td class="${c.lines ? '' : lineClass(c)}">${cellHtml(c)}</td>`; }).join('')}</tr>`).join('')}</tbody></table>`;
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
  const thinBorder = { style: d.BorderStyle.SINGLE, size: 4, color: color('border') };
  const borders = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };
  const children = [];

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
        if (b.badge) runs.push(new d.TextRun({ text: ` ${b.badge.text.toUpperCase()} `, bold: true, size: pt(8), color: hex(theme.onPrimary), shading: { type: d.ShadingType.CLEAR, fill: color(b.badge.level), color: 'auto' } }), new d.TextRun({ text: '  ' }));
        runs.push(new d.TextRun({ text: b.text }));
        children.push(new d.Paragraph({ heading: b.level === 1 ? d.HeadingLevel.HEADING_1 : d.HeadingLevel.HEADING_2, children: runs, keepNext: true }));
        break;
      }
      case 'paragraph':
        children.push(new d.Paragraph({
          children: (b.runs || [{ text: b.text }]).map((r) => run(r, { color: b.color ? color(b.color) : undefined, size: b.size === 'small' ? pt(9) : undefined })),
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
        const cell = (raw, w, head) => {
          const c = head ? { text: raw.label, bold: true } : cellOf(raw);
          const paragraphs = c.lines
            ? (c.lines.length ? c.lines : [{ text: '' }]).map((l) => new d.Paragraph({
              spacing: { after: 20 },
              children: [
                ...(l.label ? [new d.TextRun({ text: `${l.label} : `, bold: true, size: pt(8.5), color: color('muted') })] : []),
                run(l, { size: pt(l.mono ? 8.5 : 9) }),
              ],
            }))
            : [new d.Paragraph({ children: [run({ ...c, color: head ? undefined : c.color }, { color: head ? hex(theme.onPrimary) : undefined, size: pt(9), bold: head })] })];
          return new d.TableCell({
            width: { size: w, type: d.WidthType.PERCENTAGE },
            shading: head ? { type: d.ShadingType.CLEAR, fill: headFill, color: 'auto' } : undefined,
            margins: { top: 60, bottom: 60, left: 100, right: 100 },
            borders,
            children: paragraphs,
          });
        };
        children.push(new d.Table({
          width: { size: 100, type: d.WidthType.PERCENTAGE },
          rows: [
            new d.TableRow({ tableHeader: true, children: b.columns.map((c) => cell(c, c.width, true)) }),
            ...b.rows.map((r) => new d.TableRow({ cantSplit: !r.some((v) => v && v.lines && v.lines.length > 3), children: r.map((v, i) => cell(v, b.columns[i].width, false)) })),
          ],
        }));
        children.push(new d.Paragraph({ text: '', spacing: { after: 120 } }));
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
      case 'pagebreak':
        children.push(new d.Paragraph({ children: [new d.PageBreak()] }));
        break;
      default:
    }
  }

  return new d.Document({
    creator: 'Widget Grist « Audit de structure »',
    title: blocks.find((b) => b.type === 'title')?.text || 'Structure du document',
    description: 'Rapport de structure d\'un document Grist',
    styles: {
      default: { document: { run: { font: theme.font, size: pt(10.5), color: color('text') }, paragraph: { spacing: { line: 276 } } } },
      paragraphStyles: [
        { id: 'Title', name: 'Title', basedOn: 'Normal', next: 'Normal', run: { font: theme.font, size: pt(26), bold: true, color: color('text') }, paragraph: { spacing: { after: 80 } } },
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: theme.font, size: pt(18), bold: true, color: color('primary') }, paragraph: { spacing: { before: 240, after: 160 } } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: theme.font, size: pt(13), bold: true, color: color('text') }, paragraph: { spacing: { before: 240, after: 100 } } },
      ],
    },
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
      footers: {
        default: new d.Footer({ children: [new d.Paragraph({ alignment: d.AlignmentType.RIGHT, children: [
          new d.TextRun({ text: `${blocks.find((b) => b.type === 'title')?.text || 'Structure du document'} · page `, color: color('muted'), size: pt(8) }),
          new d.TextRun({ children: [d.PageNumber.CURRENT], color: color('muted'), size: pt(8) }),
        ] })] }),
      },
      children,
    }],
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
