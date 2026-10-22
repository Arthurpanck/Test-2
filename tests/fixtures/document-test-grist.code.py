import grist
from functions import *       # global uppercase functions
import datetime, math, re     # modules commonly needed in formulas


@grist.UserTable
class Agents:
  Nom = grist.Text()
  Service = grist.Reference('Services')
  En_poste = grist.Bool()
  Arrivee = grist.DateTime('Europe/Paris')
  Competences = grist.ChoiceList()

  def _default_Cree_par(rec, table, value, user):
    return user.Name
  Cree_par = grist.Text()

  @grist.formulaType(grist.Int())
  def Nb_interventions(rec, table):
    return len(Interventions.lookupRecords(Agent=rec.id))


@grist.UserTable
class Conversion:
  Code_Grist = grist.Text()
  DBML = grist.Text()


@grist.UserTable
class Dates_cles:
  Libelle = grist.Text()
  Jour = grist.Date()


@grist.UserTable
class Interventions:
  Objet = grist.Text()
  Agent = grist.Reference('Agents')
  Echeance = grist.Reference('Dates_cles')
  Statut = grist.Choice()
  Duree_h = grist.Numeric()
  Pieces = grist.Attachments()

  @grist.formulaType(grist.Text())
  def Service(rec, table):
    return rec.Agent.Service.Nom

  @grist.formulaType(grist.Text())
  def Resume(rec, table):
    def court(t):
      return t[:20]
    return court(rec.Objet or '')

  def Sans_type(rec, table):
    return rec.Duree_h * 2

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


@grist.UserTable
class Table1:

  def A(rec, table):
    return None

  def B(rec, table):
    return None

  def C(rec, table):
    return None
