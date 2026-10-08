// Rekenkern van de hypotheekcalculator: zuivere functies op een dossier-object, zonder React of
// DOM. Het component (MortgageCalculator.jsx) en de unit tests gebruiken dezelfde code.

import { getIncomeBasedMortgage } from './nibud2026';
import { getToetsinkomen } from './toetsinkomen';
import { getTransferTaxRate, getKostenKoperBreakdown, KOSTEN_KOPER_DEFAULTS } from './kostenKoper';
import { STUDY_LOAN_PRESETS, computeStudyDebt, getStudyDebtConfig, getWeightedDebetrente } from './studieschuld';

export const ENERGY_LABELS = ['G', 'F', 'E', 'D', 'C', 'B', 'A', 'A+', 'A++', 'A+++', 'A++++'];

export function getEnergyBonus(label) {
  if (['G', 'F', 'E'].includes(label)) return 0;
  if (['D', 'C'].includes(label)) return 5000;
  if (['B', 'A'].includes(label)) return 10000;
  if (['A+', 'A++'].includes(label)) return 20000;
  // 2026 Nibud-bijstelling: door de terugleverkosten en het afbouwen van de
  // salderingsregeling leveren zonnepanelen minder op, waardoor het Nibud het extra
  // hypotheekbedrag voor de zeer energiezuinige labels A+++ (€30.000 in 2025 → €25.000)
  // en A++++ (€40.000 → €30.000) heeft verlaagd t.o.v. 2025. A++++ met een 10-jaar
  // energieprestatiegarantie mag €40.000 blijven, maar die garantie wordt hier niet apart
  // uitgevraagd, dus rekenen we met het bedrag zonder garantie.
  if (label === 'A+++') return 25000;
  if (label === 'A++++') return 30000;
  return 0;
}

// De maximale hypotheek op basis van inkomen loopt sinds deze versie via de echte
// Nibud-woonquote-systematiek 2026 (zie nibud2026.js), in plaats van via een handmatig
// getunede leenfactor.

export const AFLOSVORMEN = ['Annuïteit', 'Lineair', 'Aflossingsvrij'];
export const TERM_MONTHS = 360;
// Hypotheekrenteaftrek 2026: sinds 2023 wettelijk begrensd op maximaal het tarief van de
// tweede belastingschijf in box 1 (37,56% in 2026) — ook wie in de hoogste schijf
// (49,50%) valt, trekt dus nooit meer af dan dit plafond. Wie met zijn/haar toetsinkomen
// echter volledig binnen de eerste schijf blijft, trekt af tegen het (lagere)
// eerste-schijftarief van 35,70%, niet tegen het plafond.
// Bron: Belastingdienst/Prinsjesdag 2026, box 1-schijven en aftrektarief eigen woning.
export const HRA_RATE_BRACKET1 = 0.357;
export const HRA_RATE_CAP = 0.3756;
export const HRA_BRACKET1_THRESHOLD = 38883;

// Bepaalt het toepasselijke HRA-tarief op basis van de (toets)inkomens van de
// aanvrager(s): zodra minstens één aanvrager boven de eerste schijf uitkomt, kan het
// rentevoordeel aan diegene toegerekend worden tegen het gecapte tarief.
export function getHraRate(...incomes) {
  const maxIncome = Math.max(0, ...incomes.map((v) => (isNaN(v) ? 0 : v)));
  return maxIncome > HRA_BRACKET1_THRESHOLD ? HRA_RATE_CAP : HRA_RATE_BRACKET1;
}

export const EWF_RATE = 0.0035;
export const EWF_CAP = 1350000;
export const SCENARIO_PERCENTAGES = [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5];
// Overdrachtsbelasting en kosten koper zijn niet langer vaste percentages maar worden
// gedifferentieerd en per post bepaald via getTransferTaxRate() en
// getKostenKoperBreakdown() in kostenKoper.js.
// AFM-toetsrente 2026 (elk kwartaal vastgesteld, tot nu toe steeds 5%). Verplicht te
// gebruiken zodra de rentevastperiode van de nieuwe hypotheek korter is dan 10 jaar.
// Het kalenderjaar van de regeling waarmee de app rekent (Nibud-tabellen, AFM-toetsrente en
// de studieschuld-opslagfactoren); de waarden staan per jaar in studieschuld.js.
export const REGULATION_YEAR = 2026;
export const TOETSRENTE = getStudyDebtConfig(REGULATION_YEAR).afmToetsrente;
// Sommige geldverstrekkers hanteren een interne acceptatiegrens voor de totale
// hypotheeksom, waarboven aanvullende eisen of een ander acceptatietraject gelden. Dit is
// een redelijke default; gebruikers met een afwijkend maximum bij hun eigen
// geldverstrekker kunnen dit zelf aanpassen (zie lenderCapThreshold state).
export const LENDER_CAP_THRESHOLD_DEFAULT = 1000000;

// Het veld is optioneel: leeg betekent de standaardgrens, niet een plafond van €0.
export function getLenderCap(value) {
  return String(value ?? '').trim() === '' ? LENDER_CAP_THRESHOLD_DEFAULT : safeNum(value);
}
// Wegingsfactor overige schulden: 2% per maand van het schuldbedrag, de gangbare norm
// voor consumptief krediet (doorlopend krediet, persoonlijke lening).
export const OTHER_DEBT_MONTHLY_WEIGHT = 0.02;

// Studieschuld (DUO) wordt berekend in studieschuld.js: toetslast = termijnbedrag ×
// opslagfactor, als afslag in euro op de maximale hypotheek (zie computeCalc en de README).

// Kapitaliseert een vaste maandlast naar een hypotheekbedrag met de annuïteitenfactor
// bij een gegeven rente over 30 jaar, dezelfde methodiek als Nibud gebruikt om
// maandlasten van schulden te vertalen naar een verlaging van de maximale hypotheek.
export function getCapitalizationFactor(ratePct) {
  const r = ratePct / 100 / 12;
  if (r === 0) return TERM_MONTHS;
  return (1 - Math.pow(1 + r, -TERM_MONTHS)) / r;
}

// Gedeelde toetsrente-regel: bij een rentevastperiode korter dan 10 jaar moet wettelijk
// worden getoetst tegen de (hogere) AFM-toetsrente, tenzij de daadwerkelijke rente al
// hoger ligt. Dit geldt niet alleen voor een nieuwe hypotheek, maar ook voor bestaande
// leningdelen die worden meegenomen: als hun resterende rentevastperiode korter is dan
// 10 jaar, telt voor de leencapaciteitstoets ook voor hen de toetsrente, niet hun
// eigen (vaak lagere) contractrente.
export function getTestRate(rate, fixedYears) {
  const actualRate = safeNum(rate);
  const years = safeNum(fixedYears);
  if (years > 0 && years < 10 && TOETSRENTE > actualRate) {
    return TOETSRENTE;
  }
  return actualRate;
}

export function getElapsedMonths(dateStr, refDate = new Date()) {
  const start = new Date(dateStr);
  if (isNaN(start.getTime())) return 0;
  let months =
    (refDate.getFullYear() - start.getFullYear()) * 12 + (refDate.getMonth() - start.getMonth());
  if (refDate.getDate() < start.getDate()) months -= 1;
  return Math.max(0, months);
}

// Rekent de resterende rentevastperiode van een leningdeel uit op basis van de
// oorspronkelijk afgesproken rentevastperiode en de ingangsdatum van de hypotheek, in
// plaats van dit als los, los te onderhouden getal te laten invoeren.
export function getRemainingFixedPeriod(originalFixedYears, elapsedMonths) {
  const totalMonths = Math.max(0, safeNum(originalFixedYears) * 12);
  const remainingMonths = Math.max(0, totalMonths - Math.max(elapsedMonths, 0));
  const years = Math.floor(remainingMonths / 12);
  const months = remainingMonths % 12;
  return {
    remainingMonths,
    years,
    months,
    fractionalYears: remainingMonths / 12,
  };
}

export function getYearFromDate(dateStr) {
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? 0 : d.getFullYear();
}

// Projecteert de resterende hoofdsom van een leningdeel na een aantal maanden vanaf nu,
// gegeven de huidige hoofdsom (vandaag) en de resterende looptijd op dit moment. Gebruikt
// voor de aflossingsgrafiek, niet voor de huidige maandlasten zelf.
export function projectRemainingBalance(principal, ratePct, type, remainingMonthsNow, monthsFromNow) {
  const P = safeNum(principal);
  const N = Math.max(0, remainingMonthsNow);
  const k = Math.min(Math.max(0, monthsFromNow), N);
  if (P <= 0 || N <= 0) return 0;
  if (type === 'Aflossingsvrij') return k >= N ? 0 : P;
  const r = safeNum(ratePct) / 100 / 12;
  if (type === 'Lineair') {
    const perMonth = P / N;
    return Math.max(0, P - perMonth * k);
  }
  // Annuïteit
  if (r === 0) return Math.max(0, P - (P / N) * k);
  const balance = (P * (Math.pow(1 + r, N) - Math.pow(1 + r, k))) / (Math.pow(1 + r, N) - 1);
  return Math.max(0, balance);
}

