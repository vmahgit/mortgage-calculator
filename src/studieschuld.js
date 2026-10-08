// Studieschuld (DUO) in de leencapaciteitsberekening.
//
// Bron: Tijdelijke regeling hypothecair krediet, art. 3a (Wijzigingsregeling 2025; de
// opslagfactor-tabel is ongewijzigd in 2026). De tabel hieronder is overgenomen uit de
// opdrachtspecificatie en niet afzonderlijk tegen de Staatscourant gecontroleerd.
//
// Rekenwijze:
//   1. Toetslast per lening = termijnbedrag × opslagfactor.
//   2. Termijnbedrag = het werkelijke DUO-maandbedrag (rente + aflossing). Alleen bij een
//      aanloopfase, aflosvrije periode of draagkrachtverlaging, of als het werkelijke bedrag
//      niet bekend is, wordt het berekend als annuïteit op de actuele restschuld, rente en
//      resterende looptijd.
//   3. DUO-maandrente = (1 + jaarrente)^(1/12) − 1 (effectief, niet jaarrente/12); bij 0%
//      rente is het termijnbedrag restschuld / maanden.
//   4. Opslagfactor volgt uit de debetrente van de hypotheek (drie decimalen, inclusieve
//      grenzen), zie `factorTable`.
//   5. Afslag op de maximale hypotheek (in euro) = toetslast / annuïteitfactor(rente, 360),
//      waarbij de annuïteitfactor hier het maandbedrag per geleende euro is: r / (1 − (1+r)^−n)
//      met r = jaarrente / 12 (nominaal, zoals bij hypotheken gebruikelijk).
//
// Let op de naamgeving: `nibud2026.js` noemt de kapitalisatiefactor (1 − (1+r)^−n) / r
// "annuityFactor"; in deze module heet het omgekeerde, het maandbedrag per euro,
// `paymentFactor`. Delen door de paymentFactor is hetzelfde als vermenigvuldigen met de
// kapitalisatiefactor.

const MORTGAGE_TERM_MONTHS = 360;

// Opslagfactor per debetrente-klasse: `upTo` is de inclusieve bovengrens (in %, drie
// decimalen); de laatste klasse heeft geen bovengrens.
const FACTOR_TABLE_2025 = [
  { upTo: 1.5, factor: 1.05 },
  { upTo: 2.0, factor: 1.1 },
  { upTo: 2.5, factor: 1.15 },
  { upTo: 3.0, factor: 1.2 },
  { upTo: 3.5, factor: 1.2 },
  { upTo: 4.0, factor: 1.25 },
  { upTo: 4.5, factor: 1.3 },
  { upTo: 5.0, factor: 1.3 },
  { upTo: 5.5, factor: 1.35 },
  { upTo: 6.0, factor: 1.4 },
  { upTo: 6.5, factor: 1.4 },
  { upTo: Infinity, factor: 1.45 },
];

// Configuratie per kalenderjaar. Nieuwe jaren worden hier toegevoegd; een jaar zonder eigen
// regel valt terug op het laatst bekende eerdere jaar.
export const STUDY_DEBT_CONFIG_BY_YEAR = {
  2025: { factorTable: FACTOR_TABLE_2025, afmToetsrente: 5.0 },
  2026: { factorTable: FACTOR_TABLE_2025, afmToetsrente: 5.0 },
};

export function getStudyDebtConfig(year) {
  const years = Object.keys(STUDY_DEBT_CONFIG_BY_YEAR)
    .map(Number)
    .sort((a, b) => a - b);
  const applicable = years.filter((y) => y <= year);
  const chosen = applicable.length > 0 ? applicable[applicable.length - 1] : years[0];
  return { year: chosen, ...STUDY_DEBT_CONFIG_BY_YEAR[chosen] };
}

export const STUDY_LOAN_STATUSES = {
  regulier: 'Regulier',
  aanloopfase: 'Aanloopfase',
  aflosvrij: 'Aflosvrije periode',
  draagkracht: 'Verlaagd (draagkracht)',
};

export const DEBETRENTE_MODES = {
  gewogenToets: 'Gewogen toetsrente',
  contract: 'Gewogen contractrente',
};

export const AFSLAG_METHODS = {
  marginaal: 'Marginaal (rente nieuwe geldlening)',
  gewogen: 'Gewogen toetsrente',
};

