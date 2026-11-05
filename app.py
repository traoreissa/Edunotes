import os
from flask import Flask, render_template, request, jsonify

app = Flask(__name__)

def mention(m):
    if m >= 16: return "Très bien"
    if m >= 14: return "Bien"
    if m >= 12: return "Assez bien"
    if m >= 10: return "Passable"
    return "Insuffisant"

@app.get("/")
def accueil():
    return render_template("index.html")

@app.post("/api/moyenne")
def moyenne():
    data = request.get_json(silent=True)
    notes = data.get("notes", []) if isinstance(data, dict) else []
    if not isinstance(notes, list):
        return jsonify(erreur="Le champ notes doit être une liste"), 400
    for n in notes:
        if not isinstance(n, dict) or not all(
            isinstance(n.get(k), (int, float)) and not isinstance(n.get(k), bool)
            for k in ("note", "coef")
        ):
            return jsonify(erreur="Chaque note doit avoir une note et un coef numériques"), 400
        if not 0 <= n["note"] <= 20 or n["coef"] < 0:
            return jsonify(erreur="La note doit être entre 0 et 20 et le coef positif"), 400
    coefs = sum(n["coef"] for n in notes)
    if coefs == 0:
        return jsonify(erreur="Aucune note ou coefficient nul"), 400
    m = round(sum(n["note"] * n["coef"] for n in notes) / coefs, 2)
    return jsonify(moyenne=m, mention=mention(m))

@app.get("/sante")
def sante():
    return jsonify(statut="ok")

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=True)