// Restschuld van een bestaand leningdeel op de dag van gebruik. Staat er een restsaldo van de
// bank met opgavedatum bij (knownBalance + balanceAsOf), dan wordt dat vanaf die datum
// doorgerekend: de bank hanteert eigen afrondingen en een eigen aflosschema, dus het opgegeven
// saldo is nauwkeuriger dan een berekening uit de hoofdsom. Anders volgt de restschuld uit de
// hoofdsom bij aanvang (30 jaar looptijd vanaf de ingangsdatum, geen extra aflossingen).
export function getCurrentLoanBalance(part, startDate, refDate = new Date()) {
  const elapsedNow = getElapsedMonths(startDate, refDate);
  const anchorDate = new Date(part.balanceAsOf);
  const hasAnchor =
    String(part.knownBalance ?? '').trim() !== '' && !isNaN(anchorDate.getTime());
  if (!hasAnchor) {
    return projectRemainingBalance(part.principal, part.rate, part.type, TERM_MONTHS, elapsedNow);
  }
  const elapsedAtAnchor = getElapsedMonths(startDate, anchorDate);
  return projectRemainingBalance(
    part.knownBalance,
    part.rate,
    part.type,
    Math.max(0, TERM_MONTHS - elapsedAtAnchor),
    Math.max(0, elapsedNow - elapsedAtAnchor)
  );
}

export function toCurrentLoanParts(loanParts, startDate, refDate = new Date()) {
  return loanParts.map((part) => ({
    ...part,
    principal: String(getCurrentLoanBalance(part, startDate, refDate)),
  }));
}

// Omgekeerde van toCurrentLoanParts, voor dossiers van vóór die wijziging: daarin was de
// ingevoerde hoofdsom de restschuld van dat moment.
export function getOriginalPrincipalFromBalance(balance, ratePct, type, elapsedMonths) {
  const B = safeNum(balance);
  const N = TERM_MONTHS;
  const k = Math.min(Math.max(0, elapsedMonths), N);
  if (type === 'Aflossingsvrij' || k === 0 || k >= N) return B;
  const r = safeNum(ratePct) / 100 / 12;
  if (type === 'Lineair' || r === 0) return B / (1 - k / N);
  return (B * (Math.pow(1 + r, N) - 1)) / (Math.pow(1 + r, N) - Math.pow(1 + r, k));
}

export function calculateLoanPart(part, elapsedMonths, startDate) {
  const principal = safeNum(part.principal);
  const annualRate = safeNum(part.rate);
  const r = annualRate / 100 / 12;
  const remainingMonths = Math.max(0, TERM_MONTHS - Math.max(elapsedMonths, 0));

  let grossMonthly = 0;
  let interestMonthly = 0;
  let principalMonthly = 0;

  if (part.type === 'Aflossingsvrij') {
    interestMonthly = principal * r;
    grossMonthly = interestMonthly;
    principalMonthly = 0;
  } else if (remainingMonths <= 0) {
    // Standaardlooptijd van 30 jaar is verstreken: dit leningdeel is afgelost.
    grossMonthly = 0;
    interestMonthly = 0;
    principalMonthly = 0;
  } else if (part.type === 'Lineair') {
    principalMonthly = principal / remainingMonths;
    interestMonthly = principal * r;
    grossMonthly = principalMonthly + interestMonthly;
  } else {
    if (r === 0) {
      grossMonthly = principal / remainingMonths;
      interestMonthly = 0;
      principalMonthly = grossMonthly;
    } else {
      grossMonthly = (principal * r) / (1 - Math.pow(1 + r, -remainingMonths));
      interestMonthly = principal * r;
      principalMonthly = grossMonthly - interestMonthly;
    }
  }

  const eligibleForHRA = part.type !== 'Aflossingsvrij' || getYearFromDate(startDate) <= 2013;
  const fixedPeriod = getRemainingFixedPeriod(part.originalFixedYears, elapsedMonths);
  const fixedPeriodExpiringSoon = fixedPeriod.remainingMonths > 0 && fixedPeriod.fractionalYears <= 2;

  return {
    grossMonthly,
    interestMonthly,
    principalMonthly,
    eligibleForHRA,
    fixedPeriod,
    fixedPeriodExpiringSoon,
  };
}

// Losstaande, vereenvoudigde maandlast-berekening voor de tweede woning: geen
// leningdeel-administratie (ingangsdatum, rentevastperiode) nodig, alleen de huidige
// bruto maandlast bij de resterende looptijd — dat is alles wat nodig is om 'm als
// schuld mee te wegen in de Nibud-toets.
export function calculateSimpleMortgagePayment(principal, annualRatePct, type, remainingYears) {
  const P = safeNum(principal);
  const r = safeNum(annualRatePct) / 100 / 12;
  const N = Math.max(1, Math.round(safeNum(remainingYears) * 12));
  if (type === 'Aflossingsvrij') return P * r;
  if (type === 'Lineair') return P / N + P * r;
  if (r === 0) return P / N;
  return (P * r) / (1 - Math.pow(1 + r, -N));
}

export function safeNum(value) {
  const n = parseFloat(value);
  return isNaN(n) || !isFinite(n) ? 0 : n;
}

// Eén centrale bron voor de startwaarden van alle financiële invoervelden ("het dossier").
// Gebruikt door: het laden van een gedeelde link/localStorage, "opnieuw beginnen", en het
// invullen van ontbrekende velden bij een scenario uit een oudere schema-versie. Bewust
// losstaand van de useState-defaults in MortgageCalculatorForm zelf zou dubbel onderhoud
// betekenen; die defaults verwijzen naar dit object (zie DOSSIER_DEFAULTS.<veld>).
export const DOSSIER_DEFAULTS = {
  income1: 118000,
  income2: 115000,
  age1: '36',
  age2: '36',
  ownCapital1: 125000,
  ownCapital2: 25000,
  ownCapital1Liquid: true,
  ownCapital2Liquid: true,
  rate: 4.0,
  fixedRatePeriod: 10,
  energyLabel: 'A',
  purchasePrice: 1330000,
  hasPartner2: true,
  debt1: '0',
  debt2: '0',
  // Studieleningen (DUO): zie studieschuld.js. Eigenaar 1 = Partner 1/aanvrager, 2 = Partner 2.
  // Standaard de aflosplan-gegevens van Partner 1 per okt. 2026 (SF15-oud): saldo €13.803,67,
  // maandbedrag €142,00, 111 van 180 maanden in de aflosfase, 0 aflosvrije maanden over. De rente
  // van 2,95% is geldig t/m 31-12-2028, dus de renteherziening staat op 1 jan. 2029 (nieuwe rente
  // nog onbekend, daarom leeg).
  studyLoans: [
    {
      id: 1,
      owner: 1,
      balance: '13803.67',
      ratePct: 2.95,
      remainingMonths: 111,
      monthlyPayment: '142',
      status: 'regulier',
      revisionDate: '2029-01-01',
      revisionRatePct: '',
    },
  ],
  studyDebtRateMode: 'gewogenToets',
  studyDebtAfslagMethod: 'marginaal',
  propertyUsage: 'zelfbewoning',
  starterExemption1: false,
  starterExemption2: false,
  bouwdepotAmount: '',
  constructionMonths: 12,
  notaryCosts: String(KOSTEN_KOPER_DEFAULTS.notaryCosts),
  valuationCosts: String(KOSTEN_KOPER_DEFAULTS.valuationCosts),
  advisoryCosts: String(KOSTEN_KOPER_DEFAULTS.advisoryCosts),
  includeBankGuarantee: true,
  includeBuyersAgent: false,
  includeNhgFee: false,
  includeEwfInNetCalc: false,
  includeKostenKoperInCalc: true,
  partnerAlimony1: '0',
  partnerAlimony2: '0',
  pensionIncome1: '',
  pensionIncome2: '',
  incomeType1: 'vast',
  incomeType2: 'vast',
  incomeHistory1: { y1: '', y2: '', y3: '' },
  incomeHistory2: { y1: '', y2: '', y3: '' },
  thirteenthMonth1: '0',
  thirteenthMonth2: '0',
  avgBonus1: '0',
  avgBonus2: '0',
  hasExistingHome: true,
  hasSecondHome: true,
  secondHomeWillSell: false,
  useSecondHomeProceeds: true,
  secondHomeValue: '300000',
  secondHomeMortgageDebt: '42000',
  secondHomeInterestRate: 1.0,
  secondHomeRepaymentType: 'Annuïteit',
  secondHomeRemainingYears: 20,
  secondHomeSaleCostsPct: 2,
  lenderCapThreshold: String(LENDER_CAP_THRESHOLD_DEFAULT),
  limitOwnContribution: false,
  desiredMaxOwnContribution: '100000',
  useFamilyLoan: false,
  familyLoanAmount: '',
  familyLoanRate: 0,
  familyLoanRepaymentType: 'ineens',
  familyLoanMonthlyRepayment: '',
  familyLoanBufferPct: 10,
  takeOverMortgage: true,
  oldMortgageStance: 'volledig',
  bridgePeriodMonths: 6,
  includeOwnCapitalInDoubleTest: true,
  liquidityBuffer: '0',
  useBridgeLoan: false,
  bridgeLoanAmount: '',
  bridgeLoanRate: 6.0,
  marketValue: 935000,
  saleDiscountPercentage: 95,
  currentEnergyLabel: 'A',
  startDate: '2021-01-15',
  // Hoofdsom bij aanvang (samen €675.000) plus het restsaldo volgens het hypotheekoverzicht van
  // 8 okt. 2026; vanaf die opgavedatum wordt de restschuld doorgerekend tot de dag van gebruik.
  loanParts: [
    {
      id: 1,
      type: 'Annuïteit',
      principal: '320000',
      knownBalance: '269480.64',
      balanceAsOf: '2026-10-08',
      rate: 1.25,
      originalFixedYears: 10,
    },
    {
      id: 2,
      type: 'Aflossingsvrij',
      principal: '355000',
      knownBalance: '354269.27',
      balanceAsOf: '2026-10-08',
      rate: 1.85,
      originalFixedYears: 20,
    },
  ],
  loanPartsBasis: 'aanvang',
  additionalLoanParts: [
    { id: 1, type: 'Aflossingsvrij', principal: '0', rate: 4.0, originalFixedYears: 10 },
  ],
  additionalLoanTouched: false,
  aflossingsvrijMaxPct: 50,
  scheduleWindowStartMonth: 0,
  scheduleAppreciationPct: 0,
  starterLoanParts: [{ id: 1, type: 'Annuïteit', principal: '0', rate: 4.0, originalFixedYears: 10 }],
};

