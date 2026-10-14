#!/usr/bin/env python3
"""Bouwt Hypotheek_Toetsmodel_2026.xlsx: een onafhankelijk Excel-model van de leencapaciteitstoets.

Het model rekent met cel-formules (geen waarden uit de app) en zet daarnaast de uitkomsten van de
app-engine (expected.json) voor dezelfde scenario's (scenarios.json). Tabellen (woonquote,
studieschuld-opslagfactoren) worden uit de app-broncode gelezen, zodat beide dezelfde cijfers
gebruiken; de rekenstappen zijn in Excel los van de app opnieuw opgebouwd.

Gebruik:  python3 build_toetsmodel.py   (daarna recalc + verificatie, zie verify_toetsmodel.py)
"""
import json
import re
from pathlib import Path

from openpyxl import Workbook
from openpyxl.formatting.rule import CellIsRule, FormulaRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter as CL
from openpyxl.workbook.defined_name import DefinedName
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.worksheet.properties import PageSetupProperties

HERE = Path(__file__).resolve().parent
SRC = HERE.parent.parent / "src"
OUT = HERE / "Hypotheek_Toetsmodel_2026.xlsx"

import sys
SCEN_PATH = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / "scenarios.json"
EXP_PATH = Path(sys.argv[2]) if len(sys.argv) > 2 else HERE / "expected.json"
if len(sys.argv) > 3:
    OUT = Path(sys.argv[3])
scenarios = json.loads(SCEN_PATH.read_text())
expected = json.loads(EXP_PATH.read_text())
N_APP = len(scenarios)           # scenario's met app-uitkomst
N = N_APP + 1                    # + 'Eigen test'
FIRST_COL = 3                    # kolom C
COLS = [CL(FIRST_COL + i) for i in range(N)]
LASTC = COLS[-1]

# ---------------------------------------------------------------- stijlen
FONT = "Arial"
f_norm = Font(name=FONT, size=10)
f_bold = Font(name=FONT, size=10, bold=True)
f_input = Font(name=FONT, size=10, color="0000FF")
f_link = Font(name=FONT, size=10, color="008000")
f_head = Font(name=FONT, size=10, bold=True, color="FFFFFF")
f_title = Font(name=FONT, size=16, bold=True, color="1F3864")
f_sub = Font(name=FONT, size=10, italic=True, color="595959")
f_note = Font(name=FONT, size=9, italic=True, color="595959")
fill_head = PatternFill("solid", fgColor="1F3864")
fill_sec = PatternFill("solid", fgColor="D9E2F3")
fill_input = PatternFill("solid", fgColor="FFF2CC")
fill_est = PatternFill("solid", fgColor="FCE4D6")
fill_key = PatternFill("solid", fgColor="E2EFDA")
fill_grey = PatternFill("solid", fgColor="F2F2F2")
thin = Side(style="thin", color="BFBFBF")
b_all = Border(left=thin, right=thin, top=thin, bottom=thin)
b_top = Border(top=Side(style="thin", color="000000"))

EUR = '#,##0;(#,##0);"-"'
EUR2 = '#,##0.00;(#,##0.00);"-"'
PCT2 = "0.00%"
PCT3 = "0.000%"
PCT1 = "0.0%"
INT = "0"
FAC = "0.00"
DATE = "dd-mm-yyyy"
TXT = "@"

wb = Workbook()
ws_read = wb.active
ws_read.title = "Leesmij"
ws_sam = wb.create_sheet("Samenvatting")
ws_inv = wb.create_sheet("Invoer")
ws_ber = wb.create_sheet("Berekening")
ws_sol = wb.create_sheet("Solver")
ws_tab = wb.create_sheet("Tabellen")
ws_con = wb.create_sheet("Controle")
ws_bro = wb.create_sheet("Bronnen")


def put(ws, ref, value, font=f_norm, fmt=None, fill=None, align=None, border=None):
    c = ws[ref]
    c.value = value
    c.font = font
    if fmt:
        c.number_format = fmt
    if fill:
        c.fill = fill
    if align:
        c.alignment = align
    if border:
        c.border = border
    return c


def set_widths(ws, widths):
    for col, w in widths.items():
        ws.column_dimensions[col].width = w


# ================================================================ Tabellen
def parse_official(name):
    """Officiële tabel uit nibudTables2026.js: (inkomensrijen, rijen met 12 percentages)."""
    s = (SRC / "nibudTables2026.js").read_text(encoding="utf-8")
    m = re.search(rf"export const {name} = \{{\s*firstIncome: (\d+),\s*lastIncome: (\d+),\s*rows: \[(.*?)\n  \],", s, re.S)
    first, last = int(m.group(1)), int(m.group(2))
    rows = [[float(x) for x in r.split(",")] for r in re.findall(r"\[([\d.,\s]+)\]", m.group(3))]
    assert len(rows) == (last - first) // 1000 + 1 and all(len(r) == 12 for r in rows), name
    return list(range(first, last + 1, 1000)), rows


A1, T1 = parse_official("TABEL_1")
A2, T2 = parse_official("TABEL_2")
A3, T3 = parse_official("TABEL_3")
A4, T4 = parse_official("TABEL_4")
STUDY = [
    (float(a), float(b))
    for a, b in re.findall(
        r"\{ upTo: ([\d.]+|Infinity), factor: ([\d.]+) \}",
        (SRC / "studieschuld.js").read_text(encoding="utf-8").replace("Infinity", "999"),
    )
]
# Bovengrens per kolom in %; de laatste kolom (≥ 6,501%) heeft geen bovengrens (99 als hulpwaarde).
RATES = [1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0, 5.5, 6.0, 6.5, 99.0]
NCOL = len(RATES)

ws = ws_tab
put(ws, "A1", "Tabellen en parameters", f_title)
put(ws, "A2", "Blauwe cellen op gele achtergrond zijn invoer die u mag aanpassen. De woonquote-tabellen zijn de volledige officiële tabellen (Stcrt. 2025, 36471, Bijlage 1).", f_sub)

# --- parameters
put(ws, "A4", "A. Parameters (2026)", f_bold, fill=fill_sec)
for c in "BCD":
    ws[f"{c}4"].fill = fill_sec
put(ws, "B4", "Waarde", f_bold, fill=fill_sec)
put(ws, "C4", "Status", f_bold, fill=fill_sec)
put(ws, "F4", "Bron / toelichting", f_bold, fill=fill_sec)
for c in "EFGHIJK":
    ws[f"{c}4"].fill = fill_sec
params = [
    ("AFM_Toetsrente", "AFM-toetsrente (rentevast < 10 jaar)", 0.05, PCT2, "Geverifieerd t/m Q3 2026; Q4 2026 niet gevonden", "AFM, kwartaalbesluit; hoogste van toetsrente en werkelijke rente"),
    ("Looptijd_mnd", "Looptijd toets (maanden)", 360, INT, "Geverifieerd", "Tijdelijke regeling hypothecair krediet art. 3: annuïtair, 30 jaar"),
    ("Weging_overig", "Overige schulden: maandlast als % van het schuldbedrag", 0.02, PCT2, "Vereenvoudiging", "Gangbaar: 2% van het kredietbedrag, of lagere vaste maandlast uit contract"),
    ("Alleenstaand_bedrag", "Alleenstaandenbedrag (extra lenen)", 17000, EUR, "Bedrag geverifieerd", "Nibud advies hypotheeknormen 2026 (blijft € 17.000)"),
    ("Alleenstaand_min", "Minimum toetsinkomen alleenstaandenbedrag", 30000, EUR, "Bronnen verschillen (€ 28.000 / € 30.000)", "HomeFinance en CalcForLife noemen € 30.000"),
    ("Alleenstaand_min_AOW", "Idem, vanaf AOW-leeftijd", 29000, EUR, "Bronnen verschillen", "HomeFinance en CalcForLife noemen € 29.000"),
    ("AOW_drempel", "Leeftijd waarop de AOW-toets (pensioeninkomen) meedoet", 57, INT, "Aanname", "AOW-leeftijd 67 min 10 jaar; vanaf 2028 67 jaar en 3 maanden: leeftijd is hier een afronding"),
    ("Bankgarantie_pct", "Bankgarantie (% van de koopsom)", 0.001, PCT2, "Indicatief", "1% van de waarborgsom van 10%"),
    ("Makelaar_pct", "Aankoopmakelaar (% van de koopsom)", 0.012, PCT2, "Indicatief", "Courtage, optioneel"),
    ("Tolerantie", "Tolerantie controle app tegen Excel (euro)", 1, EUR2, "Instelling", "Verschillen kleiner dan dit bedrag tellen als gelijk"),
]
prow = 5
for name, label, val, fmt, status, bron in params:
    put(ws, f"A{prow}", label)
    put(ws, f"B{prow}", val, f_input, fmt, fill_input, border=b_all)
    put(ws, f"C{prow}", status, f_note)
    put(ws, f"F{prow}", bron, f_note)
    ws.merge_cells(f"C{prow}:E{prow}")
    ws.merge_cells(f"F{prow}:K{prow}")
    wb.defined_names[name] = DefinedName(name, attr_text=f"Tabellen!$B${prow}")
    prow += 1

# --- energielabel
r0 = prow + 1
put(ws, f"A{r0}", "B. Extra leenruimte energielabel (2026)", f_bold, fill=fill_sec)
for c in "BCD":
    ws[f"{c}{r0}"].fill = fill_sec
energy = [("G", 0), ("F", 0), ("E", 0), ("D", 5000), ("C", 5000), ("B", 10000), ("A", 10000),
          ("A+", 20000), ("A++", 20000), ("A+++", 25000), ("A++++", 30000)]
for i, (lab, bonus) in enumerate(energy):
    rr = r0 + 1 + i
    put(ws, f"A{rr}", lab, f_input, fill=fill_input, border=b_all)
    put(ws, f"B{rr}", bonus, f_input, EUR, fill_input, border=b_all)
put(ws, f"C{r0+1}", "Bronnen consistent; A++++ zonder 10-jaars energieprestatiegarantie (met garantie € 40.000)", f_note)
wb.defined_names["Energie_label"] = DefinedName("Energie_label", attr_text=f"Tabellen!$A${r0+1}:$A${r0+len(energy)}")
wb.defined_names["Energie_bonus"] = DefinedName("Energie_bonus", attr_text=f"Tabellen!$B${r0+1}:$B${r0+len(energy)}")
ENERGY_LABELS = [e[0] for e in energy]

