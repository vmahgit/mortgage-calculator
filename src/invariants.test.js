import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  computeCore,
  computeStarterGap,
  evaluateAffordability,
  findMaxAffordablePrice,
  fillDossierDefaults,
  testLoanComposition,
  TERM_MONTHS,
} from './calcEngine';
import { buildCapacityBreakdown } from './capacityBreakdown';

// Eigenschappen die voor ELK dossier moeten gelden, getoetst op een reeks willekeurige (maar
// reproduceerbare) dossiers. Vangt fouten die handgekozen voorbeelden missen.

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-08T12:00:00'));
});
afterAll(() => vi.useRealTimers());

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomDossier(seed) {
  const r = rng(seed);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const between = (lo, hi, step = 1) => lo + Math.floor((r() * (hi - lo)) / step) * step;
  const nParts = pick([1, 2, 3]);
  const startYear = between(2012, 2026);
  const loanParts = Array.from({ length: nParts }, (_, i) => {
    const principal = between(40000, 450000, 5000);
    return {
      id: i + 1,
      type: pick(['Annuïteit', 'Aflossingsvrij', 'Lineair']),
      principal: String(principal),
      knownBalance: '',
      balanceAsOf: '',
      rate: pick([0.8, 1.25, 1.85, 2.5, 3.4, 4.1, 5.2]),
      originalFixedYears: pick([1, 5, 10, 15, 20, 30]),
    };
  });
  return {
    income1: between(30000, 160000, 1000),
    income2: between(0, 140000, 1000),
    hasPartner2: r() < 0.7,
    age1: String(between(25, 64)),
    age2: String(between(25, 64)),
    ownCapital1: between(0, 200000, 5000),
    ownCapital2: between(0, 100000, 5000),
    rate: pick([2.5, 3.2, 3.8, 4.0, 4.4, 5.1]),
    fixedRatePeriod: pick([1, 5, 10, 20, 30]),
    energyLabel: pick(['G', 'D', 'B', 'A+', 'A+++']),
    purchasePrice: between(250000, 1600000, 5000),
    debt1: String(pick([0, 0, 5000, 20000])),
    debt2: String(pick([0, 0, 10000])),
    studyLoans: pick([
      [],
      [{ id: 1, owner: 1, balance: '13803.67', ratePct: 2.95, remainingMonths: 111, monthlyPayment: '142', status: 'regulier', revisionDate: '', revisionRatePct: '' }],
    ]),
    pensionIncome1: String(between(20000, 60000, 1000)),
    pensionIncome2: String(between(20000, 60000, 1000)),
    hasExistingHome: r() < 0.7,
    hasSecondHome: r() < 0.3,
    secondHomeWillSell: r() < 0.5,
    takeOverMortgage: r() < 0.75,
    startDate: `${startYear}-0${between(1, 10)}-15`,
    marketValue: between(300000, 1500000, 5000),
    saleDiscountPercentage: pick([95, 100]),
    loanParts,
    portedTermBasis: pick(['resterend', '30jaar']),
    lenderCapThreshold: pick(['', '800000', '1000000', '1300000']),
    includeKostenKoperInCalc: r() < 0.8,
  };
}

const SEEDS = Array.from({ length: 250 }, (_, i) => 1000 + i);

function allFinite(obj, path = '', seen = new Set()) {
  if (obj === null || typeof obj !== 'object') {
    // Infinity is bedoeld als 'geen limiet' (ownContributionCap); NaN is altijd een fout.
    if (typeof obj === 'number' && Number.isNaN(obj)) return [path];
    return [];
  }
  if (seen.has(obj)) return [];
  seen.add(obj);
  return Object.entries(obj).flatMap(([k, v]) => allFinite(v, `${path}.${k}`, seen));
}

