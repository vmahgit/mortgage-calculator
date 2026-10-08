import { describe, expect, it } from 'vitest';
import {
  computeStudyDebt,
  getAfslag,
  getAnnuityTermijn,
  getDuoMonthlyRate,
  getOpslagfactor,
  getPaymentFactor,
  getStudyDebtConfig,
  getStudyLoanTermijn,
  getWeightedDebetrente,
  monthsBetween,
  optimizeRepayment,
  projectRateRevision,
} from './studieschuld.js';

const config = getStudyDebtConfig(2026);

// Leningen uit de specificatie.
const loanA = { id: 'A', owner: 1, balance: 13803.67, ratePct: 2.95, remainingMonths: 111, status: 'aanloopfase' };
const loanB = { id: 'B', owner: 1, balance: 26810.03, ratePct: 0, remainingMonths: 141, status: 'aanloopfase' };

describe('1.4 termijnbedrag (DUO-maandrente)', () => {
  it('maandrente is effectief: (1 + jaarrente)^(1/12) − 1', () => {
    expect(getDuoMonthlyRate(2.95)).toBeCloseTo(Math.pow(1.0295, 1 / 12) - 1, 12);
    expect(getDuoMonthlyRate(0)).toBe(0);
  });

  it('5.1 lening A: termijn 142,00 (±0,02)', () => {
    expect(Math.abs(getAnnuityTermijn(13803.67, 2.95, 111) - 142.0)).toBeLessThanOrEqual(0.02);
  });

  it('5.1 een nominale maandrente (jaarrente/12) zou buiten de tolerantie vallen', () => {
    const r = 0.0295 / 12;
    const nominal = (13803.67 * r) / (1 - Math.pow(1 + r, -111));
    expect(Math.abs(nominal - 142.0)).toBeGreaterThan(0.02);
  });

  it('5.2 lening B bij 0% rente: restschuld / maanden = 190,13 (±0,02)', () => {
    expect(Math.abs(getAnnuityTermijn(26810.03, 0, 141) - 190.13)).toBeLessThanOrEqual(0.02);
    expect(getAnnuityTermijn(26810.03, 0, 141)).toBeCloseTo(26810.03 / 141, 10);
  });
});

describe('1.2/1.3 werkelijk maandbedrag of annuïteit per status', () => {
  const base = { balance: 13803.67, ratePct: 2.95, remainingMonths: 111 };

  it('regulier met werkelijk DUO-maandbedrag gebruikt dat bedrag', () => {
    const r = getStudyLoanTermijn({ ...base, status: 'regulier', monthlyPayment: 150 });
    expect(r).toMatchObject({ termijn: 150, source: 'duo' });
  });

  it('regulier zonder maandbedrag valt terug op een geschatte annuïteit', () => {
    const r = getStudyLoanTermijn({ ...base, status: 'regulier' });
    expect(r.source).toBe('schatting');
    expect(r.termijn).toBeCloseTo(142.0, 1);
  });

  it.each(['aanloopfase', 'aflosvrij', 'draagkracht'])(
    '5.6 status %s: termijn uit annuïteit, ook als het werkelijke bedrag 0 of lager is',
    (status) => {
      const r = getStudyLoanTermijn({ ...base, status, monthlyPayment: 0 });
      expect(r.source).toBe('annuiteit');
      expect(r.termijn).toBeGreaterThan(0);
      expect(r.termijn).toBeCloseTo(142.0, 1);
      const low = getStudyLoanTermijn({ ...base, status, monthlyPayment: 20 });
      expect(low.termijn).toBeCloseTo(r.termijn, 10);
    }
  );
});

