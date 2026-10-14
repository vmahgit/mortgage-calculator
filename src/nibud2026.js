// Financieringslastpercentages ("woonquotes") 2026: exacte opzoeking in de officiële tabellen.
//
// Bron: Wijzigingsregeling hypothecair krediet 2026, Stcrt. 2025, 36471, Bijlage 1 bij de
// Tijdelijke regeling hypothecair krediet (de tabellen zelf staan in nibudTables2026.js).
// https://zoek.officielebekendmakingen.nl/stcrt-2025-36471.html
//
// Zo zoekt een geldverstrekker het percentage op:
//   - rij: het toetsinkomen, naar beneden afgerond op € 1.000. Onder de eerste rij (€ 30.000;
//     AOW-tabellen € 29.000) geldt de eerste rij, boven de laatste rij (€ 125.000; AOW-tabellen
//     € 110.000) de laatste rij;
//   - kolom: de toetsrente in banden van 0,5%-punt (≤ 1,500% | 1,501–2,000% | … | 6,001–6,500% |
//     ≥ 6,501%), op drie decimalen afgerond.
// Er wordt niet geïnterpoleerd, niet tussen rijen en niet tussen kolommen.
//
// Tabel 1: jonger dan de AOW-leeftijd. Tabel 2: AOW-leeftijd bereikt. Tabel 3 en 4: dezelfde, voor
// leningdelen waarvan de rente niet aftrekbaar is (box 3). Bij een gemengde hypotheek telt de
// toetslast van een box 3-deel zwaarder mee met de bruteringsfactor Tabel 1 ÷ Tabel 3 (zie
// getBox3GrossUp en calcEngine.js).

import { TABEL_1, TABEL_2, TABEL_3, TABEL_4 } from './nibudTables2026';

const TERM_MONTHS = 360;
const BAND_WIDTH = 0.5;
const FIRST_UPPER = 1.5;
const LAST_UPPER = 6.5; // de laatste kolom loopt vanaf 6,501% door (≥ 6,501%)

export const TABLE_NAMES = { box1: 'Tabel 1', box1Aow: 'Tabel 2', box3: 'Tabel 3', box3Aow: 'Tabel 4' };

function pickTable({ aow = false, box3 = false } = {}) {
  if (box3) return aow ? TABEL_4 : TABEL_3;
  return aow ? TABEL_2 : TABEL_1;
}

export function getTableName({ aow = false, box3 = false } = {}) {
  return TABLE_NAMES[`${box3 ? 'box3' : 'box1'}${aow ? 'Aow' : ''}`];
}

// Kolom van de toetsrente. upper = bovengrens van de band (1,5 … 6,5; de laatste kolom ≥ 6,501%
// heeft upper Infinity), lower = ondergrens (null voor de eerste kolom), index = 0 … 11.
// Alle kolommen staan in de officiële tabel (exact: true).
export function getToetsrenteBand(toetsrente) {
  // De tabel rekent met drie decimalen (3,501%); afronden voorkomt dat 3,5000000001 in de
  // volgende kolom valt.
  const r = Math.round(Math.max(0, toetsrente) * 1000) / 1000;
  const index = r <= FIRST_UPPER ? 0 : Math.min(11, Math.ceil((r - FIRST_UPPER) / BAND_WIDTH - 1e-9));
  const upper = index === 11 ? Infinity : FIRST_UPPER + index * BAND_WIDTH;
  const lower = index === 0 ? null : FIRST_UPPER + (index - 1) * BAND_WIDTH + 0.001;
  return { index, upper, lower, exact: true, aboveTable: false };
}

// Kolomgrenzen (bovengrenzen) waarboven de volgende kolom geldt, voor de solver.
export const BAND_UPPERS = Array.from({ length: 11 }, (_, i) => FIRST_UPPER + i * BAND_WIDTH);
export { LAST_UPPER };

// Rij van de tabel: het toetsinkomen naar beneden afgerond op € 1.000, begrensd op de tabel.
export function getIncomeRow(toetsinkomen, { aow = false, box3 = false } = {}) {
  const table = pickTable({ aow, box3 });
  const floored = Math.floor(Math.max(0, toetsinkomen) / 1000) * 1000;
  return Math.min(table.lastIncome, Math.max(table.firstIncome, floored));
}

// Woonquote (als fractie, bijv. 0,274) bij een gegeven toetsinkomen en toetsrente.
// { aow } kiest Tabel 2 i.p.v. 1, { box3 } de tabel voor niet-aftrekbare leningdelen.
export function getWoonquote(toetsinkomen, toetsrente, { aow = false, box3 = false } = {}) {
  const table = pickTable({ aow, box3 });
  const row = getIncomeRow(toetsinkomen, { aow, box3 });
  const { index } = getToetsrenteBand(toetsrente);
  return table.rows[(row - table.firstIncome) / 1000][index] / 100;
}

// Bruteringsfactor voor een box 3-leningdeel: percentage Tabel 1 (of 2) ÷ Tabel 3 (of 4) in
// dezelfde rij en kolom. De toetslast van zo'n deel telt met deze factor mee, zodat het deel
// effectief tegen het lagere box 3-percentage wordt getoetst.
export function getBox3GrossUp(toetsinkomen, toetsrente, { aow = false } = {}) {
  return getWoonquote(toetsinkomen, toetsrente, { aow }) / getWoonquote(toetsinkomen, toetsrente, { aow, box3: true });
}

// Annuïteitenfactor bij een gegeven (toets)rente over 360 maanden: het bedrag aan
// hypotheek dat één euro maandlast kan dragen.
export function getAnnuityFactor(ratePct) {
  const r = ratePct / 100 / 12;
  if (r === 0) return TERM_MONTHS;
  return (1 - Math.pow(1 + r, -TERM_MONTHS)) / r;
}

// Kern: maximale hypotheek op basis van inkomen voor één nieuw annuïtair leningdeel.
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
