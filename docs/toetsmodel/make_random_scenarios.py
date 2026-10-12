"""Willekeurige (reproduceerbare) scenario's voor de kruiscontrole Excel <-> app."""
import json, random, sys

def make(n, seed):
    r = random.Random(seed)
    out = []
    for k in range(n):
        door = r.random() < 0.7
        two = r.random() < 0.65
        age1, age2 = r.randint(25, 64), r.randint(25, 64)
        parts = []
        for _ in range(r.choice([1, 2, 3, 4])):
            parts.append({"type": r.choice(["Annuïteit", "Lineair", "Aflossingsvrij"]),
                          "bal": round(r.uniform(20000, 450000), 2), "rate": r.choice([0.005, 0.0125, 0.0185, 0.025, 0.034, 0.041, 0.052, 0.06]),
                          "fix": r.choice([1, 3, 5, 10, 12, 15, 20, 30])})
        while len(parts) < 4:
            parts.append({"type": "Annuïteit", "bal": 0, "rate": 0.03, "fix": 10})
        sh_active = r.random() < 0.35
        s = {
            "name": f"Random {k+1}", "doorstromer": door, "twee": two,
            "inc1": r.randrange(30000, 160000, 1000), "inc2": r.randrange(20000, 140000, 1000) if two else 0,
            "age1": age1, "age2": age2,
            "pen1": r.randrange(20000, 60000, 1000) if age1 >= 57 and r.random() < 0.7 else 0,
            "pen2": r.randrange(20000, 60000, 1000) if two and age2 >= 57 and r.random() < 0.7 else 0,
            "label": r.choice(["G", "E", "D", "C", "B", "A", "A+", "A++", "A+++", "A++++"]),
            "rate": r.choice([0.025, 0.032, 0.038, 0.04, 0.0435, 0.051, 0.0575]), "fixed": r.choice([0, 1, 5, 7, 10, 15, 20, 30]),
            "debt1": r.choice([0, 0, 5000, 20000]), "debt2": r.choice([0, 0, 10000]), "famMonthly": r.choice([0, 0, 150, 400]),
            "sh": {"active": sh_active, "debt": r.randrange(10000, 250000, 1000), "rate": r.choice([0.01, 0.025, 0.04, 0.055]),
                   "type": r.choice(["Annuïteit", "Lineair", "Aflossingsvrij"]), "years": r.randint(3, 35), "fixed": r.choice([0, 2, 5, 9, 10, 20])},
            "studyTerm": r.choice([0, 0, 90, 142, 260]), "studyMode": r.choice(["Gewogen toetsrente", "Contractrente"]),
            "studyMethod": r.choice(["Marginaal", "Gewogen"]),
            "takeover": r.random() < 0.75, "termBasis": r.choice(["Resterend", "30 jaar"]),
            "peil": "2026-10-08", "start": f"{r.randint(2012, 2026)}-{r.randint(1, 10):02d}-{r.randint(1, 28):02d}",
            "parts": parts,
            "price": r.randrange(250000, 1600000, 5000), "mv": r.randrange(300000, 1500000, 5000),
            "discount": r.choice([0.95, 1.0]), "own": r.randrange(0, 250000, 5000), "tax": r.choice([0.0, 0.02, 0.02, 0.08]),
            "notary": r.choice([1000, 1200, 1800]), "val": r.choice([500, 600, 750]), "adv": r.choice([0, 2500, 3500]),
            "bg": r.random() < 0.5, "agent": r.random() < 0.3, "kk": r.random() < 0.8,
            "cap": r.choice([500000, 800000, 1000000, 1300000]),
        }
        out.append(s)
    return out

if __name__ == "__main__":
    n, seed, path = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3]
    json.dump(make(n, seed), open(path, "w"), ensure_ascii=False, indent=1)
