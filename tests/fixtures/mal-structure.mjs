// Document « mal structuré » : une association qui a grandi sans plan.
// Sert à la fois de fixture de test (metadataFromDefinition) et de modèle pour créer
// le document réel dans Grist (« Test widget – document mal structuré »).
//
// Défauts volontaires : noms par défaut, références écrites en texte (Client, Produit,
// Commercial…), nombres, dates et oui/non en texte, valeurs répétées sans liste de choix,
// valeurs hors liste, tables en double (dont une copie non protégée d'une table protégée),
// tables vides, colonnes jamais remplies, table très large, formules non typées,
// règles d'accès avec e-mails en dur, attribut inexistant, refus sans message…

const clients = [
  ['Dupont', 'Marie', 'marie.dupont@mail.fr', 'Lyon', 'Martin', '12/01/2023', 'oui', 'Particulier'],
  ['Durand', 'Paul', 'paul.durand@mail.fr', 'Villeurbanne', 'Martin', '03/02/2023', 'oui', 'Particulier'],
  ['Atelier Bois', '', 'contact@atelierbois.fr', 'Lyon', 'Bernard', '17/02/2023', 'oui', 'Entreprise'],
  ['Leroy', 'Sophie', 'sophie.leroy@mail.fr', 'Bron', 'Martin', '02/03/2023', 'non', 'Particulier'],
  ['Les Amis du Parc', '', 'amis.parc@asso.fr', 'Lyon', 'Bernard', '21/03/2023', 'oui', 'Association'],
  ['Moreau', 'Luc', 'luc.moreau@mail.fr', 'Caluire', 'Petit', '05/04/2023', 'oui', 'Particulier'],
  ['Garage Central', '', 'garage.central@pro.fr', 'Vénissieux', 'Petit', '18/04/2023', 'non', 'Entreprise'],
  ['Fournier', 'Julie', 'julie.fournier@mail.fr', 'Lyon', 'Martin', '09/05/2023', 'oui', 'Particulier'],
  ['Girard', 'Hugo', 'hugo.girard@mail.fr', 'Villeurbanne', 'Bernard', '30/05/2023', 'oui', 'Particulier'],
  ['Club Rando', '', 'club.rando@asso.fr', 'Oullins', 'Petit', '14/06/2023', 'oui', 'Association'],
  ['Lambert', 'Emma', 'emma.lambert@mail.fr', 'Lyon', 'Martin', '01/07/2023', 'non', 'Particulier'],
  ['Bonnet', 'Louis', 'louis.bonnet@mail.fr', 'Bron', 'Bernard', '22/08/2023', 'oui', 'particulier'],
];
const produits = [
  ['Nichoir', 'P-001', 'Bois', 25, 12, 'Scierie du Rhône', true],
  ['Mangeoire', 'P-002', 'Bois', 18, 30, 'Scierie du Rhône', true],
  ['Sac en toile', 'P-003', 'Textile', 9.5, 120, 'Tissages Lyonnais', true],
  ['Carnet', 'P-004', 'Papeterie', 6, 80, 'Papeterie Martin', true],
  ['Affiche', 'P-005', 'Papeterie', 4, 200, 'Papeterie Martin', true],
  ['Tasse', 'P-006', 'Céramique', 12, 45, 'Atelier Terre', true],
  ['Kit graines', 'P-007', 'Jardin', 7.5, 60, 'Graines & Co', false],
  ['Hôtel à insectes', 'P-008', 'Bois', 32, 8, 'Scierie du Rhône', true],
];
const statuts = ['Livrée', 'En cours', 'Livrée', 'Annulée', 'Livrée', 'En attente', 'Livrée', 'en cours'];
const commandes = [];
for (let i = 0; i < 24; i++) {
  const c = clients[(i * 5) % clients.length];
  const p = produits[(i * 3) % produits.length];
  commandes.push({
    Numero: `CMD-${String(101 + i)}`,
    Client: c[0],
    Produit: p[0],
    Quantite: i === 7 ? 'deux' : String(1 + (i % 4)),
    Prix_unitaire: String(p[3]).replace('.', ','),
    Date_commande: `${String(1 + (i % 27)).padStart(2, '0')}/${String(1 + (i % 12)).padStart(2, '0')}/2024`,
    Statut: statuts[i % statuts.length],
  });
}
const personnel = [
  ['Martin', 'Claire', 'claire.martin@asso.fr', 'Ventes', 'Commerciale', 2450, '2019-03-01', ''],
  ['Bernard', 'Thomas', 'thomas.bernard@asso.fr', 'Ventes', 'Commercial', 2380, '2020-09-15', 'Martin'],
  ['Petit', 'Nadia', 'nadia.petit@asso.fr', 'Ventes', 'Commerciale', 2300, '2021-01-04', 'Martin'],
  ['Robert', 'Alain', 'direction@asso.fr', 'Direction', 'Directeur', 3900, '2015-06-01', ''],
  ['Richard', 'Inès', 'rh@asso.fr', 'RH', 'Responsable RH', 3100, '2018-11-19', 'Robert'],
  ['Simon', 'Yann', 'compta@asso.fr', 'Comptabilité', 'Comptable', 2700, '2017-02-13', 'Robert'],
  ['Laurent', 'Chloé', 'chloe.laurent@asso.fr', 'Animation', 'Animatrice', 2100, '2022-05-02', 'Robert'],
  ['Michel', 'Bastien', 'stagiaire@asso.fr', 'Animation', 'Stagiaire', 650, '2024-02-05', 'Laurent'],
];

