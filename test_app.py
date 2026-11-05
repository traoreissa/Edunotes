from app import app, mention

def test_mention():
    assert mention(15) == "Bien" and mention(9.5) == "Insuffisant"

def test_api_moyenne():
    c = app.test_client()
    r = c.post("/api/moyenne", json={"notes": [{"note": 12, "coef": 2}, {"note": 18, "coef": 1}]})
    assert r.status_code == 200 and r.get_json()["moyenne"] == 14.0

def test_page_accueil():
    assert app.test_client().get("/").status_code == 200

def test_api_moyenne_invalide():
    c = app.test_client()
    for corps in ({"notes": [{"note": 12}]}, {"notes": [{"note": "a", "coef": 1}]},
                  {"notes": [{"note": 25, "coef": 1}]}, {"notes": "x"}, [], {"notes": []}):
        r = c.post("/api/moyenne", json=corps)
        assert r.status_code == 400 and "erreur" in r.get_json()