describe('5.6 randgevallen', () => {
  it('rente 0% geeft restschuld / maanden', () => {
    expect(getStudyLoanTermijn({ balance: 1200, ratePct: 0, remainingMonths: 12, status: 'aflosvrij' }).termijn).toBe(100);
  });

  it('restschuld 0 geeft termijn 0', () => {
    expect(getStudyLoanTermijn({ balance: 0, ratePct: 2.5, remainingMonths: 100, status: 'regulier', monthlyPayment: 50 }).termijn).toBe(0);
    expect(getAnnuityTermijn(0, 2.5, 100)).toBe(0);
  });

  it('looptijd 0 geeft 0 met een waarschuwing, nooit NaN of Infinity', () => {
    const r = getStudyLoanTermijn({ balance: 5000, ratePct: 2.5, remainingMonths: 0, status: 'aflosvrij' });
    expect(r.termijn).toBe(0);
    expect(r.warning).toMatch(/looptijd/i);
    expect(Number.isFinite(getAnnuityTermijn(5000, 2.5, 0))).toBe(true);
    expect(getAnnuityTermijn(5000, 2.5, 0)).toBe(0);
  });

  it('onleesbare invoer wordt 0', () => {
    expect(getStudyLoanTermijn({ balance: 'abc', ratePct: '', remainingMonths: undefined }).termijn).toBe(0);
  });
});

describe('1.5/1.6 opslagfactor per debetrente', () => {
  it.each([
    [0, 1.05],
    [1.5, 1.05],
    [1.501, 1.1],
    [2.0, 1.1],
    [2.001, 1.15],
    [2.5, 1.15],
    [2.501, 1.2],
    [3.0, 1.2],
    [3.001, 1.2],
    [3.5, 1.2],
    [3.501, 1.25],
    [4.0, 1.25],
    [4.001, 1.3],
    [4.5, 1.3],
    [4.501, 1.3],
    [5.0, 1.3],
    [5.001, 1.35],
    [5.5, 1.35],
    [5.501, 1.4],
    [6.0, 1.4],
    [6.001, 1.4],
    [6.5, 1.4],
    [6.501, 1.45],
    [9.9, 1.45],
  ])('debetrente %s%% geeft factor %s', (rate, expected) => {
    expect(getOpslagfactor(rate, config)).toBe(expected);
  });

  it('rondt de debetrente eerst af op drie decimalen', () => {
    expect(getOpslagfactor(1.5004, config)).toBe(1.05);
    expect(getOpslagfactor(1.5006, config)).toBe(1.1);
  });

  it('de tabel staat per kalenderjaar in de configuratie; een onbekend jaar valt terug', () => {
    expect(getStudyDebtConfig(2025).year).toBe(2025);
    expect(getStudyDebtConfig(2026).year).toBe(2026);
    expect(getStudyDebtConfig(2030).year).toBe(2026);
    expect(getStudyDebtConfig(2020).year).toBe(2025);
    expect(config.afmToetsrente).toBe(5.0);
  });
});

describe('3 afslag op de maximale hypotheek', () => {
  it('annuïteitfactor bij 4,69% over 360 maanden is 0,0051803 (afronding 7e decimaal)', () => {
    expect(getPaymentFactor(4.69)).toBeCloseTo(0.0051803, 6);
  });

  // De specificatie rekent met de annuïteitfactor afgerond op 7 decimalen (0,0051803); de exacte
  // waarde is 0,0051803693. Daardoor wijkt de exacte afslag tot € 1,03 af van de getallen in de
  // specificatie (lening A, factor 1,25: exact 34.263,97 tegen 34.265). Daarom twee controles:
  // de formule strak (€ 1) met de afgeronde factor van de specificatie, en de exacte
  // berekening binnen € 1,5.
  const SPEC_PAYMENT_FACTOR = 0.0051803;
  it.each([
    ['A', 142.0, 1.25, 34265],
    ['A', 142.0, 1.2, 32894],
    ['B', 190.13, 1.25, 45878],
    ['B', 190.13, 1.2, 44043],
  ])('5.3 marginaal bij 4,69%: lening %s, termijn %s, factor %s → afslag ≈ %s', (_n, termijn, factor, expected) => {
    const toetslast = termijn * factor;
    expect(Math.abs(toetslast / SPEC_PAYMENT_FACTOR - expected)).toBeLessThanOrEqual(1);
    expect(Math.abs(getAfslag(toetslast, 4.69) - expected)).toBeLessThanOrEqual(1.5);
  });

  it('5.3 met de zelf berekende termijn wijkt de afslag hooguit af door de termijntolerantie', () => {
    // De specificatie staat een termijn toe die ±0,02 afwijkt (5.1/5.2); per €0,01 termijn is dat
    // 0,01 × 1,25 / 0,00518 ≈ € 2,4 afslag. Lening B: exact 190,142 tegen 190,13 in de specificatie.
    const slack = (0.02 * 1.25) / getPaymentFactor(4.69);
    const a = getAnnuityTermijn(13803.67, 2.95, 111);
    const b = getAnnuityTermijn(26810.03, 0, 141);
    expect(Math.abs(getAfslag(a * 1.25, 4.69) - 34265)).toBeLessThanOrEqual(1.5 + slack);
    expect(Math.abs(getAfslag(b * 1.25, 4.69) - 45878)).toBeLessThanOrEqual(1.5 + slack);
  });

  it('afslag is lineair in de toetslast', () => {
    expect(getAfslag(200, 4.69)).toBeCloseTo(2 * getAfslag(100, 4.69), 8);
  });
});

