/** Contrôles bornés, sans réseau ni exécution de formules ou de conditions d'accès. */
import { AUDIT_CATALOG, RETAINED_IDS } from './audit-catalog.js?v=3.17.0';
import { columnarToRows, fold, TECHNICAL_COLUMN as TECH } from './util.js?v=3.17.0';
import { inspectVisibleFilters } from './filter-audit.js?v=3.17.0';
import { maskPython, dollarChains, lookupCalls, splitTopLevel } from './python-text.js?v=3.17.0';
import { conditionForRole, effectivePermission } from './acl-model.js?v=3.17.0';

export { conditionForRole, effectivePermission };
import { inspectUsage } from './usage-audit.js?v=3.17.0';
export const AUDIT_LIMITS = { rows: 2000, cells: 100000, formulaChars: 200000, edges: 100000, pairs: 100 };
const infoById = new Map(AUDIT_CATALOG.map(x => [x.id, x]));
const clean = x => String(x).normalize('NFC').trim().replace(/[\s\u200b]+/g, ' ').toLowerCase();
export const isCensored = v => Array.isArray(v) && v[0] === 'C';
export const isErrorValue = v => Array.isArray(v) && v[0] === 'E';
export const isBlank = v => v == null || v === '' || (Array.isArray(v) && (v.length === 0 || (v[0] === 'L' && v.length === 1)));
const usable = v => !isBlank(v) && !isCensored(v) && !isErrorValue(v);
export function listValue(v) { if (!Array.isArray(v)) return null; if (v[0] === 'L') return v.slice(1); if (v[0] === 'r' && Array.isArray(v[2])) return v[2]; return ['E', 'C', 'd', 'D', 'R'].includes(v[0]) ? null : v; }
export function scalar(v) { return Array.isArray(v) && ['d','D'].includes(v[0]) ? v[1] : Array.isArray(v) && v[0] === 'R' ? v[2] : v; }
const serial = v => JSON.stringify(v, (_,x) => typeof x === 'number' && !Number.isFinite(x) ? String(x) : x);
function hash(s) { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0),16777619); return h >>> 0; }
const PRESAMPLE = Symbol.for('grist-audit.presample');
const byHash = (a, b) => a.h - b.h || a.i - b.i;
/**
 * Les `take` lignes dont l'id a le plus petit hachage (« table:id »), en { i, h } : une file bornée
 * (tas) évite de trier toutes les lignes d'une grande table. Toutes les lignes si `take` les couvre.
 */
function smallestByHash(name, ids, take) {
  if (take >= ids.length) return ids.map((id, i) => ({ i, h: hash(name + ':' + id) }));
  const heap = [];
  const worse = (a, b) => a.h > b.h || (a.h === b.h && a.i > b.i);
  const swap = (x, y) => { [heap[x], heap[y]] = [heap[y], heap[x]]; };
  const up = (p) => { while (p) { const q = (p - 1) >> 1; if (!worse(heap[p], heap[q])) break; swap(p, q); p = q; } };
  const down = () => {
    let p = 0;
    for (;;) {
      let a = p * 2 + 1;
      if (a >= heap.length) break;
      const b = a + 1;
      if (b < heap.length && worse(heap[b], heap[a])) a = b;
      if (!worse(heap[a], heap[p])) break;
      swap(a, p); p = a;
    }
  };
  for (let i = 0; take && i < ids.length; i++) {
    const x = { i, h: hash(name + ':' + ids[i]) };
    if (heap.length < take) { heap.push(x); up(heap.length - 1); }
    else if (worse(heap[0], x)) { heap[0] = x; down(); }
  }
  return heap;
}
/**
 * Prépare l'échantillon d'une table dès sa lecture, pour libérer aussitôt la table complète :
 * garde les ids (intégrité des références, nombre de lignes) et les `limits.rows` lignes de plus
 * petit hachage, triées par hachage. sampleAuditData() en tire ensuite exactement les mêmes
 * lignes que sur la table complète (les `take` plus petites forment un préfixe de cette liste).
 */
