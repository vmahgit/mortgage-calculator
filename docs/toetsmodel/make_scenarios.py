"""Genereert scenarios.json: de testscenario's voor Excel-model en app-engine (zelfde invoer)."""
import json, copy

BASE = {
    "name": "Mijn dossier",
    "doorstromer": True, "twee": True,
    "inc1": 118000, "inc2": 107000, "age1": 36, "age2": 36, "pen1": 0, "pen2": 0,
    "label": "A", "rate": 0.0469, "fixed": 10,
    "debt1": 0, "debt2": 0, "famMonthly": 0,
    "sh": {"active": True, "debt": 42000, "rate": 0.01, "type": "Annuïteit", "years": 20, "fixed": 10},
    "studyTerm": 332, "studyMode": "Gewogen toetsrente", "studyMethod": "Marginaal",
    "takeover": True, "termBasis": "Resterend",
    "peil": "2026-10-08", "start": "2021-01-15",
    "parts": [
        {"type": "Annuïteit", "bal": 269480.64, "rate": 0.0125, "fix": 10},
        {"type": "Aflossingsvrij", "bal": 354269.27, "rate": 0.0185, "fix": 20},
        {"type": "Annuïteit", "bal": 0, "rate": 0.03, "fix": 10},
        {"type": "Annuïteit", "bal": 0, "rate": 0.03, "fix": 10},
    ],
    "price": 1330000, "mv": 935000, "discount": 0.95, "own": 150000,
    "tax": 0.02, "notary": 1200, "val": 600, "adv": 2500,
    "bg": True, "agent": False, "kk": True, "cap": 1000000,
}

def variant(name, **kw):
    s = copy.deepcopy(BASE); s["name"] = name
    for k, v in kw.items():
        if isinstance(v, dict) and isinstance(s.get(k), dict):
            s[k].update(v)
        else:
            s[k] = v
    return s

def parts(*ps):
    out = [dict(type=t, bal=b, rate=r, fix=f) for (t, b, r, f) in ps]
    while len(out) < 4:
        out.append({"type": "Annuïteit", "bal": 0, "rate": 0.03, "fix": 10})
    return out

scenarios = [
    BASE,
    variant("Plafond € 1,5 mln, 30 jaar toetsloptijd", cap=1500000, termBasis="30 jaar"),
    variant("Deel 2 slechts 10 jaar rentevast", parts=parts(
        ("Annuïteit", 269480.64, 0.0125, 10), ("Aflossingsvrij", 354269.27, 0.0185, 10))),
    variant("Nieuwe hypotheek 5 jaar rentevast", fixed=5),
    variant("Starter, 1 aanvrager € 60k", doorstromer=False, twee=False, inc1=60000, age1=30,
            sh={"active": False}, studyTerm=0, price=400000, own=40000, label="C", cap=1000000),
    variant("Starter, 2 aanvragers, studieschuld", doorstromer=False, inc1=80000, inc2=70000,
            age1=31, age2=29, sh={"active": False}, studyTerm=120, price=650000, own=60000,
            label="B", tax=0.0, studyMethod="Gewogen"),
    variant("Doorstromer, hypotheek niet meenemen", takeover=False),
    variant("AOW-toets bindend (leeftijd 60)", age1=60, pen1=40000, sh={"active": False}),
    variant("3 delen, 2e woning 5 jaar vast, schulden", sh={"fixed": 5, "type": "Aflossingsvrij"},
            debt1=15000, debt2=8000, famMonthly=250, label="G", studyMode="Contractrente",
            parts=parts(("Lineair", 180000, 0.021, 12), ("Annuïteit", 220000, 0.034, 5),
                        ("Aflossingsvrij", 150000, 0.0485, 3)), price=1100000, mv=900000, own=90000),
    variant("Hoge schuld: ondergrens € 0", debt1=3000000, sh={"active": False}),
]
json.dump(scenarios, open("scenarios.json", "w"), ensure_ascii=False, indent=1)
print(len(scenarios), "scenario's")
