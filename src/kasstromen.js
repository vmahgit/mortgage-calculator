// Kasstromen rond de aankoop: wat er op de leverdatum van de nieuwe woning betaald moet worden en
// waar dat vandaan komt, en wat er bij de verkoop (overdracht) van de huidige woning terugkomt.
//
// Opzet (zoals een geldverstrekker met meeneemregeling vóór verkoop het doet):
//   Levering: aankoopprijs + kosten koper = hypotheek nieuwe woning (meegenomen + nieuw geld)
//             + eigen middelen + waarborgsom geleend van familie + overbruggingskrediet van de bank
//             + tijdelijke lening familie (sluitpost).
//   Waarborgsom: via een bankgarantie (kost 0,1% van de koopsom, zie kosten koper), of gestort uit eigen
//   geld, of gestort met een lening van familie (dan geen bankgarantie nodig).
//             De bestaande hypotheek blijft tot de verkoop als overbrugging op de huidige woning staan.
//   Verkoop:  verkoopprijs − verkoopkosten − aflossing overbrugging = netto overwaarde;
//             daarmee wordt de familie terugbetaald; een tekort is extra eigen geld, een overschot komt vrij.
// De maximale hypotheek is standaard de uitkomst van de toets, maar kan worden overschreven (bijv. met
// het bedrag uit de berekening van de adviseur).

import {
  computeStarterGap,
  getLenderRules,
  getCapitalizationFactor,
  getLtvBasis,
  safeNum,
  toCurrentLoanParts,
} from './calcEngine';

const DAY = 24 * 60 * 60 * 1000;

function parseDate(value) {
  const t = new Date(value);
  return isNaN(t.getTime()) ? null : t;
}

