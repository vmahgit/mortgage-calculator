// Kasstromen rond de aankoop: wat er op de leverdatum van de nieuwe woning betaald moet worden en
// waar dat vandaan komt, en wat er bij de verkoop (overdracht) van de huidige woning terugkomt.
//
// Opzet (zoals een geldverstrekker met meeneemregeling vóór verkoop het doet):
//   Levering: aankoopprijs + kosten koper = hypotheek nieuwe woning (meegenomen + nieuw geld)
//             + eigen middelen + waarborgsom geleend van familie + tijdelijke lening familie (sluitpost).
//             De bestaande hypotheek blijft tot de verkoop als overbrugging op de huidige woning staan.
//   Verkoop:  verkoopprijs − verkoopkosten − aflossing overbrugging = netto overwaarde;
//             daarmee wordt de familie terugbetaald; een tekort is extra eigen geld, een overschot komt vrij.
// De maximale hypotheek is standaard de uitkomst van de toets, maar kan worden overschreven (bijv. met
// het bedrag uit de berekening van de adviseur).

import { computeStarterGap, safeNum, toCurrentLoanParts } from './calcEngine';

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
  // Een hypotheek gaat niet boven 100% van de woningwaarde: kosten koper komen uit eigen middelen.
  const mortgage = Math.max(0, Math.min(maxMortgage, price));
  // Restschuld van de bestaande hypotheek op de leverdatum: dat bedrag gaat mee naar de nieuwe woning en
  // blijft tegelijk als overbrugging op de huidige woning staan tot de verkoop.
  const balanceAtDelivery = doorstromer
    ? toCurrentLoanParts(d.loanParts, d.startDate, deliveryDate || new Date()).reduce(
        (sum, p) => sum + safeNum(p.principal),
        0
      )
    : 0;
  const ported = doorstromer && d.takeOverMortgage ? Math.min(balanceAtDelivery, mortgage) : 0;
  const newMortgage = mortgage - ported;

  const ownAvailable = calc.totalOwnCapital;
  const ownAtDelivery =
    String(d.cfOwnFundsAtDelivery ?? '').trim() === '' ? ownAvailable : safeNum(d.cfOwnFundsAtDelivery);
  const depositLoan = d.cfDepositFromFamily ? (price * safeNum(d.cfDepositPct)) / 100 : 0;
  const sourcesBeforeFamily = mortgage + ownAtDelivery + depositLoan;
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
    const afterFamily = overwaardeNet - familyTotal;
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
    sale = {
      salePriceKnown,
      grossPrice,
      saleCosts,
      netProceeds,
      bridge,
      overwaardeNet,
      familyRepayment: familyTotal,
      afterFamily,
      extraOwnAtSale: Math.max(0, -afterFamily),
      surplusAtSale: Math.max(0, afterFamily),
      days,
      bridgeRateUsed,
      bridgeRateIsContract: bridgeRate == null,
      bridgeInterest,
      familyInterest,
      carryingCosts: bridgeInterest + familyInterest,
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
  if (maxMortgage > price + 0.5) {
    warnings.push({ key: 'ltv', text: 'Boven 100% van de koopsom wordt niet gefinancierd; het meerdere telt niet mee.' });
  }
  if (ownAtDelivery > ownAvailable + 0.5) {
    warnings.push({ key: 'own', text: 'U zet bij levering meer eigen middelen in dan als liquide eigen vermogen is ingevuld.' });
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
    depositLoan,
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
    warnings,
  };
}