# --- studieschuld
r1 = r0 + len(energy) + 3
put(ws, f"A{r1}", "C. Opslagfactor studieschuld (art. 3a)", f_bold, fill=fill_sec)
for c in "BCD":
    ws[f"{c}{r1}"].fill = fill_sec
put(ws, f"A{r1+1}", "Debetrente tot en met", f_bold)
put(ws, f"B{r1+1}", "Opslagfactor", f_bold)
for i, (upto, fac) in enumerate(STUDY):
    rr = r1 + 2 + i
    put(ws, f"A{rr}", (upto / 100 if upto < 900 else 9.99), f_input, PCT3 if upto < 900 else '"geen grens"', fill_input, border=b_all)
    put(ws, f"B{rr}", fac, f_input, FAC, fill_input, border=b_all)
put(ws, f"C{r1+2}", "Niet afzonderlijk tegen de Staatscourant gecontroleerd; bronnen verschillen (zie Bronnen)", f_note)
wb.defined_names["Studie_upTo"] = DefinedName("Studie_upTo", attr_text=f"Tabellen!$A${r1+2}:$A${r1+1+len(STUDY)}")
wb.defined_names["Studie_factor"] = DefinedName("Studie_factor", attr_text=f"Tabellen!$B${r1+2}:$B${r1+1+len(STUDY)}")


def woonquote_table(top, title, anchors, tab, prefix, note):
    """Schrijft een woonquote-tabel; geeft (eerste datarij) terug."""
    last_col = CL(1 + NCOL)
    put(ws, f"A{top}", title, f_bold, fill=fill_sec)
    for j in range(NCOL):
        ws[f"{CL(2 + j)}{top}"].fill = fill_sec
    put(ws, f"A{top+1}", "Toetsrente tot en met →", f_bold)
    put(ws, f"A{top+2}", "Kolom", f_note)
    for j, rt in enumerate(RATES):
        col = CL(2 + j)
        put(ws, f"{col}{top+1}", rt / 100, f_input, PCT1, fill_input, Alignment(horizontal="center"), b_all)
        put(ws, f"{col}{top+2}", "≥ 6,501%" if j == NCOL - 1 else "officieel", f_note, align=Alignment(horizontal="center"))
    first = top + 3
    put(ws, f"A{first-1}", "Toetsinkomen vanaf ↓", f_bold)
    for i, inc in enumerate(anchors):
        rr = first + i
        put(ws, f"A{rr}", inc, f_input, EUR, fill_input, border=b_all)
        for j in range(NCOL):
            put(ws, f"{CL(2 + j)}{rr}", tab[i][j] / 100, f_input, PCT1, fill_input, border=b_all)
    put(ws, f"A{first+len(anchors)}", note, f_note)
    wb.defined_names[f"{prefix}_Inkomen"] = DefinedName(f"{prefix}_Inkomen", attr_text=f"Tabellen!$A${first}:$A${first+len(anchors)-1}")
    wb.defined_names[f"{prefix}_Tabel"] = DefinedName(f"{prefix}_Tabel", attr_text=f"Tabellen!$B${first}:${last_col}${first+len(anchors)-1}")
    wb.defined_names[f"{prefix}_Rente"] = DefinedName(f"{prefix}_Rente", attr_text=f"Tabellen!$B${top+1}:${last_col}${top+1}")
    return first + len(anchors) + 2


nxt = woonquote_table(r1 + len(STUDY) + 4, "D. Tabel 1: woonquote (financieringslastpercentage), tot AOW-leeftijd", A1, T1, "T1",
                      "Officiële tabel (Stcrt. 2025, 36471, Bijlage 1): rij = toetsinkomen naar beneden op € 1.000, kolom = toetsrente per 0,5%-punt.")
nxt = woonquote_table(nxt, "E. Tabel 2: woonquote vanaf AOW-leeftijd (pensioenscenario)", A2, T2, "T2",
                      "Zelfde opzet; wordt gebruikt voor het verwachte pensioeninkomen.")
nxt = woonquote_table(nxt, "F. Tabel 3: niet-aftrekbare leningdelen (box 3), tot AOW-leeftijd", A3, T3, "T3",
                      "Voor box 3-delen: hun toetslast telt mee met de bruteringsfactor Tabel 1 ÷ Tabel 3.")
nxt = woonquote_table(nxt, "G. Tabel 4: niet-aftrekbare leningdelen (box 3), vanaf AOW-leeftijd", A4, T4, "T4",
                      "Pensioenscenario: bruteringsfactor Tabel 2 ÷ Tabel 4.")
set_widths(ws, {"A": 52, **{CL(2 + j): 12 for j in range(NCOL)}})
ws.freeze_panes = "A4"

# ================================================================ Invoer
BOOL = lambda v: "Ja" if v else "Nee"
TYPES = ["Annuïteit", "Lineair", "Aflossingsvrij"]


def part(s, i, key):
    return s["parts"][i][key]


# (key, label, unit, fmt, getter, validation-list or None)
INPUTS = [
    ("§", "Algemeen"),
    ("name", "Naam scenario", "", TXT, lambda s: s["name"], None),
    ("door", "Doorstromer (bestaande woning)?", "Ja/Nee", TXT, lambda s: BOOL(s["doorstromer"]), "JN"),
    ("two", "Twee aanvragers?", "Ja/Nee", TXT, lambda s: BOOL(s["twee"]), "JN"),
    ("§", "Inkomen en leeftijd"),
    ("inc1", "Toetsinkomen aanvrager 1", "€ per jaar", EUR, lambda s: s["inc1"], None),
    ("inc2", "Toetsinkomen aanvrager 2", "€ per jaar", EUR, lambda s: s["inc2"] if s["twee"] else 0, None),
    ("age1", "Leeftijd aanvrager 1", "jaar", INT, lambda s: s["age1"], None),
    ("age2", "Leeftijd aanvrager 2", "jaar", INT, lambda s: s["age2"], None),
    ("pen1", "Verwacht pensioeninkomen aanvrager 1 (bij ≥ 57 jaar)", "€ per jaar", EUR, lambda s: s["pen1"], None),
    ("pen2", "Verwacht pensioeninkomen aanvrager 2 (bij ≥ 57 jaar)", "€ per jaar", EUR, lambda s: s["pen2"], None),
    ("label", "Energielabel woning", "label", TXT, lambda s: s["label"], "LABEL"),
    ("§", "Nieuwe hypotheek"),
    ("rate", "Rente nieuwe hypotheek", "% per jaar", PCT2, lambda s: s["rate"], None),
    ("fixed", "Rentevaste periode nieuwe hypotheek", "jaar", INT, lambda s: s["fixed"], None),
    ("price", "Aankoopprijs beoogde woning", "€", EUR, lambda s: s["price"], None),
    ("cap", "Plafond totale hypotheek bij geldverstrekker", "€", EUR, lambda s: s["cap"], None),
    ("§", "Schulden en lasten"),
    ("debt1", "Overige schulden aanvrager 1 (kredietbedrag)", "€", EUR, lambda s: s["debt1"], None),
    ("debt2", "Overige schulden aanvrager 2 (kredietbedrag)", "€", EUR, lambda s: s["debt2"], None),
    ("fam", "Maandelijkse aflossing familielening", "€ per maand", EUR, lambda s: s["famMonthly"], None),
    ("studyTerm", "Studieschuld: totaal maandbedrag DUO (alle leningen)", "€ per maand", EUR, lambda s: s["studyTerm"], None),
    ("studyMode", "Studieschuld: debetrente voor opslagfactor", "keuze", TXT, lambda s: s["studyMode"], "SMODE"),
    ("studyMethod", "Studieschuld: kapitaliseren tegen", "keuze", TXT, lambda s: s["studyMethod"], "SMETH"),
    ("§", "Tweede woning (aanhouden)"),
    ("sh_active", "Tweede woning met hypotheek aanhouden?", "Ja/Nee", TXT, lambda s: BOOL(s["sh"]["active"]), "JN"),
    ("sh_debt", "Hypotheekschuld tweede woning", "€", EUR, lambda s: s["sh"]["debt"], None),
    ("sh_rate", "Rente tweede woning", "% per jaar", PCT2, lambda s: s["sh"]["rate"], None),
    ("sh_type", "Aflosvorm tweede woning", "keuze", TXT, lambda s: s["sh"]["type"], "TYPE"),
    ("sh_years", "Resterende looptijd tweede woning", "jaar", INT, lambda s: s["sh"]["years"], None),
    ("sh_fixed", "Resterende rentevaste periode tweede woning", "jaar", INT, lambda s: s["sh"]["fixed"], None),
    ("§", "Bestaande hypotheek (alleen doorstromer)"),
    ("takeover", "Hypotheek meenemen naar de nieuwe woning?", "Ja/Nee", TXT, lambda s: BOOL(s["takeover"]), "JN"),
    ("termBasis", "Looptijd voor toetslast meegenomen delen", "keuze", TXT, lambda s: s["termBasis"], "TERM"),
    ("start", "Ingangsdatum hypotheek", "datum", DATE, lambda s: s["start"], None),
    ("peil", "Peildatum (restsaldi)", "datum", DATE, lambda s: s["peil"], None),
] + [
    item
    for i in range(4)
    for item in (
        ("§", f"Leningdeel {i+1}") if i == 0 else ("§", f"Leningdeel {i+1}"),
        (f"p{i}_type", f"Deel {i+1}: aflosvorm", "keuze", TXT, (lambda i: lambda s: part(s, i, "type"))(i), "TYPE"),
        (f"p{i}_bal", f"Deel {i+1}: restsaldo op peildatum", "€", EUR2, (lambda i: lambda s: part(s, i, "bal"))(i), None),
        (f"p{i}_rate", f"Deel {i+1}: contractrente", "% per jaar", PCT2, (lambda i: lambda s: part(s, i, "rate"))(i), None),
        (f"p{i}_fix", f"Deel {i+1}: oorspronkelijke rentevaste periode", "jaar", INT, (lambda i: lambda s: part(s, i, "fix"))(i), None),
    )
] + [
    ("§", "Woning, eigen geld en kosten koper"),
    ("mv", "Marktwaarde huidige woning", "€", EUR, lambda s: s["mv"], None),
    ("discount", "Verkoopwaarde als % van marktwaarde (voorzichtig)", "%", PCT1, lambda s: s["discount"], None),
    ("own", "Eigen geld (liquide) voor de aankoop", "€", EUR, lambda s: s["own"], None),
    ("tax", "Overdrachtsbelasting", "% koopsom", PCT2, lambda s: s["tax"], None),
    ("notary", "Notaris", "€", EUR, lambda s: s["notary"], None),
    ("val", "Taxatie", "€", EUR, lambda s: s["val"], None),
    ("adv", "Hypotheekadvies en bemiddeling", "€", EUR, lambda s: s["adv"], None),
    ("bg", "Bankgarantie meenemen?", "Ja/Nee", TXT, lambda s: BOOL(s["bg"]), "JN"),
    ("agent", "Aankoopmakelaar meenemen?", "Ja/Nee", TXT, lambda s: BOOL(s["agent"]), "JN"),
    ("kk", "Kosten koper meetellen in de toets?", "Ja/Nee", TXT, lambda s: BOOL(s["kk"]), "JN"),
]

