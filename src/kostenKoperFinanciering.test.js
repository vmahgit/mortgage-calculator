import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  computeCore,
  computeMaxBudget,
  computeNewMoneyNeeded,
  evaluateAffordability,
  fillDossierDefaults,
  findMaxAffordablePrice,
} from './calcEngine';

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-14T12:00:00'));
});
afterAll(() => vi.useRealTimers());

const base = { price: 1330000, portedDebt: 623750, overwaarde: 316250, restschuldTekort: 0, kostenKoperCash: 31695 };

describe('computeNewMoneyNeeded: kosten koper worden altijd ergens van betaald', () => {
  it('eigen geld ≥ kosten koper: gat min wat er na de kosten koper overblijft (zoals voorheen)', () => {
    const r = computeNewMoneyNeeded({ ...base, totalOwnCapital: 150000 });
    expect(r.gap).toBe(390000);
    expect(r.ownCapitalApplied).toBe(150000 - 31695);
    expect(r.additionalMortgage).toBe(390000 - (150000 - 31695));
    expect(r.kostenKoperUncovered).toBe(0);
  });

  it('REGRESSIE (PDF 14 okt.): eigen geld € 0 en kosten koper € 31.695 → de kosten koper komen bovenop het gat', () => {
    const r = computeNewMoneyNeeded({ ...base, totalOwnCapital: 0 });
    expect(r.kostenKoperUncovered).toBe(31695);
    expect(r.kostenKoperFinanced).toBe(31695); // totale hypotheek (€ 1.045.445) blijft ruim onder 100% LTV
    expect(r.additionalMortgage).toBe(390000 + 31695);
    expect(r.kostenKoperCashShortfall).toBe(0);
  });

  it('eigen geld precies gelijk aan de kosten koper: het gat verandert niet (eigen geld gaat op aan kosten)', () => {
    expect(computeNewMoneyNeeded({ ...base, totalOwnCapital: 31695 }).additionalMortgage).toBe(390000);
  });

  it('meefinancieren kan alleen binnen 100% LTV; het restant is een tekort aan eigen geld', () => {
    const r = computeNewMoneyNeeded({ price: 1000000, portedDebt: 900000, overwaarde: 50000, restschuldTekort: 0, totalOwnCapital: 0, kostenKoperCash: 60000 });
    expect(r.additionalMortgage).toBe(50000 + 50000); // gat € 50.000 + € 50.000 ruimte tot 100% LTV
    expect(r.kostenKoperFinanced).toBe(50000);
    expect(r.kostenKoperCashShortfall).toBe(10000);
    expect(900000 + r.additionalMortgage).toBeLessThanOrEqual(1000000);
  });

  it('een overschot uit de verkoop (overwaarde > nodig) betaalt de kosten koper', () => {
    const r = computeNewMoneyNeeded({ price: 800000, portedDebt: 600000, overwaarde: 300000, restschuldTekort: 0, totalOwnCapital: 0, kostenKoperCash: 30000 });
    expect(r.surplus).toBe(100000);
    expect(r.kostenKoperUncovered).toBe(0);
    expect(r.additionalMortgage).toBe(0);
  });

  it('bronnen en bestedingen sluiten: meegenomen + overwaarde + eigen geld + nieuw = prijs + kosten koper (+ restant)', () => {
    for (const own of [0, 10000, 31695, 80000, 400000]) {
      for (const price of [900000, 1330000]) {
        const r = computeNewMoneyNeeded({ ...base, price, totalOwnCapital: own });
        const sources = base.portedDebt + base.overwaarde + own + r.additionalMortgage;
        const uses = price + base.kostenKoperCash;
        // Wat overblijft aan geld: eigen geld na kosten en gat, plus een overschot uit de verkoop dat de kosten koper niet nodig had.
        const leftoverSurplus = Math.max(0, r.surplus - Math.max(0, base.kostenKoperCash - own));
        expect(sources - uses - (r.remainingOwnCapital + leftoverSurplus) + r.kostenKoperCashShortfall).toBeCloseTo(0, 6);
        expect(r.remainingOwnCapital).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('haalbaarheid met het dossier uit de PDF (eigen geld € 0)', () => {
  const mine = { hasSecondHome: false, marketValue: 940000, saleDiscountPercentage: 100, ownCapital1: 0, ownCapital2: 0, notaryCosts: '2100', valuationCosts: '0', advisoryCosts: '2995', includeBankGuarantee: false };

  it('benodigd nieuw geld = gat + kosten koper en het tekort groeit met de kosten koper', () => {
    const d = fillDossierDefaults(mine);
    const { calc, combinedGap: gap, currentMortgage } = computeCore(d);
    expect(calc.kostenKoper.total).toBe(31695);
    expect(gap.additionalMortgage).toBe(421695);
    expect(gap.kostenKoperFinanced).toBe(31695);
    expect(gap.capacityMargin).toBeCloseTo(currentMortgage.extraBorrowCapacity - 421695, 2);
    expect(evaluateAffordability(d).affordable).toBe(false);
    expect(evaluateAffordability(d).shortfall).toBeCloseTo(421695 - currentMortgage.extraBorrowCapacity, 2);
  });

  it('de budgetkaart en de haalbaarheid zeggen hetzelfde (ruimte na kosten koper = ruimte in de toets)', () => {
    const d = fillDossierDefaults(mine);
    const core = computeCore(d);
    const budget = computeMaxBudget(d, core.calc, core.currentMortgage, core.combinedGap);
    expect(budget.remainingAfterCosts).toBeCloseTo(core.combinedGap.capacityMargin, 2);
  });

  it('met precies genoeg eigen geld voor de kosten koper is de uitkomst die van het oude gedrag', () => {
    const d = fillDossierDefaults({ ...mine, ownCapital1: 31695 });
    expect(computeCore(d).combinedGap.additionalMortgage).toBe(390000);
  });

  it('de hoogste haalbare prijs ligt lager als de kosten koper gefinancierd moeten worden', () => {
    const zonder = findMaxAffordablePrice(fillDossierDefaults({ ...mine, ownCapital1: 31695 }));
    const met = findMaxAffordablePrice(fillDossierDefaults(mine));
    expect(met).toBeLessThan(zonder);
    // De gevonden prijs is haalbaar en € 1.000 meer niet.
    const d = fillDossierDefaults({ ...mine, purchasePrice: met });
    expect(evaluateAffordability(d).affordable).toBe(true);
    expect(evaluateAffordability({ ...d, purchasePrice: met + 1000 }).affordable).toBe(false);
  });

  it('kosten koper uitzetten in de toets laat ze buiten beschouwing', () => {
    const d = fillDossierDefaults({ ...mine, includeKostenKoperInCalc: false });
    expect(computeCore(d).combinedGap.additionalMortgage).toBe(390000);
  });
});

describe('rentevaste periode van zelf gekozen nieuwe leningdelen telt mee in het oordeel', () => {
  const mine = { hasSecondHome: false, marketValue: 940000, saleDiscountPercentage: 100, ownCapital1: 100000, ownCapital2: 0 };
  const part = (fixed, principal) => ({ id: 2, type: 'Annuïteit', principal: String(principal), rate: 4.69, originalFixedYears: fixed });
  const gapFor = (d) => computeCore(d).combinedGap;

  it('volgen ze automatisch (niet aangepast), dan blijft alles tegen de hoofdinvoer', () => {
    const d = fillDossierDefaults({ ...mine, additionalLoanParts: [part(5, 300000)], additionalLoanTouched: false });
    expect(gapFor(d).partsTest).toBeNull();
  });

  it('zelf ingesteld met 10 jaar rentevast: dezelfde ruimte als de hoofdinvoer', () => {
    const d0 = fillDossierDefaults(mine);
    const need = Math.round(gapFor(d0).additionalMortgage);
    const d = fillDossierDefaults({ ...mine, additionalLoanParts: [part(10, need)], additionalLoanTouched: true });
    const g = gapFor(d);
    expect(g.partsTest).not.toBeNull();
    expect(g.capacityMargin).toBeCloseTo(g.capacityMarginAtMainRate, 0);
  });

  it('zelf ingesteld met 5 jaar rentevast: AFM-toetsrente voor dat deel en dus minder ruimte', () => {
    const d0 = fillDossierDefaults(mine);
    const need = Math.round(gapFor(d0).additionalMortgage);
    const lang = gapFor(fillDossierDefaults({ ...mine, additionalLoanParts: [part(10, need)], additionalLoanTouched: true }));
    const kort = gapFor(fillDossierDefaults({ ...mine, additionalLoanParts: [part(5, need)], additionalLoanTouched: true }));
    expect(kort.partsTest.ratePartsAtAfm).toHaveLength(1);
    expect(kort.capacityMargin).toBeLessThan(lang.capacityMargin);
    // Het hoofdoordeel volgt: eerder is dit onopgemerkt gebleven (de hoofdinvoer staat nog op 10 jaar).
    expect(kort.capacityMargin).toBeLessThan(kort.capacityMarginAtMainRate - 1000);
  });

  it('kan een eerder haalbare woning onhaalbaar maken', () => {
    // Op de hoogste haalbare prijs is de marge klein: dan is een deel met 5 jaar rentevast net te veel.
    const price = findMaxAffordablePrice(fillDossierDefaults(mine));
    const d0 = fillDossierDefaults({ ...mine, purchasePrice: price });
    const g0 = gapFor(d0);
    expect(g0.capacityMargin).toBeGreaterThanOrEqual(0);
    const need = Math.round(g0.additionalMortgage);
    const kort = fillDossierDefaults({ ...mine, purchasePrice: price, additionalLoanParts: [part(5, need)], additionalLoanTouched: true });
    expect(evaluateAffordability(d0).affordable).toBe(true);
    expect(evaluateAffordability(kort).affordable).toBe(false);
    // Met 10 jaar rentevast blijft het haalbaar.
    const lang = fillDossierDefaults({ ...mine, purchasePrice: price, additionalLoanParts: [part(10, need)], additionalLoanTouched: true });
    expect(evaluateAffordability(lang).affordable).toBe(true);
  });

  it('dekken de zelf ingestelde delen het benodigde bedrag niet, dan telt de toets daarvan niet', () => {
    const d0 = fillDossierDefaults(mine);
    const need = Math.round(gapFor(d0).additionalMortgage);
    const d = fillDossierDefaults({ ...mine, additionalLoanParts: [part(5, Math.round(need / 2))], additionalLoanTouched: true });
    expect(gapFor(d).partsTest).toBeNull();
  });

  it('twee delen: één lang, één kort vast: alleen het korte deel krijgt de toetsrente', () => {
    const d0 = fillDossierDefaults(mine);
    const need = Math.round(gapFor(d0).additionalMortgage);
    const half = Math.round(need / 2);
    const d = fillDossierDefaults({
      ...mine,
      additionalLoanParts: [part(10, half), { ...part(3, need - half), id: 3 }],
      additionalLoanTouched: true,
    });
    const t = gapFor(d).partsTest;
    expect(t.ratePartsAtAfm).toHaveLength(1);
    expect(t.parts.map((p) => p.testRate)).toEqual([4.69, 5]);
  });
});