describe('2 gewogen debetrente', () => {
  const parts = [
    { balance: 269480.64, ratePct: 1.25, remainingFixedYears: 4.33 },
    { balance: 354269, ratePct: 1.85, remainingFixedYears: 14.33 },
    { balance: 300000, ratePct: 4.69, remainingFixedYears: 10 },
  ];

  it('5.5 gewogen toetsrente ≈ 3,69% → factor 1,25', () => {
    const w = getWeightedDebetrente(parts, { afmToetsrente: 5.0 });
    expect(w.weightedToets).toBeCloseTo(3.69, 2);
    expect(getOpslagfactor(w.weightedToets, config)).toBe(1.25);
  });

  it('gewogen contractrente wordt apart geleverd (modus "contractrente")', () => {
    const w = getWeightedDebetrente(parts, { afmToetsrente: 5.0 });
    const expected = (269480.64 * 1.25 + 354269 * 1.85 + 300000 * 4.69) / (269480.64 + 354269 + 300000);
    expect(w.weightedContract).toBeCloseTo(expected, 8);
    expect(w.weightedContract).toBeLessThan(w.weightedToets);
  });

  it('een overbruggingskrediet telt niet mee: alleen de meegegeven leningdelen wegen', () => {
    const without = getWeightedDebetrente(parts, { afmToetsrente: 5.0 });
    const withBridge = getWeightedDebetrente(
      [...parts, { balance: 0, ratePct: 9, remainingFixedYears: 1 }],
      { afmToetsrente: 5.0 }
    );
    expect(withBridge.weightedToets).toBe(without.weightedToets);
  });

  it('precies 10 jaar resterend telt als ≥ 10 jaar: contractrente', () => {
    const w = getWeightedDebetrente([{ balance: 1, ratePct: 4.69, remainingFixedYears: 10 }], { afmToetsrente: 5.0 });
    expect(w.weightedToets).toBeCloseTo(4.69, 10);
  });

  it('onder 10 jaar geldt het hoogste van contractrente en AFM-toetsrente', () => {
    const low = getWeightedDebetrente([{ balance: 1, ratePct: 1.25, remainingFixedYears: 9.99 }], { afmToetsrente: 5.0 });
    const high = getWeightedDebetrente([{ balance: 1, ratePct: 6.0, remainingFixedYears: 5 }], { afmToetsrente: 5.0 });
    expect(low.weightedToets).toBe(5.0);
    expect(high.weightedToets).toBe(6.0);
  });

  it('zonder leningdelen is het resultaat 0 en niet NaN', () => {
    expect(getWeightedDebetrente([], { afmToetsrente: 5.0 })).toEqual({ weightedToets: 0, weightedContract: 0, totalBalance: 0 });
  });
});

