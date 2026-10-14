import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { computeCore, fillDossierDefaults } from './calcEngine';
import { computeCashflow } from './kasstromen';

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-14T12:00:00'));
});
afterAll(() => vi.useRealTimers());

const run = (partial) => {
  const d = fillDossierDefaults(partial);
  const core = computeCore(d);
  return { d, core, cf: computeCashflow(d, core) };
};

// Het rekenblad van de gebruiker (levering 27-11-2026, verkoop 18-01-2027): koopsom € 1.330.000,
// kosten koper € 31.650 (overdrachtsbelasting € 26.600, notaris € 2.100, adviseur € 2.950), maximale
// hypotheek € 945.000, € 40.000 eigen geld, waarborgsom (10%) en de rest geleend van familie; de
// bestaande hypotheek (€ 623.000) blijft tot de verkoop als overbrugging staan.
const spreadsheet = {
  purchasePrice: 1330000,
  notaryCosts: '2100',
  valuationCosts: '0',
  advisoryCosts: '2950',
  includeBankGuarantee: false,
  includeBuyersAgent: false,
  cfMaxMortgage: '945000',
  cfOwnFundsAtDelivery: '40000',
  cfDepositFromFamily: true,
  cfDepositPct: 10,
  cfOwnFundsPartner2: '15825',
  loanParts: [
    { id: 1, type: 'Aflossingsvrij', principal: '623000', knownBalance: '623000', balanceAsOf: '2026-11-27', rate: 1.6, originalFixedYears: 20, fiscal: 'box1' },
  ],
};

describe('kasstromen: het rekenblad van de gebruiker', () => {
  const { cf } = run(spreadsheet);

  it('levering: koopsom + kosten koper = hypotheek + eigen geld + familie', () => {
    expect(cf.kostenKoper).toBeCloseTo(31650, 2);
    expect(cf.uses).toBeCloseTo(1361650, 2);
    expect(cf.mortgage).toBe(945000);
    expect(cf.ported).toBeCloseTo(623000, 2);
    expect(cf.newMortgage).toBeCloseTo(322000, 2);
    expect(cf.depositLoan).toBe(133000);
    expect(cf.familyBridgeLoan).toBeCloseTo(243650, 2);
    expect(cf.familyTotal).toBeCloseTo(376650, 2);
    expect(cf.sources).toBeCloseTo(1361650, 2);
    expect(cf.balanced).toBe(true);
  });

  it('verkoop: netto opbrengst − overbrugging − familie = tekort € 57.902,44', () => {
    const s = cf.sale;
    expect(s.netProceeds).toBeCloseTo(941747.56, 2);
    expect(s.bridge).toBeCloseTo(623000, 2);
    expect(s.overwaardeNet).toBeCloseTo(318747.56, 2);
    expect(s.afterFamily).toBeCloseTo(-57902.44, 2);
    expect(s.extraOwnAtSale).toBeCloseTo(57902.44, 2);
    expect(s.days).toBe(52);
  });

  it('eigen inbreng: € 97.902,44 totaal, € 66.252,44 exclusief kosten koper, € 82.077,44 voor aanvrager 1', () => {
    expect(cf.totalOwn).toBeCloseTo(97902.44, 2);
    expect(cf.ownExKostenKoper).toBeCloseTo(66252.44, 2);
    expect(cf.partner2Share).toBe(15825);
    expect(cf.partner1Share).toBeCloseTo(82077.44, 2);
  });

  it('een maximale hypotheek boven de toets wordt gemeld', () => {
    const { cf: c } = run({ cfMaxMortgage: String(Math.round(run({}).cf.toolMax) + 5000) });
    expect(c.warnings.map((w) => w.key)).toContain('aboveTool');
    expect(c.warnings.find((w) => w.key === 'aboveTool').amount).toBeCloseTo(5000, -1);
    expect(cf.warnings.map((w) => w.key)).not.toContain('aboveTool');
  });

  it('dubbele lasten in de overbruggingsperiode: rente over de overbrugging en de familielening', () => {
    const { cf: c } = run({ ...spreadsheet, cfBridgeRatePct: '5', familyLoanRate: 2 });
    expect(c.sale.bridgeInterest).toBeCloseTo((623000 * 0.05 * 52) / 365, 6);
    expect(c.sale.familyInterest).toBeCloseTo((376650 * 0.02 * 52) / 365, 6);
    expect(c.totalOwnInclCosts).toBeCloseTo(c.totalOwn + c.sale.carryingCosts, 6);
  });
});

