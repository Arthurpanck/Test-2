import test from 'node:test';
import assert from 'node:assert/strict';
import { schemaFromMetadata, computeStats } from '../assets/converter.js';
import { convertAll } from '../assets/converter-code.js';
import { runAudit, AUDIT_LIMITS } from '../assets/audit-engine.js';
import { parseUsageLookup, usageContract, inspectUsage, USAGE_LIMITS } from '../assets/usage-audit.js';
import { buildInsights } from '../assets/insights.js';
import { buildReport, renderHtml } from '../assets/report.js';
import { AUDIT_CATALOG } from '../assets/audit-catalog.js';

const col=(colId,type='Text',formula='',extra={})=>({colId,type,formula,isFormula:!!formula,...extra});
function model(tables) {
  const mt=tables.map((t,i)=>({id:i+1,tableId:t.name,summarySourceTable:0})),mc=[],ref=new Map();let next=1;
  for(const t of tables)for(const c of t.columns)ref.set(t.name+'.'+c.colId,next++);
  for(let i=0;i<tables.length;i++){
    const t=tables[i];if(t.source)mt[i].summarySourceTable=mt.find(m=>m.tableId===t.source).id;
    for(const c of t.columns)mc.push({id:ref.get(t.name+'.'+c.colId),parentId:i+1,label:c.colId,summarySourceCol:c.sourceCol?ref.get(t.source+'.'+c.sourceCol):0,...c});
  }
  const data={};for(const t of tables){data[t.name]={id:t.rows.map((r,i)=>r.id||i+1)};for(const c of t.columns)data[t.name][c.colId]=t.rows.map(r=>r[c.colId]??null);}
  const meta={tables:mt,columns:mc,sections:[],filters:[]};return {schema:schemaFromMetadata(mt,mc),data,meta};
}
const hit=(m,id)=>runAudit(m).items.find(x=>x.id===id);
function summary(formula='SUM(Source.lookupRecords(Annee=$Annee, Zone=$Zone).Montant)'){
 return model([{name:'Source',columns:[col('Annee','Int'),col('Zone'),col('Montant','Numeric')],rows:[{Annee:2026,Zone:'Nord',Montant:10},{Annee:2026,Zone:'Nord',Montant:20},{Annee:2027,Zone:'Nord',Montant:30}]},{name:'Recap',source:'Source',columns:[col('Annee','Int','',{sourceCol:'Annee'}),col('Zone','Text','',{sourceCol:'Zone'}),col('group','RefList:Source','table.getSummarySourceGroup(rec)'),col('Total','Numeric',formula)],rows:[{Annee:2026,Zone:'Nord',Total:30}]}]);
}
function reference(formula='Cible.lookupOne(id=$Lien.id).Valeur'){
 return model([{name:'Cible',columns:[col('Nom'),col('Valeur')],rows:[{Nom:'A',Valeur:'Premier'},{Nom:'B',Valeur:'Second'}]},{name:'Depart',columns:[col('Lien','Ref:Cible'),col('Resultat','Text',formula)],rows:[{Lien:2,Resultat:'Second'}]}]);
}
function manual(extra=[]) {
 return model([{name:'Source',columns:[col('Annee','Int'),col('Montant','Numeric')],rows:[{Annee:2026,Montant:10},{Annee:2027,Montant:20}]},{name:'Bilan',columns:[col('Annee','Int'),col('Total','Numeric','SUM(Source.lookupRecords(Annee=$Annee).Montant)'),...extra],rows:[{Annee:2026,Total:10},{Annee:2027,Total:20}]}]);
}
function choices() {
 return model([{name:'Modalites',columns:[col('Intitule')],rows:[{Intitule:'A'},{Intitule:'B'}]},{name:'Saisie',columns:[col('Nom'),col('Selection','RefList:Modalites')],rows:[{Nom:'Ligne',Selection:['L',1,2]}]}]);
}
const declaration='@audit-lookup '+JSON.stringify({table:'Source',selection:'Selection',criteria:{Annee:'Annee',Zone:'Zone'},aggregate:'SUM',field:'Montant'});
function criteria({declared=true,formula='SUM($Selection.Montant)',computedSelection=false}={}) {
 return model([{name:'Source',columns:[col('Annee','Int'),col('Zone'),col('Montant','Numeric')],rows:[{Annee:2026,Zone:'Nord',Montant:10},{Annee:2026,Zone:'Nord',Montant:20},{Annee:2027,Zone:'Nord',Montant:30}]},{name:'Suivi',columns:[col('Objet'),col('Annee','Int'),col('Zone'),col('Selection','RefList:Source',computedSelection?'Source.lookupRecords(Annee=$Annee, Zone=$Zone)':''),col('Total','Numeric',formula,{description:declared?declaration:''})],rows:[{Objet:'Suivi indépendant',Annee:2026,Zone:'Nord',Selection:['L',1],Total:10}]}]);
}

