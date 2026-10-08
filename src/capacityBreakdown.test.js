import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { computeCore, computeMaxBudget, computeStarterGap, fillDossierDefaults } from './calcEngine';
import { buildCapacityBreakdown } from './capacityBreakdown';
import { getWoonquote } from './nibud2026';

// De uitkomsten hangen af van de datum (restschuld per vandaag, resterende rentevaste periode);
// de standaardgegevens zijn opgegeven per 8 oktober 2026.
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-08T12:00:00'));
});
afterAll(() => vi.useRealTimers());

function run(partial = {}) {
  const d = fillDossierDefaults(partial);
  const core = computeCore(d);
  const starterGap = computeStarterGap(d, core.calc);
  return { d, core, starterGap, b: buildCapacityBreakdown(d, core, starterGap) };
}
const row = (b, key) => b.rows.find((r) => r.key === key);

// Onafhankelijke hulpformules (bewust los van de code onder test).
const capFactor = (ratePct, n = 360) => {
  const r = ratePct / 100 / 12;
  return (1 - Math.pow(1 + r, -n)) / r;
};
const payment = (balance, ratePct, n) => {
  const r = ratePct / 100 / 12;
  return (balance * r) / (1 - Math.pow(1 + r, -n));
};

describe('standaardscenario, onafhankelijk nagerekend', () => {
  const { d, core, b } = run();

  it('begint bij woonquote × toetsinkomen, gekapitaliseerd tegen 4,00% over 360 maanden', () => {
    expect(d.purchasePrice).toBe(1330000);
    const woonlast = (getWoonquote(233000, 4.0) * 233000) / 12;
    expect(woonlast).toBeCloseTo(5320.17, 2);
    expect(row(b, 'income').amount).toBeCloseTo(woonlast * capFactor(4.0), 4);
  });

  it('afslag tweede woning = annuïteit € 42.000 @ 1% over 20 jaar × kapitalisatiefactor', () => {
    const monthly = payment(42000, 1.0, 240);
    expect(monthly).toBeCloseTo(193.16, 2);
    expect(-row(b, 'secondHome').amount).toBeCloseTo(monthly * capFactor(4.0), 4);
  });

  it('afslag studieschuld = DUO-maandbedrag € 142 × opslagfactor 1,20 gekapitaliseerd tegen 4,00%', () => {
    const study = row(b, 'study');
    expect(study.meta.factor).toBe(1.2);
    expect(study.meta.totalTermijn).toBe(142);
    expect(study.meta.totalToetslast).toBeCloseTo(170.4, 8);
    expect(-study.amount).toBeCloseTo(142 * 1.2 * capFactor(4.0), 4);
    expect(study.children).toHaveLength(1);
    expect(study.children[0].termijnSource).toBe('duo');
  });

  it('opslagfactor volgt uit de gewogen toetsrente van meegenomen delen plus nieuw geld', () => {
    const newMoney = core.combinedGap.additionalMortgage;
    const ported = [
      [269480.64, 5.0], // 1,25% met nog 52 maanden rentevast: AFM-toetsrente
      [354269.27, 1.85], // nog 172 maanden rentevast: contractrente
    ];
    const parts = [...ported, [newMoney, 4.0]];
    const total = parts.reduce((s, p) => s + p[0], 0);
    const weighted = parts.reduce((s, p) => s + p[0] * p[1], 0) / total;
    expect(row(b, 'study').meta.weightedToets).toBeCloseTo(weighted, 8);
    expect(weighted).toBeLessThanOrEqual(3.5);
    expect(row(b, 'study').meta.factor).toBe(1.2);
  });

  it('energielabel A geeft € 10.000 extra; het totaal sluit op de maximale hypotheek o.b.v. inkomen', () => {
    expect(row(b, 'energy').amount).toBe(10000);
    const expected =
      row(b, 'income').amount +
      row(b, 'secondHome').amount +
      row(b, 'study').amount +
      row(b, 'energy').amount;
    expect(row(b, 'incomeMax').amount).toBeCloseTo(expected, 4);
    expect(b.rows.some((r) => r.key === 'floor')).toBe(false);
  });

  it('renterisico: deel 1 (1,25%, 52 mnd rentevast) wordt getoetst tegen 5,00% i.p.v. 1,25%', () => {
    const extraMonthly = payment(269480.64, 5.0, 292) - payment(269480.64, 1.25, 292);
    const haircut = extraMonthly * capFactor(5.0);
    expect(-row(b, 'rateRisk').amount).toBeCloseTo(haircut, 2);
    expect(row(b, 'rateRisk').children).toHaveLength(1);
    expect(row(b, 'effectiveMax').amount).toBeCloseTo(row(b, 'incomeMax').amount - haircut, 2);
  });

  it('restschuld per vandaag is € 623.749,91 en gaat van de totale hypotheek af', () => {
    expect(b.portedDebt).toBeCloseTo(623749.91, 2);
    expect(-row(b, 'ported').amount).toBeCloseTo(623749.91, 2);
    expect(row(b, 'newMaxNibud').amount).toBeCloseTo(
      row(b, 'effectiveMax').amount - 623749.91,
      2
    );
  });

  it('geldverstrekkersmaximum (€ 1.000.000) is hier niet beperkend', () => {
    expect(b.rows.some((r) => r.key === 'lenderCap')).toBe(false);
    expect(row(b, 'newMax').meta.lenderCapRoom).toBeCloseTo(1000000 - 623749.91, 2);
    expect(b.maxTotalMortgage).toBeCloseTo(623749.91 + b.newMax, 2);
  });

  it('het benodigde bedrag voor € 1.330.000 en het verschil met de ruimte', () => {
    // Aanschafprijs − verkoopwaarde (95% van € 935.000) − eigen geld na kosten koper.
    const gap = 1330000 - 935000 * 0.95;
    expect(b.need.gap).toBeCloseTo(gap, 2);
    expect(b.need.required).toBeCloseTo(gap - b.need.ownCapitalApplied, 2);
    expect(b.need.margin).toBeCloseTo(b.newMax - b.need.required, 2);
    expect(b.need.feasible).toBe(b.need.margin >= 0);
  });

  it('de opbouw sluit exact', () => {
    expect(b.reconciles).toBe(true);
    expect(b.maxError).toBeLessThan(0.01);
    expect(b.rows[b.rows.length - 1].running).toBeCloseTo(b.finalAmount, 6);
    expect(b.afslagen.total).toBeGreaterThan(0);
  });
});