export const DOSSIER_FIELD_NAMES = Object.keys(DOSSIER_DEFAULTS);
export const DOSSIER_STORAGE_KEY = 'mortgageDossier:v1';
export const SCENARIOS_STORAGE_KEY = 'mortgageScenarios:v1';
// Losstaande, lichte voorkeur voor de weergavemodus (geleid/expert) — bewust NIET in het
// dossier, zodat een gedeelde link geen modus oplegt (zie uiMode in de vorm).
export const UI_MODE_STORAGE_KEY = 'mortgageUiMode:v1';

// Vult een (mogelijk onvolledig, bijv. van een oudere link) dossier-object aan met
// defaults voor ontbrekende velden, zodat laden nooit een veld ongedefinieerd laat.
export function fillDossierDefaults(partial) {
  const result = {};
  for (const key of DOSSIER_FIELD_NAMES) {
    result[key] = partial && partial[key] !== undefined ? partial[key] : DOSSIER_DEFAULTS[key];
  }
  // Oudere dossiers (zonder loanPartsBasis) bevatten de restschuld van dat moment als hoofdsom.
  // Terugrekenen naar de hoofdsom bij aanvang houdt de restschuld van vandaag gelijk aan wat
  // er destijds was ingevuld.
  if (partial && partial.loanParts !== undefined && partial.loanPartsBasis !== 'aanvang') {
    const elapsed = getElapsedMonths(result.startDate);
    result.loanParts = result.loanParts.map((part) => ({
      ...part,
      principal: String(
        Math.round(getOriginalPrincipalFromBalance(part.principal, part.rate, part.type, elapsed))
      ),
    }));
  }
  result.loanPartsBasis = 'aanvang';

  // Oudere dossiers kenden één studieschuldbedrag per partner met een globaal stelsel. Dat
  // wordt één lening per partner met de rente en looptijd van dat stelsel.
  if (partial && partial.studyLoans === undefined && partial.studyDebt1 !== undefined) {
    const preset = STUDY_LOAN_PRESETS[partial.studyDebtRegime] || STUDY_LOAN_PRESETS.nieuw;
    result.studyLoans = [
      [1, partial.studyDebt1],
      [2, partial.studyDebt2],
    ]
      .filter(([, balance]) => safeNum(balance) > 0)
      .map(([owner, balance]) => ({
        id: owner,
        owner,
        balance: String(balance),
        ratePct: preset.ratePct,
        remainingMonths: preset.months,
        monthlyPayment: '',
        status: 'regulier',
        revisionDate: '',
        revisionRatePct: '',
      }));
  }
  return result;
}

// Samenvatting voor de scenario-vergelijking: dezelfde volledige berekening als het hoofdscherm
// (computeCore), dus een opgeslagen scenario laat exact het getal zien dat u na laden krijgt.
export function computeScenarioSummary(d) {
  const { calc } = computeCore(d);
  return {
    combinedIncome: calc.combinedIncome,
    woonquote: calc.woonquote,
    maxWoonlastMonthly: calc.maxWoonlastMonthly,
    monthlyDebt: calc.monthlyDebt + calc.studyToetslast,
    incomeBasedMax: calc.incomeBasedMax,
    maxMortgage: calc.maxMortgage,
    cappedByPropertyValue: calc.cappedByPropertyValue,
    purchasePrice: safeNum(d.purchasePrice),
    isOverIndebted: calc.isOverIndebted,
  };
}

// Leningdelen van de nieuwe hypotheek waarover de debetrente voor de studieschuld-opslagfactor
// wordt gewogen: de meegenomen delen (restschuld vandaag, resterende rentevaste periode) plus
// de nieuwe geldlening tegen de beoogde rente en rentevastperiode. Een overbruggingskrediet
// hoort er niet bij. Zonder meegenomen delen en zonder bekend bedrag aan nieuw geld telt de
// nieuwe geldlening als enige deel (gewicht 1), zodat de beoogde rente de debetrente is.
export function buildDebetrenteParts(d, newMoney) {
  const parts = [];
  if (d.hasExistingHome && d.takeOverMortgage) {
    const elapsed = getElapsedMonths(d.startDate);
    toCurrentLoanParts(d.loanParts, d.startDate).forEach((part) => {
      parts.push({
        balance: safeNum(part.principal),
        ratePct: safeNum(part.rate),
        remainingFixedYears: getRemainingFixedPeriod(part.originalFixedYears, elapsed).fractionalYears,
      });
    });
  }
  const hasPorted = parts.some((p) => p.balance > 0);
  parts.push({
    balance: newMoney > 0 ? newMoney : hasPorted ? 0 : 1,
    ratePct: safeNum(d.rate),
    remainingFixedYears: safeNum(d.fixedRatePeriod),
  });
  return parts;
}