test('métadonnées : noms de la table source et des colonnes regroupées conservés',()=>{const s=summary().schema.get('Recap');assert.equal(s.summarySourceTableId,'Source');assert.equal(s.columns.get('Annee').summarySourceColId,'Annee');});
test('U01 : agrégation reproduisant exactement le groupe',()=>{assert.ok(hit(summary(),'U01'));});
test('U01 : somme des fiches sans champ identifiée',()=>{assert.ok(hit(summary('SUM(Source.lookupRecords(Annee=$Annee, Zone=$Zone))'),'U01'));assert.ok(hit(summary('SUM($group)'),'U01'));});
test('U01 : $group et sous-ensemble volontaire ne sont pas signalés',()=>{assert.equal(hit(summary('SUM($group.Montant)'),'U01'),undefined);assert.equal(hit(summary('SUM(r.Montant for r in $group if r.Montant > 0)'),'U01'),undefined);});
test('U01 : autre périmètre ou autre table conservés',()=>{assert.equal(hit(summary('SUM(Source.lookupRecords(Annee=$Annee).Montant)'),'U01'),undefined);assert.equal(hit(summary('SUM(Autre.lookupRecords(Annee=$Annee, Zone=$Zone).Montant)'),'U01'),undefined);});
test('U01 : lookupOne de sélection et recherche ordonnée non réécrits aveuglément',()=>{assert.equal(hit(summary('Source.lookupOne(Annee=$Annee, Zone=$Zone).Montant'),'U01'),undefined);assert.equal(hit(summary('SUM(Source.lookupRecords(Annee=$Annee, Zone=$Zone, order_by="-id").Montant)'),'U01'),undefined);});
test('U01 : une table ordinaire n’a pas de groupe de synthèse',()=>{const m=summary();m.schema.get('Recap').summarySourceTable=0;assert.equal(hit(m,'U01'),undefined);});
test('U02 : recherche par identifiant redondante, correction par champ rapporté',()=>{assert.ok(hit(reference(),'U02'));assert.equal(hit(reference('$Lien.Valeur'),'U02'),undefined);});
test('U02 : homonymes et divergence démontrée, sans doublon N31',()=>{const m=reference('Cible.lookupOne(Nom=$Lien.Nom).Valeur');m.data.Cible.Nom=['A','A'];m.data.Depart.Resultat=['Premier'];const r=runAudit(m);assert.ok(r.items.some(x=>x.id==='U02'));assert.ok(!r.items.some(x=>x.id==='N31'));});
test('U02 : libellé unique compatible avec la référence',()=>{assert.ok(hit(reference('Cible.lookupOne(Nom=$Lien.Nom).Valeur'),'U02'));});
test('U02 : autre relation, condition supplémentaire et ordre exclus',()=>{assert.equal(hit(reference('Cible.lookupOne(Nom=$Texte).Valeur'),'U02'),undefined);assert.equal(hit(reference('Cible.lookupOne(id=$Lien.id, Actif=True).Valeur'),'U02'),undefined);assert.equal(hit(reference('Cible.lookupOne(Nom=$Lien.Nom, order_by="id").Valeur'),'U02'),undefined);});
test('U02 : données cibles absentes, censurées ou échantillonnées',()=>{const m=reference('Cible.lookupOne(Nom=$Lien.Nom).Valeur');m.data.Cible.Nom=[['C'],['C']];assert.equal(hit(m,'U02'),undefined);delete m.data.Cible;assert.equal(hit(m,'U02'),undefined);});
test('U03 : bilan réduit aux clés manuelles et agrégations',()=>{assert.ok(hit(manual(),'U03'));});
test('U03 : informations propres, objectifs et commentaires conservés',()=>{assert.equal(hit(manual([col('Commentaire')]),'U03'),undefined);assert.equal(hit(manual([col('Budget','Numeric')]),'U03'),undefined);});
test('U03 : table de fiches utilisant son id, autre formule ou groupe unique exclus',()=>{const m=manual();m.schema.get('Bilan').columns.get('Total').formula='SUM(Source.lookupRecords(Annee=$id).Montant)';assert.equal(hit(m,'U03'),undefined);const n=manual();n.data.Bilan.id=[1];assert.equal(hit(n,'U03'),undefined);});
test('U03 : une vraie récapitulation ne déclenche pas',()=>{assert.equal(hit(summary(),'U03'),undefined);});
test('U06 : table d’intitulés et sélection manuelle simple',()=>{assert.ok(hit(choices(),'U06'));});
test('U06 : une information propre empêche la recommandation',()=>{const m=choices();m.schema.get('Modalites').columns.set('Responsable',col('Responsable'));assert.equal(hit(m,'U06'),undefined);m.schema.get('Modalites').columns.delete('Responsable');m.schema.get('Modalites').columns.set('count',col('count','Numeric'));assert.equal(hit(m,'U06'),undefined);});
test('U06 : référentiel partagé, droits et vues reliées exclus',()=>{const m=choices();m.schema.get('Saisie').columns.set('Autre',col('Autre','Ref:Modalites'));assert.equal(hit(m,'U06'),undefined);const n=choices();n.access={tables:[{tableId:'Modalites',rules:[],columns:[]}],attributes:[]};assert.equal(hit(n,'U06'),undefined);const p=choices();p.meta.sections=[{id:1,tableRef:1,linkSrcSectionRef:8}];assert.equal(hit(p,'U06'),undefined);});
test('U06 : colonne cachée et lecture partielle ne deviennent pas un simple vocabulaire',()=>{const m=choices();m.meta.columns.push({id:999,parentId:1,colId:''});assert.equal(hit(m,'U06'),undefined);const n=choices();const r=inspectUsage({...n,coverage:[{table:'Modalites',sampled:true}]});assert.ok(!r.signals.some(x=>x.id==='U06'));});
test('U06 : après conversion en Choix multiple, le constat disparaît',()=>{const m=choices();m.schema.get('Saisie').columns.get('Selection').type='ChoiceList';assert.equal(hit(m,'U06'),undefined);});
test('U07 : critères déclarés, sélection incomplète et information scalaire',()=>{const f=hit(criteria(),'U07');assert.ok(f);assert.match(f.targets[0].note,/absentes/);});
test('U07 : intention inconnue, aucune erreur déduite d’une sélection',()=>{const r=runAudit(criteria({declared:false}));assert.ok(!r.items.some(x=>x.id==='U07'));assert.equal(r.checks.find(x=>x.id==='U07').state,'unavailable');});
test('U07 : correction par recherche directe et référence calculée légitime',()=>{assert.equal(hit(criteria({formula:'SUM(Source.lookupRecords(Annee=$Annee, Zone=$Zone).Montant)'}),'U07'),undefined);assert.equal(hit(criteria({computedSelection:true}),'U07'),undefined);});
test('U07 : résultat sans correspondance géré et mauvaises déclarations limitées',()=>{const m=criteria();m.data.Suivi.Annee=[2028];assert.ok(hit(m,'U07'));const n=criteria();n.schema.get('Suivi').columns.get('Total').description=declaration.replace('Source','Absente');const r=runAudit(n);assert.ok(!r.items.some(x=>x.id==='U07'));assert.equal(r.checks.find(x=>x.id==='U07').state,'limited');});
test('U07 : les censures et listes invalides ne sont pas interprétées comme des choix vides',()=>{const m=criteria();m.data.Suivi.Selection=[['C']];assert.equal(hit(m,'U07'),undefined);});
test('parseur : chaînes, commentaires et code arbitraire jamais exécutés',()=>{for(const code of ['"Source.lookupOne(id=$Lien.id).Valeur"','# Source.lookupOne(id=$Lien.id).Valeur','Source.lookupRecords(Annee=__import__("os"))','f"Source.lookupOne(id=$Lien.id).Valeur"','Source.lookupRecords(Annee=$Annee)[0].Montant'])assert.equal(parseUsageLookup(code),null);assert.ok(parseUsageLookup('SUM(Source.lookupRecords(Annee=$Annee).Montant) # note'));});
test('parseur : littéraux bornés, arguments dupliqués, noms et déclarations validés',()=>{assert.ok(parseUsageLookup('len(Source.lookupRecords(Zone="Nord, Est", Actif=True))'));assert.equal(parseUsageLookup('Source.lookupOne(id=$A,id=$B)'),null);assert.equal(usageContract('@audit-lookup {"table":"x);evil()"}'),null);assert.equal(usageContract('@audit-lookup {bad}'),null);assert.ok(usageContract(declaration));});
test('budgets : aucun scan illimité, les index identiques sont réutilisés',()=>{const m=reference('Cible.lookupOne(Nom=$Lien.Nom).Valeur');m.schema.get('Depart').columns.set('Autre',col('Autre','Text','Cible.lookupOne(Nom=$Lien.Nom).Valeur'));m.data.Depart.Autre=['Second'];const r=inspectUsage(m);assert.equal(r.counters.calls,1);assert.ok(r.counters.cells<=USAGE_LIMITS.indexCells);const limited=inspectUsage({...m,limits:{calls:0}});assert.equal(limited.signals.length,0);assert.ok(limited.checks.some(c=>c.state==='limited'));});
test('budget nul de formules : pas de résultat sur une formule non analysée',()=>{assert.equal(hit({...criteria(),limits:{...AUDIT_LIMITS,formulaChars:0}},'U07'),undefined);});
test('les cinq définitions sont À corriger, sans exemples et U04 reste absent',()=>{for(const id of ['U01','U02','U03','U06','U07']){const d=AUDIT_CATALOG.find(x=>x.id===id);assert.equal(d.severity,'blocking');assert.ok(!d.example&&!d.exampleDetail);assert.ok(d.summary&&d.why&&d.steps.length);}assert.ok(!AUDIT_CATALOG.some(x=>x.id==='U04'));});
test('intégration : titres, verdict et rapport reprennent le nouveau constat',()=>{const m=reference(),out=convertAll({schema:m.schema}).corrected;const insights=buildInsights(out.tables,null,{audit:m});assert.ok(insights.items.some(x=>x.id==='U02'));assert.ok(insights.counts.blocking>0);const html=renderHtml(buildReport({date:new Date(),docName:'Test',tables:out.tables,stats:computeStats(out.tables),insights},['analysis']));assert.match(html,/Une formule lookup redouble un lien de référence/);});
