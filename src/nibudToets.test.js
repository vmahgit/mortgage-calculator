import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  computeCore,
  computeStarterGap,
  fillDossierDefaults,
  getPortedPartTests,
  testLoanComposition,
  TERM_MONTHS,
} from './calcEngine';
import { buildCapacityBreakdown } from './capacityBreakdown';
import { getToetsrenteBand, getWoonquote } from './nibud2026';

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-08T12:00:00'));
});
afterAll(() => vi.useRealTimers());

function run(partial = {}) {
  const d = fillDossierDefaults(partial);
  const core = computeCore(d);
  return { d, core, b: buildCapacityBreakdown(d, core, computeStarterGap(d, core.calc)) };
}
const row = (b, key) => b.rows.find((r) => r.key === key);

describe('woonquote-tabel: kolom per 0,5% toetsrente, rij per € 1.000 inkomen', () => {
  it.each([
    [4.0, 4.0, true],
    [3.501, 4.0, true],
    [3.6, 4.0, true],
    [3.5, 3.5, false],
    [3.5000000001, 3.5, false],
    [1.2, 1.5, true],
    [5.01, 5.5, false],
  ])('toetsrente %s%% valt in de kolom tot %s%%', (rate, upper, exact) => {
    const band = getToetsrenteBand(rate);
    expect(band.upper).toBe(upper);
    expect(band.exact).toBe(exact);
  });

  it('boven 6% valt de toets terug op de hoogste bekende kolom', () => {
    expect(getToetsrenteBand(6.7)).toMatchObject({ upper: 6.0, aboveTable: true });
  });

  it('binnen één kolom geen interpolatie: 3,6% en 4,0% geven dezelfde woonquote', () => {
    expect(getWoonquote(233000, 3.6)).toBe(getWoonquote(233000, 4.0));
    expect(getWoonquote(233000, 3.4)).toBeLessThan(getWoonquote(233000, 3.6));
  });

  it('rij per € 1.000: € 70.999 telt als € 70.000 (23,6% bij 3,501–4,000%)', () => {
    expect(getWoonquote(70999, 4.0)).toBeCloseTo(0.236, 10);
    expect(getWoonquote(70000, 4.0)).toBeCloseTo(0.236, 10);
  });
});

describe('alleenstaandenbedrag (€ 17.000 buiten de financieringslast)', () => {
  const starter = { hasExistingHome: false, hasSecondHome: false, hasPartner2: false, age1: '30', purchasePrice: 400000 };

  it('één aanvrager met toetsinkomen ≥ € 30.000 krijgt € 17.000 extra', () => {
    const { b, core } = run({ ...starter, income1: 60000 });
    expect(core.calc.singleBonus).toBe(17000);
    expect(row(b, 'single').amount).toBe(17000);
    expect(b.reconciles).toBe(true);
  });

  it('onder € 30.000 of met een partner geen extra bedrag', () => {
    expect(run({ ...starter, income1: 29000 }).core.calc.singleBonus).toBe(0);
    expect(run({ ...starter, hasPartner2: true, income1: 60000 }).core.calc.singleBonus).toBe(0);
  });
});

describe('toets van de samenstelling bij meenemen', () => {
  const portedFor = (d) => getPortedPartTests(d);
  // Hoeveel ruimte er overblijft als u precies `x` nieuw leent (≥ 0 = past).
  const marginFor = (d, core, x) => {
    const { calc } = core;
    return testLoanComposition({
      income: calc.combinedIncome,
      ported: portedFor(d),
      newParts: [{ balance: x, testRate: calc.testRate, termMonths: TERM_MONTHS }],
      refRate: calc.testRate,
      monthlyDebt: calc.monthlyDebt,
      studyAfslag: calc.studyAfslag,
      bonus: calc.energyBonus + calc.singleBonus,
    }).margin;
  };

  it.each([
    ['standaard', {}],
    ['5 jaar rentevast nieuw geld', { fixedRatePeriod: 5 }],
    ['rente nieuw geld 4,3%', { rate: 4.3 }],
    ['rente nieuw geld 3,2%', { rate: 3.2 }],
    ['30 jaar looptijd voor de toetslast', { portedTermBasis: '30jaar' }],
    ['lager inkomen', { income1: 100000, income2: 90000 }],
  ])('%s: het maximum past precies en € 1.000 meer past niet', (_n, partial) => {
    const { d, core } = run(partial);
    const x = core.currentMortgage.extraBorrowCapacity;
    expect(x).toBeGreaterThan(0);
    expect(marginFor(d, core, x)).toBeGreaterThanOrEqual(-0.01);
    expect(marginFor(d, core, x + 1000)).toBeLessThan(0);
  });

  it('een verlopen rentevaste periode telt als korter dan 10 jaar: AFM-toetsrente', () => {
    const d = fillDossierDefaults({
      loanParts: [
        { id: 1, type: 'Annuïteit', principal: '300000', knownBalance: '', balanceAsOf: '', rate: 1.5, originalFixedYears: 5 },
      ],
    });
    const [p] = portedFor(d);
    expect(p.remainingFixedMonths).toBe(0);
    expect(p.testRate).toBe(5.0);
    expect(p.testRateIsAfm).toBe(true);
  });

  it('30 jaar looptijd voor annuïtaire delen verlaagt de toetslast en verhoogt de ruimte', () => {
    const rest = run({}).core.currentMortgage;
    const dertig = run({ portedTermBasis: '30jaar' }).core.currentMortgage;
    expect(dertig.portedParts[0].termMonths).toBe(360);
    expect(dertig.portedParts[0].toetslast).toBeLessThan(rest.portedParts[0].toetslast);
    expect(dertig.extraBorrowCapacity).toBeGreaterThan(rest.extraBorrowCapacity);
  });

  it('AOW-toets: de laagste van inkomen en pensioen bepaalt ook bij meenemen', () => {
    const { core, b } = run({ age1: '60', pensionIncome1: '40000' });
    const cm = core.currentMortgage;
    expect(cm.compositePension).toBeTruthy();
    expect(cm.extraBorrowCapacity).toBeCloseTo(
      Math.min(cm.composite.amount, cm.compositePension.amount),
      6
    );
    expect(b.reconciles).toBe(true);
  });

  it('niet meenemen: geen samengestelde toets, alle ruimte is nieuw geld', () => {
    const { core, b } = run({ takeOverMortgage: false });
    expect(core.currentMortgage.composite).toBeNull();
    expect(core.currentMortgage.extraBorrowCapacity).toBe(core.calc.incomeBasedMax);
    expect(row(b, 'ported')).toBeUndefined();
  });
});
