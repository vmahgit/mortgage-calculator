// Nibud-financieringslastsystematiek 2026 (echte tabel).
//
// Bron: Wijzigingsregeling hypothecair krediet 2026, Staatscourant 2025, 36471
// (Tabel 1 — financieringslastpercentages voor personen jonger dan de AOW-leeftijd).
// https://zoek.officielebekendmakingen.nl/stcrt-2025-36471.html
//
// Dit vervangt de eerdere, handmatig getunede leenfactor door de daadwerkelijke
// methodiek die geldverstrekkers en adviseurs gebruiken:
//   1. Zoek de woonquote (financieringslastpercentage) op bij (toetsinkomen, toetsrente).
//   2. Maximale bruto woonlast per maand = woonquote × toetsinkomen / 12.
//   3. Trek de maandlast van bestaande verplichtingen (schulden) af.
//   4. Kapitaliseer de resterende maandlast met de annuïteitenfactor bij de toetsrente
//      over 360 maanden → maximale hypotheek.
//
// De inkomens-ankerpunten en vijf toetsrente-kolommen hieronder zijn letterlijk uit de
// officiële tabel overgenomen; tussenliggende inkomens en rentes worden bilineair
// geïnterpoleerd. De officiële tabel loopt per €1.000 en per 0,5%-band; deze ankerset is
// een getrouwe, controleerbare weergave daarvan (geen benadering van de systematiek zelf).

const TERM_MONTHS = 360;

// Inkomens-ankerpunten (bruto toetsinkomen in euro).
const INCOME_ANCHORS = [30000, 35000, 40000, 45000, 50000, 60000, 70000, 80000, 90000, 100000, 110000, 125000];

// Toetsrente-ankerpunten (%). Elk representeert de bijbehorende 0,5%-band uit de tabel:
// 1,5 = ≤1,500%; 3,0 = 2,501–3,000%; 4,0 = 3,501–4,000%; 5,0 = 4,501–5,000%;
// 6,0 = 5,501–6,000%.
const RATE_ANCHORS = [1.5, 3.0, 4.0, 5.0, 6.0];

// Woonquotes (%) per toetsrente-anker × inkomens-anker, exact uit Tabel 1 (2026).
const WOONQUOTE_TABLE = {
  1.5: [15.5, 17.4, 17.4, 17.4, 17.4, 17.7, 18.6, 19.9, 20.5, 21.1, 21.6, 22.2],
  3.0: [18.4, 20.6, 20.6, 20.6, 20.6, 20.7, 21.7, 23.2, 23.7, 24.2, 24.8, 25.5],
  4.0: [20.1, 22.6, 22.6, 22.6, 22.6, 22.6, 23.6, 25.3, 25.7, 26.1, 26.7, 27.4],
  5.0: [21.6, 24.6, 24.6, 24.6, 24.6, 24.6, 25.3, 27.2, 28.5, 28.5, 28.5, 29.2],
  6.0: [22.7, 26.4, 26.4, 26.4, 26.4, 26.4, 27.0, 28.9, 29.3, 29.7, 30.0, 30.8],
};

// Tabel 2 — financieringslastpercentages voor consumenten die de AOW-leeftijd al
// hebben bereikt (zelfde Stcrt. 2025, 36471). Gebruikt voor het pensioenscenario van
// de AOW-toets: wie binnen 10 jaar de AOW-leeftijd bereikt, wordt óók getoetst op het
// verwachte pensioeninkomen, en die toekomstige situatie valt onder deze tabel.
// De tabel start bij €29.000 (verwachte bruto AOW-uitkering per januari 2026) en
// loopt tot €110.000; daarbuiten geldt de dichtstbijzijnde rand (clamp), zoals ook
// bij Tabel 1. De AOW-quotes liggen hoger dan die van Tabel 1 omdat gepensioneerden
// lagere belasting- en premiedruk hebben.
const AOW_INCOME_ANCHORS = [29000, 30000, 35000, 40000, 45000, 50000, 60000, 70000, 80000, 90000, 100000, 110000];

