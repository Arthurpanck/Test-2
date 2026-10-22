// Exemple de « Vue du code » Grist, chargé par le bouton « Charger l'exemple ».
// Il illustre volontairement deux défauts de la formule d'origine : la table s'appelle
// « Interventions » (contient « Int ») et un booléen est présent.
export const EXAMPLE_CODE = `import grist
from functions import *       # global uppercase functions
import datetime, math, re     # modules commonly needed in formulas


@grist.UserTable
class Agents:
  Nom = grist.Text()
  Courriel = grist.Text()
  Service = grist.Reference('Services', reverse_of='Membres')
  En_poste = grist.Bool()
  Competences = grist.ChoiceList()

  @grist.formulaType(grist.Int())
  def Nb_interventions(rec, table):
    return len(Interventions.lookupRecords(Agent=rec.id))


@grist.UserTable
class Interventions:
  Objet = grist.Text()
  Agent = grist.Reference('Agents')
  Date_prevue = grist.Date()
  Statut = grist.Choice()
  Duree_h = grist.Numeric()
  Pieces_jointes = grist.Attachments()

  @grist.formulaType(grist.Text())
  def Service(rec, table):
    return rec.Agent.Service.Nom

  class _Summary:

    @grist.formulaType(grist.ReferenceList('Interventions'))
    def group(rec, table):
      return table.getSummarySourceGroup(rec)

    @grist.formulaType(grist.Int())
    def count(rec, table):
      return len(rec.group)

    @grist.formulaType(grist.Numeric())
    def Duree_h(rec, table):
      return SUM(rec.group.Duree_h)


@grist.UserTable
class Rapports:
  Titre = grist.Text()
  Interventions_couvertes = grist.ReferenceList('Interventions')
  Publie_le = grist.DateTime('Europe/Paris')


@grist.UserTable
class Services:
  Nom = grist.Text()
  Membres = grist.ReferenceList('Agents', reverse_of='Service')
`;