describe('kasstromen: waarborgsom en overbruggingskrediet', () => {
  it('waarborgsom via bankgarantie: geen familielening voor de waarborgsom, wel 0,1% kosten koper', () => {
    const { cf } = run({ ...spreadsheet, includeBankGuarantee: true });
    expect(cf.depositMethod).toBe('bankgarantie');
    expect(cf.depositLoan).toBe(0);
    expect(cf.kostenKoperItems.some((i) => i.key === 'bankGuarantee')).toBe(true);
    expect(cf.kostenKoper).toBeCloseTo(31650 + 1330, 2);
    // De tijdelijke lening familie vangt nu ook de € 133.000 op.
    expect(cf.familyBridgeLoan).toBeCloseTo(1361650 + 1330 - 945000 - 40000, 2);
    expect(cf.balanced).toBe(true);
  });

  it('waarborgsom gestort uit eigen geld: geen aparte lening', () => {
    const { cf } = run({ ...spreadsheet, cfDepositFromFamily: false });
    expect(cf.depositMethod).toBe('eigen');
    expect(cf.depositLoan).toBe(0);
    expect(cf.familyBridgeLoan).toBeCloseTo(1361650 - 945000 - 40000, 2);
  });

  it('overbruggingskrediet van de bank vervangt (een deel van) de familielening en wordt bij verkoop afgelost', () => {
    const { cf } = run({ ...spreadsheet, useBridgeLoan: true, bridgeLoanAmount: '200000', bridgeLoanRate: 6 });
    expect(cf.bridgeCredit).toBe(200000);
    expect(cf.familyBridgeLoan).toBeCloseTo(243650 - 200000, 2);
    expect(cf.sale.bridgeCreditRepayment).toBe(200000);
    expect(cf.sale.afterFamily).toBeCloseTo(-57902.44, 2); // zelfde tekort, andere schuldeiser
    expect(cf.sale.bridgeCreditInterest).toBeCloseTo((200000 * 0.06 * 52) / 365, 6);
    expect(cf.balanced).toBe(true);
  });

  it('de hypotheek in de kasstromen is begrensd op de taxatiewaarde', () => {
    const { cf } = run({ ...spreadsheet, appraisalValue: '900000' });
    expect(cf.mortgage).toBe(900000);
    expect(cf.warnings.map((w) => w.key)).toContain('ltv');
  });
});

describe('Woonnu-regels', () => {
  it('standaard: familielening afgedekt (extra onderpand/vermogen), alleen een notitie', () => {
    const { cf } = run(spreadsheet);
    expect(cf.warnings.map((w) => w.key)).not.toContain('familyToets');
    expect(cf.notes.map((n) => n.key)).toContain('familyCovered');
  });

  it('niet afgedekt: familielening telt in de toets als 2% per maand van de hoofdsom (acceptatiegids 4.4)', () => {
    const { cf, core } = run({ ...spreadsheet, cfFamilyLoanCovered: false });
    expect(cf.familyTestMonthly).toBeCloseTo(376650 * 0.02, 6);
    const capF = (1 - Math.pow(1 + core.calc.testRate / 1200, -360)) / (core.calc.testRate / 1200);
    expect(cf.familyCapacityImpact).toBeCloseTo(376650 * 0.02 * capF, 4);
    expect(cf.warnings.map((w) => w.key)).toContain('familyToets');
  });

  it('zonder familielening geen waarschuwing', () => {
    const { cf } = run({ ...spreadsheet, cfMaxMortgage: '1330000', cfDepositFromFamily: false, cfOwnFundsAtDelivery: '76000' });
    expect(cf.familyTotal).toBe(0);
    expect(cf.warnings.map((w) => w.key)).not.toContain('familyToets');
  });
});