ws = ws_inv
put(ws, "A1", "Invoer", f_title)
put(ws, "A2", f"Vul alleen de gele cellen met blauwe tekst in. Kolom C is uw eigen dossier; D t/m {COLS[N_APP-1]} zijn testscenario's met bekende app-uitkomst; {LASTC} is een vrij testscenario.", f_sub)
put(ws, "A4", "Scenario", f_head, fill=fill_head)
put(ws, "B4", "Eenheid", f_head, fill=fill_head)
for i, c in enumerate(COLS):
    put(ws, f"{c}4", i + 1, f_head, INT, fill_head, Alignment(horizontal="center"))
INV = {}
row = 5
dv_sets = {
    "JN": '"Ja,Nee"', "TYPE": '"Annuïteit,Lineair,Aflossingsvrij"', "SMODE": '"Gewogen toetsrente,Contractrente"',
    "SMETH": '"Marginaal,Gewogen"', "TERM": '"Resterend,30 jaar"', "LABEL": '"' + ",".join(ENERGY_LABELS) + '"',
}
dvs = {k: DataValidation(type="list", formula1=v, allow_blank=True) for k, v in dv_sets.items()}
for dv in dvs.values():
    ws.add_data_validation(dv)
all_scn = scenarios + [dict(scenarios[0], name="Eigen test")]
for item in INPUTS:
    if item[0] == "§":
        put(ws, f"A{row}", item[1], f_bold, fill=fill_sec)
        for c in ["B"] + COLS:
            ws[f"{c}{row}"].fill = fill_sec
        row += 1
        continue
    key, label, unit, fmt, getter, val = item
    INV[key] = row
    put(ws, f"A{row}", label)
    put(ws, f"B{row}", unit, f_note)
    for i, c in enumerate(COLS):
        v = getter(all_scn[i])
        if fmt == DATE:
            import datetime
            v = datetime.date.fromisoformat(v)
        put(ws, f"{c}{row}", v, f_input, fmt, fill_input, Alignment(horizontal="right" if fmt != TXT else "left"), b_all)
        if val in dvs:
            dvs[val].add(f"{c}{row}")
    row += 1
INV_LAST = row
set_widths(ws, {"A": 58, "B": 14, **{c: 17 for c in COLS}})
ws.row_dimensions[4].height = 18
ws.freeze_panes = "C5"
for c in COLS:
    ws[f"{c}{INV['name']}"].alignment = Alignment(wrap_text=True, vertical="top", horizontal="left")
ws.row_dimensions[INV["name"]].height = 42

# ================================================================ Berekening en Solver (twee-pass)
def annuity(bal, rate, n):
    return f"IF({bal}<=0,0,IF({rate}=0,{bal}/{n},{bal}*({rate}/12)/(1-(1+{rate}/12)^(-{n}))))"


def capfac(rate):
    return f"IF({rate}=0,360,(1-(1+{rate}/12)^(-360))/({rate}/12))"


def interp(inc_v, inc_i, prefix, idx):
    # Exacte opzoeking (geen interpolatie): rij inc_i, kolom idx.
    return f"INDEX({prefix}_Tabel,{inc_i},{idx})"


BER = []   # (key, label, unit, fmt, fn) of ("§", titel)
SOL = []


def B(key, label, unit, fmt, fn, bold=False):
    BER.append((key, label, unit, fmt, fn, bold))


def S(key, label, unit, fmt, fn, bold=False):
    SOL.append((key, label, unit, fmt, fn, bold))


# ---- Berekening
BER.append(("§", "1. Uitgangspunten"))
B("door", "Doorstromer (1 = ja)", "", INT, lambda c, r, i, s: f'=IF({i("door")}="Ja",1,0)')
B("two", "Twee aanvragers (1 = ja)", "", INT, lambda c, r, i, s: f'=IF({i("two")}="Ja",1,0)')
B("take", "Hypotheek wordt meegenomen (1 = ja)", "", INT, lambda c, r, i, s: f'={r("door")}*IF({i("takeover")}="Ja",1,0)')
B("inc_total", "Totaal toetsinkomen", "€", EUR, lambda c, r, i, s: f'={i("inc1")}+{r("two")}*{i("inc2")}')
B("testRate", "Toetsrente nieuwe hypotheek", "%", PCT3, lambda c, r, i, s: f'=IF(AND({i("fixed")}<10,AFM_Toetsrente>{i("rate")}),AFM_Toetsrente,{i("rate")})')
B("fcap", "Kapitalisatiefactor (360 mnd) bij toetsrente", "", FAC, lambda c, r, i, s: f'={capfac(r("testRate"))}')

BER.append(("§", "2. Schulden en lasten"))
B("other", "Overige schulden: maandlast (2%)", "€ p/m", EUR2, lambda c, r, i, s: f'=({i("debt1")}+{r("two")}*{i("debt2")})*Weging_overig')
B("sh_on", "Tweede woning aangehouden (1 = ja)", "", INT, lambda c, r, i, s: f'=IF({i("sh_active")}="Ja",1,0)')
B("sh_test", "Tweede woning: toetsrente", "%", PCT3, lambda c, r, i, s: f'={r("sh_on")}*IF(AND({i("sh_fixed")}<10,AFM_Toetsrente>{i("sh_rate")}),AFM_Toetsrente,{i("sh_rate")})')
B("sh_n", "Tweede woning: toetslooptijd", "maanden", INT, lambda c, r, i, s: f'=IF({i("sh_type")}="Aflossingsvrij",360,MIN(360,MAX(1,ROUND({i("sh_years")}*12,0))))')
B("sh_tl", "Tweede woning: toetslast", "€ p/m", EUR2, lambda c, r, i, s: f'={r("sh_on")}*{annuity(i("sh_debt"), r("sh_test"), r("sh_n"))}')
B("debt_month", "Totale maandlast schulden (excl. studieschuld)", "€ p/m", EUR2, lambda c, r, i, s: f'={r("other")}+{r("sh_tl")}+{i("fam")}', True)

BER.append(("§", "3. Bestaande hypotheek: toets per leningdeel"))
B("elapsed", "Verstreken maanden sinds ingangsdatum", "maanden", INT, lambda c, r, i, s: f'=IFERROR(DATEDIF({i("start")},{i("peil")},"m"),0)')
B("term_rest", "Resterende looptijd (360 min verstreken)", "maanden", INT, lambda c, r, i, s: f'=MAX(1,360-{r("elapsed")})')
for k in range(4):
    n = k + 1
    B(f"bal{k}", f"Deel {n}: restsaldo", "€", EUR2, (lambda k: lambda c, r, i, s: f'={i(f"p{k}_bal")}')(k))
    B(f"fixrem{k}", f"Deel {n}: resterende rentevaste periode", "maanden", INT, (lambda k: lambda c, r, i, s: f'=MAX(0,{i(f"p{k}_fix")}*12-{r("elapsed")})')(k))
    B(f"test{k}", f"Deel {n}: toetsrente", "%", PCT3, (lambda k: lambda c, r, i, s: f'=IF({r(f"bal{k}")}>0,IF({r(f"fixrem{k}")}<120,MAX(AFM_Toetsrente,{i(f"p{k}_rate")}),{i(f"p{k}_rate")}),0)')(k))
    B(f"n{k}", f"Deel {n}: toetslooptijd", "maanden", INT, (lambda k: lambda c, r, i, s: f'=IF(OR({i(f"p{k}_type")}="Aflossingsvrij",{i("termBasis")}="30 jaar"),360,{r("term_rest")})')(k))
    B(f"tl{k}", f"Deel {n}: toetslast (annuïteit)", "€ p/m", EUR2, (lambda k: lambda c, r, i, s: f'={annuity(r(f"bal{k}"), r(f"test{k}"), r(f"n{k}"))}')(k))
    B(f"b3{k}", f"Deel {n}: rente niet aftrekbaar, box 3 (1 = ja; aflossingsvrij na 2013)", "", INT, (lambda k: lambda c, r, i, s: f'=IF(AND({i(f"p{k}_type")}="Aflossingsvrij",YEAR({i("start")})>2013),1,0)')(k))
B("cur_debt", "Totale restschuld bestaande hypotheek", "€", EUR2, lambda c, r, i, s: "=" + "+".join(r(f"bal{k}") for k in range(4)), True)
B("ported", "Meegenomen hypotheek", "€", EUR2, lambda c, r, i, s: f'={r("take")}*{r("cur_debt")}')
B("ptl", "Toetslast meegenomen delen samen (ongebruteerd)", "€ p/m", EUR2, lambda c, r, i, s: f'={r("take")}*(' + "+".join(r(f"tl{k}") for k in range(4)) + ")")
B("ptl3", "Waarvan box 3-delen", "€ p/m", EUR2, lambda c, r, i, s: f'={r("take")}*(' + "+".join(f'{r(f"tl{k}")}*{r(f"b3{k}")}' for k in range(4)) + ")")
B("ptl1", "Waarvan box 1-delen", "€ p/m", EUR2, lambda c, r, i, s: f'={r("ptl")}-{r("ptl3")}')
B("wA", "Σ saldo × looptijd × toetsrente (teller gewogen rente)", "", '#,##0', lambda c, r, i, s: f'={r("take")}*(' + "+".join(f'{r(f"bal{k}")}*{r(f"n{k}")}*{r(f"test{k}")}' for k in range(4)) + ")")
B("wB", "Σ saldo × looptijd (noemer gewogen rente)", "", '#,##0', lambda c, r, i, s: f'={r("take")}*(' + "+".join(f'{r(f"bal{k}")}*{r(f"n{k}")}' for k in range(4)) + ")")
B("f_comp", "Samengestelde toets actief (1 = ja)", "", INT, lambda c, r, i, s: f'=IF(AND({r("take")}=1,{r("cur_debt")}>0),1,0)')