// Kern-rekenketen als pure functies op een dossier-object: dezelfde code draait voor de
// live weergave (via useMemo op dossierSnapshot) én voor de haalbaarheids-solver, die
// hypothetische varianten (andere aanschafprijs, extra eigen geld) doorrekent.
// newMoney: het bedrag aan nieuw te lenen geld dat meeweegt in de debetrente (zie computeCore).
export function computeCalc(d, { extraLiquidCapital = 0, newMoney = 0 } = {}) {
  const {
    income1,
    income2,
    rate,
    fixedRatePeriod,
    energyLabel,
    debt1,
    debt2,
    studyLoans,
    studyDebtRateMode,
    studyDebtAfslagMethod,
    ownCapital1Liquid,
    ownCapital2Liquid,
    useFamilyLoan,
    familyLoanRepaymentType,
    familyLoanMonthlyRepayment,
    age1,
    age2,
    ownCapital1,
    ownCapital2,
    purchasePrice,
    propertyUsage,
    starterExemption1,
    starterExemption2,
    notaryCosts,
    valuationCosts,
    advisoryCosts,
    includeBankGuarantee,
    includeBuyersAgent,
    includeNhgFee,
    includeKostenKoperInCalc,
    partnerAlimony1,
    partnerAlimony2,
    pensionIncome1,
    pensionIncome2,
    incomeType1,
    incomeType2,
    incomeHistory1,
    incomeHistory2,
    thirteenthMonth1,
    thirteenthMonth2,
    avgBonus1,
    avgBonus2,
    hasPartner2,
    hasSecondHome,
    secondHomeWillSell,
    useSecondHomeProceeds,
    secondHomeValue,
    secondHomeMortgageDebt,
    secondHomeInterestRate,
    secondHomeRepaymentType,
    secondHomeRemainingYears,
    secondHomeSaleCostsPct,
  } = d;

  // Toetsinkomen per aanvrager (toetsinkomen.js): afhankelijk van het inkomenstype
  // telt het bruto jaarinkomen volledig mee (vast, flex mét intentieverklaring) of
  // geldt het 3-jaarsgemiddelde gemaximeerd op het laatste jaar (flex zónder
  // intentieverklaring, ZZP). Betaalde partneralimentatie gaat er bruto (×12)
  // vanaf, vóór de woonquote-bepaling.
  const toets1 = getToetsinkomen({
    incomeType: incomeType1,
    income: income1,
    history: incomeHistory1,
    thirteenthMonth: thirteenthMonth1,
    avgBonus: avgBonus1,
    alimonyMonthly: partnerAlimony1,
  });
  // Bij één aanvrager telt Partner 2 nergens mee, ongeacht wat er nog in die velden
  // staat (ze blijven zichtbaar-onzichtbaar bewaard voor als de gebruiker weer twee
  // aanvragers kiest).
  const toets2 = hasPartner2
    ? getToetsinkomen({
        incomeType: incomeType2,
        income: income2,
        history: incomeHistory2,
        thirteenthMonth: thirteenthMonth2,
        avgBonus: avgBonus2,
        alimonyMonthly: partnerAlimony2,
      })
    : getToetsinkomen({ incomeType: 'vast', income: 0 });
  const combinedIncome = toets1.toetsinkomen + toets2.toetsinkomen;

  // A6: bij een rentevastperiode korter dan 10 jaar moet wettelijk met de (hogere)
  // AFM-toetsrente worden getoetst, nooit met de lagere daadwerkelijke rente.
  const testRate = getTestRate(rate, fixedRatePeriod);
  const toetsrenteApplies = testRate !== safeNum(rate);

  const energyBonus = getEnergyBonus(energyLabel);

  // A3: schulden worden eerst omgerekend naar een maandlast (2% van het schuldbedrag
  // voor overige schulden).
  const otherDebtMonthly =
    (safeNum(debt1) + (hasPartner2 ? safeNum(debt2) : 0)) * OTHER_DEBT_MONTHLY_WEIGHT;

  // Studieschuld (Tijdelijke regeling hypothecair krediet, art. 3a): toetslast = termijnbedrag ×
  // opslagfactor, en de afslag op de maximale hypotheek is die toetslast gekapitaliseerd. Dat
  // gebeurt in euro's op de uitkomst van de woonquote-toets en niet als maandlast erin, omdat de
  // opslagfactor en de kapitalisatierente van de samenstelling van de hypotheek afhangen.
  const activeStudyLoans = (studyLoans || [])
    .filter((loan) => (Number(loan.owner) === 2 ? hasPartner2 : true))
    .map((loan) => ({
      id: loan.id,
      owner: Number(loan.owner) === 2 ? 2 : 1,
      balance: safeNum(loan.balance),
      ratePct: safeNum(loan.ratePct),
      remainingMonths: safeNum(loan.remainingMonths),
      monthlyPayment: safeNum(loan.monthlyPayment),
      status: loan.status,
    }));
  const debetrenteWeights = getWeightedDebetrente(buildDebetrenteParts(d, newMoney), {
    afmToetsrente: TOETSRENTE,
  });
  const studyDebt = computeStudyDebt({
    loans: activeStudyLoans,
    weightedToets: debetrenteWeights.weightedToets,
    weightedContract: debetrenteWeights.weightedContract,
    debetrenteMode: studyDebtRateMode,
    afslagMethod: studyDebtAfslagMethod,
    marginalRatePct: testRate,
    year: REGULATION_YEAR,
  });
  const studyAfslag = studyDebt.totalAfslag;
  const applyStudyAfslag = (loan) => Math.max(0, loan - studyAfslag);

  // Tweede woning met eigen hypotheekschuld: bij aanhouden telt de volledige,
  // werkelijke bruto maandlast mee als schuld (geen 2%-vuistregel, want het exacte
  // bedrag is bekend — net als bij een studieschuld). Bij verkoop komt er geen
  // maandlast bij, maar wel een eenmalige netto-opbrengst (of -tekort) vrij, zie
  // totalOwnCapital hieronder.
  const secondHomeMonthly =
    hasSecondHome && !secondHomeWillSell
      ? calculateSimpleMortgagePayment(
          secondHomeMortgageDebt,
          secondHomeInterestRate,
          secondHomeRepaymentType,
          secondHomeRemainingYears
        )
      : 0;
  const secondHomeSaleCosts =
    hasSecondHome && secondHomeWillSell
      ? safeNum(secondHomeValue) * (safeNum(secondHomeSaleCostsPct) / 100)
      : 0;
  const secondHomeNetProceeds =
    hasSecondHome && secondHomeWillSell
      ? safeNum(secondHomeValue) - safeNum(secondHomeMortgageDebt) - secondHomeSaleCosts
      : 0;
  const secondHomeShortfall = secondHomeNetProceeds < 0 ? -secondHomeNetProceeds : 0;
  // Verwachte netto-opbrengst als de tweede woning ooit verkocht wordt, los van de
  // aanhouden/verkopen-keuze hierboven (die alleen bepaalt of dit bedrag NU al wordt
  // ingezet). Gebruikt om een familielening die op die toekomstige verkoop anticipeert
  // ("aflossen zodra de tweede woning verkocht is") van een concreet bedrag te voorzien.
  const secondHomeNetProceedsIfSold = hasSecondHome
    ? safeNum(secondHomeValue) -
      safeNum(secondHomeMortgageDebt) -
      safeNum(secondHomeValue) * (safeNum(secondHomeSaleCostsPct) / 100)
    : 0;

  // Een familielening die maandelijks wordt afgelost (in plaats van ineens bij een
  // toekomstige gebeurtenis, zoals de verkoop van de tweede woning) is een reguliere
  // verplichting en telt daarom mee als schuld in de Nibud-toets, net als overige
  // schulden. Bij "ineens" heeft de lening geen invloed op de leencapaciteit.
  const familyLoanMonthlyDebt =
    useFamilyLoan && familyLoanRepaymentType === 'maandelijks'
      ? safeNum(familyLoanMonthlyRepayment)
      : 0;

  const monthlyDebt = otherDebtMonthly + secondHomeMonthly + familyLoanMonthlyDebt;

  // A1-A3: echte Nibud-woonquote-systematiek 2026. De woonquote bij (toetsinkomen,
  // toetsrente) bepaalt de maximale bruto woonlast; de maandlast van bestaande schulden
  // (zonder studieschuld) gaat daar direct vanaf; het restant wordt gekapitaliseerd tegen de
  // toetsrente. De afslag voor de studieschuld volgt daarna in euro's (applyStudyAfslag).
  const nibud = getIncomeBasedMortgage(combinedIncome, testRate, monthlyDebt);
  const woonquote = nibud.woonquote;
  const nibudLoan = applyStudyAfslag(nibud.maxLoan);
  // Dezelfde toets zonder enige schuld: het beginpunt van de opbouw "wat kunt u lenen".
  const grossLoan = getIncomeBasedMortgage(combinedIncome, testRate, 0).maxLoan;

  // Ter weergave: hoeveel maximale hypotheek er wegvalt door de schulden (de
  // gekapitaliseerde waarde van de schuldmaandlast tegen de toetsrente, plus de afslag voor de
  // studieschuld).
  const debtDeduction = monthlyDebt * nibud.annuityFactor + studyAfslag;

  // Ter weergave: het specifieke aandeel van de tweede-woning-hypotheek in die
  // afslag op de leencapaciteit (dezelfde kapitalisatie, alleen voor dit ene deel van
  // monthlyDebt) — zodat de Nibud-impact van "aanhouden" apart zichtbaar is.
  const secondHomeCapacityReduction = secondHomeMonthly * nibud.annuityFactor;

  // AOW-toets (Stcrt. 2025-36471): wie binnen 10 jaar de AOW-leeftijd (67) bereikt,
  // wordt óók getoetst op het verwachte pensioeninkomen, tegen de aparte
  // AOW-financieringslasttabel (Tabel 2). De laagste van de twee uitkomsten is
  // bindend. De min() gebeurt hier op maxLoan-niveau — vóór de energiebonus en de
  // LTV-cap — zodat ook alle afgeleide berekeningen (doorstromer-bijleenruimte,
  // scenario-analyse, dubbele-lasten-test) automatisch de bindende toets volgen.
  const pensionApplies1 = safeNum(age1) >= 57;
  const pensionApplies2 = hasPartner2 && safeNum(age2) >= 57;
  const pensionApplies = pensionApplies1 || pensionApplies2;
  const pensionMissing1 = pensionApplies1 && safeNum(pensionIncome1) <= 0;
  const pensionMissing2 = pensionApplies2 && safeNum(pensionIncome2) <= 0;
  // Zolang een verwacht pensioeninkomen ontbreekt, wordt er bewust niet op €0
  // getoetst maar een waarschuwing getoond: de toets is dan onvolledig.
  const pensionIncomplete = pensionMissing1 || pensionMissing2;
  const pensionActive = pensionApplies && !pensionIncomplete;

  // Pensioenscenario-inkomen: voor aanvragers binnen 10 jaar van de AOW-leeftijd het
  // verwachte pensioeninkomen (met dezelfde alimentatie-aftrek), voor de ander het
  // gewone toetsinkomen.
  const pensionToets1 = pensionApplies1
    ? getToetsinkomen({
        incomeType: 'vast',
        income: pensionIncome1,
        alimonyMonthly: partnerAlimony1,
      })
    : toets1;
  const pensionToets2 = pensionApplies2
    ? getToetsinkomen({
        incomeType: 'vast',
        income: pensionIncome2,
        alimonyMonthly: partnerAlimony2,
      })
    : toets2;
  const pensionCombinedIncome = pensionToets1.toetsinkomen + pensionToets2.toetsinkomen;

  const nibudPension = pensionActive
    ? getIncomeBasedMortgage(pensionCombinedIncome, testRate, monthlyDebt, { aow: true })
    : null;
  const pensionLoan = pensionActive ? applyStudyAfslag(nibudPension.maxLoan) : null;
  const pensionBinding = pensionActive && pensionLoan < nibudLoan;
  const boundMaxLoan = pensionActive ? Math.min(nibudLoan, pensionLoan) : nibudLoan;

  // Scenariobedragen voor de vergelijkings-UI (beide inclusief energiebonus, zodat ze
  // één-op-één vergelijkbaar zijn met de getoonde maximale hypotheek).
  const currentScenarioMax = Math.max(0, nibudLoan + energyBonus);
  const pensionScenarioMax = pensionActive ? Math.max(0, pensionLoan + energyBonus) : null;

  const incomeBasedMax = Math.max(0, boundMaxLoan + energyBonus);

  // B10: een hypotheek kan nooit hoger zijn dan de aanschafprijs van de woning
  // (maximale LTV van 100%), ongeacht hoeveel de leencapaciteit op inkomen toelaat.
  const priceNum = safeNum(purchasePrice);
  const cappedByPropertyValue = priceNum > 0 && incomeBasedMax > priceNum;
  const maxMortgage = priceNum > 0 ? Math.min(incomeBasedMax, priceNum) : incomeBasedMax;

  // B11: kosten koper nu consistent gebaseerd op de daadwerkelijke aanschafprijs (net
  // als verderop bij de financieringsgat-berekening), in plaats van op de maximale
  // hypotheek zoals voorheen. De overdrachtsbelasting wordt gedifferentieerd bepaald
  // (startersvrijstelling, gebruiksdoel, nieuwbouw); dit is de ene gedeelde bron
  // waar ook newHomeCalc en doubleCostsCalc hun tarief uit halen.
  const kostenKoperBasis = priceNum > 0 ? priceNum : maxMortgage;
  const transferTaxInfo = getTransferTaxRate({
    propertyUsage,
    price: kostenKoperBasis,
    buyers: [
      { age: safeNum(age1), exemption: starterExemption1 },
      ...(hasPartner2 ? [{ age: safeNum(age2), exemption: starterExemption2 }] : []),
    ].filter((b) => b.age > 0),
  });
  const transferTax = kostenKoperBasis * transferTaxInfo.rate;

  // Netto-opbrengst van de verkochte tweede woning: een positieve opbrengst telt
  // alleen mee als extra eigen middelen als u die ook daadwerkelijk voor déze aankoop
  // wilt inzetten (useSecondHomeProceeds). Een restschuld-tekort is geen keuze — dat
  // moet u sowieso uit eigen zak bijleggen bij verkoop — en verlaagt dus altijd de
  // beschikbare eigen middelen, ongeacht die schakelaar.
  const secondHomeProceedsApplied =
    hasSecondHome && secondHomeWillSell && useSecondHomeProceeds
      ? Math.max(0, secondHomeNetProceeds)
      : 0;
  // Ingebracht eigen vermogen telt hier alleen mee als het nu al liquide is. Vermogen dat
  // pas vrijkomt bij een latere gebeurtenis (bijv. de verkoop van een aangehouden tweede
  // woning) is nu niet beschikbaar voor deze aankoop en wordt apart bijgehouden als
  // illiquidOwnCapital — zichtbaar gemaakt in het financieringsgat, in plaats van
  // stilzwijgend meegeteld alsof het al op de rekening staat.
  const liquidOwnCapital1 = ownCapital1Liquid ? safeNum(ownCapital1) : 0;
  const liquidOwnCapital2 = hasPartner2 && ownCapital2Liquid ? safeNum(ownCapital2) : 0;
  const illiquidOwnCapital =
    (ownCapital1Liquid ? 0 : safeNum(ownCapital1)) +
    (hasPartner2 && !ownCapital2Liquid ? safeNum(ownCapital2) : 0);
  // extraLiquidCapital is alleen voor de solver ("hoeveel extra eigen geld is nodig?");
  // in de live berekening altijd 0.
  const totalOwnCapital =
    liquidOwnCapital1 +
    liquidOwnCapital2 +
    secondHomeProceedsApplied -
    secondHomeShortfall +
    extraLiquidCapital;

  // Indicatieve hypotheek als basis voor de NHG-borgtochtprovisie: wat er na inzet van
  // het eigen vermogen gefinancierd moet worden, begrensd door de maximale hypotheek.
  const nhgMortgageBasis = Math.min(
    maxMortgage,
    Math.max(0, kostenKoperBasis - totalOwnCapital)
  );
  const kostenKoper = getKostenKoperBreakdown({
    price: kostenKoperBasis,
    mortgageAmount: nhgMortgageBasis,
    transferTax,
    transferTaxLabel: transferTaxInfo.shortLabel,
    options: {
      notaryCosts,
      valuationCosts,
      advisoryCosts,
      includeBankGuarantee,
      includeBuyersAgent,
      includeNhgFee,
    },
  });
  const ownMoney = includeKostenKoperInCalc ? kostenKoper.total : 0;

  // Eenmalig aftrekbare financieringskosten (box 1, jaar van aankoop): hypotheekadvies,
  // taxatie (voor de financiering) en de NHG-borgtochtprovisie zijn eenmalig aftrekbaar.
  // Overdrachtsbelasting en de leveringsakte zijn dat niet. Notariskosten worden hier
  // bewust buiten beschouwing gelaten: dat bedrag dekt zowel de niet-aftrekbare
  // leveringsakte als de wél aftrekbare hypotheekakte, en dit veld splitst die twee niet
  // uit — een verkeerde precisie zou hier misleidender zijn dan een duidelijke uitsluiting.
  const deductibleFinancingCostKeys = ['advisory', 'valuation', 'nhgFee'];
  const deductibleFinancingCosts = kostenKoper.items
    .filter((item) => deductibleFinancingCostKeys.includes(item.key) && item.included)
    .reduce((sum, item) => sum + item.amount, 0);
  const financingCostsHraRate = getHraRate(toets1.toetsinkomen, toets2.toetsinkomen);
  const financingCostsTaxBenefit = deductibleFinancingCosts * financingCostsHraRate;

  // De studieschuld is te hoog zodra de afslag méér is dan wat de woonquote-toets nog toelaat.
  const isOverIndebted = monthlyDebt > nibud.maxWoonlastMonthly || studyAfslag > nibud.maxLoan;
  const showSustainability = ['E', 'F', 'G'].includes(energyLabel);
  const purchasingPower = maxMortgage + totalOwnCapital;

  // Basis voor de aanvullende-hypotheektoets verderop: leencapaciteit o.b.v. inkomen bij
  // de daadwerkelijke rente, zonder de generieke toetsrentecorrectie hierboven (die is
  // gebaseerd op één algemene rentevastperiode-aanname). Bij het toetsen van de
  // aanvullende leningdelen wordt per leningdeel opnieuw en preciezer getoetst.
  // Ook hier geldt de AOW-toets: het bindende (laagste) scenario telt.
  const nibudAtActualRate = getIncomeBasedMortgage(combinedIncome, safeNum(rate), monthlyDebt);
  const boundMaxLoanAtActualRate = pensionActive
    ? Math.min(
        applyStudyAfslag(nibudAtActualRate.maxLoan),
        applyStudyAfslag(
          getIncomeBasedMortgage(pensionCombinedIncome, safeNum(rate), monthlyDebt, { aow: true })
            .maxLoan
        )
      )
    : applyStudyAfslag(nibudAtActualRate.maxLoan);
  const incomeBasedMaxAtActualRate = Math.max(0, boundMaxLoanAtActualRate + energyBonus);

  // Drie leencapaciteit-stappen voor de resultaatweergave, zodat zichtbaar is waar de
  // hypotheek precies kleiner wordt: (1) puur op inkomen, bij de werkelijke rente en
  // zonder schulden; (2) diezelfde toets met de maandlast van schulden erin
  // (incomeBasedMaxAtActualRate hierboven); (3) ook nog met de toetsrente-afslag die
  // geldt zodra een leningdeel korter dan 10 jaar rentevast is (incomeBasedMax verderop,
  // al inclusief AOW-toets). Ook hier telt het bindende AOW-scenario mee, zodat de eerste
  // stap consistent blijft met de andere twee.
  const nibudIncomeOnly = getIncomeBasedMortgage(combinedIncome, safeNum(rate), 0);
  const boundMaxLoanIncomeOnly = pensionActive
    ? Math.min(
        nibudIncomeOnly.maxLoan,
        getIncomeBasedMortgage(pensionCombinedIncome, safeNum(rate), 0, { aow: true }).maxLoan
      )
    : nibudIncomeOnly.maxLoan;
  const maxLoanIncomeOnly = Math.max(0, boundMaxLoanIncomeOnly + energyBonus);

  // Effectieve leenfactor puur ter illustratie (maximale hypotheek gedeeld door inkomen);
  // de daadwerkelijke toets verloopt via de woonquote hierboven, niet via deze factor.
  const effectiveFactor = combinedIncome > 0 ? incomeBasedMax / combinedIncome : 0;

  return {
    combinedIncome,
    toets1,
    toets2,
    woonquote,
    effectiveFactor,
    maxWoonlastMonthly: nibud.maxWoonlastMonthly,
    energyBonus,
    debtDeduction,
    otherDebtMonthly,
    studyDebt,
    studyAfslag,
    studyToetslast: studyDebt.totalToetslast,
    maxLoanBeforeStudy: nibud.maxLoan,
    // Tussenstappen van de leencapaciteit, alle bij dezelfde (toets)rente, zodat de opbouw
    // (zie capacityBreakdown.js) exact sluit: grossLoan − afslagen = loanAfterStudy, daarna de
    // AOW-toets (boundMaxLoan) en de energiebonus tot incomeBasedMax.
    capacity: {
      rate: testRate,
      capitalizationFactor: nibud.annuityFactor,
      grossLoan,
      loanAfterDebts: nibud.maxLoan,
      loanAfterStudy: nibudLoan,
      pensionLoan,
      boundMaxLoan,
      debtAfslag: {
        secondHome: secondHomeMonthly * nibud.annuityFactor,
        otherDebts: otherDebtMonthly * nibud.annuityFactor,
        familyLoan: familyLoanMonthlyDebt * nibud.annuityFactor,
      },
    },
    secondHomeMonthly,
    secondHomeSaleCosts,
    secondHomeNetProceeds,
    secondHomeShortfall,
    secondHomeCapacityReduction,
    secondHomeProceedsApplied,
    monthlyDebt,
    availableMonthly: nibud.availableMonthly,
    annuityFactor: nibud.annuityFactor,
    maxLoanIncomeOnly,
    incomeBasedMax,
    incomeBasedMaxAtActualRate,
    cappedByPropertyValue,
    maxMortgage,
    transferTaxInfo,
    transferTax,
    kostenKoper,
    ownMoney,
    deductibleFinancingCosts,
    financingCostsHraRate,
    financingCostsTaxBenefit,
    isOverIndebted,
    showSustainability,
    pensionApplies,
    pensionApplies1,
    pensionApplies2,
    pensionMissing1,
    pensionMissing2,
    pensionIncomplete,
    pensionBinding,
    pensionCombinedIncome,
    currentScenarioMax,
    pensionScenarioMax,
    totalOwnCapital,
    illiquidOwnCapital,
    secondHomeNetProceedsIfSold,
    familyLoanMonthlyDebt,
    purchasingPower,
    toetsrenteApplies,
    testRate,
  };
}

