// Rekenverantwoording: een volledig, reproduceerbaar overzicht van de berekening (invoer, toetsregels,
// rekenstappen met formules en alle afslagen) om te delen met een hypotheekadviseur.
//
// Dit bestand bouwt alleen gegevens (platte, JSON-vriendelijke blokken); de weergave als PDF staat in
// reportPdf.js, de tekstvariant onderaan dit bestand. Alle bedragen komen uit dezelfde rekenkern als
// het scherm (calcEngine.js, capacityBreakdown.js): hier wordt niets opnieuw uitgerekend behalve de
// formules die de tussenstappen laten zien, en die worden in de tests tegen de kern gecontroleerd.

import {
  ADDITIONAL_SPLIT_MODES,
  REGULATION_YEAR,
  getLenderRules,
  TERM_MONTHS,
  TOETSRENTE,
  buildDebetrenteParts,
  calculateLoanPart,
  findMaxAffordablePrice,
  getElapsedMonths,
  getLenderCap,
  getTestRate,
  safeNum,
  testLoanComposition,
  toCurrentLoanParts,
} from './calcEngine';
import { getIncomeRow, getToetsrenteBand } from './nibud2026';
import { INCOME_TYPES } from './toetsinkomen';
import { computeCashflow } from './kasstromen';
import {
  STUDY_DEBT_CONFIG_BY_YEAR,
  getPartToetsrente,
  getStudyDebtConfig,
} from './studieschuld';

export const REPORT_VERSION = 1;
export const DOSSIER_FILE_TYPE = 'hypotheekcalculator-dossier';

// ----------------------------------------------------------------------------- opmaak
const nf0 = new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const eur = (v) => {
  const n = Math.round(safeNum(v));
  return `${n < 0 ? '- ' : ''}€ ${nf0.format(Math.abs(n))}`;
};
export const eur2 = (v) => {
  const n = Math.round(safeNum(v) * 100) / 100;
  return `${n < 0 ? '- ' : ''}€ ${nf2.format(Math.abs(n))}`;
};
// Signed delta voor de afslagentabel: "- € 35.692" / "+ € 10.000".
const signed = (v) => `${v < 0 ? '-' : '+'} € ${nf0.format(Math.abs(Math.round(v)))}`;
// Percentage uit een waarde in procenten (4,69 -> "4,69%").
const pct = (v, dec = 2) => `${safeNum(v).toFixed(dec).replace('.', ',')}%`;
// Percentage uit een fractie (0,292 -> "29,20%").
const frac = (v, dec = 2) => pct(safeNum(v) * 100, dec);
const num2 = (v) => nf2.format(safeNum(v));
const num3 = (v) => safeNum(v).toFixed(3).replace('.', ',');
const yesNo = (v) => (v ? 'Ja' : 'Nee');
const dateNL = (iso) => {
  const [y, m, day] = String(iso).slice(0, 10).split('-');
  return `${day}-${m}-${y}`;
};
const bandTextOf = (band) => {
  if (band.lower == null) return `t/m ${num3(band.upper)}%`;
  if (!Number.isFinite(band.upper)) return `vanaf ${num3(band.lower)}%`;
  return `${num3(band.lower)}% t/m ${num3(band.upper)}%`;
};
const monthsText = (m) => {
  const y = Math.floor(m / 12);
  const r = Math.round(m % 12);
  return r === 0 ? `${y} jaar` : `${y} jaar ${r} mnd`;
};

// ----------------------------------------------------------------------------- blokken
const kv = (rows) => ({ type: 'kv', rows });
const table = (head, rows, opts = {}) => ({ type: 'table', head, rows, ...opts });
const text = (t, style = 'normal') => ({ type: 'text', text: t, style });
const heading = (t) => ({ type: 'heading', text: t });
const step = (n, title, lines, result) => ({ type: 'step', n, title, lines, result });

// ----------------------------------------------------------------------------- scenario voor Excel
// Zet het dossier om naar het invoerformaat van het Excel-toetsmodel (docs/toetsmodel, kolom M).
// Excel kent bewust minder opties: zie unsupportedFeatures().
export const EXCEL_INPUT_LABELS = [
  ['door', 'Doorstromer (bestaande woning)?'],
  ['two', 'Twee aanvragers?'],
  ['inc1', 'Toetsinkomen aanvrager 1'],
  ['inc2', 'Toetsinkomen aanvrager 2'],
  ['age1', 'Leeftijd aanvrager 1'],
  ['age2', 'Leeftijd aanvrager 2'],
  ['pen1', 'Verwacht pensioeninkomen aanvrager 1 (bij ≥ 57 jaar)'],
  ['pen2', 'Verwacht pensioeninkomen aanvrager 2 (bij ≥ 57 jaar)'],
  ['label', 'Energielabel woning'],
  ['rate', 'Rente nieuwe hypotheek'],
  ['fixed', 'Rentevaste periode nieuwe hypotheek'],
  ['price', 'Aankoopprijs beoogde woning'],
  ['cap', 'Plafond totale hypotheek bij geldverstrekker'],
  ['debt1', 'Overige schulden aanvrager 1 (kredietbedrag)'],
  ['debt2', 'Overige schulden aanvrager 2 (kredietbedrag)'],
  ['fam', 'Maandelijkse aflossing familielening'],
  ['studyTerm', 'Studieschuld: totaal maandbedrag DUO (alle leningen)'],
  ['studyMode', 'Studieschuld: debetrente voor opslagfactor'],
  ['studyMethod', 'Studieschuld: kapitaliseren tegen'],
  ['sh_active', 'Tweede woning met hypotheek aanhouden?'],
  ['sh_debt', 'Hypotheekschuld tweede woning'],
  ['sh_rate', 'Rente tweede woning'],
  ['sh_type', 'Aflosvorm tweede woning'],
  ['sh_years', 'Resterende looptijd tweede woning'],
  ['sh_fixed', 'Resterende rentevaste periode tweede woning'],
  ['takeover', 'Hypotheek meenemen naar de nieuwe woning?'],
  ['termBasis', 'Looptijd voor toetslast meegenomen delen'],
  ['start', 'Ingangsdatum hypotheek'],
  ['peil', 'Peildatum (restsaldi)'],
  ['mv', 'Marktwaarde huidige woning'],
  ['discount', 'Verkoopwaarde als % van marktwaarde (voorzichtig)'],
  ['own', 'Eigen geld (liquide) voor de aankoop'],
  ['tax', 'Overdrachtsbelasting'],
  ['notary', 'Notaris'],
  ['val', 'Taxatie'],
  ['adv', 'Hypotheekadvies en bemiddeling'],
  ['bg', 'Bankgarantie meenemen?'],
  ['agent', 'Aankoopmakelaar meenemen?'],
  ['kk', 'Kosten koper meetellen in de toets?'],
];

