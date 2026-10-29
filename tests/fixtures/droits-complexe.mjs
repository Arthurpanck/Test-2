// Règles d'accès du document de test « Test widget – document complexe » (oBhCRW6gqUFh),
// relevées le 29 octobre 2026, et ses tables dans l'ordre du document.
export const tables = ['Table1', 'Directions', 'Sites', 'Etiquettes', 'Fournisseurs', 'Parametres', 'Journal', 'Services', 'Habilitations',
  'Contacts', 'Agents', 'Projets', 'Taches', 'Depenses', 'Budgets', 'Conges', 'Formations', 'Reunions', 'Indicateurs',
  'Depenses_summary_Categorie_Projet', 'Agents_summary_Service', 'Taches_summary'];
export const resources = [
  { id: 1, tableId: '', colIds: '' }, { id: 2, tableId: '*', colIds: '*' }, { id: 3, tableId: '*SPECIAL', colIds: 'FullCopies' },
  { id: 4, tableId: 'Agents', colIds: '*' }, { id: 5, tableId: 'Agents', colIds: 'Quotite,Derniere_connexion' },
  { id: 6, tableId: 'Depenses', colIds: '*' }, { id: 7, tableId: 'Conges', colIds: '*' }, { id: 8, tableId: 'Journal', colIds: '*' },
  { id: 9, tableId: 'Parametres', colIds: '*' }, { id: 10, tableId: 'Formations', colIds: '*' }, { id: 11, tableId: 'Projets', colIds: 'Budget,Depense' },
  { id: 12, tableId: 'Reunions', colIds: '*' }, { id: 13, tableId: '*SPECIAL', colIds: 'AccessRules' },
];
export const rules = [
  { id: 1, resource: 1, aclFormula: '', permissionsText: '', rulePos: null, memo: '', userAttributes: '' },
  { id: 2, resource: 2, aclFormula: '', permissionsText: '', rulePos: 1, memo: '', userAttributes: '{"name":"Habilitation","tableId":"Habilitations","lookupColId":"Email","charId":"Email"}' },
  { id: 3, resource: 2, aclFormula: '', permissionsText: '', rulePos: 2, memo: '', userAttributes: '{"name":"Fiche","tableId":"Agents","lookupColId":"Email","charId":"Email"}' },
  { id: 4, resource: 4, aclFormula: 'user.Access in [OWNER]', permissionsText: 'all', rulePos: 4, memo: '', userAttributes: '' },
  { id: 5, resource: 4, aclFormula: "user.Habilitation.Role == 'RH'", permissionsText: '+CRUD', rulePos: 5, memo: '', userAttributes: '' },
  { id: 6, resource: 4, aclFormula: 'rec.Email == user.Email', permissionsText: '+R-CD', rulePos: 6, memo: 'Vous ne pouvez voir que votre propre fiche.', userAttributes: '' },
  { id: 7, resource: 4, aclFormula: '', permissionsText: '-CRUD', rulePos: 7, memo: 'Fiches réservées au service RH.', userAttributes: '' },
  { id: 8, resource: 5, aclFormula: "user.Habilitation.Role != 'RH'", permissionsText: '-R', rulePos: 3, memo: '', userAttributes: '' },
  { id: 9, resource: 6, aclFormula: "user.Habilitation.Role == 'Finances'", permissionsText: '+CRUD', rulePos: 8, memo: '', userAttributes: '' },
  { id: 10, resource: 6, aclFormula: 'rec.Projet.Service_pilote == user.Habilitation.Service', permissionsText: '+R', rulePos: 9, memo: '', userAttributes: '' },
  { id: 11, resource: 6, aclFormula: '', permissionsText: '-CRUD', rulePos: 10, memo: '', userAttributes: '' },
  { id: 12, resource: 7, aclFormula: "user.Email == 'directrice.rh@exemple.fr' or user.Email == 'adjoint.rh@exemple.fr'", permissionsText: '+CRUD', rulePos: 11, memo: '', userAttributes: '' },
  { id: 13, resource: 7, aclFormula: 'newRec.Agent.Email == user.Email', permissionsText: '+C', rulePos: 12, memo: '', userAttributes: '' },
  { id: 14, resource: 7, aclFormula: '', permissionsText: '-UD', rulePos: 13, memo: 'Seule la DRH valide les congés.', userAttributes: '' },
  { id: 15, resource: 8, aclFormula: '', permissionsText: '-CUD', rulePos: 14, memo: 'Le journal est en lecture seule.', userAttributes: '' },
  { id: 16, resource: 9, aclFormula: 'user.Access != OWNER', permissionsText: '-CRUD', rulePos: 15, memo: '', userAttributes: '' },
  { id: 17, resource: 10, aclFormula: 'user.Profil.Niveau > 2', permissionsText: '+U', rulePos: 16, memo: '', userAttributes: '' },
  { id: 18, resource: 11, aclFormula: 'user.Access == VIEWER', permissionsText: '-R', rulePos: 17, memo: '', userAttributes: '' },
  { id: 19, resource: 12, aclFormula: 'user.Access == EDITOR', permissionsText: '-D', rulePos: 18, memo: '', userAttributes: '' },
  { id: 20, resource: 12, aclFormula: '', permissionsText: '+R', rulePos: 19, memo: '', userAttributes: '' },
  { id: 21, resource: 3, aclFormula: '', permissionsText: '+R', rulePos: 20, memo: '', userAttributes: '' },
  { id: 22, resource: 2, aclFormula: 'user.Access == VIEWER', permissionsText: '-U', rulePos: 22, memo: '', userAttributes: '' },
  { id: 23, resource: 13, aclFormula: 'user.Access == EDITOR', permissionsText: '+R', rulePos: 21, memo: '', userAttributes: '' },
];
/** Table de l'attribut Habilitation (rôle et service), pour le compte « 7 services ». */
export const habilitations = {
  id: [1, 2, 3, 4, 5, 6, 7, 8, 9],
  Role: ['RH', 'RH', 'RH', 'RH', 'RH', 'RH', 'RH', 'Finances', 'Finances'],
  Service: [1, 2, 3, 4, 5, 6, 7, 8, 8],
};
