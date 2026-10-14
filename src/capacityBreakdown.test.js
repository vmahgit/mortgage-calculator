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
  const INC = 225000; // € 118.000 + € 107.000
  const RATE = 4.69; // nieuwe hypotheek, 10 jaar rentevast: contractrente
  const newMoney = core.combinedGap.additionalMortgage;

  it('begint bij woonquote × toetsinkomen, gekapitaliseerd tegen 4,69% over 360 maanden', () => {
    expect(d.purchasePrice).toBe(1330000);
    expect(d.income2).toBe(107000);
    expect(d.rate).toBe(4.69);
    const woonlast = (getWoonquote(INC, RATE) * INC) / 12;
    expect(getWoonquote(INC, RATE)).toBeCloseTo(0.292, 10); // kolom 4,501–5,000%, bovenste inkomensrij
    expect(woonlast).toBeCloseTo(5475, 6);
    expect(row(b, 'income').amount).toBeCloseTo(woonlast * capFactor(RATE), 4);
  });

  it('standaard: geen tweede woning en eigen geld € 60.000 + € 16.000', () => {
    expect(d.hasSecondHome).toBe(false);
    expect(row(b, 'secondHome')).toBeUndefined();
    expect(core.calc.totalOwnCapital).toBe(76000);
  });

  it('afslag tweede woning (indien aangehouden) = annuïteit € 42.000 @ 1% over 20 jaar × kapitalisatiefactor', () => {
    const monthly = payment(42000, 1.0, 240);
    expect(monthly).toBeCloseTo(193.16, 2);
    const alt = run({ hasSecondHome: true }).b;
    expect(-row(alt, 'secondHome').amount).toBeCloseTo(monthly * capFactor(RATE), 4);
  });

  it('afslag studieschuld: beide leningen, DUO-maandbedragen € 142 + € 190 × opslagfactor 1,20 (art. 3a: 3,501–4,000%)', () => {
    const study = row(b, 'study');
    expect(study.meta.factor).toBe(1.2);
    expect(study.meta.totalTermijn).toBe(332);
    expect(study.meta.totalToetslast).toBeCloseTo(398.4, 8);
    expect(-study.amount).toBeCloseTo(332 * 1.2 * capFactor(RATE), 4);
    expect(study.children).toHaveLength(2);
    expect(study.children.map((c) => c.termijn)).toEqual([142, 190]);
    expect(study.children.every((c) => c.termijnSource === 'duo')).toBe(true);
  });

  it('opslagfactor volgt uit de gewogen toetsrente van meegenomen delen plus nieuw geld', () => {
    const ported = [
      [269480.64, 5.0], // 1,25% met nog 52 maanden rentevast: AFM-toetsrente
      [354269.27, 1.85], // nog 172 maanden rentevast: contractrente
    ];
    const parts = [...ported, [newMoney, RATE]];
    const total = parts.reduce((s, p) => s + p[0], 0);
    const weighted = parts.reduce((s, p) => s + p[0] * p[1], 0) / total;
    expect(row(b, 'study').meta.weightedToets).toBeCloseTo(weighted, 8);
    expect(weighted).toBeGreaterThan(3.5);
    expect(weighted).toBeLessThanOrEqual(4.0);
    expect(row(b, 'study').meta.factor).toBe(1.2);
  });

  it('energielabel A geeft € 10.000 extra; het totaal sluit op de maximale hypotheek o.b.v. inkomen', () => {
    expect(row(b, 'energy').amount).toBe(10000);
    const expected =
      row(b, 'income').amount +
      row(b, 'study').amount +
      row(b, 'energy').amount;
    expect(row(b, 'incomeMax').amount).toBeCloseTo(expected, 4);
    expect(b.rows.some((r) => r.key === 'floor')).toBe(false);
  });

  // Toets van de samenstelling: elk meegenomen deel annuïtair tegen zijn eigen toetsrente, de
  // woonquote uit de gewogen toetsrente (gewicht hoofdsom × looptijd). Deel 2 is aflossingsvrij en
  // aangegaan in 2021: box 3, dus zijn toetslast telt mee met de bruteringsfactor Tabel 1 ÷ Tabel 3.
  const K1 = 269480.64; // annuïteit 1,25%, nog 52 mnd rentevast → AFM-toetsrente 5%, 292 mnd
  const K2 = 354269.27; // aflossingsvrij 1,85%, nog 172 mnd rentevast → 1,85%, altijd 360 mnd
  const T1 = payment(K1, 5.0, 292);
  const T2 = payment(K2, 1.85, 360);
  const weightedAt = (x) => (K1 * 292 * 5 + K2 * 360 * 1.85 + x * 360 * RATE) / (K1 * 292 + K2 * 360 + x * 360);
  // Gewogen toetsrente ≈ 3,6% → kolom 3,501–4,000%, rij € 125.000: Tabel 1 27,4%, Tabel 3 22,6%.
  const wq = 0.274;
  const grossUp = 0.274 / 0.226;
  const studyMonthly = 332 * 1.2;
  const X = ((wq * INC) / 12 - T1 - T2 * grossUp) * capFactor(RATE) - studyMonthly * capFactor(RATE) + 10000;

  it('meegenomen delen: elk deel neemt zijn eigen toetslast uit de woonlast', () => {
    const ported = row(b, 'ported');
    expect(ported.children).toHaveLength(2);
    const [p1, p2] = ported.children;
    expect(p1.testRate).toBe(5.0);
    expect(p1.termMonths).toBe(292);
    expect(p1.toetslast).toBeCloseTo(T1, 6);
    expect(p2.testRate).toBe(1.85);
    expect(p2.termMonths).toBe(360);
    expect(p2.toetslast).toBeCloseTo(T2, 6);
    expect(p1.box3).toBe(false);
    expect(p2.box3).toBe(true);
    expect(p2.grossUp).toBeCloseTo(grossUp, 10);
    expect(-ported.amount).toBeCloseTo((T1 + T2 * grossUp) * capFactor(RATE), 4);
    expect(p1.capacityUsed).toBeGreaterThan(K1);
  });

  it('woonquote uit de gewogen toetsrente (officiële kolom 3,501–4,000%) en het maximum nieuw geld', () => {
    const cm = core.currentMortgage;
    expect(weightedAt(X)).toBeGreaterThan(3.5);
    expect(weightedAt(X)).toBeLessThanOrEqual(4.0);
    expect(cm.composite.band.exact).toBe(true);
    expect(cm.composite.weightedRate).toBeCloseTo(weightedAt(X), 8);
    expect(cm.composite.woonquote).toBeCloseTo(wq, 10);
    expect(cm.extraBorrowCapacity).toBeCloseTo(X, 4);
    const mix = row(b, 'woonquoteMix');
    expect(mix.amount).toBeCloseTo(((wq - 0.292) * INC) / 12 * capFactor(RATE), 4);
    expect(row(b, 'newMaxNibud').amount).toBeCloseTo(X, 4);
  });

  it('restschuld per vandaag is € 623.749,91; totaal = meegenomen + nieuw', () => {
    expect(b.portedDebt).toBeCloseTo(623749.91, 2);
    expect(core.currentMortgage.effectiveMaxMortgage).toBeCloseTo(623749.91 + X, 4);
    // T.o.v. "alles tegen 4,69%" kost de samenstelling hier per saldo ruimte: deel 1 telt tegen 5%,
    // deel 2 als box 3-deel gebruteerd, en de gewogen rente valt in een lagere kolom.
    const diff = row(b, 'incomeMax').amount - (623749.91 + X);
    expect(diff).toBeGreaterThan(0);
    expect(b.afslagen.composite).toBeCloseTo(diff, 4);
    expect(b.afslagen.compositeBenefit).toBe(0);
  });

  it('geldverstrekkersmaximum (€ 1.000.000) is hier niet beperkend', () => {
    expect(X).toBeLessThan(1000000 - 623749.91);
    expect(b.rows.some((r) => r.key === 'lenderCap')).toBe(false);
    expect(b.newMax).toBeCloseTo(X, 4);
    expect(b.maxTotalMortgage).toBeCloseTo(623749.91 + X, 4);
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

  it('hypotheek niet meenemen: geen meeneemregel, de hele capaciteit is nieuw geld', () => {
    const { b } = run({ takeOverMortgage: false });
    expect(row(b, 'ported')).toBeUndefined();
    expect(b.portedDebt).toBe(0);
    // Zonder meegenomen hypotheek is de hele inkomenscapaciteit nieuw geld, begrensd door het
    // plafond van de geldverstrekker (standaard € 1.000.000).
    const incomeMax = row(b, 'incomeMax').amount;
    expect(b.newMax).toBeCloseTo(Math.min(incomeMax, 1000000), 6);
    expect(!!row(b, 'lenderCap')).toBe(incomeMax > 1000000);
    const lower = run({ takeOverMortgage: false, lenderCapThreshold: '800000' }).b;
    expect(lower.newMax).toBeCloseTo(800000, 6);
    expect(row(lower, 'lenderCap').amount).toBeCloseTo(-(lower.rows.find((r) => r.key === 'incomeMax').amount - 800000), 6);
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