export function computeCurrentMortgage(d, calc) {
  const {
    startDate,
    marketValue,
    saleDiscountPercentage,
    takeOverMortgage,
    includeEwfInNetCalc,
  } = d;

  const elapsedMonths = getElapsedMonths(startDate);
  const loanParts = toCurrentLoanParts(d.loanParts, startDate);

  const partResults = loanParts.map((part) => calculateLoanPart(part, elapsedMonths, startDate));

  const totalGross = partResults.reduce((sum, p) => sum + p.grossMonthly, 0);
  const totalInterest = partResults.reduce((sum, p) => sum + p.interestMonthly, 0);
  const totalPrincipal = partResults.reduce((sum, p) => sum + p.principalMonthly, 0);
  const deductibleInterest = partResults.reduce(
    (sum, p) => sum + (p.eligibleForHRA ? p.interestMonthly : 0),
    0
  );

  const hraRate = getHraRate(calc.toets1.toetsinkomen, calc.toets2.toetsinkomen);
  const taxBenefit = deductibleInterest * hraRate;
  const ewfYearly = includeEwfInNetCalc ? EWF_RATE * Math.min(safeNum(marketValue), EWF_CAP) : 0;
  const ewfMonthly = ewfYearly / 12;
  const netTaxBenefit = taxBenefit - ewfMonthly;
  const totalNet = totalGross - netTaxBenefit;

  const netInterestComponent = Math.max(0, totalInterest - netTaxBenefit);
  const hasAflossingsvrij = loanParts.some((p) => p.type === 'Aflossingsvrij');
  // B9: "Resterende rentevastperiode" deed voorheen niets. Nu telt het mee als
  // waarschuwing wanneer een leningdeel binnen 2 jaar opnieuw moet worden vastgezet.
  const partsWithExpiringFixedPeriod = loanParts.filter(
    (p, i) => partResults[i].fixedPeriodExpiringSoon
  );
  const hasExpiringFixedPeriod = partsWithExpiringFixedPeriod.length > 0;

  // Toetsrente geldt niet alleen voor een nieuwe hypotheek, maar ook voor meegenomen
  // leningdelen met een resterende rentevastperiode korter dan 10 jaar: voor de
  // leencapaciteitstoets wordt zo'n deel getoetst alsof de rente bij afloop stijgt
  // naar de AFM-toetsrente, ook al is de daadwerkelijke (lagere) contractrente wat er
  // nu echt betaald wordt.
  const rateRiskParts = loanParts.map((part, i) => {
    const remainingFractionalYears = partResults[i].fixedPeriod.fractionalYears;
    const testRate = getTestRate(part.rate, remainingFractionalYears);
    const actualRate = safeNum(part.rate);
    let haircut = 0;
    if (testRate !== actualRate) {
      const stressResult = calculateLoanPart({ ...part, rate: testRate }, elapsedMonths, startDate);
      const extraMonthly = Math.max(0, stressResult.grossMonthly - partResults[i].grossMonthly);
      haircut = extraMonthly * getCapitalizationFactor(testRate);
    }
    return {
      id: part.id,
      index: i,
      balance: safeNum(part.principal),
      rate: actualRate,
      testRate,
      remainingFixedYears: remainingFractionalYears,
      haircut,
    };
  });
  const rateRiskCapacityHaircut = rateRiskParts.reduce((sum, p) => sum + p.haircut, 0);
  // Het renterisico op een korte rentevastperiode is alleen relevant als het leningdeel
  // daadwerkelijk wordt meegenomen; wordt de hypotheek afgelost bij verkoop, dan vervalt
  // dat risico voor de nieuwe financiering volledig.
  const effectiveRateRiskHaircut = takeOverMortgage ? rateRiskCapacityHaircut : 0;
  const hasRateRiskOnPortedDebt = takeOverMortgage && rateRiskCapacityHaircut > 0;

  const currentDebtBalance = loanParts.reduce((sum, p) => sum + safeNum(p.principal), 0);
  const ltv = safeNum(marketValue) > 0 ? (currentDebtBalance / safeNum(marketValue)) * 100 : 0;
  // Meegenomen hypotheek: alleen van toepassing als de meeneemregeling aan staat. Wordt
  // deze uitgezet, dan wordt de bestaande hypotheek bij verkoop volledig afgelost (de
  // overwaarde-berekening houdt daar al rekening mee) en moet de nieuwe woning volledig
  // opnieuw gefinancierd worden.
  const portedDebt = takeOverMortgage ? currentDebtBalance : 0;
  // Werkelijke leencapaciteit: de inkomensgebaseerde leencapaciteit, gecorrigeerd voor het
  // renterisico op meegenomen leningdelen met een korte rentevastperiode. Dit is het getal
  // dat er in de praktijk toe doet, in plaats van de ongecorrigeerde leencapaciteit o.b.v.
  // inkomen alleen. Let op: hier bewust calc.incomeBasedMax gebruikt (ongekort door de
  // aanschafprijs), niet calc.maxMortgage. Anders zou uw bijleenruimte en maximale
  // aankoopbudget circulair begrensd worden door de aanschafprijs die u toevallig nu heeft
  // ingesteld, terwijl deze getallen juist bedoeld zijn om te laten zien wat maximaal
  // haalbaar is, ongeacht de huidige stand van de schuifknop.
  const effectiveMaxMortgage = Math.max(0, calc.incomeBasedMax - effectiveRateRiskHaircut);
  const extraBorrowCapacity = Math.max(0, effectiveMaxMortgage - portedDebt);
  // Werkelijke overwaarde: marktwaarde min restschuld, ongekort. Sommige geldverstrekkers
  // tellen de nog niet (onvoorwaardelijk) verkochte woning echter niet voor 100% mee als
  // onderpand voor de financiering, maar hanteren een verkoopafslag (bijvoorbeeld 95%). De
  // "bruikbare" overwaarde voor financieringsdoeleinden houdt hier rekening mee.
  const saleValueForFinancing = safeNum(marketValue) * (saleDiscountPercentage / 100);
  const overwaarde = safeNum(marketValue) - currentDebtBalance;
  const usableOverwaarde = Math.max(0, saleValueForFinancing - currentDebtBalance);
  // Onderwaarde: als de (met verkoopafslag gecorrigeerde) verkoopwaarde lager is dan de
  // restschuld, blijft er na verkoop een restschuld-tekort staan dat moet worden afgelost
  // en dus meegefinancierd/uit eigen middelen betaald moet worden.
  const restschuldTekort = Math.max(0, currentDebtBalance - saleValueForFinancing);

  return {
    totalGross,
    totalInterest,
    totalPrincipal,
    hraRate,
    taxBenefit,
    ewfMonthly,
    netTaxBenefit,
    totalNet,
    netInterestComponent,
    hasAflossingsvrij,
    hasExpiringFixedPeriod,
    partsWithExpiringFixedPeriod,
    rateRiskCapacityHaircut,
    rateRiskParts,
    hasRateRiskOnPortedDebt,
    effectiveMaxMortgage,
    currentDebtBalance,
    portedDebt,
    ltv,
    extraBorrowCapacity,
    overwaarde,
    usableOverwaarde,
    saleValueForFinancing,
    restschuldTekort,
  };
}

