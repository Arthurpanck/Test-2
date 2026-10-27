/** Six champs enregistrés et épinglés sur la même vue, sans recopier de données métier. */
export function visibleFilterContext(count = 6) {
  const names = ['Statut','Service','Responsable','Annee','Priorite','Commune'];
  const columns = names.map((colId,i) => ({id:101+i,parentId:1,colId,label:colId,type:'Text',isFormula:false}));
  return {
    schema: new Map([['Dossiers',{tableId:'Dossiers',columns:new Map(columns.map(c=>[c.colId,c]))}]]),
    meta: {
      tables:[{id:1,tableId:'Dossiers'}], columns,
      sections:[{id:10,parentId:1,parentKey:'record',tableRef:1,title:'Dossiers à explorer'}],
      views:[{id:1,name:'Suivi des demandes'}],
      filters:columns.slice(0,count).map((c,i)=>({id:i+1,viewSectionRef:10,colRef:c.id,pinned:true,filter:'{"excluded":[]}'})),
    },
  };
}