const AOW_WOONQUOTE_TABLE = {
  1.5: [18.5, 19.2, 21.6, 22.2, 22.8, 23.4, 25.5, 26.2, 27.1, 27.7, 28.0, 28.4],
  3.0: [19.7, 20.8, 23.9, 25.2, 25.9, 26.7, 29.9, 31.3, 31.7, 32.1, 32.3, 32.5],
  4.0: [20.4, 21.5, 25.1, 26.9, 27.7, 28.6, 32.1, 34.3, 34.8, 34.8, 34.9, 35.1],
  5.0: [20.9, 22.1, 26.1, 28.2, 29.4, 30.2, 34.1, 36.9, 37.3, 37.3, 37.3, 37.5],
  6.0: [21.3, 22.5, 26.9, 29.3, 30.8, 31.7, 35.7, 38.9, 39.5, 39.5, 39.5, 39.6],
};

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

// Lineaire interpolatie tussen twee ankerreeksen op een gegeven positie.
function interpolate(anchors, values, x) {
  const xc = clamp(x, anchors[0], anchors[anchors.length - 1]);
  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i];
    const b = anchors[i + 1];
    if (xc >= a && xc <= b) {
      const t = b === a ? 0 : (xc - a) / (b - a);
      return values[i] + t * (values[i + 1] - values[i]);
    }
  }
  return values[values.length - 1];
}

// Woonquote (als fractie, bijv. 0,274) bij een gegeven toetsinkomen en toetsrente.
// Bilineaire interpolatie: eerst per rente-kolom over inkomen, dan tussen de twee
// omliggende rente-kolommen. Inkomen boven de hoogste schijf gebruikt de hoogste
// woonquote (zoals gebruikelijk bij deze tabel). Met { aow: true } wordt Tabel 2
// (vanaf AOW-leeftijd) gebruikt in plaats van Tabel 1.
export function getWoonquote(toetsinkomen, toetsrente, { aow = false } = {}) {
  const rate = clamp(toetsrente, RATE_ANCHORS[0], RATE_ANCHORS[RATE_ANCHORS.length - 1]);
  const anchors = aow ? AOW_INCOME_ANCHORS : INCOME_ANCHORS;
  const table = aow ? AOW_WOONQUOTE_TABLE : WOONQUOTE_TABLE;

  // Woonquote per rente-anker, op het gevraagde inkomen.
  const perRate = RATE_ANCHORS.map((r) => interpolate(anchors, table[r], toetsinkomen));

  // Interpoleer tussen de rente-ankers.
  const pct = interpolate(RATE_ANCHORS, perRate, rate);
  return pct / 100;
}

// Annuïteitenfactor bij een gegeven (toets)rente over 360 maanden: het bedrag aan
// hypotheek dat één euro maandlast kan dragen.
export function getAnnuityFactor(ratePct) {
  const r = ratePct / 100 / 12;
  if (r === 0) return TERM_MONTHS;
  return (1 - Math.pow(1 + r, -TERM_MONTHS)) / r;
}

// Kern: maximale hypotheek op basis van inkomen volgens de Nibud-woonquote-systematiek.
// - combinedIncome: totaal bruto toetsinkomen.
// - toetsrente: de te toetsen rente (AFM-toetsrente bij rentevast < 10 jaar, anders de
//   werkelijke rente).
// - monthlyDebtObligations: maandlast van bestaande schulden (overige schulden, studie).
// - options.aow: true voor het scenario vanaf AOW-leeftijd (Tabel 2 in plaats van Tabel 1).
export function getIncomeBasedMortgage(
  combinedIncome,
  toetsrente,
  monthlyDebtObligations = 0,
  { aow = false } = {}
) {
  const income = Math.max(0, combinedIncome);
  const woonquote = getWoonquote(income, toetsrente, { aow });
  const maxWoonlastMonthly = (woonquote * income) / 12;
  const availableMonthly = Math.max(0, maxWoonlastMonthly - Math.max(0, monthlyDebtObligations));
  const annuityFactor = getAnnuityFactor(toetsrente);
  const maxLoan = availableMonthly * annuityFactor;
  return {
    woonquote,
    maxWoonlastMonthly,
    availableMonthly,
    annuityFactor,
    maxLoan,
  };
}
