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
} from 'lucide-react';
import OptionalPropertyDataModule from './OptionalPropertyDataModule';
import ScenarioAnalysis from './ScenarioAnalysis';
import { getIncomeBasedMortgage } from './nibud2026';

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
const HRA_RATE = 0.3756;
const EWF_RATE = 0.0035;
const EWF_CAP = 1350000;
const SCENARIO_PERCENTAGES = [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5];
const TRANSFER_TAX_RATE = 0.02;
const OTHER_PURCHASE_COSTS_RATE = 0.015;
// AFM-toetsrente 2026 (elk kwartaal vastgesteld, tot nu toe steeds 5%). Verplicht te
// gebruiken zodra de rentevastperiode van de nieuwe hypotheek korter is dan 10 jaar.
const TOETSRENTE = 5.0;
// Sommige geldverstrekkers hanteren een interne acceptatiegrens van €1 miljoen voor de
// totale hypotheeksom, waarboven aanvullende eisen of een ander acceptatietraject gelden.
const LENDER_CAP_THRESHOLD = 1000000;
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

function safeNum(value) {
  const n = parseFloat(value);
  return isNaN(n) || !isFinite(n) ? 0 : n;
}

// Eén gedeelde plek voor de kosten-koper-berekening (overdrachtsbelasting + overige
// kosten koper), zodat de standaardflow en de overbruggingsflow nooit uit elkaar kunnen
// lopen als deze percentages ooit wijzigen.
function getKostenKoperCosts(price) {
  return safeNum(price) * (TRANSFER_TAX_RATE + OTHER_PURCHASE_COSTS_RATE);
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
  const prev = useRef(safeNum(value));

  useEffect(() => {
    const target = safeNum(value);
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReduced) {
      prev.current = target;
      setDisplay(target);
      return;
    }

    const controls = animate(prev.current, target, {
      duration: 0.8,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setDisplay(v),
    });
    prev.current = target;
    return () => controls.stop();
  }, [value]);

  return <span className={className}>{formatEuro(display)}</span>;
}

function formatRate(rate) {
  return safeNum(rate).toFixed(2).replace('.', ',') + '%';
}