const txt = (id, extra = {}) => ({ id, type: 'Text', ...extra });
const any = (id, extra = {}) => ({ id, type: 'Any', ...extra });

export const definition = {
  name: 'Test widget – document mal structuré',
  tables: [
    { id: 'Table1', columns: [{ id: 'A', type: 'Any', isFormula: true }, { id: 'B', type: 'Any', isFormula: true }, { id: 'C', type: 'Any', isFormula: true }], records: [] },
    { id: 'Table2', columns: [txt('A'), { id: 'B', type: 'Numeric' }, any('C')], records: [{ A: 'RH', B: 1 }, { A: 'Ventes', B: 2 }, { A: 'Compta', B: 3 }] },
    { id: 'Feuille1', columns: [txt('Colonne1'), txt('Colonne2')], records: [{ Colonne1: 'à trier', Colonne2: 'voir avec Claire' }] },
    {
      id: 'Clients',
      columns: [txt('Nom'), txt('Prenom', { label: 'Prénom' }), txt('Email'), txt('Telephone', { label: 'Téléphone' }), txt('Ville'),
        txt('Commercial'), txt('Date_inscription', { label: 'Date inscription' }), txt('Actif'), txt('Categorie', { label: 'Catégorie' }), txt('Notes')],
      records: clients.map(([Nom, Prenom, Email, Ville, Commercial, Date_inscription, Actif, Categorie], i) => ({
        Nom, Prenom, Email, Telephone: `04 78 ${String(10 + i)} ${String(20 + i)} ${String(30 + i)}`, Ville, Commercial, Date_inscription, Actif, Categorie, Notes: i % 4 ? '' : 'rappeler',
      })),
    },
    {
      id: 'Commandes',
      columns: [txt('Numero', { label: 'Numéro' }), txt('Client'), txt('Produit'), txt('Quantite', { label: 'Quantité' }), txt('Prix_unitaire', { label: 'Prix unitaire' }),
        txt('Date_commande', { label: 'Date commande' }), txt('Statut'), { id: 'Remise', type: 'Numeric' },
        any('Total', { isFormula: true, formula: "float($Quantite or 0) * float(str($Prix_unitaire).replace(',', '.') or 0)" }),
        any('Ville_client', { isFormula: true, label: 'Ville client', formula: 'Clients.lookupOne(Nom=$Client).Ville' })],
      records: commandes,
    },
    {
      id: 'Commandes_copie',
      columns: [txt('Numero', { label: 'Numéro' }), txt('Client'), txt('Produit'), txt('Quantite', { label: 'Quantité' }), txt('Prix_unitaire', { label: 'Prix unitaire' }),
        txt('Date_commande', { label: 'Date commande' }), txt('Statut')],
      records: commandes.slice(0, 10),
    },
    {
      id: 'Produits',
      columns: [txt('Nom'), txt('Reference', { label: 'Référence' }), txt('Categorie', { label: 'Catégorie' }), { id: 'Prix', type: 'Numeric' }, any('Stock'), txt('Fournisseur'), { id: 'Actif', type: 'Bool' }],
      records: produits.map(([Nom, Reference, Categorie, Prix, Stock, Fournisseur, Actif]) => ({ Nom, Reference, Categorie, Prix, Stock, Fournisseur, Actif })),
    },
    { id: 'Produits_old', columns: [txt('Nom'), txt('Prix')], records: [{ Nom: 'Nichoir (ancien)', Prix: '22' }, { Nom: 'Calendrier 2022', Prix: '8' }] },
    {
      id: 'Fournisseurs',
      columns: [txt('Nom'), txt('Pays'), txt('Contact')],
      records: [['Scierie du Rhône', 'France', 'M. Roux'], ['Tissages Lyonnais', 'France', 'Mme Faure'], ['Papeterie Martin', 'France', ''], ['Atelier Terre', 'France', 'Mme Blanc'], ['Graines & Co', 'Belgique', '']]
        .map(([Nom, Pays, Contact]) => ({ Nom, Pays, Contact })),
    },
    {
      id: 'Factures',
      columns: [{ id: 'Numero', type: 'Int', label: 'Numéro' }, { id: 'Commande', type: 'Int' }, { id: 'Montant', type: 'Numeric' }, txt('Payee', { label: 'Payée' }),
        { id: 'Date_paiement', type: 'Date', label: 'Date paiement' }, { id: 'Mode_paiement', type: 'Choice', label: 'Mode de paiement', choices: ['CB', 'Chèque', 'Virement'] }],
      records: Array.from({ length: 12 }, (_, i) => ({
        Numero: 2024001 + i, Commande: 1 + i * 2, Montant: 20 + i * 7.5, Payee: i % 3 ? 'oui' : 'non', Date_paiement: i % 3 ? `2024-${String(1 + i).padStart(2, '0')}-15` : null,
        Mode_paiement: ['CB', 'Chèque', 'Virement', 'Espèces'][i % 4],
      })),
    },
    {
      id: 'Personnel',
      columns: [txt('Nom'), txt('Prenom', { label: 'Prénom' }), txt('Email'), txt('Service'), txt('Poste'), { id: 'Salaire', type: 'Numeric' },
        { id: 'Date_embauche', type: 'Date', label: 'Date embauche' }, txt('Manager'),
        ...Array.from({ length: 26 }, (_, i) => txt(`Champ_${i + 1}`))],
      records: personnel.map(([Nom, Prenom, Email, Service, Poste, Salaire, Date_embauche, Manager]) => ({ Nom, Prenom, Email, Service, Poste, Salaire, Date_embauche, Manager })),
    },
    {
      id: 'Personnel_2024',
      columns: [txt('Nom'), txt('Prenom', { label: 'Prénom' }), txt('Email'), txt('Service'), { id: 'Salaire', type: 'Numeric' }],
      records: personnel.slice(0, 6).map(([Nom, Prenom, Email, Service, , Salaire]) => ({ Nom, Prenom, Email, Service, Salaire })),
    },
    {
      id: 'Services',
      columns: [txt('Nom'), txt('Responsable')],
      records: [['Ventes', 'Martin'], ['Direction', 'Robert'], ['RH', 'Richard'], ['Comptabilité', 'Simon'], ['Animation', 'Laurent']].map(([Nom, Responsable]) => ({ Nom, Responsable })),
    },
    {
      id: 'Evenements',
      columns: [txt('Titre'), txt('Date'), txt('Lieu'), txt('Participants'), txt('Budget')],
      records: [
        { Titre: 'Fête du parc', Date: '15/06/2024', Lieu: 'Parc de la Tête d\'Or', Participants: 'Martin, Laurent, Michel', Budget: '1200' },
        { Titre: 'Atelier nichoirs', Date: '02/03/2024', Lieu: 'Local', Participants: 'Laurent, Michel', Budget: '150' },
        { Titre: 'Assemblée générale', Date: '20/01/2024', Lieu: 'Mairie', Participants: 'Robert, Richard, Simon, Martin', Budget: '300' },
        { Titre: 'Marché de Noël', Date: '14/12/2024', Lieu: 'Place Bellecour', Participants: 'Martin, Bernard, Petit', Budget: '800' },
      ],
    },
    {
      id: 'Inscriptions',
      columns: [{ id: 'Evenement', type: 'Ref:Evenements', label: 'Événement' }, { id: 'Client', type: 'Ref:Clients' }, { id: 'Date', type: 'Date' }, { id: 'Present', type: 'Bool', label: 'Présent' }],
      records: Array.from({ length: 10 }, (_, i) => ({ Evenement: 1 + (i % 4), Client: 1 + (i % 12), Date: `2024-0${1 + (i % 9)}-10`, Present: i % 3 !== 0 })),
    },
    {
      id: 'Stats',
      columns: [any('Nb_clients', { isFormula: true, label: 'Nb clients', formula: 'len(Clients.lookupRecords())' }),
        any('CA', { isFormula: true, formula: 'SUM(float(c.Total or 0) for c in Commandes.lookupRecords())' }),
        any('Taux_paiement', { isFormula: true, label: 'Taux paiement', formula: "len(Factures.lookupRecords(Payee='oui')) / len(Factures.lookupRecords()) if len(Factures.lookupRecords()) else 0" })],
      records: [{}],
    },
    { id: 'Export_2023', columns: [txt('Col_A'), txt('Col_B'), txt('Col_C')], records: [] },
    { id: 'Test', columns: [txt('Champ')], records: [] },
    { id: 'Brouillon', columns: [txt('Texte')], records: [{ Texte: 'idées pour 2025' }] },
    { id: 'Parametres', columns: [txt('Cle', { label: 'Clé' }), txt('Valeur')], records: [{ Cle: 'TVA', Valeur: '20' }, { Cle: 'Annee', Valeur: '2024' }] },
    {
      id: 'Taches',
      columns: [txt('Titre'), txt('Assigne', { label: 'Assigné' }), txt('Echeance', { label: 'Échéance' }), txt('Fait')],
      records: [
        { Titre: 'Relancer factures', Assigne: 'Simon', Echeance: '30/11/2024', Fait: 'non' },
        { Titre: 'Préparer AG', Assigne: 'Robert', Echeance: '10/01/2025', Fait: 'non' },
        { Titre: 'Commander bois', Assigne: 'Martin', Echeance: '05/10/2024', Fait: 'oui' },
        { Titre: 'Mettre à jour le site', Assigne: 'Laurent', Echeance: '', Fait: 'non' },
        { Titre: 'Inventaire', Assigne: 'Petit', Echeance: '20/12/2024', Fait: 'non' },
        { Titre: 'Planning stagiaire', Assigne: 'Richard', Echeance: '01/09/2024', Fait: 'oui' },
      ],
    },
    {
      id: 'Historique',
      columns: [txt('Date'), txt('Action'), txt('Utilisateur')],
      records: Array.from({ length: 9 }, (_, i) => ({ Date: `${String(1 + i).padStart(2, '0')}/10/2024`, Action: ['Ajout', 'Modification', 'Suppression'][i % 3], Utilisateur: personnel[i % 6][2] })),
    },
    {
      id: 'Contacts_import',
      columns: [txt('Nom_complet', { label: 'Nom complet' }), txt('Societe', { label: 'Société' }), txt('Tel'), txt('Mail'), txt('Adresse'), txt('Ville'), txt('CP'), txt('Pays')],
      records: [
        { Nom_complet: 'Marc Roux', Societe: 'Scierie du Rhône', Tel: '0478000001', Mail: 'm.roux@scierie.fr', Ville: 'Givors', CP: '69700', Pays: 'France' },
        { Nom_complet: 'Anne Faure', Societe: 'Tissages Lyonnais', Tel: '0478000002', Mail: 'a.faure@tissages.fr', Ville: 'Lyon', CP: '69003', Pays: 'France' },
        { Nom_complet: 'Lise Blanc', Societe: 'Atelier Terre', Tel: '', Mail: 'lise@atelierterre.fr', Ville: 'Lyon', CP: '69007', Pays: 'France' },
      ],
    },
    {
      id: 'Adherents',
      columns: [txt('Nom'), txt('Email'), txt('Cotisation_payee', { label: 'Cotisation payée' }), txt('Montant_cotisation', { label: 'Montant cotisation' }), txt('Annee', { label: 'Année' })],
      records: clients.slice(0, 9).map(([Nom, , Email], i) => ({ Nom, Email, Cotisation_payee: i % 4 ? 'oui' : 'non', Montant_cotisation: i % 2 ? '20' : '35', Annee: '2024' })),
    },
    {
      id: 'Cotisations',
      columns: [txt('Adherent', { label: 'Adhérent' }), { id: 'Annee', type: 'Int', label: 'Année' }, { id: 'Montant', type: 'Numeric' }],
      records: clients.slice(0, 7).map(([Nom], i) => ({ Adherent: Nom, Annee: 2024, Montant: i % 2 ? 20 : 35 })),
    },
  ],
  summaries: [
    { source: 'Commandes', groupBy: ['Statut'] },
  ],
  // Règles d'accès (acceptées par Grist).
  acl: {
    resources: [
      { id: 1, tableId: '', colIds: '' },
      { id: 2, tableId: '*', colIds: '*' },
      { id: 3, tableId: '*SPECIAL', colIds: 'FullCopies' },
      { id: 4, tableId: 'Personnel', colIds: '*' },
      { id: 5, tableId: 'Personnel', colIds: 'Salaire' },
      { id: 6, tableId: 'Commandes', colIds: '*' },
      { id: 7, tableId: 'Clients', colIds: '*' },
      { id: 8, tableId: 'Factures', colIds: '*' },
      { id: 9, tableId: 'Adherents', colIds: '*' },
      { id: 10, tableId: 'Historique', colIds: '*' },
      { id: 11, tableId: '*SPECIAL', colIds: 'AccessRules' },
      { id: 12, tableId: 'Parametres', colIds: '*' },
    ],
    rules: [
      { id: 1, resource: 1, aclFormula: '', permissionsText: '', rulePos: null, memo: '', userAttributes: '' },
      { id: 2, resource: 2, rulePos: 1, aclFormula: '', permissionsText: '', memo: '', userAttributes: '{"name":"Profil","tableId":"Personnel","lookupColId":"Email","charId":"Email"}' },
      { id: 3, resource: 2, rulePos: 2, aclFormula: '', permissionsText: '', memo: '', userAttributes: '{"name":"Role","tableId":"Table2","lookupColId":"A","charId":"Email"}' },
      { id: 4, resource: 4, rulePos: 3, aclFormula: "user.Email in ['direction@asso.fr', 'rh@asso.fr']", permissionsText: '+CRUD', memo: '', userAttributes: '' },
      { id: 5, resource: 4, rulePos: 4, aclFormula: 'rec.Email == user.Email', permissionsText: '+R', memo: '', userAttributes: '' },
      { id: 6, resource: 4, rulePos: 5, aclFormula: '', permissionsText: '-CRUD', memo: '', userAttributes: '' },
      { id: 7, resource: 5, rulePos: 6, aclFormula: "user.Email != 'rh@asso.fr'", permissionsText: '-R', memo: 'Salaires réservés aux RH.', userAttributes: '' },
      { id: 8, resource: 6, rulePos: 7, aclFormula: "user.Profil.Poste == 'Commercial' or user.Profil.Poste == 'Commerciale'", permissionsText: '+CRUD', memo: '', userAttributes: '' },
      { id: 9, resource: 6, rulePos: 8, aclFormula: 'user.Access == EDITOR', permissionsText: '-D', memo: '', userAttributes: '' },
      { id: 10, resource: 6, rulePos: 9, aclFormula: '', permissionsText: '+R-CUD', memo: '', userAttributes: '' },
      { id: 11, resource: 7, rulePos: 10, aclFormula: "user.Equipe.Nom == 'Ventes'", permissionsText: '+U', memo: '', userAttributes: '' },
      { id: 12, resource: 7, rulePos: 11, aclFormula: "user.Email == 'compta@asso.fr'", permissionsText: '-U', memo: '', userAttributes: '' },
      { id: 13, resource: 8, rulePos: 12, aclFormula: "user.Email == 'compta@asso.fr' or user.Email == 'direction@asso.fr'", permissionsText: '+CRUD', memo: '', userAttributes: '' },
      { id: 14, resource: 8, rulePos: 13, aclFormula: '', permissionsText: '-CRUD', memo: 'Réservé à la comptabilité.', userAttributes: '' },
      { id: 15, resource: 9, rulePos: 14, aclFormula: 'user.Access in [OWNER, EDITOR]', permissionsText: 'all', memo: '', userAttributes: '' },
      { id: 16, resource: 9, rulePos: 15, aclFormula: 'rec.Email == user.Email', permissionsText: '+RU', memo: '', userAttributes: '' },
      { id: 17, resource: 9, rulePos: 16, aclFormula: '', permissionsText: '-CRUD', memo: '', userAttributes: '' },
      { id: 18, resource: 10, rulePos: 17, aclFormula: '', permissionsText: '-UD', memo: 'Historique en lecture seule.', userAttributes: '' },
      { id: 19, resource: 3, rulePos: 18, aclFormula: '', permissionsText: '+R', memo: '', userAttributes: '' },
      { id: 20, resource: 11, rulePos: 19, aclFormula: '', permissionsText: '+R', memo: '', userAttributes: '' },
      { id: 21, resource: 2, rulePos: 20, aclFormula: "user.Email == 'stagiaire@asso.fr'", permissionsText: '-CUD', memo: '', userAttributes: '' },
      { id: 22, resource: 12, rulePos: 21, aclFormula: "user.Email != 'direction@asso.fr'", permissionsText: '-CUD', memo: '', userAttributes: '' },
    ],
  },
};

