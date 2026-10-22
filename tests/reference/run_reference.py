"""
Exécute la formule Python d'origine sur une liste d'entrées (JSON sur stdin)
et renvoie, pour chacune, le DBML produit ou l'erreur levée (JSON sur stdout).
Sert d'oracle aux tests différentiels du portage JavaScript.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from grist_dbml_reference import parse_grist_code  # noqa: E402

inputs = json.load(sys.stdin)
results = []
for text in inputs:
    try:
        results.append({"ok": True, "dbml": parse_grist_code(text)})
    except Exception as exc:  # la formule Grist afficherait une erreur dans la cellule
        results.append({"ok": False, "error": type(exc).__name__})
json.dump(results, sys.stdout)
