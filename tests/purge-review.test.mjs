import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runAudit} from '../assets/audit-engine.js';
import {AUDIT_CATALOG,RETAINED_IDS} from '../assets/audit-catalog.js';
import {REMOVED_FINDING_IDS} from '../assets/audit-policy.js';
import {buildInsights} from '../assets/insights.js';
import {schemaFromMetadata,convertAll} from '../assets/converter.js';
import {buildAccess,accessInsights} from '../assets/access.js';
import {profileTables} from '../assets/datacheck.js';
import {buildPages,pageInsights} from '../assets/pages.js';
import {buildReport,renderHtml} from '../assets/report.js';
import {detailLines,columnTypeLabel} from '../assets/types.js';
import vm from 'node:vm';
import {definition,metadataFromDefinition} from './fixtures/mal-structure.mjs';

function one(col,type,values,extra={}){return {schema:new Map([['T',{tableId:'T',columns:new Map([[col,{colId:col,label:col,type,isFormula:false,...extra}]])}]]),data:{T:{id:values.map((_,i)=>i+1),[col]:values}}};}
const has=(x,id)=>runAudit(x).items.find(i=>i.id===id);

test('purge intégrée : aucun identifiant retiré ni dans les constats, ni les choix confirmés, ni le Word',()=>{
 const m=metadataFromDefinition(definition),schema=schemaFromMetadata(m.tables,m.cols),out=convertAll({schema}).corrected,access=buildAccess({resources:m.aclResources,rules:m.aclRules,schema});
 const ins=buildInsights(out.tables,access,{profiles:profileTables(m.records),audit:{schema,data:m.records}});
 for(const item of [...ins.items,...ins.accepted])assert.ok(!REMOVED_FINDING_IDS.has(item.id),item.id);
 for(const check of ins.audit.checks)assert.ok(RETAINED_IDS.includes(check.id));
 const html=renderHtml(buildReport({tables:out.tables,insights:ins,stats:{tables:out.tables.length,relations:0},date:new Date(),docName:'Revue'},['analysis']));
 for(const id of ['N03','N04','N05','N54','N67','N70'])assert.ok(!ins.items.some(i=>i.id===id));
 assert.doesNotMatch(html,/Copie possible dont les accès|Recherche d’habilitation dans une colonne sans|Des lignes répètent les mêmes informations/);
});
test('les calculs retirés sont absents du moteur, pas seulement cachés après calcul',()=>{
 const source=readFileSync(new URL('../assets/audit-engine.js',import.meta.url),'utf8');
 for(const id of REMOVED_FINDING_IDS)if(/^N\d/.test(id))assert.ok(!new RegExp("['\"]"+id+"['\"]").test(source),id);
 assert.doesNotMatch(source,/interquart|lookupColId.*seen|const edges=|const radicals=|const normalized=/);
});
test('N06 : deux cents cellules courtes au maximum, zéro et textes longs exclus',()=>{
 const x=one('Code','Text',Array.from({length:201},(_,i)=>i===200?' A':'A'));assert.equal(has(x,'N06'),undefined);
 const y=one('Code','Text',[' A','B\u200b']);assert.ok(has(y,'N06'));
 assert.equal(has(one('Code','Text',[' '+ 'a'.repeat(150)]),'N06'),undefined);
 assert.equal(has(one('Notes','Text',[' A',' B']),'N06'),undefined);
});
test('N09 : uniquement colonnes Texte, jamais une vraie liste Choix multiple',()=>{
 assert.ok(has(one('Participants','Text',Array(5).fill('Alice;Bob')),'N09'));
 assert.equal(has(one('Participants','ChoiceList',Array(5).fill(['L','Alice','Bob'])),'N09'),undefined);
 assert.equal(has(one('Participants','RefList:T',Array(5).fill(['L',1,2])),'N09'),undefined);
});
test('N10 retiré : aucun mélange de valeurs ne réactive ce contrôle',()=>{
 assert.equal(has(one('Valeur','Any',[1,2,3,4,5,'a','b','c','d','e']),'N10'),undefined);
 assert.equal(has(one('Valeur','Any',['1','2','3','4','5','a','b','c','d','e']),'N10'),undefined);
 assert.equal(has(one('Valeur','Any',[1,2,3,4,5,...Array(5).fill(['C'])]),'N10'),undefined);
});
test('N13 et N14 retirés : noms, types et formats ne réactivent pas ces contrôles',()=>{
 assert.equal(has(one('Code_postal','Numeric',[]),'N13'),undefined);
 assert.equal(has(one('Code_postal','Text',[]),'N13'),undefined);
 assert.equal(has(one('Montant','Numeric',[]),'N13'),undefined);
 assert.equal(has(one('Montant','Text',['1,234','2,345','3,456','4,567','5,678']),'N14'),undefined);
 assert.equal(has(one('Montant','Text',['1,234.56','2,345.67','1.234,56','2.345,67','100']),'N14'),undefined);
});
test('N36 retiré : aucun des trois réglages de Grist ne réactive le contrôle',()=>{
 for(const [recalcWhen,recalcDeps,expected]of [[0,[],false],[0,['Autre'],true],[1,['Autre'],false],[2,[],true]]){
  const result=has(one('UUID','Text',[],{formula:'UUID()',recalcWhen,recalcDeps}),'N36');assert.equal(Boolean(result),false);
 }
});
test('N53 et N54 fusionnés : une seule carte, cibles de condition et d’habilitation',()=>{
 const schema=new Map([['T',{tableId:'T',columns:new Map(['Responsable','Email','Role'].map(colId=>[colId,{colId,type:'Text',isFormula:false}]))}]]);
 const access={defaults:[],special:[],tables:[{tableId:'T',columns:[],rules:[{id:1,formula:'rec.Responsable == user.Email',perms:{R:'allow'}},{id:2,formula:"user.Habilitation.Role == 'RH'",perms:{R:'allow'}}]}],attributes:[{name:'Habilitation',tableId:'T',lookupColId:'Email',charId:'Email'}]};
 const out=runAudit({schema,access});assert.equal(out.items.filter(i=>i.id==='N53').length,1);assert.equal(out.items.some(i=>i.id==='N54'),false);
 for(const col of ['Responsable','Email','Role'])assert.ok(out.items.find(i=>i.id==='N53').targets.some(t=>t.column===col),col);
});
test('les formulations et solutions arbitrées restent présentes dans le catalogue',()=>{
 const by=id=>AUDIT_CATALOG.find(x=>x.id===id);assert.match(by('N34').steps.join(' '),/if \$Quantite != 0:[\s\S]*else:[\s\S]*return 0/);
 assert.match(by('N50').steps.join(' '),/solution de partage/);assert.match(by('N31').title,/lookup.*première valeur/);
 assert.equal(by('N67').status,'information');assert.equal(RETAINED_IDS.length,16);
});

test('les informations de colonne restent disponibles sans description et échappent les textes',()=>{
 const app=readFileSync(new URL('../assets/app.js',import.meta.url),'utf8');
 const source=app.slice(app.indexOf('function columnDetailsHtml('),app.indexOf('const SEVERITY_ICON'));
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const context={esc,detailLines,columnTypeLabel};vm.createContext(context);vm.runInContext(source,context);
 const column={name:'Code',base:'varchar',isFormula:false,gristType:{name:'Text'},details:{description:'<script>indésirable</script>',choices:[]}};
 const html=context.columnDetailsHtml(column);assert.match(html,/<summary>Informations<\/summary>/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);
 assert.match(context.columnDetailsHtml({...column,details:{choices:[]}}),/Aucune description renseignée/);
 assert.doesNotMatch(app,/audit-key-add|audit-config-save|fetchTable\('_grist_Attachments'\)/);
});