export function computeCashflow(d, core) {
  const { calc, currentMortgage: cm, combinedGap: gap } = core;
  const doorstromer = !!d.hasExistingHome;
  const price = safeNum(d.purchasePrice);
  const kostenKoperItems = calc.kostenKoper.items.filter((i) => i.included && i.amount > 0);
  const kostenKoper = calc.kostenKoper.total;
  const uses = price + kostenKoper;

  const deliveryDate = parseDate(d.purchaseTransferDate);
  const saleDate = parseDate(d.saleTransferDate);

  // Maximale hypotheek voor de nieuwe woning: uitkomst van de toets of de overschreven waarde.
  const toolMax = doorstromer
    ? cm.portedDebt + gap.additionalMortgageCapacity
    : computeStarterGap(d, calc).capacity;
  const overridden = String(d.cfMaxMortgage ?? '').trim() !== '';
  const maxMortgage = overridden ? safeNum(d.cfMaxMortgage) : toolMax;
  // Een hypotheek gaat niet boven 100% van de waarde van de woning (taxatie, anders de koopsom).
  const ltvBasis = getLtvBasis(d);
  let mortgage = Math.max(0, Math.min(maxMortgage, ltvBasis));
  // Restschuld van de bestaande hypotheek op de leverdatum: dat bedrag gaat mee naar de nieuwe woning en
  // blijft tegelijk als overbrugging op de huidige woning staan tot de verkoop.
  const balanceAtDelivery = doorstromer
    ? toCurrentLoanParts(d.loanParts, d.startDate, deliveryDate || new Date()).reduce(
        (sum, p) => sum + safeNum(p.principal),
        0
      )
    : 0;
  const ported = doorstromer && d.takeOverMortgage ? Math.min(balanceAtDelivery, mortgage) : 0;

  const ownAvailable = calc.totalOwnCapital;
  const ownAtDelivery =
    String(d.cfOwnFundsAtDelivery ?? '').trim() === '' ? ownAvailable : safeNum(d.cfOwnFundsAtDelivery);
  const depositMethod = d.includeBankGuarantee ? 'bankgarantie' : d.cfDepositFromFamily ? 'familie' : 'eigen';
  const depositAmount = (price * safeNum(d.cfDepositPct)) / 100;
  const depositLoan = depositMethod === 'familie' ? depositAmount : 0;
  // Overbruggingskrediet van de bank (zelfde invoer als bij de dubbele-lastentoets): leeg bedrag = de
  // bruikbare overwaarde.
  const bridgeCredit =
    doorstromer && d.useBridgeLoan
      ? String(d.bridgeLoanAmount ?? '').trim() === ''
        ? cm.usableOverwaarde
        : safeNum(d.bridgeLoanAmount)
      : 0;
  // Een starter heeft geen latere instroom uit een verkoop en leent alleen wat bij levering nodig is;
  // een doorstromer leent het maximum, omdat de overwaarde pas bij de verkoop binnenkomt.
  if (!doorstromer) {
    mortgage = Math.min(mortgage, Math.max(0, uses - ownAtDelivery - depositLoan - bridgeCredit));
  }
  const newMortgage = mortgage - ported;
  const sourcesBeforeFamily = mortgage + ownAtDelivery + depositLoan + bridgeCredit;
  const familyBridgeLoan = Math.max(0, uses - sourcesBeforeFamily);
  const surplusAtDelivery = Math.max(0, sourcesBeforeFamily - uses);
  const familyTotal = depositLoan + familyBridgeLoan;
  const sources = sourcesBeforeFamily + familyBridgeLoan;

  // Verkoop van de huidige woning. De bestaande hypotheek blijft tot dan als overbrugging staan; af te
  // lossen is de restschuld op de leverdatum (een overbrugging lost niet af).
  let sale = null;
  if (doorstromer) {
    const refDate = deliveryDate || new Date();
    const bridge = balanceAtDelivery;
    const salePriceKnown = safeNum(d.salePrice) > 0;
    const grossPrice = salePriceKnown ? safeNum(d.salePrice) : safeNum(d.marketValue);
    const saleCosts = safeNum(d.saleCosts);
    const netProceeds = grossPrice - saleCosts;
    const overwaardeNet = netProceeds - bridge;
    const afterBridgeCredit = overwaardeNet - bridgeCredit;
    const afterFamily = afterBridgeCredit - familyTotal;
    const days = deliveryDate && saleDate ? Math.max(0, Math.round((saleDate - deliveryDate) / DAY)) : 0;
    const bridgeRate =
      String(d.cfBridgeRatePct ?? '').trim() === '' ? null : safeNum(d.cfBridgeRatePct);
    // Zonder opgegeven overbruggingsrente: de huidige contractrente, gewogen over de leningdelen.
    const parts = toCurrentLoanParts(d.loanParts, d.startDate, refDate);
    const weightedRate =
      bridge > 0 ? parts.reduce((s, p) => s + safeNum(p.principal) * safeNum(p.rate), 0) / bridge : 0;
    const bridgeRateUsed = bridgeRate ?? weightedRate;
    const bridgeInterest = (bridge * bridgeRateUsed) / 100 * (days / 365);
    const familyInterest = (familyTotal * safeNum(d.familyLoanRate)) / 100 * (days / 365);
    const bridgeCreditInterest = (bridgeCredit * safeNum(d.bridgeLoanRate)) / 100 * (days / 365);
    sale = {
      salePriceKnown,
      grossPrice,
      saleCosts,
      netProceeds,
      bridge,
      overwaardeNet,
      bridgeCreditRepayment: bridgeCredit,
      afterBridgeCredit,
      familyRepayment: familyTotal,
      afterFamily,
      extraOwnAtSale: Math.max(0, -afterFamily),
      surplusAtSale: Math.max(0, afterFamily),
      days,
      bridgeRateUsed,
      bridgeRateIsContract: bridgeRate == null,
      bridgeInterest,
      familyInterest,
      bridgeCreditInterest,
      carryingCosts: bridgeInterest + familyInterest + bridgeCreditInterest,
    };
  }

  // Totale eigen inbreng (netto): bij levering plus wat er bij de verkoop bij moet, min wat er vrijkomt.
  const totalOwn =
    ownAtDelivery - surplusAtDelivery + (sale ? sale.extraOwnAtSale - sale.surplusAtSale : 0);
  const totalOwnInclCosts = totalOwn + (sale ? sale.carryingCosts : 0);
  const partner2Share = d.hasPartner2
    ? Math.min(
        Math.max(0, totalOwn),
        String(d.cfOwnFundsPartner2 ?? '').trim() === '' ? safeNum(d.ownCapital2) : safeNum(d.cfOwnFundsPartner2)
      )
    : 0;

  const warnings = [];
  if (overridden && maxMortgage > toolMax + 0.5) {
    warnings.push({
      key: 'aboveTool',
      amount: maxMortgage - toolMax,
      text: 'De ingevulde maximale hypotheek is hoger dan wat de toets in deze tool toelaat.',
    });
  }
  if (maxMortgage > ltvBasis + 0.5) {
    warnings.push({
      key: 'ltv',
      text: 'Boven 100% van de waarde van de woning (taxatie, anders de koopsom) wordt niet gefinancierd; het meerdere telt niet mee.',
    });
  }
  if (ownAtDelivery > ownAvailable + 0.5) {
    warnings.push({ key: 'own', text: 'U zet bij levering meer eigen middelen in dan als liquide eigen vermogen is ingevuld.' });
  }
  // Woonnu toetst een lening van familie als last van 2% per maand over de hoofdsom (acceptatiegids 4.4).
  // Zolang die lening bij de aanvraag bestaat, gaat dat van de leencapaciteit af.
  const rules = getLenderRules(d);
  const familyTestMonthly = rules.thirdPartyLoanPct != null ? (familyTotal * rules.thirdPartyLoanPct) / 100 : 0;
  const familyCapacityImpact = familyTestMonthly * getCapitalizationFactor(calc.testRate);
  const notes = [];
  if (familyTotal > 0 && rules.woonnu && d.cfFamilyLoanCovered) {
    notes.push({
      key: 'familyCovered',
      text: 'De familielening is volgens uw opgave afgedekt (extra onderpand of aantoonbaar ander vermogen) en telt daarom niet mee in de toets. Laat dit door uw adviseur bij Woonnu bevestigen; zonder die afspraak toetst Woonnu haar op 2% per maand van de hoofdsom.',
    });
  }
  if (familyTotal > 0 && rules.woonnu && !d.cfFamilyLoanCovered) {
    warnings.push({
      key: 'familyToets',
      amount: familyCapacityImpact,
      monthly: familyTestMonthly,
      text: `Woonnu rekent een lening van familie mee als last van 2% per maand van de hoofdsom (acceptatiegids 4.4): ${Math.round(
        familyTestMonthly
      ).toLocaleString('nl-NL')} euro per maand. Bestaat de lening al bij de aanvraag, dan daalt de leencapaciteit met ca. ${Math.round(
        familyCapacityImpact
      ).toLocaleString('nl-NL')} euro. Het overbruggingskrediet van Woonnu telt niet mee in de toets (tot 95% van de marktwaarde, of 98% van de verkoopprijs als de woning verkocht is).`,
    });
  }
  if (deliveryDate && saleDate && saleDate < deliveryDate) {
    warnings.push({ key: 'dates', text: 'De verkoop is vóór de levering: dan is er geen overbrugging nodig.' });
  }

  return {
    price,
    kostenKoperItems,
    kostenKoper,
    uses,
    toolMax,
    overridden,
    maxMortgage,
    mortgage,
    ported,
    newMortgage,
    ownAvailable,
    ownAtDelivery,
    depositMethod,
    depositAmount,
    depositLoan,
    bridgeCredit,
    familyBridgeLoan,
    familyTotal,
    surplusAtDelivery,
    sources,
    balanced: Math.abs(sources - surplusAtDelivery - uses) < 0.005,
    sale,
    totalOwn,
    totalOwnInclCosts,
    ownExKostenKoper: totalOwn - kostenKoper,
    partner2Share,
    partner1Share: totalOwn - partner2Share,
    familyTestMonthly,
    familyCapacityImpact,
    warnings,
    notes,
  };
}