function Slider({ id, label, icon, value, min, max, step, onChange, formatValue, hint }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
          {icon}
          {label}
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
        className="w-full h-2 rounded-lg appearance-none cursor-pointer bg-slate-200 accent-blue-600 transition-all duration-200"
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
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition-all duration-200 focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
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
          className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-7 pr-3 text-sm text-slate-800 outline-none transition-all duration-200 focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
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
        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition-all duration-200 focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
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
        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition-all duration-200 focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
      />
      {hint && <p className="text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

function SectionCard({ title, icon, children, id }) {
  return (
    <div id={id} className="rounded-2xl bg-white p-6 shadow-xl border border-slate-100">
      <div className="mb-5 flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
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
      <path d={layer1Path} fill="#60a5fa" opacity="0.85" />
      <path d={layer2Path} fill="#6366f1" opacity="0.85" />
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

export default function MortgageCalculator() {
  const [income1, setIncome1] = useState(115000);
  const [income2, setIncome2] = useState(115000);
  const [age1, setAge1] = useState('35');
  const [age2, setAge2] = useState('34');
  const [ownCapital1, setOwnCapital1] = useState(0);
  const [ownCapital2, setOwnCapital2] = useState(0);
  const [rate, setRate] = useState(4.0);
  const [fixedRatePeriod, setFixedRatePeriod] = useState(10);
  const [energyLabel, setEnergyLabel] = useState('A');
  const [purchasePrice, setPurchasePrice] = useState(1300000);
  const [debt1, setDebt1] = useState('0');
  const [debt2, setDebt2] = useState('0');
  const [studyDebt1, setStudyDebt1] = useState('0');
  const [studyDebt2, setStudyDebt2] = useState('0');
  const [studyDebtRegime, setStudyDebtRegime] = useState('nieuw');

  const [showCurrentMortgage, setShowCurrentMortgage] = useState(true);
  const [showDoubleCostsTest, setShowDoubleCostsTest] = useState(false);
  const [hasExistingHome, setHasExistingHome] = useState(true);
  const [oldMortgageStance, setOldMortgageStance] = useState('volledig');
  const [bridgePeriodMonths, setBridgePeriodMonths] = useState(6);
  const [includeOwnCapitalInDoubleTest, setIncludeOwnCapitalInDoubleTest] = useState(true);
  const [liquidityBuffer, setLiquidityBuffer] = useState('0');
  const [marketValue, setMarketValue] = useState(940000);
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

  const calc = useMemo(() => {
    const combinedIncome = safeNum(income1) + safeNum(income2);

    // A6: bij een rentevastperiode korter dan 10 jaar moet wettelijk met de (hogere)
    // AFM-toetsrente worden getoetst, nooit met de lagere daadwerkelijke rente.
    const testRate = getTestRate(rate, fixedRatePeriod);
    const toetsrenteApplies = testRate !== safeNum(rate);

    const energyBonus = getEnergyBonus(energyLabel);

    // A3: schulden worden eerst omgerekend naar een maandlast (2% van het schuldbedrag
    // voor overige schulden). Studieschuld wordt sinds 2024 berekend op basis van de
    // werkelijke DUO-terugbetaalregeling (rente en aflostermijn van het gekozen stelsel),
    // toegepast op de restschuld.
    const otherDebtMonthly = (safeNum(debt1) + safeNum(debt2)) * OTHER_DEBT_MONTHLY_WEIGHT;
    const studyDebtMonthly = getStudyDebtMonthlyBurden(
      safeNum(studyDebt1) + safeNum(studyDebt2),
      studyDebtRegime
    );
    const monthlyDebt = otherDebtMonthly + studyDebtMonthly;

    // A1-A3: echte Nibud-woonquote-systematiek 2026. De woonquote bij (toetsinkomen,
    // toetsrente) bepaalt de maximale bruto woonlast; de maandlast van bestaande schulden
    // gaat daar direct vanaf; het restant wordt gekapitaliseerd tegen de toetsrente.
    const nibud = getIncomeBasedMortgage(combinedIncome, testRate, monthlyDebt);
    const woonquote = nibud.woonquote;

    // Ter weergave: hoeveel maximale hypotheek er wegvalt door de schulden (de
    // gekapitaliseerde waarde van de schuldmaandlast tegen de toetsrente).
    const debtDeduction = monthlyDebt * nibud.annuityFactor;

    const incomeBasedMax = Math.max(0, nibud.maxLoan + energyBonus);

    // B10: een hypotheek kan nooit hoger zijn dan de aanschafprijs van de woning
    // (maximale LTV van 100%), ongeacht hoeveel de leencapaciteit op inkomen toelaat.
    const priceNum = safeNum(purchasePrice);
    const cappedByPropertyValue = priceNum > 0 && incomeBasedMax > priceNum;
    const maxMortgage = priceNum > 0 ? Math.min(incomeBasedMax, priceNum) : incomeBasedMax;

    // B11: kosten koper nu consistent gebaseerd op de daadwerkelijke aanschafprijs (net
    // als verderop bij de financieringsgat-berekening), in plaats van op de maximale
    // hypotheek zoals voorheen.
    const ownMoney = getKostenKoperCosts(priceNum > 0 ? priceNum : maxMortgage);

    const isOverIndebted = monthlyDebt > nibud.maxWoonlastMonthly;
    const showSustainability = ['E', 'F', 'G'].includes(energyLabel);
    const showPensionWarning = safeNum(age1) >= 57 || safeNum(age2) >= 57;
    const totalOwnCapital = safeNum(ownCapital1) + safeNum(ownCapital2);
    const purchasingPower = maxMortgage + totalOwnCapital;

    // Basis voor de aanvullende-hypotheektoets verderop: leencapaciteit o.b.v. inkomen bij
    // de daadwerkelijke rente, zonder de generieke toetsrentecorrectie hierboven (die is
    // gebaseerd op één algemene rentevastperiode-aanname). Bij het toetsen van de
    // aanvullende leningdelen wordt per leningdeel opnieuw en preciezer getoetst.
    const nibudAtActualRate = getIncomeBasedMortgage(combinedIncome, safeNum(rate), monthlyDebt);
    const incomeBasedMaxAtActualRate = Math.max(0, nibudAtActualRate.maxLoan + energyBonus);

    // Effectieve leenfactor puur ter illustratie (maximale hypotheek gedeeld door inkomen);
    // de daadwerkelijke toets verloopt via de woonquote hierboven, niet via deze factor.
    const effectiveFactor = combinedIncome > 0 ? incomeBasedMax / combinedIncome : 0;

    return {
      combinedIncome,
      woonquote,
      effectiveFactor,
      maxWoonlastMonthly: nibud.maxWoonlastMonthly,
      energyBonus,
      debtDeduction,
      incomeBasedMax,
      incomeBasedMaxAtActualRate,
      cappedByPropertyValue,
      maxMortgage,
      ownMoney,
      isOverIndebted,
      showSustainability,
      showPensionWarning,
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
  ]);

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

    const taxBenefit = deductibleInterest * HRA_RATE;
    const ewfYearly = EWF_RATE * Math.min(safeNum(marketValue), EWF_CAP);
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
    const hasRateRiskOnPortedDebt = rateRiskCapacityHaircut > 0;

    const currentDebtBalance = loanParts.reduce((sum, p) => sum + safeNum(p.principal), 0);
    const ltv = safeNum(marketValue) > 0 ? (currentDebtBalance / safeNum(marketValue)) * 100 : 0;
    // Werkelijke leencapaciteit: de inkomensgebaseerde leencapaciteit, gecorrigeerd voor het
    // renterisico op meegenomen leningdelen met een korte rentevastperiode. Dit is het getal
    // dat er in de praktijk toe doet, in plaats van de ongecorrigeerde leencapaciteit o.b.v.
    // inkomen alleen. Let op: hier bewust calc.incomeBasedMax gebruikt (ongekort door de
    // aanschafprijs), niet calc.maxMortgage. Anders zou uw bijleenruimte en maximale
    // aankoopbudget circulair begrensd worden door de aanschafprijs die u toevallig nu heeft
    // ingesteld, terwijl deze getallen juist bedoeld zijn om te laten zien wat maximaal
    // haalbaar is, ongeacht de huidige stand van de schuifknop.
    const effectiveMaxMortgage = Math.max(0, calc.incomeBasedMax - rateRiskCapacityHaircut);
    const extraBorrowCapacity = Math.max(0, effectiveMaxMortgage - currentDebtBalance);
    // Werkelijke overwaarde: marktwaarde min restschuld, ongekort. Sommige geldverstrekkers
    // tellen de nog niet (onvoorwaardelijk) verkochte woning echter niet voor 100% mee als
    // onderpand voor de financiering, maar hanteren een verkoopafslag (bijvoorbeeld 95%). De
    // "bruikbare" overwaarde voor financieringsdoeleinden houdt hier rekening mee.
    const saleValueForFinancing = safeNum(marketValue) * (saleDiscountPercentage / 100);
    const overwaarde = safeNum(marketValue) - currentDebtBalance;
    const usableOverwaarde = Math.max(0, saleValueForFinancing - currentDebtBalance);

    return {
      totalGross,
      totalInterest,
      totalPrincipal,
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
      ltv,
      extraBorrowCapacity,
      overwaarde,
      usableOverwaarde,
      saleValueForFinancing,
    };
  }, [loanParts, startDate, marketValue, saleDiscountPercentage, calc]);

  const newHomeCalc = useMemo(() => {
    const price = safeNum(purchasePrice);
    const transferTax = price * TRANSFER_TAX_RATE;
    const otherCosts = price * OTHER_PURCHASE_COSTS_RATE;
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
    const portedDebt = currentMortgage.currentDebtBalance;
    const overwaarde = currentMortgage.usableOverwaarde;
    // Meeneemregeling: de bestaande hypotheek gaat mee tegen de oude voorwaarden, en de
    // overwaarde komt daarnaast vrij als cash. Samen dekken deze twee posten een deel van de
    // aanschafprijs; wat overblijft is het financieringsgat.
    const gap = price - portedDebt - overwaarde;
    const ownCapitalApplied = Math.min(calc.totalOwnCapital, Math.max(0, gap));
    const additionalMortgage = Math.max(0, gap - calc.totalOwnCapital);
    const capacityMargin = currentMortgage.extraBorrowCapacity - additionalMortgage;
    const withinCapacity = capacityMargin >= 0;
    const surplus = gap < 0 ? -gap : 0;
    // Sommige geldverstrekkers hanteren een interne grens van €1 miljoen voor de totale
    // hypotheek (meegenomen plus nieuw), waarboven aanvullende acceptatie-eisen gelden.
    const totalMortgageAfterMove = portedDebt + additionalMortgage;
    const exceedsLenderCap = totalMortgageAfterMove > LENDER_CAP_THRESHOLD;

    return {
      portedDebt,
      overwaarde,
      gap,
      ownCapitalApplied,
      additionalMortgage,
      capacityMargin,
      withinCapacity,
      surplus,
      totalMortgageAfterMove,
      exceedsLenderCap,
    };
  }, [purchasePrice, calc, currentMortgage]);

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

    const portedDebt = hasExistingHome ? currentMortgage.currentDebtBalance : 0;
    const overwaarde = hasExistingHome ? currentMortgage.usableOverwaarde : 0;
    const portedGrossMonthly = hasExistingHome ? currentMortgage.totalGross : 0;
    const portedTaxBenefit = hasExistingHome ? currentMortgage.taxBenefit : 0;
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
          if (result.eligibleForHRA) taxBenefit += result.interestMonthly * HRA_RATE;
        });
        return { grossMonthly, taxBenefit };
      }
      // Nog geen leningdelen ingevuld: generieke annuïteit tegen de hypotheekrente.
      const grossMonthly = capFactor > 0 ? additionalMortgage / capFactor : 0;
      const taxBenefit = additionalMortgage * r * HRA_RATE;
      return { grossMonthly, taxBenefit };
    };

    const scenarios = SCENARIO_PERCENTAGES.map((pct) => {
      const price = basePrice * (1 + pct / 100);
      const gap = price - portedDebt - overwaarde;
      const additionalMortgage = Math.max(0, gap - calc.totalOwnCapital);

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
      const ewfMonthly = (EWF_RATE * Math.min(price, EWF_CAP)) / 12;
      const netMonthly = grossMonthly - portedTaxBenefit - newTaxBenefit + ewfMonthly;

      const exceedsCapacity = additionalMortgage > extraBorrowCapacity;
      return {
        pct,
        price,
        additionalMortgage,
        newGrossMonthly,
        newNetMonthly,
        grossMonthly,
        netMonthly,
        exceedsCapacity,
      };
    });

    return { portedDebt, overwaarde, scenarios };
  }, [purchasePrice, rate, calc, hasExistingHome, currentMortgage, additionalLoanParts, todayIso]);

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
    const taxBenefit = deductibleInterest * HRA_RATE;
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
      calc.incomeBasedMaxAtActualRate - currentMortgage.rateRiskCapacityHaircut - rateRiskHaircut
    );
    const totalDebtAfterMove = currentMortgage.currentDebtBalance + totalPrincipal;
    const capacityMargin = effectiveCapacity - totalDebtAfterMove;
    const withinIncomeCapacity = capacityMargin >= 0;
    const exceedsLenderCap = totalDebtAfterMove > LENDER_CAP_THRESHOLD;

    // B10-stijl: de totale hypotheek (meegenomen plus nieuw) kan nooit boven de aanschafprijs
    // van de beoogde woning uitkomen (maximale LTV van 100%).
    const priceNum = safeNum(purchasePrice);
    const newLtv = priceNum > 0 ? (totalDebtAfterMove / priceNum) * 100 : 0;
    const withinLtvCap = priceNum === 0 || totalDebtAfterMove <= priceNum;

    // Bancaire norm: maximaal 50% van de woningwaarde mag aflossingsvrij gefinancierd
    // worden, over de meegenomen én de nieuwe leningdelen samen.
    const portedAflossingsvrij = loanParts
      .filter((p) => p.type === 'Aflossingsvrij')
      .reduce((sum, p) => sum + safeNum(p.principal), 0);
    const newAflossingsvrij = additionalLoanParts
      .filter((p) => p.type === 'Aflossingsvrij')
      .reduce((sum, p) => sum + safeNum(p.principal), 0);
    const totalAflossingsvrij = portedAflossingsvrij + newAflossingsvrij;
    const maxAflossingsvrij = priceNum * 0.5;
    const aflossingsvrijRoomRemaining = Math.max(0, maxAflossingsvrij - portedAflossingsvrij);
    const withinAflossingsvrijCap = totalAflossingsvrij <= maxAflossingsvrij;

    const withinCapacity = withinIncomeCapacity && withinLtvCap && withinAflossingsvrijCap;
    const matchesRequiredAmount =
      Math.abs(totalPrincipal - combinedGapCalc.additionalMortgage) < 1;

    return {
      totalPrincipal,
      totalGross,
      totalInterest,
      totalAflossing,
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
    };
  }, [additionalLoanParts, todayIso, calc, currentMortgage, purchasePrice, loanParts, combinedGapCalc]);

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

  // Maximaal aankoopbudget: eigen vermogen, overwaarde, de meegenomen hypotheek en de
  // maximale extra bijleenruimte (inkomensgebaseerd, al gecorrigeerd voor renterisico) samen
  // vormen het hoogste bedrag dat voor de beoogde woning neergelegd kan worden.
  const maxBudgetCalc = useMemo(() => {
    const eigenVermogen = calc.totalOwnCapital;
    const overwaarde = currentMortgage.usableOverwaarde;
    const oudeHypotheek = currentMortgage.currentDebtBalance;
    const nieuweHypotheekMax = currentMortgage.extraBorrowCapacity;
    const maxBudget = eigenVermogen + overwaarde + oudeHypotheek + nieuweHypotheekMax;
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
      loanParts.forEach((part) => {
        portedBalance += projectRemainingBalance(
          part.principal,
          part.rate,
          part.type,
          portedRemainingMonthsNow,
          monthsFromNow
        );
      });
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
  }, [loanParts, additionalLoanParts, elapsedMonthsSinceStart]);

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
    const kostenKoper = getKostenKoperCosts(price);
    const ownCapitalUsed = includeOwnCapitalInDoubleTest ? calc.totalOwnCapital : 0;
    const newMortgageAmount = Math.max(0, price + kostenKoper - ownCapitalUsed);

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
    const combinedBruto = oldMortgageBruto + newMortgageBruto;

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
    liquidityBuffer,
  ]);

  // Eén samenvattend eindoordeel voor de voortgangsbalk: haalbaar zonder bestaande woning
  // betekent dat de inkomensgebaseerde leencapaciteit de aanschafprijs dekt, met een
  // bestaande woning betekent het dat het financieringsgat (indien van toepassing) binnen de
  // bijleenruimte past.
  const overallAffordable = hasExistingHome
    ? combinedGapCalc.withinCapacity
    : calc.incomeBasedMax >= safeNum(purchasePrice);

  // Stappen voor de voortgangsbalk. Schulden heeft geen eigen verplicht veld (0 is een
  // geldig antwoord), dus die stap wordt als "bereikt" beschouwd zodra Inkomen is ingevuld
  // in plaats van hem altijd als voltooid te tonen.
  const incomeStepDone = calc.combinedIncome > 0;
  const debtsStepDone = incomeStepDone;
  const propertyStepDone = safeNum(purchasePrice) > 0;
  const progressSteps = [incomeStepDone, debtsStepDone, propertyStepDone, overallAffordable];
  const progressPercentage =
    (progressSteps.filter(Boolean).length / progressSteps.length) * 100;

  const scrollToSection = (id) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="w-full px-4 py-10 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-6xl">
        <div className="sticky top-0 z-40 -mx-4 mb-6 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur-sm sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-4 gap-y-2 sm:justify-between">
            <button
              type="button"
              onClick={() => scrollToSection('sectie-inkomen')}
              className="flex items-center gap-1.5 text-xs font-medium text-slate-600 transition-all duration-200 hover:text-blue-600"
            >
              <CheckCircle2
                className={`h-3.5 w-3.5 ${
                  calc.combinedIncome > 0 ? 'text-emerald-500' : 'text-slate-300'
                }`}
              />
              Inkomen
            </button>
            <span className="hidden h-px w-6 bg-slate-200 sm:block" />
            <button
              type="button"
              onClick={() => scrollToSection('sectie-schulden')}
              className="flex items-center gap-1.5 text-xs font-medium text-slate-600 transition-all duration-200 hover:text-blue-600"
            >
              <CheckCircle2
                className={`h-3.5 w-3.5 ${debtsStepDone ? 'text-emerald-500' : 'text-slate-300'}`}
              />
              Schulden
            </button>
            <span className="hidden h-px w-6 bg-slate-200 sm:block" />
            <button
              type="button"
              onClick={() => scrollToSection('sectie-beoogde-woning')}
              className="flex items-center gap-1.5 text-xs font-medium text-slate-600 transition-all duration-200 hover:text-blue-600"
            >
              <CheckCircle2
                className={`h-3.5 w-3.5 ${
                  safeNum(purchasePrice) > 0 ? 'text-emerald-500' : 'text-slate-300'
                }`}
              />
              Beoogde woning
            </button>
            {hasExistingHome && (
              <>
                <span className="hidden h-px w-6 bg-slate-200 sm:block" />
                <button
                  type="button"
                  onClick={() => scrollToSection('sectie-huidige-woning')}
                  className="flex items-center gap-1.5 text-xs font-medium text-slate-600 transition-all duration-200 hover:text-blue-600"
                >
                  <CheckCircle2
                    className={`h-3.5 w-3.5 ${
                      safeNum(marketValue) > 0 ? 'text-emerald-500' : 'text-slate-300'
                    }`}
                  />
                  Huidige woning
                </button>
              </>
            )}
            <span className="hidden h-px w-6 bg-slate-200 sm:block" />
            <button
              type="button"
              onClick={() => scrollToSection('sectie-resultaat')}
              className={`flex items-center gap-1.5 text-xs font-semibold transition-all duration-200 ${
                overallAffordable
                  ? 'text-emerald-600 hover:text-emerald-700'
                  : 'text-red-600 hover:text-red-700'
              }`}
            >
              {overallAffordable ? (
                <CheckCircle2 className="h-3.5 w-3.5" />
              ) : (
                <AlertTriangle className="h-3.5 w-3.5" />
              )}
              {overallAffordable ? 'Haalbaar' : 'Nog niet haalbaar'}
            </button>
          </div>
          <div className="mx-auto mt-2 h-1 w-full max-w-6xl overflow-hidden rounded-full bg-slate-100">
            <motion.div
              className={`h-full rounded-full ${
                calc.isOverIndebted
                  ? 'bg-red-500'
                  : progressPercentage < 100
                  ? 'bg-blue-500'
                  : overallAffordable
                  ? 'bg-emerald-500'
                  : 'bg-amber-500'
              }`}
              initial={false}
              animate={{ width: `${progressPercentage}%` }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
            />
          </div>
        </div>

        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">Hypotheekcalculator 2026</h1>
          <p className="mt-1 text-sm text-slate-500">
            Indicatieve berekening op basis van de Nibud-systematiek 2026. Geen rechten kunnen aan
            deze uitkomst worden ontleend.
          </p>
        </div>

        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <div>
            <span className="text-sm font-medium text-slate-700">Uw situatie</span>
            <p className="text-xs text-slate-400">
              Heeft u op dit moment al een eigen woning met hypotheek?
            </p>
          </div>
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
            <button
              type="button"
              onClick={() => setHasExistingHome(true)}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-all duration-200 ${
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
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-all duration-200 ${
                !hasExistingHome
                  ? 'bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Nee, nog geen woning
            </button>
          </div>
        </div>

        <AnimatePresence>
          {calc.showPensionWarning && (
            <motion.div
              initial={{ opacity: 0, y: -8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.98 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
              className="mb-6 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm"
            >
              <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-500" />
              <p className="text-sm text-amber-800">
                <span className="font-semibold">Let op:</span> Vanwege de naderende pensioenleeftijd
                moet er wettelijk getoetst worden op het (vaak lagere) pensioeninkomen.
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5 lg:items-start">
          <div className="space-y-6 lg:col-span-3 lg:row-start-1">
            <SectionCard id="sectie-inkomen" title="Inkomen" icon={<Euro className="h-4 w-4" />}>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <PartnerSubCard label="Partner 1">
                  <Slider
                    id="income1"
                    label="Bruto jaarinkomen"
                    icon={<Euro className="h-3.5 w-3.5 text-slate-400" />}
                    value={income1}
                    min={0}
                    max={150000}
                    step={1000}
                    onChange={setIncome1}
                    formatValue={formatEuro}
                  />
                  <Slider
                    id="ownCapital1"
                    label="Inbreng eigen vermogen"
                    icon={<PiggyBank className="h-3.5 w-3.5 text-slate-400" />}
                    value={ownCapital1}
                    min={0}
                    max={200000}
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
                    placeholder="35"
                    suffix="jaar"
                    min={18}
                    max={100}
                  />
                </PartnerSubCard>
                <PartnerSubCard label="Partner 2">
                  <Slider
                    id="income2"
                    label="Bruto jaarinkomen"
                    icon={<Euro className="h-3.5 w-3.5 text-slate-400" />}
                    value={income2}
                    min={0}
                    max={150000}
                    step={1000}
                    onChange={setIncome2}
                    formatValue={formatEuro}
                  />
                  <Slider
                    id="ownCapital2"
                    label="Inbreng eigen vermogen"
                    icon={<PiggyBank className="h-3.5 w-3.5 text-slate-400" />}
                    value={ownCapital2}
                    min={0}
                    max={200000}
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
                    placeholder="34"
                    suffix="jaar"
                    min={18}
                    max={100}
                  />
                </PartnerSubCard>
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

            <SectionCard id="sectie-schulden" title="Schulden" icon={<CreditCard className="h-4 w-4" />}>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <PartnerSubCard label="Partner 1">
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
                </PartnerSubCard>
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
                </PartnerSubCard>
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium text-slate-600">Studieschuld stelsel</span>
                <div className="inline-flex rounded-lg border border-slate-100 bg-slate-50 p-1">
                  <button
                    type="button"
                    onClick={() => setStudyDebtRegime('nieuw')}
                    className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-all duration-200 ${
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
                    className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-all duration-200 ${
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
            </SectionCard>
          </div>

          <div id="sectie-resultaat" className="lg:sticky lg:top-10 lg:col-span-2 lg:col-start-4 lg:row-start-1">
            <div className="rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 p-7 text-white shadow-xl">
              <div className="mb-6 flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/15">
                  <Euro className="h-4 w-4" />
                </span>
                <h2 className="text-base font-semibold">Resultaat</h2>
              </div>

              <div
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
              </div>

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
                  <p className="text-sm text-blue-100">Geschat eigen geld (kosten koper, 3,5%)</p>
                  <p className="text-lg font-semibold">{formatEuro(calc.ownMoney)}</p>
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-sm text-blue-100">Ingebracht eigen vermogen</p>
                  <p className="text-sm font-medium">{formatEuro(calc.totalOwnCapital)}</p>
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-sm text-blue-100">Gezamenlijk bruto inkomen</p>
                  <p className="text-sm font-medium">{formatEuro(calc.combinedIncome)}</p>
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-sm text-blue-100">Woonquote (Nibud 2026)</p>
                  <p className="text-sm font-medium">
                    {(calc.woonquote * 100).toFixed(1).replace('.', ',')}%
                  </p>
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-sm text-blue-100">Max. bruto woonlast p/m</p>
                  <p className="text-sm font-medium">{formatEuro(calc.maxWoonlastMonthly)}</p>
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-sm text-blue-100">Effectieve leenfactor</p>
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
            </div>
          </div>
        </div>

        <div className="mt-8">
          <SectionCard id="sectie-beoogde-woning" title="Beoogde woning" icon={<Home className="h-4 w-4" />}>
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
                label="Hypotheekrente"
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
                  <StatusBadge status="warning">
                    Bij een rentevastperiode korter dan 10 jaar moet wettelijk met de
                    AFM-toetsrente van {formatRate(TOETSRENTE)} worden getoetst in plaats van de
                    daadwerkelijke rente. Uw leencapaciteit is hierop gebaseerd.
                  </StatusBadge>
                </motion.div>
              )}
            </AnimatePresence>
          </SectionCard>
        </div>

        {hasExistingHome && (
        <div id="sectie-huidige-woning" className="mt-8 overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-xl">
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
                        className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-all duration-200 ${
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
                        className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-all duration-200 ${
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
                          className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-all duration-200 ${
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
                          className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-all duration-200 ${
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
                      <div className="mt-5 grid grid-cols-1 gap-3 rounded-xl border border-slate-100 bg-white p-4 text-xs text-slate-500 sm:grid-cols-3">
                        <div className="flex items-center justify-between sm:flex-col sm:items-start sm:gap-1">
                          <span>Belastingvoordeel HRA (37,56%)</span>
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
                          <StatusBadge status="info">
                            Let op: Geen verplichte aflossing, maar ook geen
                            hypotheekrenteaftrek als dit deel na 2013 is afgesloten (tenzij
                            overgangsrecht).
                          </StatusBadge>
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

                  <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-6">
                    <div className="mb-3 flex items-center gap-2">
                      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600">
                        <TrendingUp className="h-4 w-4" />
                      </span>
                      <h3 className="text-sm font-semibold text-slate-700">
                        Extra bijleenruimte bij verkoop huidige woning
                      </h3>
                    </div>
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
                      {currentMortgage.hasRateRiskOnPortedDebt && (
                        <motion.div
                          initial={{ opacity: 0, y: 8, scale: 0.97 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: 8, scale: 0.97 }}
                          transition={{ duration: 0.25, ease: 'easeOut' }}
                          className="mt-4"
                        >
                          <StatusBadge status="warning">
                            Let op: een deel van uw mee te nemen hypotheek heeft een
                            rentevastperiode korter dan 10 jaar tegen een rente onder de
                            AFM-toetsrente van {formatRate(TOETSRENTE)}. Voor de leencapaciteit
                            wordt dit deel getoetst tegen de toetsrente in plaats van de
                            daadwerkelijke, lagere rente. Dit verlaagt uw leencapaciteit met{' '}
                            {formatEuro(currentMortgage.rateRiskCapacityHaircut)}, van{' '}
                            {formatEuro(calc.incomeBasedMax)} naar een werkelijke leencapaciteit
                            van {formatEuro(currentMortgage.effectiveMaxMortgage)}. Dit werkt
                            door in uw bijleenruimte, het financieringsgat en de resterende
                            aanvullende hypotheek hieronder.
                          </StatusBadge>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    <div className="mt-5 rounded-xl border border-slate-100 bg-white p-4">
                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Financieringsgat beoogde woning
                      </span>
                      <p className="mt-1 text-xs text-slate-400">
                        Bij verkoop wordt de bestaande hypotheek meegenomen tegen de oude
                        voorwaarden en komt de overwaarde daarnaast vrij als eigen inbreng.
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
                          <span className="text-xs text-slate-400">Overdrachtsbelasting (2%)</span>
                          <p className="text-sm font-semibold text-slate-800">
                            {formatEuro(newHomeCalc.transferTax)}
                          </p>
                        </div>
                        <div>
                          <span className="text-xs text-slate-400">
                            Overige kosten koper (indicatief 1,5%)
                          </span>
                          <p className="text-sm font-semibold text-slate-800">
                            {formatEuro(newHomeCalc.otherCosts)}
                          </p>
                          <span className="text-[11px] text-slate-400">
                            Notaris, taxatie, hypotheekadvies
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
                        </div>
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
                                {formatEuro(combinedGapCalc.totalMortgageAfterMove)}, boven de{' '}
                                {formatEuro(LENDER_CAP_THRESHOLD)} grens die sommige
                                geldverstrekkers hanteren. Dit kan aanvullende acceptatie-eisen
                                of een ander acceptatietraject betekenen.
                              </StatusBadge>
                            </div>
                          )}

                          {combinedGapCalc.withinCapacity ? (
                            <div className="mt-4">
                              <StatusBadge status="success">
                                Haalbaar: de aanvullende hypotheek past, uitgaande van uw
                                werkelijke leencapaciteit van{' '}
                                {formatEuro(currentMortgage.effectiveMaxMortgage)}, binnen uw
                                bijleenruimte, met nog {formatEuro(combinedGapCalc.capacityMargin)}{' '}
                                marge.
                              </StatusBadge>
                            </div>
                          ) : (
                            <div className="mt-4">
                              <StatusBadge status="error">
                                Nog niet haalbaar: uitgaande van uw werkelijke leencapaciteit van{' '}
                                {formatEuro(currentMortgage.effectiveMaxMortgage)} overschrijdt de
                                aanvullende hypotheek uw bijleenruimte met{' '}
                                {formatEuro(-combinedGapCalc.capacityMargin)}. Verhoog de inbreng
                                eigen vermogen hierboven om dit te overbruggen.
                              </StatusBadge>
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

                    <div className="mt-5 rounded-2xl border border-indigo-100 bg-indigo-50/40 p-6">
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600">
                            <Building2 className="h-4 w-4" />
                          </span>
                          <h3 className="text-sm font-semibold text-slate-700">
                            Toetsing aanvullende hypotheek
                          </h3>
                        </div>
                        <button
                          type="button"
                          onClick={autoDistributeAdditionalLoan}
                          className="rounded-lg border border-indigo-200 bg-white px-3 py-1.5 text-xs font-medium text-indigo-600 transition-all duration-200 hover:bg-indigo-50"
                        >
                          Automatisch verdelen
                        </button>
                      </div>
                      <p className="mb-4 text-xs text-slate-500">
                        De resterende aanvullende hypotheek van{' '}
                        {formatEuro(combinedGapCalc.additionalMortgage)} hierboven kunt u hier
                        opsplitsen in maximaal 2 nieuwe leningdelen, elk met een eigen aflosvorm,
                        rekenrente en rentevastperiode, om te toetsen of dit bedrag ook
                        daadwerkelijk geleend kan worden tegen de huidige normen.
                      </p>

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
                            Boven de {formatEuro(LENDER_CAP_THRESHOLD)} grens die sommige
                            geldverstrekkers hanteren voor de totale hypotheeksom, mogelijk
                            aanvullende acceptatie-eisen.
                          </p>
                        )}
                      </div>

                      <div className="mt-4 rounded-xl border border-slate-100 bg-white p-4">
                        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Aflossingsvrij (max. 50% van de woningwaarde)
                        </span>
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
                            <span className="text-xs text-slate-400">Totaal / maximum 50%</span>
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
                            Dit overschrijdt de 50% aflossingsvrij-norm die de meeste banken
                            hanteren.
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
                              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-all duration-200 ${
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
                              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-all duration-200 ${
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
                            Belastingvoordeel HRA (37,56%): {formatEuro(additionalLoanCalc.taxBenefit)}{' '}
                            per maand. Eigenwoningforfait is hier niet apart verwerkt, aangezien
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
                            <StatusBadge status="warning">
                              Voor de leencapaciteitstoets hieronder is uw effectieve capaciteit
                              verlaagd met {formatEuro(additionalLoanCalc.rateRiskHaircut)}{' '}
                              vanwege een rentevastperiode korter dan 10 jaar op één of meer
                              nieuwe leningdelen.
                            </StatusBadge>
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
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="mt-8 rounded-2xl border border-slate-100 bg-white p-6 shadow-xl">
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

          <div className="mt-8 rounded-2xl border border-slate-100 bg-white p-6 shadow-xl">
            <div className="mb-2 flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                <TrendingUp className="h-4 w-4" />
              </span>
              <h2 className="text-base font-semibold text-slate-800">
                Aflossing komende dertig jaar
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
          </div>

          <div className="mt-8 overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-xl">
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
                          className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-all duration-200 ${
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
                          className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-all duration-200 ${
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
                          className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-all duration-200 ${
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
                          className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-all duration-200 ${
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
                          Incl. {formatEuro(doubleCostsCalc.kostenKoper)} kosten koper, zonder
                          overwaarde
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
                          Gecombineerde bruto maandlast (beide hypotheken)
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
                        Overweeg eerst te verkopen, een overbruggingskrediet, of extra eigen
                        inbreng.
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

        <p className="mt-6 text-center text-[11px] text-slate-400">
          v{typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0'}
          {typeof __GIT_COMMIT__ !== 'undefined' && __GIT_COMMIT__ !== 'dev' ? ` · ${__GIT_COMMIT__}` : ''}
        </p>
      </div>
    </div>
  );
}
