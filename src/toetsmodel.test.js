import { readFileSync, writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { computeCore, computeMaxBudget, computeStarterGap, fillDossierDefaults } from './calcEngine';

// Golden-test voor het Excel-toetsmodel (docs/toetsmodel). De scenario's staan in scenarios.json
// (zelfde invoer als in de spreadsheet); expected.json bevat wat deze engine ervoor uitrekent.
// build_toetsmodel.py zet die waarden naast de onafhankelijke Excel-formules, dus een afwijking
// in één van beide valt op. Opnieuw vastleggen na een bewuste rekenwijziging:
//   UPDATE_EXPECTED=1 npx vitest run src/toetsmodel.test.js

const DIR = new URL('../docs/toetsmodel/', import.meta.url);
const SCEN_URL = process.env.SCENARIOS_FILE ? new URL(`file://${process.env.SCENARIOS_FILE}`) : new URL('scenarios.json', DIR);
const EXP_URL = process.env.EXPECTED_FILE ? new URL(`file://${process.env.EXPECTED_FILE}`) : new URL('expected.json', DIR);
const scenarios = JSON.parse(readFileSync(SCEN_URL, 'utf-8'));

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-08T12:00:00'));
});
afterAll(() => vi.useRealTimers());

export function toDossier(s) {
  const sh = s.sh || {};
  const taxUsage = s.tax === 0 ? 'nieuwbouw' : s.tax >= 0.08 ? 'nietHoofdverblijf' : 'zelfbewoning';
  return fillDossierDefaults({
    income1: s.inc1,
    income2: s.twee ? s.inc2 : 0,
    hasPartner2: s.twee,
    age1: String(s.age1),
    age2: String(s.age2),
    pensionIncome1: s.pen1 ? String(s.pen1) : '',
    pensionIncome2: s.pen2 ? String(s.pen2) : '',
    energyLabel: s.label,
    rate: s.rate * 100,
    fixedRatePeriod: s.fixed,
    debt1: String(s.debt1),
    debt2: String(s.debt2),
    useFamilyLoan: s.famMonthly > 0,
    familyLoanRepaymentType: 'maandelijks',
    familyLoanMonthlyRepayment: String(s.famMonthly),
    hasSecondHome: !!sh.active,
    secondHomeWillSell: false,
    secondHomeMortgageDebt: String(sh.debt ?? 0),
    secondHomeInterestRate: (sh.rate ?? 0.01) * 100,
    secondHomeRepaymentType: sh.type ?? 'Annuïteit',
    secondHomeRemainingYears: sh.years ?? 20,
    secondHomeFixedYears: sh.fixed ?? 10,
    studyLoans:
      s.studyTerm > 0
        ? [{ id: 1, owner: 1, balance: '50000', ratePct: 2.95, remainingMonths: 120, monthlyPayment: String(s.studyTerm), status: 'regulier', revisionDate: '', revisionRatePct: '' }]
        : [],
    studyDebtRateMode: s.studyMode === 'Contractrente' ? 'contract' : 'gewogenToets',
    studyDebtAfslagMethod: s.studyMethod === 'Gewogen' ? 'gewogen' : 'marginaal',
    hasExistingHome: s.doorstromer,
    takeOverMortgage: s.takeover,
    portedTermBasis: s.termBasis === '30 jaar' ? '30jaar' : 'resterend',
    startDate: s.start,
    loanParts: s.parts
      .filter((p) => p.bal > 0)
      .map((p, i) => ({
        id: i + 1,
        type: p.type,
        principal: String(p.bal),
        knownBalance: String(p.bal),
        balanceAsOf: s.peil,
        rate: p.rate * 100,
        originalFixedYears: p.fix,
      })),
    purchasePrice: s.price,
    marketValue: s.mv,
    saleDiscountPercentage: s.discount * 100,
    ownCapital1: s.own,
    ownCapital2: 0,
    ownCapital1Liquid: true,
    ownCapital2Liquid: true,
    propertyUsage: taxUsage,
    starterExemption1: false,
    starterExemption2: false,
    notaryCosts: String(s.notary),
    valuationCosts: String(s.val),
    advisoryCosts: String(s.adv),
    includeBankGuarantee: s.bg,
    includeBuyersAgent: s.agent,
    includeNhgFee: false,
    includeKostenKoperInCalc: s.kk,
    lenderCapThreshold: String(s.cap),
  });
}

export function metricsFor(s) {
  const d = toDossier(s);
  const core = computeCore(d);
  const { calc, currentMortgage: cm, combinedGap: gap } = core;
  const starter = computeStarterGap(d, calc);
  const door = d.hasExistingHome;
  const budget = door ? computeMaxBudget(d, calc, cm, gap) : null;
  return {
    incomeTotal: calc.combinedIncome,
    testRate: calc.testRate / 100,
    monthlyDebt: calc.monthlyDebt,
    secondHomeToetslast: calc.secondHomeMonthly,
    studyFactor: calc.studyDebt.factor,
    studyDebetrente: calc.studyDebt.debetrente / 100,
    studyAfslag: calc.studyAfslag,
    incomeBasedMax: calc.incomeBasedMax,
    currentDebt: cm.currentDebtBalance,
    extraBorrowCapacity: door && s.takeover ? cm.extraBorrowCapacity : calc.incomeBasedMax,
    kostenKoper: calc.kostenKoper.total,
    needed: door ? gap.additionalMortgage : starter.requiredMortgage,
    capacityNew: door ? gap.additionalMortgageCapacity : starter.capacity,
    margin: door ? gap.capacityMargin : starter.capacity - starter.requiredMortgage,
    shortfall: door ? gap.remainingShortfall : starter.shortfall,
    feasible: door ? (gap.capacityMargin >= 0 ? 1 : 0) : starter.feasible ? 1 : 0,
    maxTotal: door ? gap.portedDebt + gap.additionalMortgageCapacity : starter.capacity,
    maxBudgetAfterCosts: door ? budget.remainingAfterCosts : null,
  };
}

describe('Excel-toetsmodel: scenario\'s van de app-engine', () => {
  // Pas binnen de test berekenen: dan staat de vaste datum (8 okt. 2026) al, zoals de peildatum
  // in het Excel-model. Tijdens het inlezen van het bestand geldt nog de echte datum.
  if (process.env.UPDATE_EXPECTED) {
    it('legt de uitkomsten vast in expected.json', () => {
      writeFileSync(EXP_URL, JSON.stringify(scenarios.map(metricsFor), null, 1));
    });
    return;
  }

  const expected = JSON.parse(readFileSync(EXP_URL, 'utf-8'));
  it.each(scenarios.map((s, i) => [s.name, i]))('%s', (_name, i) => {
    const got = metricsFor(scenarios[i]);
    for (const [k, v] of Object.entries(expected[i])) {
      if (v === null) continue;
      expect(got[k], k).toBeCloseTo(v, 4);
    }
  });
});