BER.append(("§", "4. Financieringsgat en kosten koper"))
B("sale", "Verkoopwaarde huidige woning (voorzichtig)", "€", EUR, lambda c, r, i, s: f'={i("mv")}*{i("discount")}')
B("overw", "Bruikbare overwaarde", "€", EUR, lambda c, r, i, s: f'=MAX(0,{r("sale")}-{r("cur_debt")})')
B("tekort", "Restschuld-tekort bij verkoop", "€", EUR, lambda c, r, i, s: f'=MAX(0,{r("cur_debt")}-{r("sale")})')
B("gap", "Financieringsgat (aankoopprijs − meegenomen − overwaarde + tekort)", "€", EUR, lambda c, r, i, s: f'={r("door")}*({i("price")}-{r("ported")}-{r("overw")}+{r("tekort")})', True)
B("kk_tax", "Overdrachtsbelasting", "€", EUR, lambda c, r, i, s: f'={i("price")}*{i("tax")}')
B("kk_bg", "Bankgarantie", "€", EUR, lambda c, r, i, s: f'=IF({i("bg")}="Ja",{i("price")}*Bankgarantie_pct,0)')
B("kk_ag", "Aankoopmakelaar", "€", EUR, lambda c, r, i, s: f'=IF({i("agent")}="Ja",{i("price")}*Makelaar_pct,0)')
B("kk_total", "Kosten koper totaal", "€", EUR, lambda c, r, i, s: f'={r("kk_tax")}+{i("notary")}+{i("val")}+{i("adv")}+{r("kk_bg")}+{r("kk_ag")}', True)
B("kk_cash", "Kosten koper die van eigen geld afgaan", "€", EUR, lambda c, r, i, s: f'=IF({i("kk")}="Ja",{r("kk_total")},0)')
B("surplus", "Overschot uit verkoop (als de woning goedkoper is dan meegenomen + overwaarde)", "€", EUR, lambda c, r, i, s: f'=MAX(0,-{r("gap")})')
B("own_gap", "Eigen geld beschikbaar voor het gat (na kosten koper)", "€", EUR, lambda c, r, i, s: f'=MAX(0,{i("own")}-{r("kk_cash")})')
B("own_app", "Eigen geld ingezet op het gat", "€", EUR, lambda c, r, i, s: f'=MIN({r("own_gap")},MAX(0,{r("gap")}))')
B("addl_base", "Nieuw geld voor het gat (gat min eigen geld)", "€", EUR, lambda c, r, i, s: f'=MAX(0,{r("gap")}-{r("own_app")})')
B("kk_uncov", "Kosten koper die eigen geld en overschot niet dekken", "€", EUR, lambda c, r, i, s: f'={r("door")}*MAX(0,{r("kk_cash")}-{i("own")}-{r("surplus")})')
B("ltv_room", "Ruimte tot 100% van de woningwaarde (prijs min totale hypotheek)", "€", EUR, lambda c, r, i, s: f'=MAX(0,{i("price")}-{r("ported")}-{r("addl_base")})')
B("kk_fin", "Kosten koper die worden meegefinancierd (binnen 100% LTV)", "€", EUR, lambda c, r, i, s: f'=MIN({r("kk_uncov")},{r("ltv_room")})')
B("kk_short", "Kosten koper die niet te financieren zijn (tekort aan eigen geld)", "€", EUR, lambda c, r, i, s: f'={r("kk_uncov")}-{r("kk_fin")}')
B("addl", "Nieuw geld nodig (doorstromer)", "€", EUR, lambda c, r, i, s: f'={r("addl_base")}+{r("kk_fin")}', True)

BER.append(("§", "5. Studieschuld (art. 3a)"))
B("newmoney", "Nieuw geld in de weging van de debetrente", "€", EUR, lambda c, r, i, s: f'={r("door")}*{r("addl")}')
B("sb_bal", "Meegenomen saldo in de weging", "€", EUR, lambda c, r, i, s: f'={r("take")}*{r("cur_debt")}')
B("sb_toets", "Σ saldo × toetsrente (meegenomen)", "", '#,##0.00', lambda c, r, i, s: f'={r("take")}*(' + "+".join(f'{r(f"bal{k}")}*{r(f"test{k}")}' for k in range(4)) + ")")
B("sb_contr", "Σ saldo × contractrente (meegenomen)", "", '#,##0.00', lambda c, r, i, s: f'={r("take")}*(' + "+".join(f'{r(f"bal{k}")}*{i(f"p{k}_rate")}' for k in range(4)) + ")")
B("nb_bal", "Gewicht nieuw geld", "€", EUR, lambda c, r, i, s: f'=IF({r("newmoney")}>0,{r("newmoney")},IF({r("sb_bal")}>0,0,1))')
B("nb_toets", "Toetsrente nieuw geld", "%", PCT3, lambda c, r, i, s: f'=IF({i("fixed")}<10,MAX({i("rate")},AFM_Toetsrente),{i("rate")})')
B("w_toets", "Gewogen toetsrente (gewicht saldo)", "%", PCT3, lambda c, r, i, s: f'=({r("sb_toets")}+{r("nb_bal")}*{r("nb_toets")})/({r("sb_bal")}+{r("nb_bal")})')
B("w_contr", "Gewogen contractrente (gewicht saldo)", "%", PCT3, lambda c, r, i, s: f'=({r("sb_contr")}+{r("nb_bal")}*{i("rate")})/({r("sb_bal")}+{r("nb_bal")})')
B("debetrente", "Debetrente voor de opslagfactor", "%", PCT3, lambda c, r, i, s: f'=IF({i("studyMode")}="Contractrente",{r("w_contr")},{r("w_toets")})')
B("sfactor", "Opslagfactor", "", FAC, lambda c, r, i, s: f'=INDEX(Studie_factor,SUMPRODUCT(--(Studie_upTo<ROUND({r("debetrente")},5)))+1)')
B("srate", "Kapitalisatierente studieschuld", "%", PCT3, lambda c, r, i, s: f'=IF({i("studyMethod")}="Gewogen",{r("w_toets")},{r("testRate")})')
B("spay", "Maandbedrag per geleende euro", "", '0.000000', lambda c, r, i, s: f'=IF({r("srate")}=0,1/360,({r("srate")}/12)/(1-(1+{r("srate")}/12)^(-360)))')
B("stoets", "Toetslast studieschuld (termijn × factor)", "€ p/m", EUR2, lambda c, r, i, s: f'={i("studyTerm")}*{r("sfactor")}')
B("afslag", "Afslag studieschuld op de hypotheek", "€", EUR, lambda c, r, i, s: f'={r("stoets")}/{r("spay")}', True)

BER.append(("§", "6. Leencapaciteit op inkomen (alles als nieuw geld tegen de toetsrente)"))
B("incrow", "Inkomensrij (naar beneden op € 1.000)", "€", EUR, lambda c, r, i, s: f'=INT({r("inc_total")}/1000)*1000')
B("idx", "Rentekolom (1 = ≤ 1,5% … 12 = ≥ 6,501%)", "", INT, lambda c, r, i, s: f'=MIN(12,MAX(1,ROUNDUP(ROUND({r("testRate")}*100,3)/0.5-0.000000001,0)-2))')
B("vinc", "Inkomen binnen tabelbereik", "€", EUR, lambda c, r, i, s: f'=MIN(MAX({r("incrow")},INDEX(T1_Inkomen,1)),INDEX(T1_Inkomen,ROWS(T1_Inkomen)))')
B("iinc", "Tabelrij", "", INT, lambda c, r, i, s: f'=({r("vinc")}-INDEX(T1_Inkomen,1))/1000+1')
B("wq", "Woonquote (tabel 1)", "%", PCT2, lambda c, r, i, s: f'={interp(r("vinc"), r("iinc"), "T1", r("idx"))}')
B("woonlast", "Maximale woonlast per maand", "€ p/m", EUR2, lambda c, r, i, s: f'={r("wq")}*{r("inc_total")}/12')
B("gross", "Leencapaciteit voor schulden", "€", EUR, lambda c, r, i, s: f'={r("woonlast")}*{r("fcap")}', True)
B("after_debts", "Na schulden en tweede woning", "€", EUR, lambda c, r, i, s: f'=MAX(0,{r("woonlast")}-{r("debt_month")})*{r("fcap")}')
B("after_study", "Na studieschuld", "€", EUR, lambda c, r, i, s: f'=MAX(0,{r("after_debts")}-{r("afslag")})')
B("sb", "Alleenstaandenbedrag", "€", EUR, lambda c, r, i, s: f'=IF({r("two")}=0,IF({r("inc_total")}>Alleenstaand_min,Alleenstaand_bedrag,0),0)')
B("energy", "Energielabelbonus", "€", EUR, lambda c, r, i, s: f'=INDEX(Energie_bonus,MATCH({i("label")},Energie_label,0))')