export function presampleTable(name, d, limits = AUDIT_LIMITS) {
  if (!Array.isArray(d?.id) || d[PRESAMPLE]) return d;
  const cols = Object.keys(d).filter(c => c !== 'id' && Array.isArray(d[c]) && !TECH.test(c));
  const n = d.id.length, keep = Math.min(n, limits.rows);
  const picked = smallestByHash(name, d.id, keep).sort(byHash);
  const rows = picked.map(x => x.i);
  const out = { id: d.id };
  Object.defineProperty(out, PRESAMPLE, { value: { cols, rows, values: Object.fromEntries(cols.map(c => [c, rows.map(i => d[c][i])])) } });
  return out;
}
/** Échantillon déterministe, réparti par hachage d'ids ; coût de profilage global borné. */
export function sampleAuditData(data, limits = AUDIT_LIMITS) {
  const result = {}, coverage = []; const entries = Object.entries(data || {}).filter(([,d]) => Array.isArray(d?.id));
  let remaining = limits.cells;
  for (let e = 0; e < entries.length; e++) {
    const [name,d] = entries[e], ps = d[PRESAMPLE], cols = ps ? ps.cols : Object.keys(d).filter(c => c !== 'id' && Array.isArray(d[c]) && !TECH.test(c));
    const allowance = Math.floor(remaining / (entries.length - e));
    const take = Math.min(d.id.length, limits.rows, cols.length ? Math.floor(allowance / cols.length) : limits.rows);
    if (ps) {
      // Positions dans l'échantillon préparé : les `take` premières par hachage, remises dans l'ordre des lignes.
      const pos = ps.rows.map((_, p) => p).slice(0, take).sort((a, b) => ps.rows[a] - ps.rows[b]);
      result[name] = Object.fromEntries([['id', pos.map(p => d.id[ps.rows[p]])], ...cols.map(c => [c, pos.map(p => ps.values[c][p])])]);
      const cells = take * cols.length; remaining -= cells;
      coverage.push({ table:name, visibleRows:d.id.length, inspectedRows:take, cells, sampled:take<d.id.length });
      continue;
    }
    const idx = smallestByHash(name, d.id, take).map(x => x.i).sort((a, b) => a - b);
    result[name] = Object.fromEntries(['id',...cols].map(c => [c,idx.map(i => d[c][i])]));
    const cells=take*cols.length; remaining-=cells;
    coverage.push({ table:name, visibleRows:d.id.length, inspectedRows:take, cells, sampled:take<d.id.length });
  }
  return { data:result, coverage, cells:limits.cells-remaining };
}
const refsIn = code => dollarChains(maskPython(code)).map(r => r.name);
/** lookupOne dont chaque critère est une égalité à une colonne de la ligne ou à un littéral simple. */
const SIMPLE_TERM = /^([A-Za-z_]\w*)\s*=\s*(?:\$([A-Za-z_]\w*)|(-?\d+(?:\.\d+)?)|(['"])([^'"\\]*)\4)$/;
export function simpleLookups(code) {
  const src = String(code ?? ''), mask = maskPython(src), out = [];
  for (const call of lookupCalls(mask)) {
    if (call.method !== 'lookupOne' || /[()]/.test(call.args)) continue;
    const original = src.slice(call.open + 1, call.close);
    const terms = [];
    let valid = true, at = 0;
    for (const part of splitTopLevel(call.args)) {
      const text = original.slice(at, at + part.length).trim();
      at += part.length + 1;
      if (!text) continue;
      const p = SIMPLE_TERM.exec(text);
      if (!p) { valid = false; break; }
      terms.push({ key: p[1], local: p[2], value: p[3] !== undefined ? Number(p[3]) : p[5] });
    }
    if (valid && terms.length) out.push({ table: call.table, terms, after: mask.slice(call.close + 1) });
  }
  return out;
}
const ratio=(a,b)=>b?a/b:0;
export function runAudit({schema=new Map(),data={},sampled:given=null,access=null,pages=null,meta={},failedTables=[],limits=AUDIT_LIMITS}={}) {
 // Échantillon déjà tiré par l'appelant (mêmes limites) ou tiré ici.
 const sampled=given&&limits===AUDIT_LIMITS?given:sampleAuditData(data,limits),sd=sampled.data,byCoverage=new Map(sampled.coverage.map(x=>[x.table,x]));
 const items=[],hits=new Map(),counts=new Map(),signatures=new Map();
 const status=new Map(RETAINED_IDS.map(id=>[id,{id,state:'checked',reason:'Aucun signal dans les éléments examinés.'}]));
 const metadataOnly=new Set(['N47','N53','N69','X13','U01']);
 const unavailable=(id,reason)=>status.set(id,{id,state:'unavailable',reason});
 const limited=(id,reason)=>{if(status.get(id)?.state==='checked')status.set(id,{id,state:'limited',reason});};
 if(!access)unavailable('N53','Droits d’accès indisponibles.');
 if(!pages)unavailable('N47','Métadonnées des pages indisponibles.');
 if(!meta.filters)unavailable('N69','Métadonnées des filtres indisponibles.');
 const filterViews=inspectVisibleFilters(schema,meta);
 if(!filterViews.available)unavailable('X13','Métadonnées des filtres, vues Tableau, tables ou colonnes indisponibles.');
 else if(filterViews.partial)limited('X13','Certains filtres ou colonnes ne sont pas lisibles ; seuls les champs confirmés sont comptés.');
 const emit=(id,table,column,rows=[],note='')=>{
  if(!RETAINED_IDS.includes(id))return;counts.set(id,(counts.get(id)||0)+1);
  signatures.set(id,hash(String(signatures.get(id)||0)+serial([table,column,rows,note])));
  if(!hits.has(id))hits.set(id,[]);if(hits.get(id).length>=100)return;
  const target={table,...(column?{column}:{}),note:[note,rows.length?'lignes '+[...new Set(rows)].slice(0,3).join(', '):''].filter(Boolean).join(' · ')};
  if(!hits.get(id).some(x=>serial(x)===serial(target)))hits.get(id).push(target);
 };
 const cols=t=>[...t.columns.values()].filter(c=>!TECH.test(c.colId));
 const values=(t,c)=>sd[t]?.[c]||[];
 const rowids=(t,p)=>values(t,'id').filter((_,i)=>p(i));
 let chars=0,formulaTruncated=false,lookupCalls=0;
 const formulaCode=new Map();
 for(const t of schema.values())for(const c of cols(t)){const raw=String(c.formula||'');if(chars+raw.length<=limits.formulaChars){formulaCode.set(t.tableId+'.'+c.colId,{raw,mask:maskPython(raw)});chars+=raw.length;}else formulaTruncated=true;}
 for(const t of schema.values()){
  const name=t.tableId;if(!name||name.startsWith('_grist_'))continue;
  const cs=cols(t),ids=values(name,'id');
  for(const c of cs){
   const col=c.colId,type=String(c.type||'Any').split(':')[0],vs=values(name,col),short=vs.slice(0,200),shortFilled=short.filter(usable);
   const {raw,mask}=formulaCode.get(name+'.'+col)||{raw:'',mask:''};
   if(c.isFormula&&String(c.formula||'').trim()){const errors=rowids(name,i=>isErrorValue(vs[i])&&!/Censored|Access|Permission/.test(String(vs[i][1])));if(errors.length)emit('N01',name,col,errors);}
   const invalid=v=>{if(!usable(v))return false;const s=scalar(v);if(type==='Numeric')return typeof s!=='number'||!Number.isFinite(s);if(type==='Int')return typeof s!=='number'||!Number.isInteger(s);if(type==='Bool')return typeof s!=='boolean';if(['Date','DateTime'].includes(type))return typeof s!=='number'||!Number.isFinite(s);if(type==='Ref')return typeof s!=='number'||!Number.isInteger(s)||s<0;if(['RefList','Attachments'].includes(type)){const a=listValue(v);return !a||a.some(x=>typeof x!=='number'||!Number.isInteger(x)||x<0);}return false;};
   const bad=rowids(name,i=>invalid(vs[i]));if(bad.length)emit('N02',name,col,bad,bad.length+' cellules incompatibles avec le type '+type);
   if(/code|ref|mail|statut|categorie|nom/i.test(col)&&!/notes?|description|adresse/i.test(col)){
    const invisible=ids.slice(0,200).filter((_,i)=>typeof short[i]==='string'&&short[i].length<=120&&!/[\r\n]/.test(short[i])&&(/^[\s\u200b]|[\s\u200b]$|[\u00a0\u202f\u200b]/.test(short[i])));
    if(invisible.length>=2||ratio(invisible.length,shortFilled.length)>=.05)emit('N06',name,col,invisible,Math.min(vs.length,200)+' cellules au maximum, textes courts seulement');
    if(vs.length>200)limited('N06','Au plus 200 cellules courtes examinées par colonne éligible.');
   }
   if(type==='Attachments'){const many=rowids(name,i=>(listValue(vs[i])||[]).length>=20);if(many.length||vs.reduce((n,v)=>n+(listValue(v)||[]).length,0)>=1000)emit('N50',name,col,many);}
   if(!raw.trim())continue;
   for(const lookup of simpleLookups(raw)){
    if(lookupCalls>=100){limited('N31','Budget de 100 index de lookupOne atteint.');break;}
    if(lookup.terms.some(p=>p.key==='order_by'||typeof p.value==='string'&&p.value.length>120))continue;
    const target=sd[lookup.table];if(!target||lookup.terms.some(p=>!target[p.key]||p.local&&!sd[name]?.[p.local]))continue;lookupCalls++;
    const bounded=v=>usable(v)&&(typeof v!=='string'||v.length<=120);const index=new Map();
    for(let j=0;j<target.id.length;j++){const key=lookup.terms.map(p=>target[p.key][j]);if(key.every(bounded)){const s=serial(key);index.set(s,(index.get(s)||0)+1);}}
    const ambiguous=ids.slice(0,200).filter((_,i)=>{const key=lookup.terms.map(p=>p.local?values(name,p.local)[i]:p.value);return key.every(bounded)&&(index.get(serial(key))||0)>1;});
    if(ambiguous.length)emit('N31',name,col,ambiguous,'lookupOne : plusieurs fiches pour les mêmes critères dans les lignes examinées');if(ids.length>200)limited('N31','Au plus 200 recherches sources examinées par appel.');
   }
   if(!/\b(if|IF|IFERROR)\b/.test(mask)){const denominators=[...mask.matchAll(/\/\s*\$([A-Za-z_]\w*)/g)].map(m=>m[1]);for(const d of denominators)if(values(name,d).some(v=>scalar(v)===0))emit('N34',name,col,[],'Diviseur nul ; aucune garde simple if / IF reconnue');}

  }
 }
 if(pages)for(const table of pages.tablesWithoutPage||[])emit('N47',table);
 for(const v of filterViews.views)emit('X13',v.table,null,[],`${v.page?'Page « '+v.page+' » · ':''}vue « ${v.title||v.table} » (n° ${v.section}) : ${v.count} champs de filtre affichés (${v.columns.slice(0,8).join(', ')}${v.count>8?', …':''})`);
 if(meta.filters&&columnarToRows(meta.filters).some(f=>typeof f.filter==='string'&&f.filter.trim()&&f.filter!=='null'))emit('N69','Affichage des pages',null,[],'Un filtre de vue organise l’affichage ; il ne définit pas les droits d’accès');
 if(access){
  const groups=(access.tables||[]).flatMap(t=>[{table:t.tableId,rules:t.rules},...(t.columns||[]).map(c=>({table:t.tableId,rules:c.rules}))]);
  const all=[...(access.defaults||[]),...groups.flatMap(g=>g.rules),...(access.special||[]).flatMap(s=>s.rules)];
  if(all.some(r=>['EDITOR','VIEWER'].some(role=>conditionForRole(r.formula,role)===null)))limited('N53','Certains droits d’accès dépendent de la personne ou d’une ligne ; aucune autorisation n’est déduite de ces conditions.');
  const canWrite=(table,c)=>['EDITOR','VIEWER'].some(role=>effectivePermission(access,table,c,role,'U')==='allow');
  for(const g of groups)for(const r of g.rules)if(r.perms.R||r.perms.U)for(const c of refsIn(r.formula))if(schema.get(g.table)?.columns.has(c)&&!schema.get(g.table).columns.get(c).isFormula&&canWrite(g.table,c))emit('N53',g.table,c,[],'Colonne utilisée par les droits d’accès et modifiable par un rôle non propriétaire');
  for(const a of access.attributes||[]){const target=schema.get(a.tableId);if(!target)continue;
   const name=a.name.replace(/[^A-Za-z0-9_]/g,''),uses=all.flatMap(r=>[...String(r.formula).matchAll(new RegExp('\\buser\\.'+name+'\\.([A-Za-z_]\\w*)','g'))].map(m=>m[1]));
   for(const c of new Set([a.lookupColId,...uses]))if(target.columns.has(c)&&!target.columns.get(c).isFormula&&(canWrite(a.tableId,c)||['EDITOR','VIEWER'].some(role=>effectivePermission(access,a.tableId,null,role,'C')==='allow')))emit('N53',a.tableId,c,[],'Champ de la table d’habilitation : modification ou création reconnue pour un rôle non propriétaire');
  }
 }
 const usage = inspectUsage({schema,data:sd,coverage:sampled.coverage,meta,access,limits:{formulaChars:limits.formulaChars}});
 for(const check of usage.checks)status.set(check.id,check);
 for(const signal of usage.signals)emit(signal.id,signal.table,signal.column,signal.rows,signal.note);
 // Une seule cause par colonne : le champ rapporté remplace le doublon de lookupOne.
 const redundant = hits.get('U02');
 if(redundant && hits.has('N31')) {
  const remaining=hits.get('N31').filter(t=>!redundant.some(u=>u.table===t.table&&u.column===t.column));
  if(remaining.length){hits.set('N31',remaining);counts.set('N31',remaining.length);signatures.set('N31',hash(serial(remaining)));}
  else {hits.delete('N31');limited('N31','La recherche redondante est expliquée par U02, sans seconde carte pour la même colonne.');}
 }
 for(const [id,targets]of hits){const def=infoById.get(id),isSample=!metadataOnly.has(id)&&(targets.some(t=>byCoverage.get(t.table)?.sampled)||id==='N06'&&targets.some(t=>(values(t.table,t.column).length||0)>200)||id==='N31'&&(sampled.coverage.some(c=>c.sampled)||targets.some(t=>values(t.table,'id').length>200)));
  items.push({id,severity:def.severity,area:def.area,title:def.title,summary:def.summary,why:def.why,...(def.intended?{intended:def.intended}:{}),steps:def.steps,targets,method:def.detection,limitations:def.false_positives,evidence:{version:def.ruleVersion||1,signature:signatures.get(id),coverage:isSample?'sample':'visible',targetCount:counts.get(id),rowExamples:targets.flatMap(t=>t.note.match(/lignes ([\d, ]+)/)?.[1]?.split(',').map(s=>s.trim())||[]).slice(0,3)},calculation:targets.map(t=>t.note).filter(Boolean).slice(0,3).join(' ; ')});
  status.set(id,{id,state:'detected',reason:isSample?'Signal observé sur un échantillon de lignes lisibles.':'Signal observé sur les éléments lisibles examinés.'});
 }
 if(formulaTruncated)for(const id of ['N31','N34'])limited(id,'Budget de formules atteint ; contrôle incomplet.');
 const truncated=sampled.coverage.some(c=>c.sampled);if(truncated||failedTables.length)for(const id of RETAINED_IDS)if(!metadataOnly.has(id))limited(id,'Vérification limitée à l’échantillon ou aux tables chargées.');
 return {items,checks:[...status.values()],coverage:sampled.coverage,failedTables,configurationError:'',cells:sampled.cells,formulaChars:chars,sampled:truncated,profilesData:sd,usage:usage.counters};
}


