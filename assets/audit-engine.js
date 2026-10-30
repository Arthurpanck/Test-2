/** Contrôles bornés, sans réseau ni exécution de formules ou de conditions d'accès. */
import { AUDIT_CATALOG, RETAINED_IDS } from './audit-catalog.js?v=3.5.0';
import { columnarToRows } from './converter.js?v=3.5.0';
import { inspectVisibleFilters } from './filter-audit.js?v=3.5.0';
import { annualColumnFamilies } from './annual-columns.js?v=3.5.0';
export const AUDIT_LIMITS = { rows: 2000, cells: 100000, formulaChars: 200000, edges: 100000, pairs: 100 };
const infoById = new Map(AUDIT_CATALOG.map(x => [x.id, x]));
const fold = x => String(x ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const clean = x => String(x).normalize('NFC').trim().replace(/[\s\u200b]+/g, ' ').toLowerCase();
const TECH = /^(id|manualSort|gristHelper_.*|#.*)$/;
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
 * Prépare l'échantillon d'une table dès sa lecture, pour libérer aussitôt la table complète :
 * garde les ids (intégrité des références, nombre de lignes) et les `limits.rows` lignes de plus
 * petit hachage, triées par hachage. sampleAuditData() en tire ensuite exactement les mêmes
 * lignes que sur la table complète (les `take` plus petites forment un préfixe de cette liste).
 */
export function presampleTable(name, d, limits = AUDIT_LIMITS) {
  if (!Array.isArray(d?.id) || d[PRESAMPLE]) return d;
  const cols = Object.keys(d).filter(c => c !== 'id' && Array.isArray(d[c]) && !TECH.test(c));
  const n = d.id.length, keep = Math.min(n, limits.rows);
  let picked;
  if (keep === n) picked = d.id.map((id, i) => ({ i, h: hash(name+':'+id) }));
  else { const heap = []; const worse = (a,b) => a.h > b.h || (a.h === b.h && a.i > b.i); const down = () => { let p=0; for (;;) { let a=p*2+1; if(a>=heap.length)break;let b=a+1;if(b<heap.length&&worse(heap[b],heap[a]))a=b;if(!worse(heap[a],heap[p]))break;[heap[a],heap[p]]=[heap[p],heap[a]];p=a; } }; for(let i=0;keep&&i<n;i++){const x={i,h:hash(name+':'+d.id[i])};if(heap.length<keep){heap.push(x);let p=heap.length-1;while(p){let q=(p-1)>>1;if(!worse(heap[p],heap[q]))break;[heap[p],heap[q]]=[heap[q],heap[p]];p=q;}}else if(worse(heap[0],x)){heap[0]=x;down();}} picked = heap; }
  picked.sort(byHash);
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
    // Une file triée bornée évite un tri de toutes les lignes d'une grande table.
    let idx;
    if (take === d.id.length) idx = d.id.map((_,i) => i);
    else { const heap = []; const worse = (a,b) => a.h > b.h || (a.h === b.h && a.i > b.i); const down = () => { let p=0; for (;;) { let a=p*2+1; if(a>=heap.length)break;let b=a+1;if(b<heap.length&&worse(heap[b],heap[a]))a=b;if(!worse(heap[a],heap[p]))break;[heap[a],heap[p]]=[heap[p],heap[a]];p=a; } }; for(let i=0;take&&i<d.id.length;i++){const x={i,h:hash(name+':'+d.id[i])};if(heap.length<take){heap.push(x);let p=heap.length-1;while(p){let q=(p-1)>>1;if(!worse(heap[p],heap[q]))break;[heap[p],heap[q]]=[heap[q],heap[p]];p=q;}}else if(worse(heap[0],x)){heap[0]=x;down();}}idx=heap.map(x=>x.i).sort((a,b)=>a-b); }
    result[name] = Object.fromEntries(['id',...cols].map(c => [c,idx.map(i => d[c][i])]));
    const cells=take*cols.length; remaining-=cells;
    coverage.push({ table:name, visibleRows:d.id.length, inspectedRows:take, cells, sampled:take<d.id.length });
  }
  return { data:result, coverage, cells:limits.cells-remaining };
}
/** Masque les commentaires et chaînes Python, en conservant les positions. */
export function maskPython(code) {
  let out='',quote='',triple=false,comment=false;
  for(let i=0;i<code.length;i++) { const c=code[i];if(comment){if(c==='\n'){comment=false;out+='\n';}else out+=' ';continue;}if(quote){if(c==='\\'){out+='  ';i++;continue;}if(triple&&code.slice(i,i+3)===quote.repeat(3)){out+='   ';i+=2;quote='';triple=false;}else if(!triple&&c===quote){out+=' ';quote='';}else out+=c==='\n'?'\n':' ';continue;}if(c==='#'){comment=true;out+=' ';}else if(c==='"'||c==="'"){quote=c;triple=code.slice(i,i+3)===c.repeat(3);out+=triple?'   ':' ';if(triple)i+=2;}else out+=c; }
  return out;
}
const refsIn = code => [...maskPython(code).matchAll(/(?:\$|\brec\.)([A-Za-z_]\w*)/g)].map(m=>m[1]);
/** Sous-ensemble fermé : rôles, True/False, parenthèses, listes et comparaisons. Inconnu sinon. */
export function conditionForRole(formula, role) {
  const f=String(formula||'').trim();if(!f)return true;
  const tokens=f.match(/user\.Access|\b(?:OWNER|EDITOR|VIEWER|True|False|and|or|not|in)\b|==|!=|[()[\],]/g)||[];
  if(tokens.join('')!==f.replace(/\s+/g,''))return null;let at=0;
  try{const atom=()=>{const t=tokens[at++];if(t==='('){const v=or();if(tokens[at++]!==')')throw 0;return v;}if(t==='['){const arr=[];while(tokens[at]!==']'){arr.push(atom());if(tokens[at]!==',')break;at++;}if(tokens[at++]!==']')throw 0;return arr;}if(t==='user.Access')return role;if(['OWNER','EDITOR','VIEWER'].includes(t))return t;if(t==='True')return true;if(t==='False')return false;throw 0;};const cmp=()=>{let a=atom(),op=tokens[at];if(['==','!=','in','not'].includes(op)){at++;if(op==='not'){if(tokens[at++]!=='in')throw 0;op='not in';}let b=atom();if(op==='==')return a===b;if(op==='!=')return a!==b;if(!Array.isArray(b))throw 0;return op==='in'?b.includes(a):!b.includes(a);}if(typeof a!=='boolean')throw 0;return a;};const not=()=>tokens[at]==='not'?(at++,!not()):cmp();const and=()=>{let a=not();while(tokens[at]==='and'){at++;const b=not();a=a&&b;}return a;};const or=()=>{let a=and();while(tokens[at]==='or'){at++;const b=and();a=a||b;}return a;};const v=or();return at===tokens.length&&typeof v==='boolean'?v:null;}catch{return null;}
}
function ruleDecision(rules, role, bit) { let uncertain=false; for(const r of rules||[]){if(!r.perms?.[bit])continue;const c=conditionForRole(r.formula,role);if(c===null){uncertain=true;continue;}if(c)return uncertain?null:r.perms[bit];}return uncertain?null:undefined; }
export function effectivePermission(access, table, col, role, bit) {
  if(!access)return null;const t=access.tables?.find(t=>t.tableId===table);
  const groups=[...(col?(t?.columns||[]).filter(c=>c.colIds.includes(col)).map(c=>c.rules):[]),t?.rules||[],access.defaults||[]];
  for(const rs of groups){const d=ruleDecision(rs,role,bit);if(d!==undefined)return d;}
  return bit==='R'||role==='OWNER'||role==='EDITOR'?'allow':'deny';
}
/** Parse uniquement lookupOne avec égalités à une colonne locale ou un littéral simple. */
export function simpleLookups(code) {
 const mask=maskPython(code),out=[];const re=/\b([A-Za-z_]\w*)\.lookupOne\s*\(([^()]*)\)/g;let m;
 while((m=re.exec(mask))){const original=code.slice(m.index,m.index+m[0].length);const args=original.slice(original.indexOf('(')+1,-1);const terms=args.split(',').map(x=>x.trim()).filter(Boolean);const parsed=[];let valid=terms.length>0;for(const part of terms){let p=/^([A-Za-z_]\w*)\s*=\s*(?:\$([A-Za-z_]\w*)|(-?\d+(?:\.\d+)?)|(['"])([^'"\\]*)\4)$/.exec(part);if(!p){valid=false;break;}parsed.push({key:p[1],local:p[2],value:p[3]!==undefined?Number(p[3]):p[5]});}if(valid)out.push({table:m[1],terms:parsed,after:mask.slice(m.index+m[0].length)});}
 return out;
}
const ratio=(a,b)=>b?a/b:0;
export function runAudit({schema=new Map(),data={},access=null,pages=null,meta={},failedTables=[],limits=AUDIT_LIMITS}={}) {
 const sampled=sampleAuditData(data,limits),sd=sampled.data,byCoverage=new Map(sampled.coverage.map(x=>[x.table,x]));
 const items=[],hits=new Map(),counts=new Map(),signatures=new Map();
 const status=new Map(RETAINED_IDS.map(id=>[id,{id,state:'checked',reason:'Aucun signal dans les éléments examinés.'}]));
 const metadataOnly=new Set(['N41','N47','N53','N57','N69','X13']);
 const unavailable=(id,reason)=>status.set(id,{id,state:'unavailable',reason});
 const limited=(id,reason)=>{if(status.get(id)?.state==='checked')status.set(id,{id,state:'limited',reason});};
 if(!access){unavailable('N53','Droits d’accès indisponibles.');unavailable('N57','Droits d’accès indisponibles.');}
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
  for(const family of annualColumnFamilies(cs))emit('N41',name,null,[],family.columns.length+' colonnes annuelles : '+family.columns.map(c=>c.column).slice(0,8).join(', '));
  for(const c of cs){
   const col=c.colId,type=String(c.type||'Any').split(':')[0],vs=values(name,col),short=vs.slice(0,200),shortFilled=short.filter(usable),texts=shortFilled.filter(v=>typeof v==='string');
   const {raw,mask}=formulaCode.get(name+'.'+col)||{raw:'',mask:''};
   if(c.isFormula&&String(c.formula||'').trim()){const errors=rowids(name,i=>isErrorValue(vs[i])&&!/Censored|Access|Permission/.test(String(vs[i][1])));if(errors.length)emit('N01',name,col,errors);}
   const invalid=v=>{if(!usable(v))return false;const s=scalar(v);if(type==='Numeric')return typeof s!=='number'||!Number.isFinite(s);if(type==='Int')return typeof s!=='number'||!Number.isInteger(s);if(type==='Bool')return typeof s!=='boolean';if(['Date','DateTime'].includes(type))return typeof s!=='number'||!Number.isFinite(s);if(type==='Ref')return typeof s!=='number'||!Number.isInteger(s)||s<0;if(['RefList','Attachments'].includes(type)){const a=listValue(v);return !a||a.some(x=>typeof x!=='number'||!Number.isInteger(x)||x<0);}return false;};
   const bad=rowids(name,i=>invalid(vs[i]));if(bad.length)emit('N02',name,col,bad,bad.length+' cellules incompatibles avec le type '+type);
   if(/code|ref|mail|statut|categorie|nom/i.test(col)&&!/notes?|description|adresse/i.test(col)){
    const invisible=ids.slice(0,200).filter((_,i)=>typeof short[i]==='string'&&short[i].length<=120&&!/[\r\n]/.test(short[i])&&(/^[\s\u200b]|[\s\u200b]$|[\u00a0\u202f\u200b]/.test(short[i])));
    if(invisible.length>=2||ratio(invisible.length,shortFilled.length)>=.05)emit('N06',name,col,invisible,Math.min(vs.length,200)+' cellules au maximum, textes courts seulement');
    if(vs.length>200)limited('N06','Au plus 200 cellules courtes examinées par colonne éligible.');
   }
   if(!c.isFormula&&type==='Text'&&!/notes?|description|adresse/i.test(col)){
    const text=texts.filter(v=>v.length<=500);if(text.length>=5&&ratio(text.filter(v=>v.split(/[;\n]/).filter(s=>s.trim()).length>=2).length,text.length)>=.3)emit('N09',name,col,[],'Au moins 30 % de '+text.length+' textes examinés contiennent une liste apparente');
    if(vs.length>200)limited('N09','Au plus 200 cellules examinées par colonne Texte.');
   }
   const nums=vs.filter(usable).map(scalar).filter(v=>typeof v==='number'&&Number.isFinite(v));
   if(['Numeric','Int'].includes(type)&&/date/i.test(col)&&nums.length>=5&&ratio(nums.filter(v=>Number.isInteger(v)&&v>=20000&&v<=80000).length,nums.length)>=.8)emit('N17',name,col);
   if(type==='Ref'&&String(c.type).slice(4)===name&&/^(parent|manager|responsable|superieur)$/i.test(fold(col))){const self=rowids(name,i=>scalar(vs[i])===ids[i]);if(self.length)emit('N28',name,col,self);}
   if(type==='Attachments'){const many=rowids(name,i=>(listValue(vs[i])||[]).length>=20);if(many.length||vs.reduce((n,v)=>n+(listValue(v)||[]).length,0)>=1000)emit('N50',name,col,many);}
   if(type==='ChoiceList'&&Array.isArray(c.widgetOptions?.choices)&&c.widgetOptions.choices.length){const allowed=new Set(c.widgetOptions.choices),outside=rowids(name,i=>(listValue(vs[i])||[]).some(x=>typeof x==='string'&&!allowed.has(x)));if(outside.length)emit('N64',name,col,outside,'Éléments absents des choix proposés');}
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
  for(const r of all)if(/\buser\.Name\s*(?:==|!=|in)/.test(maskPython(r.formula||'')))emit('N57','Droits d’accès',null,[],'Condition utilisant le nom affiché');
 }
 for(const [id,targets]of hits){const def=infoById.get(id),isSample=!metadataOnly.has(id)&&(targets.some(t=>byCoverage.get(t.table)?.sampled)||['N06','N09'].includes(id)&&targets.some(t=>(values(t.table,t.column).length||0)>200)||id==='N31'&&(sampled.coverage.some(c=>c.sampled)||targets.some(t=>values(t.table,'id').length>200)));
  items.push({id,severity:def.severity,area:def.area,title:def.title,summary:def.summary,why:def.why,...(def.intended?{intended:def.intended}:{}),steps:def.steps,targets,method:def.detection,limitations:def.false_positives,evidence:{version:def.ruleVersion||1,signature:signatures.get(id),coverage:isSample?'sample':'visible',targetCount:counts.get(id),rowExamples:targets.flatMap(t=>t.note.match(/lignes ([\d, ]+)/)?.[1]?.split(',').map(s=>s.trim())||[]).slice(0,3)},calculation:targets.map(t=>t.note).filter(Boolean).slice(0,3).join(' ; ')});
  status.set(id,{id,state:'detected',reason:isSample?'Signal observé sur un échantillon de lignes lisibles.':'Signal observé sur les éléments lisibles examinés.'});
 }
 if(formulaTruncated)for(const id of ['N31','N34'])limited(id,'Budget de formules atteint ; contrôle incomplet.');
 const truncated=sampled.coverage.some(c=>c.sampled);if(truncated||failedTables.length)for(const id of RETAINED_IDS)if(!metadataOnly.has(id))limited(id,'Vérification limitée à l’échantillon ou aux tables chargées.');
 return {items,checks:[...status.values()],coverage:sampled.coverage,failedTables,configurationError:'',cells:sampled.cells,formulaChars:chars,sampled:truncated,profilesData:sd};
}