/** Métadonnées (format docApi.fetchTable) et données d'une définition. */
export function metadataFromDefinition(def) {
  const tables = [];
  const cols = [];
  const records = {};
  let colRef = 0;
  const tableRef = new Map();
  def.tables.forEach((t, i) => {
    const id = i + 1;
    tableRef.set(t.id, id);
    tables.push({ id, tableId: t.id, summarySourceTable: 0, rawViewSectionRef: 0 });
    colRef++;
    cols.push({ id: colRef, parentId: id, parentPos: colRef, colId: 'manualSort', type: 'ManualSortPos', isFormula: false, formula: '', reverseCol: 0, label: 'manualSort', description: '', widgetOptions: '', recalcWhen: 0, recalcDeps: null });
    for (const c of t.columns) {
      colRef++;
      cols.push({
        id: colRef, parentId: id, parentPos: colRef, colId: c.id, type: c.type, isFormula: Boolean(c.isFormula), formula: c.formula || '', reverseCol: 0,
        label: c.label || c.id, description: c.description || '', widgetOptions: c.choices ? JSON.stringify({ choices: c.choices }) : '', recalcWhen: 0, recalcDeps: null,
      });
    }
    const data = { id: t.records.map((_, k) => k + 1) };
    for (const c of t.columns) data[c.id] = t.records.map((r) => (c.id in r ? r[c.id] : null));
    records[t.id] = data;
  });
  for (const s of def.summaries || []) {
    const id = tables.length + 1;
    tables.push({ id, tableId: `${s.source}_summary_${s.groupBy.join('_')}`, summarySourceTable: tableRef.get(s.source), rawViewSectionRef: 0 });
    const src = def.tables.find((t) => t.id === s.source);
    for (const g of s.groupBy) {
      colRef++;
      const sc = src.columns.find((c) => c.id === g);
      cols.push({ id: colRef, parentId: id, parentPos: colRef, colId: g, type: sc.type, isFormula: false, formula: '', reverseCol: 0, label: g, description: '', widgetOptions: '', recalcWhen: 0, recalcDeps: null });
    }
    colRef++;
    cols.push({ id: colRef, parentId: id, parentPos: colRef, colId: 'group', type: `RefList:${s.source}`, isFormula: true, formula: 'table.getSummarySourceGroup(rec)', reverseCol: 0, label: 'group', description: '', widgetOptions: '', recalcWhen: 0, recalcDeps: null });
    colRef++;
    cols.push({ id: colRef, parentId: id, parentPos: colRef, colId: 'count', type: 'Int', isFormula: true, formula: 'len($group)', reverseCol: 0, label: 'count', description: '', widgetOptions: '', recalcWhen: 0, recalcDeps: null });
  }
  return { tables, cols, sections: [], aclResources: def.acl.resources, aclRules: def.acl.rules, records };
}