describe('de opbouw sluit exact in uiteenlopende situaties', () => {
  const scenarios = {
    standaard: {},
    'lagere prijs': { purchasePrice: 800000 },
    starter: {
      hasExistingHome: false,
      hasPartner2: false,
      hasSecondHome: false,
      income1: 60000,
      age1: '30',
      ownCapital1: 40000,
      purchasePrice: 450000,
    },
    'starter twee aanvragers': { hasExistingHome: false, hasSecondHome: false, purchasePrice: 800000 },
    'één aanvrager': { hasPartner2: false },
    'hypotheek niet meenemen': { takeOverMortgage: false },
    'AOW-toets bindend': { age1: '60', pensionIncome1: '40000' },
    'AOW-toets onvolledig': { age1: '60' },
    'ondergrens € 0 bij zeer hoge schulden': { debt1: '3000000' },
    'plafond geldverstrekker bindend': { lenderCapThreshold: '700000' },
    'toetsrente bij 5 jaar rentevast': { fixedRatePeriod: 5 },
    'familielening met maandlast': {
      useFamilyLoan: true,
      familyLoanRepaymentType: 'maandelijks',
      familyLoanMonthlyRepayment: '500',
    },
    'geen studieschuld': { studyLoans: [] },
    'twee studieleningen, beide partners': {
      studyLoans: [
        { id: 1, owner: 1, balance: '13803.67', ratePct: 2.95, remainingMonths: 111, monthlyPayment: '142', status: 'regulier', revisionDate: '', revisionRatePct: '' },
        { id: 2, owner: 2, balance: '26810.03', ratePct: 0, remainingMonths: 141, monthlyPayment: '', status: 'aanloopfase', revisionDate: '', revisionRatePct: '' },
      ],
    },
    'gemiddeld energielabel zonder bonus': { energyLabel: 'G' },
    'laag inkomen, renterisico groter dan capaciteit': { hasPartner2: false, income1: 20000 },
    'geen woning verkopen, wél tweede woning verkopen': { secondHomeWillSell: true },
  };

  for (const [name, partial] of Object.entries(scenarios)) {
    it(name, () => {
      const { core, starterGap, b } = run(partial);
      expect(b.reconciles).toBe(true);
      expect(b.maxError).toBeLessThan(0.01);
      const expected = core.combinedGap && b.kind === 'doorstromer'
        ? core.combinedGap.additionalMortgageCapacity
        : starterGap.capacity;
      expect(b.finalAmount).toBeCloseTo(expected, 6);
      expect(b.rows[b.rows.length - 1].running).toBeCloseTo(expected, 6);
      // Een leencapaciteit is nooit negatief en alle tussentotalen zijn eindig.
      for (const r of b.rows) {
        expect(Number.isFinite(r.amount)).toBe(true);
        expect(Number.isFinite(r.running)).toBe(true);
        if (r.type !== 'delta') expect(r.amount).toBeGreaterThanOrEqual(0);
      }
    });
  }

  it('zeer hoge schulden: de ondergrens van € 0 staat als eigen correctieregel in de opbouw', () => {
    const { b } = run({ debt1: '3000000' });
    expect(row(b, 'floor')).toBeTruthy();
    expect(row(b, 'incomeMax').amount).toBeGreaterThanOrEqual(0);
  });

  it('AOW-toets bindend: eigen regel met een negatief bedrag', () => {
    const { b, core } = run({ age1: '60', pensionIncome1: '40000' });
    expect(core.calc.pensionBinding).toBe(true);
    expect(row(b, 'aow').amount).toBeLessThan(0);
    expect(b.aow.binding).toBe(true);
  });

  it('plafond geldverstrekker: bindend verlaagt de ruimte voor nieuw geld met een eigen regel', () => {
    const { b } = run({ lenderCapThreshold: '700000' });
    expect(row(b, 'lenderCap').amount).toBeLessThan(0);
    expect(b.newMax).toBeCloseTo(700000 - b.portedDebt, 2);
    expect(b.maxTotalMortgage).toBeCloseTo(700000, 2);
  });

  it('hypotheek niet meenemen: geen renterisico- en meeneemregel, de hele capaciteit is nieuw geld', () => {
    const { b } = run({ takeOverMortgage: false });
    expect(row(b, 'rateRisk')).toBeUndefined();
    expect(row(b, 'ported')).toBeUndefined();
    expect(b.portedDebt).toBe(0);
    // Zonder meegenomen hypotheek is de hele inkomenscapaciteit nieuw geld, begrensd door het
    // plafond van de geldverstrekker (standaard € 1.000.000).
    expect(b.newMax).toBeCloseTo(Math.min(row(b, 'incomeMax').amount, 1000000), 6);
    expect(row(b, 'lenderCap').amount).toBeCloseTo(-(row(b, 'incomeMax').amount - 1000000), 6);
  });

  it('starter: het beginpunt kan niet hoger zijn dan het plafond van de geldverstrekker', () => {
    const { b } = run({
      hasExistingHome: false,
      hasSecondHome: false,
      lenderCapThreshold: '500000',
    });
    expect(b.kind).toBe('starter');
    expect(b.finalAmount).toBeLessThanOrEqual(500000);
    expect(row(b, 'lenderCap').amount).toBeLessThan(0);
  });
});