describe('schakelaar Woonnu-regels', () => {
  it('uit: verkochte woning telt voor 100% van de netto opbrengst, geen 2%-toets, geen opslag aflossingsvrij', () => {
    const off = run({ woonnuRules: false, currentHomeSold: true, cfFamilyLoanCovered: false, ...{} });
    expect(off.core.currentMortgage.saleValueForFinancing).toBeCloseTo(952222 - 10474.44, 6);
    expect(off.cf.warnings.map((w) => w.key)).not.toContain('familyToets');
    expect(off.cf.notes).toHaveLength(0);
    const on = run({ woonnuRules: true, currentHomeSold: true });
    expect(on.core.currentMortgage.saleValueForFinancing).toBeCloseTo(952222 * 0.98, 6);
  });

  it('uit: bonus telt volledig mee in het toetsinkomen', () => {
    const on = run({ avgBonus2: '4050' }).core.calc.combinedIncome;
    const off = run({ avgBonus2: '4050', woonnuRules: false }).core.calc.combinedIncome;
    expect(off - on).toBeCloseTo(2025, 6);
  });
});

describe('kasstromen: starter', () => {
  it('leent alleen wat bij levering nodig is (geen overschot), zonder verkoopmoment', () => {
    const { cf } = run({
      hasExistingHome: false,
      hasPartner2: false,
      income1: 80000,
      studyLoans: [],
      purchasePrice: 400000,
      ownCapital1: 40000,
      cfDepositFromFamily: false,
    });
    expect(cf.sale).toBeNull();
    expect(cf.surplusAtDelivery).toBe(0);
    expect(cf.mortgage).toBeCloseTo(cf.uses - 40000, 6);
    expect(cf.totalOwn).toBe(40000);
    expect(cf.balanced).toBe(true);
  });
});

describe('kasstromen: zonder overschreven maximum', () => {
  it('gebruikt de maximale totale hypotheek uit de toets', () => {
    const { cf, core } = run({});
    expect(cf.overridden).toBe(false);
    expect(cf.maxMortgage).toBeCloseTo(core.currentMortgage.portedDebt + core.combinedGap.additionalMortgageCapacity, 6);
    expect(cf.balanced).toBe(true);
  });

  it('meer bronnen dan nodig: geen familielening en een overschot bij levering', () => {
    const { cf } = run({ ...spreadsheet, cfMaxMortgage: '1330000', cfOwnFundsAtDelivery: '76000', cfDepositFromFamily: false });
    expect(cf.familyBridgeLoan).toBe(0);
    expect(cf.surplusAtDelivery).toBeCloseTo(1330000 + 76000 - 1361650, 2);
    expect(cf.balanced).toBe(true);
  });
});

describe('huidige woning al verkocht', () => {
  it('Woonnu: tot 98% van de verkoopprijs (nooit meer dan de netto opbrengst), geen 95% van de marktwaarde', () => {
    const open = run({}).core.currentMortgage;
    const sold = run({ currentHomeSold: true }).core.currentMortgage;
    expect(open.saleValueForFinancing).toBeCloseTo(935000 * 0.95, 6);
    expect(sold.saleValueForFinancing).toBeCloseTo(952222 * 0.98, 6); // 933.177,56 < netto 941.747,56
    expect(sold.usableOverwaarde).toBeCloseTo(952222 * 0.98 - sold.currentDebtBalance, 6);
    expect(sold.usableOverwaarde).toBeGreaterThan(open.usableOverwaarde);
    // Hoge verkoopkosten: dan begrenst de netto opbrengst.
    const costly = run({ currentHomeSold: true, saleCosts: '30000' }).core.currentMortgage;
    expect(costly.saleValueForFinancing).toBeCloseTo(952222 - 30000, 6);
  });

  it('meer overwaarde betekent minder nieuw geld nodig', () => {
    const open = run({}).core.combinedGap;
    const sold = run({ currentHomeSold: true }).core.combinedGap;
    expect(open.additionalMortgage - sold.additionalMortgage).toBeCloseTo(952222 * 0.98 - 935000 * 0.95, 4);
  });
});