describe('computeStudyDebt: methode en debetrente-modus', () => {
  const loans = [loanA, loanB];
  const common = { loans, weightedToets: 3.69, weightedContract: 2.9, marginalRatePct: 4.69, year: 2026 };

  it('marginaal gebruikt de rente van de nieuwe geldlening en de gewogen toetsrente voor de factor', () => {
    const r = computeStudyDebt({ ...common, afslagMethod: 'marginaal', debetrenteMode: 'gewogenToets' });
    expect(r.factor).toBe(1.25);
    expect(r.afslagRatePct).toBe(4.69);
    expect(r.totalToetslast).toBeCloseTo((r.perLoan[0].termijn + r.perLoan[1].termijn) * 1.25, 8);
    expect(r.totalAfslag).toBeCloseTo(getAfslag(r.totalToetslast, 4.69), 6);
  });

  it('gewogen gebruikt de gewogen toetsrente als afslagrente', () => {
    const r = computeStudyDebt({ ...common, afslagMethod: 'gewogen' });
    expect(r.afslagRatePct).toBe(3.69);
    expect(r.totalAfslag).toBeCloseTo(getAfslag(r.totalToetslast, 3.69), 6);
    expect(r.totalAfslag).toBeGreaterThan(computeStudyDebt({ ...common, afslagMethod: 'marginaal' }).totalAfslag);
  });

  it('modus "contractrente" bepaalt de factor uit de gewogen contractrente', () => {
    const r = computeStudyDebt({ ...common, debetrenteMode: 'contract' });
    expect(r.debetrente).toBe(2.9);
    expect(r.factor).toBe(1.2);
  });

  it('zonder leningen is alles 0', () => {
    const r = computeStudyDebt({ ...common, loans: [] });
    expect(r).toMatchObject({ totalBalance: 0, totalTermijn: 0, totalToetslast: 0, totalAfslag: 0 });
  });
});

describe('4 aflos-optimalisatie', () => {
  const study = computeStudyDebt({
    loans: [
      { ...loanA, status: 'regulier', monthlyPayment: 142.0 },
      { ...loanB, status: 'regulier', monthlyPayment: 190.13 },
    ],
    weightedToets: 3.69,
    weightedContract: 3.69,
    marginalRatePct: 4.69,
    year: 2026,
    debetrenteMode: 'gewogenToets',
  });
  // De specificatie rekent met factor 1,25 en hypotheekrente 4,69%, zoals hier.
  const input = { perLoan: study.perLoan, factor: 1.25, paymentFactor: getPaymentFactor(4.69) };

  it('5.4 leenruimte per € 1.000 aflossing: A ≈ 2.482, B ≈ 1.711', () => {
    const r = optimizeRepayment({ ...input, budget: 1000 });
    const a = r.rows.find((x) => x.id === 'A');
    const b = r.rows.find((x) => x.id === 'B');
    expect(a.perEuro * 1000).toBeGreaterThan(2481);
    expect(a.perEuro * 1000).toBeLessThan(2483);
    expect(b.perEuro * 1000).toBeGreaterThan(1710);
    expect(b.perEuro * 1000).toBeLessThan(1712);
  });

  it('5.4 de optimizer kiest A eerst', () => {
    const r = optimizeRepayment({ ...input, budget: 1000 });
    expect(r.ranking[0]).toBe('A');
    expect(r.rows.find((x) => x.id === 'A').allocated).toBe(1000);
    expect(r.rows.find((x) => x.id === 'B').allocated).toBe(0);
    expect(r.remainingBudget).toBe(0);
  });

  it('loopt over naar B zodra A volledig is afgelost en rapporteert het restbudget', () => {
    const r = optimizeRepayment({ ...input, budget: 20000 });
    const a = r.rows.find((x) => x.id === 'A');
    const b = r.rows.find((x) => x.id === 'B');
    expect(a.fullyRepaid).toBe(true);
    expect(a.allocated).toBeCloseTo(13803.67, 6);
    expect(b.allocated).toBeCloseTo(20000 - 13803.67, 6);
    expect(b.fullyRepaid).toBe(false);
    expect(r.remainingBudget).toBe(0);
    expect(r.totalGain).toBeCloseTo(a.gain + b.gain, 8);
    expect(r.totalGain).toBeCloseTo(a.fullRepayGain + (20000 - 13803.67) * b.perEuro, 6);
  });

  it('een budget groter dan alle schuld laat restbudget over', () => {
    const r = optimizeRepayment({ ...input, budget: 100000 });
    expect(r.rows.every((x) => x.fullyRepaid)).toBe(true);
    expect(r.remainingBudget).toBeCloseTo(100000 - 13803.67 - 26810.03, 6);
    expect(r.spent).toBeCloseTo(13803.67 + 26810.03, 6);
  });

  it('volledige aflossing van alle leningen haalt de hele afslag weg', () => {
    const r = optimizeRepayment({ ...input, budget: 100000 });
    const totalAfslag = getAfslag(study.perLoan[0].termijn * 1.25 + study.perLoan[1].termijn * 1.25, 4.69);
    expect(r.totalGain).toBeCloseTo(totalAfslag, 4);
  });

  it('toont apart welke leningen het budget volledig kan aflossen', () => {
    const r = optimizeRepayment({ ...input, budget: 15000 });
    expect(r.fullyRepayable.map((x) => x.id)).toEqual(['A']);
    expect(r.fullyRepayable[0].cost).toBeCloseTo(13803.67, 6);
    expect(r.fullyRepayable[0].gain).toBeGreaterThan(0);
  });

  it('budget 0 of negatief levert niets op', () => {
    expect(optimizeRepayment({ ...input, budget: 0 }).totalGain).toBe(0);
    expect(optimizeRepayment({ ...input, budget: -50 }).spent).toBe(0);
  });

  it('een lening zonder restschuld wordt overgeslagen', () => {
    const r = optimizeRepayment({
      ...input,
      perLoan: [{ id: 'X', balance: 0, termijn: 0 }, ...input.perLoan],
      budget: 500,
    });
    expect(r.rows.find((x) => x.id === 'X').allocated).toBe(0);
    expect(r.ranking[0]).toBe('A');
  });
});