describe('maximaal aankoopbudget en haalbaarheid spreken elkaar nooit tegen', () => {
  const budgetOf = (partial) => {
    const { d, core } = run(partial);
    return { ...core, budget: computeMaxBudget(d, core.calc, core.currentMortgage, core.combinedGap) };
  };

  it('het budget is eigen geld + overwaarde + meegenomen hypotheek + nieuwe hypotheek', () => {
    const { budget, calc, currentMortgage, combinedGap } = budgetOf({});
    expect(budget.maxBudget).toBeCloseTo(
      calc.totalOwnCapital +
        currentMortgage.usableOverwaarde +
        currentMortgage.portedDebt +
        combinedGap.additionalMortgageCapacity,
      6
    );
  });

  it.each([
    ['standaard', {}],
    ['lagere prijs', { purchasePrice: 900000 }],
    ['hogere prijs', { purchasePrice: 1500000 }],
    ['plafond geldverstrekker bindend', { lenderCapThreshold: '700000' }],
    ['hypotheek niet meenemen', { takeOverMortgage: false }],
    ['toetsrente', { fixedRatePeriod: 5 }],
  ])('%s: past binnen het budget precies als de aanvullende hypotheek past', (_name, partial) => {
    const { budget, combinedGap } = budgetOf(partial);
    expect(budget.remainingAfterCosts >= -0.005).toBe(combinedGap.withinCapacity);
  });

  it('een lager plafond bij de geldverstrekker verlaagt het budget', () => {
    const open = budgetOf({}).budget.maxBudget;
    const capped = budgetOf({ lenderCapThreshold: '700000' }).budget.maxBudget;
    expect(capped).toBeLessThan(open);
  });
});

describe('debetrente en nieuw geld vormen een vast punt', () => {
  it('het bedrag aan nieuw geld in de weging is het benodigde aanvullende bedrag', () => {
    const d = fillDossierDefaults({});
    const { combinedGap } = computeCore(d);
    const again = computeCore(d);
    expect(again.combinedGap.additionalMortgage).toBeCloseTo(combinedGap.additionalMortgage, 6);
  });

  it('een lagere prijs verlaagt het nieuwe geld en daarmee de debetrente niet onder de ruimte', () => {
    const a = run({ purchasePrice: 1330000 }).core;
    const c = run({ purchasePrice: 900000 }).core;
    expect(c.combinedGap.additionalMortgage).toBeLessThan(a.combinedGap.additionalMortgage);
    expect(c.calc.studyDebt.weightedToets).toBeLessThanOrEqual(a.calc.studyDebt.weightedToets + 1e-9);
  });
});