function num(value) {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

// Effectieve maandrente van DUO uit de jaarrente in procenten.
export function getDuoMonthlyRate(annualRatePct) {
  return Math.pow(1 + num(annualRatePct) / 100, 1 / 12) - 1;
}

// Maandbedrag van een annuïteit op `balance` over `months` maanden tegen de DUO-maandrente.
// Onbruikbare invoer (geen restschuld of geen resterende looptijd) geeft 0, nooit NaN/Infinity.
export function getAnnuityTermijn(balance, annualRatePct, months) {
  const B = num(balance);
  const n = Math.floor(num(months));
  if (B <= 0 || n <= 0) return 0;
  const r = getDuoMonthlyRate(annualRatePct);
  if (r <= 0) return B / n;
  return (B * r) / (1 - Math.pow(1 + r, -n));
}

// Termijnbedrag van één studielening. Retourneert ook waar het bedrag vandaan komt.
export function getStudyLoanTermijn(loan) {
  const balance = num(loan.balance);
  const months = Math.floor(num(loan.remainingMonths));
  const status = loan.status || 'regulier';
  const actual = num(loan.monthlyPayment);

  if (balance <= 0) return { termijn: 0, source: 'geen', warning: null };
  if (months <= 0) {
    return { termijn: 0, source: 'geen', warning: 'Resterende looptijd is 0: vul de resterende maanden in.' };
  }
  if (status === 'regulier' && actual > 0) {
    return { termijn: actual, source: 'duo', warning: null };
  }
  const termijn = getAnnuityTermijn(balance, loan.ratePct, months);
  return {
    termijn,
    source: status === 'regulier' ? 'schatting' : 'annuiteit',
    warning: null,
  };
}

// Opslagfactor bij een debetrente (in %). De rente wordt eerst op drie decimalen afgerond.
export function getOpslagfactor(debetrentePct, config) {
  const rounded = Math.round(num(debetrentePct) * 1000) / 1000;
  const row = config.factorTable.find((r) => rounded <= r.upTo);
  return row ? row.factor : config.factorTable[config.factorTable.length - 1].factor;
}

// Toetsrente van één leningdeel: bij minder dan 10 jaar resterende rentevaste periode geldt
// de AFM-toetsrente, tenzij de contractrente al hoger ligt.
export function getPartToetsrente(ratePct, remainingFixedYears, afmToetsrente) {
  const rate = num(ratePct);
  const years = num(remainingFixedYears);
  return years < 10 ? Math.max(rate, afmToetsrente) : rate;
}

// Gewogen debetrente over de leningdelen (gewicht = hoofdsom). Een overbruggingskrediet hoort
// hier niet bij; de aanroeper geeft alleen de leningdelen van de hypotheek mee.
// parts: [{ balance, ratePct, remainingFixedYears }]
export function getWeightedDebetrente(parts, { afmToetsrente }) {
  let total = 0;
  let toetsSum = 0;
  let contractSum = 0;
  for (const part of parts) {
    const w = Math.max(0, num(part.balance));
    if (w === 0) continue;
    total += w;
    toetsSum += w * getPartToetsrente(part.ratePct, part.remainingFixedYears, afmToetsrente);
    contractSum += w * num(part.ratePct);
  }
  if (total === 0) return { weightedToets: 0, weightedContract: 0, totalBalance: 0 };
  return {
    weightedToets: toetsSum / total,
    weightedContract: contractSum / total,
    totalBalance: total,
  };
}

// Maandbedrag per geleende euro bij een hypotheek (nominale maandrente, `months` maanden).
export function getPaymentFactor(annualRatePct, months = MORTGAGE_TERM_MONTHS) {
  const r = num(annualRatePct) / 100 / 12;
  if (r <= 0) return 1 / months;
  return r / (1 - Math.pow(1 + r, -months));
}

// Afslag op de maximale hypotheek (euro) voor een maandelijkse toetslast.
export function getAfslag(toetslastMonthly, annualRatePct, months = MORTGAGE_TERM_MONTHS) {
  const paymentFactor = getPaymentFactor(annualRatePct, months);
  return paymentFactor > 0 ? num(toetslastMonthly) / paymentFactor : 0;
}

// Volledige studieschuld-berekening voor een set leningen.
// input: {
//   loans,                         // leningen die meetellen (al op eigenaar gefilterd)
//   weightedToets, weightedContract, // gewogen debetrente's van de hypotheek (in %)
//   debetrenteMode,                // 'gewogenToets' | 'contract'
//   afslagMethod,                  // 'marginaal' | 'gewogen'
//   marginalRatePct,               // toetsrente van de nieuwe geldlening
//   year,                          // kalenderjaar van de regeling
// }
export function computeStudyDebt({
  loans,
  weightedToets,
  weightedContract,
  debetrenteMode = 'gewogenToets',
  afslagMethod = 'marginaal',
  marginalRatePct,
  year,
}) {
  const config = getStudyDebtConfig(year);
  const debetrente = debetrenteMode === 'contract' ? weightedContract : weightedToets;
  const factor = getOpslagfactor(debetrente, config);
  const afslagRatePct = afslagMethod === 'gewogen' ? weightedToets : marginalRatePct;
  const paymentFactor = getPaymentFactor(afslagRatePct);

  const perLoan = loans.map((loan) => {
    const { termijn, source, warning } = getStudyLoanTermijn(loan);
    const toetslast = termijn * factor;
    return {
      id: loan.id,
      owner: loan.owner,
      balance: Math.max(0, num(loan.balance)),
      termijn,
      termijnSource: source,
      warning,
      factor,
      toetslast,
      afslag: paymentFactor > 0 ? toetslast / paymentFactor : 0,
    };
  });

  const sum = (key) => perLoan.reduce((s, l) => s + l[key], 0);
  return {
    year: config.year,
    debetrenteMode,
    debetrente,
    weightedToets,
    weightedContract,
    factor,
    afslagMethod,
    afslagRatePct,
    paymentFactor,
    perLoan,
    totalBalance: sum('balance'),
    totalTermijn: sum('termijn'),
    totalToetslast: sum('toetslast'),
    totalAfslag: sum('afslag'),
  };
}

// Aflos-optimalisatie: verdeel een aflosbudget over de leningen zodat de extra leenruimte
// maximaal is. Aflossing op een annuïteit met gelijke looptijd en rente verlaagt het termijn-
// bedrag evenredig met de restschuld, dus de winst per euro is per lening constant:
//   leenruimte per € = (termijn / restschuld) × factor / paymentFactor
// Met een constante opbrengst per euro en een plafond per lening (de restschuld) is greedy op
// de hoogste opbrengst per euro optimaal.
// Gedeeltelijke aflossing telt pas mee zodra DUO het nieuwe maandbedrag heeft vastgesteld;
// alleen volledige aflossing is direct zeker.
export function optimizeRepayment({ perLoan, budget, factor, paymentFactor }) {
  const available = Math.max(0, num(budget));
  const rows = perLoan.map((loan, index) => {
    const balance = Math.max(0, loan.balance);
    const perEuro =
      balance > 0 && paymentFactor > 0 ? ((loan.termijn / balance) * factor) / paymentFactor : 0;
    return {
      id: loan.id,
      index,
      balance,
      termijn: loan.termijn,
      perEuro,
      fullRepayGain: perEuro * balance,
      allocated: 0,
      gain: 0,
      fullyRepaid: false,
    };
  });

  const order = rows
    .filter((r) => r.perEuro > 0)
    .sort((a, b) => b.perEuro - a.perEuro || a.index - b.index);

  let left = available;
  for (const row of order) {
    if (left <= 0) break;
    const pay = Math.min(left, row.balance);
    row.allocated = pay;
    row.gain = pay * row.perEuro;
    row.fullyRepaid = pay >= row.balance - 1e-9;
    left -= pay;
  }

  return {
    rows: rows.sort((a, b) => a.index - b.index),
    ranking: order.map((r) => r.id),
    totalGain: rows.reduce((s, r) => s + r.gain, 0),
    spent: available - left,
    remainingBudget: left,
    // Leningen die het budget volledig kan aflossen: daar is het effect direct zeker.
    fullyRepayable: rows
      .filter((r) => r.balance > 0 && r.perEuro > 0 && r.balance <= available + 1e-9)
      .map((r) => ({ id: r.id, cost: r.balance, gain: r.fullRepayGain })),
  };
}

// Aantal volledige maanden tussen twee datums (nooit negatief).
export function monthsBetween(from, to) {
  const a = new Date(from);
  const b = new Date(to);
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return 0;
  let months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  if (b.getDate() < a.getDate()) months -= 1;
  return Math.max(0, months);
}

// Toetslast vóór en ná een geplande renteherziening. De restschuld op de herzieningsdatum volgt
// uit het huidige termijnbedrag; daarna wordt het termijnbedrag opnieuw als annuïteit berekend
// met de nieuwe rente over de resterende looptijd.
export function projectRateRevision({ loan, factor, today = new Date() }) {
  const revisionDate = loan.revisionDate;
  const newRate = loan.revisionRatePct;
  if (!revisionDate || String(newRate ?? '').trim() === '') return null;

  const { termijn: current } = getStudyLoanTermijn(loan);
  const months = monthsBetween(today, revisionDate);
  const remaining = Math.floor(num(loan.remainingMonths));
  if (current <= 0 || remaining <= 0) return null;

  const r = getDuoMonthlyRate(loan.ratePct);
  const elapsed = Math.min(months, remaining);
  let balanceAtRevision;
  if (r <= 0) {
    balanceAtRevision = Math.max(0, num(loan.balance) - current * elapsed);
  } else {
    const growth = Math.pow(1 + r, elapsed);
    balanceAtRevision = Math.max(0, num(loan.balance) * growth - (current * (growth - 1)) / r);
  }
  const remainingAfter = remaining - elapsed;
  const after = remainingAfter > 0 ? getAnnuityTermijn(balanceAtRevision, newRate, remainingAfter) : 0;

  return {
    monthsUntilRevision: months,
    balanceAtRevision,
    remainingMonthsAfter: remainingAfter,
    termijnBefore: current,
    termijnAfter: after,
    toetslastBefore: current * factor,
    toetslastAfter: after * factor,
  };
}

// Studielening-presets voor een nieuwe lening en voor het omzetten van oude dossiers.
export const STUDY_LOAN_PRESETS = {
  nieuw: { label: 'Nieuw stelsel (vanaf sept. 2015, SF35)', ratePct: 2.33, months: 35 * 12 },
  oud: { label: 'Oud stelsel (vóór sept. 2015, SF15)', ratePct: 2.29, months: 15 * 12 },
};