BER.append(("§", "7. AOW-toets (pensioeninkomen, tabel 2)"))
B("pa1", "Aanvrager 1 binnen 10 jaar van AOW (1 = ja)", "", INT, lambda c, r, i, s: f'=IF({i("age1")}>=AOW_drempel,1,0)')
B("pa2", "Aanvrager 2 binnen 10 jaar van AOW (1 = ja)", "", INT, lambda c, r, i, s: f'={r("two")}*IF({i("age2")}>=AOW_drempel,1,0)')
B("pmiss", "Pensioeninkomen ontbreekt (1 = ja)", "", INT, lambda c, r, i, s: f'=IF(OR(AND({r("pa1")}=1,{i("pen1")}<=0),AND({r("pa2")}=1,{i("pen2")}<=0)),1,0)')
B("pactive", "AOW-toets actief (1 = ja)", "", INT, lambda c, r, i, s: f'=IF({r("pa1")}+{r("pa2")}>0,1,0)*(1-{r("pmiss")})')
B("pinc", "Toetsinkomen in het pensioenscenario", "€", EUR, lambda c, r, i, s: f'=IF({r("pa1")}=1,{i("pen1")},{i("inc1")})+{r("two")}*IF({r("pa2")}=1,{i("pen2")},{i("inc2")})')
B("vpen", "Pensioeninkomen binnen tabelbereik", "€", EUR, lambda c, r, i, s: f'=MIN(MAX(INT({r("pinc")}/1000)*1000,INDEX(T2_Inkomen,1)),INDEX(T2_Inkomen,ROWS(T2_Inkomen)))')
B("ipen", "Tabelrij", "", INT, lambda c, r, i, s: f'=({r("vpen")}-INDEX(T2_Inkomen,1))/1000+1')
B("wq_pen", "Woonquote (tabel 2)", "%", PCT2, lambda c, r, i, s: f'={interp(r("vpen"), r("ipen"), "T2", r("idx"))}')
B("ploan", "Leencapaciteit op pensioeninkomen na schulden en studieschuld", "€", EUR, lambda c, r, i, s: f'=MAX(0,MAX(0,{r("wq_pen")}*{r("pinc")}/12-{r("debt_month")})*{r("fcap")}-{r("afslag")})')
B("psb", "Alleenstaandenbedrag in het pensioenscenario", "€", EUR, lambda c, r, i, s: f'=IF({r("two")}=0,IF({r("pinc")}>Alleenstaand_min_AOW,Alleenstaand_bedrag,0),0)')
B("pbind", "Pensioenscenario bindend (1 = ja)", "", INT, lambda c, r, i, s: f'=IF(AND({r("pactive")}=1,{r("ploan")}+{r("psb")}<{r("after_study")}+{r("sb")}),1,0)')
B("bound", "Leencapaciteit na AOW-toets", "€", EUR, lambda c, r, i, s: f'=IF({r("pbind")}=1,{r("ploan")}+{r("psb")}-{r("sb")},{r("after_study")})')
B("inc_max", "Maximale hypotheek o.b.v. inkomen (alles tegen toetsrente)", "€", EUR, lambda c, r, i, s: f'=MAX(0,{r("bound")}+{r("energy")}+{r("sb")})', True)

BER.append(("§", "8. Toets van de samenstelling bij meenemen (zie Solver)"))
B("comp_inc", "Max. nieuw geld, inkomensscenario", "€", EUR, lambda c, r, i, s: f'={s("inc_comp")}')
B("comp_pen", "Max. nieuw geld, pensioenscenario", "€", EUR, lambda c, r, i, s: f'={s("pen_comp")}')
B("extra", "Ruimte voor nieuw geld (inkomen)", "€", EUR, lambda c, r, i, s: f'=IF({r("f_comp")}=1,MIN({r("comp_inc")},IF({r("pactive")}=1,{r("comp_pen")},1E+15)),{r("inc_max")})', True)
B("eff_max", "Totale hypotheek die het inkomen toelaat (meegenomen + nieuw)", "€", EUR, lambda c, r, i, s: f'={r("ported")}+{r("extra")}')
B("wavg", "Gewogen toetsrente van de nieuwe hypotheek bij dit maximum", "%", PCT3, lambda c, r, i, s: f'=IF({r("f_comp")}=1,({r("wA")}+{r("extra")}*360*{r("testRate")})/({r("wB")}+{r("extra")}*360),{r("testRate")})')
B("idx_w", "Rentekolom bij dit maximum", "", INT, lambda c, r, i, s: f'=MIN(12,MAX(1,ROUNDUP(ROUND({r("wavg")}*100,3)/0.5-0.000000001,0)-2))')
B("g_w", "Bruteringsfactor box 3 in die kolom", "", FAC, lambda c, r, i, s: f'=IF({r("ptl3")}>0,IF(AND({r("pactive")}=1,{r("comp_pen")}<{r("comp_inc")}),INDEX(T2_Tabel,{r("ipen")},{r("idx_w")})/INDEX(T4_Tabel,{r("ipen")},{r("idx_w")}),INDEX(T1_Tabel,{r("iinc")},{r("idx_w")})/INDEX(T3_Tabel,{r("iinc")},{r("idx_w")})),1)')
B("ptl_eff", "Toetslast meegenomen delen zoals getoetst (box 3 gebruteerd)", "€ p/m", EUR2, lambda c, r, i, s: f'={r("ptl1")}+{r("ptl3")}*{r("g_w")}')

BER.append(("§", "9. Haalbaarheid"))
B("lroom", "Ruimte onder plafond geldverstrekker", "€", EUR, lambda c, r, i, s: f'=MAX(0,{i("cap")}-{r("ported")})')
B("cap_door", "Maximaal nieuw te lenen (doorstromer)", "€", EUR, lambda c, r, i, s: f'=MIN({r("extra")},{r("lroom")})')
B("margin_door", "Ruimte of tekort (doorstromer)", "€", EUR, lambda c, r, i, s: f'={r("cap_door")}-{r("addl")}')
B("own_after", "Eigen geld na kosten koper (starter)", "€", EUR, lambda c, r, i, s: f'={i("own")}-{r("kk_cash")}')
B("cash_short", "Tekort aan eigen geld (starter)", "€", EUR, lambda c, r, i, s: f'=MAX(0,-{r("own_after")})')
B("req_s", "Benodigde hypotheek (starter)", "€", EUR, lambda c, r, i, s: f'=MAX(0,{i("price")}-MAX(0,{r("own_after")}))')
B("cap_s", "Maximale hypotheek (starter)", "€", EUR, lambda c, r, i, s: f'=MIN({r("inc_max")},{i("cap")})')
B("short_s", "Tekort (starter)", "€", EUR, lambda c, r, i, s: f'=MAX(0,{r("req_s")}-{r("cap_s")})+{r("cash_short")}')
B("out_maxtotal", "UITKOMST: maximale totale hypotheek", "€", EUR, lambda c, r, i, s: f'=IF({r("door")}=1,{r("ported")}+{r("cap_door")},{r("cap_s")})', True)
B("out_capnew", "UITKOMST: maximaal nieuw te lenen", "€", EUR, lambda c, r, i, s: f'=IF({r("door")}=1,{r("cap_door")},{r("cap_s")})', True)
B("out_needed", "UITKOMST: nieuw geld nodig voor deze woning", "€", EUR, lambda c, r, i, s: f'=IF({r("door")}=1,{r("addl")},{r("req_s")})', True)
B("out_margin", "UITKOMST: ruimte (+) of tekort (−)", "€", EUR, lambda c, r, i, s: f'={r("out_capnew")}-{r("out_needed")}', True)
B("out_short", "UITKOMST: tekort", "€", EUR, lambda c, r, i, s: f'=IF({r("door")}=1,MAX(0,-{r("margin_door")})+{r("kk_short")},{r("short_s")})', True)
B("out_feasible", "UITKOMST: haalbaar (1 = ja)", "", INT, lambda c, r, i, s: f'=IF({r("door")}=1,IF(AND({r("margin_door")}>=0,{r("kk_short")}<=0.005),1,0),IF({r("short_s")}<=0,1,0))', True)
B("budget_rest", "Overgebleven budget na woning en kosten koper (doorstromer)", "€", EUR, lambda c, r, i, s: f'=IF({r("door")}=1,{i("own")}+{r("overw")}+{r("ported")}+{r("cap_door")}-{r("tekort")}-{i("price")}-{r("kk_cash")},"n.v.t.")')

# ---- Solver (per kolom: twee blokken, tien rentekolommen)
for blk, ttl, prefix, prefix3, v_key, i_key, inc_key, bonus in [
    ("inc", "Blok A: inkomensscenario (tabel 1)", "T1", "T3", "vinc", "iinc", "inc_total", lambda r: f'{r("energy")}+{r("sb")}'),
    ("pen", "Blok B: pensioenscenario (tabel 2)", "T2", "T4", "vpen", "ipen", "pinc", lambda r: f'{r("energy")}+{r("psb")}'),
]:
    SOL.append(("§", ttl))
    S(f"{blk}_inc", "Toetsinkomen", "€", EUR, (lambda inc_key: lambda c, r, b: f'={b(inc_key)}')(inc_key))
    S(f"{blk}_bonus", "Bonussen buiten de woonlast (energie + alleenstaand)", "€", EUR, (lambda bonus: lambda c, r, b: f'={bonus(b)}')(bonus))
    for k in range(1, NCOL + 1):
        def wq_f(c, r, b, k=k, prefix=prefix, v_key=v_key, i_key=i_key):
            return "=" + interp(b(v_key), b(i_key), prefix, k)

        def wq3_f(c, r, b, k=k, prefix3=prefix3, i_key=i_key):
            return "=" + interp(None, b(i_key), prefix3, k)

        # Box 3-delen tellen mee met de bruteringsfactor woonquote ÷ box 3-woonquote van deze kolom.
        def xs_f(c, r, b, k=k, blk=blk):
            wq, wq3 = r(f"{blk}_wq{k}"), r(f"{blk}_wq3{k}")
            return (f'=MAX(0,({wq}*{r(f"{blk}_inc")}/12-{b("debt_month")}-{b("ptl1")}-{b("ptl3")}*{wq}/{wq3})*{b("fcap")}'
                    f'-{b("afslag")}+{r(f"{blk}_bonus")})')

        def lo_f(c, r, b, k=k, prefix=prefix):
            R, A, Bb = b("testRate"), b("wA"), b("wB")
            U = f"(INDEX({prefix}_Rente,{k})+0.000005)"
            L = f"(INDEX({prefix}_Rente,{max(1, k - 1)})+0.000005)"
            parts = ["0"]
            if k < NCOL:
                parts.append(f"IF({U}>{R},({A}-{U}*{Bb})/(360*({U}-{R})),IF({U}={R},IF({A}-{U}*{Bb}<=0,-1E+12,1E+12),-1E+12))")
            if k > 1:
                parts.append(f"IF({L}<{R},({A}-{L}*{Bb})/(360*({L}-{R})),IF({L}={R},IF({A}-{L}*{Bb}>0,-1E+12,1E+12),-1E+12))")
            return "=MAX(" + ",".join(parts) + ")"

        def hi_f(c, r, b, k=k, prefix=prefix):
            R, A, Bb = b("testRate"), b("wA"), b("wB")
            U = f"(INDEX({prefix}_Rente,{k})+0.000005)"
            L = f"(INDEX({prefix}_Rente,{max(1, k - 1)})+0.000005)"
            parts = ["1E+12"]
            if k < NCOL:
                parts.append(f"IF({U}<{R},({A}-{U}*{Bb})/(360*({U}-{R})),1E+12)")
            if k > 1:
                parts.append(f"IF({L}>{R},({A}-{L}*{Bb})/(360*({L}-{R})),1E+12)")
            return "=MIN(" + ",".join(parts) + ")"

        def amt_f(c, r, b, k=k, blk=blk):
            lo, hi, xs = r(f"{blk}_lo{k}"), r(f"{blk}_hi{k}"), r(f"{blk}_xs{k}")
            return f"=IF({lo}>{hi},-1,IF({xs}<{lo}-0.000000001,-1,IF({xs}>{hi},MAX({lo},{hi}-1),{xs})))"

        S(f"{blk}_wq{k}", f"Kolom {k}: woonquote", "%", PCT2, wq_f)
        S(f"{blk}_wq3{k}", f"Kolom {k}: woonquote box 3 (voor de bruteringsfactor)", "%", PCT2, wq3_f)
        S(f"{blk}_xs{k}", f"Kolom {k}: bedrag als de woonquote van deze kolom geldt", "€", EUR, xs_f)
        S(f"{blk}_lo{k}", f"Kolom {k}: laagste bedrag waarbij de gewogen rente in deze kolom valt", "€", EUR, lo_f)
        S(f"{blk}_hi{k}", f"Kolom {k}: hoogste bedrag waarbij de gewogen rente in deze kolom valt", "€", EUR, hi_f)
        S(f"{blk}_amt{k}", f"Kolom {k}: haalbaar bedrag (−1 = onmogelijk)", "€", EUR, amt_f)
    S(f"{blk}_comp", f"Resultaat blok: hoogste haalbare bedrag nieuw geld", "€", EUR,
      (lambda blk: lambda c, r, b: "=MAX(0," + ",".join(r(f"{blk}_amt{k}") for k in range(1, NCOL + 1)) + ")")(blk), True)
