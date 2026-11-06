import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {structureSmells,profileTables} from '../assets/datacheck.js';
import {buildInsights} from '../assets/insights.js';
import {buildAccess,accessInsights} from '../assets/access.js';
import {runAudit} from '../assets/audit-engine.js';
import {AUDIT_CATALOG,RETAINED_IDS} from '../assets/audit-catalog.js';
import {REMOVED_FINDING_IDS} from '../assets/audit-policy.js';
import {schemaFromMetadata} from '../assets/converter.js';
import {convertAll} from '../assets/converter-code.js';
import {definition,metadataFromDefinition} from './fixtures/mal-structure.mjs';
import {buildReport,renderHtml} from '../assets/report.js';

const table=n=>({name:'Donnees',kind:'table',columns:Array.from({length:n},(_,i)=>({name:'Champ_'+i,gristType:{name:'Text'},isFormula:false}))});
test('la largeur se déclenche strictement au-delà de 20 colonnes, sans données',()=>{
 assert.ok(!structureSmells([table(20)]).some(i=>i.id==='wide-table'));
 const wide=structureSmells([table(21)]).find(i=>i.id==='wide-table');assert.ok(wide);assert.equal(wide.title,'Table avec de nombreuses colonnes (plus de 20 colonnes)');assert.equal(wide.targets[0].note,'21 colonnes');assert.equal(wide.severity,'choice');
});
test('table sans référence : tables liées, informations rapportées et vues dynamiques',()=>{
 const ins=buildInsights([table(1),{...table(1),name:'Autre'}]);const i=ins.items.find(i=>i.id==='isolated');
 assert.match(i.why,/différentes tables/);assert.match(i.why,/informations de la table liée/);assert.match(i.why,/vues reliées dynamiquement/);assert.match(i.why,/Choix et Choix multiple/);assert.equal(i.intended,'Table de droit d’équipe : ne rien faire.');
});
test('les quatre retraits sont absents des constats, des confirmations et des validations positives',()=>{
 const m=metadataFromDefinition(definition),schema=schemaFromMetadata(m.tables,m.cols),tables=convertAll({schema}).corrected.tables,access=buildAccess({schema,resources:m.aclResources,rules:m.aclRules});
 const ins=buildInsights(tables,access,{profiles:profileTables(m.records),audit:{schema,data:m.records}});
 const removed=['N41','acl-attribute','acl-unknown-attribute','acl-attr-unused'];
 for(const id of removed){assert.ok(REMOVED_FINDING_IDS.has(id));assert.ok(![...ins.items,...ins.accepted,...ins.checks,...ins.audit.checks].some(i=>i.id===id),id);}
 const html=renderHtml(buildReport({tables,insights:ins,stats:{tables:tables.length,relations:0},docName:'Revue',date:new Date()},['analysis']));
 assert.doesNotMatch(html,/Des années sont réparties|Attribut utilisateur inexistant|Attribut utilisateur inutilisé|Condition de droit d’accès utilisant un attribut inconnu/);
 assert.ok(access.attributes.length>0,'les déclarations restent dans le modèle des droits pour la matrice');
});
test('les anciens calculs annuels et cartes d’attributs ne s’exécutent plus',()=>{
 const engine=readFileSync(new URL('../assets/audit-engine.js',import.meta.url),'utf8');assert.doesNotMatch(engine,/annualColumnFamilies|['"]N41['"]/);assert.ok(!RETAINED_IDS.includes('N41'));
 const access=readFileSync(new URL('../assets/access.js',import.meta.url),'utf8').split('export function accessInsights')[1];assert.doesNotMatch(access,/acl-attribute|acl-unknown-attribute|const brokenAttr|const unknown/);
 const data=readFileSync(new URL('../assets/datacheck.js',import.meta.url),'utf8');assert.doesNotMatch(data,/acl-attr-unused|unusedAttrs/);
});
test('la recommandation de filtres décrit les pages par usage et les liens entre vues de tables',()=>{
 const i=AUDIT_CATALOG.find(i=>i.id==='X13');assert.match(i.summary,/vue de table/);assert.doesNotMatch([i.summary,i.why,...i.steps].join(' '),/Tableau/);
 for(const text of ['RH','finances','managers','dynamiquement'])assert.ok(i.why.includes(text),text);
 assert.match(i.steps.join(' '),/sans copier les tables/);assert.match(i.steps.join(' '),/références/);
});
test('une table non concernée par des règles avancées reste une information',()=>{
 const a={hasRules:true,attributes:[],defaults:[],tables:[{tableId:'Une_table',columns:[],rules:[]}],special:[],restrictsRead:false,uncovered:['Autre_table']};
 const i=accessInsights(a).find(i=>i.id==='acl-uncovered');assert.equal(i.title,'Table non concernée par des règles avancées');assert.equal(i.severity,'info');
 assert.deepEqual(i.targets,[{table:'Autre_table'}]);
});