describe('willekeurige dossiers', () => {
  it.each(SEEDS)('seed %i: alles eindig, de opbouw sluit en het maximum is optimaal', (seed) => {
    const d = fillDossierDefaults(randomDossier(seed));
    const core = computeCore(d);
    expect(allFinite({ calc: core.calc, cm: core.currentMortgage, gap: core.combinedGap })).toEqual([]);

    const starterGap = computeStarterGap(d, core.calc);
    const b = buildCapacityBreakdown(d, core, starterGap);
    expect(b.reconciles).toBe(true);
    const cm = core.currentMortgage;
    expect(cm.extraBorrowCapacity).toBeGreaterThanOrEqual(0);

    if (d.hasExistingHome && d.takeOverMortgage && cm.composite) {
      // Brute force: het hoogste bedrag nieuw geld dat beide toetsen (inkomen en eventueel
      // pensioen) halen, op een raster van € 500. Haalbaarheid is niet monotoon (de kolom
      // van de woonquote springt), dus alle rasterpunten worden bekeken.
      const { calc } = core;
      const margins = (x) => {
        const common = {
          ported: cm.portedParts,
          newParts: [{ balance: x, testRate: calc.testRate, termMonths: TERM_MONTHS }],
          refRate: calc.testRate,
          monthlyDebt: calc.monthlyDebt,
          studyAfslag: calc.studyAfslag,
        };
        const m = [
          testLoanComposition({ ...common, income: calc.combinedIncome, bonus: calc.energyBonus + calc.singleBonus }).margin,
        ];
        if (calc.pensionActive) {
          m.push(
            testLoanComposition({
              ...common,
              income: calc.pensionCombinedIncome,
              aow: true,
              bonus: calc.energyBonus + calc.pensionSingleBonus,
            }).margin
          );
        }
        return Math.min(...m);
      };
      let best = 0;
      for (let x = 0; x <= 4000000; x += 500) if (margins(x) >= -0.005) best = x;
      expect(cm.extraBorrowCapacity).toBeGreaterThanOrEqual(best - 1e-6);
      expect(cm.extraBorrowCapacity).toBeLessThanOrEqual(best + 500 + 1e-6);
      // En het gevonden maximum zelf haalt de toets (of ligt één euro onder een kolomgrens).
      // (Bij ruimte 0 past de meegenomen hypotheek zelf al niet; dan is er niets om te toetsen.)
      if (cm.extraBorrowCapacity > 0) expect(margins(cm.extraBorrowCapacity)).toBeGreaterThanOrEqual(-0.5);
    }
  });
});

describe('monotonie: meer inkomen, minder schuld en meer eigen geld helpen nooit niet', () => {
  const base = (seed) => fillDossierDefaults(randomDossier(seed));
  const cap = (d) => computeCore(d).currentMortgage.effectiveMaxMortgage;
  const incomeMax = (d) => computeCore(d).calc.incomeBasedMax;

  it.each(SEEDS.slice(0, 80))('seed %i', (seed) => {
    const d = base(seed);
    expect(incomeMax({ ...d, income1: d.income1 + 10000 })).toBeGreaterThanOrEqual(incomeMax(d) - 0.01);
    expect(incomeMax({ ...d, debt1: String(Number(d.debt1) + 20000) })).toBeLessThanOrEqual(incomeMax(d) + 0.01);
    expect(cap({ ...d, income2: d.income2 + 10000 })).toBeGreaterThanOrEqual(cap(d) - 0.01);
    const richer = { ...d, ownCapital1: d.ownCapital1 + 25000 };
    const a = evaluateAffordability(d);
    const c = evaluateAffordability(richer);
    expect(c.shortfall).toBeLessThanOrEqual(a.shortfall + 0.01);
    if (a.affordable) expect(c.affordable).toBe(true);
  });
});

describe('solver: maximale prijs is haalbaar en € 1.000 meer niet', () => {
  it.each(SEEDS.slice(0, 60))('seed %i', (seed) => {
    const d = fillDossierDefaults(randomDossier(seed));
    const max = findMaxAffordablePrice(d);
    if (max === null) return;
    expect(evaluateAffordability({ ...d, purchasePrice: max }).affordable).toBe(true);
    if (max < 20000000) {
      expect(evaluateAffordability({ ...d, purchasePrice: max + 1000 }).affordable).toBe(false);
    }
  });
});