describe('4.4 geplande renteherziening', () => {
  const today = new Date('2026-10-08');
  const loan = {
    id: 'A',
    balance: 13803.67,
    ratePct: 2.95,
    remainingMonths: 111,
    status: 'regulier',
    monthlyPayment: 142.0,
    revisionDate: '2028-10-08',
    revisionRatePct: 4.5,
  };

  it('telt de maanden tot de herzieningsdatum', () => {
    expect(monthsBetween('2026-10-08', '2028-10-08')).toBe(24);
    expect(monthsBetween('2026-10-08', '2026-09-01')).toBe(0);
  });

  it('toont toetslast vóór en ná de herziening; een hogere rente verhoogt het termijnbedrag', () => {
    const r = projectRateRevision({ loan, factor: 1.25, today });
    expect(r.monthsUntilRevision).toBe(24);
    expect(r.remainingMonthsAfter).toBe(87);
    expect(r.toetslastBefore).toBeCloseTo(142 * 1.25, 8);
    expect(r.balanceAtRevision).toBeLessThan(13803.67);
    expect(r.termijnAfter).toBeGreaterThan(0);
    expect(r.toetslastAfter).toBeCloseTo(r.termijnAfter * 1.25, 8);
    const same = projectRateRevision({ loan: { ...loan, revisionRatePct: 2.95 }, factor: 1.25, today });
    expect(r.termijnAfter).toBeGreaterThan(same.termijnAfter);
  });

  it('geeft null zonder datum of nieuwe rente', () => {
    expect(projectRateRevision({ loan: { ...loan, revisionDate: '' }, factor: 1.25, today })).toBeNull();
    expect(projectRateRevision({ loan: { ...loan, revisionRatePct: '' }, factor: 1.25, today })).toBeNull();
  });

  it('een herzieningsdatum na het einde van de looptijd levert 0 op ná de datum', () => {
    const r = projectRateRevision({ loan: { ...loan, revisionDate: '2040-01-01' }, factor: 1.25, today });
    expect(r.termijnAfter).toBe(0);
  });
});