# sleutels met prefix 'inc_comp' / 'pen_comp' (zie Berekening rijen 'comp_inc'/'comp_pen')
SOL_KEYMAP = {"inc_comp": "inc_comp", "pen_comp": "pen_comp"}


def layout(ws, spec, title, subtitle, first_row=5):
    """Wijst rijnummers toe. Geeft dict key->rij."""
    rows = {}
    row = first_row
    for item in spec:
        if item[0] == "§":
            rows[("§", row)] = item[1]
        else:
            rows[item[0]] = row
        row += 1
    return rows


def build(ws, spec, rows, title, subtitle, ref_fn_factory):
    put(ws, "A1", title, f_title)
    put(ws, "A2", subtitle, f_sub)
    put(ws, "A4", "Stap", f_head, fill=fill_head)
    put(ws, "B4", "Eenheid", f_head, fill=fill_head)
    for i, c in enumerate(COLS):
        put(ws, f"{c}4", f"=Invoer!{c}4", f_head, INT, fill_head, Alignment(horizontal="center"))
    row = 5
    for item in spec:
        if item[0] == "§":
            put(ws, f"A{row}", item[1], f_bold, fill=fill_sec)
            for c in ["B"] + COLS:
                ws[f"{c}{row}"].fill = fill_sec
        else:
            key, label, unit, fmt, fn, bold = item
            put(ws, f"A{row}", label, f_bold if bold else f_norm)
            put(ws, f"B{row}", unit, f_note)
            for c in COLS:
                r, i, s, b = ref_fn_factory(c)
                formula = fn(c, r, i, s) if ws is ws_ber else fn(c, r, b)
                cell = put(ws, f"{c}{row}", formula, f_bold if bold else f_norm, fmt, fill_key if bold else None)
        row += 1
    set_widths(ws, {"A": 66, "B": 12, **{c: 16 for c in COLS}})
    ws.freeze_panes = "C5"


ber_rows = layout(ws_ber, BER, "", "")
sol_rows = layout(ws_sol, SOL, "", "")
BR = {k: v for k, v in ber_rows.items() if not isinstance(k, tuple)}
SR = {k: v for k, v in sol_rows.items() if not isinstance(k, tuple)}


def ber_refs(c):
    return (lambda k: f"{c}{BR[k]}", lambda k: f"Invoer!{c}{INV[k]}", lambda k: f"Solver!{c}{SR[k]}", None)


def sol_refs(c):
    return (lambda k: f"{c}{SR[k]}", None, None, lambda k: f"Berekening!{c}{BR[k]}")


build(ws_ber, BER, ber_rows, "Berekening",
      "Alle cellen zijn formules. Opbouw per scenariokolom; groen = sleutelresultaat. Rente-invoer staat als fractie (4,00% = 0,04).", ber_refs)
build(ws_sol, SOL, sol_rows, "Solver: samengestelde toets met gewogen toetsrente",
      "De woonquote hangt af van de gewogen toetsrente van alle leningdelen, en die beweegt mee met het nieuwe bedrag. Per rentekolom wordt het bereik van bedragen bepaald waarin die kolom geldt; het hoogste haalbare bedrag wint.", sol_refs)

# ================================================================ Controle
ws = ws_con
put(ws, "A1", "Controle: Excel-model tegen de app-engine", f_title)
put(ws, "A2", f"Excel = formules in dit werkboek (onafhankelijk opgebouwd). App = momentopname van de engine (src/calcEngine.js) voor dezelfde invoer. Scenario {N} is vrij: vul daar zelf de app-uitkomst in.", f_sub)
METRICS = [
    ("incomeTotal", "Totaal toetsinkomen", EUR, "inc_total"),
    ("testRate", "Toetsrente nieuwe hypotheek", PCT3, "testRate"),
    ("monthlyDebt", "Maandlast schulden (excl. studieschuld)", EUR2, "debt_month"),
    ("secondHomeToetslast", "Toetslast tweede woning", EUR2, "sh_tl"),
    ("studyDebetrente", "Debetrente studieschuld", PCT3, "debetrente"),
    ("studyFactor", "Opslagfactor studieschuld", FAC, "sfactor"),
    ("studyAfslag", "Afslag studieschuld", EUR, "afslag"),
    ("incomeBasedMax", "Maximale hypotheek o.b.v. inkomen", EUR, "inc_max"),
    ("currentDebt", "Restschuld bestaande hypotheek", EUR, "cur_debt"),
    ("extraBorrowCapacity", "Ruimte voor nieuw geld (inkomen)", EUR, "extra"),
    ("kostenKoper", "Kosten koper", EUR, "kk_total"),
    ("needed", "Nieuw geld nodig", EUR, "out_needed"),
    ("capacityNew", "Maximaal nieuw te lenen", EUR, "out_capnew"),
    ("margin", "Ruimte (+) of tekort (−)", EUR, "out_margin"),
    ("shortfall", "Tekort", EUR, "out_short"),
    ("feasible", "Haalbaar (1 = ja)", INT, "out_feasible"),
    ("maxTotal", "Maximale totale hypotheek", EUR, "out_maxtotal"),
    ("maxBudgetAfterCosts", "Overgebleven budget na woning en kosten koper", EUR, "budget_rest"),
    ("kostenKoperFinanced", "Meegefinancierde kosten koper", EUR, "kk_fin"),
    ("kostenKoperCashShortfall", "Kosten koper niet te financieren", EUR, "kk_short"),
]
put(ws, "A4", "Scenario", f_head, fill=fill_head)
put(ws, "B4", "", f_head, fill=fill_head)
for c in COLS:
    put(ws, f"{c}4", f"=Invoer!{c}4", f_head, INT, fill_head, Alignment(horizontal="center"))
put(ws, "A5", "Naam", f_bold)
for c in COLS:
    put(ws, f"{c}5", f"=Invoer!{c}{INV['name']}", f_link, align=Alignment(wrap_text=True, vertical="top"))
ws.row_dimensions[5].height = 42
put(ws, "A6", "Status", f_bold, fill=fill_key)
mat_top = {}
cur = 9
for mat, title in [("X", "Matrix 1: Excel-model"), ("A", "Matrix 2: app-engine (momentopname)"), ("D", "Matrix 3: verschil (Excel − app)")]:
    put(ws, f"A{cur-1}", title, f_bold, fill=fill_sec)
    for c in ["B"] + COLS:
        ws[f"{c}{cur-1}"].fill = fill_sec
    mat_top[mat] = cur
    for j, (key, label, fmt, bkey) in enumerate(METRICS):
        rr = cur + j
        put(ws, f"A{rr}", label)
        for i, c in enumerate(COLS):
            if mat == "X":
                put(ws, f"{c}{rr}", f"=Berekening!{c}{BR[bkey]}", f_link, fmt)
            elif mat == "A":
                if i < N_APP:
                    v = expected[i].get(key)
                    put(ws, f"{c}{rr}", "n.v.t." if v is None else v, f_input, fmt, fill_input, Alignment(horizontal="right"))
                else:
                    put(ws, f"{c}{rr}", None, f_input, fmt, fill_input)
            else:
                xr, ar = mat_top["X"] + j, mat_top["A"] + j
                put(ws, f"{c}{rr}", f'=IF(ISBLANK({c}{ar}),"",IF(AND(ISNUMBER({c}{ar}),ISNUMBER({c}{xr})),{c}{xr}-{c}{ar},IF(AND({c}{ar}="n.v.t.",{c}{xr}="n.v.t."),"n.v.t.","FOUT")))', f_norm, '#,##0.0000;(#,##0.0000);"-"', align=Alignment(horizontal="right"))
    cur += len(METRICS) + 3
d0, d1 = mat_top["D"], mat_top["D"] + len(METRICS) - 1
for c in COLS:
    rng = f"{c}{d0}:{c}{d1}"
    put(ws, f"{c}6", f'=IF(COUNT({c}{mat_top["A"]}:{c}{mat_top["A"]+len(METRICS)-1})=0,"geen app-waarden",IF(COUNTIF({rng},"FOUT")+COUNTIF({rng},">"&Tolerantie)+COUNTIF({rng},"<"&-Tolerantie)=0,"OK","AFWIJKING"))', f_bold, fill=fill_key, align=Alignment(horizontal="center"))
