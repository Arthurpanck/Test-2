import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectVisibleFilters } from '../assets/filter-audit.js';
import { runAudit, AUDIT_LIMITS } from '../assets/audit-engine.js';
import { buildInsights, insightKey } from '../assets/insights.js';
import { buildReport, renderHtml, renderDocx, readTheme } from '../assets/report.js';
import { visibleFilterContext } from './fixtures/visible-filters.mjs';
import * as docx from 'docx';
import JSZip from 'jszip';

const finding = x => runAudit(x).items.find(i=>i.id==='X13');
const check = x => runAudit(x).checks.find(i=>i.id==='X13');

test('X13 : cinq champs déclenchent, quatre non ; six sont décrits sans inférer un usage',()=>{
  assert.equal(finding(visibleFilterContext(4)),undefined);
  assert.ok(finding(visibleFilterContext(5)));
  const item=finding(visibleFilterContext());
  assert.equal(item.severity,'choice'); assert.equal(item.area,'pages');
  assert.match(item.targets[0].note,/6 champs/); assert.match(item.targets[0].note,/Suivi des demandes/);
  assert.doesNotMatch(item.summary,/doivent refaire/);
});
test('X13 : désépingler deux filtres laisse leurs sélections et retire le constat',()=>{
  const x=visibleFilterContext();for(const f of x.meta.filters.slice(0,2))f.pinned=false;
  assert.equal(finding(x),undefined); assert.equal(x.meta.filters.length,6);
  assert.ok(x.meta.filters.every(f=>f.filter));
});
test('X13 : un champ reste un champ, même avec vingt valeurs ou une ligne dupliquée',()=>{
  const x=visibleFilterContext(4);x.meta.filters[0].filter=JSON.stringify({included:Array.from({length:20},(_,i)=>'v'+i)});
  x.meta.filters.push({...x.meta.filters[0],id:99});assert.equal(finding(x),undefined);
});
test('X13 : filtres comptés par vue, sans sommer toute une page',()=>{
  const x=visibleFilterContext();x.meta.sections.push({...x.meta.sections[0],id:11});
  for(const f of x.meta.filters.slice(3))f.viewSectionRef=11;
  assert.equal(finding(x),undefined);
});
test('X13 : les widgets non Tableau et les vues brutes ne sont pas concernés',()=>{
  for(const type of ['custom','chart','single','detail','form']) {const x=visibleFilterContext();x.meta.sections[0].parentKey=type;assert.equal(finding(x),undefined);}
  const x=visibleFilterContext();x.meta.sections[0].parentId=0;assert.equal(finding(x),undefined);
});
test('X13 : chaînes vides et ancien null Grist ne sont pas des filtres affichés',()=>{
  const x=visibleFilterContext();x.meta.filters[0].filter='';x.meta.filters[1].filter='null';assert.equal(finding(x),undefined);
});
test('X13 : métadonnées absentes non vérifiables, propriété inconnue non devinée',()=>{
  for(const key of ['filters','sections','tables','columns']){const x=visibleFilterContext();delete x.meta[key];assert.equal(check(x).state,'unavailable');assert.equal(finding(x),undefined);}
  const x=visibleFilterContext();for(const f of x.meta.filters)delete f.pinned;
  assert.equal(check(x).state,'limited');assert.equal(finding(x),undefined);
  const empty=visibleFilterContext();empty.meta.filters=[];assert.equal(check(empty).state,'checked');
});
test('X13 : colonnes censurées, mauvais parent et filtres censurés ne sont pas comptés',()=>{
  for(const transform of [x=>{x.meta.columns[0].colId='';x.meta.columns[1].colId=''},x=>{x.meta.columns[0].parentId=99;x.meta.columns[1].parentId=99},x=>{x.meta.filters[0].filter=['C'];x.meta.filters[1].pinned=['C']}]){
    const x=visibleFilterContext();transform(x);assert.equal(finding(x),undefined);assert.equal(check(x).state,'limited');
  }
  const x=visibleFilterContext();x.meta.tables[0].tableId='';assert.equal(finding(x),undefined);
});
test('X13 : accepte les métadonnées colonnaires et pinned numérique',()=>{
  const x=visibleFilterContext();x.meta.filters.forEach(f=>f.pinned=1);
  const rowResult=inspectVisibleFilters(x.schema,x.meta);
  for(const key of Object.keys(x.meta)){const rows=x.meta[key];x.meta[key]=Object.fromEntries(Object.keys(rows[0]).map(k=>[k,rows.map(r=>r[k])]));}
  assert.deepEqual(inspectVisibleFilters(x.schema,x.meta),rowResult);
});
test('X13 : contrôle indépendant du budget des lignes et validation modifiée si nombre change',()=>{
  const x=visibleFilterContext();x.data={Dossiers:{id:[1,2],Statut:['Ouvert','Ouvert']}};x.limits={...AUDIT_LIMITS,rows:0,cells:0};
  assert.ok(finding(x));assert.equal(finding(x).evidence.coverage,'visible');
  assert.notEqual(insightKey(finding(visibleFilterContext(5))),insightKey(finding(visibleFilterContext(6))));
  x.meta.filters=[];assert.equal(check(x).state,'checked');
});
test('X13 : contexte et explication transmis au rapport HTML et Word',async()=>{
  const x=visibleFilterContext(),insights=buildInsights([],null,{audit:x});
  assert.ok(insights.items.some(i=>i.id==='X13'));
  const report=buildReport({tables:[],stats:{tables:0,relations:0},insights,date:new Date('2026-10-27'),docName:'Essai filtres'},['analysis']);
  assert.match(renderHtml(report),/Une vue affiche beaucoup de filtres/);
  assert.match(renderHtml(report),/6 champs de filtre/);
  const buffer=await docx.Packer.toBuffer(renderDocx(report,readTheme(null),docx)),zip=await JSZip.loadAsync(buffer);
  const xml=await zip.file('word/document.xml').async('string');assert.match(xml,/Une vue affiche beaucoup de filtres/);assert.match(xml,/Si c.est voulu|Si c&#39;est voulu|Si c&apos;est voulu/);
});
