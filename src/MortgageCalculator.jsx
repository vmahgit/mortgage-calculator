import React, { useState, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence, animate } from 'framer-motion';
import {
  Euro,
  User,
  Leaf,
  AlertTriangle,
  Home,
  CreditCard,
  GraduationCap,
  Percent,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Plus,
  Trash2,
  Building2,
  CalendarDays,
  Info,
  PiggyBank,
  TrendingUp,
  CheckCircle2,
  Receipt,
  Briefcase,
  RotateCcw,
  BookOpen,
  HardHat,
  Calculator,
  FileDown,
} from 'lucide-react';
import OptionalPropertyDataModule from './OptionalPropertyDataModule';
import ScenarioAnalysis from './ScenarioAnalysis';
import BorderGlow from './BorderGlow';
import SectionRail, { useScrollSpy } from './SectionRail';
import { getBouwdepotEstimate } from './bouwdepot';
import { getIncomeBasedMortgage } from './nibud2026';
import { getToetsinkomen, INCOME_TYPES } from './toetsinkomen';
import {
  getTransferTaxRate,
  getKostenKoperBreakdown,
  STARTER_EXEMPTION_PRICE_CAP,
  STARTER_EXEMPTION_MIN_AGE,
  STARTER_EXEMPTION_MAX_AGE,
  KOSTEN_KOPER_DEFAULTS,
} from './kostenKoper';

const ENERGY_LABELS = ['G', 'F', 'E', 'D', 'C', 'B', 'A', 'A+', 'A++', 'A+++', 'A++++'];

function getEnergyBonus(label) {
  if (['G', 'F', 'E'].includes(label)) return 0;
  if (['D', 'C'].includes(label)) return 5000;
  if (['B', 'A'].includes(label)) return 10000;
  // 2026 Nibud-bijstelling: door de terugleverkosten en het afbouwen van de
  // salderingsregeling leveren zonnepanelen minder op, waardoor het Nibud het extra
  // hypotheekbedrag voor zeer energiezuinige woningen (A+ en hoger) heeft verlaagd
  // ten opzichte van eerdere jaren.
  if (['A+', 'A++'].includes(label)) return 15000;
  if (['A+++', 'A++++'].includes(label)) return 20000;
  return 0;
}

// De maximale hypotheek op basis van inkomen loopt sinds deze versie via de echte
// Nibud-woonquote-systematiek 2026 (zie nibud2026.js), in plaats van via een handmatig
// getunede leenfactor.

const AFLOSVORMEN = ['Annuïteit', 'Lineair', 'Aflossingsvrij'];
const TERM_MONTHS = 360;
// Hypotheekrenteaftrek 2026: sinds 2023 wettelijk begrensd op maximaal het tarief van de
// tweede belastingschijf in box 1 (37,56% in 2026) — ook wie in de hoogste schijf
// (49,50%) valt, trekt dus nooit meer af dan dit plafond. Wie met zijn/haar toetsinkomen
// echter volledig binnen de eerste schijf blijft, trekt af tegen het (lagere)
// eerste-schijftarief van 35,70%, niet tegen het plafond.
// Bron: Belastingdienst/Prinsjesdag 2026, box 1-schijven en aftrektarief eigen woning.
const HRA_RATE_BRACKET1 = 0.357;
const HRA_RATE_CAP = 0.3756;
const HRA_BRACKET1_THRESHOLD = 38883;

// Bepaalt het toepasselijke HRA-tarief op basis van de (toets)inkomens van de
// aanvrager(s): zodra minstens één aanvrager boven de eerste schijf uitkomt, kan het
// rentevoordeel aan diegene toegerekend worden tegen het gecapte tarief.
function getHraRate(...incomes) {
  const maxIncome = Math.max(0, ...incomes.map((v) => (isNaN(v) ? 0 : v)));
  return maxIncome > HRA_BRACKET1_THRESHOLD ? HRA_RATE_CAP : HRA_RATE_BRACKET1;
}

const EWF_RATE = 0.0035;
const EWF_CAP = 1350000;
const SCENARIO_PERCENTAGES = [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5];
// Overdrachtsbelasting en kosten koper zijn niet langer vaste percentages maar worden
// gedifferentieerd en per post bepaald via getTransferTaxRate() en
// getKostenKoperBreakdown() in kostenKoper.js.
// AFM-toetsrente 2026 (elk kwartaal vastgesteld, tot nu toe steeds 5%). Verplicht te
// gebruiken zodra de rentevastperiode van de nieuwe hypotheek korter is dan 10 jaar.
const TOETSRENTE = 5.0;
// Sommige geldverstrekkers hanteren een interne acceptatiegrens voor de totale
// hypotheeksom, waarboven aanvullende eisen of een ander acceptatietraject gelden. Dit is
// een redelijke default; gebruikers met een afwijkend maximum bij hun eigen
// geldverstrekker kunnen dit zelf aanpassen (zie lenderCapThreshold state).
const LENDER_CAP_THRESHOLD_DEFAULT = 1000000;
// Wegingsfactor overige schulden: 2% per maand van het schuldbedrag, de gangbare norm
// voor consumptief krediet (doorlopend krediet, persoonlijke lening).
const OTHER_DEBT_MONTHLY_WEIGHT = 0.02;

// Studieschuld telt sinds 1 januari 2024 niet meer mee via een vaste wegingsfactor op de
// oorspronkelijke schuld, maar op basis van de daadwerkelijke DUO-terugbetaalregeling: de
// actuele DUO-rente 2026 en de aflostermijn die bij het stelsel hoort, toegepast op de
// openstaande restschuld, net als een annuïtaire lening.
const STUDY_DEBT_REGIMES = {
  nieuw: { label: 'Nieuw stelsel (vanaf sept. 2015, SF35)', rate: 2.33, termYears: 35 },
  oud: { label: 'Oud stelsel (vóór sept. 2015, SF15)', rate: 2.29, termYears: 15 },
};

function getStudyDebtMonthlyBurden(debtAmount, regimeKey) {
  const debt = safeNum(debtAmount);
  if (debt <= 0) return 0;
  const regime = STUDY_DEBT_REGIMES[regimeKey] || STUDY_DEBT_REGIMES.nieuw;
  const r = regime.rate / 100 / 12;
  const n = regime.termYears * 12;
  if (r === 0) return debt / n;
  return (debt * r) / (1 - Math.pow(1 + r, -n));
}