export function toScenarioSpec(d, core, refDate = new Date()) {
  const { calc } = core;
  const iso = (dt) => new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const parts = toCurrentLoanParts(d.loanParts, d.startDate, refDate).slice(0, 4).map((p) => ({
    type: p.type,
    bal: Math.round(safeNum(p.principal) * 100) / 100,
    rate: safeNum(p.rate) / 100,
    fix: safeNum(p.originalFixedYears),
  }));
  while (parts.length < 4) parts.push({ type: 'Annuïteit', bal: 0, rate: 0.03, fix: 10 });
  const shActive = !!d.hasSecondHome && !d.secondHomeWillSell;
  return {
    name: 'Export uit calculator',
    doorstromer: !!d.hasExistingHome,
    twee: !!d.hasPartner2,
    inc1: Math.round(calc.toets1.toetsinkomen),
    inc2: d.hasPartner2 ? Math.round(calc.toets2.toetsinkomen) : 0,
    age1: safeNum(d.age1),
    age2: safeNum(d.age2),
    pen1: safeNum(d.pensionIncome1),
    pen2: safeNum(d.pensionIncome2),
    label: d.energyLabel,
    rate: safeNum(d.rate) / 100,
    fixed: safeNum(d.fixedRatePeriod),
    debt1: safeNum(d.debt1),
    debt2: d.hasPartner2 ? safeNum(d.debt2) : 0,
    famMonthly: Math.round(calc.familyLoanMonthlyDebt),
    sh: {
      active: shActive,
      debt: safeNum(d.secondHomeMortgageDebt),
      rate: safeNum(d.secondHomeInterestRate) / 100,
      type: d.secondHomeRepaymentType,
      years: safeNum(d.secondHomeRemainingYears),
      fixed: safeNum(d.secondHomeFixedYears),
    },
    studyTerm: Math.round(calc.studyDebt.totalTermijn * 100) / 100,
    studyMode: d.studyDebtRateMode === 'contract' ? 'Contractrente' : 'Gewogen toetsrente',
    studyMethod: d.studyDebtAfslagMethod === 'gewogen' ? 'Gewogen' : 'Marginaal',
    takeover: !!d.takeOverMortgage,
    termBasis: d.portedTermBasis === '30jaar' ? '30 jaar' : 'Resterend',
    peil: iso(refDate),
    start: String(d.startDate).slice(0, 10),
    parts,
    price: safeNum(d.purchasePrice),
    // Al verkocht: de verkoopprijs min verkoopkosten telt voor 100% (zelfde uitkomst als in de app).
    mv:
      d.currentHomeSold && safeNum(d.salePrice) > 0
        ? Math.min(safeNum(d.salePrice) * (getLenderRules(d).soldFinancingPct / 100), safeNum(d.salePrice) - safeNum(d.saleCosts))
        : safeNum(d.marketValue),
    discount: d.currentHomeSold && safeNum(d.salePrice) > 0 ? 1 : safeNum(d.saleDiscountPercentage) / 100,
    own: Math.round(calc.totalOwnCapital),
    tax: calc.transferTaxInfo.rate,
    notary: safeNum(d.notaryCosts),
    val: safeNum(d.valuationCosts),
    adv: safeNum(d.advisoryCosts),
    bg: !!d.includeBankGuarantee,
    agent: !!d.includeBuyersAgent,
    kk: !!d.includeKostenKoperInCalc,
    cap: getLenderCap(d.lenderCapThreshold),
  };
}

// Instellingen die het Excel-toetsmodel niet kent; bij deze dossiers wijkt Excel (bewust) af.
export function unsupportedFeatures(d) {
  const list = [];
  if (d.includeNhgFee) list.push('NHG-borgtochtprovisie is aangezet (Excel rekent zonder NHG-provisie).');
  if (d.limitOwnContribution) list.push('Een limiet op de eigen inleg is actief (niet in Excel).');
  if (d.useFamilyLoan && safeNum(d.familyLoanAmount) > 0) {
    list.push('Een familielening als bedrag springt in bij het tekort (Excel kent alleen de maandelijkse aflossing als last).');
  }
  if (d.useBridgeLoan) list.push('Een overbruggingskrediet is aangezet (niet in Excel).');
  if (safeNum(d.appraisalValue) > 0 && safeNum(d.appraisalValue) !== safeNum(d.purchasePrice)) {
    list.push('Een taxatiewaarde die afwijkt van de koopsom bepaalt de 100%-grens (Excel rekent met de koopsom).');
  }
  if (d.loanParts.length > 4) list.push('Meer dan 4 meegenomen leningdelen: Excel kent er maximaal 4.');
  const flexIncome = [d.incomeType1, d.hasPartner2 ? d.incomeType2 : 'vast'].some((t) => t && t !== 'vast');
  if (flexIncome) list.push('Flex- of ZZP-inkomen: in Excel voert u het uiteindelijke toetsinkomen in (hieronder opgenomen).');
  return list;
}

function formatSpecValue(key, v) {
  if (typeof v === 'boolean') return yesNo(v);
  if (['rate', 'sh_rate', 'discount', 'tax'].includes(key)) return frac(v);
  if (['start', 'peil'].includes(key)) return dateNL(v);
  if (typeof v === 'number') return key.startsWith('age') || key === 'fixed' || key === 'sh_years' || key === 'sh_fixed' ? String(v) : nf0.format(v);
  return String(v);
}

export function excelInputRows(spec) {
  const flat = {
    door: spec.doorstromer, two: spec.twee, inc1: spec.inc1, inc2: spec.inc2, age1: spec.age1, age2: spec.age2,
    pen1: spec.pen1, pen2: spec.pen2, label: spec.label, rate: spec.rate, fixed: spec.fixed, price: spec.price,
    cap: spec.cap, debt1: spec.debt1, debt2: spec.debt2, fam: spec.famMonthly, studyTerm: spec.studyTerm,
    studyMode: spec.studyMode, studyMethod: spec.studyMethod, sh_active: spec.sh.active, sh_debt: spec.sh.debt,
    sh_rate: spec.sh.rate, sh_type: spec.sh.type, sh_years: spec.sh.years, sh_fixed: spec.sh.fixed,
    takeover: spec.takeover, termBasis: spec.termBasis, start: spec.start, peil: spec.peil, mv: spec.mv,
    discount: spec.discount, own: spec.own, tax: spec.tax, notary: spec.notary, val: spec.val, adv: spec.adv,
    bg: spec.bg, agent: spec.agent, kk: spec.kk,
  };
  const rows = EXCEL_INPUT_LABELS.map(([key, label]) => [label, formatSpecValue(key, flat[key])]);
  spec.parts.forEach((p, i) => {
    if (!(p.bal > 0)) return;
    rows.push([`Deel ${i + 1}: aflosvorm`, p.type]);
    rows.push([`Deel ${i + 1}: restsaldo op peildatum`, eur2(p.bal)]);
    rows.push([`Deel ${i + 1}: contractrente`, frac(p.rate)]);
    rows.push([`Deel ${i + 1}: oorspronkelijke rentevaste periode`, `${p.fix}`]);
  });
  return rows;
}

