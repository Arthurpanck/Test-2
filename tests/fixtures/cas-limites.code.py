import grist
from functions import *       # global uppercase functions
import datetime, math, re     # modules commonly needed in formulas


@grist.UserTable
class Agents:
  Nom = grist.Text()
  Actif = grist.Bool()
  Arrivee = grist.DateTime('Europe/Paris')
  Service = grist.Reference('Services', reverse_of='Membres')
  Interventions_suivies = grist.ReferenceList('Interventions')
  Photo = grist.Attachments()
  Competences = grist.ChoiceList()
  Ordre = grist.PositionNumber()
  Brut = grist.Any()

  def _default_Nom(rec, table, value, user):
    return user.Name

  @grist.formulaType(grist.Int())
  def Nb_interventions(rec, table):
    def compter(liste):
      return len(liste)
    return compter(rec.Interventions_suivies)

  @grist.formulaType(grist.Text())
  def Fiche(rec, table):
    return """Fiche agent
class Brouillon:
  champ = grist.Text()
"""

  def gristHelper_Display(rec, table):
    return rec.Service.Nom

  def Sans_type(rec, table):
    return rec.Nom.upper()


@grist.UserTable
class Dates_cles:
  Libelle = grist.Text()
  Jour = grist.Date()


@grist.UserTable
class Interventions:
  Agent = grist.Reference('Agents')
  Echeance = grist.Reference('Dates_cles')
  Categorie = grist.Reference('Choix_categories')
  Modele = grist.Reference('Textes_modeles')
  Montant = grist.Numeric()

  class _Summary:

    @grist.formulaType(grist.ReferenceList('Interventions'))
    def group(rec, table):
      return table.getSummarySourceGroup(rec)

    @grist.formulaType(grist.Int())
    def count(rec, table):
      return len(rec.group)

    @grist.formulaType(grist.Numeric())
    def Montant(rec, table):
      return SUM(rec.group.Montant)


@grist.UserTable
class Services:
  Nom = grist.Text()
  Membres = grist.ReferenceList('Agents', reverse_of='Service')


@grist.UserTable
class Vide:
  pass