// Kapitaliseert een vaste maandlast naar een hypotheekbedrag met de annuïteitenfactor
// bij een gegeven rente over 30 jaar, dezelfde methodiek als Nibud gebruikt om
// maandlasten van schulden te vertalen naar een verlaging van de maximale hypotheek.
function getCapitalizationFactor(ratePct) {
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
function getTestRate(rate, fixedYears) {
  const actualRate = safeNum(rate);
  const years = safeNum(fixedYears);
  if (years > 0 && years < 10 && TOETSRENTE > actualRate) {
    return TOETSRENTE;
  }
  return actualRate;
}

function getElapsedMonths(dateStr, refDate = new Date()) {
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
function getRemainingFixedPeriod(originalFixedYears, elapsedMonths) {
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

function getYearFromDate(dateStr) {
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? 0 : d.getFullYear();
}

// Projecteert de resterende hoofdsom van een leningdeel na een aantal maanden vanaf nu,
// gegeven de huidige hoofdsom (vandaag) en de resterende looptijd op dit moment. Gebruikt
// voor de aflossingsgrafiek, niet voor de huidige maandlasten zelf.
function projectRemainingBalance(principal, ratePct, type, remainingMonthsNow, monthsFromNow) {
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

function formatDateNL(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' }).format(d);
}

function calculateLoanPart(part, elapsedMonths, startDate) {
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
function calculateSimpleMortgagePayment(principal, annualRatePct, type, remainingYears) {
  const P = safeNum(principal);
  const r = safeNum(annualRatePct) / 100 / 12;
  const N = Math.max(1, Math.round(safeNum(remainingYears) * 12));
  if (type === 'Aflossingsvrij') return P * r;
  if (type === 'Lineair') return P / N + P * r;
  if (r === 0) return P / N;
  return (P * r) / (1 - Math.pow(1 + r, -N));
}

function safeNum(value) {
  const n = parseFloat(value);
  return isNaN(n) || !isFinite(n) ? 0 : n;
}

const currencyFormatter = new Intl.NumberFormat('nl-NL', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
});

function formatEuro(amount) {
  return currencyFormatter.format(safeNum(amount));
}

// Vloeiend omhoog/omlaag tellend eurobedrag: animeert van de vorige waarde naar de nieuwe
// zodra het resultaat verandert, in plaats van hard te verspringen. Respecteert de
// systeeminstelling "verminderde beweging" door dan direct de eindwaarde te tonen.
function AnimatedEuro({ value, className }) {
  const [display, setDisplay] = useState(() => safeNum(value));
  const [pulsing, setPulsing] = useState(false);
  const prev = useRef(safeNum(value));

  useEffect(() => {
    const target = safeNum(value);
    const from = prev.current;
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReduced) {
      prev.current = target;
      setDisplay(target);
      return undefined;
    }

    // Bij een significante wijziging (>5%) een korte puls op het getal, zodat direct
    // duidelijk is dat een aanpassing elders echt effect had, niet alleen bij kleine
    // afrondingsverschillen.
    const relativeChange = from !== 0 ? Math.abs((target - from) / from) : target !== 0 ? 1 : 0;
    let pulseTimeout;
    if (relativeChange > 0.05) {
      setPulsing(true);
      pulseTimeout = setTimeout(() => setPulsing(false), 600);
    }

    const controls = animate(from, target, {
      duration: 0.8,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setDisplay(v),
    });
    prev.current = target;
    return () => {
      controls.stop();
      clearTimeout(pulseTimeout);
    };
  }, [value]);

  // De buitenste wrapper is bewust altijd inline-block: een schaal-transform werkt niet op
  // een gewoon inline element, en dit laat de meegegeven className (die soms `block` bevat
  // voor de lay-out) op het binnenste element ongemoeid.
  return (
    <motion.span
      className="inline-block"
      animate={pulsing ? { scale: [1, 1.08, 1] } : { scale: 1 }}
      transition={{ duration: 0.6, ease: 'easeOut' }}
    >
      <span className={className}>{formatEuro(display)}</span>
    </motion.span>
  );
}

function formatRate(rate) {
  return safeNum(rate).toFixed(2).replace('.', ',') + '%';
}

function Slider({ id, label, icon, value, min, max, step, onChange, formatValue, hint, labelExtra }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
          {icon}
          {label}
          {labelExtra}
        </label>
        <span className="text-sm font-semibold text-blue-700">{formatValue(value)}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-3 rounded-lg appearance-none cursor-pointer bg-slate-200 accent-blue-600 transition-all duration-200 touch-none"
      />
      {hint && <p className="text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

function NumberField({ id, label, icon, value, onChange, placeholder, suffix, hint, min = 0, max }) {
  // Klemt de waarde binnen [min, max] zodra er een geldig getal staat, zodat onzinnige
  // invoer (negatieve leeftijden, absurd hoge waarden) niet in de berekening terechtkomt.
  const handleChange = (e) => {
    const raw = e.target.value;
    if (raw === '') {
      onChange(raw);
      return;
    }
    const num = parseFloat(raw);
    if (isNaN(num)) {
      onChange(raw);
      return;
    }
    let clamped = num;
    if (min !== undefined && clamped < min) clamped = min;
    if (max !== undefined && clamped > max) clamped = max;
    onChange(String(clamped));
  };

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
        {icon}
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={value}
          onChange={handleChange}
          placeholder={placeholder}
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-base text-slate-800 outline-none transition-all duration-200 focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
        />
        {suffix && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">
            {suffix}
          </span>
        )}
      </div>
      {hint && <p className="text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

function formatThousandsDisplay(value) {
  const raw = String(value ?? '').trim();
  if (raw === '' || raw === '-') return raw;
  const num = parseFloat(raw.replace(',', '.'));
  if (isNaN(num)) return raw;
  const [intPartRaw, decimalPart] = raw.replace(',', '.').split('.');
  const intNum = parseInt(intPartRaw, 10);
  const intFormatted = isNaN(intNum)
    ? intPartRaw
    : intNum.toLocaleString('nl-NL', { maximumFractionDigits: 0 });
  return decimalPart !== undefined ? `${intFormatted},${decimalPart}` : intFormatted;
}

function parseDisplayInput(str) {
  if (str === '') return '';
  const cleaned = str
    .replace(/[^0-9.,]/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  return cleaned;
}

function CurrencyField({ id, label, icon, value, onChange, placeholder, hint }) {
  const [isFocused, setIsFocused] = useState(false);
  const displayValue = isFocused ? value : formatThousandsDisplay(value);

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
        {icon}
        {label}
      </label>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">
          €
        </span>
        <input
          id={id}
          type="text"
          inputMode="decimal"
          value={displayValue}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          onChange={(e) => onChange(parseDisplayInput(e.target.value))}
          placeholder={placeholder}
          className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-7 pr-3 text-base text-slate-800 outline-none transition-all duration-200 focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
        />
      </div>
      {hint && <p className="text-xs text-slate-400">{hint}</p>}
    </div>
  );
}


// Officiële kleuren van het Nederlandse energielabel (RVO), van rood (G) naar diepgroen
// (A++++), gebruikt voor de labelchips in plaats van platte tekst.
const ENERGY_LABEL_COLORS = {
  G: '#D32F2F',
  F: '#F4511E',
  E: '#FB8C00',
  D: '#FDD835',
  C: '#C0CA33',
  B: '#7CB342',
  A: '#43A047',
  'A+': '#2E7D32',
  'A++': '#1B5E20',
  'A+++': '#0D4A1B',
  'A++++': '#063513',
};

const ENERGY_LABEL_TEXT_ON_LIGHT = new Set(['D', 'C']);

function EnergyLabelChip({ label, size = 'md' }) {
  const bg = ENERGY_LABEL_COLORS[label] || '#94a3b8';
  const textColor = ENERGY_LABEL_TEXT_ON_LIGHT.has(label) ? '#3f3a00' : '#ffffff';
  const sizeClasses = size === 'sm' ? 'h-7 min-w-[2.25rem] px-2 text-xs' : 'h-9 min-w-[3rem] px-3 text-sm';
  return (
    <span
      className={`inline-flex items-center justify-center rounded-l-md font-bold shadow-sm ${sizeClasses}`}
      style={{
        backgroundColor: bg,
        color: textColor,
        clipPath: 'polygon(0 0, 75% 0, 100% 50%, 75% 100%, 0 100%)',
      }}
    >
      {label}
    </span>
  );
}

function EnergyLabelPicker({ id, label, icon, value, onChange }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
        {icon}
        {label}
      </label>
      <div id={id} role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
        {ENERGY_LABELS.map((opt) => (
          <button
            key={opt}
            type="button"
            role="radio"
            aria-checked={value === opt}
            onClick={() => onChange(opt)}
            className={`rounded-l-md transition-all duration-150 ${
              value === opt
                ? 'scale-110 ring-2 ring-offset-1 ring-blue-500'
                : 'opacity-50 hover:opacity-90'
            }`}
          >
            <EnergyLabelChip label={opt} size="sm" />
          </button>
        ))}
      </div>
    </div>
  );
}

function SelectField({ id, label, icon, value, onChange, options }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
        {icon}
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-base text-slate-800 outline-none transition-all duration-200 focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    </div>
  );
}

function DateField({ id, label, icon, value, onChange, hint }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
        {icon}
        {label}
      </label>
      <input
        id={id}
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-base text-slate-800 outline-none transition-all duration-200 focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
      />
      {hint && <p className="text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

// Accentkleur per categorie: geeft elke kaart een eigen gekleurde linkerrand en
// icoon-achtergrond i.p.v. dat alle kaarten er identiek (vlak blauw) uitzien.
const SECTION_ACCENTS = {
  blue: { icon: 'bg-blue-50 text-blue-600', border: 'border-l-blue-400' },
  amber: { icon: 'bg-amber-50 text-amber-600', border: 'border-l-amber-400' },
  emerald: { icon: 'bg-emerald-50 text-emerald-600', border: 'border-l-emerald-400' },
  violet: { icon: 'bg-violet-50 text-violet-600', border: 'border-l-violet-400' },
  indigo: { icon: 'bg-indigo-50 text-indigo-600', border: 'border-l-indigo-400' },
};

function SectionCard({ title, icon, children, id, accent = 'blue' }) {
  const styles = SECTION_ACCENTS[accent] || SECTION_ACCENTS.blue;
  return (
    <div
      id={id}
      className={`rounded-2xl bg-white p-6 shadow-xl border border-l-4 border-slate-100 ${styles.border} transition-all duration-200 hover:-translate-y-0.5 hover:shadow-2xl`}
    >
      <div className="mb-5 flex items-center gap-2">
        <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${styles.icon}`}>
          {icon}
        </span>
        <h2 className="text-base font-semibold text-slate-800">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function PartnerSubCard({ label, children }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4 space-y-4 transition-all duration-200">
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
        <User className="h-3.5 w-3.5" />
        {label}
      </div>
      {children}
    </div>
  );
}

// Inkomenstype-keuze per aanvrager (vast / flex mét of zónder intentieverklaring / ZZP).
function IncomeTypeSelect({ id, value, onChange }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
        <Briefcase className="h-3.5 w-3.5 text-slate-400" />
        Inkomenstype
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-base text-slate-800 outline-none transition-all duration-200 focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
      >
        {Object.entries(INCOME_TYPES).map(([key, label]) => (
          <option key={key} value={key}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
}

// Drie jaar inkomenshistorie voor flex zonder intentieverklaring en ZZP: de laatste
// drie kalenderjaren, met het meest recente jaar bovenaan (y1 = laatste jaar).
function IncomeHistoryFields({ idPrefix, incomeType, history, onChange }) {
  const currentYear = new Date().getFullYear();
  const labelBase = incomeType === 'zzp' ? 'Fiscale winst' : 'Bruto jaarinkomen';
  return (
    <>
      {[
        ['y1', currentYear - 1],
        ['y2', currentYear - 2],
        ['y3', currentYear - 3],
      ].map(([key, year]) => (
        <CurrencyField
          key={key}
          id={`${idPrefix}-${key}`}
          label={`${labelBase} ${year}`}
          icon={<Euro className="h-3.5 w-3.5 text-slate-400" />}
          value={history[key]}
          onChange={(v) => onChange(key, v)}
          placeholder="0"
        />
      ))}
    </>
  );
}

// Berekende toetsinkomen-regel onderaan elke partner-kaart, met uitleg waarom het
// afwijkt van het ingevoerde inkomen (3-jaarscap, alimentatie, intentieverklaring).
function ToetsinkomenSummary({ toets, incomeType }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-500">Toetsinkomen</span>
        <span className="text-sm font-bold text-slate-800">{formatEuro(toets.toetsinkomen)}</span>
      </div>
      {toets.cappedAtLastYear && (
        <p className="mt-1 text-[11px] text-slate-400">
          3-jaarsgemiddelde gemaximeerd op het laatste jaar
        </p>
      )}
      {toets.structural > 0 && (
        <p className="mt-1 text-[11px] text-slate-400">
          Incl. {formatEuro(toets.structural)} structureel/gemiddeld extra inkomen
        </p>
      )}
      {toets.alimonyDeduction > 0 && (
        <p className="mt-1 text-[11px] text-slate-400">
          Na aftrek van {formatEuro(toets.alimonyDeduction)} betaalde partneralimentatie per jaar
        </p>
      )}
      {incomeType === 'flexMet' && (
        <p className="mt-1 text-[11px] text-emerald-600">
          Telt volledig mee dankzij de intentieverklaring van de werkgever
        </p>
      )}
      {toets.usesHistory && toets.insufficientHistory && (
        <p className="mt-1 text-[11px] text-amber-600">
          Minder dan drie jaren ingevuld.{' '}
          {incomeType === 'zzp'
            ? 'Korter dan drie jaar ZZP wordt door geldverstrekkers beperkter beoordeeld; deze uitkomst is extra indicatief.'
            : 'Vul drie jaarinkomens in voor een betrouwbare middeling.'}
        </p>
      )}
    </div>
  );
}

// Verbergt minder vaak gebruikte velden (13e maand, bonus, alimentatie) achter een
// "Meer opties"-toggle, dicht bij het veld gehouden i.p.v. verzameld op app-niveau: elk
// gebruik heeft zijn eigen open/dicht-status. Standaard dicht, zodat het merendeel van de
// gebruikers (voor wie deze velden op 0 blijven staan) een rustiger formulier ziet.
function AdvancedFieldsToggle({ children, label = 'Meer opties' }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center gap-1 text-xs font-medium text-blue-600 transition-colors duration-200 hover:text-blue-700"
      >
        {open ? (
          <ChevronUp className="h-3.5 w-3.5" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5" />
        )}
        {open ? 'Minder opties' : label}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="space-y-4 pt-4">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Klein (i)-icoon dat op klik/tik een korte uitleg toont bij vaktermen (toetsinkomen,
// woonquote, AFM-toetsrente, ...). Werkt met een klik i.p.v. alleen hover, zodat het ook op
// mobiel bruikbaar is; sluit vanzelf bij een klik daarbuiten. `variant="light"` is bedoeld
// voor gebruik op de donkere resultaat-sidebar.
function InfoTooltip({ text, variant = 'default' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const handleClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  return (
    <span ref={ref} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label="Meer uitleg"
        className={`inline-flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded-full transition-colors duration-150 ${
          variant === 'light'
            ? 'text-blue-200/70 hover:text-white'
            : 'text-slate-300 hover:text-blue-500'
        }`}
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 4, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.96 }}
            transition={{ duration: 0.15 }}
            className="absolute left-1/2 top-full z-50 mt-2 w-56 -translate-x-1/2 rounded-lg bg-slate-800 px-3 py-2 text-left text-xs font-normal leading-relaxed text-white shadow-xl"
          >
            {text}
            <span className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-slate-800" />
          </motion.div>
        )}
      </AnimatePresence>
    </span>
  );
}

function LoanPartCard({ part, index, onChange, onRemove, canRemove, elapsedMonths }) {
  const fixedPeriod = getRemainingFixedPeriod(part.originalFixedYears, elapsedMonths);
  const testRate = getTestRate(part.rate, fixedPeriod.fractionalYears);
  const toetsrenteAppliesToPart = testRate !== safeNum(part.rate);

  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4 space-y-4 transition-all duration-200">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Leningdeel {index + 1}
        </span>
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-slate-400 transition-all duration-200 hover:bg-red-50 hover:text-red-500"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Verwijderen
          </button>
        )}
      </div>
      <SelectField
        id={`type-${part.id}`}
        label="Aflosvorm"
        icon={<PiggyBank className="h-3.5 w-3.5 text-slate-400" />}
        value={part.type}
        onChange={(v) => onChange('type', v)}
        options={AFLOSVORMEN}
      />
      <CurrencyField
        id={`principal-${part.id}`}
        label="Hoofdsom leningdeel"
        icon={<Euro className="h-3.5 w-3.5 text-slate-400" />}
        value={part.principal}
        onChange={(v) => onChange('principal', v)}
        placeholder="0"
      />
      <Slider
        id={`rate-${part.id}`}
        label="Hypotheekrente leningdeel"
        icon={<Percent className="h-3.5 w-3.5 text-slate-400" />}
        value={part.rate}
        min={1.0}
        max={6.0}
        step={0.01}
        onChange={(v) => onChange('rate', v)}
        formatValue={formatRate}
      />
      <div className="space-y-1.5">
        <Slider
          id={`fixed-${part.id}`}
          label="Rentevastperiode (oorspronkelijk)"
          icon={<CalendarDays className="h-3.5 w-3.5 text-slate-400" />}
          value={part.originalFixedYears}
          min={1}
          max={30}
          step={1}
          onChange={(v) => onChange('originalFixedYears', v)}
          formatValue={(v) => `${v} jaar`}
        />
        <p className="text-xs text-slate-400">
          Resterend, berekend vanaf de ingangsdatum hierboven:{' '}
          {fixedPeriod.remainingMonths <= 0
            ? 'verlopen, rente kan al opnieuw vastgezet worden'
            : `${fixedPeriod.years} jaar en ${fixedPeriod.months} ${
                fixedPeriod.months === 1 ? 'maand' : 'maanden'
              }`}
        </p>
        {toetsrenteAppliesToPart && (
          <p className="flex items-start gap-1.5 text-xs text-amber-600">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
            Resterende rentevastperiode korter dan 10 jaar: dit deel wordt voor de
            leencapaciteit getoetst tegen {formatRate(TOETSRENTE)} in plaats van de eigen
            rente van {formatRate(part.rate)}, dit verlaagt uw bijleenruimte.
          </p>
        )}
      </div>
    </div>
  );
}

function AdditionalLoanPartCard({ part, index, onChange, onRemove, canRemove }) {
  const testRate = getTestRate(part.rate, part.originalFixedYears);
  const toetsrenteAppliesToPart = testRate !== safeNum(part.rate);

  return (
    <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-4 space-y-4 transition-all duration-200">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-indigo-700">
          Nieuw leningdeel {index + 1}
        </span>
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-slate-400 transition-all duration-200 hover:bg-red-50 hover:text-red-500"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Verwijderen
          </button>
        )}
      </div>
      <SelectField
        id={`add-type-${part.id}`}
        label="Aflosvorm"
        icon={<PiggyBank className="h-3.5 w-3.5 text-slate-400" />}
        value={part.type}
        onChange={(v) => onChange('type', v)}
        options={AFLOSVORMEN}
      />
      <CurrencyField
        id={`add-principal-${part.id}`}
        label="Hoofdsom nieuw leningdeel"
        icon={<Euro className="h-3.5 w-3.5 text-slate-400" />}
        value={part.principal}
        onChange={(v) => onChange('principal', v)}
        placeholder="0"
      />
      <Slider
        id={`add-rate-${part.id}`}
        label="Rekenrente nieuw leningdeel"
        icon={<Percent className="h-3.5 w-3.5 text-slate-400" />}
        value={part.rate}
        min={1.0}
        max={6.0}
        step={0.01}
        onChange={(v) => onChange('rate', v)}
        formatValue={formatRate}
      />
      <Slider
        id={`add-fixed-${part.id}`}
        label="Rentevastperiode"
        icon={<CalendarDays className="h-3.5 w-3.5 text-slate-400" />}
        value={part.originalFixedYears}
        min={1}
        max={30}
        step={1}
        onChange={(v) => onChange('originalFixedYears', v)}
        formatValue={(v) => `${v} jaar`}
      />
      {toetsrenteAppliesToPart && (
        <p className="flex items-start gap-1.5 text-xs text-amber-600">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          Rentevastperiode korter dan 10 jaar: dit deel wordt voor de leencapaciteit getoetst
          tegen {formatRate(TOETSRENTE)} in plaats van de eigen rente van{' '}
          {formatRate(part.rate)}.
        </p>
      )}
    </div>
  );
}

function DoubleCostsTimeline({ oldBurden, newBurden, months, allowedMonthly }) {
  const combined = oldBurden + newBurden;
  const maxScale = Math.max(combined, allowedMonthly, 1) * 1.15;
  const oldHeightPct = (Math.max(0, oldBurden) / maxScale) * 100;
  const newHeightPct = (Math.max(0, newBurden) / maxScale) * 100;
  const allowedPct = (Math.max(0, allowedMonthly) / maxScale) * 100;
  const overBudget = combined > allowedMonthly;

  return (
    <div className="w-full">
      <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
        <span>Nu</span>
        <span>
          Verwachte verkoop, over {months} {months === 1 ? 'maand' : 'maanden'}
        </span>
      </div>
      <div className="relative h-40 w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
        <motion.div
          initial={{ height: 0 }}
          animate={{ height: `${oldHeightPct}%` }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className="absolute bottom-0 left-0 w-full bg-blue-400"
        />
        <motion.div
          initial={{ height: 0 }}
          animate={{ height: `${newHeightPct}%` }}
          transition={{ duration: 0.6, ease: 'easeOut', delay: 0.1 }}
          className="absolute left-0 w-full bg-indigo-500"
          style={{ bottom: `${oldHeightPct}%` }}
        />
        <div
          className={`absolute left-0 w-full border-t-2 border-dashed ${
            overBudget ? 'border-red-500' : 'border-emerald-500'
          }`}
          style={{ bottom: `${allowedPct}%` }}
        >
          <span
            className={`absolute -top-4 right-2 text-[10px] font-medium ${
              overBudget ? 'text-red-600' : 'text-emerald-600'
            }`}
          >
            Toegestaan: {formatEuro(allowedMonthly)}
          </span>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
        <div className="flex items-center gap-1.5 text-xs text-slate-600">
          <span className="h-2.5 w-2.5 rounded-sm bg-blue-400" />
          Huidige hypotheek:{' '}
          <span className="font-semibold text-slate-800">{formatEuro(oldBurden)}</span> per
          maand
        </div>
        <div className="flex items-center gap-1.5 text-xs text-slate-600">
          <span className="h-2.5 w-2.5 rounded-sm bg-indigo-500" />
          Nieuwe hypotheek:{' '}
          <span className="font-semibold text-slate-800">{formatEuro(newBurden)}</span> per
          maand
        </div>
      </div>
    </div>
  );
}

function AmortizationChart({ data }) {
  const width = 680;
  const height = 260;
  const padding = { top: 16, right: 16, bottom: 32, left: 60 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const maxBalance = Math.max(1, ...data.map((d) => d.total));

  const xScale = (year) => padding.left + (year / 30) * chartWidth;
  const yScale = (balance) =>
    padding.top + chartHeight - (Math.max(0, balance) / maxBalance) * chartHeight;
  const baseline = yScale(0);

  const bottomLine = data.map((d) => [xScale(d.year), yScale(d.portedBalance)]);
  const topLine = data.map((d) => [xScale(d.year), yScale(d.total)]);

  const layer1Path =
    `M ${xScale(0)},${baseline} ` +
    bottomLine.map(([x, y]) => `L ${x},${y}`).join(' ') +
    ` L ${xScale(30)},${baseline} Z`;

  const layer2Path =
    `M ${bottomLine[0][0]},${bottomLine[0][1]} ` +
    topLine.map(([x, y]) => `L ${x},${y}`).join(' ') +
    ' ' +
    [...bottomLine]
      .reverse()
      .map(([x, y]) => `L ${x},${y}`)
      .join(' ') +
    ' Z';

  const gridYears = [0, 10, 20, 30];

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full">
      {[0, 0.25, 0.5, 0.75, 1].map((f, i) => {
        const y = padding.top + chartHeight * (1 - f);
        const value = maxBalance * f;
        return (
          <g key={i}>
            <line
              x1={padding.left}
              y1={y}
              x2={width - padding.right}
              y2={y}
              stroke="#e2e8f0"
              strokeWidth="1"
            />
            <text x={padding.left - 8} y={y + 4} textAnchor="end" fontSize="10" fill="#94a3b8">
              {value >= 1000 ? `${Math.round(value / 1000)}k` : Math.round(value)}
            </text>
          </g>
        );
      })}
      <motion.path
        d={layer1Path}
        fill="#60a5fa"
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.85 }}
        transition={{ duration: 0.7, ease: 'easeOut' }}
      />
      <motion.path
        d={layer2Path}
        fill="#6366f1"
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.85 }}
        transition={{ duration: 0.7, delay: 0.1, ease: 'easeOut' }}
      />
      {gridYears.map((yr) => (
        <text
          key={yr}
          x={xScale(yr)}
          y={height - 8}
          textAnchor="middle"
          fontSize="10"
          fill="#94a3b8"
        >
          Jaar {yr}
        </text>
      ))}
    </svg>
  );
}

function BudgetBar({ segments, total, marker }) {
  const safeTotal = Math.max(total, marker || 0, 1);
  const markerPct = marker != null ? Math.min(100, (marker / safeTotal) * 100) : null;

  return (
    <div className="w-full">
      <div className="relative">
        <div className="flex h-9 w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
          {segments.map((seg, i) => {
            const value = Math.max(0, seg.value);
            const pct = safeTotal > 0 ? (value / safeTotal) * 100 : 0;
            if (pct <= 0) return null;
            return (
              <motion.div
                key={i}
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.6, ease: 'easeOut' }}
                className={seg.className}
                title={`${seg.label}: ${formatEuro(seg.value)}`}
              />
            );
          })}
        </div>
        {markerPct != null && (
          <div
            className="absolute top-0 flex h-9 flex-col items-center"
            style={{ left: `${markerPct}%`, transform: 'translateX(-50%)' }}
          >
            <div className="h-9 w-0.5 bg-slate-900" />
          </div>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
        {segments.map((seg, i) => (
          <div key={i} className="flex items-center gap-1.5 text-xs text-slate-600">
            <span className={`h-2.5 w-2.5 rounded-sm ${seg.dotClassName}`} />
            {seg.label}: <span className="font-semibold text-slate-800">{formatEuro(seg.value)}</span>
          </div>
        ))}
        {marker != null && (
          <div className="flex items-center gap-1.5 text-xs text-slate-600">
            <span className="h-2.5 w-0.5 bg-slate-900" />
            Aanschafprijs beoogde woning:{' '}
            <span className="font-semibold text-slate-800">{formatEuro(marker)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status, children, className = '' }) {
  const config = {
    success: {
      border: 'border-emerald-100',
      bg: 'bg-emerald-50',
      text: 'text-emerald-700',
      iconColor: 'text-emerald-600',
      Icon: CheckCircle2,
    },
    warning: {
      border: 'border-amber-100',
      bg: 'bg-amber-50',
      text: 'text-amber-700',
      iconColor: 'text-amber-500',
      Icon: AlertTriangle,
    },
    error: {
      border: 'border-red-100',
      bg: 'bg-red-50',
      text: 'text-red-700',
      iconColor: 'text-red-500',
      Icon: AlertTriangle,
    },
    info: {
      border: 'border-blue-100',
      bg: 'bg-blue-50',
      text: 'text-blue-700',
      iconColor: 'text-blue-500',
      Icon: Info,
    },
  };
  const c = config[status] || config.info;
  const Icon = c.Icon;

  return (
    <div className={`flex items-start gap-2 rounded-lg border ${c.border} ${c.bg} p-3 ${className}`}>
      <Icon className={`mt-0.5 h-4 w-4 flex-shrink-0 ${c.iconColor}`} />
      <div className={`text-xs ${c.text}`}>{children}</div>
    </div>
  );
}

// Rustige, niet-gekleurde variant voor puur informatieve toelichtingen (waarom een getal
// afwijkt, achtergrond bij een berekening) die geen actie van de gebruiker vragen. Een
// StatusBadge trekt de aandacht met kleur; deze variant houdt dat gereserveerd voor
// meldingen die er echt toe doen (verdicts, waarschuwingen die actie vragen).
function InlineNote({ children, className = '' }) {
  return (
    <p className={`mt-3 flex items-start gap-1.5 text-xs text-slate-400 ${className}`}>
      <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-slate-300" />
      <span>{children}</span>
    </p>
  );
}

function DonutChart({ interestValue, principalValue, centerLabel, centerValue }) {
  const total = Math.max(0, interestValue) + Math.max(0, principalValue);
  const radius = 70;
  const circumference = 2 * Math.PI * radius;
  const interestShare = total > 0 ? Math.max(0, interestValue) / total : 0;
  const interestLength = circumference * interestShare;
  const principalLength = circumference - interestLength;

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:justify-center">
      <div className="relative h-44 w-44 flex-shrink-0">
        <svg viewBox="0 0 180 180" className="h-44 w-44 -rotate-90">
          <circle cx="90" cy="90" r={radius} fill="none" stroke="#e2e8f0" strokeWidth="18" />
          <motion.circle
            cx="90"
            cy="90"
            r={radius}
            fill="none"
            stroke="#2563eb"
            strokeWidth="18"
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: circumference - interestLength }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
          />
          <motion.circle
            cx="90"
            cy="90"
            r={radius}
            fill="none"
            stroke="#34d399"
            strokeWidth="18"
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: circumference - principalLength }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
            style={{ rotate: `${interestShare * 360}deg`, transformOrigin: '90px 90px' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[11px] uppercase tracking-wide text-slate-400">{centerLabel}</span>
          <span className="text-lg font-bold text-slate-800">{formatEuro(centerValue)}</span>
        </div>
      </div>
      <div className="space-y-2 text-sm">
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full bg-blue-600" />
          <span className="text-slate-600">Rente</span>
          <span className="font-semibold text-slate-800">{formatEuro(interestValue)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full bg-emerald-400" />
          <span className="text-slate-600">Aflossing</span>
          <span className="font-semibold text-slate-800">{formatEuro(principalValue)}</span>
        </div>
      </div>
    </div>
  );
}

// Keuzeknoppen voor het maximaal toegestane percentage aflossingsvrij (30/50/100% van de
// woningwaarde). Zelfde visuele stijl als de studieschuld-stelsel/verkoopafslag-toggles.
function AflossingsvrijMaxToggle({ value, onChange }) {
  return (
    <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1">
      {[30, 50, 100].map((pct) => (
        <button
          key={pct}
          type="button"
          onClick={() => onChange(pct)}
          className={`rounded-md px-3 py-2 sm:py-1.5 text-xs font-semibold transition-all duration-200 ${
            value === pct
              ? 'bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-sm'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          {pct}%
        </button>
      ))}
    </div>
  );
}

function MortgageCalculatorForm({ onReset }) {
  const [income1, setIncome1] = useState(118000);
  const [income2, setIncome2] = useState(115000);
  const [age1, setAge1] = useState('36');
  const [age2, setAge2] = useState('36');
  const [ownCapital1, setOwnCapital1] = useState(0);
  const [ownCapital2, setOwnCapital2] = useState(0);
  const [rate, setRate] = useState(4.0);
  const [fixedRatePeriod, setFixedRatePeriod] = useState(10);
  const [energyLabel, setEnergyLabel] = useState('A');
  const [purchasePrice, setPurchasePrice] = useState(1350000);
  // Standaard twee aanvragers; schakelbaar naar één aanvrager (Partner 2 telt dan
  // nergens in de berekening mee, ongeacht wat er nog in die velden staat).
  const [hasPartner2, setHasPartner2] = useState(true);
  const [debt1, setDebt1] = useState('0');
  const [debt2, setDebt2] = useState('0');
  const [studyDebt1, setStudyDebt1] = useState('14000');
  const [studyDebt2, setStudyDebt2] = useState('0');
  const [studyDebtRegime, setStudyDebtRegime] = useState('oud');

  // Overdrachtsbelasting: gebruiksdoel van de beoogde woning en, per koper, of de
  // startersvrijstelling nog beschikbaar is (niet eerder gebruikt).
  const [propertyUsage, setPropertyUsage] = useState('zelfbewoning');
  // Default op "al gebruikt" (dus geen vrijstelling meer): de gebruiker moet actief
  // aangeven dat de startersvrijstelling nog beschikbaar is, in plaats van dat de tool
  // dit optimistisch aanneemt.
  const [starterExemption1, setStarterExemption1] = useState(false);
  const [starterExemption2, setStarterExemption2] = useState(false);

  // Nieuwbouw: bouwdepot-bedrag (leeg = valt terug op de aanschafprijs) en de verwachte
  // bouwperiode in maanden, voor de indicatieve rente-tijdens-de-bouw-schatting
  // (zie bouwdepot.js). Alleen relevant/zichtbaar bij propertyUsage === 'nieuwbouw'.
  const [bouwdepotAmount, setBouwdepotAmount] = useState('');
  const [constructionMonths, setConstructionMonths] = useState(12);
  const [showBouwdepotCard, setShowBouwdepotCard] = useState(true);

  // Kosten koper: per post aanpasbare bedragen en aan/uit te zetten posten, met
  // realistische 2026-defaults (zie kostenKoper.js).
  const [notaryCosts, setNotaryCosts] = useState(String(KOSTEN_KOPER_DEFAULTS.notaryCosts));
  const [valuationCosts, setValuationCosts] = useState(
    String(KOSTEN_KOPER_DEFAULTS.valuationCosts)
  );
  const [advisoryCosts, setAdvisoryCosts] = useState(
    String(KOSTEN_KOPER_DEFAULTS.advisoryCosts)
  );
  const [includeBankGuarantee, setIncludeBankGuarantee] = useState(true);
  const [includeBuyersAgent, setIncludeBuyersAgent] = useState(false);
  const [includeNhgFee, setIncludeNhgFee] = useState(false);
  // Eigenwoningforfait verlaagt het netto belastingvoordeel, maar staat default uit: de
  // gebruiker moet deze verfijning bewust aanzetten in de netto-weergave.
  const [includeEwfInNetCalc, setIncludeEwfInNetCalc] = useState(false);
  // Kosten koper worden altijd berekend en getoond, maar tellen standaard NIET mee in de
  // rest van de berekening (geschat eigen geld, dubbele-lastentoets) - pas na expliciete
  // keuze van de gebruiker.
  const [includeKostenKoperInCalc, setIncludeKostenKoperInCalc] = useState(false);
  const [showKostenKoperCard, setShowKostenKoperCard] = useState(false);
  const [showAuditTrail, setShowAuditTrail] = useState(false);

  // Betaalde partneralimentatie per aanvrager (bruto per maand): gaat ×12 van het
  // toetsinkomen af, vóór de woonquote-bepaling (zie toetsinkomen.js).
  const [partnerAlimony1, setPartnerAlimony1] = useState('0');
  const [partnerAlimony2, setPartnerAlimony2] = useState('0');

  // AOW-toets: verwacht bruto pensioeninkomen per jaar (incl. AOW) per aanvrager.
  // Alleen relevant (en zichtbaar) vanaf leeftijd 57 — binnen 10 jaar van de
  // AOW-leeftijd van 67. Leeg = nog niet ingevuld; er wordt dan bewust NIET op €0
  // getoetst maar een waarschuwing getoond.
  const [pensionIncome1, setPensionIncome1] = useState('');
  const [pensionIncome2, setPensionIncome2] = useState('');

  // Inkomenstype per aanvrager: 'vast' | 'flexMet' | 'flexZonder' | 'zzp'.
  // Bij flexZonder/zzp geldt het gemiddelde van de laatste drie jaarinkomens
  // (resp. fiscale winsten), gemaximeerd op het laatste jaar (zie toetsinkomen.js);
  // de gewone inkomens-slider verdwijnt dan uit beeld.
  const [incomeType1, setIncomeType1] = useState('vast');
  const [incomeType2, setIncomeType2] = useState('vast');
  const [incomeHistory1, setIncomeHistory1] = useState({ y1: '', y2: '', y3: '' });
  const [incomeHistory2, setIncomeHistory2] = useState({ y1: '', y2: '', y3: '' });

  // Structureel inkomen (vaste 13e maand/eindejaarsuitkering, telt volledig mee) en
  // incidenteel inkomen (bonus/overwerk, alleen als gemiddelde over drie jaar meetellen
  // conform de systematiek — hier als één bedrag per jaar ingevoerd).
  const [thirteenthMonth1, setThirteenthMonth1] = useState('0');
  const [thirteenthMonth2, setThirteenthMonth2] = useState('0');
  const [avgBonus1, setAvgBonus1] = useState('0');
  const [avgBonus2, setAvgBonus2] = useState('0');

  const [showCurrentMortgage, setShowCurrentMortgage] = useState(true);
  const [showBijleenruimte, setShowBijleenruimte] = useState(true);
  const [showAanvullendeHypotheek, setShowAanvullendeHypotheek] = useState(true);
  const [showDoubleCostsTest, setShowDoubleCostsTest] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const [hasExistingHome, setHasExistingHome] = useState(true);
  // Tweede woning met een eigen, los van de verhuizing staande hypotheekschuld —
  // onafhankelijk van de "huidige woning" hierboven (die gaat over de woning die u
  // verlaat bij de verhuizing). secondHomeWillSell bepaalt of de schuld (aanhouden)
  // blijft meetellen als maandlast, of dat de netto-verkoopopbrengst (verkopen)
  // vrijkomt als extra eigen middelen. useSecondHomeProceeds is een aparte schakelaar:
  // ook bij verkoop wilt u een positieve netto-opbrengst misschien niet (volledig)
  // inzetten voor déze aankoop.
  const [showSecondHome, setShowSecondHome] = useState(false);
  const [hasSecondHome, setHasSecondHome] = useState(false);
  const [secondHomeWillSell, setSecondHomeWillSell] = useState(true);
  const [useSecondHomeProceeds, setUseSecondHomeProceeds] = useState(true);
  const [secondHomeValue, setSecondHomeValue] = useState('300000');
  const [secondHomeMortgageDebt, setSecondHomeMortgageDebt] = useState('150000');
  const [secondHomeInterestRate, setSecondHomeInterestRate] = useState(4.0);
  const [secondHomeRepaymentType, setSecondHomeRepaymentType] = useState('Annuïteit');
  const [secondHomeRemainingYears, setSecondHomeRemainingYears] = useState(20);
  const [secondHomeSaleCostsPct, setSecondHomeSaleCostsPct] = useState(2);

  // Maximale hypotheek bij uw eigen geldverstrekker: los van de Nibud-inkomenstoets en de
  // LTV-cap kan een bank een eigen, absoluut plafond hanteren. Instelbaar i.p.v. vast, zodat
  // dit een bindende derde grens kan zijn naast Nibud en LTV.
  const [lenderCapThreshold, setLenderCapThreshold] = useState(String(LENDER_CAP_THRESHOLD_DEFAULT));
  // Gewenste maximale eigen inleg (ex kosten koper) bij het dichten van het financieringsgat:
  // een voorkeursplafond, los van hoeveel eigen vermogen daadwerkelijk beschikbaar is.
  const [limitOwnContribution, setLimitOwnContribution] = useState(false);
  const [desiredMaxOwnContribution, setDesiredMaxOwnContribution] = useState('100000');
  // Familielening: een onderhandse, tijdelijke lening (bv. van familie) om het resterende
  // gat te dichten dat na eigen middelen én bancaire leencapaciteit overblijft — bijvoorbeeld
  // omdat de tweede woning nog niet verkocht is en daar geen overbruggingskrediet op mogelijk is.
  const [useFamilyLoan, setUseFamilyLoan] = useState(false);
  const [familyLoanAmount, setFamilyLoanAmount] = useState('');
  const [familyLoanRate, setFamilyLoanRate] = useState(0);
  // Meeneemregeling: neemt u de bestaande hypotheek mee tegen de huidige voorwaarden
  // (rente, resterende looptijd), of lost u deze af bij verkoop en financiert u de nieuwe
  // woning volledig opnieuw? Default: ja, meenemen (de gangbare route bij een lagere
  // bestaande rente).
  const [takeOverMortgage, setTakeOverMortgage] = useState(true);
  const [oldMortgageStance, setOldMortgageStance] = useState('volledig');
  const [bridgePeriodMonths, setBridgePeriodMonths] = useState(6);
  const [includeOwnCapitalInDoubleTest, setIncludeOwnCapitalInDoubleTest] = useState(true);
  const [liquidityBuffer, setLiquidityBuffer] = useState('0');
  // Overbruggingskrediet: ontsluit de overwaarde van de huidige woning al vóór de
  // daadwerkelijke verkoop, tegen rente. Leeg bedrag valt terug op de volledige bruikbare
  // overwaarde als redelijke default (zie doubleCostsCalc).
  const [useBridgeLoan, setUseBridgeLoan] = useState(false);
  const [bridgeLoanAmount, setBridgeLoanAmount] = useState('');
  const [bridgeLoanRate, setBridgeLoanRate] = useState(6.0);
  const [marketValue, setMarketValue] = useState(935000);
  const [saleDiscountPercentage, setSaleDiscountPercentage] = useState(100);
  const [currentEnergyLabel, setCurrentEnergyLabel] = useState('A');
  const [originalDebt, setOriginalDebt] = useState('675000');
  const [startDate, setStartDate] = useState('2021-01-15');
  const [viewMode, setViewMode] = useState('bruto');
  const [loanParts, setLoanParts] = useState([
    { id: 1, type: 'Annuïteit', principal: '271846', rate: 1.25, originalFixedYears: 10 },
    { id: 2, type: 'Aflossingsvrij', principal: '354269', rate: 1.85, originalFixedYears: 20 },
  ]);

  const addLoanPart = () => {
    setLoanParts((prev) => {
      if (prev.length >= 3) return prev;
      return [
        ...prev,
        {
          id: Date.now(),
          type: 'Annuïteit',
          principal: '0',
          rate: 3.5,
          originalFixedYears: 10,
        },
      ];
    });
  };

  const removeLoanPart = (id) => {
    setLoanParts((prev) => (prev.length > 1 ? prev.filter((p) => p.id !== id) : prev));
  };

  const updateLoanPart = (id, field, value) => {
    setLoanParts((prev) => prev.map((p) => (p.id === id ? { ...p, [field]: value } : p)));
  };

  // Aanvullende leningdelen: de nieuwe financiering bovenop de meegenomen hypotheek. Deze
  // starten vandaag, dus hun "rentevastperiode" is meteen ook hun resterende periode.
  const [additionalLoanParts, setAdditionalLoanParts] = useState([
    { id: 1, type: 'Aflossingsvrij', principal: '0', rate: 4.0, originalFixedYears: 10 },
  ]);
  const [additionalViewMode, setAdditionalViewMode] = useState('bruto');

  // Maximaal toegestaan percentage aflossingsvrij (van de woningwaarde). Instelbaar op
  // 30/50/100%, default 50% — de gangbare bancaire norm. Gedeeld door de doorstromer- en
  // de starters-toets (die sluiten elkaar uit via hasExistingHome).
  const [aflossingsvrijMaxPct, setAflossingsvrijMaxPct] = useState(50);

  // Maandelijks aflosschema nieuwe situatie: welk venster van maanden en welke jaarlijkse
  // waardestijging-aanname worden getoond in de maandtabel bij "Aflosschema nieuwe situatie".
  const [scheduleWindowStartMonth, setScheduleWindowStartMonth] = useState(0);
  const [scheduleAppreciationPct, setScheduleAppreciationPct] = useState(0);

  const addAdditionalLoanPart = () => {
    setAdditionalLoanParts((prev) => {
      if (prev.length >= 2) return prev;
      return [
        ...prev,
        { id: Date.now(), type: 'Annuïteit', principal: '0', rate: 4.0, originalFixedYears: 10 },
      ];
    });
  };

  const removeAdditionalLoanPart = (id) => {
    setAdditionalLoanParts((prev) => (prev.length > 1 ? prev.filter((p) => p.id !== id) : prev));
  };

  const updateAdditionalLoanPart = (id, field, value) => {
    setAdditionalLoanParts((prev) => prev.map((p) => (p.id === id ? { ...p, [field]: value } : p)));
  };

  // Starters-leningdelen: voor wie nog geen woning heeft. Splitst de benodigde hypotheek in
  // maximaal 3 delen met eigen aflosvorm, rente en rentevastperiode. Starten vandaag.
  const [starterLoanParts, setStarterLoanParts] = useState([
    { id: 1, type: 'Annuïteit', principal: '0', rate: 4.0, originalFixedYears: 10 },
  ]);
  const [starterViewMode, setStarterViewMode] = useState('bruto');

  const addStarterLoanPart = () => {
    setStarterLoanParts((prev) => {
      if (prev.length >= 3) return prev;
      return [
        ...prev,
        { id: Date.now(), type: 'Annuïteit', principal: '0', rate: 4.0, originalFixedYears: 10 },
      ];
    });
  };

  const removeStarterLoanPart = (id) => {
    setStarterLoanParts((prev) => (prev.length > 1 ? prev.filter((p) => p.id !== id) : prev));
  };

  const updateStarterLoanPart = (id, field, value) => {
    setStarterLoanParts((prev) => prev.map((p) => (p.id === id ? { ...p, [field]: value } : p)));
  };

  // Bij nieuwbouw koopt u doorgaans rechtstreeks van de projectontwikkelaar, zonder
  // aankoopmakelaar — dus zet die kostenpost automatisch uit zodra nieuwbouw wordt
  // gekozen. Blijft een bewuste, aanpasbare keuze: de gebruiker kan 'm zelf weer aanzetten.
  useEffect(() => {
    if (propertyUsage === 'nieuwbouw') setIncludeBuyersAgent(false);
  }, [propertyUsage]);

  const calc = useMemo(() => {
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
    // voor overige schulden). Studieschuld wordt sinds 2024 berekend op basis van de
    // werkelijke DUO-terugbetaalregeling (rente en aflostermijn van het gekozen stelsel),
    // toegepast op de restschuld.
    const otherDebtMonthly =
      (safeNum(debt1) + (hasPartner2 ? safeNum(debt2) : 0)) * OTHER_DEBT_MONTHLY_WEIGHT;
    const studyDebtMonthly = getStudyDebtMonthlyBurden(
      safeNum(studyDebt1) + (hasPartner2 ? safeNum(studyDebt2) : 0),
      studyDebtRegime
    );

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

    const monthlyDebt = otherDebtMonthly + studyDebtMonthly + secondHomeMonthly;

    // A1-A3: echte Nibud-woonquote-systematiek 2026. De woonquote bij (toetsinkomen,
    // toetsrente) bepaalt de maximale bruto woonlast; de maandlast van bestaande schulden
    // gaat daar direct vanaf; het restant wordt gekapitaliseerd tegen de toetsrente.
    const nibud = getIncomeBasedMortgage(combinedIncome, testRate, monthlyDebt);
    const woonquote = nibud.woonquote;

    // Ter weergave: hoeveel maximale hypotheek er wegvalt door de schulden (de
    // gekapitaliseerde waarde van de schuldmaandlast tegen de toetsrente).
    const debtDeduction = monthlyDebt * nibud.annuityFactor;

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
    const pensionBinding = pensionActive && nibudPension.maxLoan < nibud.maxLoan;
    const boundMaxLoan = pensionActive
      ? Math.min(nibud.maxLoan, nibudPension.maxLoan)
      : nibud.maxLoan;

    // Scenariobedragen voor de vergelijkings-UI (beide inclusief energiebonus, zodat ze
    // één-op-één vergelijkbaar zijn met de getoonde maximale hypotheek).
    const currentScenarioMax = Math.max(0, nibud.maxLoan + energyBonus);
    const pensionScenarioMax = pensionActive
      ? Math.max(0, nibudPension.maxLoan + energyBonus)
      : null;

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
    const totalOwnCapital =
      safeNum(ownCapital1) +
      (hasPartner2 ? safeNum(ownCapital2) : 0) +
      secondHomeProceedsApplied -
      secondHomeShortfall;

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

    const isOverIndebted = monthlyDebt > nibud.maxWoonlastMonthly;
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
          nibudAtActualRate.maxLoan,
          getIncomeBasedMortgage(pensionCombinedIncome, safeNum(rate), monthlyDebt, { aow: true })
            .maxLoan
        )
      : nibudAtActualRate.maxLoan;
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
      studyDebtMonthly,
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
      purchasingPower,
      toetsrenteApplies,
      testRate,
    };
  }, [
    income1,
    income2,
    rate,
    fixedRatePeriod,
    energyLabel,
    debt1,
    debt2,
    studyDebt1,
    studyDebt2,
    studyDebtRegime,
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
  ]);

  // Bouwdepot (nieuwbouw): puur informatief, telt niet mee in de leencapaciteit. Leeg
  // bouwdepotAmount valt terug op de aanschafprijs als redelijke default.
  const bouwdepotCalc = useMemo(() => {
    if (propertyUsage !== 'nieuwbouw') return null;
    const effectiveAmount =
      safeNum(bouwdepotAmount) > 0 ? safeNum(bouwdepotAmount) : safeNum(purchasePrice);
    return getBouwdepotEstimate({
      bouwdepotAmount: effectiveAmount,
      constructionMonths,
      ratePct: safeNum(rate),
    });
  }, [propertyUsage, bouwdepotAmount, purchasePrice, constructionMonths, rate]);

  const elapsedMonthsSinceStart = useMemo(() => getElapsedMonths(startDate), [startDate]);

  const currentMortgage = useMemo(() => {
    const elapsedMonths = getElapsedMonths(startDate);

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
    const rateRiskCapacityHaircut = loanParts.reduce((sum, part, i) => {
      const remainingFractionalYears = partResults[i].fixedPeriod.fractionalYears;
      const testRate = getTestRate(part.rate, remainingFractionalYears);
      const actualRate = safeNum(part.rate);
      if (testRate === actualRate) return sum;
      const stressResult = calculateLoanPart({ ...part, rate: testRate }, elapsedMonths, startDate);
      const extraMonthly = Math.max(0, stressResult.grossMonthly - partResults[i].grossMonthly);
      return sum + extraMonthly * getCapitalizationFactor(testRate);
    }, 0);
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
  }, [
    loanParts,
    startDate,
    marketValue,
    saleDiscountPercentage,
    calc,
    takeOverMortgage,
    includeEwfInNetCalc,
  ]);

  const newHomeCalc = useMemo(() => {
    const price = safeNum(purchasePrice);
    // Eén gedeelde bron voor kosten koper: de uitsplitsing uit calc, zodat deze flow
    // nooit uit de pas kan lopen met de Kosten koper-kaart en de sidebar.
    const transferTax = calc.transferTax;
    const otherCosts = calc.kostenKoper.otherCostsTotal;
    const nonFinanceableCosts = transferTax + otherCosts;
    const availableFunds = calc.totalOwnCapital + currentMortgage.usableOverwaarde;
    const fundsAfterCosts = availableFunds - nonFinanceableCosts;
    const rawRequiredMortgage = price - fundsAfterCosts;
    // A Dutch mortgage can finance at most 100% of the woningwaarde; it can never cover
    // the transfer tax or other closing costs. Anything beyond that is a hard cash gap.
    const cashShortfall = Math.max(0, rawRequiredMortgage - price);
    const requiredMortgage = Math.min(price, Math.max(0, rawRequiredMortgage));
    const capacityMargin = calc.maxMortgage - requiredMortgage;
    const withinIncomeCapacity = capacityMargin >= 0;
    const withinCapacity = withinIncomeCapacity && cashShortfall === 0;

    return {
      transferTax,
      otherCosts,
      nonFinanceableCosts,
      availableFunds,
      fundsAfterCosts,
      requiredMortgage,
      cashShortfall,
      capacityMargin,
      withinIncomeCapacity,
      withinCapacity,
    };
  }, [purchasePrice, calc, currentMortgage]);

  const combinedGapCalc = useMemo(() => {
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
    const ownContributionCap = limitOwnContribution
      ? Math.max(0, safeNum(desiredMaxOwnContribution))
      : Infinity;
    const ownCapitalApplied = Math.min(
      calc.totalOwnCapital,
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
    const lenderCapRoom = Math.max(0, safeNum(lenderCapThreshold) - portedDebt);
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
    const exceedsLenderCap = totalMortgageAfterMove > safeNum(lenderCapThreshold);

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
  }, [
    purchasePrice,
    calc,
    currentMortgage,
    lenderCapThreshold,
    limitOwnContribution,
    desiredMaxOwnContribution,
    useFamilyLoan,
    familyLoanAmount,
    familyLoanRate,
  ]);

  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);

  // Scenario-analyse: wat betekent een hogere of lagere bieding t.o.v. de aanschafprijs
  // voor het aanvullend te lenen bedrag en de bruto/netto maandlast? Bij een bestaande
  // woning (hasExistingHome) wordt, net als bij de financieringsgat-berekening hierboven,
  // uitgegaan van de meeneemregeling: de huidige hypotheek gaat mee tegen de huidige
  // voorwaarden en de overwaarde (huidige marktwaarde min restschuld) wordt als cash
  // ingezet. Beide zijn per definitie gelijk voor elk biedingsscenario; alleen het
  // aanvullend te lenen bedrag varieert met de bieding.
  //
  // De maandlast van dat aanvullende bedrag volgt zoveel mogelijk de daadwerkelijk
  // ingestelde aanvullende leningdelen hieronder (type, rente, verhouding aflossingsvrij/
  // annuïteit), geschaald naar elk scenario — dus als u op "Automatisch verdelen" klikt of
  // handmatig een leningdeel aanpast, werkt dat door in deze tabel. Alleen als er nog geen
  // aanvullend bedrag is ingevuld (som van de leningdelen is 0) valt dit terug op een
  // generieke annuïteit tegen de ingestelde hypotheekrente.
  const scenarioAnalysis = useMemo(() => {
    const basePrice = safeNum(purchasePrice);
    const r = safeNum(rate) / 100 / 12;
    const capFactor = getCapitalizationFactor(safeNum(rate));
    const hraRate = getHraRate(calc.toets1.toetsinkomen, calc.toets2.toetsinkomen);

    const portedDebt = hasExistingHome ? currentMortgage.portedDebt : 0;
    const overwaarde = hasExistingHome ? currentMortgage.usableOverwaarde : 0;
    const portedGrossMonthly = hasExistingHome && takeOverMortgage ? currentMortgage.totalGross : 0;
    const portedTaxBenefit = hasExistingHome && takeOverMortgage ? currentMortgage.taxBenefit : 0;
    const extraBorrowCapacity = hasExistingHome
      ? currentMortgage.extraBorrowCapacity
      : calc.incomeBasedMax;

    // Huidige samenstelling van de aanvullende leningdelen (som + per deel het aandeel),
    // zodat die verhouding naar elk scenario geschaald kan worden.
    const configuredTotal = additionalLoanParts.reduce((sum, p) => sum + safeNum(p.principal), 0);

    const computeNewPartMonthly = (additionalMortgage) => {
      if (configuredTotal > 0) {
        // Schaal elk ingesteld leningdeel proportioneel naar het benodigde bedrag in dit
        // scenario, met behoud van elk deel zijn eigen type en rente.
        let grossMonthly = 0;
        let taxBenefit = 0;
        additionalLoanParts.forEach((part) => {
          const share = safeNum(part.principal) / configuredTotal;
          const scaledPrincipal = share * additionalMortgage;
          const result = calculateLoanPart(
            { ...part, principal: String(scaledPrincipal) },
            0,
            todayIso
          );
          grossMonthly += result.grossMonthly;
          if (result.eligibleForHRA) taxBenefit += result.interestMonthly * hraRate;
        });
        return { grossMonthly, taxBenefit };
      }
      // Nog geen leningdelen ingevuld: generieke annuïteit tegen de hypotheekrente.
      const grossMonthly = capFactor > 0 ? additionalMortgage / capFactor : 0;
      const taxBenefit = additionalMortgage * r * hraRate;
      return { grossMonthly, taxBenefit };
    };

    const scenarios = SCENARIO_PERCENTAGES.map((pct) => {
      const price = basePrice * (1 + pct / 100);
      // Een geldverstrekker financiert nooit meer dan de getaxeerde marktwaarde — bij
      // overbieden (positief pct) is die taxatiewaarde in de praktijk vrijwel altijd de
      // vraagprijs/aanschafprijs (basePrice), niet de hogere bieding. Het verschil moet dus
      // volledig uit eigen geld komen, bovenop wat er al aan eigen middelen wordt ingezet
      // voor het gewone financieringsgat.
      const financeablePrice = Math.min(price, basePrice);
      const overbidExtra = Math.max(0, price - basePrice);
      const gap = financeablePrice - portedDebt - overwaarde;
      const ownCapitalForGap = Math.min(calc.totalOwnCapital, Math.max(0, gap));
      const additionalMortgage = Math.max(0, gap - calc.totalOwnCapital);
      const remainingOwnCapital = calc.totalOwnCapital - ownCapitalForGap;
      const insufficientCashForOverbid = overbidExtra > remainingOwnCapital;

      const { grossMonthly: newGrossMonthly, taxBenefit: newTaxBenefit } =
        computeNewPartMonthly(additionalMortgage);
      // Netto maandlast van uitsluitend het nieuwe/aanvullende leningdeel, zonder
      // eigenwoningforfait: dat geldt één keer over de hele woning en zit al volledig in de
      // gecombineerde totaalregel hieronder, niet toe te rekenen aan één leningdeel.
      const newNetMonthly = newGrossMonthly - newTaxBenefit;

      const grossMonthly = portedGrossMonthly + newGrossMonthly;
      // Eigenwoningforfait geldt één keer, over de waarde van de (ene) woning die u na de
      // verhuizing bezit — dus gebaseerd op de beoogde aanschafprijs, niet (nogmaals) op de
      // marktwaarde van de huidige, dan al verkochte woning.
      const ewfMonthly = includeEwfInNetCalc ? (EWF_RATE * Math.min(price, EWF_CAP)) / 12 : 0;
      const netMonthly = grossMonthly - portedTaxBenefit - newTaxBenefit + ewfMonthly;

      const exceedsCapacity =
        additionalMortgage > extraBorrowCapacity || insufficientCashForOverbid;
      return {
        pct,
        price,
        overbidExtra,
        additionalMortgage,
        newGrossMonthly,
        newNetMonthly,
        grossMonthly,
        netMonthly,
        exceedsCapacity,
        insufficientCashForOverbid,
      };
    });

    return { portedDebt, overwaarde, scenarios };
  }, [
    purchasePrice,
    rate,
    calc,
    hasExistingHome,
    takeOverMortgage,
    currentMortgage,
    additionalLoanParts,
    todayIso,
    includeEwfInNetCalc,
  ]);

  const additionalLoanCalc = useMemo(() => {
    // Aanvullende leningdelen zijn gloednieuw en starten vandaag: elapsedMonths = 0, dus
    // hun ingevoerde "rentevastperiode" is meteen ook de volledige resterende periode.
    const partResults = additionalLoanParts.map((part) => calculateLoanPart(part, 0, todayIso));

    const totalPrincipal = additionalLoanParts.reduce((sum, p) => sum + safeNum(p.principal), 0);
    const totalGross = partResults.reduce((sum, p) => sum + p.grossMonthly, 0);
    const totalInterest = partResults.reduce((sum, p) => sum + p.interestMonthly, 0);
    const totalAflossing = partResults.reduce((sum, p) => sum + p.principalMonthly, 0);
    const deductibleInterest = partResults.reduce(
      (sum, p) => sum + (p.eligibleForHRA ? p.interestMonthly : 0),
      0
    );
    const hraRate = getHraRate(calc.toets1.toetsinkomen, calc.toets2.toetsinkomen);
    const taxBenefit = deductibleInterest * hraRate;
    const totalNet = totalGross - taxBenefit;
    const netInterestComponent = Math.max(0, totalInterest - taxBenefit);

    // Rekenrente per nieuw leningdeel: bij een rentevastperiode korter dan 10 jaar geldt de
    // AFM-toetsrente in plaats van de daadwerkelijke, vaak lagere rente. Dit werkt door in
    // de leencapaciteit hieronder, niet in de daadwerkelijke bruto/netto maandlasten hierboven.
    const rateRiskHaircut = additionalLoanParts.reduce((sum, part, i) => {
      const testRate = getTestRate(part.rate, part.originalFixedYears);
      const actualRate = safeNum(part.rate);
      if (testRate === actualRate) return sum;
      const stress = calculateLoanPart({ ...part, rate: testRate }, 0, todayIso);
      const extra = Math.max(0, stress.grossMonthly - partResults[i].grossMonthly);
      return sum + extra * getCapitalizationFactor(testRate);
    }, 0);
    const hasRateRisk = rateRiskHaircut > 0;

    // Leencapaciteit voor deze toets: inkomensgebaseerde capaciteit bij de daadwerkelijke
    // rente, gecorrigeerd voor het renterisico van zowel de meegenomen als de nieuwe
    // leningdelen. Bewust los van de algemene rentevastperiode-slider bij Beoogde woning,
    // aangezien elk nieuw leningdeel hier zijn eigen rentevastperiode heeft.
    const effectiveCapacity = Math.max(
      0,
      calc.incomeBasedMaxAtActualRate -
        (takeOverMortgage ? currentMortgage.rateRiskCapacityHaircut : 0) -
        rateRiskHaircut
    );
    const totalDebtAfterMove = currentMortgage.portedDebt + totalPrincipal;
    const capacityMargin = effectiveCapacity - totalDebtAfterMove;
    const withinIncomeCapacity = capacityMargin >= 0;
    const exceedsLenderCap = totalDebtAfterMove > safeNum(lenderCapThreshold);

    // B10-stijl: de totale hypotheek (meegenomen plus nieuw) kan nooit boven de aanschafprijs
    // van de beoogde woning uitkomen (maximale LTV van 100%).
    const priceNum = safeNum(purchasePrice);
    const newLtv = priceNum > 0 ? (totalDebtAfterMove / priceNum) * 100 : 0;
    const withinLtvCap = priceNum === 0 || totalDebtAfterMove <= priceNum;

    // Bancaire norm: maximaal het ingestelde percentage van de woningwaarde mag
    // aflossingsvrij gefinancierd worden, over de meegenomen én de nieuwe leningdelen samen.
    // Alleen relevant als de bestaande hypotheek daadwerkelijk wordt meegenomen.
    const portedAflossingsvrij = takeOverMortgage
      ? loanParts
          .filter((p) => p.type === 'Aflossingsvrij')
          .reduce((sum, p) => sum + safeNum(p.principal), 0)
      : 0;
    const newAflossingsvrij = additionalLoanParts
      .filter((p) => p.type === 'Aflossingsvrij')
      .reduce((sum, p) => sum + safeNum(p.principal), 0);
    const totalAflossingsvrij = portedAflossingsvrij + newAflossingsvrij;
    const maxAflossingsvrij = priceNum * (aflossingsvrijMaxPct / 100);
    const aflossingsvrijRoomRemaining = Math.max(0, maxAflossingsvrij - portedAflossingsvrij);
    const withinAflossingsvrijCap = totalAflossingsvrij <= maxAflossingsvrij;

    const withinCapacity = withinIncomeCapacity && withinLtvCap && withinAflossingsvrijCap;
    const matchesRequiredAmount =
      Math.abs(totalPrincipal - combinedGapCalc.additionalMortgage) < 1;

    // Bijleenregeling (eigenwoningreserve): als u meer leent dan het financieringsgat
    // vereist terwijl er overwaarde is, herinvesteert u die overwaarde niet volledig in de
    // nieuwe woning. De rente over het te veel geleende deel is dan niet aftrekbaar via de
    // hypotheekrenteaftrek.
    const excessOverGap = Math.max(0, totalPrincipal - combinedGapCalc.additionalMortgage);
    const bijleenregelingRisk = excessOverGap > 1 && currentMortgage.overwaarde > 0;

    return {
      totalPrincipal,
      totalGross,
      totalInterest,
      totalAflossing,
      hraRate,
      taxBenefit,
      totalNet,
      netInterestComponent,
      rateRiskHaircut,
      hasRateRisk,
      effectiveCapacity,
      totalDebtAfterMove,
      capacityMargin,
      withinIncomeCapacity,
      newLtv,
      withinLtvCap,
      exceedsLenderCap,
      portedAflossingsvrij,
      newAflossingsvrij,
      totalAflossingsvrij,
      maxAflossingsvrij,
      aflossingsvrijRoomRemaining,
      withinAflossingsvrijCap,
      withinCapacity,
      matchesRequiredAmount,
      excessOverGap,
      bijleenregelingRisk,
    };
  }, [
    additionalLoanParts,
    todayIso,
    calc,
    currentMortgage,
    purchasePrice,
    loanParts,
    combinedGapCalc,
    aflossingsvrijMaxPct,
    takeOverMortgage,
    lenderCapThreshold,
  ]);

  const autoDistributeAdditionalLoan = () => {
    const needed = Math.max(0, combinedGapCalc.additionalMortgage);
    const aflossingsvrijPortion = Math.min(additionalLoanCalc.aflossingsvrijRoomRemaining, needed);
    const restPortion = needed - aflossingsvrijPortion;
    const parts = [];
    if (aflossingsvrijPortion > 0) {
      parts.push({
        id: 1,
        type: 'Aflossingsvrij',
        principal: String(Math.round(aflossingsvrijPortion)),
        rate: 4.0,
        originalFixedYears: 10,
      });
    }
    if (restPortion > 0 || parts.length === 0) {
      parts.push({
        id: 2,
        type: 'Annuïteit',
        principal: String(Math.round(restPortion)),
        rate: 4.0,
        originalFixedYears: 10,
      });
    }
    setAdditionalLoanParts(parts);
  };

  // Starters-toets: benodigde hypotheek = aanschafprijs min ingebracht eigen vermogen,
  // begrensd op de maximale hypotheek o.b.v. inkomen. Kosten koper worden apart uit eigen
  // middelen betaald en tellen hier niet mee in het hypotheekbedrag.
  const starterRequiredMortgage = Math.max(
    0,
    Math.min(calc.maxMortgage, safeNum(purchasePrice) - calc.totalOwnCapital)
  );

  const starterLoanCalc = useMemo(() => {
    const partResults = starterLoanParts.map((part) => calculateLoanPart(part, 0, todayIso));

    const totalPrincipal = starterLoanParts.reduce((sum, p) => sum + safeNum(p.principal), 0);
    const totalGross = partResults.reduce((sum, p) => sum + p.grossMonthly, 0);
    const totalInterest = partResults.reduce((sum, p) => sum + p.interestMonthly, 0);
    const totalAflossing = partResults.reduce((sum, p) => sum + p.principalMonthly, 0);
    const deductibleInterest = partResults.reduce(
      (sum, p) => sum + (p.eligibleForHRA ? p.interestMonthly : 0),
      0
    );
    const hraRate = getHraRate(calc.toets1.toetsinkomen, calc.toets2.toetsinkomen);
    const taxBenefit = deductibleInterest * hraRate;
    const totalNet = totalGross - taxBenefit;
    const netInterestComponent = Math.max(0, totalInterest - taxBenefit);

    const priceNum = safeNum(purchasePrice);
    const totalAflossingsvrij = starterLoanParts
      .filter((p) => p.type === 'Aflossingsvrij')
      .reduce((sum, p) => sum + safeNum(p.principal), 0);
    const maxAflossingsvrij = priceNum * (aflossingsvrijMaxPct / 100);
    const withinAflossingsvrijCap = totalAflossingsvrij <= maxAflossingsvrij;

    const newLtv = priceNum > 0 ? (totalPrincipal / priceNum) * 100 : 0;
    const withinLtvCap = priceNum === 0 || totalPrincipal <= priceNum;
    const matchesRequired = Math.abs(totalPrincipal - starterRequiredMortgage) < 1;
    // Sommige geldverstrekkers hanteren een interne acceptatiegrens van €1 miljoen voor
    // de totale hypotheeksom, ongeacht starter of doorstromer (zie ook combinedGapCalc/
    // additionalLoanCalc hierboven, waar dezelfde grens al gold voor doorstromers).
    const exceedsLenderCap = totalPrincipal > safeNum(lenderCapThreshold);

    return {
      totalPrincipal,
      totalGross,
      totalInterest,
      totalAflossing,
      hraRate,
      taxBenefit,
      totalNet,
      netInterestComponent,
      totalAflossingsvrij,
      maxAflossingsvrij,
      withinAflossingsvrijCap,
      newLtv,
      withinLtvCap,
      matchesRequired,
      exceedsLenderCap,
    };
  }, [
    starterLoanParts,
    todayIso,
    purchasePrice,
    aflossingsvrijMaxPct,
    starterRequiredMortgage,
    calc,
    lenderCapThreshold,
  ]);

  const autoDistributeStarterLoan = () => {
    const needed = starterRequiredMortgage;
    const maxAflossingsvrij = safeNum(purchasePrice) * (aflossingsvrijMaxPct / 100);
    const aflossingsvrijPortion = Math.min(maxAflossingsvrij, needed);
    const restPortion = needed - aflossingsvrijPortion;
    const parts = [];
    if (aflossingsvrijPortion > 0) {
      parts.push({
        id: 1,
        type: 'Aflossingsvrij',
        principal: String(Math.round(aflossingsvrijPortion)),
        rate: 4.0,
        originalFixedYears: 10,
      });
    }
    if (restPortion > 0 || parts.length === 0) {
      parts.push({
        id: 2,
        type: 'Annuïteit',
        principal: String(Math.round(restPortion)),
        rate: 4.0,
        originalFixedYears: 10,
      });
    }
    setStarterLoanParts(parts);
  };

  // Maximaal aankoopbudget: eigen vermogen, overwaarde, de meegenomen hypotheek en de
  // maximale extra bijleenruimte (inkomensgebaseerd, al gecorrigeerd voor renterisico) samen
  // vormen het hoogste bedrag dat voor de beoogde woning neergelegd kan worden.
  const maxBudgetCalc = useMemo(() => {
    const eigenVermogen = calc.totalOwnCapital;
    const overwaarde = currentMortgage.usableOverwaarde;
    const oudeHypotheek = currentMortgage.portedDebt;
    const nieuweHypotheekMax = currentMortgage.extraBorrowCapacity;
    // Bij onderwaarde moet het restschuld-tekort van het budget af: dat bedrag gaat op aan
    // het aflossen van de restschuld die na verkoop overblijft.
    const maxBudget =
      eigenVermogen +
      overwaarde +
      oudeHypotheek +
      nieuweHypotheekMax -
      currentMortgage.restschuldTekort;
    const price = safeNum(purchasePrice);
    const remainingRoom = maxBudget - price;

    return {
      eigenVermogen,
      overwaarde,
      oudeHypotheek,
      nieuweHypotheekMax,
      maxBudget,
      price,
      remainingRoom,
    };
  }, [calc, currentMortgage, purchasePrice]);

  // Aflossingsgrafiek: geprojecteerde restschuld van de meegenomen én de nieuwe leningdelen
  // samen, jaar voor jaar over de komende dertig jaar, uitgaande van de huidige rentes,
  // aflosvormen en resterende looptijden. Geen rekening gehouden met toekomstige
  // renteherzieningen of vervroegde aflossingen.
  const amortizationSchedule = useMemo(() => {
    const points = [];
    const portedRemainingMonthsNow = Math.max(
      0,
      TERM_MONTHS - Math.max(elapsedMonthsSinceStart, 0)
    );
    for (let year = 0; year <= 30; year++) {
      const monthsFromNow = year * 12;
      let portedBalance = 0;
      if (takeOverMortgage) {
        loanParts.forEach((part) => {
          portedBalance += projectRemainingBalance(
            part.principal,
            part.rate,
            part.type,
            portedRemainingMonthsNow,
            monthsFromNow
          );
        });
      }
      let newBalance = 0;
      additionalLoanParts.forEach((part) => {
        newBalance += projectRemainingBalance(
          part.principal,
          part.rate,
          part.type,
          TERM_MONTHS,
          monthsFromNow
        );
      });
      points.push({ year, portedBalance, newBalance, total: portedBalance + newBalance });
    }
    return points;
  }, [loanParts, additionalLoanParts, elapsedMonthsSinceStart, takeOverMortgage]);

  // Maandelijks aflosschema nieuwe situatie: zelfde combinatie van meegenomen + nieuwe
  // leningdelen als amortizationSchedule hierboven, maar per maand (0..360) i.p.v. per jaar,
  // inclusief rente/aflossing-opsplitsing per leningdeel en een geprojecteerde
  // onderpandswaarde/LTV bij een instelbare jaarlijkse waardestijging vanaf de aanschafprijs
  // van de beoogde woning (zelfde grondslag als newLtv hierboven, niet marketValue).
  const monthlySchedule = useMemo(() => {
    const portedRemainingMonthsNow = Math.max(
      0,
      TERM_MONTHS - Math.max(elapsedMonthsSinceStart, 0)
    );
    const priceNum = safeNum(purchasePrice);
    const monthlyAppreciationRate = Math.pow(1 + scheduleAppreciationPct / 100, 1 / 12) - 1;

    const activeParts = [
      ...(takeOverMortgage
        ? loanParts.map((p) => ({ ...p, remainingMonthsNow: portedRemainingMonthsNow }))
        : []),
      ...additionalLoanParts.map((p) => ({ ...p, remainingMonthsNow: TERM_MONTHS })),
    ];

    const balanceOf = (p) =>
      projectRemainingBalance(p.principal, p.rate, p.type, p.remainingMonthsNow, 0);
    let prevBalances = activeParts.map(balanceOf);

    const points = [];
    const pushPoint = (month, interestMonthly, principalMonthly, balance) => {
      const collateralValue = priceNum * Math.pow(1 + monthlyAppreciationRate, month);
      const ltv = collateralValue > 0 ? (balance / collateralValue) * 100 : 0;
      points.push({
        month,
        interestMonthly,
        principalMonthly,
        totalMonthly: interestMonthly + principalMonthly,
        balance,
        collateralValue,
        ltv,
      });
    };
    pushPoint(
      0,
      0,
      0,
      prevBalances.reduce((sum, b) => sum + b, 0)
    );

    for (let month = 1; month <= TERM_MONTHS; month++) {
      let interestMonthly = 0;
      let principalMonthly = 0;
      const nextBalances = activeParts.map((p, i) => {
        const curr = projectRemainingBalance(p.principal, p.rate, p.type, p.remainingMonthsNow, month);
        interestMonthly += prevBalances[i] * (safeNum(p.rate) / 100 / 12);
        principalMonthly += prevBalances[i] - curr;
        return curr;
      });
      prevBalances = nextBalances;
      pushPoint(
        month,
        interestMonthly,
        principalMonthly,
        nextBalances.reduce((sum, b) => sum + b, 0)
      );
    }
    return points;
  }, [
    loanParts,
    additionalLoanParts,
    elapsedMonthsSinceStart,
    takeOverMortgage,
    purchasePrice,
    scheduleAppreciationPct,
  ]);

  // Nibud dubbele-lastentoets (optioneel): kan het huishouden tijdelijk zowel de huidige als
  // de nieuwe hypotheek dragen, voor het geval de huidige woning nog niet is verkocht op het
  // moment van aankoop? Conservatief: geen overwaarde beschikbaar (nog niet gerealiseerd),
  // alleen ingebracht eigen vermogen telt mee ter verlaging van de nieuwe hypotheek.
  const doubleCostsCalc = useMemo(() => {
    // Oude hypotheek tijdens de overbruggingsperiode: sommige adviseurs/verstrekkers toetsen
    // de volledige bruto last, anderen alleen het rentedeel, ervan uitgaande dat aflossing op
    // de oude hypotheek tijdelijk minder zwaar weegt. Dit is schakelbaar, aangezien de praktijk
    // per geldverstrekker verschilt.
    const oldMortgageFull = currentMortgage.totalGross;
    const oldMortgageInterestOnly = currentMortgage.totalInterest;
    const oldMortgageBruto = oldMortgageStance === 'rente' ? oldMortgageInterestOnly : oldMortgageFull;

    const price = safeNum(purchasePrice);
    // Kosten koper kunnen niet worden meegefinancierd en verhogen dus, samen met de
    // aanschafprijs, het bedrag dat tijdelijk via de nieuwe hypotheek gedekt moet worden
    // zolang de overwaarde van de oude woning nog niet is gerealiseerd. Spaargeld en
    // beleggingen zijn, anders dan overwaarde, wél direct beschikbaar en mogen daarom ook
    // tijdens de overbruggingsperiode worden ingezet om de nieuwe hypotheek te verlagen. Dit
    // is expliciet schakelbaar voor een behoudender toets.
    const kostenKoper = includeKostenKoperInCalc ? calc.kostenKoper.total : 0;
    const ownCapitalUsed = includeOwnCapitalInDoubleTest ? calc.totalOwnCapital : 0;

    // Overbruggingskrediet: ontsluit de overwaarde van de huidige woning al vóór de
    // daadwerkelijke verkoop, tegen rente (aflossing ineens bij verkoop). Verlaagt de
    // tijdelijk benodigde nieuwe hypotheek, maar de rente erover komt bovenop de
    // gecombineerde maandlast — het is geen gratis liquiditeit. Nooit hoger dan de
    // bruikbare overwaarde, want daarop is het krediet gezekerd.
    const bridgeLoanAmountRaw =
      safeNum(bridgeLoanAmount) > 0 ? safeNum(bridgeLoanAmount) : currentMortgage.usableOverwaarde;
    const bridgeLoanPrincipal = useBridgeLoan
      ? Math.min(Math.max(0, bridgeLoanAmountRaw), currentMortgage.usableOverwaarde)
      : 0;
    const bridgeLoanMonthlyInterest = bridgeLoanPrincipal * (safeNum(bridgeLoanRate) / 100 / 12);

    const newMortgageAmount = Math.max(0, price + kostenKoper - ownCapitalUsed - bridgeLoanPrincipal);

    // Consistent met de rest van de tool: bij een rentevastperiode korter dan 10 jaar geldt
    // de AFM-toetsrente, niet de daadwerkelijke rente.
    const testRate = calc.testRate;
    const newMortgagePart = {
      type: 'Annuïteit',
      principal: String(newMortgageAmount),
      rate: testRate,
    };
    const newMortgageResult = calculateLoanPart(newMortgagePart, 0, todayIso);
    const newMortgageBruto = newMortgageResult.grossMonthly;
    const combinedBruto = oldMortgageBruto + newMortgageBruto + bridgeLoanMonthlyInterest;
    const bridgeLoanTotalInterest = bridgeLoanMonthlyInterest * Math.max(0, safeNum(bridgePeriodMonths));

    // Impliciete maximale bruto maandlast: de inkomensgebaseerde leencapaciteit (die zelf al
    // met de toetsrente rekening houdt) teruggerekend naar een maandbedrag met dezelfde
    // annuïteitenfactor. Dit is een benadering: de onderliggende leenfactor is zelf ook al
    // een vereenvoudiging van de officiële Nibud-tabel, dus deze terugrekening stapelt twee
    // benaderingen op elkaar en is indicatief.
    const capFactor = getCapitalizationFactor(testRate);
    const allowedMonthly = capFactor > 0 ? calc.incomeBasedMax / capFactor : 0;
    const margin = allowedMonthly - combinedBruto;
    const withinBudget = margin >= 0;

    const months = Math.max(0, safeNum(bridgePeriodMonths));
    const cumulativeShortfall = margin < 0 ? -margin * months : 0;
    const cumulativeMargin = margin > 0 ? margin * months : 0;

    // Aanvullende liquiditeitsbuffer: spaargeld dat niet als eigen inbreng voor de aankoop
    // wordt ingezet, maar wel achter de hand blijft om een tijdelijk maandelijks tekort mee
    // op te vangen. Dit verandert de leencapaciteit niet, maar toont wel of een eventueel
    // tekort in de praktijk overbrugd kan worden.
    const buffer = safeNum(liquidityBuffer);
    const bufferCoversShortfall = !withinBudget && buffer >= cumulativeShortfall;
    const bufferShortfall = Math.max(0, cumulativeShortfall - buffer);
    const bufferRemaining = Math.max(0, buffer - cumulativeShortfall);

    return {
      oldMortgageFull,
      oldMortgageInterestOnly,
      oldMortgageBruto,
      kostenKoper,
      ownCapitalUsed,
      bridgeLoanPrincipal,
      bridgeLoanMonthlyInterest,
      bridgeLoanTotalInterest,
      newMortgageAmount,
      newMortgageBruto,
      combinedBruto,
      allowedMonthly,
      margin,
      withinBudget,
      months,
      cumulativeShortfall,
      cumulativeMargin,
      buffer,
      bufferCoversShortfall,
      bufferShortfall,
      bufferRemaining,
    };
  }, [
    currentMortgage,
    purchasePrice,
    calc,
    todayIso,
    oldMortgageStance,
    bridgePeriodMonths,
    includeOwnCapitalInDoubleTest,
    includeKostenKoperInCalc,
    liquidityBuffer,
    useBridgeLoan,
    bridgeLoanAmount,
    bridgeLoanRate,
  ]);

  // Eén samenvattend eindoordeel voor de voortgangsbalk: haalbaar zonder bestaande woning
  // betekent dat de inkomensgebaseerde leencapaciteit de aanschafprijs dekt, met een
  // bestaande woning betekent het dat het financieringsgat (indien van toepassing) binnen de
  // bijleenruimte past.
  const overallAffordable = hasExistingHome
    ? combinedGapCalc.withinCapacityAfterFamilyLoan
    : calc.incomeBasedMax >= safeNum(purchasePrice);

  // "Wat bepaalt nu mijn maximum?" — maakt de causaliteit achter het getal zichtbaar
  // i.p.v. dat een schuif alleen een nieuw bedrag oplevert zonder uitleg waarom. Eén
  // factor tegelijk, in volgorde van "meest bepalend": een harde blokkade (schulden,
  // AOW-toets, restschuld, bijleenruimte) weegt zwaarder dan de normale, verwachte
  // grondslag (woonquote/inkomen of de aanschafprijs als plafond).
  const bindingFactor = useMemo(() => {
    if (calc.combinedIncome <= 0) return null;
    if (calc.isOverIndebted) {
      return {
        label: 'Uw schulden',
        explanation:
          'De maandlasten van uw bestaande schulden zijn hoger dan de maximale woonlast die uw inkomen toestaat — dat drukt uw hypotheek nu naar beneden.',
      };
    }
    if (calc.pensionBinding) {
      return {
        label: 'De AOW-toets',
        explanation:
          'Binnen 10 jaar van de AOW-leeftijd telt het (lagere) verwachte pensioeninkomen zwaarder dan uw huidige inkomen.',
      };
    }
    if (hasExistingHome) {
      if (combinedGapCalc.exceedsLenderCap) {
        return {
          label: 'Uw maximum bij de geldverstrekker',
          explanation: `Uw totale hypotheek (meegenomen plus aanvullend) komt boven de ${formatEuro(
            safeNum(lenderCapThreshold)
          )} die u heeft ingesteld als maximum bij uw geldverstrekker.`,
        };
      }
      if (currentMortgage.restschuldTekort > 0) {
        return {
          label: 'De restschuld bij onderwaarde',
          explanation:
            'De verkoopwaarde van uw huidige woning dekt de restschuld niet volledig; dat tekort vergroot het financieringsgat.',
        };
      }
      if (!combinedGapCalc.withinCapacityAfterFamilyLoan) {
        return {
          label: combinedGapCalc.bindingCapIsLender
            ? 'Uw geldverstrekkersmaximum'
            : 'Uw bijleenruimte',
          explanation: combinedGapCalc.bindingCapIsLender
            ? `De aanvullende hypotheek die nodig is past niet binnen het ingestelde maximum van ${formatEuro(
                safeNum(lenderCapThreshold)
              )} bij uw geldverstrekker.`
            : 'De aanvullende hypotheek die nodig is voor deze aanschafprijs past niet binnen wat u op basis van inkomen (nog) kunt bijlenen — ook niet met een eventuele familielening.',
        };
      }
      if (currentMortgage.hasRateRiskOnPortedDebt) {
        return {
          label: 'Het renterisico op uw meegenomen hypotheek',
          explanation:
            'Een deel van uw huidige hypotheek heeft een rentevastperiode korter dan 10 jaar en wordt daarom getoetst tegen de hogere AFM-toetsrente.',
        };
      }
      return {
        label: 'Uw woonquote (inkomen)',
        explanation:
          'Er speelt op dit moment geen bijzondere beperking — uw inkomen via de Nibud-woonquote is de normale grondslag voor uw bijleenruimte.',
      };
    }
    if (calc.cappedByPropertyValue) {
      return {
        label: 'De aanschafprijs',
        explanation:
          'Uw inkomen staat een hogere hypotheek toe, maar een hypotheek kan nooit boven de aanschafprijs uitkomen (max. 100% LTV).',
      };
    }
    return {
      label: 'Uw woonquote (inkomen)',
      explanation:
        'Er speelt op dit moment geen bijzondere beperking — uw inkomen via de Nibud-woonquote bepaalt uw maximale hypotheek.',
    };
  }, [calc, currentMortgage, combinedGapCalc, hasExistingHome, lenderCapThreshold]);

  // Dit is bewust GEEN wizard met gating: elke sectie is altijd tegelijk zichtbaar en in
  // elke volgorde te bewerken. De chips hieronder zijn dus anker-navigatie ("spring naar"),
  // geen stappenteller — vandaar geen verbindingslijnen en geen cumulatieve voortgangsbalk.
  // Schulden heeft geen eigen verplicht veld (0 is een geldig antwoord), dus die chip wordt
  // als "ingevuld" beschouwd zodra Inkomen is ingevuld.
  const incomeStepDone = calc.combinedIncome > 0;
  const debtsStepDone = incomeStepDone;

  const scrollToSection = (id) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Volledige sectievolgorde voor de rail/scrollspy — matcht de fysieke paginavolgorde,
  // incl. de secties die de chipbalk (bewust compacter) niet toont zoals "Uw situatie" en
  // "Kosten koper". Afhankelijk van hasExistingHome is het óf de starters- óf de
  // doorstromers-hypotheekkaart de voorlaatste stop vóór het resultaat.
  const railSections = useMemo(
    () => [
      { id: 'sectie-situatie', label: 'Uw situatie' },
      { id: 'sectie-beoogde-woning', label: 'Beoogde woning' },
      { id: 'sectie-inkomen', label: 'Inkomen' },
      { id: 'sectie-schulden', label: 'Schulden' },
      { id: 'sectie-tweede-woning', label: 'Tweede woning' },
      { id: 'sectie-kosten-koper', label: 'Kosten koper' },
      ...(propertyUsage === 'nieuwbouw'
        ? [{ id: 'sectie-bouwdepot', label: 'Bouwdepot' }]
        : []),
      hasExistingHome
        ? { id: 'sectie-huidige-woning', label: 'Huidige woning' }
        : { id: 'sectie-starter-hypotheek', label: 'Uw hypotheek' },
      { id: 'sectie-resultaat', label: 'Resultaat' },
    ],
    [hasExistingHome, propertyUsage]
  );
  const railIds = useMemo(() => railSections.map((s) => s.id), [railSections]);
  const { active: activeSectionId, progress: sectionProgress } = useScrollSpy(railIds);

  // Houdt de actieve chip zichtbaar in de horizontaal scrollbare mobiele balk: zonder dit
  // kan de gemarkeerde chip (bv. "Schulden") buiten beeld vallen zodra je door een lange
  // sectie scrolt, wat het hele idee van "waar ben ik" weer tenietdoet op mobiel.
  const chipScrollRef = useRef(null);
  useEffect(() => {
    const container = chipScrollRef.current;
    if (!container) return;
    const chip = container.querySelector(`[data-rail-id="${activeSectionId}"]`);
    if (chip) chip.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [activeSectionId]);

  // Op mobiel staat het volledige resultaatpaneel pas ná Inkomen en Schulden — daarom
  // een compacte samenvatting die vastgepind blijft zolang dat paneel niet in beeld is,
  // zodat er altijd meteen feedback zichtbaar is op de ingevoerde gegevens.
  const [resultInView, setResultInView] = useState(true);
  useEffect(() => {
    const el = document.getElementById('sectie-resultaat');
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      ([entry]) => setResultInView(entry.isIntersecting),
      { threshold: 0.15 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const mobileSummaryValue = hasExistingHome ? maxBudgetCalc.maxBudget : calc.maxMortgage;

  // Klein "vier het moment"-effect: zodra de situatie omslaat van niet-haalbaar naar
  // haalbaar (niet bij elke wijziging, alleen bij die ene overgang) een korte, speelse
  // wiebel/schaal-animatie op de statuspil in de sidebar, in plaats van dat de kleur
  // stilletjes van rood/amber naar groen verspringt.
  const isAffordableNow = hasExistingHome
    ? combinedGapCalc.withinCapacity
    : !calc.isOverIndebted && !calc.cappedByPropertyValue;
  const [celebrate, setCelebrate] = useState(false);
  const wasAffordable = useRef(isAffordableNow);
  useEffect(() => {
    if (isAffordableNow && !wasAffordable.current) {
      setCelebrate(true);
      const t = setTimeout(() => setCelebrate(false), 800);
      wasAffordable.current = isAffordableNow;
      return () => clearTimeout(t);
    }
    wasAffordable.current = isAffordableNow;
    return undefined;
  }, [isAffordableNow]);

  // PDF-export: een bewust beperkte, samengevatte set gegevens (niet de volledige interne
  // calc-objecten) wordt doorgegeven aan pdfExport.js, zodat dat bestand losstaat van de
  // interne structuur van dit component.
  // Dynamische import: jsPDF/autotable wegen samen ~150kB en zijn alleen nodig zodra iemand
  // daadwerkelijk exporteert, dus niet in het hoofdbundle laden bij elke paginabezoek.
  const handleExportPdf = async () => {
    const { exportHypotheekAdviesPdf } = await import('./pdfExport');
    const propertyUsageLabels = {
      zelfbewoning: 'Bestaande bouw',
      nieuwbouw: 'Nieuwbouw',
      nietHoofdverblijf: 'Niet-hoofdverblijf',
    };
    exportHypotheekAdviesPdf({
      generatedAt: new Date(),
      hasExistingHome,
      hasPartner2,
      purchasePrice: safeNum(purchasePrice),
      rate: safeNum(rate),
      fixedRatePeriod,
      energyLabel,
      propertyUsageLabel: propertyUsageLabels[propertyUsage] || propertyUsage,
      toets1: calc.toets1,
      toets2: calc.toets2,
      combinedIncome: calc.combinedIncome,
      woonquote: calc.woonquote,
      maxWoonlastMonthly: calc.maxWoonlastMonthly,
      monthlyDebt: calc.monthlyDebt,
      bindingFactor,
      resultLabel: hasExistingHome ? 'Maximaal aankoopbudget' : 'Maximale hypotheek',
      resultValue: hasExistingHome ? maxBudgetCalc.maxBudget : calc.maxMortgage,
      kostenKoperTotal: calc.kostenKoper.total,
      transferTaxLabel: calc.transferTaxInfo.shortLabel,
      kostenKoperItems: calc.kostenKoper.items.filter((item) => item.included),
      current: hasExistingHome
        ? {
            marketValue: safeNum(marketValue),
            currentDebtBalance: currentMortgage.currentDebtBalance,
            overwaarde: currentMortgage.overwaarde,
            ltv: currentMortgage.ltv,
          }
        : null,
      gap: hasExistingHome
        ? {
            portedDebt: combinedGapCalc.portedDebt,
            ownCapitalApplied: combinedGapCalc.ownCapitalApplied,
            additionalMortgage: combinedGapCalc.additionalMortgage,
          }
        : null,
      maxBudget: hasExistingHome
        ? { maxBudget: maxBudgetCalc.maxBudget, remainingRoom: maxBudgetCalc.remainingRoom }
        : null,
      starter: !hasExistingHome
        ? {
            parts: starterLoanParts,
            totalGross: starterLoanCalc.totalGross,
            totalNet: starterLoanCalc.totalNet,
          }
        : null,
    });
  };

  return (
    <div className="w-full px-4 py-10 pb-24 sm:px-6 lg:px-10 lg:pb-10">
      <SectionRail
        sections={railSections}
        activeId={activeSectionId}
        progress={sectionProgress}
        onNavigate={scrollToSection}
      />
      <div className="mx-auto max-w-6xl">
        <div className="sticky top-0 z-40 -mx-4 mb-6 border-b border-slate-200 bg-white/90 px-4 py-2.5 backdrop-blur-sm sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10">
          <p className="mb-1.5 hidden text-[11px] text-slate-400 sm:block">
            Spring naar een onderdeel — alles is direct aan te passen, in elke volgorde.
          </p>
          <div
            ref={chipScrollRef}
            className="mx-auto flex max-w-6xl items-center gap-1 overflow-x-auto whitespace-nowrap [-ms-overflow-style:none] [scrollbar-width:none] sm:flex-wrap sm:whitespace-normal [&::-webkit-scrollbar]:hidden"
          >
            <button
              type="button"
              data-rail-id="sectie-beoogde-woning"
              onClick={() => scrollToSection('sectie-beoogde-woning')}
              className={`flex flex-shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-all duration-200 hover:bg-slate-100 hover:text-blue-600 ${
                activeSectionId === 'sectie-beoogde-woning'
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-slate-600'
              }`}
            >
              <CheckCircle2
                className={`h-3.5 w-3.5 ${
                  safeNum(purchasePrice) > 0 ? 'text-emerald-500' : 'text-slate-300'
                }`}
              />
              Beoogde woning
            </button>
            <button
              type="button"
              data-rail-id="sectie-inkomen"
              onClick={() => scrollToSection('sectie-inkomen')}
              className={`flex flex-shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-all duration-200 hover:bg-slate-100 hover:text-blue-600 ${
                activeSectionId === 'sectie-inkomen' ? 'bg-blue-50 text-blue-700' : 'text-slate-600'
              }`}
            >
              <CheckCircle2
                className={`h-3.5 w-3.5 ${
                  calc.combinedIncome > 0 ? 'text-emerald-500' : 'text-slate-300'
                }`}
              />
              Inkomen
            </button>
            <button
              type="button"
              data-rail-id="sectie-schulden"
              onClick={() => scrollToSection('sectie-schulden')}
              className={`flex flex-shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-all duration-200 hover:bg-slate-100 hover:text-blue-600 ${
                activeSectionId === 'sectie-schulden' ? 'bg-blue-50 text-blue-700' : 'text-slate-600'
              }`}
            >
              <CheckCircle2
                className={`h-3.5 w-3.5 ${debtsStepDone ? 'text-emerald-500' : 'text-slate-300'}`}
              />
              Schulden
            </button>
            {hasExistingHome && (
              <button
                type="button"
                data-rail-id="sectie-huidige-woning"
                onClick={() => scrollToSection('sectie-huidige-woning')}
                className={`flex flex-shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-all duration-200 hover:bg-slate-100 hover:text-blue-600 ${
                  activeSectionId === 'sectie-huidige-woning'
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-slate-600'
                }`}
              >
                <CheckCircle2
                  className={`h-3.5 w-3.5 ${
                    safeNum(marketValue) > 0 ? 'text-emerald-500' : 'text-slate-300'
                  }`}
                />
                Huidige woning
              </button>
            )}
            <span className="mx-1 hidden h-4 w-px flex-shrink-0 bg-slate-200 sm:block" />
            <button
              type="button"
              data-rail-id="sectie-resultaat"
              onClick={() => scrollToSection('sectie-resultaat')}
              className={`flex flex-shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold transition-all duration-200 ${
                overallAffordable
                  ? 'text-emerald-600 hover:bg-emerald-50'
                  : 'text-red-600 hover:bg-red-50'
              } ${activeSectionId === 'sectie-resultaat' ? 'ring-1 ring-inset ring-current' : ''}`}
            >
              {overallAffordable ? (
                <CheckCircle2 className="h-3.5 w-3.5" />
              ) : (
                <AlertTriangle className="h-3.5 w-3.5" />
              )}
              {overallAffordable ? 'Haalbaar' : 'Nog niet haalbaar'}
            </button>
          </div>
          <div className="mx-auto mt-1.5 h-0.5 max-w-6xl overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-[width] duration-150 ease-linear"
              style={{ width: `${sectionProgress * 100}%` }}
            />
          </div>
        </div>

        <div className="mb-8 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">
              Hypotheekcalculator 2026
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Indicatieve berekening op basis van de Nibud-systematiek 2026. Geen rechten kunnen
              aan deze uitkomst worden ontleend.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleExportPdf}
              className="flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 transition-all duration-200 hover:border-blue-300 hover:bg-blue-100"
            >
              <FileDown className="h-3.5 w-3.5" />
              Exporteer naar PDF
            </button>
            <button
              type="button"
              onClick={() => {
                if (
                  window.confirm(
                    'Weet u zeker dat u opnieuw wilt beginnen? Alle ingevoerde gegevens gaan verloren.'
                  )
                ) {
                  onReset();
                }
              }}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-500 transition-all duration-200 hover:border-slate-300 hover:text-slate-700"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Opnieuw beginnen
            </button>
          </div>
        </div>

        <div id="sectie-situatie" className="mb-6 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <span className="text-sm font-medium text-slate-700">Uw situatie</span>
          <p className="mb-4 text-xs text-slate-400">
            Deze twee keuzes bepalen de vorm van de rest van de berekening.
          </p>
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-slate-500">
                Heeft u op dit moment al een eigen woning met hypotheek?
              </p>
              <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
                <button
                  type="button"
                  onClick={() => setHasExistingHome(true)}
                  className={`rounded-md px-3 py-2 sm:py-1.5 text-xs font-semibold transition-all duration-200 ${
                    hasExistingHome
                      ? 'bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  Ja, ik heb al een woning
                </button>
                <button
                  type="button"
                  onClick={() => setHasExistingHome(false)}
                  className={`rounded-md px-3 py-2 sm:py-1.5 text-xs font-semibold transition-all duration-200 ${
                    !hasExistingHome
                      ? 'bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  Nee, nog geen woning
                </button>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
              <p className="text-xs text-slate-500">Met hoeveel aanvragers vraagt u de hypotheek aan?</p>
              <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
                <button
                  type="button"
                  onClick={() => setHasPartner2(false)}
                  className={`rounded-md px-3 py-2 sm:py-1.5 text-xs font-semibold transition-all duration-200 ${
                    !hasPartner2
                      ? 'bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  1 aanvrager
                </button>
                <button
                  type="button"
                  onClick={() => setHasPartner2(true)}
                  className={`rounded-md px-3 py-2 sm:py-1.5 text-xs font-semibold transition-all duration-200 ${
                    hasPartner2
                      ? 'bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  2 aanvragers
                </button>
              </div>
            </div>
            <div className="border-t border-slate-100 pt-3">
              <CurrencyField
                id="lenderCapThreshold"
                label="Maximale hypotheek bij uw geldverstrekker (optioneel)"
                icon={<Building2 className="h-3.5 w-3.5 text-slate-400" />}
                value={lenderCapThreshold}
                onChange={setLenderCapThreshold}
                placeholder={String(LENDER_CAP_THRESHOLD_DEFAULT)}
                hint={`Standaard ${formatEuro(LENDER_CAP_THRESHOLD_DEFAULT)} — pas aan als uw eigen geldverstrekker een ander maximum hanteert. Werkt als een harde grens naast de Nibud-inkomenstoets.`}
              />
            </div>
          </div>
        </div>

        <div className="mt-8">
          <SectionCard id="sectie-beoogde-woning" title="Beoogde woning" icon={<Home className="h-4 w-4" />} accent="emerald">
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <Slider
                id="purchasePrice"
                label="Aanschafprijs beoogde woning"
                icon={<Euro className="h-3.5 w-3.5 text-slate-400" />}
                value={purchasePrice}
                min={100000}
                max={2500000}
                step={5000}
                onChange={setPurchasePrice}
                formatValue={formatEuro}
              />
              <Slider
                id="rate"
                label="Beoogde hypotheekrente"
                icon={<Percent className="h-3.5 w-3.5 text-slate-400" />}
                value={rate}
                min={2.0}
                max={6.0}
                step={0.01}
                onChange={setRate}
                formatValue={formatRate}
              />
              <Slider
                id="fixedRatePeriod"
                label="Rentevastperiode nieuwe hypotheek"
                icon={<CalendarDays className="h-3.5 w-3.5 text-slate-400" />}
                value={fixedRatePeriod}
                min={1}
                max={30}
                step={1}
                onChange={setFixedRatePeriod}
                formatValue={(v) => `${v} jaar`}
                labelExtra={
                  <InfoTooltip text={`Bij een rentevastperiode korter dan 10 jaar moet wettelijk met de (hogere) AFM-toetsrente van ${formatRate(TOETSRENTE)} worden getoetst in plaats van uw daadwerkelijke rente, ook al betaalt u die lagere rente gewoon echt.`} />
                }
              />
              <EnergyLabelPicker
                id="energyLabel"
                label="Energielabel beoogde woning"
                icon={<Leaf className="h-3.5 w-3.5 text-slate-400" />}
                value={energyLabel}
                onChange={setEnergyLabel}
              />
            </div>

            <AnimatePresence>
              {calc.toetsrenteApplies && (
                <motion.div
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.2 }}
                  className="mt-5"
                >
                  <InlineNote className="mt-0">
                    Bij een rentevastperiode korter dan 10 jaar moet wettelijk met de
                    AFM-toetsrente van {formatRate(TOETSRENTE)} worden getoetst in plaats van de
                    daadwerkelijke rente. Uw leencapaciteit is hierop gebaseerd.
                  </InlineNote>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Overdrachtsbelasting: gebruiksdoel bepaalt het tarief (0/1/2/8% of n.v.t.). */}
            <div className="mt-5 rounded-xl border border-slate-100 bg-slate-50/60 p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Type aankoop (overdrachtsbelasting)
                </span>
                <div className="inline-flex rounded-lg border border-slate-100 bg-white p-1">
                  {[
                    { key: 'zelfbewoning', label: 'Bestaande bouw' },
                    { key: 'nieuwbouw', label: 'Nieuwbouw' },
                    { key: 'nietHoofdverblijf', label: 'Niet-hoofdverblijf' },
                  ].map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => setPropertyUsage(option.key)}
                      className={`rounded-md px-3 py-2 sm:py-1.5 text-xs font-semibold transition-all duration-200 ${
                        propertyUsage === option.key
                          ? 'bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-sm'
                          : 'text-slate-500 hover:text-slate-700'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              {propertyUsage === 'zelfbewoning' &&
                (() => {
                  const buyers = [
                    {
                      label: 'Partner 1',
                      age: age1,
                      checked: starterExemption1,
                      onChange: setStarterExemption1,
                      id: 'starterExemption1',
                    },
                    {
                      label: 'Partner 2',
                      age: hasPartner2 ? age2 : 0,
                      checked: starterExemption2,
                      onChange: setStarterExemption2,
                      id: 'starterExemption2',
                    },
                  ].filter((buyer) => safeNum(buyer.age) > 0);
                  // Startersvrijstelling is afhankelijk van leeftijd (18 t/m 34 jaar): het
                  // vinkje wordt alleen getoond — en telt dus alleen mee — binnen die
                  // leeftijdsgrens, in plaats van een inert vinkje te tonen dat toch geen
                  // effect heeft.
                  const eligible = buyers.filter(
                    (b) =>
                      safeNum(b.age) >= STARTER_EXEMPTION_MIN_AGE &&
                      safeNum(b.age) <= STARTER_EXEMPTION_MAX_AGE
                  );
                  const ineligible = buyers.filter(
                    (b) =>
                      safeNum(b.age) < STARTER_EXEMPTION_MIN_AGE ||
                      safeNum(b.age) > STARTER_EXEMPTION_MAX_AGE
                  );
                  return (
                    <div className="mb-3 space-y-2">
                      {eligible.length > 0 && (
                        <div className="flex flex-col gap-2 sm:flex-row sm:gap-6">
                          {eligible.map((buyer) => (
                            <label
                              key={buyer.id}
                              htmlFor={buyer.id}
                              className="flex cursor-pointer items-center gap-2 text-xs text-slate-600"
                            >
                              <input
                                id={buyer.id}
                                type="checkbox"
                                checked={buyer.checked}
                                onChange={(e) => buyer.onChange(e.target.checked)}
                                className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                              />
                              {buyer.label} ({buyer.age} jr): startersvrijstelling nog niet
                              gebruikt
                            </label>
                          ))}
                        </div>
                      )}
                      {ineligible.length > 0 && (
                        <p className="text-[11px] text-slate-400">
                          {ineligible.map((b) => `${b.label} (${b.age} jr)`).join(' en ')}{' '}
                          {ineligible.length === 1 ? 'komt' : 'komen'} door de leeftijd niet in
                          aanmerking voor de startersvrijstelling (alleen 18 t/m 34 jaar).
                        </p>
                      )}
                    </div>
                  );
                })()}

              <StatusBadge status={calc.transferTaxInfo.rate === 0 ? 'success' : 'info'}>
                Overdrachtsbelasting: {calc.transferTaxInfo.label}
                {safeNum(purchasePrice) > 0 && calc.transferTaxInfo.rate > 0 && (
                  <> — {formatEuro(safeNum(purchasePrice) * calc.transferTaxInfo.rate)}</>
                )}
                . {calc.transferTaxInfo.explanation}
              </StatusBadge>
              {propertyUsage === 'zelfbewoning' &&
                safeNum(purchasePrice) > STARTER_EXEMPTION_PRICE_CAP &&
                (safeNum(age1) < 35 || safeNum(age2) < 35) && (
                  <p className="mt-2 text-[11px] text-slate-400">
                    De startersvrijstelling vervalt hier volledig omdat de woningwaarde boven de
                    grens van {formatEuro(STARTER_EXEMPTION_PRICE_CAP)} (2026) ligt.
                  </p>
                )}
            </div>
          </SectionCard>
        </div>

        <AnimatePresence>
          {calc.pensionApplies && (
            <motion.div
              initial={{ opacity: 0, y: -8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.98 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
              className="mb-6"
            >
              {calc.pensionIncomplete ? (
                <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
                  <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-500" />
                  <p className="text-sm text-amber-800">
                    <span className="font-semibold">AOW-toets onvolledig:</span> vul bij{' '}
                    {calc.pensionMissing1 && calc.pensionMissing2
                      ? 'beide partners'
                      : calc.pensionMissing1
                        ? 'partner 1'
                        : 'partner 2'}{' '}
                    het verwachte bruto pensioeninkomen in (Inkomen-kaart). Wie binnen 10 jaar
                    de AOW-leeftijd van 67 bereikt, moet wettelijk óók op het (vaak lagere)
                    pensioeninkomen worden getoetst. Zolang dit veld leeg is, rekent de
                    calculator alleen met het huidige inkomen.
                  </p>
                </div>
              ) : (
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    AOW-toets: dubbele toetsing (binnen 10 jaar van de AOW-leeftijd)
                  </p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div
                      className={`rounded-xl border px-4 py-3 ${
                        !calc.pensionBinding
                          ? 'border-indigo-200 bg-indigo-50'
                          : 'border-slate-100 bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-slate-500">
                          Toets op huidig inkomen (Tabel 1)
                        </span>
                        {!calc.pensionBinding && (
                          <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                            Bindend
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-lg font-bold text-slate-900">
                        {formatEuro(calc.currentScenarioMax)}
                      </p>
                    </div>
                    <div
                      className={`rounded-xl border px-4 py-3 ${
                        calc.pensionBinding
                          ? 'border-amber-300 bg-amber-50'
                          : 'border-slate-100 bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-slate-500">
                          Toets op pensioeninkomen (Tabel 2, AOW)
                        </span>
                        {calc.pensionBinding && (
                          <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                            Bindend
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-lg font-bold text-slate-900">
                        {formatEuro(calc.pensionScenarioMax)}
                      </p>
                    </div>
                  </div>
                  <p className="mt-3 text-xs text-slate-400">
                    De laagste uitkomst bepaalt de maximale hypotheek. Het pensioenscenario
                    rekent met het verwachte pensioeninkomen ({formatEuro(calc.pensionCombinedIncome)}{' '}
                    gezamenlijk toetsinkomen) tegen de aparte AOW-financieringslasttabel uit
                    dezelfde regeling.
                  </p>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5 lg:items-start">
          <div className="space-y-6 lg:col-span-3 lg:row-start-1">
            <SectionCard id="sectie-inkomen" title="Inkomen" icon={<Euro className="h-4 w-4" />} accent="blue">
              <div className={`grid grid-cols-1 gap-4 ${hasPartner2 ? 'sm:grid-cols-2' : ''}`}>
                <PartnerSubCard label={hasPartner2 ? 'Partner 1' : 'Aanvrager'}>
                  <IncomeTypeSelect id="incomeType1" value={incomeType1} onChange={setIncomeType1} />
                  {calc.toets1.usesHistory ? (
                    <IncomeHistoryFields
                      idPrefix="incomeHistory1"
                      incomeType={incomeType1}
                      history={incomeHistory1}
                      onChange={(key, v) => setIncomeHistory1((prev) => ({ ...prev, [key]: v }))}
                    />
                  ) : (
                    <Slider
                      id="income1"
                      label="Bruto jaarinkomen"
                      icon={<Euro className="h-3.5 w-3.5 text-slate-400" />}
                      value={income1}
                      min={0}
                      max={300000}
                      step={1000}
                      onChange={setIncome1}
                      formatValue={formatEuro}
                    />
                  )}
                  <Slider
                    id="ownCapital1"
                    label="Inbreng eigen vermogen"
                    icon={<PiggyBank className="h-3.5 w-3.5 text-slate-400" />}
                    value={ownCapital1}
                    min={0}
                    max={400000}
                    step={1000}
                    onChange={setOwnCapital1}
                    formatValue={formatEuro}
                  />
                  <NumberField
                    id="age1"
                    label="Leeftijd"
                    icon={<User className="h-3.5 w-3.5 text-slate-400" />}
                    value={age1}
                    onChange={setAge1}
                    placeholder="36"
                    suffix="jaar"
                    min={18}
                    max={100}
                  />
                  <AnimatePresence>
                    {calc.pensionApplies1 && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2 }}
                      >
                        <CurrencyField
                          id="pensionIncome1"
                          label="Verwacht bruto pensioeninkomen p/j"
                          icon={<CalendarDays className="h-3.5 w-3.5 text-slate-400" />}
                          value={pensionIncome1}
                          onChange={setPensionIncome1}
                          placeholder="29.000"
                          hint="Incl. AOW. Binnen 10 jaar van de AOW-leeftijd (67) wordt ook hierop getoetst."
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>
                  <AdvancedFieldsToggle label="Meer opties (13e maand, bonus)">
                    <CurrencyField
                      id="thirteenthMonth1"
                      label="Vaste 13e maand / eindejaarsuitkering p/j"
                      icon={<Euro className="h-3.5 w-3.5 text-slate-400" />}
                      value={thirteenthMonth1}
                      onChange={setThirteenthMonth1}
                      placeholder="0"
                      hint="Structureel, telt volledig mee"
                    />
                    <CurrencyField
                      id="avgBonus1"
                      label="Gem. bonus/overwerk laatste 3 jaar p/j"
                      icon={<Euro className="h-3.5 w-3.5 text-slate-400" />}
                      value={avgBonus1}
                      onChange={setAvgBonus1}
                      placeholder="0"
                      hint="Incidenteel, telt mee als gemiddelde"
                    />
                  </AdvancedFieldsToggle>
                  <ToetsinkomenSummary toets={calc.toets1} incomeType={incomeType1} />
                </PartnerSubCard>
                {hasPartner2 && (
                <PartnerSubCard label="Partner 2">
                  <IncomeTypeSelect id="incomeType2" value={incomeType2} onChange={setIncomeType2} />
                  {calc.toets2.usesHistory ? (
                    <IncomeHistoryFields
                      idPrefix="incomeHistory2"
                      incomeType={incomeType2}
                      history={incomeHistory2}
                      onChange={(key, v) => setIncomeHistory2((prev) => ({ ...prev, [key]: v }))}
                    />
                  ) : (
                    <Slider
                      id="income2"
                      label="Bruto jaarinkomen"
                      icon={<Euro className="h-3.5 w-3.5 text-slate-400" />}
                      value={income2}
                      min={0}
                      max={300000}
                      step={1000}
                      onChange={setIncome2}
                      formatValue={formatEuro}
                    />
                  )}
                  <Slider
                    id="ownCapital2"
                    label="Inbreng eigen vermogen"
                    icon={<PiggyBank className="h-3.5 w-3.5 text-slate-400" />}
                    value={ownCapital2}
                    min={0}
                    max={400000}
                    step={1000}
                    onChange={setOwnCapital2}
                    formatValue={formatEuro}
                  />
                  <NumberField
                    id="age2"
                    label="Leeftijd"
                    icon={<User className="h-3.5 w-3.5 text-slate-400" />}
                    value={age2}
                    onChange={setAge2}
                    placeholder="36"
                    suffix="jaar"
                    min={18}
                    max={100}
                  />
                  <AnimatePresence>
                    {calc.pensionApplies2 && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2 }}
                      >
                        <CurrencyField
                          id="pensionIncome2"
                          label="Verwacht bruto pensioeninkomen p/j"
                          icon={<CalendarDays className="h-3.5 w-3.5 text-slate-400" />}
                          value={pensionIncome2}
                          onChange={setPensionIncome2}
                          placeholder="29.000"
                          hint="Incl. AOW. Binnen 10 jaar van de AOW-leeftijd (67) wordt ook hierop getoetst."
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>
                  <AdvancedFieldsToggle label="Meer opties (13e maand, bonus)">
                    <CurrencyField
                      id="thirteenthMonth2"
                      label="Vaste 13e maand / eindejaarsuitkering p/j"
                      icon={<Euro className="h-3.5 w-3.5 text-slate-400" />}
                      value={thirteenthMonth2}
                      onChange={setThirteenthMonth2}
                      placeholder="0"
                      hint="Structureel, telt volledig mee"
                    />
                    <CurrencyField
                      id="avgBonus2"
                      label="Gem. bonus/overwerk laatste 3 jaar p/j"
                      icon={<Euro className="h-3.5 w-3.5 text-slate-400" />}
                      value={avgBonus2}
                      onChange={setAvgBonus2}
                      placeholder="0"
                      hint="Incidenteel, telt mee als gemiddelde"
                    />
                  </AdvancedFieldsToggle>
                  <ToetsinkomenSummary toets={calc.toets2} incomeType={incomeType2} />
                </PartnerSubCard>
                )}
              </div>
              <AnimatePresence>
                {calc.combinedIncome === 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.2 }}
                    className="mt-4"
                  >
                    <StatusBadge status="warning">
                      Vul het bruto jaarinkomen van minimaal één van de partners in om een
                      berekening te zien.
                    </StatusBadge>
                  </motion.div>
                )}
              </AnimatePresence>
            </SectionCard>

            <SectionCard id="sectie-schulden" title="Schulden" icon={<CreditCard className="h-4 w-4" />} accent="amber">
              <div className={`grid grid-cols-1 gap-4 ${hasPartner2 ? 'sm:grid-cols-2' : ''}`}>
                <PartnerSubCard label={hasPartner2 ? 'Partner 1' : 'Aanvrager'}>
                  <CurrencyField
                    id="debt1"
                    label="Overige schulden"
                    icon={<CreditCard className="h-3.5 w-3.5 text-slate-400" />}
                    value={debt1}
                    onChange={setDebt1}
                    placeholder="0"
                  />
                  <CurrencyField
                    id="studyDebt1"
                    label="Studieschuld"
                    icon={<GraduationCap className="h-3.5 w-3.5 text-slate-400" />}
                    value={studyDebt1}
                    onChange={setStudyDebt1}
                    placeholder="0"
                    hint="Totale openstaande schuld, niet het maandbedrag"
                  />
                  <AdvancedFieldsToggle label="Meer opties (alimentatie)">
                    <CurrencyField
                      id="partnerAlimony1"
                      label="Betaalde partneralimentatie p/mnd"
                      icon={<User className="h-3.5 w-3.5 text-slate-400" />}
                      value={partnerAlimony1}
                      onChange={setPartnerAlimony1}
                      placeholder="0"
                    />
                  </AdvancedFieldsToggle>
                </PartnerSubCard>
                {hasPartner2 && (
                <PartnerSubCard label="Partner 2">
                  <CurrencyField
                    id="debt2"
                    label="Overige schulden"
                    icon={<CreditCard className="h-3.5 w-3.5 text-slate-400" />}
                    value={debt2}
                    onChange={setDebt2}
                    placeholder="0"
                  />
                  <CurrencyField
                    id="studyDebt2"
                    label="Studieschuld"
                    icon={<GraduationCap className="h-3.5 w-3.5 text-slate-400" />}
                    value={studyDebt2}
                    onChange={setStudyDebt2}
                    placeholder="0"
                    hint="Totale openstaande schuld, niet het maandbedrag"
                  />
                  <AdvancedFieldsToggle label="Meer opties (alimentatie)">
                    <CurrencyField
                      id="partnerAlimony2"
                      label="Betaalde partneralimentatie p/mnd"
                      icon={<User className="h-3.5 w-3.5 text-slate-400" />}
                      value={partnerAlimony2}
                      onChange={setPartnerAlimony2}
                      placeholder="0"
                    />
                  </AdvancedFieldsToggle>
                </PartnerSubCard>
                )}
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium text-slate-600">Studieschuld stelsel</span>
                <div className="inline-flex rounded-lg border border-slate-100 bg-slate-50 p-1">
                  <button
                    type="button"
                    onClick={() => setStudyDebtRegime('nieuw')}
                    className={`rounded-md px-3 py-2 sm:py-1.5 text-xs font-semibold transition-all duration-200 ${
                      studyDebtRegime === 'nieuw'
                        ? 'bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-sm'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    Nieuw (vanaf 2015)
                  </button>
                  <button
                    type="button"
                    onClick={() => setStudyDebtRegime('oud')}
                    className={`rounded-md px-3 py-2 sm:py-1.5 text-xs font-semibold transition-all duration-200 ${
                      studyDebtRegime === 'oud'
                        ? 'bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-sm'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    Oud (vóór 2015)
                  </button>
                </div>
              </div>
              <p className="mt-3 text-xs text-slate-400">
                Overige schulden tellen mee als 2% van het schuldbedrag per maand. Studieschuld
                wordt sinds 2024 berekend op basis van de werkelijke DUO-terugbetaalregeling:{' '}
                {STUDY_DEBT_REGIMES[studyDebtRegime].label.toLowerCase()}, met{' '}
                {formatRate(STUDY_DEBT_REGIMES[studyDebtRegime].rate)} rente over{' '}
                {STUDY_DEBT_REGIMES[studyDebtRegime].termYears} jaar, toegepast op de
                openstaande restschuld. Deze maandlasten worden vervolgens gekapitaliseerd tegen
                de toetsrente en in mindering gebracht op de leencapaciteit.
              </p>
              <p className="mt-2 text-xs text-slate-400">
                Betaalde partneralimentatie werkt anders: die gaat bruto (×12) van het
                toetsinkomen af, vóór de woonquote-bepaling. Ontvangen partneralimentatie telt in
                deze indicatieve berekening niet mee als toetsinkomen (geldverstrekkers gaan hier
                verschillend mee om). Kinderalimentatie heeft geen invloed op de maximale
                hypotheek.
              </p>
            </SectionCard>

          <div
            id="sectie-tweede-woning"
            className="overflow-hidden rounded-2xl border border-l-4 border-slate-100 border-l-rose-400 bg-white shadow-xl transition-all duration-200 hover:-translate-y-0.5 hover:shadow-2xl"
          >
            <button
              type="button"
              onClick={() => setShowSecondHome((prev) => !prev)}
              className="flex w-full items-center justify-between gap-3 p-6 text-left transition-all duration-200 hover:bg-slate-50"
            >
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-50 text-rose-600">
                  <Home className="h-4 w-4" />
                </span>
                <div>
                  <h2 className="text-base font-semibold text-slate-800">Tweede woning</h2>
                  <p className="text-xs text-slate-400">
                    {hasSecondHome
                      ? secondHomeWillSell
                        ? 'Verkopen — netto-opbrengst als extra eigen middelen'
                        : `Aanhouden — ${formatEuro(calc.secondHomeMonthly)}/mnd telt mee als schuld`
                      : 'Een tweede woning met een eigen hypotheekschuld'}
                  </p>
                </div>
              </div>
              {showSecondHome ? (
                <ChevronUp className="h-5 w-5 flex-shrink-0 text-slate-400" />
              ) : (
                <ChevronDown className="h-5 w-5 flex-shrink-0 text-slate-400" />
              )}
            </button>
            <AnimatePresence initial={false}>
              {showSecondHome && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.3, ease: 'easeOut' }}
                  className="overflow-hidden"
                >
                  <div className="space-y-4 border-t border-slate-100 p-6">
                    <p className="text-xs text-slate-500">
                      Heeft u, los van de woning die u eventueel verlaat bij deze verhuizing, nog
                      een tweede woning met een eigen hypotheekschuld? Dat is niet uw eigen woning
                      in box 1: hypotheekrenteaftrek geldt hier niet, en de manier waarop deze
                      schuld meetelt hangt af van of u de woning aanhoudt of verkoopt.
                    </p>
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50/60 p-4">
                      <div>
                        <span className="text-xs font-medium text-slate-600">
                          Ik heb een tweede woning met hypotheekschuld
                        </span>
                        <p className="text-xs text-slate-400">
                          Bijvoorbeeld een woning die u niet zelf bewoont.
                        </p>
                      </div>
                      <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1">
                        <button
                          type="button"
                          onClick={() => setHasSecondHome(false)}
                          className={`rounded-md px-3 py-2 sm:py-1.5 text-xs font-semibold transition-all duration-200 ${
                            !hasSecondHome
                              ? 'bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-sm'
                              : 'text-slate-500 hover:text-slate-700'
                          }`}
                        >
                          Nee
                        </button>
                        <button
                          type="button"
                          onClick={() => setHasSecondHome(true)}
                          className={`rounded-md px-3 py-2 sm:py-1.5 text-xs font-semibold transition-all duration-200 ${
                            hasSecondHome
                              ? 'bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-sm'
                              : 'text-slate-500 hover:text-slate-700'
                          }`}
                        >
                          Ja
                        </button>
                      </div>
                    </div>

                    {hasSecondHome && (
                      <>
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                          <CurrencyField
                            id="secondHomeValue"
                            label="Marktwaarde tweede woning"
                            icon={<Euro className="h-3.5 w-3.5 text-slate-400" />}
                            value={secondHomeValue}
                            onChange={setSecondHomeValue}
                            placeholder="0"
                          />
                          <CurrencyField
                            id="secondHomeMortgageDebt"
                            label="Hypotheekschuld tweede woning"
                            icon={<CreditCard className="h-3.5 w-3.5 text-slate-400" />}
                            value={secondHomeMortgageDebt}
                            onChange={setSecondHomeMortgageDebt}
                            placeholder="0"
                          />
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50/60 p-4">
                          <div>
                            <span className="text-xs font-medium text-slate-600">
                              Verkoopt u de tweede woning?
                            </span>
                            <p className="text-xs text-slate-400">
                              Bepaalt of de hypotheekschuld als maandlast blijft meetellen, of dat
                              de netto-opbrengst vrijkomt als extra eigen middelen.
                            </p>
                          </div>
                          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1">
                            <button
                              type="button"
                              onClick={() => setSecondHomeWillSell(false)}
                              className={`rounded-md px-3 py-2 sm:py-1.5 text-xs font-semibold transition-all duration-200 ${
                                !secondHomeWillSell
                                  ? 'bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-sm'
                                  : 'text-slate-500 hover:text-slate-700'
                              }`}
                            >
                              Aanhouden
                            </button>
                            <button
                              type="button"
                              onClick={() => setSecondHomeWillSell(true)}
                              className={`rounded-md px-3 py-2 sm:py-1.5 text-xs font-semibold transition-all duration-200 ${
                                secondHomeWillSell
                                  ? 'bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-sm'
                                  : 'text-slate-500 hover:text-slate-700'
                              }`}
                            >
                              Verkopen
                            </button>
                          </div>
                        </div>

                        {secondHomeWillSell ? (
                          <>
                            <Slider
                              id="secondHomeSaleCostsPct"
                              label="Verkoopkosten (makelaar, e.d.)"
                              icon={<Percent className="h-3.5 w-3.5 text-slate-400" />}
                              value={secondHomeSaleCostsPct}
                              min={0}
                              max={6}
                              step={0.1}
                              onChange={setSecondHomeSaleCostsPct}
                              formatValue={formatRate}
                            />
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                              <div>
                                <span className="text-xs text-slate-400">Verkoopkosten</span>
                                <p className="text-sm font-semibold text-slate-800">
                                  {formatEuro(calc.secondHomeSaleCosts)}
                                </p>
                              </div>
                              <div>
                                <span className="text-xs text-slate-400">
                                  Netto {calc.secondHomeNetProceeds < 0 ? 'tekort' : 'opbrengst'}
                                </span>
                                <p
                                  className={`text-sm font-semibold ${
                                    calc.secondHomeNetProceeds < 0
                                      ? 'text-red-600'
                                      : 'text-slate-800'
                                  }`}
                                >
                                  {formatEuro(Math.abs(calc.secondHomeNetProceeds))}
                                </p>
                              </div>
                            </div>
                            {calc.secondHomeNetProceeds >= 0 ? (
                              <>
                                <StatusBadge status="success">
                                  De netto-verkoopopbrengst van{' '}
                                  {formatEuro(calc.secondHomeNetProceeds)} (marktwaarde min
                                  hypotheekschuld min verkoopkosten) kan meetellen als extra eigen
                                  middelen bij de aankoop van de beoogde woning.
                                </StatusBadge>
                                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50/60 p-4">
                                  <div>
                                    <span className="text-xs font-medium text-slate-600">
                                      Netto-opbrengst inzetten voor déze aankoop?
                                    </span>
                                    <p className="text-xs text-slate-400">
                                      Zet uit als u dit geld apart wilt houden (bv. sparen, ander
                                      doel) — dan telt het niet mee als eigen middelen hieronder.
                                    </p>
                                  </div>
                                  <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1">
                                    <button
                                      type="button"
                                      onClick={() => setUseSecondHomeProceeds(false)}
                                      className={`rounded-md px-3 py-2 sm:py-1.5 text-xs font-semibold transition-all duration-200 ${
                                        !useSecondHomeProceeds
                                          ? 'bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-sm'
                                          : 'text-slate-500 hover:text-slate-700'
                                      }`}
                                    >
                                      Nee
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setUseSecondHomeProceeds(true)}
                                      className={`rounded-md px-3 py-2 sm:py-1.5 text-xs font-semibold transition-all duration-200 ${
                                        useSecondHomeProceeds
                                          ? 'bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-sm'
                                          : 'text-slate-500 hover:text-slate-700'
                                      }`}
                                    >
                                      Ja
                                    </button>
                                  </div>
                                </div>
                                {!useSecondHomeProceeds && (
                                  <p className="text-xs text-slate-400">
                                    De opbrengst van {formatEuro(calc.secondHomeNetProceeds)} telt
                                    nu niet mee in uw eigen middelen hieronder.
                                  </p>
                                )}
                              </>
                            ) : (
                              <StatusBadge status="warning">
                                Restschuld: de hypotheekschuld en verkoopkosten zijn samen{' '}
                                {formatEuro(calc.secondHomeShortfall)} hoger dan de marktwaarde.
                                Dit tekort moet u bij verkoop uit eigen middelen bijleggen — het
                                verlaagt daarom altijd uw beschikbare eigen middelen voor de nieuwe
                                aankoop, ongeacht bovenstaande schakelaar. Deze restschuld kan,
                                anders dan bij uw eigen woning, niet automatisch worden
                                meegefinancierd in de nieuwe hypotheek.
                              </StatusBadge>
                            )}
                          </>
                        ) : (
                          <>
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                              <SelectField
                                id="secondHomeRepaymentType"
                                label="Aflosvorm"
                                icon={<PiggyBank className="h-3.5 w-3.5 text-slate-400" />}
                                value={secondHomeRepaymentType}
                                onChange={setSecondHomeRepaymentType}
                                options={AFLOSVORMEN}
                              />
                              <Slider
                                id="secondHomeInterestRate"
                                label="Hypotheekrente tweede woning"
                                icon={<Percent className="h-3.5 w-3.5 text-slate-400" />}
                                value={secondHomeInterestRate}
                                min={1.0}
                                max={8.0}
                                step={0.01}
                                onChange={setSecondHomeInterestRate}
                                formatValue={formatRate}
                              />
                            </div>
                            <Slider
                              id="secondHomeRemainingYears"
                              label="Resterende looptijd"
                              icon={<CalendarDays className="h-3.5 w-3.5 text-slate-400" />}
                              value={secondHomeRemainingYears}
                              min={1}
                              max={30}
                              step={1}
                              onChange={setSecondHomeRemainingYears}
                              formatValue={(v) => `${v} jaar`}
                            />
                            <div className="flex items-center justify-between rounded-xl border-2 border-amber-200 bg-amber-50 px-5 py-4">
                              <span className="text-sm font-medium text-amber-900">
                                Maandlast tweede hypotheek
                              </span>
                              <span className="text-xl font-bold text-amber-700">
                                {formatEuro(calc.secondHomeMonthly)}
                              </span>
                            </div>
                            <p className="text-xs text-slate-400">
                              Deze volledige, werkelijke maandlast (niet de 2%-vuistregel van
                              "Overige schulden") wordt gekapitaliseerd tegen de toetsrente en
                              rechtstreeks in mindering gebracht op uw maximale hypotheek.
                            </p>
                            <div className="rounded-xl border border-slate-100 bg-white p-4">
                              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                Effect op leencapaciteit (Nibud-toets)
                              </span>
                              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                                <div>
                                  <span className="text-xs text-slate-400">
                                    Leencapaciteit zónder deze last
                                  </span>
                                  <p className="text-sm font-semibold text-slate-800">
                                    {formatEuro(calc.incomeBasedMax + calc.secondHomeCapacityReduction)}
                                  </p>
                                </div>
                                <div>
                                  <span className="text-xs text-slate-400">
                                    Afslag door tweede hypotheek
                                  </span>
                                  <p className="text-sm font-semibold text-red-600">
                                    −{formatEuro(calc.secondHomeCapacityReduction)}
                                  </p>
                                </div>
                                <div>
                                  <span className="text-xs text-slate-400">
                                    Leencapaciteit mét deze last
                                  </span>
                                  <p className="text-sm font-semibold text-slate-800">
                                    {formatEuro(calc.incomeBasedMax)}
                                  </p>
                                </div>
                              </div>
                            </div>
                          </>
                        )}
                      </>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div
            id="sectie-kosten-koper"
            className="overflow-hidden rounded-2xl border border-l-4 border-slate-100 border-l-violet-400 bg-white shadow-xl transition-all duration-200 hover:-translate-y-0.5 hover:shadow-2xl"
          >
            <button
              type="button"
              onClick={() => setShowKostenKoperCard((prev) => !prev)}
              className="flex w-full items-center justify-between gap-3 p-6 text-left transition-all duration-200 hover:bg-slate-50"
            >
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-50 text-violet-600">
                  <Receipt className="h-4 w-4" />
                </span>
                <div>
                  <h2 className="text-base font-semibold text-slate-800">Kosten koper</h2>
                  <p className="text-xs text-slate-400">
                    {includeKostenKoperInCalc
                      ? `Meegenomen in de berekening — ${formatEuro(calc.kostenKoper.total)}`
                      : `Nog niet meegenomen in de berekening — indicatief ${formatEuro(calc.kostenKoper.total)}`}
                  </p>
                </div>
              </div>
              {showKostenKoperCard ? (
                <ChevronUp className="h-5 w-5 flex-shrink-0 text-slate-400" />
              ) : (
                <ChevronDown className="h-5 w-5 flex-shrink-0 text-slate-400" />
              )}
            </button>
            <AnimatePresence initial={false}>
              {showKostenKoperCard && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.3, ease: 'easeOut' }}
                  className="overflow-hidden"
                >
                  <div className="space-y-5 border-t border-slate-100 p-6">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/60 p-4">
              <div>
                <p className="text-sm font-medium text-slate-700">Meenemen in berekening?</p>
                <p className="text-xs text-slate-400">
                  Bepaalt of deze kosten meetellen bij "Geschat eigen geld" en de
                  dubbele-lastentoets. Kosten koper worden hierboven altijd getoond en
                  berekend, ongeacht deze keuze.
                </p>
              </div>
              <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1">
                <button
                  type="button"
                  onClick={() => setIncludeKostenKoperInCalc(false)}
                  className={`rounded-md px-3 py-2 sm:py-1.5 text-xs font-semibold transition-all duration-200 ${
                    !includeKostenKoperInCalc
                      ? 'bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  Nee, niet meetellen
                </button>
                <button
                  type="button"
                  onClick={() => setIncludeKostenKoperInCalc(true)}
                  className={`rounded-md px-3 py-2 sm:py-1.5 text-xs font-semibold transition-all duration-200 ${
                    includeKostenKoperInCalc
                      ? 'bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  Ja, meetellen
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
              <CurrencyField
                id="notaryCosts"
                label="Notaris"
                icon={<Euro className="h-3.5 w-3.5 text-slate-400" />}
                value={notaryCosts}
                onChange={setNotaryCosts}
                placeholder="1.200"
                hint="Leverings- en hypotheekakte, Kadaster"
              />
              <CurrencyField
                id="valuationCosts"
                label="Taxatie"
                icon={<Euro className="h-3.5 w-3.5 text-slate-400" />}
                value={valuationCosts}
                onChange={setValuationCosts}
                placeholder="600"
                hint="Fysiek taxatierapport (desktoptaxatie ~€110)"
              />
              <CurrencyField
                id="advisoryCosts"
                label="Hypotheekadvies"
                icon={<Euro className="h-3.5 w-3.5 text-slate-400" />}
                value={advisoryCosts}
                onChange={setAdvisoryCosts}
                placeholder="2.500"
                hint="Advies- en bemiddelingskosten"
              />
            </div>

            <div className="mt-5 space-y-2">
              {[
                {
                  id: 'includeBankGuarantee',
                  key: 'bankGuarantee',
                  checked: includeBankGuarantee,
                  onChange: setIncludeBankGuarantee,
                  label: 'Bankgarantie',
                  hint: '~1% van de waarborgsom (10% koopsom)',
                },
                ...(propertyUsage === 'nieuwbouw'
                  ? []
                  : [
                      {
                        id: 'includeBuyersAgent',
                        key: 'buyersAgent',
                        checked: includeBuyersAgent,
                        onChange: setIncludeBuyersAgent,
                        label: 'Aankoopmakelaar (courtage 1,2%)',
                        hint: 'Optioneel; niet bij aankoop zonder makelaar',
                      },
                    ]),
                {
                  id: 'includeNhgFee',
                  key: 'nhgFee',
                  checked: includeNhgFee,
                  onChange: setIncludeNhgFee,
                  label: 'NHG-borgtochtprovisie (0,4%)',
                  hint: 'Indicatief; de volledige NHG-toets (kostengrens, lagere rente) zit nog niet in deze calculator',
                },
              ].map((row) => {
                const item = calc.kostenKoper.items.find((i) => i.key === row.key);
                return (
                  <div
                    key={row.id}
                    className="flex items-start justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-3"
                  >
                    <label
                      htmlFor={row.id}
                      className="flex cursor-pointer items-start gap-2.5 text-sm text-slate-700"
                    >
                      <input
                        id={row.id}
                        type="checkbox"
                        checked={row.checked}
                        onChange={(e) => row.onChange(e.target.checked)}
                        className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span>
                        {row.label}
                        <span className="block text-xs text-slate-400">{row.hint}</span>
                      </span>
                    </label>
                    <span
                      className={`text-sm font-semibold ${
                        row.checked ? 'text-slate-800' : 'text-slate-300 line-through'
                      }`}
                    >
                      {formatEuro(item ? item.amount : 0)}
                    </span>
                  </div>
                );
              })}
              {propertyUsage === 'nieuwbouw' && (
                <InlineNote>
                  Geen aankoopmakelaar meegerekend: bij nieuwbouw koopt u doorgaans
                  rechtstreeks van de projectontwikkelaar. Had u toch een eigen aankoopmakelaar
                  ingeschakeld, kies dan "Bestaande bouw" of "Niet-hoofdverblijf" hierboven om
                  die kostenpost weer te kunnen aanzetten.
                </InlineNote>
              )}
            </div>

            <div className="mt-4 rounded-xl border border-slate-100 bg-white p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-600">
                  Overdrachtsbelasting ({calc.transferTaxInfo.shortLabel})
                </span>
                <span className="font-semibold text-slate-800">
                  {formatEuro(calc.transferTax)}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-400">
                Automatisch bepaald via het type aankoop en de startersvrijstelling hierboven.
              </p>
              <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
                <span className="text-sm font-medium text-slate-700">
                  Totaal kosten koper (eigen geld)
                </span>
                <AnimatedEuro
                  value={calc.kostenKoper.total}
                  className="text-xl font-bold text-slate-900"
                />
              </div>
              <p className="mt-2 text-xs text-slate-400">
                Kosten koper kunnen niet worden meegefinancierd en betaalt u uit eigen middelen.
                Alle bedragen zijn indicatief; werkelijke tarieven verschillen per notaris,
                taxateur en adviseur.
              </p>
            </div>

            {calc.deductibleFinancingCosts > 0 && (
              <div className="mt-4 rounded-xl border border-emerald-100 bg-emerald-50/60 p-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-1.5 text-slate-600">
                    Eenmalig aftrekbare financieringskosten
                    <InfoTooltip text="Hypotheekadvies, taxatie en de NHG-borgtochtprovisie zijn eenmalig aftrekbaar in box 1, in het jaar van aankoop. Overdrachtsbelasting en notariskosten (leverings-/hypotheekakte) zijn hier bewust buiten beschouwing gelaten." />
                  </span>
                  <span className="font-semibold text-slate-800">
                    {formatEuro(calc.deductibleFinancingCosts)}
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between text-sm">
                  <span className="text-slate-600">
                    Eenmalig fiscaal voordeel ({formatRate(calc.financingCostsHraRate * 100)})
                  </span>
                  <span className="font-semibold text-emerald-700">
                    {formatEuro(calc.financingCostsTaxBenefit)}
                  </span>
                </div>
                <p className="mt-2 text-xs text-slate-400">
                  Alleen hypotheekadvies, taxatie en NHG-provisie (voor zover meegeteld
                  hierboven) zijn hier meegenomen. Vraag uw notaris om een specificatie: alleen
                  het hypotheekakte-deel van de notariskosten is eveneens eenmalig aftrekbaar,
                  de leveringsakte niet.
                </p>
              </div>
            )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {propertyUsage === 'nieuwbouw' && (
            <div
              id="sectie-bouwdepot"
              className="mt-8 overflow-hidden rounded-2xl border border-l-4 border-slate-100 border-l-orange-400 bg-white shadow-xl transition-all duration-200 hover:-translate-y-0.5 hover:shadow-2xl"
            >
              <button
                type="button"
                onClick={() => setShowBouwdepotCard((prev) => !prev)}
                className="flex w-full items-center justify-between gap-3 p-6 text-left transition-all duration-200 hover:bg-slate-50"
              >
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-50 text-orange-600">
                    <HardHat className="h-4 w-4" />
                  </span>
                  <div>
                    <h2 className="text-base font-semibold text-slate-800">
                      Bouwdepot (nieuwbouw)
                    </h2>
                    <p className="text-xs text-slate-400">
                      {bouwdepotCalc &&
                        `Gemiddelde rente tijdens de bouw: ${formatEuro(bouwdepotCalc.monthlyInterestAverage)}/mnd`}
                    </p>
                  </div>
                </div>
                {showBouwdepotCard ? (
                  <ChevronUp className="h-5 w-5 flex-shrink-0 text-slate-400" />
                ) : (
                  <ChevronDown className="h-5 w-5 flex-shrink-0 text-slate-400" />
                )}
              </button>
              <AnimatePresence initial={false}>
                {showBouwdepotCard && bouwdepotCalc && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.3, ease: 'easeOut' }}
                    className="overflow-hidden"
                  >
                    <div className="space-y-5 border-t border-slate-100 p-6">
                      <p className="text-xs text-slate-500">
                        Bij nieuwbouw wordt het hypotheekdeel voor de aanneemsom niet in één
                        keer uitgekeerd, maar in bouwtermijnen opgenomen naarmate de bouw
                        vordert. U betaalt dan alleen rente over het al opgenomen bedrag — dat
                        geeft doorgaans lagere maandlasten tijdens de bouwperiode dan na
                        oplevering.
                      </p>
                      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                        <CurrencyField
                          id="bouwdepotAmount"
                          label="Bouwdepot bedrag"
                          icon={<Euro className="h-3.5 w-3.5 text-slate-400" />}
                          value={bouwdepotAmount}
                          onChange={setBouwdepotAmount}
                          placeholder={String(Math.round(safeNum(purchasePrice)))}
                          hint="Standaard de aanschafprijs; pas aan als een deel apart wordt betaald (bijv. grondkosten)"
                        />
                        <Slider
                          id="constructionMonths"
                          label="Verwachte bouwperiode"
                          icon={<HardHat className="h-3.5 w-3.5 text-slate-400" />}
                          value={constructionMonths}
                          min={3}
                          max={30}
                          step={1}
                          onChange={setConstructionMonths}
                          formatValue={(v) => `${v} maanden`}
                        />
                      </div>

                      <div className="space-y-2 rounded-xl border border-slate-100 bg-slate-50/60 p-4">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-slate-600">Gemiddeld opgenomen bedrag</span>
                          <span className="font-semibold text-slate-800">
                            {formatEuro(bouwdepotCalc.averageDrawn)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-slate-600">Gemiddelde rente tijdens de bouw</span>
                          <span className="font-semibold text-slate-800">
                            {formatEuro(bouwdepotCalc.monthlyInterestAverage)}/mnd
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-slate-600">Rente bij oplevering (volledig)</span>
                          <span className="font-semibold text-slate-800">
                            {formatEuro(bouwdepotCalc.monthlyInterestAtCompletion)}/mnd
                          </span>
                        </div>
                        <div className="flex items-center justify-between border-t border-slate-200 pt-2 text-sm">
                          <span className="text-slate-600">
                            Totale rente over de bouwperiode ({bouwdepotCalc.months} mnd)
                          </span>
                          <span className="font-semibold text-slate-800">
                            {formatEuro(bouwdepotCalc.totalInterestDuringConstruction)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-emerald-700">
                            Rentevoordeel t.o.v. meteen volledig lenen
                          </span>
                          <span className="font-semibold text-emerald-700">
                            {formatEuro(bouwdepotCalc.interestSavedVsImmediate)}
                          </span>
                        </div>
                      </div>

                      <InlineNote>
                        Indicatief, uitgaande van een gelijkmatige (lineaire) opname van het
                        bouwdepot — de werkelijke bouwtermijnenstaat verschilt per project. Dit
                        beïnvloedt uw leencapaciteit niet: die blijft bepaald door de
                        Nibud-woonquote hierboven.
                      </InlineNote>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
          </div>

          <div id="sectie-resultaat" className="lg:sticky lg:top-10 lg:col-span-2 lg:col-start-4 lg:row-start-1">
            <BorderGlow
              className="w-full"
              borderRadius={16}
              backgroundColor="transparent"
              glowColor="45 90 65"
              colors={['#fbbf24', '#60a5fa', '#818cf8']}
              glowIntensity={1.2}
              animated
            >
            <div className="rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 p-7 text-white shadow-xl">
              <div className="mb-6 flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/15">
                  <Euro className="h-4 w-4" />
                </span>
                <h2 className="text-base font-semibold">Resultaat</h2>
              </div>

              <motion.div
                animate={
                  celebrate
                    ? { scale: [1, 1.18, 0.94, 1.06, 1], rotate: [0, -6, 6, -3, 0] }
                    : { scale: 1, rotate: 0 }
                }
                transition={{ duration: 0.7, ease: 'easeOut' }}
                className={`mb-5 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
                  hasExistingHome
                    ? combinedGapCalc.withinCapacity
                      ? 'bg-emerald-500/20 text-emerald-50'
                      : 'bg-red-500/20 text-red-50'
                    : calc.isOverIndebted
                    ? 'bg-red-500/20 text-red-50'
                    : calc.cappedByPropertyValue
                    ? 'bg-amber-500/20 text-amber-50'
                    : 'bg-emerald-500/20 text-emerald-50'
                }`}
              >
                {hasExistingHome ? (
                  combinedGapCalc.withinCapacity ? (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  ) : (
                    <AlertTriangle className="h-3.5 w-3.5" />
                  )
                ) : calc.isOverIndebted ? (
                  <AlertTriangle className="h-3.5 w-3.5" />
                ) : calc.cappedByPropertyValue ? (
                  <AlertTriangle className="h-3.5 w-3.5" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                )}
                {hasExistingHome
                  ? combinedGapCalc.withinCapacity
                    ? 'Haalbaar incl. overwaarde'
                    : 'Aanvullende hypotheek te hoog'
                  : calc.isOverIndebted
                  ? 'Schulden hoger dan leencapaciteit'
                  : calc.cappedByPropertyValue
                  ? 'Begrensd door aanschafprijs'
                  : 'Haalbaar op basis van inkomen'}
              </motion.div>

              <AnimatePresence mode="wait">
                {bindingFactor && (
                  <motion.div
                    key={bindingFactor.label}
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 4 }}
                    transition={{ duration: 0.2 }}
                    className="mb-5 rounded-xl bg-white/10 px-4 py-3"
                  >
                    <p className="text-[11px] uppercase tracking-wide text-blue-200">
                      Bepalend voor uw maximum nu
                    </p>
                    <p className="mt-0.5 text-sm font-semibold text-white">
                      {bindingFactor.label}
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-blue-100/80">
                      {bindingFactor.explanation}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="space-y-1">
                <p className="text-sm text-blue-100">
                  {hasExistingHome ? 'Maximaal aankoopbudget' : 'Maximale hypotheek'}
                </p>
                <AnimatedEuro
                  value={hasExistingHome ? maxBudgetCalc.maxBudget : calc.maxMortgage}
                  className="block text-4xl font-bold tracking-tight sm:text-5xl"
                />
                {hasExistingHome && (
                  <p className="text-xs text-blue-200">
                    Incl. meegenomen hypotheek en overwaarde uit verkoop van uw huidige woning.
                  </p>
                )}
              </div>

              {hasExistingHome && (
                <div className="mt-4 flex flex-col gap-1 rounded-xl border border-amber-300/30 bg-amber-500/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                  <div>
                    <p className="text-xs font-medium text-amber-100">O.b.v. inkomen alleen</p>
                    <p className="text-[11px] text-amber-200/70">
                      zonder overwaarde of meeneemregeling
                    </p>
                  </div>
                  <p className="text-lg font-bold text-amber-50">{formatEuro(calc.maxMortgage)}</p>
                </div>
              )}

              {!hasExistingHome && (
                <div className="mt-4 space-y-2 rounded-xl bg-white/10 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-1.5 text-xs text-blue-100">
                      Max. o.b.v. inkomen
                      <InfoTooltip
                        variant="light"
                        text="Uw leencapaciteit op basis van de Nibud-woonquote en uw werkelijke rente, zonder rekening te houden met bestaande schulden."
                      />
                    </span>
                    <span className="text-sm font-semibold text-white">
                      {formatEuro(calc.maxLoanIncomeOnly)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-1.5 text-xs text-blue-100">
                      + gecorrigeerd voor schulden
                      <InfoTooltip
                        variant="light"
                        text="Hetzelfde bedrag, nu met de maandlast van uw overige schulden en studieschuld erin verwerkt (die verlagen de beschikbare ruimte voor woonlasten)."
                      />
                    </span>
                    <span className="text-sm font-semibold text-white">
                      {formatEuro(calc.incomeBasedMaxAtActualRate)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3 border-t border-white/15 pt-2">
                    <span className="flex items-center gap-1.5 text-xs font-medium text-blue-50">
                      + toetsrente-afslag
                      <InfoTooltip
                        variant="light"
                        text="Definitief bindend bedrag: ook getoetst tegen de (hogere) AFM-toetsrente zodra een leningdeel korter dan 10 jaar rentevast is, en tegen het verwachte pensioeninkomen indien van toepassing. Is uw rente al 10 jaar of langer vast en geen AOW-toets van toepassing, dan is dit gelijk aan de regel hierboven."
                      />
                    </span>
                    <span className="text-base font-bold text-white">
                      {formatEuro(calc.incomeBasedMax)}
                    </span>
                  </div>
                </div>
              )}

              <AnimatePresence>
                {!hasExistingHome && calc.cappedByPropertyValue && (
                  <motion.div
                    initial={{ opacity: 0, y: 8, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 8, scale: 0.97 }}
                    transition={{ duration: 0.25, ease: 'easeOut' }}
                    className="mt-4 flex items-start gap-2 rounded-xl border border-amber-300/30 bg-amber-500/20 p-3"
                  >
                    <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-200" />
                    <p className="text-xs text-amber-50">
                      Uw leencapaciteit o.b.v. inkomen is {formatEuro(calc.incomeBasedMax)}, hoger
                      dan de aanschafprijs. Een hypotheek kan nooit boven de aanschafprijs uitkomen.
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="mt-4 flex flex-col gap-1 rounded-xl bg-white/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                <span className="text-sm text-blue-100">
                  {hasExistingHome
                    ? 'Aanvullende hypotheek voor huidige aanschafprijs'
                    : 'Totaal aankoopvermogen (incl. eigen vermogen)'}
                </span>
                <span className="text-xl font-bold">
                  {formatEuro(hasExistingHome ? combinedGapCalc.additionalMortgage : calc.purchasingPower)}
                </span>
              </div>

              <div className="my-6 h-px w-full bg-white/15" />

              <div className="space-y-4">
                <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-blue-100">Geschat eigen geld (kosten koper)</p>
                  <p className="text-lg font-semibold">{formatEuro(calc.ownMoney)}</p>
                </div>
                {!includeKostenKoperInCalc && (
                  <p className="-mt-2.5 text-[11px] text-blue-200/70">
                    Kosten koper ({formatEuro(calc.kostenKoper.total)}) telt nog niet mee — zet
                    "Meenemen in berekening" aan in de kaart Kosten koper.
                  </p>
                )}
                <div className="flex items-center justify-between">
                  <p className="text-sm text-blue-100">Ingebracht eigen vermogen</p>
                  <p className="text-sm font-medium">{formatEuro(calc.totalOwnCapital)}</p>
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-sm text-blue-100">
                    Gezamenlijk toetsinkomen
                    <InfoTooltip
                      variant="light"
                      text="Het inkomen waarmee de leencapaciteit wordt getoetst: bruto inkomen plus structureel/gemiddeld extra inkomen, minus betaalde partneralimentatie. Niet per se hetzelfde als uw bruto jaarinkomen."
                    />
                  </span>
                  <p className="text-sm font-medium">{formatEuro(calc.combinedIncome)}</p>
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-sm text-blue-100">
                    Woonquote (Nibud 2026)
                    <InfoTooltip
                      variant="light"
                      text="Het percentage van uw toetsinkomen dat u volgens de officiële Nibud-tabel maximaal aan woonlasten mag besteden. Hoger inkomen en hogere toetsrente geven doorgaans een hogere woonquote."
                    />
                  </span>
                  <p className="text-sm font-medium">
                    {(calc.woonquote * 100).toFixed(1).replace('.', ',')}%
                  </p>
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-sm text-blue-100">Max. bruto woonlast p/m</p>
                  <p className="text-sm font-medium">{formatEuro(calc.maxWoonlastMonthly)}</p>
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-sm text-blue-100">
                    Effectieve leenfactor
                    <InfoTooltip
                      variant="light"
                      text="Uw maximale hypotheek gedeeld door uw toetsinkomen, puur ter illustratie. De daadwerkelijke toets verloopt via de woonquote hierboven, niet via deze factor."
                    />
                  </span>
                  <p className="text-sm font-medium">
                    {calc.effectiveFactor.toFixed(1).replace('.', ',')}x
                  </p>
                </div>
                {calc.debtDeduction > 0 && (
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-blue-100">Afslag i.v.m. schulden</p>
                    <p className="text-sm font-medium text-red-200">
                      -{formatEuro(calc.debtDeduction)}
                    </p>
                  </div>
                )}
                {calc.pensionBinding && (
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-amber-200">AOW-toets bindend (pensioeninkomen)</p>
                    <p className="text-sm font-medium text-amber-200">
                      {formatEuro(calc.pensionScenarioMax)}
                    </p>
                  </div>
                )}
                {calc.pensionIncomplete && (
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-amber-200">AOW-toets onvolledig</p>
                    <p className="text-sm font-medium text-amber-200">pensioeninkomen?</p>
                  </div>
                )}
              </div>

              <AnimatePresence>
                {calc.showSustainability && (
                  <motion.div
                    initial={{ opacity: 0, y: 8, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 8, scale: 0.97 }}
                    transition={{ duration: 0.25, ease: 'easeOut' }}
                    className="mt-6 flex items-start gap-2 rounded-xl bg-emerald-500/20 border border-emerald-300/30 p-3"
                  >
                    <Sparkles className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-200" />
                    <p className="text-xs text-emerald-50">
                      + €20.000 extra budget beschikbaar (uitsluitend te besteden aan
                      verduurzaming)
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>

              <AnimatePresence>
                {calc.isOverIndebted && (
                  <motion.div
                    initial={{ opacity: 0, y: 8, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 8, scale: 0.97 }}
                    transition={{ duration: 0.25, ease: 'easeOut' }}
                    className="mt-6 flex items-start gap-2 rounded-xl bg-red-500/20 border border-red-300/30 p-3"
                  >
                    <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-200" />
                    <p className="text-xs text-red-50">
                      De opgegeven schulden zijn hoger dan de totale leencapaciteit. De maximale
                      hypotheek is op €0 gezet.
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="mt-6 border-t border-white/15 pt-4">
                <button
                  type="button"
                  onClick={() => setShowAuditTrail((prev) => !prev)}
                  className="flex w-full items-center justify-between gap-3 text-left"
                >
                  <span className="flex items-center gap-2 text-sm font-medium text-blue-100">
                    <Calculator className="h-4 w-4" />
                    Uw rekensom stap voor stap
                  </span>
                  {showAuditTrail ? (
                    <ChevronUp className="h-4 w-4 flex-shrink-0 text-blue-200" />
                  ) : (
                    <ChevronDown className="h-4 w-4 flex-shrink-0 text-blue-200" />
                  )}
                </button>
                <AnimatePresence initial={false}>
                  {showAuditTrail && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.3, ease: 'easeOut' }}
                      className="overflow-hidden"
                    >
                      <ol className="mt-4 space-y-3 text-xs text-blue-100">
                        <li className="rounded-lg bg-white/10 p-3">
                          <p className="font-semibold text-white">1. Toetsinkomen</p>
                          <div className="mt-1.5 space-y-1">
                            <p>
                              {hasPartner2 ? 'Partner 1' : 'Aanvrager'}: {formatEuro(calc.toets1.base)}
                              {calc.toets1.structural > 0 && (
                                <> + {formatEuro(calc.toets1.structural)} structureel</>
                              )}
                              {calc.toets1.alimonyDeduction > 0 && (
                                <> − {formatEuro(calc.toets1.alimonyDeduction)} alimentatie</>
                              )}{' '}
                              = {formatEuro(calc.toets1.toetsinkomen)}
                              {calc.toets1.usesHistory &&
                                calc.toets1.cappedAtLastYear &&
                                ' (gemaximeerd op laatste jaar)'}
                            </p>
                            {hasPartner2 && (
                              <p>
                                Partner 2: {formatEuro(calc.toets2.base)}
                                {calc.toets2.structural > 0 && (
                                  <> + {formatEuro(calc.toets2.structural)} structureel</>
                                )}
                                {calc.toets2.alimonyDeduction > 0 && (
                                  <> − {formatEuro(calc.toets2.alimonyDeduction)} alimentatie</>
                                )}{' '}
                                = {formatEuro(calc.toets2.toetsinkomen)}
                                {calc.toets2.usesHistory &&
                                  calc.toets2.cappedAtLastYear &&
                                  ' (gemaximeerd op laatste jaar)'}
                              </p>
                            )}
                            <p className="font-medium text-white">
                              Gezamenlijk toetsinkomen = {formatEuro(calc.combinedIncome)}
                            </p>
                          </div>
                        </li>
                        <li className="rounded-lg bg-white/10 p-3">
                          <p className="font-semibold text-white">2. Woonquote</p>
                          <p className="mt-1.5">
                            Bij {formatEuro(calc.combinedIncome)} toetsinkomen en{' '}
                            {formatRate(calc.testRate)} toetsrente
                            {calc.toetsrenteApplies &&
                              ' (AFM-toetsrente, hoger dan uw eigen rente)'}
                            : woonquote = {(calc.woonquote * 100).toFixed(1).replace('.', ',')}%
                          </p>
                        </li>
                        <li className="rounded-lg bg-white/10 p-3">
                          <p className="font-semibold text-white">3. Maximale bruto woonlast</p>
                          <p className="mt-1.5">
                            {(calc.woonquote * 100).toFixed(1).replace('.', ',')}% ×{' '}
                            {formatEuro(calc.combinedIncome)} ÷ 12 = {formatEuro(calc.maxWoonlastMonthly)}
                            /mnd
                          </p>
                        </li>
                        {calc.monthlyDebt > 0 && (
                          <li className="rounded-lg bg-white/10 p-3">
                            <p className="font-semibold text-white">4. Schulden maandlast</p>
                            <p className="mt-1.5">
                              {calc.otherDebtMonthly > 0 && (
                                <>
                                  Overige schulden: −{formatEuro(calc.otherDebtMonthly)}/mnd
                                  <br />
                                </>
                              )}
                              {calc.studyDebtMonthly > 0 && (
                                <>
                                  Studieschuld: −{formatEuro(calc.studyDebtMonthly)}/mnd
                                  <br />
                                </>
                              )}
                              {formatEuro(calc.maxWoonlastMonthly)} − {formatEuro(calc.monthlyDebt)} ={' '}
                              {formatEuro(calc.availableMonthly)}/mnd beschikbaar
                            </p>
                          </li>
                        )}
                        <li className="rounded-lg bg-white/10 p-3">
                          <p className="font-semibold text-white">
                            {calc.monthlyDebt > 0 ? '5' : '4'}. Kapitaliseren naar hypotheek
                          </p>
                          <p className="mt-1.5">
                            {formatEuro(calc.availableMonthly)}/mnd × annuïteitenfactor{' '}
                            {calc.annuityFactor.toFixed(1).replace('.', ',')} (360 mnd bij{' '}
                            {formatRate(calc.testRate)}) ={' '}
                            {formatEuro(calc.availableMonthly * calc.annuityFactor)}
                          </p>
                          {calc.pensionBinding && (
                            <p className="mt-1 text-amber-200">
                              De AOW-toets komt met het verwachte pensioeninkomen lager uit (
                              {formatEuro(calc.pensionScenarioMax)}) en is hier bindend in plaats
                              van dit bedrag.
                            </p>
                          )}
                        </li>
                        {calc.energyBonus > 0 && (
                          <li className="rounded-lg bg-white/10 p-3">
                            <p className="font-semibold text-white">Energielabelbonus</p>
                            <p className="mt-1.5">
                              + {formatEuro(calc.energyBonus)} vanwege energielabel {energyLabel}
                            </p>
                          </li>
                        )}
                        <li className="rounded-lg bg-white/15 p-3">
                          <p className="font-semibold text-white">= Hypotheek o.b.v. inkomen</p>
                          <p className="mt-1.5 text-base font-bold text-white">
                            {formatEuro(calc.incomeBasedMax)}
                          </p>
                          {calc.cappedByPropertyValue && (
                            <p className="mt-1 text-amber-200">
                              Begrensd door de aanschafprijs (max. 100% LTV):{' '}
                              {formatEuro(calc.maxMortgage)}
                            </p>
                          )}
                        </li>
                      </ol>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
            </BorderGlow>
          </div>
        </div>

        {!hasExistingHome && (
          <div className="mt-8">
            <SectionCard
              id="sectie-starter-hypotheek"
              title="Maandlasten & samenstelling hypotheek"
              icon={<PiggyBank className="h-4 w-4" />}
              accent="indigo"
            >
              <p className="text-xs text-slate-500">
                Splits uw benodigde hypotheek in maximaal 3 leningdelen, elk met een eigen
                aflosvorm, rente en rentevastperiode, en zie direct uw bruto en netto
                maandlasten. De benodigde hypotheek is de aanschafprijs minus uw ingebrachte
                eigen vermogen, begrensd op uw maximale hypotheek o.b.v. inkomen. Kosten koper
                betaalt u apart uit eigen middelen.
              </p>

              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
                  <span className="text-xs text-slate-400">Benodigde hypotheek</span>
                  <p className="text-lg font-bold text-slate-800">
                    {formatEuro(starterRequiredMortgage)}
                  </p>
                  <span className="text-[11px] text-slate-400">
                    {safeNum(purchasePrice) - calc.totalOwnCapital > calc.maxMortgage
                      ? `Begrensd op max. hypotheek o.b.v. inkomen (${formatEuro(calc.maxMortgage)})`
                      : `Aanschafprijs ${formatEuro(purchasePrice)} − eigen vermogen ${formatEuro(calc.totalOwnCapital)}`}
                  </span>
                </div>
                <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
                  <span className="text-xs text-slate-400">Ingevuld in leningdelen</span>
                  <p
                    className={`text-lg font-bold ${
                      starterLoanCalc.matchesRequired ? 'text-emerald-600' : 'text-slate-800'
                    }`}
                  >
                    {formatEuro(starterLoanCalc.totalPrincipal)}
                  </p>
                  <span className="text-[11px] text-slate-400">
                    {starterLoanCalc.matchesRequired
                      ? 'Sluit aan op de benodigde hypotheek'
                      : `Verschil: ${formatEuro(Math.abs(starterLoanCalc.totalPrincipal - starterRequiredMortgage))}`}
                  </span>
                </div>
              </div>

              <AnimatePresence>
                {starterLoanCalc.exceedsLenderCap && (
                  <motion.div
                    initial={{ opacity: 0, y: 8, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 8, scale: 0.97 }}
                    transition={{ duration: 0.25, ease: 'easeOut' }}
                    className="mt-4"
                  >
                    <StatusBadge status="warning">
                      Let op: uw totale hypotheek voor de nieuwe woning komt uit op{' '}
                      {formatEuro(starterLoanCalc.totalPrincipal)}, boven het ingestelde
                      maximum van {formatEuro(safeNum(lenderCapThreshold))} bij uw
                      geldverstrekker (in te stellen bij "Uw situatie"). Dit kan aanvullende
                      acceptatie-eisen of een ander acceptatietraject betekenen.
                    </StatusBadge>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="mt-5 rounded-2xl border border-indigo-100 bg-indigo-50/40 p-6">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600">
                      <Building2 className="h-4 w-4" />
                    </span>
                    <h3 className="text-sm font-semibold text-slate-700">Leningdelen</h3>
                  </div>
                  <button
                    type="button"
                    onClick={autoDistributeStarterLoan}
                    className="rounded-lg border border-indigo-200 bg-white px-3 py-1.5 text-xs font-medium text-indigo-600 transition-all duration-200 hover:bg-indigo-50"
                  >
                    Automatisch verdelen
                  </button>
                </div>

                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Leningdelen ({starterLoanParts.length}/3)
                  </h4>
                  <button
                    type="button"
                    onClick={addStarterLoanPart}
                    disabled={starterLoanParts.length >= 3}
                    className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-all duration-200 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Leningdeel toevoegen
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {starterLoanParts.map((part, index) => (
                    <AdditionalLoanPartCard
                      key={part.id}
                      part={part}
                      index={index}
                      onChange={(field, value) => updateStarterLoanPart(part.id, field, value)}
                      onRemove={() => removeStarterLoanPart(part.id)}
                      canRemove={starterLoanParts.length > 1}
                    />
                  ))}
                </div>

                <div className="mt-4 rounded-xl border border-slate-100 bg-white p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Aflossingsvrij (max. {aflossingsvrijMaxPct}% van de woningwaarde)
                    </span>
                    <AflossingsvrijMaxToggle
                      value={aflossingsvrijMaxPct}
                      onChange={setAflossingsvrijMaxPct}
                    />
                  </div>
                  <div className="mt-3">
                    <span className="text-xs text-slate-400">
                      Totaal aflossingsvrij / maximum {aflossingsvrijMaxPct}%
                    </span>
                    <p
                      className={`text-sm font-semibold ${
                        starterLoanCalc.withinAflossingsvrijCap ? 'text-slate-800' : 'text-red-600'
                      }`}
                    >
                      {formatEuro(starterLoanCalc.totalAflossingsvrij)} /{' '}
                      {formatEuro(starterLoanCalc.maxAflossingsvrij)}
                    </p>
                  </div>
                  {!starterLoanCalc.withinAflossingsvrijCap && (
                    <p className="mt-2 text-xs text-red-600">
                      Dit overschrijdt de {aflossingsvrijMaxPct}% aflossingsvrij-norm.
                    </p>
                  )}
                </div>

                <div className="mt-4 rounded-xl border border-slate-100 bg-white p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Maandlasten leningdelen
                    </span>
                    <div className="inline-flex rounded-lg border border-slate-100 bg-slate-50 p-1">
                      <button
                        type="button"
                        onClick={() => setStarterViewMode('bruto')}
                        className={`rounded-md px-3 py-2 sm:py-1.5 text-xs font-semibold transition-all duration-200 ${
                          starterViewMode === 'bruto'
                            ? 'bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-sm'
                            : 'text-slate-500 hover:text-slate-700'
                        }`}
                      >
                        Bruto
                      </button>
                      <button
                        type="button"
                        onClick={() => setStarterViewMode('netto')}
                        className={`rounded-md px-3 py-2 sm:py-1.5 text-xs font-semibold transition-all duration-200 ${
                          starterViewMode === 'netto'
                            ? 'bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-sm'
                            : 'text-slate-500 hover:text-slate-700'
                        }`}
                      >
                        Netto
                      </button>
                    </div>
                  </div>

                  {starterViewMode === 'bruto' ? (
                    <DonutChart
                      interestValue={starterLoanCalc.totalInterest}
                      principalValue={starterLoanCalc.totalAflossing}
                      centerLabel="Bruto per maand"
                      centerValue={starterLoanCalc.totalGross}
                    />
                  ) : (
                    <DonutChart
                      interestValue={starterLoanCalc.netInterestComponent}
                      principalValue={starterLoanCalc.totalAflossing}
                      centerLabel="Netto per maand"
                      centerValue={starterLoanCalc.totalNet}
                    />
                  )}

                  {starterViewMode === 'netto' && (
                    <p className="mt-3 text-xs text-slate-400">
                      Belastingvoordeel HRA ({formatRate(starterLoanCalc.hraRate * 100)}):{' '}
                      {formatEuro(starterLoanCalc.taxBenefit)} per maand. Eigenwoningforfait is
                      hier niet apart verwerkt.
                    </p>
                  )}
                </div>
              </div>
            </SectionCard>
          </div>
        )}

        {hasExistingHome && (
        <div id="sectie-huidige-woning" className="mt-8 overflow-hidden rounded-2xl border border-l-4 border-slate-100 border-l-indigo-400 bg-white shadow-xl transition-all duration-200 hover:-translate-y-0.5 hover:shadow-2xl">
          <button
            type="button"
            onClick={() => setShowCurrentMortgage((prev) => !prev)}
            className="flex w-full items-center justify-between p-6 text-left transition-all duration-200 hover:bg-slate-50"
          >
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                <Building2 className="h-4 w-4" />
              </span>
              <div>
                <h2 className="text-base font-semibold text-slate-800">Huidige Hypotheek Analyseren</h2>
                <p className="text-xs text-slate-400">
                  Bereken de actuele maandlasten van uw lopende hypotheek
                </p>
              </div>
            </div>
            {showCurrentMortgage ? (
              <ChevronUp className="h-5 w-5 flex-shrink-0 text-slate-400" />
            ) : (
              <ChevronDown className="h-5 w-5 flex-shrink-0 text-slate-400" />
            )}
          </button>

          <AnimatePresence initial={false}>
            {showCurrentMortgage && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.3, ease: 'easeOut' }}
                className="overflow-hidden"
              >
                <div className="space-y-6 border-t border-slate-100 p-6">
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <div className="sm:col-span-2">
                      <Slider
                        id="marketValue"
                        label="Huidige marktwaarde woning"
                        icon={<Home className="h-3.5 w-3.5 text-slate-400" />}
                        value={marketValue}
                        min={100000}
                        max={2000000}
                        step={5000}
                        onChange={setMarketValue}
                        formatValue={formatEuro}
                      />
                    </div>
                    <div className="flex flex-col justify-center rounded-xl border border-slate-100 bg-slate-50/60 p-4">
                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Huidige LTV
                      </span>
                      <span
                        className={`text-2xl font-bold ${
                          currentMortgage.ltv > 100 ? 'text-red-600' : 'text-slate-800'
                        }`}
                      >
                        {currentMortgage.ltv.toFixed(0)}%
                      </span>
                      <span className="text-xs text-slate-400">
                        Restschuld {formatEuro(currentMortgage.currentDebtBalance)}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50/60 p-4">
                    <div>
                      <span className="text-xs font-medium text-slate-600">
                        Meeneemregeling: hypotheek meenemen naar de nieuwe woning?
                      </span>
                      <p className="text-xs text-slate-400">
                        Bij "ja" gaat de bestaande hypotheek mee tegen de huidige voorwaarden
                        (rente, resterende looptijd) en telt de restschuld mee als "meegenomen
                        hypotheek". Bij "nee" wordt de hypotheek bij verkoop afgelost en
                        financiert u de nieuwe woning volledig opnieuw.
                      </p>
                    </div>
                    <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1">
                      <button
                        type="button"
                        onClick={() => setTakeOverMortgage(true)}
                        className={`rounded-md px-3 py-2 sm:py-1.5 text-xs font-semibold transition-all duration-200 ${
                          takeOverMortgage
                            ? 'bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-sm'
                            : 'text-slate-500 hover:text-slate-700'
                        }`}
                      >
                        Ja, meenemen
                      </button>
                      <button
                        type="button"
                        onClick={() => setTakeOverMortgage(false)}
                        className={`rounded-md px-3 py-2 sm:py-1.5 text-xs font-semibold transition-all duration-200 ${
                          !takeOverMortgage
                            ? 'bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-sm'
                            : 'text-slate-500 hover:text-slate-700'
                        }`}
                      >
                        Nee, aflossen
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50/60 p-4">
                    <div>
                      <span className="text-xs font-medium text-slate-600">
                        Verkoopafslag onverkochte woning
                      </span>
                      <p className="text-xs text-slate-400">
                        Sommige geldverstrekkers tellen de waarde van een nog niet
                        onvoorwaardelijk verkochte woning niet voor 100% mee als onderpand.
                      </p>
                    </div>
                    <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1">
                      <button
                        type="button"
                        onClick={() => setSaleDiscountPercentage(100)}
                        className={`rounded-md px-3 py-2 sm:py-1.5 text-xs font-semibold transition-all duration-200 ${
                          saleDiscountPercentage === 100
                            ? 'bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-sm'
                            : 'text-slate-500 hover:text-slate-700'
                        }`}
                      >
                        100%
                      </button>
                      <button
                        type="button"
                        onClick={() => setSaleDiscountPercentage(95)}
                        className={`rounded-md px-3 py-2 sm:py-1.5 text-xs font-semibold transition-all duration-200 ${
                          saleDiscountPercentage === 95
                            ? 'bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-sm'
                            : 'text-slate-500 hover:text-slate-700'
                        }`}
                      >
                        95%
                      </button>
                    </div>
                  </div>
                  {saleDiscountPercentage < 100 && (
                    <p className="text-xs text-slate-400">
                      Bruikbare verkoopwaarde voor financiering:{' '}
                      {formatEuro(currentMortgage.saleValueForFinancing)} in plaats van{' '}
                      {formatEuro(marketValue)}. Dit verlaagt de bruikbare overwaarde hieronder
                      en de bedragen die daarop verder zijn gebaseerd.
                    </p>
                  )}
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <EnergyLabelPicker
                      id="currentEnergyLabel"
                      label="Huidig energielabel woning"
                      icon={<Leaf className="h-3.5 w-3.5 text-slate-400" />}
                      value={currentEnergyLabel}
                      onChange={setCurrentEnergyLabel}
                    />
                    <CurrencyField
                      id="originalDebt"
                      label="Oorspronkelijke hypotheekschuld"
                      icon={<Euro className="h-3.5 w-3.5 text-slate-400" />}
                      value={originalDebt}
                      onChange={setOriginalDebt}
                      placeholder="675000"
                    />
                    <DateField
                      id="startDate"
                      label="Ingangsdatum hypotheek"
                      icon={<CalendarDays className="h-3.5 w-3.5 text-slate-400" />}
                      value={startDate}
                      onChange={setStartDate}
                      hint="Geldt voor alle leningdelen, deze starten normaliter gelijktijdig"
                    />
                  </div>
                  </div>

                  <div>
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold text-slate-700">
                        Leningdelen ({loanParts.length}/3)
                      </h3>
                      <button
                        type="button"
                        onClick={addLoanPart}
                        disabled={loanParts.length >= 3}
                        className="flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition-all duration-200 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Leningdeel toevoegen
                      </button>
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {loanParts.map((part, index) => (
                        <LoanPartCard
                          key={part.id}
                          part={part}
                          index={index}
                          onChange={(field, value) => updateLoanPart(part.id, field, value)}
                          onRemove={() => removeLoanPart(part.id)}
                          canRemove={loanParts.length > 1}
                          elapsedMonths={elapsedMonthsSinceStart}
                        />
                      ))}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-100 bg-gradient-to-br from-slate-50 to-blue-50 p-6">
                    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                      <h3 className="text-sm font-semibold text-slate-700">Maandlasten overzicht</h3>
                      <div className="inline-flex rounded-lg border border-slate-100 bg-white p-1 shadow-sm">
                        <button
                          type="button"
                          onClick={() => setViewMode('bruto')}
                          className={`rounded-md px-3 py-2 sm:py-1.5 text-xs font-semibold transition-all duration-200 ${
                            viewMode === 'bruto'
                              ? 'bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-sm'
                              : 'text-slate-500 hover:text-slate-700'
                          }`}
                        >
                          Bruto
                        </button>
                        <button
                          type="button"
                          onClick={() => setViewMode('netto')}
                          className={`rounded-md px-3 py-2 sm:py-1.5 text-xs font-semibold transition-all duration-200 ${
                            viewMode === 'netto'
                              ? 'bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-sm'
                              : 'text-slate-500 hover:text-slate-700'
                          }`}
                        >
                          Netto
                        </button>
                      </div>
                    </div>

                    {viewMode === 'bruto' ? (
                      <DonutChart
                        interestValue={currentMortgage.totalInterest}
                        principalValue={currentMortgage.totalPrincipal}
                        centerLabel="Bruto per maand"
                        centerValue={currentMortgage.totalGross}
                      />
                    ) : (
                      <DonutChart
                        interestValue={currentMortgage.netInterestComponent}
                        principalValue={currentMortgage.totalPrincipal}
                        centerLabel="Netto per maand"
                        centerValue={currentMortgage.totalNet}
                      />
                    )}

                    {viewMode === 'netto' && (
                      <div className="mt-5 space-y-3">
                        <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-100 bg-white p-4 text-xs text-slate-500 sm:grid-cols-3">
                          <div className="flex items-center justify-between sm:flex-col sm:items-start sm:gap-1">
                            <span>
                              Belastingvoordeel HRA ({formatRate(currentMortgage.hraRate * 100)})
                            </span>
                            <span className="font-semibold text-slate-700">
                              {formatEuro(currentMortgage.taxBenefit)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between sm:flex-col sm:items-start sm:gap-1">
                            <span>Correctie eigenwoningforfait</span>
                            <span className="font-semibold text-slate-700">
                              -{formatEuro(currentMortgage.ewfMonthly)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between sm:flex-col sm:items-start sm:gap-1">
                            <span>Netto belastingvoordeel</span>
                            <span className="font-semibold text-slate-700">
                              {formatEuro(currentMortgage.netTaxBenefit)}
                            </span>
                          </div>
                        </div>
                        <label
                          htmlFor="includeEwfInNetCalc"
                          className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-3 text-xs text-slate-600"
                        >
                          <input
                            id="includeEwfInNetCalc"
                            type="checkbox"
                            checked={includeEwfInNetCalc}
                            onChange={(e) => setIncludeEwfInNetCalc(e.target.checked)}
                            className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                          />
                          <span>
                            Eigenwoningforfait meenemen in de netto berekening
                            <span className="block text-[11px] text-slate-400">
                              Standaard uit: het eigenwoningforfait is een fiscale bijtelling die
                              uw netto belastingvoordeel iets verlaagt. Vinkt u dit aan, dan wordt
                              die correctie hierboven en in de scenario-analyse verwerkt.
                            </span>
                          </span>
                        </label>
                      </div>
                    )}

                    <AnimatePresence>
                      {currentMortgage.hasAflossingsvrij && (
                        <motion.div
                          initial={{ opacity: 0, y: 8, scale: 0.97 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: 8, scale: 0.97 }}
                          transition={{ duration: 0.25, ease: 'easeOut' }}
                          className="mt-5"
                        >
                          <InlineNote className="mt-0">
                            Geen verplichte aflossing, maar ook geen hypotheekrenteaftrek als dit
                            deel na 2013 is afgesloten (tenzij overgangsrecht).
                          </InlineNote>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    <AnimatePresence>
                      {currentMortgage.hasExpiringFixedPeriod && (
                        <motion.div
                          initial={{ opacity: 0, y: 8, scale: 0.97 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: 8, scale: 0.97 }}
                          transition={{ duration: 0.25, ease: 'easeOut' }}
                          className="mt-3"
                        >
                          <StatusBadge status="warning">
                            Let op:{' '}
                            {currentMortgage.partsWithExpiringFixedPeriod.length === 1
                              ? 'één leningdeel heeft'
                              : `${currentMortgage.partsWithExpiringFixedPeriod.length} leningdelen hebben`}{' '}
                            een rentevastperiode die binnen 2 jaar afloopt. Houd rekening met een
                            mogelijk hogere rente bij het opnieuw vastzetten.
                          </StatusBadge>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

        <div id="sectie-bijleenruimte" className="mt-8 overflow-hidden rounded-2xl border border-l-4 border-slate-100 border-l-emerald-400 bg-white shadow-xl transition-all duration-200 hover:-translate-y-0.5 hover:shadow-2xl">
          <button
            type="button"
            onClick={() => setShowBijleenruimte((prev) => !prev)}
            className="flex w-full items-center justify-between p-6 text-left transition-all duration-200 hover:bg-slate-50"
          >
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600">
                <TrendingUp className="h-4 w-4" />
              </span>
              <div>
                <h2 className="text-base font-semibold text-slate-800">Extra bijleenruimte bij verkoop huidige woning</h2>
                <p className="text-xs text-slate-400">Financieringsgat en werkelijke leencapaciteit bij verkoop</p>
              </div>
            </div>
            {showBijleenruimte ? (
              <ChevronUp className="h-5 w-5 flex-shrink-0 text-slate-400" />
            ) : (
              <ChevronDown className="h-5 w-5 flex-shrink-0 text-slate-400" />
            )}
          </button>
          <AnimatePresence initial={false}>
            {showBijleenruimte && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.3, ease: 'easeOut' }}
                className="overflow-hidden"
              >
                <div className="space-y-4 border-t border-slate-100 p-6">
                    <p className="mb-4 text-xs text-slate-500">
                      Uitgangspunt: u verkoopt de huidige woning tegen de huidige marktwaarde en
                      zet de volledige verkoopopbrengst, inclusief de overwaarde, in voor de
                      aankoop van de beoogde woning.
                    </p>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                      <div>
                        <span className="text-xs text-slate-400">Leencapaciteit o.b.v. inkomen</span>
                        <p className="text-lg font-semibold text-slate-800">
                          {formatEuro(calc.incomeBasedMax)}
                        </p>
                      </div>
                      <div>
                        <span className="text-xs text-slate-400">
                          Werkelijke leencapaciteit
                        </span>
                        <p
                          className={`text-lg font-semibold ${
                            currentMortgage.hasRateRiskOnPortedDebt
                              ? 'text-amber-600'
                              : 'text-slate-800'
                          }`}
                        >
                          {formatEuro(currentMortgage.effectiveMaxMortgage)}
                        </p>
                        {currentMortgage.hasRateRiskOnPortedDebt && (
                          <span className="text-[11px] text-amber-600">Na renterisicocorrectie</span>
                        )}
                      </div>
                      <div>
                        <span className="text-xs text-slate-400">Huidige hypotheekschuld</span>
                        <p className="text-lg font-semibold text-slate-800">
                          {formatEuro(currentMortgage.currentDebtBalance)}
                        </p>
                      </div>
                      <div>
                        <span className="text-xs text-slate-400">Overwaarde huidige woning</span>
                        <p
                          className={`text-lg font-semibold ${
                            currentMortgage.overwaarde < 0 ? 'text-red-600' : 'text-slate-800'
                          }`}
                        >
                          {formatEuro(currentMortgage.overwaarde)}
                        </p>
                      </div>
                    </div>

                    <AnimatePresence>
                      {currentMortgage.restschuldTekort > 0 && (
                        <motion.div
                          initial={{ opacity: 0, y: 8, scale: 0.97 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: 8, scale: 0.97 }}
                          transition={{ duration: 0.25, ease: 'easeOut' }}
                          className="mt-4"
                        >
                          <StatusBadge status="warning">
                            Onderwaarde: de huidige marktwaarde
                            {saleDiscountPercentage < 100
                              ? ` (na verkoopafslag ${formatEuro(currentMortgage.saleValueForFinancing)})`
                              : ''}{' '}
                            ligt onder de restschuld van{' '}
                            {formatEuro(currentMortgage.currentDebtBalance)}. Bij verkoop blijft er
                            een restschuld-tekort van{' '}
                            <span className="font-semibold">
                              {formatEuro(currentMortgage.restschuldTekort)}
                            </span>{' '}
                            staan dat moet worden afgelost. Dit tekort is meegenomen in het
                            financieringsgat en de benodigde aanvullende hypotheek hieronder;
                            in de praktijk verlangen geldverstrekkers vaak dat u dit uit eigen
                            middelen voldoet.
                          </StatusBadge>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    <AnimatePresence>
                      {currentMortgage.hasRateRiskOnPortedDebt && (
                        <motion.div
                          initial={{ opacity: 0, y: 8, scale: 0.97 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: 8, scale: 0.97 }}
                          transition={{ duration: 0.25, ease: 'easeOut' }}
                          className="mt-4"
                        >
                          <InlineNote className="mt-0">
                            Een deel van uw mee te nemen hypotheek heeft een rentevastperiode
                            korter dan 10 jaar tegen een rente onder de AFM-toetsrente van{' '}
                            {formatRate(TOETSRENTE)}. Voor de leencapaciteit wordt dit deel
                            getoetst tegen de toetsrente in plaats van de daadwerkelijke, lagere
                            rente. Dit verlaagt uw leencapaciteit met{' '}
                            {formatEuro(currentMortgage.rateRiskCapacityHaircut)}, van{' '}
                            {formatEuro(calc.incomeBasedMax)} naar een werkelijke leencapaciteit
                            van {formatEuro(currentMortgage.effectiveMaxMortgage)}. Dit werkt
                            door in uw bijleenruimte, het financieringsgat en de resterende
                            aanvullende hypotheek hieronder.
                          </InlineNote>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50/60 p-4">
                      <div>
                        <span className="text-xs font-medium text-slate-600">
                          Eigen inleg voor dit financieringsgat limiteren?
                        </span>
                        <p className="text-xs text-slate-400">
                          Standaard wordt al uw beschikbare eigen vermogen ingezet om het gat
                          te dichten. Zet aan als u zelf niet meer dan een bepaald bedrag wilt
                          inleggen (excl. kosten koper) — het restant moet dan via een hogere
                          aanvullende hypotheek of andere bron komen.
                        </p>
                      </div>
                      <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1">
                        <button
                          type="button"
                          onClick={() => setLimitOwnContribution(false)}
                          className={`rounded-md px-3 py-2 sm:py-1.5 text-xs font-semibold transition-all duration-200 ${
                            !limitOwnContribution
                              ? 'bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-sm'
                              : 'text-slate-500 hover:text-slate-700'
                          }`}
                        >
                          Nee
                        </button>
                        <button
                          type="button"
                          onClick={() => setLimitOwnContribution(true)}
                          className={`rounded-md px-3 py-2 sm:py-1.5 text-xs font-semibold transition-all duration-200 ${
                            limitOwnContribution
                              ? 'bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-sm'
                              : 'text-slate-500 hover:text-slate-700'
                          }`}
                        >
                          Ja
                        </button>
                      </div>
                    </div>
                    {limitOwnContribution && (
                      <CurrencyField
                        id="desiredMaxOwnContribution"
                        label="Gewenste maximale eigen inleg (ex kosten koper)"
                        icon={<PiggyBank className="h-3.5 w-3.5 text-slate-400" />}
                        value={desiredMaxOwnContribution}
                        onChange={setDesiredMaxOwnContribution}
                        placeholder="0"
                      />
                    )}

                    <div className="mt-5 rounded-xl border border-slate-100 bg-white p-4">
                      <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Financieringsgat beoogde woning
                        <InfoTooltip text="Het verschil tussen de aanschafprijs van de beoogde woning en wat u al heeft: de meegenomen hypotheek plus de overwaarde. Dit gat moet u dekken met eigen vermogen en/of een aanvullende hypotheek." />
                      </span>
                      <p className="mt-1 text-xs text-slate-400">
                        {takeOverMortgage
                          ? 'Bij verkoop wordt de bestaande hypotheek meegenomen tegen de oude voorwaarden en komt de overwaarde daarnaast vrij als eigen inbreng.'
                          : 'Bij verkoop wordt de bestaande hypotheek volledig afgelost; alleen de overwaarde komt vrij als eigen inbreng en de nieuwe woning wordt volledig opnieuw gefinancierd.'}
                      </p>
                      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        <div>
                          <span className="text-xs text-slate-400">Aanschafprijs beoogde woning</span>
                          <p className="text-sm font-semibold text-slate-800">
                            {formatEuro(purchasePrice)}
                          </p>
                        </div>
                        <div>
                          <span className="text-xs text-slate-400">Eigen middelen (vermogen)</span>
                          <p className="text-sm font-semibold text-slate-800">
                            {formatEuro(calc.totalOwnCapital)}
                          </p>
                        </div>
                        <div>
                          <span className="text-xs text-slate-400">Eigen middelen (overwaarde)</span>
                          <p className="text-sm font-semibold text-slate-800">
                            {formatEuro(currentMortgage.usableOverwaarde)}
                          </p>
                        </div>
                        <div>
                          <span className="text-xs text-slate-400">
                            Overdrachtsbelasting ({calc.transferTaxInfo.shortLabel})
                          </span>
                          <p className="text-sm font-semibold text-slate-800">
                            {formatEuro(newHomeCalc.transferTax)}
                          </p>
                        </div>
                        <div>
                          <span className="text-xs text-slate-400">Overige kosten koper</span>
                          <p className="text-sm font-semibold text-slate-800">
                            {formatEuro(newHomeCalc.otherCosts)}
                          </p>
                          <span className="text-[11px] text-slate-400">
                            Notaris, taxatie, advies e.d. — zie de kaart Kosten koper
                          </span>
                        </div>
                        <div>
                          <span className="text-xs text-slate-400">Werkelijke leencapaciteit</span>
                          <p
                            className={`text-sm font-semibold ${
                              currentMortgage.hasRateRiskOnPortedDebt
                                ? 'text-amber-600'
                                : 'text-slate-800'
                            }`}
                          >
                            {formatEuro(currentMortgage.effectiveMaxMortgage)}
                          </p>
                          {currentMortgage.hasRateRiskOnPortedDebt && (
                            <span className="text-[11px] text-amber-600">
                              O.b.v. inkomen {formatEuro(calc.incomeBasedMax)}, min{' '}
                              {formatEuro(currentMortgage.rateRiskCapacityHaircut)}{' '}
                              renterisicocorrectie
                            </span>
                          )}
                        </div>
                        <div>
                          <span className="text-xs text-slate-400">Mee te nemen hypotheek</span>
                          <p className="text-sm font-semibold text-slate-800">
                            {formatEuro(combinedGapCalc.portedDebt)}
                          </p>
                          {!takeOverMortgage && (
                            <span className="text-[11px] text-slate-400">
                              Niet meegenomen: wordt bij verkoop afgelost
                            </span>
                          )}
                        </div>
                        {currentMortgage.restschuldTekort > 0 && (
                          <div>
                            <span className="text-xs text-slate-400">
                              Restschuld-tekort na verkoop
                            </span>
                            <p className="text-sm font-semibold text-red-600">
                              +{formatEuro(currentMortgage.restschuldTekort)}
                            </p>
                            <span className="text-[11px] text-red-500">
                              Verhoogt het financieringsgat
                            </span>
                          </div>
                        )}
                      </div>

                      {combinedGapCalc.gap > 0 ? (
                        <>
                          <div className="mt-4 flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-4 py-3">
                            <span className="text-sm text-slate-600">Financieringsgat</span>
                            <span className="text-xl font-bold text-slate-900">
                              {formatEuro(combinedGapCalc.gap)}
                            </span>
                          </div>
                          <p className="mt-2 text-xs text-slate-400">
                            Aanschafprijs minus de mee te nemen hypotheek minus de overwaarde. Dit
                            gat moet u financieren via een aanvullende hypotheek of zelf extra
                            inleggen. Overdrachtsbelasting en overige kosten koper (indicatief{' '}
                            {formatEuro(newHomeCalc.transferTax + newHomeCalc.otherCosts)}) komen
                            hier nog los bovenop en zijn niet in dit gat verwerkt.
                          </p>

                          <div className="mt-4">
                            <span className="text-xs text-slate-400">
                              Gedekt door inbreng eigen vermogen
                            </span>
                            <p className="text-sm font-semibold text-slate-800">
                              {formatEuro(combinedGapCalc.ownCapitalApplied)}
                            </p>
                            {limitOwnContribution &&
                              combinedGapCalc.ownCapitalApplied >= combinedGapCalc.ownContributionCap && (
                                <span className="text-[11px] text-slate-400">
                                  Begrensd op uw ingestelde maximum van{' '}
                                  {formatEuro(combinedGapCalc.ownContributionCap)}
                                </span>
                              )}
                          </div>

                          <div className="mt-3 flex items-center justify-between rounded-xl border-2 border-indigo-200 bg-indigo-50 px-5 py-4">
                            <span className="text-sm font-medium text-indigo-900">
                              Resterende aanvullende hypotheek
                            </span>
                            <span className="text-2xl font-bold text-indigo-700">
                              {formatEuro(combinedGapCalc.additionalMortgage)}
                            </span>
                          </div>

                          {combinedGapCalc.exceedsLenderCap && (
                            <div className="mt-3">
                              <StatusBadge status="warning">
                                Let op: uw totale hypotheek na verhuizing (meegenomen plus
                                aanvullend) komt uit op{' '}
                                {formatEuro(combinedGapCalc.totalMortgageAfterMove)}, boven het
                                door u ingestelde maximum van{' '}
                                {formatEuro(safeNum(lenderCapThreshold))} bij uw geldverstrekker
                                (aan te passen bij "Uw situatie").
                              </StatusBadge>
                            </div>
                          )}

                          <div className="mt-4 rounded-xl border border-slate-100 bg-white p-4">
                            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                              Ruimte voor de aanvullende hypotheek
                            </span>
                            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                              <div>
                                <span className="text-xs text-slate-400">O.b.v. inkomen (Nibud)</span>
                                <p className="text-sm font-semibold text-slate-800">
                                  {formatEuro(currentMortgage.extraBorrowCapacity)}
                                </p>
                              </div>
                              <div>
                                <span className="text-xs text-slate-400">
                                  O.b.v. uw geldverstrekkersmaximum
                                </span>
                                <p className="text-sm font-semibold text-slate-800">
                                  {formatEuro(combinedGapCalc.lenderCapRoom)}
                                </p>
                              </div>
                              <div>
                                <span className="text-xs text-slate-400">
                                  Bindend (laagste van de twee)
                                </span>
                                <p
                                  className={`text-sm font-semibold ${
                                    combinedGapCalc.bindingCapIsLender
                                      ? 'text-amber-600'
                                      : 'text-slate-800'
                                  }`}
                                >
                                  {formatEuro(combinedGapCalc.additionalMortgageCapacity)}
                                </p>
                                {combinedGapCalc.bindingCapIsLender && (
                                  <span className="text-[11px] text-amber-600">
                                    Uw geldverstrekkersmaximum knelt hier, niet uw inkomen
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          {combinedGapCalc.withinCapacity ? (
                            <div className="mt-4">
                              <StatusBadge status="success">
                                Haalbaar: de aanvullende hypotheek past binnen{' '}
                                {combinedGapCalc.bindingCapIsLender
                                  ? 'uw ingestelde geldverstrekkersmaximum'
                                  : 'uw bijleenruimte o.b.v. inkomen'}
                                , met nog {formatEuro(combinedGapCalc.capacityMargin)} marge.
                              </StatusBadge>
                            </div>
                          ) : (
                            <div className="mt-4 space-y-3">
                              <StatusBadge status={combinedGapCalc.withinCapacityAfterFamilyLoan ? 'warning' : 'error'}>
                                {combinedGapCalc.bindingCapIsLender
                                  ? 'Uw ingestelde geldverstrekkersmaximum'
                                  : 'Uw bijleenruimte o.b.v. inkomen'}{' '}
                                is {formatEuro(combinedGapCalc.shortfallBeforeFamilyLoan)} te
                                krap voor deze aanvullende hypotheek.
                                {combinedGapCalc.familyLoanApplied > 0
                                  ? ` Met de familielening hieronder van ${formatEuro(
                                      combinedGapCalc.familyLoanApplied
                                    )} is dit ${
                                      combinedGapCalc.withinCapacityAfterFamilyLoan
                                        ? 'wel haalbaar.'
                                        : `nog steeds ${formatEuro(
                                            combinedGapCalc.remainingShortfall
                                          )} te weinig.`
                                    }`
                                  : ' Verhoog de inbreng eigen vermogen, verlaag de gewenste aanschafprijs, of vul het gat met een tijdelijke familielening hieronder.'}
                              </StatusBadge>

                              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50/60 p-4">
                                <div>
                                  <span className="text-xs font-medium text-slate-600">
                                    Tijdelijke familielening gebruiken?
                                  </span>
                                  <p className="text-xs text-slate-400">
                                    Een onderhandse, tijdelijke lening (bv. van familie) om dit
                                    gat te overbruggen — bijvoorbeeld totdat uw tweede woning
                                    verkocht is en u daar (anders dan bij uw huidige woning) geen
                                    bancair overbruggingskrediet op kunt krijgen. Leg rente en
                                    aflossing altijd schriftelijk vast (zie toelichting hieronder).
                                  </p>
                                </div>
                                <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1">
                                  <button
                                    type="button"
                                    onClick={() => setUseFamilyLoan(false)}
                                    className={`rounded-md px-3 py-2 sm:py-1.5 text-xs font-semibold transition-all duration-200 ${
                                      !useFamilyLoan
                                        ? 'bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-sm'
                                        : 'text-slate-500 hover:text-slate-700'
                                    }`}
                                  >
                                    Nee
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setUseFamilyLoan(true)}
                                    className={`rounded-md px-3 py-2 sm:py-1.5 text-xs font-semibold transition-all duration-200 ${
                                      useFamilyLoan
                                        ? 'bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-sm'
                                        : 'text-slate-500 hover:text-slate-700'
                                    }`}
                                  >
                                    Ja
                                  </button>
                                </div>
                              </div>

                              {useFamilyLoan && (
                                <>
                                  <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                                    <CurrencyField
                                      id="familyLoanAmount"
                                      label="Bedrag familielening"
                                      icon={<Euro className="h-3.5 w-3.5 text-slate-400" />}
                                      value={familyLoanAmount}
                                      onChange={setFamilyLoanAmount}
                                      placeholder={String(
                                        Math.round(combinedGapCalc.shortfallBeforeFamilyLoan)
                                      )}
                                      hint="Standaard genoeg om het resterende gat te dichten; meer heeft geen extra effect hier."
                                    />
                                    <Slider
                                      id="familyLoanRate"
                                      label="Rente familielening"
                                      icon={<Percent className="h-3.5 w-3.5 text-slate-400" />}
                                      value={familyLoanRate}
                                      min={0}
                                      max={6}
                                      step={0.1}
                                      onChange={setFamilyLoanRate}
                                      formatValue={formatRate}
                                    />
                                  </div>
                                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                    <div>
                                      <span className="text-xs text-slate-400">
                                        Toegepast op het gat
                                      </span>
                                      <p className="text-sm font-semibold text-slate-800">
                                        {formatEuro(combinedGapCalc.familyLoanApplied)}
                                      </p>
                                    </div>
                                    <div>
                                      <span className="text-xs text-slate-400">
                                        Maandlast familielening (indicatief)
                                      </span>
                                      <p className="text-sm font-semibold text-slate-800">
                                        {formatEuro(combinedGapCalc.familyLoanMonthlyInterest)}
                                      </p>
                                      <span className="text-[11px] text-slate-400">
                                        Alleen rente, geen aflossingsaanname
                                      </span>
                                    </div>
                                  </div>
                                  {combinedGapCalc.withinCapacityAfterFamilyLoan ? (
                                    <StatusBadge status="success">
                                      Haalbaar met familielening: samen met uw bijleenruimte dekt
                                      dit het financieringsgat volledig.
                                    </StatusBadge>
                                  ) : (
                                    <StatusBadge status="error">
                                      Nog steeds {formatEuro(combinedGapCalc.remainingShortfall)}{' '}
                                      te weinig, ook met deze familielening.
                                    </StatusBadge>
                                  )}
                                  <p className="text-xs text-slate-400">
                                    Let op: de meeste geldverstrekkers willen weten van een
                                    familielening en wegen deze mee als schuld, tenzij schriftelijk
                                    is vastgelegd dat er geen aflossingsverplichting geldt binnen de
                                    toetsperiode. Zonder een reële rente-/aflossingsafspraak op
                                    papier kan de Belastingdienst dit bovendien als schenking
                                    aanmerken (schenkbelasting). Dit is geen persoonlijk financieel
                                    of fiscaal advies — raadpleeg hiervoor een adviseur of notaris.
                                  </p>
                                </>
                              )}
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="mt-4">
                          <StatusBadge status="success">
                            Geen financieringsgat: de meegenomen hypotheek en overwaarde samen
                            dekken de aanschafprijs volledig, met {formatEuro(combinedGapCalc.surplus)}{' '}
                            overschot. Overdrachtsbelasting en overige kosten koper (indicatief{' '}
                            {formatEuro(newHomeCalc.transferTax + newHomeCalc.otherCosts)}) gaan
                            hier nog wel vanaf.
                          </StatusBadge>
                        </div>
                      )}
                    </div>

                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div id="sectie-aanvullende-hypotheek" className="mt-8 overflow-hidden rounded-2xl border border-l-4 border-slate-100 border-l-indigo-400 bg-white shadow-xl transition-all duration-200 hover:-translate-y-0.5 hover:shadow-2xl">
          <button
            type="button"
            onClick={() => setShowAanvullendeHypotheek((prev) => !prev)}
            className="flex w-full items-center justify-between p-6 text-left transition-all duration-200 hover:bg-slate-50"
          >
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600">
                <Building2 className="h-4 w-4" />
              </span>
              <div>
                <h2 className="text-base font-semibold text-slate-800">Aanvullende hypotheek</h2>
                <p className="text-xs text-slate-400">Toets de resterende aanvullende hypotheek in leningdelen</p>
              </div>
            </div>
            {showAanvullendeHypotheek ? (
              <ChevronUp className="h-5 w-5 flex-shrink-0 text-slate-400" />
            ) : (
              <ChevronDown className="h-5 w-5 flex-shrink-0 text-slate-400" />
            )}
          </button>
          <AnimatePresence initial={false}>
            {showAanvullendeHypotheek && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.3, ease: 'easeOut' }}
                className="overflow-hidden"
              >
                <div className="space-y-4 border-t border-slate-100 p-6">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <p className="text-xs text-slate-500">
                      De resterende aanvullende hypotheek van{' '}
                      {formatEuro(combinedGapCalc.additionalMortgage)} hierboven kunt u hier
                      opsplitsen in maximaal 2 nieuwe leningdelen, elk met een eigen aflosvorm,
                      rekenrente en rentevastperiode, om te toetsen of dit bedrag ook
                      daadwerkelijk geleend kan worden tegen de huidige normen.
                    </p>
                    <button
                      type="button"
                      onClick={autoDistributeAdditionalLoan}
                      className="flex-shrink-0 rounded-lg border border-indigo-200 bg-white px-3 py-1.5 text-xs font-medium text-indigo-600 transition-all duration-200 hover:bg-indigo-50"
                    >
                      Automatisch verdelen
                    </button>
                  </div>
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Nieuwe leningdelen ({additionalLoanParts.length}/2)
                        </h4>
                        <button
                          type="button"
                          onClick={addAdditionalLoanPart}
                          disabled={additionalLoanParts.length >= 2}
                          className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-all duration-200 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Leningdeel toevoegen
                        </button>
                      </div>
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        {additionalLoanParts.map((part, index) => (
                          <AdditionalLoanPartCard
                            key={part.id}
                            part={part}
                            index={index}
                            onChange={(field, value) =>
                              updateAdditionalLoanPart(part.id, field, value)
                            }
                            onRemove={() => removeAdditionalLoanPart(part.id)}
                            canRemove={additionalLoanParts.length > 1}
                          />
                        ))}
                      </div>
                      {!additionalLoanCalc.matchesRequiredAmount && (
                        <p className="mt-3 text-xs text-amber-600">
                          Let op: de som van de nieuwe leningdelen (
                          {formatEuro(additionalLoanCalc.totalPrincipal)}) wijkt af van de
                          benodigde {formatEuro(combinedGapCalc.additionalMortgage)}.
                        </p>
                      )}
                      {additionalLoanCalc.bijleenregelingRisk && (
                        <div className="mt-3">
                          <StatusBadge status="warning">
                            Bijleenregeling: u leent {formatEuro(additionalLoanCalc.excessOverGap)}{' '}
                            meer dan het financieringsgat vereist, terwijl er overwaarde is. Uw
                            eigenwoningreserve wordt dan niet volledig herinvesteerd — de rente
                            over dit extra geleende deel is naar verwachting niet aftrekbaar via
                            de hypotheekrenteaftrek. Vraag uw adviseur naar de exacte gevolgen
                            voor uw situatie.
                          </StatusBadge>
                        </div>
                      )}

                      <div className="mt-5 rounded-xl border border-slate-100 bg-white p-4">
                        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Nieuwe hypotheek en LTV na aankoop
                        </span>
                        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                          <div>
                            <span className="text-xs text-slate-400">Meegenomen leningdelen</span>
                            <p className="text-sm font-semibold text-slate-800">
                              {formatEuro(currentMortgage.currentDebtBalance)}
                            </p>
                          </div>
                          <div>
                            <span className="text-xs text-slate-400">Nieuwe leningdelen</span>
                            <p className="text-sm font-semibold text-slate-800">
                              {formatEuro(additionalLoanCalc.totalPrincipal)}
                            </p>
                          </div>
                          <div>
                            <span className="text-xs text-slate-400">
                              Totale hypotheek nieuwe woning
                            </span>
                            <p
                              className={`text-sm font-semibold ${
                                additionalLoanCalc.exceedsLenderCap
                                  ? 'text-amber-600'
                                  : 'text-slate-800'
                              }`}
                            >
                              {formatEuro(additionalLoanCalc.totalDebtAfterMove)}
                            </p>
                          </div>
                          <div>
                            <span className="text-xs text-slate-400">Nieuwe LTV</span>
                            <p
                              className={`text-sm font-semibold ${
                                additionalLoanCalc.newLtv > 100 ? 'text-red-600' : 'text-slate-800'
                              }`}
                            >
                              {additionalLoanCalc.newLtv.toFixed(0)}%
                            </p>
                          </div>
                        </div>
                        {additionalLoanCalc.exceedsLenderCap && (
                          <p className="mt-3 flex items-start gap-1.5 text-xs text-amber-600">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                            Boven het ingestelde maximum van{' '}
                            {formatEuro(safeNum(lenderCapThreshold))} bij uw geldverstrekker
                            (aan te passen bij "Uw situatie"), mogelijk aanvullende
                            acceptatie-eisen.
                          </p>
                        )}
                      </div>

                      <div className="mt-4 rounded-xl border border-slate-100 bg-white p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Aflossingsvrij (max. {aflossingsvrijMaxPct}% van de woningwaarde)
                          </span>
                          <AflossingsvrijMaxToggle
                            value={aflossingsvrijMaxPct}
                            onChange={setAflossingsvrijMaxPct}
                          />
                        </div>
                        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                          <div>
                            <span className="text-xs text-slate-400">Meegenomen aflossingsvrij</span>
                            <p className="text-sm font-semibold text-slate-800">
                              {formatEuro(additionalLoanCalc.portedAflossingsvrij)}
                            </p>
                          </div>
                          <div>
                            <span className="text-xs text-slate-400">Nieuw aflossingsvrij</span>
                            <p className="text-sm font-semibold text-slate-800">
                              {formatEuro(additionalLoanCalc.newAflossingsvrij)}
                            </p>
                          </div>
                          <div>
                            <span className="text-xs text-slate-400">
                              Totaal / maximum {aflossingsvrijMaxPct}%
                            </span>
                            <p
                              className={`text-sm font-semibold ${
                                additionalLoanCalc.withinAflossingsvrijCap
                                  ? 'text-slate-800'
                                  : 'text-red-600'
                              }`}
                            >
                              {formatEuro(additionalLoanCalc.totalAflossingsvrij)} /{' '}
                              {formatEuro(additionalLoanCalc.maxAflossingsvrij)}
                            </p>
                          </div>
                        </div>
                        {!additionalLoanCalc.withinAflossingsvrijCap ? (
                          <p className="mt-2 text-xs text-red-600">
                            Dit overschrijdt de {aflossingsvrijMaxPct}% aflossingsvrij-norm.
                          </p>
                        ) : (
                          additionalLoanCalc.aflossingsvrijRoomRemaining > 0 && (
                            <p className="mt-2 text-xs text-slate-400">
                              Nog {formatEuro(additionalLoanCalc.aflossingsvrijRoomRemaining)}{' '}
                              ruimte beschikbaar voor aflossingsvrije financiering in het nieuwe
                              deel, bovenop de meegenomen leningdelen.
                            </p>
                          )
                        )}
                      </div>

                      <div className="mt-4 rounded-xl border border-slate-100 bg-white p-4">
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Maandlasten nieuwe leningdelen
                          </span>
                          <div className="inline-flex rounded-lg border border-slate-100 bg-slate-50 p-1">
                            <button
                              type="button"
                              onClick={() => setAdditionalViewMode('bruto')}
                              className={`rounded-md px-3 py-2 sm:py-1.5 text-xs font-semibold transition-all duration-200 ${
                                additionalViewMode === 'bruto'
                                  ? 'bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-sm'
                                  : 'text-slate-500 hover:text-slate-700'
                              }`}
                            >
                              Bruto
                            </button>
                            <button
                              type="button"
                              onClick={() => setAdditionalViewMode('netto')}
                              className={`rounded-md px-3 py-2 sm:py-1.5 text-xs font-semibold transition-all duration-200 ${
                                additionalViewMode === 'netto'
                                  ? 'bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-sm'
                                  : 'text-slate-500 hover:text-slate-700'
                              }`}
                            >
                              Netto
                            </button>
                          </div>
                        </div>

                        {additionalViewMode === 'bruto' ? (
                          <DonutChart
                            interestValue={additionalLoanCalc.totalInterest}
                            principalValue={additionalLoanCalc.totalAflossing}
                            centerLabel="Bruto per maand"
                            centerValue={additionalLoanCalc.totalGross}
                          />
                        ) : (
                          <DonutChart
                            interestValue={additionalLoanCalc.netInterestComponent}
                            principalValue={additionalLoanCalc.totalAflossing}
                            centerLabel="Netto per maand"
                            centerValue={additionalLoanCalc.totalNet}
                          />
                        )}

                        {additionalViewMode === 'netto' && (
                          <p className="mt-3 text-xs text-slate-400">
                            Belastingvoordeel HRA ({formatRate(additionalLoanCalc.hraRate * 100)}):{' '}
                            {formatEuro(additionalLoanCalc.taxBenefit)} per maand.
                            Eigenwoningforfait is hier niet apart verwerkt, aangezien
                            dat een eigenschap is van de hele woning en niet van dit ene
                            leningdeel.
                          </p>
                        )}
                      </div>

                      <AnimatePresence>
                        {additionalLoanCalc.hasRateRisk && (
                          <motion.div
                            initial={{ opacity: 0, y: 8, scale: 0.97 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 8, scale: 0.97 }}
                            transition={{ duration: 0.25, ease: 'easeOut' }}
                            className="mt-4"
                          >
                            <InlineNote className="mt-0">
                              Voor de leencapaciteitstoets hieronder is uw effectieve capaciteit
                              verlaagd met {formatEuro(additionalLoanCalc.rateRiskHaircut)}{' '}
                              vanwege een rentevastperiode korter dan 10 jaar op één of meer
                              nieuwe leningdelen.
                            </InlineNote>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {additionalLoanCalc.withinCapacity ? (
                        <div className="mt-4">
                          <StatusBadge status="success">
                            Haalbaar: op basis van uw inkomen, de gekozen aflosvormen, rentes en
                            rentevastperiodes past deze aanvullende hypotheek, met nog{' '}
                            {formatEuro(additionalLoanCalc.capacityMargin)} marge op inkomen,
                            binnen een LTV van {additionalLoanCalc.newLtv.toFixed(0)}% en binnen
                            de 50% aflossingsvrij-norm.
                          </StatusBadge>
                        </div>
                      ) : (
                        <div className="mt-4">
                          <StatusBadge status="error">
                            <p className="font-medium">Nog niet haalbaar:</p>
                            <ul className="mt-1 list-disc space-y-0.5 pl-4">
                              {!additionalLoanCalc.withinIncomeCapacity && (
                                <li>
                                  Tekort op leencapaciteit van{' '}
                                  {formatEuro(-additionalLoanCalc.capacityMargin)}.
                                </li>
                              )}
                              {!additionalLoanCalc.withinLtvCap && (
                                <li>
                                  De totale hypotheek na aankoop overschrijdt de aanschafprijs
                                  (LTV boven 100%).
                                </li>
                              )}
                              {!additionalLoanCalc.withinAflossingsvrijCap && (
                                <li>De aflossingsvrije financiering overschrijdt de 50% norm.</li>
                              )}
                            </ul>
                          </StatusBadge>
                        </div>
                      )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

          <div className="mt-8 rounded-2xl border border-l-4 border-slate-100 border-l-blue-400 bg-white p-6 shadow-xl transition-all duration-200 hover:-translate-y-0.5 hover:shadow-2xl">
            <div className="mb-2 flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                <Home className="h-4 w-4" />
              </span>
              <h2 className="text-base font-semibold text-slate-800">
                Maximaal aankoopbudget beoogde woning
              </h2>
            </div>
            <p className="mb-5 text-sm text-slate-500">
              Optelsom van al uw financieringsbronnen bij verkoop van de huidige woning: dit is
              het theoretische maximum dat u voor een nieuwe woning zou kunnen neerleggen.
            </p>

            <BudgetBar
              segments={[
                {
                  label: 'Eigen vermogen inbreng',
                  value: maxBudgetCalc.eigenVermogen,
                  className: 'bg-emerald-400',
                  dotClassName: 'bg-emerald-400',
                },
                {
                  label: 'Overwaarde',
                  value: maxBudgetCalc.overwaarde,
                  className: 'bg-teal-400',
                  dotClassName: 'bg-teal-400',
                },
                {
                  label: 'Oude hypotheek (meegenomen)',
                  value: maxBudgetCalc.oudeHypotheek,
                  className: 'bg-blue-400',
                  dotClassName: 'bg-blue-400',
                },
                {
                  label: 'Nieuwe hypotheek (max. extra)',
                  value: maxBudgetCalc.nieuweHypotheekMax,
                  className: 'bg-indigo-500',
                  dotClassName: 'bg-indigo-500',
                },
              ]}
              total={maxBudgetCalc.maxBudget}
              marker={maxBudgetCalc.price}
            />

            <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                <span className="text-xs text-slate-400">Maximaal aankoopbudget</span>
                <p className="text-2xl font-bold text-slate-900">
                  {formatEuro(maxBudgetCalc.maxBudget)}
                </p>
              </div>
              <div
                className={`rounded-xl border p-4 ${
                  maxBudgetCalc.remainingRoom >= 0
                    ? 'border-emerald-100 bg-emerald-50'
                    : 'border-red-100 bg-red-50'
                }`}
              >
                <span
                  className={`text-xs ${
                    maxBudgetCalc.remainingRoom >= 0 ? 'text-emerald-600' : 'text-red-600'
                  }`}
                >
                  {maxBudgetCalc.remainingRoom >= 0
                    ? 'Overgebleven ruimte t.o.v. aanschafprijs'
                    : 'Tekort t.o.v. aanschafprijs'}
                </span>
                <p
                  className={`text-2xl font-bold ${
                    maxBudgetCalc.remainingRoom >= 0 ? 'text-emerald-700' : 'text-red-700'
                  }`}
                >
                  {formatEuro(Math.abs(maxBudgetCalc.remainingRoom))}
                </p>
              </div>
            </div>

            <p className="mt-4 text-xs text-slate-400">
              Nieuwe hypotheek (max. extra) is uw inkomensgebaseerde bijleenruimte, al
              gecorrigeerd voor eventueel renterisico op leningdelen met een resterende
              rentevastperiode korter dan 10 jaar. Dit is een theoretisch maximum: het is niet
              per definitie verstandig om dit volledig te benutten.
            </p>
          </div>

          <div className="mt-8 rounded-2xl border border-l-4 border-slate-100 border-l-blue-400 bg-white p-6 shadow-xl transition-all duration-200 hover:-translate-y-0.5 hover:shadow-2xl">
            <div className="mb-2 flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                <TrendingUp className="h-4 w-4" />
              </span>
              <h2 className="text-base font-semibold text-slate-800">
                Aflosschema nieuwe situatie
              </h2>
            </div>
            <p className="mb-5 text-sm text-slate-500">
              Geprojecteerde restschuld van de meegenomen en de nieuwe leningdelen samen, bij
              ongewijzigde rentes en aflosvormen. Geen rekening gehouden met toekomstige
              renteherzieningen bij het aflopen van een rentevastperiode.
            </p>

            <AmortizationChart data={amortizationSchedule} />

            <div className="mt-4 flex flex-wrap items-center gap-5">
              <div className="flex items-center gap-1.5 text-xs text-slate-600">
                <span className="h-2.5 w-2.5 rounded-sm bg-blue-400" />
                Meegenomen hypotheek
              </div>
              <div className="flex items-center gap-1.5 text-xs text-slate-600">
                <span className="h-2.5 w-2.5 rounded-sm bg-indigo-500" />
                Nieuwe leningdelen
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                <span className="text-xs text-slate-400">Restschuld nu</span>
                <p className="text-xl font-bold text-slate-900">
                  {formatEuro(amortizationSchedule[0]?.total ?? 0)}
                </p>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                <span className="text-xs text-slate-400">Restschuld over 30 jaar</span>
                <p className="text-xl font-bold text-slate-900">
                  {formatEuro(amortizationSchedule[30]?.total ?? 0)}
                </p>
              </div>
            </div>

            <div className="mt-8">
              <h3 className="mb-1 text-sm font-semibold text-slate-700">
                Maandelijks aflosschema nieuwe situatie
              </h3>
              <p className="mb-4 text-xs text-slate-500">
                Rente, aflossing en de geprojecteerde onderpandswaarde/LTV per maand, voor de
                meegenomen en nieuwe leningdelen samen. Schuif om verder in de tijd te kijken of
                om een jaarlijkse waardestijging van de beoogde woning te veronderstellen.
              </p>

              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                <Slider
                  id="scheduleWindowStartMonth"
                  label="Startmaand van de tabel"
                  icon={<CalendarDays className="h-3.5 w-3.5 text-slate-400" />}
                  value={scheduleWindowStartMonth}
                  min={0}
                  max={TERM_MONTHS - 1}
                  step={1}
                  onChange={setScheduleWindowStartMonth}
                  formatValue={(v) => `maand ${v} (jaar ${Math.floor(v / 12)})`}
                />
                <Slider
                  id="scheduleAppreciationPct"
                  label="Jaarlijkse waardestijging woning"
                  icon={<TrendingUp className="h-3.5 w-3.5 text-slate-400" />}
                  value={scheduleAppreciationPct}
                  min={0}
                  max={9}
                  step={0.5}
                  onChange={setScheduleAppreciationPct}
                  formatValue={(v) => `${v.toFixed(1).replace('.', ',')}%`}
                  hint="Toegepast op de aanschafprijs van de beoogde woning, samengesteld per maand."
                />
              </div>

              <div className="mt-4 overflow-x-auto rounded-xl border border-slate-100 bg-white">
                <table className="w-full min-w-[560px] border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50">
                      <th className="p-2.5 text-left font-semibold text-slate-500">Maand</th>
                      <th className="p-2.5 text-right font-semibold text-slate-500">Rente</th>
                      <th className="p-2.5 text-right font-semibold text-slate-500">Aflossing</th>
                      <th className="p-2.5 text-right font-semibold text-slate-500">Totaal</th>
                      <th className="p-2.5 text-right font-semibold text-slate-500">
                        Onderpandswaarde
                      </th>
                      <th className="p-2.5 text-right font-semibold text-slate-500">LTV</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthlySchedule
                      .slice(scheduleWindowStartMonth, scheduleWindowStartMonth + 12)
                      .map((row) => (
                        <tr key={row.month} className="border-t border-slate-100">
                          <td className="p-2.5 text-left font-medium text-slate-600">
                            {row.month}
                          </td>
                          <td className="p-2.5 text-right text-slate-700">
                            {formatEuro(row.interestMonthly)}
                          </td>
                          <td className="p-2.5 text-right text-slate-700">
                            {formatEuro(row.principalMonthly)}
                          </td>
                          <td className="p-2.5 text-right font-semibold text-slate-800">
                            {formatEuro(row.totalMonthly)}
                          </td>
                          <td className="p-2.5 text-right text-slate-700">
                            {formatEuro(row.collateralValue)}
                          </td>
                          <td
                            className={`p-2.5 text-right font-semibold ${
                              row.ltv > 100 ? 'text-red-600' : 'text-slate-800'
                            }`}
                          >
                            {row.ltv.toFixed(0)}%
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="mt-8 overflow-hidden rounded-2xl border border-l-4 border-slate-100 border-l-amber-400 bg-white shadow-xl transition-all duration-200 hover:-translate-y-0.5 hover:shadow-2xl">
            <button
              type="button"
              onClick={() => setShowDoubleCostsTest((prev) => !prev)}
              className="flex w-full items-center justify-between p-6 text-left transition-all duration-200 hover:bg-slate-50"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
                  <AlertTriangle className="h-4 w-4" />
                </span>
                <div>
                  <h2 className="text-base font-semibold text-slate-800">
                    Nibud dubbele-lastentoets (optioneel)
                  </h2>
                  <p className="text-xs text-slate-400">
                    Kunt u tijdelijk zowel de huidige als de nieuwe hypotheek dragen, als de
                    huidige woning nog niet verkocht is bij aankoop?
                  </p>
                </div>
              </div>
              {showDoubleCostsTest ? (
                <ChevronUp className="h-5 w-5 flex-shrink-0 text-slate-400" />
              ) : (
                <ChevronDown className="h-5 w-5 flex-shrink-0 text-slate-400" />
              )}
            </button>

            <AnimatePresence initial={false}>
              {showDoubleCostsTest && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.3, ease: 'easeOut' }}
                  className="overflow-hidden"
                >
                  <div className="space-y-4 border-t border-slate-100 p-6">
                    <p className="text-xs text-slate-500">
                      Uitgangspunt, conservatief: de huidige woning is bij aankoop van de
                      beoogde woning nog niet verkocht, dus er is nog geen overwaarde
                      beschikbaar. Alleen uw ingebrachte eigen vermogen verlaagt de nieuwe
                      hypotheek, kosten koper tellen apart mee. De nieuwe hypotheek wordt hier
                      berekend als annuïteit over 30 jaar tegen de rente (of toetsrente) bij
                      Beoogde woning, ongeacht de aflosvorm die u verderop kiest voor de
                      daadwerkelijke financiering.
                    </p>

                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50/60 p-4">
                      <div>
                        <span className="text-xs font-medium text-slate-600">
                          Oude hypotheek tijdens overbrugging
                        </span>
                        <p className="text-xs text-slate-400">
                          Praktijk verschilt per geldverstrekker: sommigen toetsen de volledige
                          last, anderen alleen het rentedeel.
                        </p>
                      </div>
                      <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1">
                        <button
                          type="button"
                          onClick={() => setOldMortgageStance('volledig')}
                          className={`rounded-md px-3 py-2 sm:py-1.5 text-xs font-semibold transition-all duration-200 ${
                            oldMortgageStance === 'volledig'
                              ? 'bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-sm'
                              : 'text-slate-500 hover:text-slate-700'
                          }`}
                        >
                          Volledige last
                        </button>
                        <button
                          type="button"
                          onClick={() => setOldMortgageStance('rente')}
                          className={`rounded-md px-3 py-2 sm:py-1.5 text-xs font-semibold transition-all duration-200 ${
                            oldMortgageStance === 'rente'
                              ? 'bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-sm'
                              : 'text-slate-500 hover:text-slate-700'
                          }`}
                        >
                          Alleen rente
                        </button>
                      </div>
                    </div>

                    <Slider
                      id="bridgePeriodMonths"
                      label="Verwachte overbruggingsperiode"
                      icon={<CalendarDays className="h-3.5 w-3.5 text-slate-400" />}
                      value={bridgePeriodMonths}
                      min={1}
                      max={24}
                      step={1}
                      onChange={setBridgePeriodMonths}
                      formatValue={(v) => `${v} ${v === 1 ? 'maand' : 'maanden'}`}
                    />

                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50/60 p-4">
                      <div>
                        <span className="text-xs font-medium text-slate-600">
                          Eigen vermogen (spaargeld/beleggingen) meenemen
                        </span>
                        <p className="text-xs text-slate-400">
                          Gangbaar bij geldverstrekkers: in tegenstelling tot overwaarde is
                          spaargeld en beleggingsvermogen direct beschikbaar en mag dit ook
                          tijdens de overbruggingsperiode worden ingezet.
                        </p>
                      </div>
                      <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1">
                        <button
                          type="button"
                          onClick={() => setIncludeOwnCapitalInDoubleTest(true)}
                          className={`rounded-md px-3 py-2 sm:py-1.5 text-xs font-semibold transition-all duration-200 ${
                            includeOwnCapitalInDoubleTest
                              ? 'bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-sm'
                              : 'text-slate-500 hover:text-slate-700'
                          }`}
                        >
                          Meenemen
                        </button>
                        <button
                          type="button"
                          onClick={() => setIncludeOwnCapitalInDoubleTest(false)}
                          className={`rounded-md px-3 py-2 sm:py-1.5 text-xs font-semibold transition-all duration-200 ${
                            !includeOwnCapitalInDoubleTest
                              ? 'bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-sm'
                              : 'text-slate-500 hover:text-slate-700'
                          }`}
                        >
                          Niet meenemen
                        </button>
                      </div>
                    </div>

                    <CurrencyField
                      id="liquidityBuffer"
                      label="Extra spaargeld achter de hand (niet ingezet als eigen inbreng)"
                      icon={<PiggyBank className="h-3.5 w-3.5 text-slate-400" />}
                      value={liquidityBuffer}
                      onChange={setLiquidityBuffer}
                      placeholder="0"
                      hint="Dit bedrag verlaagt de hypotheek niet, maar kan een tijdelijk maandelijks tekort tijdens de overbrugging opvangen."
                    />

                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50/60 p-4">
                      <div>
                        <span className="text-xs font-medium text-slate-600">
                          Overbruggingskrediet gebruiken?
                        </span>
                        <p className="text-xs text-slate-400">
                          Ontsluit de overwaarde van uw huidige woning al vóór de verkoop, tegen
                          rente. Verlaagt de tijdelijk benodigde nieuwe hypotheek, maar de rente
                          hierover komt bovenop uw gecombineerde maandlast.
                        </p>
                      </div>
                      <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1">
                        <button
                          type="button"
                          onClick={() => setUseBridgeLoan(false)}
                          className={`rounded-md px-3 py-2 sm:py-1.5 text-xs font-semibold transition-all duration-200 ${
                            !useBridgeLoan
                              ? 'bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-sm'
                              : 'text-slate-500 hover:text-slate-700'
                          }`}
                        >
                          Nee
                        </button>
                        <button
                          type="button"
                          onClick={() => setUseBridgeLoan(true)}
                          className={`rounded-md px-3 py-2 sm:py-1.5 text-xs font-semibold transition-all duration-200 ${
                            useBridgeLoan
                              ? 'bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-sm'
                              : 'text-slate-500 hover:text-slate-700'
                          }`}
                        >
                          Ja
                        </button>
                      </div>
                    </div>

                    {useBridgeLoan && (
                      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                        <CurrencyField
                          id="bridgeLoanAmount"
                          label="Bedrag overbruggingskrediet"
                          icon={<Euro className="h-3.5 w-3.5 text-slate-400" />}
                          value={bridgeLoanAmount}
                          onChange={setBridgeLoanAmount}
                          placeholder={String(Math.round(currentMortgage.usableOverwaarde))}
                          hint="Standaard de volledige bruikbare overwaarde; nooit hoger, want daarop is het krediet gezekerd."
                        />
                        <Slider
                          id="bridgeLoanRate"
                          label="Rente overbruggingskrediet"
                          icon={<Percent className="h-3.5 w-3.5 text-slate-400" />}
                          value={bridgeLoanRate}
                          min={2}
                          max={9}
                          step={0.1}
                          onChange={setBridgeLoanRate}
                          formatValue={formatRate}
                        />
                      </div>
                    )}

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                      <div>
                        <span className="text-xs text-slate-400">
                          Bruto maandlast huidige hypotheek
                        </span>
                        <p className="text-sm font-semibold text-slate-800">
                          {formatEuro(doubleCostsCalc.oldMortgageBruto)}
                        </p>
                        <span className="text-[11px] text-slate-400">
                          {oldMortgageStance === 'rente'
                            ? 'Rentedeel, exclusief aflossing'
                            : 'Volledige last, rente plus aflossing'}
                        </span>
                      </div>
                      <div>
                        <span className="text-xs text-slate-400">
                          Ingebracht eigen vermogen (deze toets)
                        </span>
                        <p className="text-sm font-semibold text-slate-800">
                          {formatEuro(doubleCostsCalc.ownCapitalUsed)}
                        </p>
                        <span className="text-[11px] text-slate-400">
                          {includeOwnCapitalInDoubleTest
                            ? `Van uw sliders bij Inkomen, totaal ${formatEuro(calc.totalOwnCapital)}`
                            : 'Uitgeschakeld voor deze toets'}
                        </span>
                      </div>
                      <div>
                        <span className="text-xs text-slate-400">
                          Benodigde nieuwe hypotheek
                        </span>
                        <p className="text-sm font-semibold text-slate-800">
                          {formatEuro(doubleCostsCalc.newMortgageAmount)}
                        </p>
                        <span className="text-[11px] text-slate-400">
                          Incl. {formatEuro(doubleCostsCalc.kostenKoper)} kosten koper
                          {doubleCostsCalc.bridgeLoanPrincipal > 0
                            ? `, na aftrek ${formatEuro(doubleCostsCalc.bridgeLoanPrincipal)} overbruggingskrediet`
                            : ', zonder overwaarde'}
                        </span>
                      </div>
                      <div>
                        <span className="text-xs text-slate-400">
                          Bruto maandlast nieuwe hypotheek
                        </span>
                        <p className="text-sm font-semibold text-slate-800">
                          {formatEuro(doubleCostsCalc.newMortgageBruto)}
                        </p>
                        {calc.toetsrenteApplies && (
                          <span className="text-[11px] text-amber-600">
                            Bij toetsrente {formatRate(TOETSRENTE)}
                          </span>
                        )}
                      </div>
                      {doubleCostsCalc.bridgeLoanPrincipal > 0 && (
                        <div>
                          <span className="text-xs text-slate-400">
                            Rente overbruggingskrediet p/mnd
                          </span>
                          <p className="text-sm font-semibold text-amber-600">
                            {formatEuro(doubleCostsCalc.bridgeLoanMonthlyInterest)}
                          </p>
                          <span className="text-[11px] text-slate-400">
                            {formatEuro(doubleCostsCalc.bridgeLoanTotalInterest)} totaal over{' '}
                            {doubleCostsCalc.months}{' '}
                            {doubleCostsCalc.months === 1 ? 'maand' : 'maanden'}
                          </span>
                        </div>
                      )}
                      <div>
                        <span className="text-xs text-slate-400">Toegestane maandlast o.b.v. inkomen</span>
                        <p className="text-sm font-semibold text-slate-800">
                          {formatEuro(doubleCostsCalc.allowedMonthly)}
                        </p>
                      </div>
                    </div>

                    <div>
                      <div className="mb-3 flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-4 py-3">
                        <span className="text-sm text-slate-600">
                          Gecombineerde bruto maandlast (beide hypotheken
                          {doubleCostsCalc.bridgeLoanPrincipal > 0 ? ' + overbruggingskrediet' : ''}
                          )
                        </span>
                        <span className="text-xl font-bold text-slate-900">
                          {formatEuro(doubleCostsCalc.combinedBruto)}
                        </span>
                      </div>
                      <DoubleCostsTimeline
                        oldBurden={doubleCostsCalc.oldMortgageBruto}
                        newBurden={doubleCostsCalc.newMortgageBruto}
                        months={doubleCostsCalc.months}
                        allowedMonthly={doubleCostsCalc.allowedMonthly}
                      />
                    </div>

                    {doubleCostsCalc.withinBudget ? (
                      <StatusBadge status="success">
                        Haalbaar: u kunt naar verwachting beide hypotheken tijdelijk dragen,
                        met nog {formatEuro(doubleCostsCalc.margin)} marge per maand, oftewel{' '}
                        {formatEuro(doubleCostsCalc.cumulativeMargin)} over de verwachte
                        overbruggingsperiode van {doubleCostsCalc.months}{' '}
                        {doubleCostsCalc.months === 1 ? 'maand' : 'maanden'}.
                      </StatusBadge>
                    ) : doubleCostsCalc.bufferCoversShortfall ? (
                      <StatusBadge status="success">
                        Haalbaar dankzij uw buffer: op inkomen alleen is er een tekort van{' '}
                        {formatEuro(doubleCostsCalc.cumulativeShortfall)} over{' '}
                        {doubleCostsCalc.months}{' '}
                        {doubleCostsCalc.months === 1 ? 'maand' : 'maanden'}, maar uw extra
                        spaargeld van {formatEuro(doubleCostsCalc.buffer)} dekt dit volledig,
                        met nog {formatEuro(doubleCostsCalc.bufferRemaining)} buffer over.
                        Houd er rekening mee dat een geldverstrekker dit niet altijd op deze
                        manier meeweegt in de formele toets.
                      </StatusBadge>
                    ) : (
                      <StatusBadge status="error">
                        Niet haalbaar: de gecombineerde maandlast overschrijdt de toegestane
                        maandlast met {formatEuro(-doubleCostsCalc.margin)} per maand. Over de
                        verwachte overbruggingsperiode van {doubleCostsCalc.months}{' '}
                        {doubleCostsCalc.months === 1 ? 'maand' : 'maanden'} loopt dit op tot een
                        totaal tekort van {formatEuro(doubleCostsCalc.cumulativeShortfall)}.
                        {doubleCostsCalc.buffer > 0 &&
                          ` Uw buffer van ${formatEuro(doubleCostsCalc.buffer)} dekt hiervan een deel, met nog ${formatEuro(doubleCostsCalc.bufferShortfall)} ongedekt.`}{' '}
                        {useBridgeLoan
                          ? 'Overweeg een hoger overbruggingskrediet, eerst te verkopen, of extra eigen inbreng.'
                          : 'Overweeg eerst te verkopen, een overbruggingskrediet, of extra eigen inbreng.'}
                      </StatusBadge>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
        )}

        <OptionalPropertyDataModule
          onUseValue={hasExistingHome ? setMarketValue : setPurchasePrice}
          useValueLabel={
            hasExistingHome
              ? "'Huidige marktwaarde woning'"
              : "'Aanschafprijs beoogde woning' (als richtprijs)"
          }
          purchasePrice={safeNum(purchasePrice)}
        />

        <ScenarioAnalysis
          scenarios={scenarioAnalysis.scenarios}
          portedDebt={scenarioAnalysis.portedDebt}
          overwaarde={scenarioAnalysis.overwaarde}
          hasExistingHome={hasExistingHome}
          extraBorrowCapacity={
            hasExistingHome ? currentMortgage.extraBorrowCapacity : calc.incomeBasedMax
          }
        />

        <div className="mt-8 overflow-hidden rounded-2xl border border-slate-100 bg-white">
          <button
            type="button"
            onClick={() => setShowSources((prev) => !prev)}
            className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition-all duration-200 hover:bg-slate-50"
          >
            <span className="flex items-center gap-2 text-sm font-medium text-slate-600">
              <BookOpen className="h-4 w-4 text-slate-400" />
              Bronnen & aannames
            </span>
            {showSources ? (
              <ChevronUp className="h-4 w-4 flex-shrink-0 text-slate-400" />
            ) : (
              <ChevronDown className="h-4 w-4 flex-shrink-0 text-slate-400" />
            )}
          </button>
          <AnimatePresence initial={false}>
            {showSources && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                className="overflow-hidden"
              >
                <ul className="space-y-2 border-t border-slate-100 px-5 py-4 text-xs text-slate-500">
                  <li>
                    <span className="font-medium text-slate-600">Financieringslastpercentages en AOW-tabel:</span>{' '}
                    Wijzigingsregeling hypothecair krediet 2026, Staatscourant 2025, 36471 (Tabel 1
                    en Tabel 2).
                  </li>
                  <li>
                    <span className="font-medium text-slate-600">AFM-toetsrente:</span> per kwartaal
                    vastgesteld door de AFM, van toepassing bij een rentevastperiode korter dan 10
                    jaar.
                  </li>
                  <li>
                    <span className="font-medium text-slate-600">Overdrachtsbelasting:</span>{' '}
                    Belastingdienst/Rijksoverheid, tarieven en startersvrijstelling 2026.
                  </li>
                  <li>
                    <span className="font-medium text-slate-600">Kosten koper:</span> notaris,
                    taxatie, advies, bankgarantie en NHG-provisie zijn indicatieve
                    marktgemiddelden en per post aanpasbaar in de kaart Kosten koper.
                  </li>
                  <li>
                    <span className="font-medium text-slate-600">Studieschuld:</span> DUO-terugbetaalregeling
                    (rente en aflostermijn per stelsel, sinds 1 januari 2024).
                  </li>
                  <li>
                    Alle bedragen en percentages zijn indicatief; aan deze berekening kunnen geen
                    rechten worden ontleend. Raadpleeg voor een bindend advies een erkend
                    hypotheekadviseur.
                  </li>
                </ul>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <p className="mt-6 text-center text-[11px] text-slate-400">
          v{typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0'}
          {typeof __GIT_COMMIT__ !== 'undefined' && __GIT_COMMIT__ !== 'dev' ? ` · ${__GIT_COMMIT__}` : ''}
        </p>
      </div>

      {/* Mobiele sticky resultaat-samenvatting: het volledige resultaatpaneel staat pas
          verderop in de flow, dus zolang dat niet in beeld is tonen we hier een compacte
          versie met directe feedback op wat er tot nu toe is ingevuld. */}
      <div className="fixed inset-x-0 bottom-0 z-40 lg:hidden">
        <AnimatePresence>
          {!resultInView && (
            <motion.button
              type="button"
              onClick={() => scrollToSection('sectie-resultaat')}
              initial={{ y: 80, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 80, opacity: 0 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              className={`flex w-full items-center justify-between gap-3 border-t px-5 py-3.5 text-left shadow-[0_-4px_16px_rgba(15,23,42,0.12)] ${
                overallAffordable
                  ? 'border-emerald-500/30 bg-gradient-to-r from-emerald-600 to-emerald-700'
                  : 'border-blue-500/30 bg-gradient-to-r from-blue-600 to-indigo-700'
              }`}
            >
              <span className="flex items-center gap-2 text-xs font-medium text-white/85">
                {overallAffordable ? (
                  <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                ) : (
                  <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                )}
                {hasExistingHome ? 'Maximaal aankoopbudget' : 'Maximale hypotheek'}
              </span>
              <span className="flex items-center gap-1.5 text-base font-bold text-white">
                {formatEuro(mobileSummaryValue)}
                <ChevronUp className="h-4 w-4 opacity-70" />
              </span>
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// Buitenste wrapper voor "opnieuw beginnen": een key-remount is de eenvoudigste,
// robuustste manier om ~45 losse useState-velden tegelijk naar hun oorspronkelijke
// waarde terug te zetten, zonder elk veld handmatig te hoeven opsommen (en zonder het
// risico dat die lijst bij toekomstige nieuwe velden stilletjes uit sync raakt).
export default function MortgageCalculator() {
  const [resetKey, setResetKey] = useState(0);
  return (
    <MortgageCalculatorForm
      key={resetKey}
      onReset={() => setResetKey((k) => k + 1)}
    />
  );
}
