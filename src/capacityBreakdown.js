// Opbouw van "wat kunt u lenen": een rekenstaat van het inkomensgebaseerde beginbedrag tot het
// bedrag dat nieuw geleend kan worden, met elke afslag als eigen regel.
//
// Alle bedragen komen uit dezelfde rekenkern als de rest van de app (calcEngine.js); deze module
// rekent zelf niets na, maar legt de tussenstappen naast elkaar en controleert dat ze exact
// sluiten. Elke regel heeft het lopende bedrag ná de regel (`running`); `reconciles` is alleen
// waar als dat lopende bedrag op elk tussentotaal en aan het eind gelijk is aan wat de
// berekening zelf oplevert.

import { computeStarterGap, getLenderCap } from './calcEngine';
import { getWoonquote } from './nibud2026';

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

  // 4. Energielabelbonus en alleenstaandenbedrag (beide buiten de financieringslast).
  if (calc.energyBonus > 0) delta('energy', calc.energyBonus);
  if (calc.singleBonus > 0) delta('single', calc.singleBonus);

  total('incomeMax', calc.incomeBasedMax, 'subtotal', { rate: cap.rate });

  let finalAmount;
  let maxTotalMortgage;
  let newMax = 0;
  let need;

  if (doorstromer) {
    const comp = cm.compositeBinding;
    if (comp) {
      // 5. Meegenomen leningdelen: elk deel neemt zijn eigen toetslast (eigen toetsrente,
      //    annuïtair) uit de woonlast; omgerekend naar euro's tegen de rente van het nieuwe geld.
      //    Een deel met een lang vastgezette lage rente kost zo minder leenruimte dan zijn saldo.
      const used = comp.parts.reduce((s, p) => s + p.capacityUsed, 0);
      delta('ported', -used, {
        children: comp.parts,
        meta: { portedDebt: cm.portedDebt, capitalizationFactor: comp.capitalizationFactor },
      });
      // 6. Woonquote bij de gewogen toetsrente van de hele samenstelling i.p.v. de rente van het
      //    nieuwe geld (andere tabelkolom).
      const baseWoonquote = calc.pensionBinding
        ? null
        : getWoonquote(calc.combinedIncome, cap.rate);
      if (baseWoonquote !== null && comp === cm.composite) {
        const mix =
          ((comp.woonquote - baseWoonquote) * calc.combinedIncome) / 12 * comp.capitalizationFactor;
        if (Math.abs(mix) > EPS && cm.extraBorrowCapacity > EPS && !comp.cappedAtBand) {
          delta('woonquoteMix', mix, {
            meta: {
              woonquote: comp.woonquote,
              baseWoonquote,
              weightedRate: comp.weightedRate,
              band: comp.band,
              newRate: cap.rate,
            },
          });
        }
      }
      // 7. Restverschil: ondergrens € 0, een bedrag op de rand van een tabelkolom of een AOW-toets
      //    die pas in de samenstelling bindend wordt.
      const rest = cm.extraBorrowCapacity - running;
      if (Math.abs(rest) > EPS) {
        const key =
          cm.extraBorrowCapacity <= EPS
            ? 'noRoom'
            : comp.cappedAtBand
              ? 'bandEdge'
              : comp === cm.compositePension
                ? 'aowComposite'
                : 'compositeRest';
        delta(key, rest, { meta: { band: comp.band, weightedRate: comp.weightedRate } });
      }
    }
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
      kostenKoperFinanced: gap.kostenKoperFinanced,
      kostenKoperCashShortfall: gap.kostenKoperCashShortfall,
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
    lenderCap: -sumOf('lenderCap'),
  };
  // Effect van de toets per leningdeel t.o.v. "meegenomen saldo telt euro voor euro": positief =
  // de samenstelling kost leenruimte (deel tegen AFM-toetsrente, hogere woonquote-kolom e.d.),
  // negatief = lang vastgezette lage rente levert ruimte op.
  const compositeKeys = ['ported', 'woonquoteMix', 'bandEdge', 'aowComposite', 'compositeRest', 'noRoom'];
  const compositeNet = compositeKeys.reduce((s, k) => s + sumOf(k), 0);
  const portedDebt = doorstromer ? cm.portedDebt : 0;
  const compositeEffect = doorstromer && cm.compositeBinding ? -(compositeNet + portedDebt) : 0;
  afslagen.composite = Math.max(0, compositeEffect);
  afslagen.compositeBenefit = Math.max(0, -compositeEffect);
  // Alle verlagingen van de leencapaciteit vóór het meegenomen bedrag, zonder bonussen.
  afslagen.total = afslagen.debts + afslagen.study - afslagen.floor + afslagen.aow + afslagen.composite;

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
