import grist
from functions import *       # global uppercase functions
import datetime, math, re     # modules commonly needed in formulas


@grist.UserTable
class Categories_outils:
  Nom = grist.Text()
  Detail = grist.Text()
  Niveau = grist.Text()


@grist.UserTable
class Detail_documents:
  ref_document = grist.Reference('Document_a_etudier_espace_metier')
  Date = grist.Date()
  Espace = grist.Choice()
  Note = grist.Text()
  Nom_espace_metier = grist.Text()


@grist.UserTable
class Document_a_etudier_espace_metier:
  id2 = grist.Text()
  nom = grist.Text()
  owner = grist.Text()
  Reunion_ajout = grist.Reference('Reunion')

  def Suivi_document_Espace(rec, table):
    return Detail_documents.lookupOne(ref_document=rec.id, order_by="-Date").Espace


@grist.UserTable
class Documentation_technique_espace_metier:
  Document_lie = grist.Reference('Document_a_etudier_espace_metier')

  def _default_Creation(rec, table, value, user):
    return 'Qui a créé ce document ? Dans quel contexte ? Vérification réalisées ?'
  Creation = grist.Text()
  RGPD_ = grist.Bool()
  Description_solution_ = grist.Text()
  Nombre_d_utilisateurs = grist.Int()
  Droits_utilisateurs_dans_le_document_ = grist.Bool()
  Nombre_de_tables = grist.Int()
  Durabilite_visee = grist.Choice()
  Detail_RGPD_sante = grist.Text()
  Formules_dans_le_document_ = grist.Bool()
  Code_python_dans_le_document_ = grist.Bool()
  Detail_code_python = grist.Text()
  Detail_formules = grist.Text()
  Widgets_utilises_ = grist.Bool()
  Liste_widgets_utilises = grist.ChoiceList()
  Widgets_personnalises_ = grist.Bool()
  Tables_liees_ = grist.Bool()
  Date_de_la_demande = grist.Date()
  Statut_de_la_doc_technique = grist.Choice()

  @grist.formulaType(grist.Reference('Suivi_projets'))
  def Projet_lie(rec, table):
    return 0

  @grist.formulaType(grist.Text())
  def id_document(rec, table):
    return rec.Document_lie.id2

  @grist.formulaType(grist.Text())
  def Proprietaire_du_document(rec, table):
    return rec.Document_lie.owner

  @grist.formulaType(grist.Attachments())
  def Documents_associes(rec, table):
    return None

  @grist.formulaType(grist.Text())
  def Detail_widgets_personnalises(rec, table):
    return ''

  @grist.formulaType(grist.Reference('Categories_outils'))
  def Niveau_outil(rec, table):
    return 0

  @grist.formulaType(grist.Attachments())
  def Schema_table(rec, table):
    return None

  @grist.formulaType(grist.Date())
  def Date_de_passage_en_certifie(rec, table):
    return None

  @grist.formulaType(grist.Bool())
  def Sauvegarde_a_vide(rec, table):
    return False

  @grist.formulaType(grist.Bool())
  def SANTE_(rec, table):
    return False

  @grist.formulaType(grist.Text())
  def Projet_lie_Direction(rec, table):
    return rec.Projet_lie.Direction

  @grist.formulaType(grist.Text())
  def Projet_lie_Delegation(rec, table):
    return rec.Projet_lie.Delegation


@grist.UserTable
class Reunion:
  Date = grist.Date()

  def _default_Note_reunion(rec, table, value, user):
    # Suivi de document :
    # 
    # 
    # Note
    # 
    # 
    # Vie de l'application
    # 
    # 
    # A faire
    raise SyntaxError('unterminated string literal (detected at line 7)\n\nA `SyntaxError` occurs when Python cannot understand your code.\n\nYou started writing a string with a single or double quote\nbut never ended the string with another quote on that line.\n\n', ('usercode', 7, 9, "Vie de l'application"))
  Note_reunion = grist.Text()
  a_eu_lieu = grist.Bool()

  def Nbr_Document_ajoute(rec, table):
    return len(Document_a_etudier_espace_metier.lookupRecords(Reunion_ajout=rec.id).id2)


@grist.UserTable
class Suivi_projets:
  Nom_du_projet = grist.Text()
  Origine = grist.Choice()
  Porteurs = grist.ChoiceList()
  Statut = grist.Choice()
  Date_de_debut = grist.DateTime('Europe/Paris')
  Date_de_fin = grist.DateTime('Europe/Paris')
  Document_lie = grist.Reference('Document_a_etudier_espace_metier')
  Type_accompagnement = grist.ChoiceList()
  Commentaires_de_suivi = grist.Text()
  Direction = grist.Choice()
  Delegation = grist.Choice()

  @grist.formulaType(grist.Attachments())
  def Documents_supplementaires(rec, table):
    return None

  @grist.formulaType(grist.Numeric())
  def Duree_projet(rec, table):
    if rec.Date_de_fin is None:
        return 0.0
    delta = rec.Date_de_fin - rec.Date_de_debut
    return delta.total_seconds() / 3600