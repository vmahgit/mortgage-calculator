// Opbouw van "wat kunt u lenen": een rekenstaat van het inkomensgebaseerde beginbedrag tot het
// bedrag dat nieuw geleend kan worden, met elke afslag als eigen regel.
//
// Alle bedragen komen uit dezelfde rekenkern als de rest van de app (calcEngine.js); deze module
// rekent zelf niets na, maar legt de tussenstappen naast elkaar en controleert dat ze exact
// sluiten. Elke regel heeft het lopende bedrag ná de regel (`running`); `reconciles` is alleen
// waar als dat lopende bedrag op elk tussentotaal en aan het eind gelijk is aan wat de
// berekening zelf oplevert.

import { computeStarterGap, getLenderCap } from './calcEngine';

const EPS = 0.005;

// d: dossier, core: { calc, currentMortgage, combinedGap } uit computeCore.
export function buildCapacityBreakdown(d, core, starterGap = computeStarterGap(d, core.calc)) {
  const { calc, currentMortgage: cm, combinedGap: gap } = core;
  const cap = calc.capacity;
  const doorstromer = !!d.hasExistingHome;
  const rows = [];
  let running = 0;
  let maxError = 0;

  const start = (key, amount, meta) => {
    running = amount;
    rows.push({ key, type: 'start', amount, running, meta });
  };
  const delta = (key, amount, extra = {}) => {
    running += amount;
    rows.push({ key, type: 'delta', amount, running, ...extra });
  };
  // Tussentotaal: het lopende bedrag moet gelijk zijn aan wat de berekening zelf oplevert.
  const total = (key, expected, type = 'subtotal', meta) => {
    maxError = Math.max(maxError, Math.abs(running - expected));
    running = expected;
    rows.push({ key, type, amount: expected, running, meta });
  };

  // 1. Beginpunt: woonquote × toetsinkomen, gekapitaliseerd.
  start('income', cap.grossLoan, {
    toetsinkomen: calc.combinedIncome,
    woonquote: calc.woonquote,
    maxWoonlastMonthly: calc.maxWoonlastMonthly,
    rate: cap.rate,
    capitalizationFactor: cap.capitalizationFactor,
    toetsrenteApplies: calc.toetsrenteApplies,
  });

  // 2. Afslagen voor schulden en studieschuld (nominaal; zie 'floor' voor de ondergrens van € 0).
  const debtLines = [
    ['secondHome', cap.debtAfslag.secondHome, calc.secondHomeMonthly],
    ['otherDebts', cap.debtAfslag.otherDebts, calc.otherDebtMonthly],
    ['familyLoan', cap.debtAfslag.familyLoan, calc.familyLoanMonthlyDebt],
  ];
  let nominalAfslag = 0;
  for (const [key, afslag, monthly] of debtLines) {
    if (afslag > EPS) {
      delta(key, -afslag, { meta: { monthly, capitalizationFactor: cap.capitalizationFactor } });
      nominalAfslag += afslag;
    }
  }
  if (calc.studyAfslag > EPS) {
    const s = calc.studyDebt;
    delta('study', -calc.studyAfslag, {
      children: s.perLoan,
      meta: {
        factor: s.factor,
        debetrente: s.debetrente,
        debetrenteMode: s.debetrenteMode,
        weightedToets: s.weightedToets,
        weightedContract: s.weightedContract,
        afslagMethod: s.afslagMethod,
        afslagRatePct: s.afslagRatePct,
        totalTermijn: s.totalTermijn,
        totalToetslast: s.totalToetslast,
      },
    });
    nominalAfslag += calc.studyAfslag;
  }
  // De afslagen kunnen de leencapaciteit niet onder € 0 brengen.
  const appliedAfslag = cap.grossLoan - cap.loanAfterStudy;
  const floorCorrection = nominalAfslag - appliedAfslag;
  if (floorCorrection > EPS) delta('floor', floorCorrection);

  // 3. AOW-toets: bij een lager pensioeninkomen is dat bindend.
  const aowDelta = cap.boundMaxLoan - cap.loanAfterStudy;
  if (calc.pensionBinding && Math.abs(aowDelta) > EPS) delta('aow', aowDelta);

  // 4. Energielabelbonus.
  if (calc.energyBonus > 0) delta('energy', calc.energyBonus);

  total('incomeMax', calc.incomeBasedMax);

  let finalAmount;
  let maxTotalMortgage;
  let newMax = 0;
  let need;

  if (doorstromer) {
    // 5. Renterisico: meegenomen leningdelen korter dan 10 jaar rentevast worden tegen de
    //    toetsrente getoetst.
    const rateRisk = calc.incomeBasedMax - cm.effectiveMaxMortgage;
    if (rateRisk > EPS) {
      delta('rateRisk', -rateRisk, { children: cm.rateRiskParts.filter((p) => p.haircut > EPS) });
    }
    total('effectiveMax', cm.effectiveMaxMortgage);

    // 6. Wat al geleend is (meegenomen) gaat er af; de rest is de ruimte voor nieuw geld.
    if (cm.portedDebt > EPS) {
      delta('ported', -cm.portedDebt, { children: cm.rateRiskParts });
    }
    if (running < -EPS) delta('noRoom', -running);
    total('newMaxNibud', cm.extraBorrowCapacity);

    // 7. Plafond van de geldverstrekker op de totale hypotheek.
    const lenderCap = getLenderCap(d.lenderCapThreshold);
    if (gap.bindingCapIsLender) {
      delta('lenderCap', -(cm.extraBorrowCapacity - gap.lenderCapRoom), {
        meta: { lenderCap, lenderCapRoom: gap.lenderCapRoom },
      });
    }
    total('newMax', gap.additionalMortgageCapacity, 'total', { lenderCap, lenderCapRoom: gap.lenderCapRoom });

    newMax = gap.additionalMortgageCapacity;
    finalAmount = newMax;
    maxTotalMortgage = cm.portedDebt + newMax;
    need = {
      required: gap.additionalMortgage,
      capacity: newMax,
      margin: gap.capacityMargin,
      familyLoanApplied: gap.familyLoanApplied,
      netMargin: gap.netCapacityMargin,
      feasible: gap.withinCapacityAfterFamilyLoan,
      gap: gap.gap,
      ownCapitalApplied: gap.ownCapitalApplied,
      bindingCapIsLender: gap.bindingCapIsLender,
    };
  } else {
    const lenderCap = getLenderCap(d.lenderCapThreshold);
    if (starterGap.bindingCapIsLender) {
      delta('lenderCap', -(calc.incomeBasedMax - starterGap.capacity), {
        meta: { lenderCap, lenderCapRoom: lenderCap },
      });
    }
    total('maxMortgage', starterGap.capacity, 'total', { lenderCap });
    finalAmount = starterGap.capacity;
    maxTotalMortgage = starterGap.capacity;
    newMax = starterGap.capacity;
    need = {
      required: starterGap.requiredMortgage,
      capacity: starterGap.capacity,
      margin: starterGap.capacity - starterGap.requiredMortgage,
      cashShortfall: starterGap.cashShortfall,
      feasible: starterGap.feasible,
      bindingCapIsLender: starterGap.bindingCapIsLender,
    };
  }

  const sumOf = (key) => rows.filter((r) => r.key === key).reduce((s, r) => s + r.amount, 0);
  const afslagen = {
    debts: -(sumOf('secondHome') + sumOf('otherDebts') + sumOf('familyLoan')),
    study: -sumOf('study'),
    floor: sumOf('floor'),
    aow: -sumOf('aow'),
    rateRisk: -sumOf('rateRisk'),
    lenderCap: -sumOf('lenderCap'),
  };
  // Alle verlagingen van de leencapaciteit vóór het meegenomen bedrag, zonder energiebonus.
  afslagen.total = afslagen.debts + afslagen.study - afslagen.floor + afslagen.aow + afslagen.rateRisk;

  return {
    kind: doorstromer ? 'doorstromer' : 'starter',
    rate: cap.rate,
    rows,
    finalAmount,
    maxTotalMortgage,
    portedDebt: doorstromer ? cm.portedDebt : 0,
    newMax,
    need,
    afslagen,
    aow: {
      active: calc.pensionApplies && !calc.pensionIncomplete,
      incomplete: calc.pensionIncomplete,
      binding: calc.pensionBinding,
    },
    maxError,
    reconciles: maxError < 0.01 && Math.abs(running - finalAmount) < 0.01,
  };
}
