import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { computeCore, computeStarterGap, fillDossierDefaults, getLtvBasis } from './calcEngine';

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-14T12:00:00'));
});
afterAll(() => vi.useRealTimers());

const core = (partial) => {
  const d = fillDossierDefaults(partial);
  return { d, ...computeCore(d) };
};

// Art. 5: de hypotheek is maximaal 100% van de waarde van de woning (de getaxeerde marktwaarde).
describe('taxatiewaarde als grondslag voor de 100%-grens', () => {
  it('leeg = koopsom', () => {
    expect(getLtvBasis(fillDossierDefaults({}))).toBe(1330000);
    expect(getLtvBasis(fillDossierDefaults({ appraisalValue: '1300000' }))).toBe(1300000);
  });

  it('overbieden: boven de taxatiewaarde wordt niets geleend, dat deel is eigen geld', () => {
    // Doorstromer zonder eigen geld: meegenomen € 623.749,91 + nieuw € 441.750 = € 1.065.500 totaal.
    // Bij een taxatie van € 1.000.000 mag er maar € 376.250 nieuw bij; € 65.500 moet uit eigen geld.
    const base = { ownCapital1: 0, ownCapital2: 0, purchasePrice: 1330000, includeKostenKoperInCalc: false };
    const open = core(base).combinedGap;
    const over = core({ ...base, appraisalValue: '1000000' }).combinedGap;
    expect(open.ltvCashShortfall).toBe(0);
    expect(open.additionalMortgage).toBeCloseTo(1330000 - 935000 * 0.95, 4);
    expect(over.additionalMortgage).toBeCloseTo(1000000 - open.portedDebt, 4);
    expect(over.ltvCashShortfall).toBeCloseTo(open.additionalMortgage - (1000000 - open.portedDebt), 4);
    expect(over.remainingShortfall).toBeGreaterThanOrEqual(over.ltvCashShortfall - 0.01);
    expect(over.withinCapacityAfterFamilyLoan).toBe(false);
  });

  it('taxatie boven de koopsom: kosten koper zonder eigen geld mogen tot die waarde worden meegefinancierd', () => {
    // Geen overwaarde (verkoopwaarde ≈ restschuld): de hypotheek komt dan op 100% van de koopsom.
    const base = { ownCapital1: 0, ownCapital2: 0, purchasePrice: 1330000, marketValue: 656580 };
    const atPrice = core(base);
    const higher = core({ ...base, appraisalValue: '1352600' });
    const kk = atPrice.calc.kostenKoper.total;
    expect(atPrice.combinedGap.kostenKoperFinanced).toBeCloseTo(0, -1);
    expect(atPrice.combinedGap.kostenKoperCashShortfall).toBeCloseTo(kk, -1);
    expect(higher.combinedGap.kostenKoperFinanced).toBeCloseTo(Math.min(kk, 22600), -1);
    expect(higher.combinedGap.kostenKoperCashShortfall).toBeCloseTo(Math.max(0, kk - 22600), -1);
  });

  it('starter: zelfde regels', () => {
    const starter = {
      hasExistingHome: false,
      hasPartner2: false,
      income1: 90000,
      studyLoans: [],
      purchasePrice: 400000,
      ownCapital1: 0,
    };
    const atPrice = core(starter);
    const gapAt = computeStarterGap(atPrice.d, atPrice.calc);
    const kk = atPrice.calc.kostenKoper.total;
    expect(gapAt.requiredMortgage).toBe(400000);
    expect(gapAt.cashShortfall).toBeCloseTo(kk, 6);

    const higher = core({ ...starter, appraisalValue: '410000' });
    const gapHigh = computeStarterGap(higher.d, higher.calc);
    expect(gapHigh.requiredMortgage).toBeCloseTo(400000 + Math.min(kk, 10000), 6);
    expect(gapHigh.cashShortfall).toBeCloseTo(Math.max(0, kk - 10000), 6);

    const lower = core({ ...starter, appraisalValue: '390000', ownCapital1: 50000 });
    const gapLow = computeStarterGap(lower.d, lower.calc);
    // Eigen geld na kosten koper dekt een deel; boven € 390.000 wordt niets geleend.
    const own = 50000 - lower.calc.kostenKoper.total;
    expect(gapLow.requiredMortgage).toBeCloseTo(Math.min(400000 - own, 390000), 6);
  });

  it('de maximale hypotheek o.b.v. inkomen wordt begrensd op de taxatiewaarde', () => {
    const starter = { hasExistingHome: false, studyLoans: [], purchasePrice: 500000 };
    const low = core({ ...starter, appraisalValue: '480000' }).calc;
    expect(low.cappedByPropertyValue).toBe(true);
    expect(low.maxMortgage).toBe(480000);
  });
});