export function computeCombinedGap(d, calc, currentMortgage) {
  const {
    purchasePrice,
    lenderCapThreshold,
    limitOwnContribution,
    desiredMaxOwnContribution,
    useFamilyLoan,
    familyLoanAmount,
    familyLoanRate,
    includeKostenKoperInCalc,
  } = d;

  const price = safeNum(purchasePrice);
  const portedDebt = currentMortgage.portedDebt;
  const overwaarde = currentMortgage.usableOverwaarde;
  const restschuldTekort = currentMortgage.restschuldTekort;
  // Meeneemregeling: de bestaande hypotheek gaat mee tegen de oude voorwaarden, en de
  // overwaarde komt daarnaast vrij als cash. Samen dekken deze twee posten een deel van de
  // aanschafprijs; wat overblijft is het financieringsgat. Bij onderwaarde is er geen
  // overwaarde maar juist een restschuld-tekort dat na verkoop moet worden afgelost; dat
  // vergroot het gat (symmetrisch aan hoe overwaarde het gat verkleint).
  const gap = price - portedDebt - overwaarde + restschuldTekort;
  // Eigen inleg: standaard wordt zoveel mogelijk eigen vermogen ingezet om het gat te
  // dichten (zoals voorheen). Met limitOwnContribution geeft u aan zélf niet meer dan een
  // bepaald bedrag te willen inleggen (ex kosten koper, die lopen via de kaart Kosten
  // koper) — het restant van het gat moet dan via de hypotheek of andere bronnen komen.
  // Kosten koper worden (grotendeels) uit eigen middelen betaald en kunnen niet boven 100%
  // LTV worden meegefinancierd. Meegeteld (includeKostenKoperInCalc) verlagen ze dus het
  // eigen vermogen dat nog voor het financieringsgat beschikbaar is — dat verschuift het gat
  // naar de aanvullende hypotheek en laat, bij ontoereikende capaciteit, de haalbaarheid
  // kantelen. Zo blijft dit consistent met "Overgebleven ruimte na woning + kosten koper" in
  // het Maximaal-aankoopbudget-blok (en met de aan/uit-schakelaar bij Kosten koper).
  const kostenKoperCash = includeKostenKoperInCalc ? calc.kostenKoper.total : 0;
  const ownCapitalForGap = Math.max(0, calc.totalOwnCapital - kostenKoperCash);
  const ownContributionCap = limitOwnContribution
    ? Math.max(0, safeNum(desiredMaxOwnContribution))
    : Infinity;
  const ownCapitalApplied = Math.min(
    ownCapitalForGap,
    Math.max(0, gap),
    ownContributionCap
  );
  // Wat er nog gefinancierd moet worden nadat de (eventueel beperkte) eigen inleg is
  // toegepast — dit is het bedrag waarvoor hieronder aanvullende leningdelen worden
  // opgesplitst, ongeacht of dit daadwerkelijk geleend kán worden (zie capaciteitstoets).
  const additionalMortgage = Math.max(0, gap - ownCapitalApplied);
  const surplus = gap < 0 ? -gap : 0;

  // Twee onafhankelijke, bindende grenzen op de aanvullende hypotheek: de Nibud-
  // inkomenstoets (extraBorrowCapacity) én het absolute plafond van de geldverstrekker
  // (lenderCapThreshold, hierboven al meegenomen in de bepaling van de bank; hier het
  // resterende bedrag onder dat plafond na de meegenomen hypotheek).
  const lenderCapRoom = Math.max(0, getLenderCap(lenderCapThreshold) - portedDebt);
  const additionalMortgageCapacity = Math.min(
    currentMortgage.extraBorrowCapacity,
    lenderCapRoom
  );
  const bindingCapIsLender = lenderCapRoom < currentMortgage.extraBorrowCapacity;
  const capacityMargin = additionalMortgageCapacity - additionalMortgage;
  const withinCapacity = capacityMargin >= 0;
  // Sommige geldverstrekkers hanteren een interne grens voor de totale hypotheek
  // (meegenomen plus nieuw), waarboven aanvullende acceptatie-eisen gelden.
  const totalMortgageAfterMove = portedDebt + additionalMortgage;
  const exceedsLenderCap = totalMortgageAfterMove > getLenderCap(lenderCapThreshold);

  // Resterend gat na bank- en Nibud-capaciteit: hier kan een tijdelijke, onderhandse
  // familielening inspringen — bijvoorbeeld omdat de tweede woning nog niet verkocht is
  // en daar (anders dan bij de eigen woning) geen overbruggingskrediet op mogelijk is.
  const shortfallBeforeFamilyLoan = Math.max(0, -capacityMargin);
  const familyLoanApplied = useFamilyLoan
    ? Math.min(Math.max(0, safeNum(familyLoanAmount)), shortfallBeforeFamilyLoan)
    : 0;
  const familyLoanMonthlyInterest = (familyLoanApplied * (safeNum(familyLoanRate) / 100)) / 12;
  const netCapacityMargin = capacityMargin + familyLoanApplied;
  const remainingShortfall = Math.max(0, -netCapacityMargin);
  const withinCapacityAfterFamilyLoan = netCapacityMargin >= 0;

  return {
    portedDebt,
    overwaarde,
    restschuldTekort,
    gap,
    ownContributionCap,
    ownCapitalApplied,
    additionalMortgage,
    lenderCapRoom,
    additionalMortgageCapacity,
    bindingCapIsLender,
    capacityMargin,
    withinCapacity,
    surplus,
    totalMortgageAfterMove,
    exceedsLenderCap,
    shortfallBeforeFamilyLoan,
    familyLoanApplied,
    familyLoanMonthlyInterest,
    netCapacityMargin,
    remainingShortfall,
    withinCapacityAfterFamilyLoan,
  };
}

