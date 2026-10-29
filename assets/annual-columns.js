/** Repérage de colonnes annuelles à partir des métadonnées, sans lire les cellules. */
const fold=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const stem=s=>s.replace(/[\s_-]+/g,' ').trim();
export function annualColumnFamilies(columns){
 const families=new Map();
 for(const c of columns){
  if(c.isFormula||!c.colId||/^(id|manualSort|gristHelper_.*|#.*)$/.test(c.colId))continue;
  for(const name of new Set([fold(c.colId),fold(c.label)])){
   let match=/^(.*?)(19\d{2}|20\d{2})([^\d].*)?$/.exec(name),family,period;
   if(match){family='calendar:'+stem(match[1]+' '+(match[3]||''));period=Number(match[2]);}
   else {match=/^(.*?)(?:annee|year)[ _-]*(\d{1,2})([^\d].*)?$/.exec(name);if(!match)continue;family='relative:'+stem(match[1]+' annee '+(match[3]||''));period=Number(match[2]);if(period<1)continue;}
   if(!families.has(family))families.set(family,new Map());
   const group=families.get(family);if(!group.has(c.colId))group.set(c.colId,{column:c.colId,period});
  }
 }
 const seen=new Set();return [...families.entries()].filter(([,g])=>g.size>=3&&new Set([...g.values()].map(c=>c.period)).size>=3).map(([family,g])=>({family,columns:[...g.values()]})).filter(g=>{const key=g.columns.map(c=>c.column).sort().join('|');if(seen.has(key))return false;seen.add(key);return true;});
}