// ----------------------------------------------------------------------------- hoofdfunctie
// d: dossier (dossierSnapshot), core: { calc, currentMortgage, combinedGap },
// breakdown: buildCapacityBreakdown(...), starterGap: computeStarterGap(...).
export function buildCalculationReport(
  d,
  core,
  { breakdown, starterGap, generatedAt = new Date(), appVersion = 'dev', includeSolver = true } = {}
) {
  const { calc, currentMortgage: cm, combinedGap: gap } = core;
  const door = !!d.hasExistingHome;
  const b = breakdown;
  const cap = calc.capacity;
  const f = cap.capitalizationFactor;
  const refDate = generatedAt;
  const peilIso = new Date(refDate.getTime() - refDate.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const spec = toScenarioSpec(d, core, refDate);
  const warnings = [];
  const sections = [];

  // ---- 1. Uitkomst
  const feasible = door ? gap.withinCapacityAfterFamilyLoan : starterGap.feasible;
  const margin = door ? gap.netCapacityMargin : starterGap.capacity - starterGap.requiredMortgage;
  const lenderBinding = door ? gap.bindingCapIsLender : starterGap.bindingCapIsLender;
  const maxPrice = includeSolver ? findMaxAffordablePrice(d) : null;
  const headlineRows = [
    ['Type', door ? 'Doorstromer (bestaande woning met hypotheek)' : 'Starter (nog geen eigen woning)'],
    ['Peildatum berekening', dateNL(peilIso)],
    ['Aankoopprijs beoogde woning', eur(d.purchasePrice)],
    [door ? 'Maximale totale hypotheek' : 'Maximale hypotheek', eur(b.maxTotalMortgage)],
  ];
  if (door) {
    headlineRows.push(['   waarvan meegenomen (al geleend)', eur(b.portedDebt)]);
    headlineRows.push(['   waarvan nieuw te lenen (maximum)', eur(b.newMax)]);
  }
  headlineRows.push([door ? 'Nieuw geld nodig voor deze aankoopprijs' : 'Hypotheek nodig voor deze aankoopprijs', eur(b.need.required)]);
  headlineRows.push([margin >= 0 ? 'Ruimte over' : 'Tekort', eur(Math.abs(margin))]);
  headlineRows.push(['Haalbaar?', feasible ? 'Ja, deze woning past' : 'Nee, deze woning past nog niet']);
  headlineRows.push(['Bepalende grens', lenderBinding ? 'Plafond van de geldverstrekker' : 'Inkomen (Nibud-woonquote)']);
  if (maxPrice != null) headlineRows.push(['Hoogste haalbare aankoopprijs (kosten koper meegerekend)', eur(maxPrice)]);
  const uitkomstBlocks = [kv(headlineRows)];
  const newParts = (door ? d.additionalLoanParts : d.starterLoanParts).filter((p) => safeNum(p.principal) > 0);
  if (newParts.length > 0) {
    let newGross = 0;
    const partRows = newParts.map((p) => {
      const r = calculateLoanPart(p, 0, peilIso);
      newGross += r.grossMonthly;
      return [p.type, eur(p.principal), pct(p.rate), `${p.originalFixedYears} jaar`, eur2(r.interestMonthly), eur2(r.principalMonthly), eur2(r.grossMonthly)];
    });
    uitkomstBlocks.push(heading('Nieuwe financiering (gekozen leningdelen)'));
    uitkomstBlocks.push(
      table(['Vorm', 'Bedrag', 'Rente', 'Rentevast', 'Rente p/m', 'Aflossing p/m', 'Bruto p/m'], partRows, {
        align: ['left', 'right', 'right', 'right', 'right', 'right', 'right'],
      })
    );
    // Toets van precies deze verdeling, op dezelfde manier als het scherm: elk deel annuïtair tegen
    // zijn toetsrente (AFM-toetsrente bij < 10 jaar rentevast), samen met de meegenomen delen.
    const common = {
      ported: door && d.takeOverMortgage ? cm.portedParts : [],
      newParts: newParts.map((p) => ({
        balance: safeNum(p.principal),
        testRate: getTestRate(p.rate, p.originalFixedYears),
        termMonths: TERM_MONTHS,
      })),
      refRate: calc.testRate,
      monthlyDebt: calc.monthlyDebt,
      studyAfslag: calc.studyAfslag,
    };
    const income = testLoanComposition({ ...common, income: calc.combinedIncome, bonus: calc.energyBonus + calc.singleBonus });
    const pension = calc.pensionActive
      ? testLoanComposition({ ...common, income: calc.pensionCombinedIncome, aow: true, bonus: calc.energyBonus + calc.pensionSingleBonus })
      : null;
    const bind = pension && pension.margin < income.margin ? pension : income;
    const rows = [
      ['Totale bruto maandlast nieuwe leningdelen', eur2(newGross)],
      ...(door && d.takeOverMortgage ? [['Bruto maandlast meegenomen leningdelen (werkelijke rente)', eur2(cm.totalGross)], ['Totale bruto maandlast', eur2(newGross + cm.totalGross)]] : []),
      ['Toets van deze verdeling: gewogen toetsrente (bij het benodigde bedrag)', pct(bind.weightedRate, 3)],
      ['Toets van deze verdeling: ruimte (+) of tekort (-)', eur(bind.margin)],
    ];
    uitkomstBlocks.push(kv(rows));
    uitkomstBlocks.push(text('Bruto maandlasten zijn werkelijk te betalen bedragen vóór hypotheekrenteaftrek; de toets rekent met annuïteiten tegen de toetsrente (zie sectie 4).', 'note'));
  }
  sections.push({ id: 'uitkomst', title: '1. Uitkomst', blocks: uitkomstBlocks });

  // ---- 2. Samenvatting afslagen
  const A = b.afslagen;
  const rowLabel = {
    income: 'Leencapaciteit op inkomen (woonquote × inkomen, gekapitaliseerd)',
    secondHome: 'Tweede woning aanhouden (toetslast × factor)',
    otherDebts: 'Overige schulden (2% per maand × factor)',
    familyLoan: 'Familielening, maandelijkse aflossing (× factor)',
    study: 'Studieschuld (toetslast ÷ betalingsfactor)',
    floor: 'Correctie: afslagen kunnen de capaciteit niet onder € 0 brengen',
    aow: 'AOW-toets: lagere capaciteit op pensioeninkomen',
    energy: `Energielabelbonus (label ${d.energyLabel})`,
    single: 'Alleenstaandenbedrag',
    incomeMax: door
      ? `Maximale hypotheek o.b.v. inkomen (alles als nieuw geld tegen ${pct(cap.rate)})`
      : 'Maximale hypotheek o.b.v. inkomen',
    ported: 'Meegenomen hypotheek: toetslast per leningdeel × factor',
    woonquoteMix: 'Woonquote bij de gewogen toetsrente (andere tabelkolom)',
    bandEdge: 'Begrensd op de rand van een woonquote-kolom',
    aowComposite: 'AOW-toets op de samenstelling',
    compositeRest: 'Woonquote en toets van de samenstelling',
    noRoom: 'Geen ruimte meer: de toetslast van de meegenomen hypotheek vult de woonlast',
    newMaxNibud: 'Ruimte voor nieuw geld (inkomen)',
    lenderCap: 'Plafond van de geldverstrekker',
    newMax: 'Maximaal nieuw te lenen',
    maxMortgage: 'Maximale hypotheek',
  };
  const afslagRows = b.rows.map((r) => [
    rowLabel[r.key] || r.key,
    r.type === 'delta' ? signed(r.amount) : eur(r.amount),
    r.type === 'delta' ? eur(r.running) : '',
  ]);
  const totalsRows = [
    ['Schulden en tweede woning', eur(-A.debts)],
    ['Studieschuld', eur(-A.study)],
  ];
  if (A.floor > 0.5) totalsRows.push(['Correctie ondergrens € 0', signed(A.floor)]);
  if (A.aow > 0.5) totalsRows.push(['AOW-toets', eur(-A.aow)]);
  if (A.composite > 0.5) totalsRows.push(['Toets meegenomen leningdelen (per saldo)', eur(-A.composite)]);
  if (A.compositeBenefit > 0.5) totalsRows.push(['Voordeel lage rente meegenomen delen (per saldo)', signed(A.compositeBenefit)]);
  if (A.lenderCap > 0.5) totalsRows.push(['Plafond geldverstrekker', eur(-A.lenderCap)]);
  totalsRows.push(['Totaal aan afslagen op de leencapaciteit', eur(-A.total)]);
  sections.push({
    id: 'afslagen',
    title: '2. Samenvatting van de afslagen',
    blocks: [
      text('Van de leencapaciteit op inkomen naar het bedrag dat nieuw geleend kan worden. Elke regel is een apart bedrag; de lopende stand staat rechts.'),
      table(['Post', 'Bedrag', 'Lopende stand'], afslagRows, {
        align: ['left', 'right', 'right'],
        boldRows: afslagRows.map((r, i) => (/^(Maximale|Ruimte|Leencapaciteit op inkomen|Maximaal)/.test(r[0]) ? i : -1)).filter((i) => i >= 0),
      }),
      heading('Totalen per soort'),
      kv(totalsRows),
      text(
        b.reconciles
          ? `Controle: alle regels sluiten exact op ${eur(b.finalAmount)} (afwijking ${b.maxError.toFixed(4)}).`
          : `LET OP: de opbouw sluit niet (afwijking ${eur(b.maxError)}).`,
        b.reconciles ? 'note' : 'warning'
      ),
    ],
  });

  // ---- 3. Invoer
  const blocks3 = [];
  const person = (n) => {
    const t = n === 1 ? calc.toets1 : calc.toets2;
    const type = n === 1 ? d.incomeType1 : d.incomeType2;
    return [
      `Aanvrager ${n}`,
      INCOME_TYPES[type] || type,
      eur(n === 1 ? d.income1 : d.income2),
      eur(t.structural),
      eur(t.alimonyDeduction),
      eur(t.toetsinkomen),
      String(n === 1 ? d.age1 : d.age2),
    ];
  };
  blocks3.push(heading('Aanvragers en inkomen'));
  blocks3.push(
    table(
      ['', 'Inkomenstype', 'Bruto inkomen', 'Structureel extra', 'Alimentatie (jaar)', 'Toetsinkomen', 'Leeftijd'],
      d.hasPartner2 ? [person(1), person(2)] : [person(1)],
      { align: ['left', 'left', 'right', 'right', 'right', 'right', 'right'] }
    )
  );
  blocks3.push(kv([['Totaal toetsinkomen', eur(calc.combinedIncome)]]));
  if (calc.pensionApplies) {
    blocks3.push(
      kv([
        ['Verwacht pensioeninkomen aanvrager 1', d.pensionIncome1 ? eur(d.pensionIncome1) : 'niet ingevuld'],
        ...(d.hasPartner2 ? [['Verwacht pensioeninkomen aanvrager 2', d.pensionIncome2 ? eur(d.pensionIncome2) : 'niet ingevuld']] : []),
      ])
    );
  }
  blocks3.push(heading('Beoogde woning en nieuwe hypotheek'));
  blocks3.push(
    kv([
      ['Aankoopprijs', eur(d.purchasePrice)],
      ['Rente nieuwe hypotheek', pct(d.rate)],
      ['Rentevaste periode', `${d.fixedRatePeriod} jaar`],
      ['Toetsrente nieuw geld', `${pct(calc.testRate)}${calc.toetsrenteApplies ? ' (AFM-toetsrente: rentevast < 10 jaar)' : ' (contractrente: rentevast 10 jaar of langer)'}`],
      ['Energielabel', d.energyLabel],
      ['Plafond totale hypotheek geldverstrekker', eur(getLenderCap(d.lenderCapThreshold))],
      ['Overdrachtsbelasting', `${calc.transferTaxInfo.label}${calc.transferTaxInfo.rate ? ` = ${eur(calc.transferTax)}` : ''}`],
    ])
  );
  if (door) {
    blocks3.push(heading('Huidige woning en hypotheek'));
    blocks3.push(
      kv([
        ['Marktwaarde huidige woning', eur(d.marketValue)],
        ['Verkoopwaarde voor financiering', `${eur(cm.saleValueForFinancing)} (${pct(d.saleDiscountPercentage, 0)} van de marktwaarde)`],
        ['Restschuld per peildatum', eur(cm.currentDebtBalance)],
        ['Bruikbare overwaarde', eur(cm.usableOverwaarde)],
        ...(cm.restschuldTekort > 0 ? [['Restschuld-tekort bij verkoop', eur(cm.restschuldTekort)]] : []),
        ['Hypotheek meenemen?', yesNo(d.takeOverMortgage)],
        ['Looptijd voor toetslast', d.portedTermBasis === '30jaar' ? '30 jaar (op verzoek van de geldverstrekker)' : 'Resterende looptijd (aflossingsvrij: 30 jaar)'],
        ['Ingangsdatum hypotheek', dateNL(d.startDate)],
      ])
    );
    const elapsed = getElapsedMonths(d.startDate, refDate);
    blocks3.push(
      table(
        ['Deel', 'Vorm', 'Restsaldo', 'Rente', 'Oorspr. rentevast', 'Nog rentevast', 'Toetsrente', 'Toetsloop-tijd', 'Toetslast p/m'],
        cm.portedParts.length
          ? cm.portedParts.map((p) => [
              String(p.index + 1),
              p.type,
              eur2(p.balance),
              pct(p.rate),
              `${d.loanParts[p.index]?.originalFixedYears ?? ''} jaar`,
              monthsText(p.remainingFixedMonths),
              pct(p.testRate),
              `${p.termMonths} mnd`,
              eur2(p.toetslast),
            ])
          : [['-', 'geen leningdelen', '', '', '', '', '', '', '']],
        { align: ['left', 'left', 'right', 'right', 'right', 'right', 'right', 'right', 'right'] }
      )
    );
    blocks3.push(text(`Verstreken sinds ingangsdatum: ${elapsed} maanden; resterende looptijd ${Math.max(1, TERM_MONTHS - elapsed)} maanden.`, 'note'));
  }
  blocks3.push(heading('Eigen vermogen en kosten koper'));
  blocks3.push(
    kv([
      ['Eigen vermogen, direct beschikbaar', eur(calc.totalOwnCapital)],
      ...(calc.illiquidOwnCapital > 0 ? [['Eigen vermogen, nog niet beschikbaar (telt niet mee)', eur(calc.illiquidOwnCapital)]] : []),
      ['Kosten koper meetellen in de toets?', yesNo(d.includeKostenKoperInCalc)],
      ...calc.kostenKoper.items.filter((i) => i.included).map((i) => [`   ${i.label}`, eur(i.amount)]),
      ['Kosten koper totaal', eur(calc.kostenKoper.total)],
    ])
  );
  blocks3.push(heading('Schulden en lasten'));
  blocks3.push(
    kv([
      ['Overige schulden aanvrager 1 (2% per maand)', eur(d.debt1)],
      ...(d.hasPartner2 ? [['Overige schulden aanvrager 2 (2% per maand)', eur(d.debt2)]] : []),
      ['Familielening, maandelijkse aflossing', calc.familyLoanMonthlyDebt ? eur2(calc.familyLoanMonthlyDebt) : 'geen'],
    ])
  );
  if (d.hasSecondHome) {
    blocks3.push(
      kv(
        d.secondHomeWillSell
          ? [['Tweede woning', `Wordt verkocht: marktwaarde ${eur(d.secondHomeValue)}, schuld ${eur(d.secondHomeMortgageDebt)}, netto-opbrengst ${eur(calc.secondHomeNetProceeds)}`]]
          : [
              ['Tweede woning (aanhouden): hypotheekschuld', eur(d.secondHomeMortgageDebt)],
              ['   rente / aflosvorm', `${pct(d.secondHomeInterestRate)} / ${d.secondHomeRepaymentType}`],
              ['   resterende looptijd / rentevast', `${d.secondHomeRemainingYears} jaar / ${d.secondHomeFixedYears} jaar`],
              ['   werkelijke maandlast', eur2(calc.secondHomeActualMonthly)],
              ['   toetslast', `${eur2(calc.secondHomeMonthly)} (annuïteit tegen ${pct(calc.secondHomeTestRate)})`],
            ]
      )
    );
  }
  const sd = calc.studyDebt;
  if (sd.perLoan.length > 0) {
    blocks3.push(heading('Studieleningen (DUO)'));
    blocks3.push(
      table(
        ['Lening', 'Eigenaar', 'Restschuld', 'Rente', 'Nog (mnd)', 'DUO-maandbedrag', 'Bron termijn', 'Toetslast p/m', 'Afslag'],
        sd.perLoan.map((l, i) => {
          const src = (d.studyLoans || []).find((x) => String(x.id) === String(l.id)) || {};
          return [
            String(i + 1),
            d.hasPartner2 ? (Number(l.owner) === 2 ? 'Partner 2' : 'Partner 1') : 'Aanvrager',
            eur2(l.balance),
            pct(src.ratePct ?? 0),
            String(src.remainingMonths ?? ''),
            eur2(l.termijn),
            { duo: 'DUO-opgave', annuiteit: 'berekend (annuïteit)', schatting: 'geschat (annuïteit)', geen: '-' }[l.termijnSource] || l.termijnSource,
            eur2(l.toetslast),
            eur(l.afslag),
          ];
        }),
        { align: ['left', 'left', 'right', 'right', 'right', 'right', 'left', 'right', 'right'] }
      )
    );
  }
  sections.push({ id: 'invoer', title: '3. Invoer en uitgangspunten', blocks: blocks3 });

  // ---- 4. Rekenstappen
  const st = [];
  let n = 1;
  // 4.1 toetsinkomen
  const inc1 = calc.toets1;
  const inc2 = calc.toets2;
  const incomeLine = (label, t) =>
    `${label}: ${t.usesHistory ? `gemiddelde van de laatste jaren (max. laatste jaar) ${eur(t.base)}` : `bruto ${eur(t.base)}`} + structureel ${eur(t.structural)} - alimentatie ${eur(t.alimonyDeduction)} = ${eur(t.toetsinkomen)}`;
  st.push(
    step(n++, 'Toetsinkomen', [incomeLine('Aanvrager 1', inc1), ...(d.hasPartner2 ? [incomeLine('Aanvrager 2', inc2)] : [])], `Totaal toetsinkomen = ${eur(calc.combinedIncome)}`)
  );
  // 4.2 woonquote
  const band = getToetsrenteBand(calc.testRate);
  const incRow = getIncomeRow(calc.combinedIncome);
  const bandText = bandTextOf(band);
  st.push(
    step(
      n++,
      'Woonquote en maximale woonlast (Nibud, tabel 1 financieringslastpercentage 2026)',
      [
        `Toetsrente ${pct(calc.testRate, 3)}: kolom ${bandText} (officiële kolommen per 0,5%-punt, op drie decimalen).`,
        `Toetsinkomen ${eur(calc.combinedIncome)}: tabelrij ${eur(incRow)} (naar beneden op € 1.000; onder € 30.000 de eerste en boven € 125.000 de laatste rij).`,
        `Maximale woonlast per maand = woonquote × toetsinkomen ÷ 12 = ${frac(calc.woonquote)} × ${eur(calc.combinedIncome)} ÷ 12 = ${eur2(calc.maxWoonlastMonthly)}`,
      ],
      `Woonquote ${frac(calc.woonquote)}; woonlast ${eur2(calc.maxWoonlastMonthly)} per maand`
    )
  );
  // 4.3 kapitalisatie
  st.push(
    step(
      n++,
      'Kapitaliseren (annuïteit, 30 jaar)',
      [
        `Kapitalisatiefactor = (1 - (1 + r)^-360) ÷ r met r = ${pct(cap.rate, 3)} ÷ 12 = ${(cap.rate / 1200).toFixed(6).replace('.', ',')}  ->  ${num2(f)}`,
        `Leencapaciteit voor afslagen = woonlast × factor = ${eur2(calc.maxWoonlastMonthly)} × ${num2(f)} = ${eur(cap.grossLoan)}`,
      ],
      `Leencapaciteit op inkomen = ${eur(cap.grossLoan)}`
    )
  );
  // 4.4 schulden
  const debtLines = [];
  if (cap.debtAfslag.secondHome > 0.005)
    debtLines.push(`Tweede woning: toetslast ${eur2(calc.secondHomeMonthly)} × ${num2(f)} = ${eur(cap.debtAfslag.secondHome)}`);
  if (cap.debtAfslag.otherDebts > 0.005)
    debtLines.push(`Overige schulden: 2% × ${eur(safeNum(d.debt1) + (d.hasPartner2 ? safeNum(d.debt2) : 0))} = ${eur2(calc.otherDebtMonthly)} per maand × ${num2(f)} = ${eur(cap.debtAfslag.otherDebts)}`);
  if (cap.debtAfslag.familyLoan > 0.005)
    debtLines.push(`Familielening: ${eur2(calc.familyLoanMonthlyDebt)} × ${num2(f)} = ${eur(cap.debtAfslag.familyLoan)}`);
  st.push(
    step(
      n++,
      'Afslag schulden en tweede woning',
      debtLines.length ? debtLines : ['Geen schulden, tweede woning of maandelijkse familielening die meetellen.'],
      `Totaal ${eur(A.debts)}`
    )
  );
  // 4.5 studieschuld
  const studyLines = [];
  if (sd.perLoan.length > 0) {
    const newMoney = door ? gap.additionalMortgage : 0;
    const dParts = buildDebetrenteParts(d, newMoney);
    const totalBal = dParts.reduce((acc, p) => acc + Math.max(0, p.balance), 0);
    const rateOf = (p) =>
      sd.debetrenteMode === 'contract' ? p.ratePct : getPartToetsrente(p.ratePct, p.remainingFixedYears, TOETSRENTE);
    studyLines.push(
      `Debetrente = op saldo gewogen ${sd.debetrenteMode === 'contract' ? 'contractrente' : 'toetsrente'} van de hypotheek: ` +
        '(' +
        dParts
          .filter((p) => p.balance > 0)
          .map((p) => `${eur(p.balance)} × ${pct(rateOf(p), 3)}`)
          .join(' + ') +
        `) ÷ ${eur(totalBal)} = ${pct(sd.debetrente, 3)}`
    );
    const cfg = getStudyDebtConfig(REGULATION_YEAR);
    const row = cfg.factorTable.find((r) => Math.round(sd.debetrente * 1000) / 1000 <= r.upTo);
    studyLines.push(`Opslagfactor volgens art. 3a bij debetrente ${pct(sd.debetrente, 3)} (klasse tot en met ${row && Number.isFinite(row.upTo) ? pct(row.upTo, 3) : 'hoger'}): ${num2(sd.factor)}`);
    sd.perLoan.forEach((l, i) => {
      studyLines.push(`Lening ${i + 1}: DUO-maandbedrag ${eur2(l.termijn)} × ${num2(sd.factor)} = toetslast ${eur2(l.toetslast)} per maand`);
    });
    studyLines.push(
      `Betalingsfactor bij ${pct(sd.afslagRatePct, 3)} (${sd.afslagMethod === 'gewogen' ? 'gewogen toetsrente' : 'rente nieuwe geldlening'}) = r ÷ (1 - (1 + r)^-360) = ${sd.paymentFactor.toFixed(6).replace('.', ',')}`
    );
    studyLines.push(`Afslag = totale toetslast ÷ betalingsfactor = ${eur2(sd.totalToetslast)} ÷ ${sd.paymentFactor.toFixed(6).replace('.', ',')} = ${eur(sd.totalAfslag)}`);
  }
  st.push(
    step(n++, 'Afslag studieschuld (art. 3a, DUO)', studyLines.length ? studyLines : ['Geen studieleningen.'], `Totaal ${eur(calc.studyAfslag)}`)
  );
  // 4.6 bonussen
  const bonusLines = [];
  bonusLines.push(`Energielabel ${d.energyLabel}: ${eur(calc.energyBonus)} extra, buiten de woonlasttoets om.`);
  bonusLines.push(
    calc.singleBonus > 0
      ? `Alleenstaandenbedrag: ${eur(calc.singleBonus)} (één aanvrager, toetsinkomen ${eur(calc.combinedIncome)}).`
      : d.hasPartner2
        ? 'Alleenstaandenbedrag: niet van toepassing (twee aanvragers).'
        : 'Alleenstaandenbedrag: niet van toepassing (toetsinkomen onder het minimum).'
  );
  st.push(step(n++, 'Bonussen buiten de financieringslast', bonusLines, `Totaal ${eur(calc.energyBonus + calc.singleBonus)}`));
  // 4.7 AOW
  const aowLines = [];
  if (calc.pensionApplies && !calc.pensionIncomplete) {
    aowLines.push(
      `Minstens één aanvrager is 57 jaar of ouder: ook getoetst op het verwachte pensioeninkomen (tabel 2, financieringslast vanaf AOW-leeftijd). Toetsinkomen pensioenscenario ${eur(calc.pensionCombinedIncome)}.`
    );
    aowLines.push(`Leencapaciteit op pensioeninkomen (na schulden en studieschuld): ${eur(cap.pensionLoan)}; op huidig inkomen: ${eur(cap.loanAfterStudy)}.`);
    aowLines.push(calc.pensionBinding ? 'Het pensioenscenario is lager en daarmee bindend.' : 'Het huidige inkomen is lager en daarmee bindend.');
  } else if (calc.pensionApplies) {
    aowLines.push('Een aanvrager is 57 jaar of ouder maar het verwachte pensioeninkomen ontbreekt: de AOW-toets is NIET uitgevoerd. Vul het pensioeninkomen in.');
    warnings.push('AOW-toets niet uitgevoerd: verwacht pensioeninkomen ontbreekt.');
  } else {
    aowLines.push('Geen aanvrager binnen 10 jaar van de AOW-leeftijd: niet van toepassing.');
  }
  st.push(step(n++, 'AOW-toets', aowLines, `Effect ${A.aow > 0.5 ? eur(-A.aow) : '€ 0'}`));
  st.push(
    step(n++, 'Maximale hypotheek o.b.v. inkomen', [`Leencapaciteit - schulden - studieschuld ± AOW + bonussen = ${eur(calc.incomeBasedMax)} (alles als nieuw geld tegen ${pct(cap.rate)}).`], `${eur(calc.incomeBasedMax)}`)
  );
  // 4.9 samenstelling
  if (door) {
    if (d.takeOverMortgage && cm.composite) {
      const comp = cm.compositeBinding;
      const isPension = comp === cm.compositePension;
      const compIncome = isPension ? calc.pensionCombinedIncome : calc.combinedIncome;
      const compWoonlast = (comp.woonquote * compIncome) / 12;
      const compAvailable = compWoonlast - calc.monthlyDebt - comp.portedToetslast;
      const compBonus = calc.energyBonus + (isPension ? calc.pensionSingleBonus : calc.singleBonus);
      const lines = [
        'Een geldverstrekker toetst elk meegenomen leningdeel op zijn eigen toetslast: annuïtair tegen de contractrente bij nog 10 jaar of langer rentevast, anders tegen de AFM-toetsrente; looptijd de resterende looptijd (aflossingsvrij: 30 jaar).',
        ...comp.parts.map(
          (p) =>
            `Deel ${p.index + 1}: ${eur2(p.balance)} tegen ${pct(p.testRate)} over ${p.termMonths} mnd = toetslast ${eur2(p.toetslast)} per maand${p.box3 ? ` x ${p.grossUp.toFixed(3).replace(".", ",")} (box 3, Tabel 1 / Tabel 3) = ${eur2(p.toetslast * p.grossUp)}` : ""} (neemt ${eur(p.capacityUsed)} leenruimte in, ${signed(p.capacityUsed - p.balance)} t.o.v. het saldo)`
        ),
        `Som toetslasten meegenomen delen (box 3 gebruteerd) = ${eur2(comp.portedToetslast)} per maand`,
        `Gewogen toetsrente van de hele nieuwe hypotheek bij het maximum (weging saldo × looptijd, inclusief het nieuwe geld) = ${pct(comp.weightedRate, 3)} -> woonquote-kolom ${bandTextOf(comp.band)} -> woonquote ${frac(comp.woonquote)}${comp === cm.compositePension ? ' (AOW-tabel)' : ''}`,
        'Nieuw geld (maximum) = ((woonquote × inkomen ÷ 12) - schulden - toetslasten meegenomen delen) × factor - studieschuld + bonussen',
        `   Woonlast bij deze woonquote = ${frac(comp.woonquote)} × ${eur(compIncome)} ÷ 12 = ${eur2(compWoonlast)} per maand`,
        `   Beschikbaar voor nieuw geld = ${eur2(compWoonlast)} - ${eur2(calc.monthlyDebt)} (schulden) - ${eur2(comp.portedToetslast)} (meegenomen delen) = ${eur2(compAvailable)} per maand`,
        `   Gekapitaliseerd = ${eur2(compAvailable)} × ${num2(f)} = ${eur(compAvailable * f)}; min studieschuld ${eur(calc.studyAfslag)}; plus bonussen ${eur(compBonus)} = ${eur(compAvailable * f - calc.studyAfslag + compBonus)}`,
      ];
      if (comp.cappedAtBand) lines.push('Het maximum ligt op de rand van een woonquote-kolom: meer lenen verschuift de gewogen rente naar een kolom met een lagere woonquote.');
      st.push(step(n++, 'Toets van de samenstelling (meegenomen leningdelen en nieuw geld)', lines, `Ruimte voor nieuw geld (inkomen) = ${eur(cm.extraBorrowCapacity)}`));
    } else {
      st.push(step(n++, 'Meegenomen hypotheek', ['De bestaande hypotheek wordt niet meegenomen: de hele leencapaciteit is nieuw geld.'], `Ruimte voor nieuw geld (inkomen) = ${eur(cm.extraBorrowCapacity)}`));
    }
    const lenderCap = getLenderCap(d.lenderCapThreshold);
    st.push(
      step(
        n++,
        'Plafond geldverstrekker',
        [`Maximum totale hypotheek ${eur(lenderCap)}; na de meegenomen hypotheek (${eur(gap.portedDebt)}) blijft ${eur(gap.lenderCapRoom)} over.`, `Maximaal nieuw te lenen = laagste van ${eur(cm.extraBorrowCapacity)} (inkomen) en ${eur(gap.lenderCapRoom)} (plafond).`],
        `Maximaal nieuw te lenen = ${eur(gap.additionalMortgageCapacity)}`
      )
    );
    st.push(
      step(
        n++,
        'Financieringsgat en benodigd nieuw geld',
        [
          `Financieringsgat = aankoopprijs - meegenomen hypotheek - bruikbare overwaarde${gap.restschuldTekort > 0 ? ' + restschuld-tekort' : ''} = ${eur(d.purchasePrice)} - ${eur(gap.portedDebt)} - ${eur(gap.overwaarde)}${gap.restschuldTekort > 0 ? ` + ${eur(gap.restschuldTekort)}` : ''} = ${eur(gap.gap)}`,
          `Eigen geld - kosten koper = ${eur(calc.totalOwnCapital)} - ${eur(d.includeKostenKoperInCalc ? calc.kostenKoper.total : 0)} = ${eur(calc.totalOwnCapital - (d.includeKostenKoperInCalc ? calc.kostenKoper.total : 0))}; ingezet op het gat: ${eur(gap.ownCapitalApplied)}`,
          ...(gap.kostenKoperUncovered > 0.5
            ? [
                `Het eigen geld dekt de kosten koper niet: ${eur(gap.kostenKoperUncovered)} ontbreekt. Daarvan wordt ${eur(gap.kostenKoperFinanced)} meegefinancierd (totale hypotheek blijft binnen 100% van de woningwaarde)${gap.kostenKoperCashShortfall > 0.5 ? ` en ${eur(gap.kostenKoperCashShortfall)} kan niet worden gefinancierd: tekort aan eigen geld` : ''}.`,
              ]
            : []),
          `Nieuw geld nodig = gat - eigen geld${gap.kostenKoperFinanced > 0.5 ? ' + meegefinancierde kosten koper' : ''} = ${eur(gap.additionalMortgage)}`,
          `Ruimte = maximaal nieuw te lenen - nieuw geld nodig = ${eur(gap.additionalMortgageCapacity)} - ${eur(gap.additionalMortgage)} = ${eur(gap.capacityMargin)}${gap.familyLoanApplied > 0 ? `; met familielening ${eur(gap.familyLoanApplied)}: ${eur(gap.netCapacityMargin)}` : ''}`,
        ],
        feasible ? `Haalbaar met ${eur(margin)} ruimte` : `Niet haalbaar: tekort ${eur(-margin)}`
      )
    );
  } else {
    const lenderCap = getLenderCap(d.lenderCapThreshold);
    st.push(
      step(
        n++,
        'Plafond geldverstrekker en benodigde hypotheek',
        [
          `Maximale hypotheek = laagste van ${eur(calc.incomeBasedMax)} (inkomen) en ${eur(lenderCap)} (plafond) = ${eur(starterGap.capacity)}`,
          `Eigen geld na kosten koper = ${eur(calc.totalOwnCapital)} - ${eur(starterGap.kostenKoperCash)} = ${eur(starterGap.ownCapitalAfterCosts)}`,
          `Benodigde hypotheek = aankoopprijs - eigen geld = ${eur(starterGap.requiredMortgage)}`,
        ],
        feasible ? `Haalbaar met ${eur(margin)} ruimte` : `Niet haalbaar: tekort ${eur(starterGap.shortfall)}`
      )
    );
  }
  sections.push({ id: 'stappen', title: '4. Rekenstappen met formules', blocks: st });

  // ---- 5. Aannames en beperkingen
  const notes = [];
  notes.push(`Regelgeving 2026 (Tijdelijke regeling hypothecair krediet, Wijzigingsregeling 2026; Nibud-woonquote). AFM-toetsrente ${pct(TOETSRENTE)} (t/m Q3 2026 geverifieerd; Q4 2026 niet).`);
notes.push('De woonquote-tabellen (Tabel 1-4) zijn volledig en letterlijk overgenomen uit Stcrt. 2025, 36471, Bijlage 1 (rij per € 1.000, twaalf rentekolommen); er wordt niet geïnterpoleerd.');
  if (cm.portedParts && cm.portedParts.some((p) => p.box3 && p.balance > 0) && d.takeOverMortgage) {
    notes.push('Niet-aftrekbare (box 3) meegenomen leningdelen tellen mee met de bruteringsfactor Tabel 1 ÷ Tabel 3 op hun toetslast. Standaard geldt een aflossingsvrij deel van na 2013 als box 3; zet het per deel op box 1 als er overgangsrecht is.');
  }
  notes.push(`Opslagfactor studieschuld: officiële tabel uit art. 3a lid 2 van de Tijdelijke regeling hypothecair krediet (configuratie ${Object.keys(STUDY_DEBT_CONFIG_BY_YEAR).join('/')}); de debetrente is gewogen naar saldo × resterende looptijd (art. 3 lid 11).`);
  notes.push('Overige schulden tellen mee met 2% van het schuldbedrag per maand (een lagere vaste maandlast uit het contract mag een geldverstrekker accepteren).');
  notes.push(
    cm.sold
      ? `De huidige woning is verkocht: de overwaarde telt tot ${getLenderRules(d).soldFinancingPct}% van de verkoopprijs ${eur(safeNum(d.salePrice))}${getLenderRules(d).woonnu ? ' (Woonnu)' : ''}, en niet meer dan de netto opbrengst na ${eur(safeNum(d.saleCosts))} verkoopkosten.`
      : `Verkoopwaarde voor financiering = ${pct(d.saleDiscountPercentage, 0)} van de marktwaarde (nog niet verkocht).`
  );
  notes.push('Kosten koper gaan (indien meegeteld) eerst van het eigen geld af; wat het eigen geld niet dekt wordt meegefinancierd zolang de totale hypotheek onder 100% van de waarde van de woning blijft (taxatiewaarde, anders de koopsom; art. 5), daarboven is het een tekort aan eigen geld. NHG, erfpacht en verduurzaming boven 100% LTV zijn niet in deze toets opgenomen.');
  notes.push('AOW-toets: aanvragers van 57 jaar en ouder worden ook op het pensioeninkomen getoetst (AOW-leeftijd 67; vanaf 2028 67 jaar en 3 maanden).');
  notes.push('Indicatieve berekening, geen bindend advies. De definitieve toets en acceptatie liggen bij de geldverstrekker.');
  const unsup = unsupportedFeatures(d);
  sections.push({
    id: 'aannames',
    title: '5. Aannames, bronnen en beperkingen',
    blocks: [kv(notes.map((t, i) => [String(i + 1), t])), ...(warnings.length ? [heading('Waarschuwingen bij deze berekening'), kv(warnings.map((t, i) => [String(i + 1), t]))] : [])],
  });

  // ---- 6. Reproductie
  const repro = [
    text('Zo kunt u deze berekening nalopen of herhalen:', 'normal'),
    kv([
      ['1', 'Calculator: laad het dossier-bestand (JSON) via "Importeer dossier" in de header; het rekent exact deze invoer opnieuw door.'],
      ['2', 'Excel-toetsmodel (docs/toetsmodel/Hypotheek_Toetsmodel_2026.xlsx): voer de onderstaande invoer in op blad Invoer, in de laatste kolom ("Eigen test"), met peildatum zoals hieronder. Het blad Berekening toont dezelfde stappen als formules; de uitkomst staat op Samenvatting (kies het laatste scenario, "Eigen test").'],
      ['3', 'Restsaldi en rentevaste perioden hangen af van de peildatum; gebruik dezelfde datum.'],
    ]),
    heading('Invoer voor het Excel-toetsmodel'),
    table(['Invoerveld in Excel', 'Waarde'], excelInputRows(spec), { align: ['left', 'right'], compact: true }),
  ];
  if (unsup.length) {
    repro.push(heading('Let op: afwijkingen tussen calculator en Excel voor dit dossier'));
    repro.push(kv(unsup.map((t, i) => [String(i + 1), t])));
  }
  // ---- 6. Kasstromen bij levering en verkoop (zelfde berekening als de sectie in de app)
  const cf = computeCashflow(d, core);
  const cfBlocks = [
    heading(`Levering nieuwe woning (${d.purchaseTransferDate || '-'})`),
    table(
      ['Post', 'Bedrag'],
      [
        ['Koopsom', eur(cf.price)],
        ...cf.kostenKoperItems.map((i) => ['  ' + i.label, eur(i.amount)]),
        ['Totaal te betalen', eur(cf.uses)],
        ...(cf.ported > 0 ? [['Meegenomen hypotheek', eur(cf.ported)]] : []),
        [cf.ported > 0 ? 'Nieuwe hypotheek' : 'Hypotheek', eur(cf.newMortgage)],
        ['Eigen middelen', eur(cf.ownAtDelivery)],
        ...(cf.depositLoan > 0 ? [['Waarborgsom (lening familie)', eur(cf.depositLoan)]] : []),
        ...(cf.bridgeCredit > 0 ? [['Overbruggingskrediet (bank)', eur(cf.bridgeCredit)]] : []),
        ...(cf.familyBridgeLoan > 0 ? [['Tijdelijke lening familie (sluitpost)', eur(cf.familyBridgeLoan)]] : []),
        ['Totaal bronnen', eur(cf.sources)],
      ],
      { align: ['left', 'right'], compact: true }
    ),
    kv([
      ['Maximale hypotheek', `${eur(cf.maxMortgage)}${cf.overridden ? ` (ingevuld; toets: ${eur(cf.toolMax)})` : ' (uitkomst van de toets)'}`],
      ['Waarborgsom', { familie: 'gestort met een lening van familie', eigen: 'gestort uit eigen geld', bankgarantie: 'bankgarantie' }[cf.depositMethod]],
    ]),
  ];
  if (cf.sale) {
    const sl = cf.sale;
    cfBlocks.push(
      heading(`Verkoop huidige woning (${d.saleTransferDate || '-'})`),
      table(
        ['Post', 'Bedrag'],
        [
          ['Verkoopprijs', eur(sl.grossPrice)],
          ['- Verkoopkosten', eur(sl.saleCosts)],
          ['= Netto opbrengst', eur(sl.netProceeds)],
          ['- Aflossing bestaande hypotheek', eur(sl.bridge)],
          ['= Overwaarde netto', eur(sl.overwaardeNet)],
          ...(sl.bridgeCreditRepayment > 0 ? [['- Aflossing overbruggingskrediet', eur(sl.bridgeCreditRepayment)]] : []),
          ...(sl.familyRepayment > 0 ? [['- Terugbetaling familie', eur(sl.familyRepayment)]] : []),
          [sl.afterFamily < 0 ? '= Tekort: extra eigen geld' : '= Over na verkoop', eur(Math.abs(sl.afterFamily))],
        ],
        { align: ['left', 'right'], compact: true }
      ),
      kv([
        ['Dagen tussen levering en verkoop', String(sl.days)],
        ['Rente bestaande hypotheek in die periode', `${eur(sl.bridgeInterest)} (${pct(sl.bridgeRateUsed)})`],
        ...(sl.familyInterest > 0 ? [['Rente familielening', eur(sl.familyInterest)]] : []),
        ...(sl.bridgeCreditInterest > 0 ? [['Rente overbruggingskrediet', eur(sl.bridgeCreditInterest)]] : []),
      ])
    );
  }
  cfBlocks.push(
    heading('Eigen inbreng'),
    kv([
      ['Totale eigen inbreng', eur(cf.totalOwn)],
      ['waarvan kosten koper', eur(cf.kostenKoper)],
      ['Beschikbaar eigen vermogen', eur(cf.ownAvailable)],
      ...(d.hasPartner2 ? [['Aanvrager 1 / aanvrager 2', `${eur(cf.partner1Share)} / ${eur(cf.partner2Share)}`]] : []),
      ...(cf.sale ? [['Inclusief rente in de overbruggingsperiode', eur(cf.totalOwnInclCosts)]] : []),
    ])
  );
  if (cf.warnings.length) {
    cfBlocks.push(heading('Let op'), kv(cf.warnings.map((w, i) => [String(i + 1), w.text])));
  }
  sections.push({ id: 'kasstromen', title: '6. Kasstromen bij levering en verkoop', blocks: cfBlocks });

  sections.push({ id: 'reproductie', title: '7. Reproductie', blocks: repro });

  return {
    version: REPORT_VERSION,
    meta: {
      title: 'Rekenverantwoording hypotheekberekening',
      generatedAt: generatedAt.toISOString(),
      peildatum: peilIso,
      appVersion,
      regulationYear: REGULATION_YEAR,
      kind: door ? 'doorstromer' : 'starter',
      splitMode: ADDITIONAL_SPLIT_MODES[d.additionalSplitMode] || d.additionalSplitMode,
    },
    result: {
      feasible,
      maxTotalMortgage: b.maxTotalMortgage,
      portedDebt: b.portedDebt,
      newMax: b.newMax,
      needed: b.need.required,
      margin,
      incomeBasedMax: calc.incomeBasedMax,
      studyAfslag: calc.studyAfslag,
      maxAffordablePrice: maxPrice,
      afslagen: A,
    },
    sections,
    scenario: spec,
    warnings,
    unsupported: unsup,
  };
}

// ----------------------------------------------------------------------------- bestand voor delen / herladen
export function buildDossierFile(d, report) {
  return {
    type: DOSSIER_FILE_TYPE,
    version: REPORT_VERSION,
    meta: report.meta,
    result: report.result,
    dossier: d,
    excelScenario: report.scenario,
    stappen: report.sections,
  };
}

// Leest een geëxporteerd bestand (of een kaal dossier) terug. Geeft het dossier-object of werpt een Error.
export function parseDossierFile(textContent) {
  let parsed;
  try {
    parsed = JSON.parse(textContent);
  } catch {
    throw new Error('Het bestand is geen geldige JSON.');
  }
  const dossier = parsed && parsed.type === DOSSIER_FILE_TYPE ? parsed.dossier : parsed;
  if (!dossier || typeof dossier !== 'object' || Array.isArray(dossier) || dossier.purchasePrice === undefined) {
    throw new Error('Dit lijkt geen dossier van de hypotheekcalculator.');
  }
  return dossier;
}

// ----------------------------------------------------------------------------- tekstvariant
export function reportToText(report) {
  const out = [];
  out.push(report.meta.title.toUpperCase());
  out.push(`Gegenereerd op ${dateNL(report.meta.generatedAt)} (peildatum ${dateNL(report.meta.peildatum)}), regelgeving ${report.meta.regulationYear}`);
  out.push('');
  const pad = (s, w) => String(s).padEnd(w);
  for (const section of report.sections) {
    out.push(section.title.toUpperCase());
    out.push('='.repeat(Math.min(78, section.title.length)));
    for (const bl of section.blocks) {
      if (bl.type === 'heading') out.push('', bl.text);
      else if (bl.type === 'text') out.push(bl.text);
      else if (bl.type === 'kv') bl.rows.forEach(([k, v]) => out.push(`${pad(k, 58)} ${v}`));
      else if (bl.type === 'table') {
        out.push(bl.head.join(' | '));
        bl.rows.forEach((r) => out.push(r.join(' | ')));
      } else if (bl.type === 'step') {
        out.push('', `${bl.n}. ${bl.title}`);
        bl.lines.forEach((l) => out.push(`   ${l}`));
        out.push(`   => ${bl.result}`);
      }
    }
    out.push('');
  }
  return out.join('\n');
}