// Starters: zelfde principe als computeCombinedGap — kosten koper (indien meegeteld) kunnen
// niet boven 100% LTV worden meegefinancierd en gaan dus eerst van het eigen vermogen af; wat
// daarna overblijft verlaagt de benodigde hypotheek.
export function computeStarterGap(d, calc) {
  const price = safeNum(d.purchasePrice);
  const kostenKoperCash = d.includeKostenKoperInCalc ? calc.kostenKoper.total : 0;
  const ownCapitalAfterCosts = calc.totalOwnCapital - kostenKoperCash;
  const cashShortfall = Math.max(0, -ownCapitalAfterCosts);
  const requiredMortgage = Math.max(0, price - Math.max(0, ownCapitalAfterCosts));
  const lenderCap = getLenderCap(d.lenderCapThreshold);
  const capacity = Math.min(calc.incomeBasedMax, lenderCap);
  const bindingCapIsLender = lenderCap < calc.incomeBasedMax;
  const capacityShortfall = Math.max(0, requiredMortgage - capacity);
  const shortfall = capacityShortfall + cashShortfall;
  return {
    kostenKoperCash,
    ownCapitalAfterCosts,
    cashShortfall,
    requiredMortgage,
    capacity,
    bindingCapIsLender,
    capacityShortfall,
    shortfall,
    feasible: shortfall <= 0,
  };
}

