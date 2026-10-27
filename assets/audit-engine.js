/** Contrôles bornés, sans réseau ni exécution de formules ou de conditions d'accès. */
import { validateAuditConfig } from './audit-config.js?v=2.8.0';
import { AUDIT_CATALOG, RETAINED_IDS } from './audit-catalog.js?v=2.8.0';
import { columnarToRows } from './converter.js?v=2.8.0';
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
const kind = v => Array.isArray(v) && ['d','D'].includes(v[0]) ? 'date' : Array.isArray(v) && ['R','r'].includes(v[0]) ? 'reference' : Array.isArray(v) ? 'liste' : typeof v;
const serial = v => JSON.stringify(v, (_,x) => typeof x === 'number' && !Number.isFinite(x) ? String(x) : x);
function hash(s) { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0),16777619); return h >>> 0; }
/** Échantillon déterministe, réparti par hachage d'ids ; coût de profilage global borné. */
export function sampleAuditData(data, limits = AUDIT_LIMITS) {
  const result = {}, coverage = []; const entries = Object.entries(data || {}).filter(([,d]) => Array.isArray(d?.id));
  let remaining = limits.cells;
  for (let e = 0; e < entries.length; e++) {
    const [name,d] = entries[e], cols = Object.keys(d).filter(c => c !== 'id' && Array.isArray(d[c]) && !TECH.test(c));
    const allowance = Math.floor(remaining / (entries.length - e));
    const take = Math.min(d.id.length, limits.rows, cols.length ? Math.floor(allowance / cols.length) : limits.rows);
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
const hasConfig=(cfg,key)=>Array.isArray(cfg?.[key])&&cfg[key].length>0;
export function runAudit({schema=new Map(),data={},access=null,pages=null,meta={},config={},failedTables=[],limits=AUDIT_LIMITS,now=new Date()}={}) {
 let configurationError='';try{config=validateAuditConfig(config);}catch(e){config={};configurationError=e.message;}
 const sampled=sampleAuditData(data,limits),sd=sampled.data,byCoverage=new Map(sampled.coverage.map(x=>[x.table,x]));
 const items=[],hits=new Map(),hitCounts=new Map(),hitSignatures=new Map(),status=new Map(RETAINED_IDS.map(id=>[id,{id,state:'checked',reason:'Aucun signal dans les éléments examinés.'}]));
 const required={N04:'keys',N19:'dateBounds',N27:'totals',N65:'copies'};
 for(const [id,key] of Object.entries(required))if(!hasConfig(config,key))status.set(id,{id,state:'configuration',reason:'Règle métier non définie : '+key+'.'});
 const requireMeta=(id,exists)=>{if(!exists)status.set(id,{id,state:'unavailable',reason:'Métadonnées nécessaires indisponibles.'});};
 for(const id of ['N51','N52','N53','N54','N55','N56','N57','N63'])requireMeta(id,access);
 requireMeta('N47',pages);requireMeta('N69',meta.filters);requireMeta('N70',meta.attachments);
 let chars=0,formulaTruncated=false;const formulaCode=new Map();
 for(const t of schema.values())for(const c of t.columns.values()){const f=String(c.formula||'');if(chars+f.length<=limits.formulaChars){formulaCode.set(t.tableId+'.'+c.colId,{raw:f,mask:maskPython(f)});chars+=f.length;}else formulaTruncated=true;}
 const codeFor=(t,c)=>formulaCode.get(t+'.'+c)||{raw:'',mask:''};
 const emit=(id,table,column,rows=[],note='')=>{if(!infoById.has(id)||!RETAINED_IDS.includes(id))return;hitCounts.set(id,(hitCounts.get(id)||0)+1);hitSignatures.set(id,hash(String(hitSignatures.get(id)||0)+serial([table,column,rows,note])));if(!hits.has(id))hits.set(id,[]);if(hits.get(id).length>=100)return;const r=[...new Set(rows)].slice(0,3);const target={table,...(column?{column}:{}),note:[note,r.length?'lignes '+r.join(', '):''].filter(Boolean).join(' · ')};if(!hits.get(id).some(x=>serial(x)===serial(target)))hits.get(id).push(target);};
 const allcols=t=>[...t.columns.values()].filter(c=>!TECH.test(c.colId));
 const values=(t,c)=>sd[t]?.[c]||[];
 const rowids=(t,predicate)=>values(t,'id').filter((_,i)=>predicate(i));
 const configured=(key,table)=>Array.isArray(config[key])?config[key].filter(x=>x.table===table):[];
 const nonemptyRows=t=>(sd[t]?.id||[]).map((id,i)=>({id,i}));
 for(const t of schema.values()){
  const name=t.tableId;if(!name||name.startsWith('_grist_'))continue;
  const cols=allcols(t),ids=values(name,'id'),isSummary=Boolean(t.summarySourceTable);
  const inputCols=cols.filter(c=>!c.isFormula);
  if(!isSummary&&inputCols.length>=2&&ids.length){const seen=new Map();for(let i=0;i<ids.length;i++){const vs=inputCols.map(c=>values(name,c.colId)[i]);if(vs.some(isCensored)||vs.filter(usable).length<2||inputCols.some(c=>!sd[name]?.[c.colId]))continue;const key=serial(vs);if(seen.has(key))emit('N03',name,null,[seen.get(key),ids[i]],'Même saisie dans '+inputCols.length+' colonnes lisibles');else seen.set(key,ids[i]);}}
  for(const k of configured('keys',name)){const cs=k.columns;if(!Array.isArray(cs)||!cs.length||cs.some(c=>!t.columns.has(c)||!sd[name]?.[c]))continue;const seen=new Map();for(let i=0;i<ids.length;i++){const vs=cs.map(c=>values(name,c)[i]);if(vs.some(v=>!usable(v)))continue;const key=serial(vs);if(seen.has(key))emit('N04',name,cs.join(', '),[seen.get(key),ids[i]],'Clé déclarée : '+cs.join(' + '));else seen.set(key,ids[i]);}}
  const labelMap=new Map();for(const c of cols){const l=clean(c.label||c.colId);if(labelMap.has(l))emit('N43',name,c.colId,[],'Même libellé que '+labelMap.get(l));else labelMap.set(l,c.colId);}
  const radicals=new Map();for(const c of inputCols){const m=/^(.*?)[_ ]?(\d+)$/.exec(c.colId);if(m&&!/^\d{4}$/.test(m[2])){const k=m[1]+':'+c.type;radicals.set(k,[...(radicals.get(k)||[]),c]);}}for(const group of radicals.values())if(group.length>=3)emit('N40',name,group[0].colId,[],group.length+' colonnes de même famille');
  const yearCols=inputCols.filter(c=>/(?:^|_)(19|20)\d{2}$/.test(c.colId));const months=inputCols.filter(c=>/^(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)$/i.test(fold(c.colId)));if(yearCols.length>=3||months.length>=4)emit('N41',name,null,[],yearCols.length+' années, '+months.length+' mois');
  const undocumented=cols.filter(c=>!c.description&&((c.formula||'').length>200||cols.length>=20||access?.tables?.some(a=>a.tableId===name&&[...a.rules,...a.columns.flatMap(x=>x.rules)].some(r=>refsIn(r.formula).includes(c.colId)))));if(undocumented.length>=3)emit('N67',name,null,[],undocumented.length+' champs importants sans description');
  // Matrice creuse conditionnelle : regroupement par Type, sans comparaison quadratique des lignes.
  const typeCol=inputCols.find(c=>/^type$/i.test(c.colId));if(typeCol&&inputCols.length>=8&&ids.length>=20){const groups=new Map();values(name,typeCol.colId).forEach((v,i)=>{if(usable(v)){const k=serial(v);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(i);}});const gs=[...groups.values()].filter(g=>g.length>=5).slice(0,10);for(let a=0;a<gs.length;a++)for(let b=a+1;b<gs.length;b++){const [g,h]=[gs[a],gs[b]];const n=inputCols.filter(c=>ratio(g.filter(i=>usable(values(name,c.colId)[i])).length,g.length)>=.8&&ratio(h.filter(i=>usable(values(name,c.colId)[i])).length,h.length)<=.1).length;const m=inputCols.filter(c=>ratio(h.filter(i=>usable(values(name,c.colId)[i])).length,h.length)>=.8&&ratio(g.filter(i=>usable(values(name,c.colId)[i])).length,g.length)<=.1).length;if(n>=3&&m>=3)emit('N42',name,typeCol.colId,[],'Deux groupes utilisent des ensembles de champs différents');}}
  for(let i=0;i<ids.length;i++){const filled=inputCols.filter(c=>usable(values(name,c.colId)[i]));const matches=filled.filter(c=>typeof values(name,c.colId)[i]==='string'&&[clean(c.label||c.colId),clean(c.colId)].includes(clean(values(name,c.colId)[i])));if(matches.length>=3&&ratio(matches.length,filled.length)>=.6)emit('N07',name,null,[ids[i]],matches.length+' cellules reprennent les en-têtes');}
  for(const c of cols){const col=c.colId,vs=values(name,col),filled=vs.filter(usable),text=filled.filter(v=>typeof v==='string'),type=String(c.type||'Any').split(':')[0],{raw,mask}=codeFor(name,col);const refs=refsIn(raw);
   const errs=rowids(name,i=>isErrorValue(vs[i])&&!/Censored|Access|Permission/.test(String(vs[i][1])));
   const cycles=rowids(name,i=>isErrorValue(vs[i])&&/CircularRef|CircularReference/.test(String(vs[i][1])));
   if(c.isFormula&&raw.trim()){if(cycles.length)emit('N61',name,col,cycles);if(errs.length>cycles.length)emit('N01',name,col,errs.filter(x=>!cycles.includes(x)));}
   const invalid=v=>{if(!usable(v))return false;const s=scalar(v);if(type==='Numeric')return typeof s!=='number'||!Number.isFinite(s);if(type==='Int')return typeof s!=='number'||!Number.isInteger(s);if(type==='Bool')return typeof s!=='boolean';if(type==='Date'||type==='DateTime')return typeof s!=='number'||!Number.isFinite(s);if(type==='Ref')return typeof s!=='number'||!Number.isInteger(s)||s<0;if(type==='RefList'||type==='Attachments')return !listValue(v)||listValue(v).some(x=>typeof x!=='number'||!Number.isInteger(x)||x<0);return false;};
   const bad=rowids(name,i=>invalid(vs[i]));if(bad.length)emit('N02',name,col,bad,bad.length+' cellules incompatibles avec le type '+type);
   if(!c.isFormula&&type==='Text'&&text.length>=5&&text.every(v=>v.length<=120)&&!/notes?|description|adresse/i.test(col)){const normalized=new Map();for(const v of text){let k=clean(v);if(!normalized.has(k))normalized.set(k,new Set());normalized.get(k).add(v);}if([...normalized.values()].some(s=>s.size>=2))emit('N05',name,col,[],text.length+' valeurs textuelles comparées');}
   if(/code|ref|mail|statut|categorie|nom/i.test(col)&&!/^notes?|description|adresse/i.test(col)){const invisible=rowids(name,i=>typeof vs[i]==='string'&&vs[i].length<=120&&!/[\r\n]/.test(vs[i])&&(/^[\s\u200b]|[\s\u200b]$|[\u00a0\u202f\u200b]/.test(vs[i])));if(invisible.length>=2||ratio(invisible.length,filled.length)>=.05)emit('N06',name,col,invisible);}
   if(!c.isFormula&&!/notes?|description|adresse/i.test(col)&&text.length>=5&&ratio(text.filter(v=>v.split(/[;\n]/).filter(s=>s.trim()).length>=2).length,text.length)>=.3)emit('N09',name,col,[],'Au moins 30 % des textes contiennent une liste apparente');
   if(type==='Any'&&filled.length>=10){const kinds=new Map();for(const v of filled)kinds.set(kind(v),(kinds.get(kind(v))||0)+1);if([...kinds.values()].filter(n=>n/filled.length>=.2).length>=2)emit('N10',name,col,[],'Au moins deux genres de valeurs représentent chacun 20 % des cellules');}
   if(text.length>=5&&!/^notes?|description/i.test(col)&&text.filter(v=>/^(n\/?a|nc|inconnu|a renseigner|-)$/i.test(fold(v.trim()))).length>=2)emit('N11',name,col);
   if(['Numeric','Int'].includes(type)&&/^(cp|siret|siren|telephone|tel|code.*|.*postal.*)$/i.test(fold(col))&&filled.length>=3)emit('N13',name,col,[],'Code stocké dans une colonne '+type);
   if(type==='Text'&&/montant|prix|cout|budget/i.test(col)&&text.length>=5){const us=text.filter(v=>/\d,\d{3}\.\d{2}/.test(v)).length,eu=text.filter(v=>/\d\.\d{3},\d{2}/.test(v)).length;if(us>=2&&eu>=2)emit('N14',name,col,[],'Deux formats de séparateurs attestés au moins deux fois chacun');}
   const nums=filled.map(scalar).filter(v=>typeof v==='number'&&Number.isFinite(v));
   if(['Numeric','Int'].includes(type)&&/date/i.test(col)&&nums.length>=5&&ratio(nums.filter(v=>Number.isInteger(v)&&v>=20000&&v<=80000).length,nums.length)>=.8)emit('N17',name,col);
   for(const b of configured('dateBounds',name).filter(b=>b.column===col)){if(!['Date','DateTime'].includes(type))continue;const min=b.min?Date.parse(b.min)/1000:-Infinity,max=b.max?Date.parse(b.max)/1000:Infinity;if(Number.isNaN(min)||Number.isNaN(max))continue;const bad=rowids(name,i=>typeof scalar(vs[i])==='number'&&(scalar(vs[i])<min||scalar(vs[i])>max));if(bad.length)emit('N19',name,col,bad,'Hors des bornes déclarées');}
   if(/taux|pourcentage/i.test(col)&&nums.filter(v=>v>0).length>=6){const small=nums.filter(v=>v>0&&v<=1).sort((a,b)=>a-b),big=nums.filter(v=>v>1&&v<=100).sort((a,b)=>a-b);const med=a=>a[Math.floor(a.length/2)];if(small.length>=2&&big.length>=2&&med(big)/med(small)>=50&&med(big)/med(small)<=200)emit('N22',name,col);}
   if(/poids|masse|duree|montant|distance|taille/i.test(fold(col))&&text.length>=5){for(const family of [['kg','g'],['h','min'],['EUR','USD'],['m','cm']])if(family.every(u=>text.filter(v=>new RegExp('\\d\\s*'+u+'$','i').test(v.trim())).length>=2))emit('N23',name,col);}
   if(['Numeric','Int'].includes(type)&&nums.length>=30&&new Set(nums).size>=10){const a=nums.slice().sort((a,b)=>a-b),q1=a[Math.floor((a.length-1)*.25)],q3=a[Math.floor((a.length-1)*.75)],iqr=q3-q1;if(iqr>0){const bad=rowids(name,i=>typeof scalar(vs[i])==='number'&&(scalar(vs[i])<q1-3*iqr||scalar(vs[i])>q3+3*iqr));if(bad.length)emit('N24',name,col,bad,'Au-delà de trois écarts interquartiles');}}
   if(['Ref','RefList'].includes(type)){const target=String(c.type).split(':').slice(1).join(':'),full=data[target];if(full&&Array.isArray(full.id)){const dest=new Set(full.id);const bad=rowids(name,i=>{const vals=type==='Ref'?[scalar(vs[i])]:listValue(vs[i])||[];return vals.some(v=>typeof v==='number'&&v>0&&!dest.has(v));});if(bad.length)emit('N30',name,col,bad,'Destination absente des lignes lisibles, pas nécessairement supprimée');}
    const targetSchema=schema.get(target);if(targetSchema?.summarySourceTable&&!isSummary)emit('N46',name,col);
    if(c.visibleCol&&sd[target]?.[c.visibleCol]){const counts=new Map();for(const v of values(target,c.visibleCol))if(usable(v))counts.set(serial(v),(counts.get(serial(v))||0)+1);if([...counts.values()].some(n=>n>1))emit('N44',name,col,[],'Plusieurs fiches portent le même libellé affiché');}
    const hierarchy=type==='Ref'&&target===name&&(/^(parent|manager|responsable|superieur)$/i.test(fold(col))||configured('hierarchies',name).some(h=>h.column===col));if(hierarchy){const self=rowids(name,i=>scalar(vs[i])===ids[i]);if(self.length)emit('N28',name,col,self);const edges=new Map(ids.map((id,i)=>[id,scalar(vs[i])]));let visited=new Set(),n=0;for(const start of ids){let path=[],pos=new Map(),x=start;while(edges.has(x)&&!visited.has(x)&&n++<limits.edges){if(pos.has(x)){const loop=path.slice(pos.get(x));if(loop.length>1)emit('N29',name,col,loop,'Boucle de '+loop.length+' fiches');break;}pos.set(x,path.length);path.push(x);x=edges.get(x);}for(const v of path)visited.add(v);}}
   }
   if(text.some(v=>/^(file:\/\/|[A-Za-z]:\\|\\\\)/.test(v))&&/fichier|piece|justif|lien|chemin|document/i.test(col))emit('N48',name,col);
   const temporary=text.some(v=>{try{const u=new URL(v);return /^https?:$/.test(u.protocol)&&([...u.searchParams.keys()].some(k=>/^X-Amz-(Expires|Signature)$/i.test(k))||(u.searchParams.has('sig')&&u.searchParams.has('se'))||(u.searchParams.has('token')&&u.searchParams.has('expires')));}catch{return false;}});if(temporary)emit('N49',name,col,[],'Lien temporaire probable ; ses paramètres ne sont pas affichés');
   if(type==='Attachments'){const many=rowids(name,i=>(listValue(vs[i])||[]).length>=20);if(many.length||vs.reduce((n,v)=>n+(listValue(v)||[]).length,0)>=1000)emit('N50',name,col,many);}
   if(type==='ChoiceList'&&Array.isArray(c.widgetOptions?.choices)&&c.widgetOptions.choices.length){const allowed=new Set(c.widgetOptions.choices);const bad=rowids(name,i=>(listValue(vs[i])||[]).some(x=>typeof x==='string'&&!allowed.has(x)));if(bad.length)emit('N64',name,col,bad,'Éléments absents des choix proposés');}
   // Formules : uniquement les formes simples reconnues, sans exécuter le code.
   if(raw.trim()){
    for(const lookup of simpleLookups(raw)){const target=sd[lookup.table];if(!target||lookup.terms.some(p=>!target[p.key]||p.local&&!sd[name]?.[p.local]))continue;const index=new Map();for(let j=0;j<target.id.length;j++){const key=serial(lookup.terms.map(p=>target[p.key][j]));index.set(key,(index.get(key)||0)+1);}const bad=rowids(name,i=>{const vals=lookup.terms.map(p=>p.local?values(name,p.local)[i]:p.value);return vals.every(usable)&&(index.get(serial(vals))||0)>1;});if(bad.length)emit('N31',name,col,bad,'Critères de recherche non uniques : '+lookup.terms.map(p=>p.key).join(' + '));}
    if(/\b\w+\.lookupOne\s*\(\s*id\s*=\s*\d+\s*\)/.test(mask))emit('N32',name,col);
    if(/\b(IFERROR|ISERROR)\s*\(|except\s*:?/.test(mask))emit('N33',name,col);
    if(!errs.length&&!/\b(if|IF|IFERROR)\b/.test(mask)){const den=[...mask.matchAll(/\/\s*\$([A-Za-z_]\w*)/g)].map(m=>m[1]);for(const d of den)if(values(name,d).some(v=>scalar(v)===0))emit('N34',name,col,[],'Diviseur nul dans une division simple sans garde reconnue');}
    const clock=/\b(NOW|TODAY)\s*\(/.test(mask),random=/\b(RAND|RANDBETWEEN|UUID)\s*\(/.test(mask),created=/^(cree_le|date_creation|created_at|numero|uuid)$/i.test(fold(col));
    if(c.isFormula&&clock&&created)emit('N35',name,col);
    if(!c.isFormula&&created&&(c.recalcWhen===2||c.recalcDeps?.length))emit('N36',name,col);
    if(!c.isFormula&&c.recalcWhen===0&&c.recalcDeps?.length&&refs.some(r=>!c.recalcDeps.includes(r)))emit('N37',name,col);
    if(c.isFormula&&(clock||random)&&!(clock&&created))emit('N39',name,col);
    for(const m of mask.matchAll(/\b([A-Za-z_]\w*)\.(?:all\b|lookupRecords\s*\(\s*\))/g))if((data[m[1]]?.id?.length||0)>5000&&(data[name]?.id?.length||0)>1000)emit('N38',name,col,[],'Parcours global répété ; durée réelle non mesurée');
    if(isSummary&&/\b(SUM|AVERAGE|MIN|MAX|len)\s*\(/.test(mask)&&!mask.includes('$group')&&/\b\w+\.(all|lookupRecords\s*\(\s*\))/.test(mask))emit('N45',name,col);
    for(const dep of refs)if(dep!=='id'&&!t.columns.has(dep))emit('N62',name,col,[],'Dépendance locale non retrouvée dans les métadonnées lisibles');
   }
  }
  for(const cfg of configured('totals',name)){const {total,quantity,price}=cfg;if(![total,quantity,price].every(c=>t.columns.has(c)&&sd[name]?.[c]))continue;const bad=rowids(name,i=>{const a=scalar(values(name,total)[i]),b=scalar(values(name,quantity)[i]),c=scalar(values(name,price)[i]);return [a,b,c].every(v=>typeof v==='number'&&Number.isFinite(v))&&Math.abs(a-b*c)>Math.max(.01,.001*Math.abs(b*c));});if(bad.length)emit('N27',name,total,bad,'Règle déclarée : quantité × prix ; tolérance max(0,01 ; 0,1 %)');}
  for(const cp of configured('copies',name)){const ref=t.columns.get(cp.reference);const target=ref?.type?.startsWith('Ref:')?ref.type.slice(4):null;if(!target||!sd[target]?.[cp.source]||!sd[name]?.[cp.column])continue;const map=new Map(values(target,'id').map((id,i)=>[id,values(target,cp.source)[i]]));const bad=rowids(name,i=>{const r=scalar(values(name,cp.reference)[i]);return map.has(r)&&usable(map.get(r))&&usable(values(name,cp.column)[i])&&serial(map.get(r))!==serial(values(name,cp.column)[i]);});if(bad.length)emit('N65',name,cp.column,bad,'Copie courante déclarée, comparée à la fiche référencée');}
 }
 // Divergences de copies : uniquement sur clés déclarées et schémas candidats, jamais nom d'original présumé.
 let pairs=0;const tables=[...schema.values()].filter(t=>!t.summarySourceTable);for(let a=0;a<tables.length;a++)for(let b=a+1;b<tables.length;b++){if(pairs>=limits.pairs)break;const t=tables[a],u=tables[b],cs=allcols(t).filter(c=>!c.isFormula&&u.columns.has(c.colId)&&!u.columns.get(c.colId).isFormula);if(cs.length<3||cs.length/Math.min(allcols(t).length,allcols(u).length)<.8)continue;pairs++;const key=configured('keys',t.tableId).find(k=>k.columns?.length&&k.columns.every(c=>u.columns.has(c)));if(!key||!sd[t.tableId]||!sd[u.tableId])continue;const lookup=new Map();values(t.tableId,'id').forEach((_,i)=>{const k=key.columns.map(c=>values(t.tableId,c)[i]);if(k.every(usable)){const s=serial(k);lookup.set(s,lookup.has(s)?null:i);}});let common=0,bad=[];values(u.tableId,'id').forEach((id,j)=>{const k=key.columns.map(c=>values(u.tableId,c)[j]);if(!k.every(usable))return;const i=lookup.get(serial(k));if(i===undefined||i===null)return;common++;if(cs.some(c=>usable(values(t.tableId,c.colId)[i])&&usable(values(u.tableId,c.colId)[j])&&serial(values(t.tableId,c.colId)[i])!==serial(values(u.tableId,c.colId)[j])))bad.push(id);});if(common>=3&&bad.length)emit('N66',u.tableId,null,bad,'Valeurs différentes de '+t.tableId+' sur une clé déclarée');}
 if(pages)for(const table of pages.tablesWithoutPage||[])emit('N47',table);
 if(meta.filters&&columnarToRows(meta.filters).some(f=>String(f.filter||'').trim()))emit('N69','Affichage des pages',null,[],'Un filtre de vue est présent ; ce n’est pas une restriction de lecture');
 emit('N59','Partage et paramètres des widgets');
 if(meta.attachments){const attachments=columnarToRows(meta.attachments),used=new Map();for(const t of schema.values())for(const c of allcols(t).filter(c=>c.type==='Attachments'))for(const v of values(t.tableId,c.colId))for(const id of listValue(v)||[])if(typeof id==='number')used.set(id,{table:t.tableId,column:c.colId});const names=new Map();for(const a of attachments){if(!used.has(a.id))continue;const k=String(a.fileName)+':'+a.fileSize;names.set(k,(names.get(k)||0)+1);}for(const a of attachments)if(used.has(a.id)&&(Number(a.fileSize)>20*1024*1024||(names.get(String(a.fileName)+':'+a.fileSize)||0)>=2)){const t=used.get(a.id);emit('N70',t.table,t.column,[],'Pièce volumineuse ou même nom et même taille ; contenu non comparé');}}
 // Contrôles d'accès : calcul symbolique conservateur pour trois rôles. Les formes inconnues ne deviennent pas des autorisations.
 if(access){const roles=['OWNER','EDITOR','VIEWER'];const groups=[{table:'Règles par défaut',rules:access.defaults},...(access.tables||[]).flatMap(t=>[{table:t.tableId,rules:t.rules},...t.columns.map(c=>({table:t.tableId,column:c.colIds.join(', '),rules:c.rules}))])];
  if(groups.some(g=>g.rules.some(r=>roles.some(role=>conditionForRole(r.formula,role)===null)))) for(const id of ['N51','N52','N53','N54','N63']) status.set(id,{id,state:'limited',reason:'Certaines conditions ne sont pas comprises par l’analyse symbolique ; aucune autorisation n’est déduite de ces conditions.'});
  for(const g of groups){for(let j=1;j<g.rules.length;j++){const r=g.rules[j];for(const bit of Object.keys(r.perms||{})){const rs=roles.filter(role=>conditionForRole(r.formula,role)===true);if(rs.length&&rs.every(role=>ruleDecision(g.rules.slice(0,j),role,bit)!=null))emit('N51',g.table,g.column,[],'Permission '+bit+' déjà décidée pour les rôles reconnus de la règle '+r.id);}}}
  for(const t of access.tables||[]){for(const g of t.columns)for(const col of g.colIds)for(const role of roles){for(const bit of ['R','U'])if(ruleDecision(g.rules,role,bit)==='allow'&&ruleDecision(t.rules,role,bit)==='deny')emit('N52',t.tableId,col,[],'Exception de colonne '+bit+' pour le rôle '+role);}
   for(const r of [...t.rules,...t.columns.flatMap(c=>c.rules)]){for(const c of refsIn(r.formula))if((r.perms.R||r.perms.U)&&schema.get(t.tableId)?.columns.get(c)&&!schema.get(t.tableId).columns.get(c).isFormula&&['EDITOR','VIEWER'].some(role=>effectivePermission(access,t.tableId,c,role,'U')==='allow'))emit('N53',t.tableId,c,[],'Champ de condition modifiable par un rôle non propriétaire');}
  }
  const allRules=[...(access.defaults||[]),...(access.tables||[]).flatMap(t=>[...t.rules,...t.columns.flatMap(c=>c.rules)])];
  for(const a of access.attributes||[]){const target=schema.get(a.tableId),key=a.lookupColId,uses=allRules.flatMap(r=>[...String(r.formula).matchAll(new RegExp('\\buser\\.'+a.name.replace(/[^A-Za-z0-9_]/g,'')+'\\.([A-Za-z_]\\w*)','g'))].map(m=>m[1]));if(target){for(const c of new Set([key,...uses]))if(target.columns.has(c)&&['EDITOR','VIEWER'].some(role=>effectivePermission(access,a.tableId,c,role,'U')==='allow'||effectivePermission(access,a.tableId,null,role,'C')==='allow'))emit('N54',a.tableId,c,[],'Champ d’habilitation accessible en écriture à un rôle non propriétaire');}
   const seen=new Map();values(a.tableId,key).forEach((v,i)=>{if(!usable(v))return;const k=serial(v);if(seen.has(k))emit('N55',a.tableId,key,[seen.get(k),values(a.tableId,'id')[i]],'Plusieurs lignes ont la même clé de recherche d’habilitation');else seen.set(k,values(a.tableId,'id')[i]);});
   for(const r of allRules){const f=String(r.formula||'');const re=new RegExp('\\buser\\.'+a.name.replace(/[^A-Za-z0-9_]/g,'')+'\\.([A-Za-z_]\\w*)\\s*==\\s*([\'"])([^\'"]+)\\2','g');for(const m of f.matchAll(re)){const vals=values(a.tableId,m[1]).filter(usable);if(vals.length>=5&&!vals.includes(m[3]))emit('N56',a.tableId,m[1],[],'Une valeur de condition est absente des lignes lisibles');}}
  }
  for(const r of allRules)if(/\buser\.Name\s*(?:==|!=|in)/.test(maskPython(r.formula||'')))emit('N57','Règles d’accès',null,[],'Condition utilisant le nom affiché');
  for(const t of schema.values())for(const c of allcols(t).filter(c=>c.isFormula)){const {raw,mask}=codeFor(t.tableId,c.colId);const deps=[];for(const m of mask.matchAll(/\$([A-Za-z_]\w*)\.([A-Za-z_]\w*)/g)){const ref=t.columns.get(m[1]);if(ref?.type.startsWith('Ref:'))deps.push({table:ref.type.slice(4),col:m[2]});}for(const l of simpleLookups(raw)){const m=/^\.([A-Za-z_]\w*)/.exec(l.after);if(m)deps.push({table:l.table,col:m[1]});}for(const d of deps)if(schema.get(d.table)?.columns.has(d.col)&&roles.some(role=>effectivePermission(access,d.table,d.col,role,'R')==='deny'&&effectivePermission(access,t.tableId,c.colId,role,'R')==='allow'))emit('N63',t.tableId,c.colId,[],'Reprise directe d’une colonne dont la lecture est restreinte pour un même rôle');}
 }
 if(!hasConfig(config,'keys'))status.set('N66',{id:'N66',state:'configuration',reason:'Une clé commune doit être déclarée pour comparer les copies.'});
 for(const [id,targets] of hits){const def=infoById.get(id);const affected=targets.map(t=>byCoverage.get(t.table)).filter(Boolean);const isSample=affected.some(c=>c.sampled);const seenRows=targets.flatMap(t=>t.note.match(/lignes ([\d, ]+)/)?.[1]?.split(',').map(s=>s.trim())||[]);const signature=hitSignatures.get(id);items.push({id,severity:def.severity,area:def.area,title:def.title,summary:def.summary,why:def.why,...(def.intended?{intended:def.intended}:{}),steps:def.steps,targets,method:def.detection,limitations:def.false_positives,evidence:{version:1,signature,coverage:isSample?'sample':'visible',targetCount:hitCounts.get(id),rowExamples:seenRows.slice(0,3)},calculation:'Comparaison limitée aux données lisibles. '+targets.map(t=>t.note).filter(Boolean).slice(0,3).join(' ; ')});status.set(id,{id,state:'detected',reason:isSample?'Signal observé sur un échantillon de lignes lisibles.':'Signal observé sur les éléments lisibles examinés.'});}
 const truncated=sampled.coverage.some(c=>c.sampled);if(formulaTruncated)for(const id of ['N31','N32','N33','N34','N35','N36','N37','N38','N39','N45','N62','N63'])if(status.get(id)?.state==='checked')status.set(id,{id,state:'limited',reason:'Budget de formules atteint ; contrôle incomplet.'});
 if(truncated||failedTables.length)for(const s of status.values())if(s.state==='checked')s.state='limited',s.reason='Vérification limitée à l’échantillon ou aux tables chargées.';
 return {items,checks:[...status.values()],coverage:sampled.coverage,failedTables,configurationError,cells:sampled.cells,formulaChars:chars,sampled:truncated,profilesData:sd};
}