ws.conditional_formatting.add(f"{COLS[0]}{d0}:{LASTC}{d1}", FormulaRule(formula=[f'OR({COLS[0]}{d0}="FOUT",AND(ISNUMBER({COLS[0]}{d0}),ABS({COLS[0]}{d0})>Tolerantie))'], fill=PatternFill("solid", bgColor="FFC7CE"), font=Font(name=FONT, color="9C0006", bold=True)))
ws.conditional_formatting.add(f"{COLS[0]}6:{LASTC}6", CellIsRule(operator="equal", formula=['"OK"'], fill=PatternFill("solid", bgColor="C6EFCE"), font=Font(name=FONT, color="006100", bold=True)))
ws.conditional_formatting.add(f"{COLS[0]}6:{LASTC}6", CellIsRule(operator="equal", formula=['"AFWIJKING"'], fill=PatternFill("solid", bgColor="FFC7CE"), font=Font(name=FONT, color="9C0006", bold=True)))
set_widths(ws, {"A": 52, "B": 4, **{c: 17 for c in COLS}})
ws.freeze_panes = "C7"

# ================================================================ Samenvatting
ws = ws_sam
put(ws, "A1", "Samenvatting: wat kunt u lenen?", f_title)
put(ws, "A2", f"Kies een scenario (1 t/m {N}). Alle cijfers komen uit de berekening; scenario 1 is uw eigen dossier.", f_sub)
put(ws, "A4", "Gekozen scenario", f_bold)
put(ws, "C4", 1, f_input, INT, fill_input, Alignment(horizontal="center"), b_all)
dv = DataValidation(type="whole", operator="between", formula1="1", formula2=str(N), allow_blank=False)
ws.add_data_validation(dv)
dv.add("C4")


rngB = lambda key: f"Berekening!$C${BR[key]}:${LASTC}${BR[key]}"
SAM = [
    ("§", "Scenario"),
    ("name_", "Naam", f"=INDEX(Invoer!$C${INV['name']}:${LASTC}${INV['name']},$C$4)", TXT, False),
    ("type_", "Type", f'=IF(INDEX({rngB("door")},$C$4)=1,"Doorstromer","Starter")', TXT, False),
    ("§", "Opbouw van de leencapaciteit"),
    ("gross", "Leencapaciteit op inkomen (woonquote × inkomen, gekapitaliseerd)", None, EUR, False),
    ("d_debts", "− Schulden en tweede woning", None, EUR, False),
    ("d_study", "− Studieschuld", None, EUR, False),
    ("d_floor", "± Correctie (ondergrens € 0; normaal 0)", None, EUR, False),
    ("d_aow", "± AOW-toets (pensioeninkomen bindend)", None, EUR, False),
    ("d_energy", "+ Energielabelbonus", None, EUR, False),
    ("d_single", "+ Alleenstaandenbedrag", None, EUR, False),
    ("inc_max", "Maximale hypotheek o.b.v. inkomen (alles tegen de toetsrente)", None, EUR, True),
    ("d_ported", "− Toetslast meegenomen leningdelen (omgerekend in euro's)", None, EUR, False),
    ("d_mix", "± Woonquote bij gewogen toetsrente en overig (restpost)", None, EUR, False),
    ("extra", "Ruimte voor nieuw geld (inkomen)", None, EUR, True),
    ("d_lender", "− Plafond geldverstrekker (alleen als dat lager is)", None, EUR, False),
    ("out_capnew", "Maximaal nieuw te lenen", None, EUR, True),
    ("§", "Uitkomst"),
    ("out_maxtotal", "Maximale totale hypotheek", None, EUR, True),
    ("ported", "waarvan meegenomen (al geleend)", None, EUR, False),
    ("out_needed", "Nieuw geld nodig voor de aankoopprijs", None, EUR, True),
    ("out_margin", "Ruimte (+) of tekort (−)", None, EUR, True),
    ("haalbaar", "Haalbaar?", None, TXT, True),
    ("§", "Kerngetallen"),
    ("inc_total", "Totaal toetsinkomen", None, EUR, False),
    ("testRate", "Toetsrente nieuw geld", None, PCT3, False),
    ("wq", "Woonquote bij de toetsrente van het nieuwe geld", None, PCT2, False),
    ("wavg", "Gewogen toetsrente nieuwe hypotheek bij het maximum", None, PCT3, False),
    ("sfactor", "Opslagfactor studieschuld", None, FAC, False),
    ("kk_total", "Kosten koper", None, EUR, False),
    ("budget_rest", "Overgebleven budget na woning en kosten koper", None, EUR, False),
]
row = 6
SAM_ROWS = {}
sel = lambda key: f"INDEX({rngB(key)},$C$4)"
formulas = {
    "gross": f"={sel('gross')}",
    "d_debts": f"=-MIN({sel('debt_month')}*{sel('fcap')},{sel('gross')})",
    "d_study": f"=-MIN({sel('afslag')},{sel('after_debts')})",
    "d_floor": "=0",
    "d_aow": f"={sel('bound')}-{sel('after_study')}",
    "d_energy": f"={sel('energy')}",
    "d_single": f"={sel('sb')}",
    "inc_max": f"={sel('inc_max')}",
    "d_ported": f"=-IF({sel('f_comp')}=1,{sel('ptl_eff')}*{sel('fcap')},0)",
    "d_mix": None,  # restpost, later
    "extra": f"={sel('extra')}",
    "d_lender": None,
    "out_capnew": f"={sel('out_capnew')}",
    "out_maxtotal": f"={sel('out_maxtotal')}",
    "ported": f"={sel('ported')}",
    "out_needed": f"={sel('out_needed')}",
    "out_margin": f"={sel('out_margin')}",
    "haalbaar": f'=IF({sel("out_feasible")}=1,"Ja, deze woning past","Nee, deze woning past nog niet")',
    "inc_total": f"={sel('inc_total')}",
    "testRate": f"={sel('testRate')}",
    "wq": f"={sel('wq')}",
    "wavg": f"={sel('wavg')}",
    "sfactor": f"={sel('sfactor')}",
    "kk_total": f"={sel('kk_total')}",
    "budget_rest": f"={sel('budget_rest')}",
}
for item in SAM:
    if item[0] == "§":
        put(ws, f"A{row}", item[1], f_bold, fill=fill_sec)
        for c in "BC":
            ws[f"{c}{row}"].fill = fill_sec
        row += 1
        continue
    key, label, f, fmt, bold = item
    SAM_ROWS[key] = row
    put(ws, f"A{row}", label, f_bold if bold else f_norm)
    row += 1
# pas nu de formules in (restposten vereisen rijverwijzingen)
SR_ = SAM_ROWS
formulas["d_floor"] = (f"=C{SR_['inc_max']}-(C{SR_['gross']}+C{SR_['d_debts']}+C{SR_['d_study']}+C{SR_['d_aow']}"
                       f"+C{SR_['d_energy']}+C{SR_['d_single']})")
formulas["d_mix"] = f"=C{SR_['extra']}-(C{SR_['inc_max']}+C{SR_['d_ported']})"
formulas["d_lender"] = f"=C{SR_['out_capnew']}-C{SR_['extra']}"
for item in SAM:
    if item[0] == "§":
        continue
    key, label, f, fmt, bold = item
    formula = f if f else formulas[key]
    cell = put(ws, f"C{SR_[key]}", formula, f_bold if bold else f_norm, fmt, fill_key if bold else None, Alignment(horizontal="right"))
    if bold:
        cell.border = b_top
set_widths(ws, {"A": 72, "B": 3, "C": 32})
ws.freeze_panes = "A5"
ws.conditional_formatting.add(f"C{SR_['out_margin']}", CellIsRule(operator="lessThan", formula=["0"], font=Font(name=FONT, bold=True, color="9C0006")))
ws.conditional_formatting.add(f"C{SR_['out_margin']}", CellIsRule(operator="greaterThanOrEqual", formula=["0"], font=Font(name=FONT, bold=True, color="006100")))