// Maximaal aankoopbudget (alleen bij een bestaande woning): eigen vermogen, bruikbare overwaarde,
// de meegenomen hypotheek en de maximale nieuwe hypotheek vormen samen het hoogste bedrag dat voor
// de beoogde woning neergelegd kan worden. De nieuwe hypotheek is het laagste van de
// inkomensgebaseerde ruimte (Nibud, al gecorrigeerd voor renterisico) en wat het plafond van de
// geldverstrekker overlaat (combinedGap.additionalMortgageCapacity), zodat budget en
// haalbaarheidsoordeel nooit uit elkaar lopen.
export function computeMaxBudget(d, calc, currentMortgage, combinedGap) {
  const eigenVermogen = calc.totalOwnCapital;
  const overwaarde = currentMortgage.usableOverwaarde;
  const oudeHypotheek = currentMortgage.portedDebt;
  const nieuweHypotheekMax = combinedGap.additionalMortgageCapacity;
  // Bij onderwaarde moet het restschuld-tekort van het budget af: dat bedrag gaat op aan
  // het aflossen van de restschuld die na verkoop overblijft.
  const maxBudget =
    eigenVermogen + overwaarde + oudeHypotheek + nieuweHypotheekMax - currentMortgage.restschuldTekort;
  const price = safeNum(d.purchasePrice);
  const remainingRoom = maxBudget - price;
  // Kosten koper moet óók uit dit budget komen (grotendeels uit eigen geld — je kunt de
  // overdrachtsbelasting e.d. niet boven 100% LTV meefinancieren), dus het "overgebleven"
  // t.o.v. alleen de aanschafprijs is te rooskleurig. Volg de includeKostenKoperInCalc-
  // schakelaar: staat die uit, dan telt kosten koper hier (net als elders) niet mee.
  const kostenKoper = d.includeKostenKoperInCalc ? calc.kostenKoper.total : 0;
  const totalNeeded = price + kostenKoper;
  const remainingAfterCosts = maxBudget - totalNeeded;

  return {
    eigenVermogen,
    overwaarde,
    oudeHypotheek,
    nieuweHypotheekMax,
    maxBudget,
    price,
    remainingRoom,
    kostenKoper,
    totalNeeded,
    remainingAfterCosts,
  };
}


// De rekenketen calc → currentMortgage → combinedGap in één keer. Bij een doorstromer hangt de
// studieschuld-opslagfactor af van het gewicht van het nieuwe geld in de hypotheek (zie
// buildDebetrenteParts), en dat bedrag volgt weer uit het financieringsgat. Dat verloopt in een
// paar ronden naar een vast punt: het gat hangt alleen nog via de NHG-provisie van de
// leencapaciteit af. Live weergave, scenario-samenvatting en solver gebruiken allemaal deze
// functie, zodat ze altijd hetzelfde antwoord geven.
export function computeCore(d, { extraLiquidCapital = 0 } = {}) {
  let newMoney = 0;
  let result = null;
  for (let round = 0; round < 3; round++) {
    const calc = computeCalc(d, { extraLiquidCapital, newMoney });
    const currentMortgage = computeCurrentMortgage(d, calc);
    const combinedGap = computeCombinedGap(d, calc, currentMortgage);
    result = { calc, currentMortgage, combinedGap };
    if (!d.hasExistingHome) break;
    const needed = combinedGap.additionalMortgage;
    if (Math.abs(needed - newMoney) < 1) break;
    newMoney = needed;
  }
  return result;
}

// Eén haalbaarheidsoordeel voor zowel de live weergave als de solver.
export function evaluateAffordability(d, { extraLiquidCapital = 0 } = {}) {
  const { calc, combinedGap } = computeCore(d, { extraLiquidCapital });
  if (d.hasExistingHome) {
    return {
      affordable: combinedGap.withinCapacityAfterFamilyLoan,
      shortfall: combinedGap.remainingShortfall,
    };
  }
  const starter = computeStarterGap(d, calc);
  return { affordable: starter.feasible, shortfall: starter.shortfall };
}

export const SOLVER_PRICE_STEP = 1000;
export const SOLVER_CAPITAL_STEP = 1;
export const SOLVER_PRICE_CEILING = 20000000;

// Hoogste aanschafprijs die met de huidige invoer haalbaar is. Haalbaarheid is monotoon in de
// prijs (een hogere prijs verhoogt het gat én de kosten koper), dus binair zoeken volstaat.
// Ondergrens is één stap i.p.v. 0, omdat kosten koper bij prijs 0 op de maximale hypotheek
// terugvallen als grondslag.
// Zoekt op het raster (veelvouden van SOLVER_PRICE_STEP), zodat het resultaat zelf haalbaar is
// en niet pas achteraf wordt afgerond.
export function findMaxAffordablePrice(d) {
  const ok = (steps) =>
    evaluateAffordability({ ...d, purchasePrice: steps * SOLVER_PRICE_STEP }).affordable;
  const ceiling = SOLVER_PRICE_CEILING / SOLVER_PRICE_STEP;
  if (!ok(1)) return null;
  let lo = 1;
  let hi = Math.max(Math.ceil(safeNum(d.purchasePrice) / SOLVER_PRICE_STEP), 100);
  while (ok(hi)) {
    lo = hi;
    if (hi >= ceiling) return SOLVER_PRICE_CEILING;
    hi = Math.min(hi * 2, ceiling);
  }
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (ok(mid)) lo = mid;
    else hi = mid;
  }
  return lo * SOLVER_PRICE_STEP;
}

// Hoeveel extra, direct beschikbaar eigen geld maakt de huidige aanschafprijs haalbaar?
// null = extra eigen geld alléén lost het niet op (bijv. door een actieve eigen-inleg-limiet).
export function findExtraOwnCapitalNeeded(d) {
  const ok = (steps) =>
    evaluateAffordability(d, { extraLiquidCapital: steps * SOLVER_CAPITAL_STEP }).affordable;
  if (ok(0)) return 0;
  let lo = 0;
  let hi = Math.ceil((2 * safeNum(d.purchasePrice) + 1000000) / SOLVER_CAPITAL_STEP);
  if (!ok(hi)) return null;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (ok(mid)) hi = mid;
    else lo = mid;
  }
  return hi * SOLVER_CAPITAL_STEP;
}

// Een rentevastperiode van 10+ jaar ontloopt de AFM-toetsrente; alleen relevant als die nu
// geldt en de overstap het tekort daadwerkelijk verkleint.
export function evaluateFixedRateLever(d, base) {
  if (safeNum(d.fixedRatePeriod) >= 10 || getTestRate(d.rate, d.fixedRatePeriod) === safeNum(d.rate)) {
    return null;
  }
  const alt = evaluateAffordability({ ...d, fixedRatePeriod: 10 });
  return alt.shortfall < base.shortfall ? alt : null;
}

export function solveAffordabilityLevers(d) {
  const base = evaluateAffordability(d);
  return {
    maxPrice: findMaxAffordablePrice(d),
    extraOwnCapital: base.affordable ? 0 : findExtraOwnCapitalNeeded(d),
    fixedRate: base.affordable ? null : evaluateFixedRateLever(d, base),
  };
}

