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
  it('de verkoopprijs min verkoopkosten telt voor 100% (geen verkoopafslag van 95%)', () => {
    const open = run({}).core.currentMortgage;
    const sold = run({ currentHomeSold: true }).core.currentMortgage;
    expect(open.saleValueForFinancing).toBeCloseTo(935000 * 0.95, 6);
    expect(sold.saleValueForFinancing).toBeCloseTo(952222 - 10474.44, 6);
    expect(sold.usableOverwaarde).toBeCloseTo(941747.56 - sold.currentDebtBalance, 6);
    expect(sold.usableOverwaarde).toBeGreaterThan(open.usableOverwaarde);
  });

  it('meer overwaarde betekent minder nieuw geld nodig', () => {
    const open = run({}).core.combinedGap;
    const sold = run({ currentHomeSold: true }).core.combinedGap;
    expect(open.additionalMortgage - sold.additionalMortgage).toBeCloseTo(941747.56 - 935000 * 0.95, 4);
  });
});