# ================================================================ Leesmij
ws = ws_read
put(ws, "A1", "Hypotheek-toetsmodel 2026", f_title)
put(ws, "A2", "Onafhankelijk Excel-model van de leencapaciteitstoets (Nibud-woonquote, toetsrente, studieschuld, meenemen van bestaande leningdelen) om de hypotheekcalculator mee te controleren.", f_sub)
lines = [
    ("Doel", None),
    (f"Dit werkboek rekent dezelfde toets als de app, maar volledig met cel-formules. U voert een dossier in (Invoer, kolom C of {LASTC}), leest de uitkomst in Samenvatting en vergelijkt desgewenst met de app (Controle).", None),
    ("", None),
    ("Werkbladen", None),
    ("Samenvatting: opbouw van de leencapaciteit en de uitkomst voor het gekozen scenario (cel C4).", None),
    (f"Invoer: alle invoer per scenario. Gele cellen met blauwe tekst zijn invoer. Kolom C = uw dossier, D t/m {COLS[N_APP-1]} = testscenario's, {LASTC} = vrij testscenario.", None),
    ("Berekening: stap voor stap, alles formules. Groene vakken zijn sleutelresultaten.", None),
    ("Solver: bepaalt het hoogste bedrag nieuw geld bij meenemen, waarbij de woonquote meebeweegt met de gewogen toetsrente.", None),
    ("Tabellen: parameters en de woonquote-tabellen. Oranje kolommen zijn GESCHAT (zie hieronder) en kunnen worden overschreven.", None),
    ("Controle: Excel-uitkomst naast de uitkomst van de app-engine voor de testscenario's, met verschil en status.", None),
    ("Bronnen: wat is geverifieerd, wat niet, en hoe zeker.", None),
    ("", None),
    ("Kleurcode", None),
    ("Blauwe tekst op geel: invoer of vaste waarde die u mag wijzigen.   Zwarte tekst: formule.   Groene tekst: koppeling naar een ander blad.   Oranje vlak: geschatte tabelwaarde.", None),
    ("", None),
    ("Hoe rekent het model?", None),
    ("1. Woonquote × toetsinkomen ÷ 12 = maximale woonlast per maand. Woonquote uit de kolom van de toetsrente (per 0,5%) en de rij van het inkomen (per € 1.000, hier geïnterpoleerd tussen ankerpunten).", None),
    ("2. Schulden (tweede woning, overige schulden, familielening) gaan als maandlast van de woonlast af; de resterende woonlast wordt gekapitaliseerd met de annuïteitenfactor (360 maanden, toetsrente).", None),
    ("3. Studieschuld: DUO-maandbedrag × opslagfactor (afhankelijk van de debetrente van de hypotheek) wordt gekapitaliseerd en als bedrag in euro's van de hypotheek afgetrokken.", None),
    ("4. Energielabel en alleenstaandenbedrag (€ 17.000) komen er buiten de woonlasttoets bij. De AOW-toets (tabel 2, pensioeninkomen) geldt als het lager uitkomt.", None),
    ("5. Meenemen van de bestaande hypotheek: elk leningdeel krijgt een eigen toetslast (annuïtair; contractrente bij 10 jaar of langer rentevast, anders AFM-toetsrente; aflossingsvrij over 30 jaar). De woonquote volgt uit de gewogen toetsrente van alle delen samen, inclusief het nieuwe geld (blad Solver).", None),
    ("6. Financieringsgat = aankoopprijs − meegenomen hypotheek − bruikbare overwaarde; eigen geld (na kosten koper) dicht eerst het gat, de rest is nieuw geld. Dekt het eigen geld de kosten koper niet, dan worden die meegefinancierd binnen 100% van de woningwaarde (anders tekort). Haalbaar als dat past onder de ruimte en onder het plafond van de geldverstrekker.", None),
    ("", None),
    ("Beperkingen (bewust niet in dit model)", None),
    ("Toetsinkomen opbouwen uit flex/ZZP/bonus: voer het uiteindelijke toetsinkomen in. NHG-provisie, familielening als bedrag, overbruggingskrediet, eigen-inleg-limiet, opbrengst tweede woning, verduurzaming boven 100% LTV, erfpacht en de studieschuld per lening (hier één totaal maandbedrag) zijn niet gemodelleerd.", None),
    ("", None),
    ("Waarschuwing over de tabelwaarden", None),
    ("De woonquote-kolommen 2,0 / 2,5 / 3,5 / 4,5 / 5,5% staan niet in de bron van de app en zijn lineair geschat tussen de buurkolommen. Onafhankelijke datapunten kloppen binnen 0,1 procentpunt (zie Bronnen), maar controleer ze in Bijlage 1 van de Tijdelijke regeling hypothecair krediet 2026 en overschrijf de oranje cellen. Een gewogen toetsrente die in zo'n kolom valt (zoals in scenario 1: 3,445%) hangt direct van die schatting af.", None),
    ("Indicatief; geen bindend advies. Peildatum scenario's: 8 oktober 2026.", None),
]
r = 4
for text, _ in lines:
    is_head = text in ("Doel", "Werkbladen", "Kleurcode", "Hoe rekent het model?", "Beperkingen (bewust niet in dit model)", "Waarschuwing over de tabelwaarden")
    put(ws, f"A{r}", text, f_bold if is_head else f_norm, align=Alignment(wrap_text=True, vertical="top"), fill=fill_sec if is_head else None)
    r += 1
set_widths(ws, {"A": 150})
for rr in range(4, r):
    txt = ws[f"A{rr}"].value or ""
    ws.row_dimensions[rr].height = 14 * max(1, -(-len(txt) // 150))

# ================================================================ Bronnen
ws = ws_bro
put(ws, "A1", "Bronnen en feitencontrole", f_title)
put(ws, "A2", "Status per cijfer of regel. Controle uitgevoerd op 12 oktober 2026 via zoekopdrachten; de officiële sites (officielebekendmakingen.nl, wetten.overheid.nl, nhg.nl) waren niet direct bereikbaar.", f_sub)
heads = ["Onderdeel", "Waarde in model", "Status", "Bron / opmerking"]
for j, h in enumerate(heads):
    put(ws, f"{CL(1+j)}4", h, f_head, fill=fill_head)
facts = [
    ("AFM-toetsrente", "5,00%", "Geverifieerd (t/m Q3)", "AFM: Q1 en Q2 2026 5%; Q3 5% (HomeFinance). Q4 2026 niet gevonden: controleer afm.nl."),
    ("Toets: annuïtair over 30 jaar, ongeacht aflosvorm", "360 mnd", "Geverifieerd", "Tijdelijke regeling hypothecair krediet art. 3 (tekst per 1-1-2026, inview.nl)."),
    ("Aflossingsvrij deel altijd 30 jaar toetsen", "360 mnd", "Geverifieerd (NHG)", "NHG Beschrijving berekeningen NHG-Toets: voor aflossingsvrij altijd 30 jaar."),
    ("Gewogen toetsrente over leningdelen", "Σ(saldo × looptijd × rente) / Σ(saldo × looptijd)", "Geverifieerd (NHG)", "NHG-toets: K × L × R / K × L; geldt als toetsrente voor de woonquote."),
    ("Bestaand leningdeel < 10 jaar rentevast", "AFM-toetsrente", "Geverifieerd", "Regeling: rentevast < 10 jaar, dan hoogste van toetsrente en werkelijke rente. Verlopen/variabel telt als < 10 jaar."),
    ("Woonquote tabel 1, kolommen 1,5 / 3,0 / 4,0 / 5,0 / 6,0%", "Zie Tabellen", "Gedeeltelijk geverifieerd", "Uit app-code (Stcrt. 2025, 36471), niet opnieuw ingezien. Datapunten consistent: € 70.000 → 23,6% (4%); SEH: modaal € 46.500 bij 5% → 24,6%."),
    ("Woonquote, kolommen 2,0 / 2,5 / 3,5 / 4,5 / 5,5%", "Lineair geschat", "NIET geverifieerd", "Check: Hypotheker.nl 19,3% (≤ € 30.000), 25,1% (€ 98-100.000), 25,8% (€ 109-111.000) liggen binnen 0,1 punt van de geschatte 3,5%-kolom (19,25% / 25,15% / 25,75%)."),
    ("Afronding woonquote", "0,1 procentpunt sinds 2026", "Geverifieerd", "Nibud Advies hypotheeknormen 2026 (was 0,5)."),
    ("Alleenstaandenbedrag", "€ 17.000", "Bedrag geverifieerd", "Nibud advies 2026."),
    ("Minimuminkomen alleenstaandenbedrag", "€ 30.000 (AOW € 29.000)", "Bronnen verschillen", "Hypotheker.nl noemt € 28.000; HomeFinance en CalcForLife € 30.000."),
    ("Energielabel extra leenruimte", "D/C 5.000; B/A 10.000; A+/A++ 20.000; A+++ 25.000; A++++ 30.000", "Geverifieerd", "Meerdere bronnen consistent (Adfiz, Homeloan, LWM). A++++ met 10-jaars garantie: € 40.000."),
    ("Studieschuld: toetslast = maandbedrag × opslagfactor", "Zie Tabellen C", "Methode geverifieerd, tabel NIET", "Sinds 2024 werkelijk maandbedrag. Factortabel komt uit de opdracht; bronnen wijken af (ikbenfrits: 1,05 t/m 2%, 1,20 voor 3,01-4%, 1,40 vanaf 6,01%)."),
    ("Overige schulden", "2% van het kredietbedrag per maand", "Vereenvoudiging", "Gangbaar; lagere vaste maandlast uit contract mag. Alle leningen tellen mee, niet alleen BKR."),
    ("Overdrachtsbelasting 2026", "2% eigen woning, 8% overig, 0% starter ≤ € 555.000", "Geverifieerd", "ERA, Eshuis, Homeloan, JAN: grens € 555.000, leeftijd 18 t/m 34, 8% voor niet-hoofdverblijf."),
    ("Hypotheekrenteaftrek 2026", "35,75% eerste schijf, max. 37,56%, grens € 38.883", "Geverifieerd; app gecorrigeerd", "De app gebruikte 35,70%; dit is 35,75% (Belastingdienst-schijven 2026 via Raisin, MKB Servicedesk e.a.)."),
    ("Eigenwoningforfait", "0,35% tot € 1.350.000, 2,35% erboven", "Bron wijkt licht af", "ABN AMRO Financial Focus: € 1.350.000; één bron € 1.340.000."),
    ("NHG", "Kostengrens € 470.000 (€ 498.200 met verduurzaming), provisie 0,4%", "Geverifieerd, nog niet in app", "Brief kabinet 8-10-2025 via banken.nl; Tweede Kamer."),
    ("AOW-leeftijd", "67 jaar in 2026; trigger 57 jaar", "Vereenvoudiging", "Vanaf 2028 67 jaar en 3 maanden; trigger op geheel jaar."),
]
for i, rowv in enumerate(facts):
    rr = 5 + i
    for j, v in enumerate(rowv):
        c = put(ws, f"{CL(1+j)}{rr}", v, f_norm, align=Alignment(wrap_text=True, vertical="top"), border=b_all)
    st = rowv[2]
    color = "C6EFCE" if st.startswith("Geverifieerd") else ("FFC7CE" if "NIET" in st else "FFEB9C")
    ws[f"C{rr}"].fill = PatternFill("solid", fgColor=color)
set_widths(ws, {"A": 46, "B": 44, "C": 28, "D": 96})
ws.freeze_panes = "A5"

# ---- afdrukinstellingen / tab-kleuren
for w, color in [(ws_read, "1F3864"), (ws_sam, "70AD47"), (ws_inv, "FFC000"), (ws_ber, "4472C4"), (ws_sol, "4472C4"), (ws_tab, "ED7D31"), (ws_con, "C00000"), (ws_bro, "7F7F7F")]:
    w.sheet_properties.tabColor = color
    w.sheet_view.showGridLines = False
    w.page_setup.orientation = "landscape"
    w.page_setup.fitToWidth = 1
    w.page_setup.fitToHeight = 0
    w.sheet_properties.pageSetUpPr = PageSetupProperties(fitToPage=True)

wb.save(OUT)
json.dump({"BR": BR, "SR": SR, "INV": INV, "COLS": COLS, "METRICS": [(m[0], m[3]) for m in METRICS],
           "mat_top": mat_top, "SAM": SAM_ROWS}, open(OUT.with_suffix(".layout.json") if len(sys.argv) > 3 else HERE / "layout.json", "w"))
print("geschreven:", OUT)
