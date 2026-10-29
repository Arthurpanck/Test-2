import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {annualColumnFamilies} from '../assets/annual-columns.js';
import {runAudit} from '../assets/audit-engine.js';
import {AUDIT_CATALOG,RETAINED_IDS} from '../assets/audit-catalog.js';
import {REMOVED_FINDING_IDS} from '../assets/audit-policy.js';
import {buildAccess,accessInsights} from '../assets/access.js';
import {buildInsights} from '../assets/insights.js';
import {schemaFromMetadata,convertAll} from '../assets/converter.js';
import {profileTables} from '../assets/datacheck.js';
import {definition,metadataFromDefinition} from './fixtures/mal-structure.mjs';

const cols=names=>names.map(colId=>({colId,label:colId,type:'Numeric',isFormula:false}));
const context=columns=>({schema:new Map([['T',{tableId:'T',columns:new Map(columns.map(c=>[c.colId,c]))}]]),data:{}});

test('N41 est rétabli et repère Année 1, Année 2, Année 3 sans aucune cellule',()=>{
 const c=cols(['Cotisation_Annee_1','Cotisation_Annee_2','Cotisation_Annee_3']);
 assert.equal(annualColumnFamilies(c).length,1);assert.ok(runAudit(context(c)).items.some(i=>i.id==='N41'));
 assert.ok(RETAINED_IDS.includes('N41'));assert.ok(!REMOVED_FINDING_IDS.has('N41'));
});
test('N41 : années calendaires et libellés accentués sont reconnus, sans doublonner les noms',()=>{
 const calendar=cols(['Budget_2024','Budget_2025','Budget_2026']);assert.equal(annualColumnFamilies(calendar).length,1);
 const labels=cols(['A','B','C']).map((c,i)=>({...c,label:'Année '+(i+1)}));assert.equal(annualColumnFamilies(labels).length,1);
 const duplicateNames=calendar.map(c=>({...c,label:c.colId.replace('_',' ')}));assert.equal(annualColumnFamilies(duplicateNames).length,1);
});
test('N41 : pas de faux rapprochement de sujets différents ni de simples numéros',()=>{
 for(const names of [['Creation_2024','Validation_2025','Budget_2026'],['Telephone_1','Telephone_2','Telephone_3'],['Budget_2024','Budget_2025'],['Annee_0','Annee_1','Annee_2']])assert.equal(annualColumnFamilies(cols(names)).length,0,names.join(','));
 assert.equal(annualColumnFamilies(cols(['Budget_2024','Budget_2025','Budget_2026']).map(c=>({...c,isFormula:true}))).length,0);
});
test('deuxième revue : niveaux des contrôles enrichis et absence des calculs supprimés',()=>{
 for(const id of ['N06','N09','N31','N50','N53','N57'])assert.equal(AUDIT_CATALOG.find(x=>x.id===id).severity,'blocking',id);
 assert.equal(AUDIT_CATALOG.find(x=>x.id==='N34').severity,'improve');
 const engine=readFileSync(new URL('../assets/audit-engine.js',import.meta.url),'utf8');
 for(const id of ['N07','N10','N13','N14','N36','N38']){assert.ok(!RETAINED_IDS.includes(id));assert.ok(!engine.includes("'"+id+"'"));}
 assert.equal(RETAINED_IDS.length,16);
});
test('deuxième revue : attribut inutilisé, table vide et colonne vide sont À corriger ; courriels retirés',()=>{
 const m=metadataFromDefinition(definition),schema=schemaFromMetadata(m.tables,m.cols),access=buildAccess({resources:m.aclResources,rules:m.aclRules,schema});
 const ins=buildInsights(convertAll({schema}).corrected.tables,access,{profiles:profileTables(m.records)});
 for(const id of ['acl-attr-unused','empty-table','never-filled'])assert.equal(ins.items.find(x=>x.id===id).severity,'blocking',id);
 assert.ok(!ins.items.some(x=>x.id==='acl-emails'));assert.ok(!accessInsights(access).some(x=>x.id==='acl-emails'));
 assert.equal(ins.items.find(x=>x.id==='acl-no-memo').severity,'improve');
 assert.equal(ins.items.find(x=>x.id==='acl-bypass').title,'Accès des éditeurs aux données malgré les droits d’accès');
});
test('attribut déclaré à source absente : À corriger, avec la limite de lecture explicitée',()=>{
 const a={hasRules:true,attributes:[{name:'Habilitation',tableId:'Invisible',lookupColId:'Email',problems:['source absente de la lecture']}],defaults:[],tables:[],special:[],uncovered:[]};
 const item=accessInsights(a).find(x=>x.id==='acl-attribute');assert.equal(item.severity,'blocking');assert.match(item.summary,/masquée/);assert.match(item.summary,/ne peut pas distinguer/);
});
test('acl-none et acl-uncovered diffèrent par leur périmètre ; acl-hidden est conservé',()=>{
 const empty=buildAccess({resources:[],rules:[],schema:new Map()});assert.deepEqual(accessInsights(empty).map(x=>x.id),['acl-none']);
 const a={hasRules:true,attributes:[],defaults:[],special:[],uncovered:['Autre'],restrictsRead:false,tables:[{tableId:'Invisible',missing:true,rules:[],columns:[]}]};
 const items=accessInsights(a);assert.ok(items.some(x=>x.id==='acl-uncovered'));assert.ok(!items.some(x=>x.id==='acl-none'));assert.ok(items.some(x=>x.id==='acl-hidden'));assert.ok(!REMOVED_FINDING_IDS.has('acl-hidden'));
});
