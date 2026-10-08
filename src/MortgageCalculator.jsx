import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
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
  Link2,
  Save,
  FolderOpen,
  X,
  Wand2,
  SlidersHorizontal,
} from 'lucide-react';
import OptionalPropertyDataModule from './OptionalPropertyDataModule';
import ScenarioAnalysis from './ScenarioAnalysis';
import BorderGlow from './BorderGlow';
import SectionRail, { useScrollSpy } from './SectionRail';
import { getBouwdepotEstimate } from './bouwdepot';
import { buildCapacityBreakdown } from './capacityBreakdown';
import { INCOME_TYPES } from './toetsinkomen';
import {
  AFSLAG_METHODS,
  DEBETRENTE_MODES,
  STUDY_LOAN_PRESETS,
  STUDY_LOAN_STATUSES,
  optimizeRepayment,
  projectRateRevision,
} from './studieschuld';
import {
  STARTER_EXEMPTION_PRICE_CAP,
  STARTER_EXEMPTION_MIN_AGE,
  STARTER_EXEMPTION_MAX_AGE,
  KOSTEN_KOPER_DEFAULTS,
} from './kostenKoper';
import {
  ENERGY_LABELS,
  AFLOSVORMEN,
  TERM_MONTHS,
  getHraRate,
  EWF_RATE,
  EWF_CAP,
  SCENARIO_PERCENTAGES,
  TOETSRENTE,
  LENDER_CAP_THRESHOLD_DEFAULT,
  getLenderCap,
  getCapitalizationFactor,
  getTestRate,
  getElapsedMonths,
  getRemainingFixedPeriod,
  projectRemainingBalance,
  toCurrentLoanParts,
  calculateLoanPart,
  safeNum,
  DOSSIER_DEFAULTS,
  DOSSIER_STORAGE_KEY,
  SCENARIOS_STORAGE_KEY,
  UI_MODE_STORAGE_KEY,
  fillDossierDefaults,
  computeScenarioSummary,
  computeStarterGap,
  computeCore,
  computeMaxBudget,
  SOLVER_PRICE_CEILING,
  solveAffordabilityLevers,
} from './calcEngine';

function formatDateNL(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' }).format(d);
}

function getTodayIsoLocal() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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

// Compacte Ja/Nee-toggle om aan te geven of ingebracht eigen vermogen nu al liquide is, of
// pas later vrijkomt (bijv. bij de verkoop van een aangehouden tweede woning). Alleen
// getoond als er daadwerkelijk een bedrag is ingevuld.
function LiquidityToggle({ amount, liquid, onChange }) {
  if (safeNum(amount) <= 0) return null;
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
      <span className="text-xs text-slate-500">Nu al liquide beschikbaar?</span>
      <div className="inline-flex rounded-md border border-slate-200 bg-white p-0.5">
        <button
          type="button"
          onClick={() => onChange(true)}
          className={`rounded px-2.5 py-1 text-[11px] font-semibold transition-all duration-200 ${
            liquid
              ? 'bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-sm'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Ja
        </button>
        <button
          type="button"
          onClick={() => onChange(false)}
          className={`rounded px-2.5 py-1 text-[11px] font-semibold transition-all duration-200 ${
            !liquid
              ? 'bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-sm'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Pas later
        </button>
      </div>
    </div>
  );
}

function NumberField({ id, label, icon, value, onChange, placeholder, suffix, hint, min = 0, max, step }) {
  // Klemt tijdens het typen alleen de max (voorkomt absurd hoge invoer zonder het typen van
  // een lagere waarde te blokkeren); de min wordt pas bij het verlaten van het veld
  // toegepast, zodat je bijv. van 36 naar 28 kunt tikken zonder dat elke tussenstap al op
  // min wordt vastgezet.
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
    if (max !== undefined && clamped > max) clamped = max;
    onChange(String(clamped));
  };

  const handleBlur = () => {
    if (value === '' || value === undefined) return;
    const num = parseFloat(value);
    if (isNaN(num)) return;
    let clamped = num;
    if (min !== undefined && clamped < min) clamped = min;
    if (max !== undefined && clamped > max) clamped = max;
    if (clamped !== num) onChange(String(clamped));
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
          step={step}
          value={value}
          onChange={handleChange}
          onBlur={handleBlur}
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

function LoanPartCard({ part, index, onChange, onRemove, canRemove, elapsedMonths, currentBalance }) {
  const fixedPeriod = getRemainingFixedPeriod(part.originalFixedYears, elapsedMonths);
  const testRate = getTestRate(part.rate, fixedPeriod.fractionalYears);
  const toetsrenteAppliesToPart = testRate !== safeNum(part.rate);
  const hasAnchor =
    String(part.knownBalance ?? '').trim() !== '' && !isNaN(new Date(part.balanceAsOf).getTime());

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
      <div className="space-y-2">
        <CurrencyField
          id={`principal-${part.id}`}
          label="Hoofdsom bij aanvang"
          icon={<Euro className="h-3.5 w-3.5 text-slate-400" />}
          value={part.principal}
          onChange={(v) => onChange('principal', v)}
          placeholder="0"
        />
        <CurrencyField
          id={`known-balance-${part.id}`}
          label="Restsaldo volgens uw bank (optioneel)"
          icon={<Euro className="h-3.5 w-3.5 text-slate-400" />}
          value={part.knownBalance ?? ''}
          onChange={(v) => onChange('knownBalance', v)}
          placeholder="Leeg = berekend uit hoofdsom"
        />
        <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 bg-white px-3 py-2">
          <span className="text-xs text-slate-500">Restschuld per {formatDateNL(new Date())}</span>
          <span className="text-sm font-semibold text-slate-800">{formatEuro(currentBalance)}</span>
        </div>
        <p className="text-[11px] text-slate-400">
          {hasAnchor
            ? `Restsaldo uit uw hypotheekoverzicht van ${formatDateNL(part.balanceAsOf)}${
                part.type === 'Aflossingsvrij'
                  ? ' (aflossingsvrij: blijft gelijk).'
                  : ', doorgerekend tot vandaag met uw rente en looptijd.'
              }`
            : part.type === 'Aflossingsvrij'
              ? 'Aflossingsvrij: de restschuld blijft gelijk aan de hoofdsom.'
              : `Berekend uit rente en ingangsdatum: ${elapsedMonths} ${
                  elapsedMonths === 1 ? 'maandtermijn' : 'maandtermijnen'
                } betaald (30 jaar looptijd, zonder extra aflossingen).`}
        </p>
      </div>
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

// Violet, schuin-gearceerde vulling voor de kosten-koper-zone: bewust géén effen kleur zoals
// de financieringsbron-segmenten, zodat direct duidelijk is dat dit geen extra bron is maar
// een kostenpost die een deel van het budget opslokt. Violet sluit aan op de Kosten
// koper-kaart (border-l-violet-400).
const KOSTEN_KOPER_HATCH =
  'repeating-linear-gradient(45deg, rgba(139,92,246,0.60) 0, rgba(139,92,246,0.60) 4px, rgba(139,92,246,0.18) 4px, rgba(139,92,246,0.18) 8px)';

function BudgetBar({ segments, total, marker, markerLabel = 'Aanschafprijs beoogde woning', costZone }) {
  const zoneEnd = costZone ? costZone.start + costZone.amount : null;
  const safeTotal = Math.max(total, marker || 0, zoneEnd || 0, 1);
  const pctOf = (v) => Math.min(100, Math.max(0, (v / safeTotal) * 100));
  const markerPct = marker != null ? pctOf(marker) : null;
  const zoneStartPct = costZone ? pctOf(costZone.start) : null;
  const zoneEndPct = zoneEnd != null ? pctOf(zoneEnd) : null;

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
        {/* Kosten-koper-zone: het stuk vanaf de aanschafprijs dat aan kosten koper opgaat en
            dus niet meer voor de woning zelf beschikbaar is. */}
        {costZone && zoneEndPct - zoneStartPct > 0 && (
          <div
            className="pointer-events-none absolute top-0 h-9 border-x border-violet-500/70"
            style={{
              left: `${zoneStartPct}%`,
              width: `${zoneEndPct - zoneStartPct}%`,
              backgroundImage: KOSTEN_KOPER_HATCH,
            }}
            title={`${costZone.label}: ${formatEuro(costZone.amount)}`}
          />
        )}
        {markerPct != null && (
          <div
            className="absolute top-0 flex h-9 flex-col items-center"
            style={{ left: `${markerPct}%`, transform: 'translateX(-50%)' }}
          >
            <div className="h-9 w-0.5 bg-slate-900" />
          </div>
        )}
        {/* Tweede markering: totaal benodigd = aanschafprijs + kosten koper. */}
        {costZone && zoneEndPct != null && zoneEndPct - (markerPct || 0) > 0.3 && (
          <div
            className="absolute top-0 flex h-9 flex-col items-center"
            style={{ left: `${zoneEndPct}%`, transform: 'translateX(-50%)' }}
          >
            <div className="h-9 w-0.5 bg-violet-600" />
          </div>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
        {segments.map((seg, i) => {
          if (Math.max(0, seg.value) <= 0) return null;
          return (
            <div key={i} className="flex items-center gap-1.5 text-xs text-slate-600">
              <span className={`h-2.5 w-2.5 rounded-sm ${seg.dotClassName}`} />
              {seg.label}: <span className="font-semibold text-slate-800">{formatEuro(seg.value)}</span>
            </div>
          );
        })}
        {marker != null && (
          <div className="flex items-center gap-1.5 text-xs text-slate-600">
            <span className="h-2.5 w-0.5 bg-slate-900" />
            {markerLabel}: <span className="font-semibold text-slate-800">{formatEuro(marker)}</span>
          </div>
        )}
        {costZone && (
          <div className="flex items-center gap-1.5 text-xs text-slate-600">
            <span
              className="h-2.5 w-2.5 rounded-sm border border-violet-500/70"
              style={{ backgroundImage: KOSTEN_KOPER_HATCH }}
            />
            {costZone.label}:{' '}
            <span className="font-semibold text-slate-800">{formatEuro(costZone.amount)}</span>
          </div>
        )}
        {costZone && zoneEnd != null && (
          <div className="flex items-center gap-1.5 text-xs text-slate-600">
            <span className="h-2.5 w-0.5 bg-violet-600" />
            Totaal benodigd (incl. kosten koper):{' '}
            <span className="font-semibold text-slate-800">{formatEuro(zoneEnd)}</span>
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

// ---------------------------------------------------------------------------------------
// Studieschuld (DUO): per lening termijn, opslagfactor, toetslast en afslag, plus een
// aflos-optimalisatie. De rekenregels staan in studieschuld.js en README.md.
// ---------------------------------------------------------------------------------------

function formatPct3(value) {
  return safeNum(value).toFixed(3).replace('.', ',') + '%';
}

function formatFactor(value) {
  return safeNum(value).toFixed(2).replace('.', ',');
}

function SegmentedToggle({ value, onChange, options, label }) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex flex-wrap rounded-lg border border-slate-100 bg-slate-50 p-1"
    >
      {options.map(([key, text]) => (
        <button
          key={key}
          type="button"
          aria-pressed={value === key}
          onClick={() => onChange(key)}
          className={`rounded-md px-3 py-2 sm:py-1.5 text-xs font-semibold transition-all duration-200 ${
            value === key
              ? 'bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-sm'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

const TERMIJN_SOURCE_LABELS = {
  duo: 'werkelijk DUO-maandbedrag',
  schatting: 'geschat als annuïteit — vul uw DUO-maandbedrag in',
  annuiteit: 'annuïteit op restschuld, rente en looptijd',
  geen: 'geen restschuld',
};

function StudyLoanCard({ loan, label, result, onChange, onRemove }) {
  const revision = projectRateRevision({
    loan: {
      balance: safeNum(loan.balance),
      ratePct: safeNum(loan.ratePct),
      remainingMonths: safeNum(loan.remainingMonths),
      monthlyPayment: safeNum(loan.monthlyPayment),
      status: loan.status,
      revisionDate: loan.revisionDate,
      revisionRatePct: loan.revisionRatePct,
    },
    factor: result ? result.factor : 0,
  });
  const idp = `study-${loan.id}`;

  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <GraduationCap className="h-3.5 w-3.5" />
          {label}
        </span>
        <button
          type="button"
          onClick={onRemove}
          className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-slate-400 transition-all duration-200 hover:bg-red-50 hover:text-red-500"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Verwijderen
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <CurrencyField
          id={`${idp}-balance`}
          label="Restschuld"
          icon={<Euro className="h-3.5 w-3.5 text-slate-400" />}
          value={loan.balance}
          onChange={(v) => onChange('balance', v)}
          placeholder="0"
        />
        <NumberField
          id={`${idp}-rate`}
          label="DUO-rente"
          icon={<Percent className="h-3.5 w-3.5 text-slate-400" />}
          value={loan.ratePct}
          onChange={(v) => onChange('ratePct', v)}
          suffix="%"
          step="0.01"
          min={0}
          max={15}
        />
        <NumberField
          id={`${idp}-months`}
          label="Resterende looptijd"
          icon={<CalendarDays className="h-3.5 w-3.5 text-slate-400" />}
          value={loan.remainingMonths}
          onChange={(v) => onChange('remainingMonths', v)}
          suffix="mnd"
          min={0}
          max={600}
        />
        <CurrencyField
          id={`${idp}-payment`}
          label="Werkelijk DUO-maandbedrag (optioneel)"
          icon={<Euro className="h-3.5 w-3.5 text-slate-400" />}
          value={loan.monthlyPayment}
          onChange={(v) => onChange('monthlyPayment', v)}
          placeholder="Leeg = berekend"
          hint="Rente + aflossing, zoals DUO het vastgesteld heeft"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor={`${idp}-status`} className="text-sm font-medium text-slate-700">
          Status van de lening
        </label>
        <select
          id={`${idp}-status`}
          value={loan.status}
          onChange={(e) => onChange('status', e.target.value)}
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-base text-slate-800 outline-none transition-all duration-200 focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
        >
          {Object.entries(STUDY_LOAN_STATUSES).map(([key, text]) => (
            <option key={key} value={key}>
              {text}
            </option>
          ))}
        </select>
        {loan.status !== 'regulier' && (
          <p className="text-xs text-slate-400">
            Bij een aanloopfase, aflosvrije periode of verlaagd maandbedrag (draagkracht) telt niet
            het huidige DUO-bedrag, maar een annuïteit op de actuele restschuld, rente en
            resterende looptijd.
          </p>
        )}
      </div>

      <AdvancedFieldsToggle label="Geplande renteherziening (optioneel)">
        <DateField
          id={`${idp}-revdate`}
          label="Datum renteherziening"
          icon={<CalendarDays className="h-3.5 w-3.5 text-slate-400" />}
          value={loan.revisionDate}
          onChange={(v) => onChange('revisionDate', v)}
        />
        <NumberField
          id={`${idp}-revrate`}
          label="Nieuwe DUO-rente"
          icon={<Percent className="h-3.5 w-3.5 text-slate-400" />}
          value={loan.revisionRatePct}
          onChange={(v) => onChange('revisionRatePct', v)}
          suffix="%"
          step="0.01"
          min={0}
          max={15}
        />
      </AdvancedFieldsToggle>

      {result && (
        <div className="rounded-lg border border-slate-100 bg-white p-3">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
            <div>
              <dt className="text-slate-400">Termijnbedrag</dt>
              <dd className="text-sm font-semibold text-slate-800">{formatEuro(result.termijn)}</dd>
            </div>
            <div>
              <dt className="text-slate-400">Opslagfactor</dt>
              <dd className="text-sm font-semibold text-slate-800">{formatFactor(result.factor)}</dd>
            </div>
            <div>
              <dt className="text-slate-400">Toetslast p/m</dt>
              <dd className="text-sm font-semibold text-slate-800">{formatEuro(result.toetslast)}</dd>
            </div>
            <div>
              <dt className="text-slate-400">Afslag hypotheek</dt>
              <dd className="text-sm font-semibold text-red-600">−{formatEuro(result.afslag)}</dd>
            </div>
          </dl>
          <p className="mt-2 text-[11px] text-slate-400">
            Termijn: {TERMIJN_SOURCE_LABELS[result.termijnSource]}.
          </p>
          {result.warning && <p className="mt-1 text-xs text-amber-600">{result.warning}</p>}
        </div>
      )}

      {revision && (
        <div className="rounded-lg border border-blue-100 bg-blue-50/60 p-3 text-xs text-blue-900">
          <p className="font-semibold">
            Renteherziening over {revision.monthsUntilRevision}{' '}
            {revision.monthsUntilRevision === 1 ? 'maand' : 'maanden'}
          </p>
          <p className="mt-1">
            Toetslast vóór: <strong>{formatEuro(revision.toetslastBefore)}</strong> per maand
            (termijn {formatEuro(revision.termijnBefore)}). Na de herziening:{' '}
            <strong>{formatEuro(revision.toetslastAfter)}</strong> per maand (termijn{' '}
            {formatEuro(revision.termijnAfter)}, restschuld op die datum{' '}
            {formatEuro(revision.balanceAtRevision)}). De leencapaciteit rekent met de toetslast van
            nu.
          </p>
        </div>
      )}
    </div>
  );
}

function StudyRepaymentOptimizer({ study, budget, onBudgetChange, labelFor }) {
  const optimization = optimizeRepayment({
    perLoan: study.perLoan,
    budget: safeNum(budget),
    factor: study.factor,
    paymentFactor: study.paymentFactor,
  });
  const hasBudget = safeNum(budget) > 0;
  const byId = Object.fromEntries(optimization.rows.map((r) => [r.id, r]));
  const ranked = optimization.ranking.map((id) => byId[id]);

  return (
    <div className="mt-5 rounded-xl border border-indigo-100 bg-indigo-50/40 p-4">
      <h4 className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
        <PiggyBank className="h-4 w-4 text-indigo-500" />
        Aflos-optimalisatie
      </h4>
      <p className="mt-1 text-xs text-slate-500">
        Welke studielening loont het meest om af te lossen? De volgorde is op extra leenruimte per
        afgeloste euro.
      </p>
      <div className="mt-3 max-w-xs">
        <CurrencyField
          id="studyRepayBudget"
          label="Aflosbudget"
          icon={<Euro className="h-3.5 w-3.5 text-slate-400" />}
          value={budget}
          onChange={onBudgetChange}
          placeholder="0"
        />
      </div>

      {ranked.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[480px] text-xs">
            <thead>
              <tr className="border-b border-indigo-100 text-left text-slate-400">
                <th className="py-2 pr-3 font-medium">Lening</th>
                <th className="py-2 pr-3 font-medium">Restschuld</th>
                <th className="py-2 pr-3 font-medium">Per € 1.000 afgelost</th>
                <th className="py-2 pr-3 font-medium">Aflossen</th>
                <th className="py-2 font-medium">Extra leenruimte</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((row, position) => (
                <tr key={row.id} className="border-b border-indigo-50">
                  <td className="py-2 pr-3 font-medium text-slate-700">
                    {position + 1}. {labelFor(row.id)}
                  </td>
                  <td className="py-2 pr-3 text-slate-600">{formatEuro(row.balance)}</td>
                  <td className="py-2 pr-3 text-slate-600">+{formatEuro(row.perEuro * 1000)}</td>
                  <td className="py-2 pr-3 text-slate-700">
                    {hasBudget ? formatEuro(row.allocated) : '–'}
                    {row.fullyRepaid && (
                      <span className="ml-1.5 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                        volledig
                      </span>
                    )}
                  </td>
                  <td className="py-2 font-semibold text-slate-800">
                    {hasBudget ? `+${formatEuro(row.gain)}` : '–'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {hasBudget && ranked.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 text-xs">
          <span className="text-slate-500">
            Totaal extra leenruimte{' '}
            <strong className="text-sm text-emerald-700">+{formatEuro(optimization.totalGain)}</strong>
          </span>
          <span className="text-slate-500">
            Restbudget <strong className="text-slate-700">{formatEuro(optimization.remainingBudget)}</strong>
          </span>
        </div>
      )}

      {hasBudget && optimization.fullyRepayable.length > 0 && (
        <p className="mt-3 text-xs text-slate-600">
          <span className="font-semibold">Volledig af te lossen met dit budget:</span>{' '}
          {optimization.fullyRepayable
            .map(
              (item) =>
                `${labelFor(item.id)} (${formatEuro(item.cost)} aflossen = +${formatEuro(item.gain)} leenruimte)`
            )
            .join('; ')}
          .
        </p>
      )}

      <StatusBadge status="warning" className="mt-3">
        Gedeeltelijke aflossing telt pas mee voor de leencapaciteit zodra DUO het nieuwe maandbedrag
        heeft vastgesteld. Alleen een volledige aflossing is direct zeker.
      </StatusBadge>
    </div>
  );
}

function StudyDebtPanel({
  loans,
  hasPartner2,
  study,
  rateMode,
  onRateModeChange,
  afslagMethod,
  onAfslagMethodChange,
  onAdd,
  onUpdate,
  onRemove,
  budget,
  onBudgetChange,
}) {
  const visible = loans.filter((l) => (Number(l.owner) === 2 ? hasPartner2 : true));
  const ownerName = (owner) =>
    hasPartner2 ? (Number(owner) === 2 ? 'Partner 2' : 'Partner 1') : 'Aanvrager';
  const labelFor = (id) => {
    const index = visible.findIndex((l) => l.id === id);
    return index === -1 ? '' : `Studielening ${index + 1} (${ownerName(visible[index].owner)})`;
  };
  const resultById = Object.fromEntries(study.perLoan.map((r) => [r.id, r]));
  const aboveTable = study.totalBalance > 0;

  return (
    <div id="studieschuld" className="mt-6 border-t border-slate-100 pt-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <GraduationCap className="h-4 w-4 text-amber-500" />
          Studieschuld (DUO)
        </h3>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onAdd(1)}
            className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-all duration-200 hover:bg-slate-50"
          >
            <Plus className="h-3.5 w-3.5" />
            Studielening {hasPartner2 ? 'Partner 1' : 'toevoegen'}
          </button>
          {hasPartner2 && (
            <button
              type="button"
              onClick={() => onAdd(2)}
              className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-all duration-200 hover:bg-slate-50"
            >
              <Plus className="h-3.5 w-3.5" />
              Studielening Partner 2
            </button>
          )}
        </div>
      </div>
      <p className="mt-2 text-xs text-slate-400">
        De toetslast is het DUO-termijnbedrag × een opslagfactor die afhangt van de debetrente van
        uw hypotheek. Die toetslast wordt gekapitaliseerd en gaat als afslag van de maximale
        hypotheek af (Tijdelijke regeling hypothecair krediet, art. 3a).
      </p>

      {visible.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-slate-200 p-4 text-center text-xs text-slate-400">
          Geen studieschuld ingevuld.
        </p>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {visible.map((loan) => (
            <StudyLoanCard
              key={loan.id}
              loan={loan}
              label={labelFor(loan.id)}
              result={resultById[loan.id]}
              onChange={(field, value) => onUpdate(loan.id, field, value)}
              onRemove={() => onRemove(loan.id)}
            />
          ))}
        </div>
      )}

      {visible.length > 0 && (
        <>
          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <span className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
                Debetrente voor de opslagfactor
                <InfoTooltip text="Gewogen toetsrente: per leningdeel de contractrente bij 10 jaar of langer rentevast, anders de AFM-toetsrente (hoogste van de twee). Gewogen contractrente: alleen de contractrentes. Een overbruggingskrediet telt niet mee." />
              </span>
              <SegmentedToggle
                label="Debetrente"
                value={rateMode}
                onChange={onRateModeChange}
                options={Object.entries(DEBETRENTE_MODES)}
              />
            </div>
            <div className="space-y-1.5">
              <span className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
                Afslagmethode
                <InfoTooltip text="Marginaal: de toetslast wordt gekapitaliseerd tegen de toetsrente van de nieuwe geldlening. Gewogen: tegen de gewogen toetsrente van alle leningdelen. Beide over 360 maanden." />
              </span>
              <SegmentedToggle
                label="Afslagmethode"
                value={afslagMethod}
                onChange={onAfslagMethodChange}
                options={Object.entries(AFSLAG_METHODS)}
              />
            </div>
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-3 rounded-xl border border-slate-100 bg-slate-50/60 p-4 text-xs sm:grid-cols-4">
            <div>
              <dt className="text-slate-400">Gewogen toetsrente</dt>
              <dd
                className={`text-sm font-semibold ${
                  rateMode === 'gewogenToets' ? 'text-blue-700' : 'text-slate-700'
                }`}
              >
                {formatPct3(study.weightedToets)}
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">Gewogen contractrente</dt>
              <dd
                className={`text-sm font-semibold ${
                  rateMode === 'contract' ? 'text-blue-700' : 'text-slate-700'
                }`}
              >
                {formatPct3(study.weightedContract)}
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">Opslagfactor</dt>
              <dd className="text-sm font-semibold text-slate-800">
                {formatFactor(study.factor)}
                <span className="ml-1 text-[11px] font-normal text-slate-400">
                  (bij {formatPct3(study.debetrente)})
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">Kapitalisatierente</dt>
              <dd className="text-sm font-semibold text-slate-800">{formatPct3(study.afslagRatePct)}</dd>
            </div>
            <div className="col-span-2 sm:col-span-2">
              <dt className="text-slate-400">Totale toetslast p/m</dt>
              <dd className="text-sm font-semibold text-slate-800">{formatEuro(study.totalToetslast)}</dd>
            </div>
            <div className="col-span-2 sm:col-span-2">
              <dt className="text-slate-400">Totale afslag op de hypotheek</dt>
              <dd className="text-sm font-semibold text-red-600">−{formatEuro(study.totalAfslag)}</dd>
            </div>
          </dl>
          <p className="mt-2 text-[11px] text-slate-400">
            Methode: {AFSLAG_METHODS[afslagMethod]}, factor uit {DEBETRENTE_MODES[rateMode].toLowerCase()}{' '}
            (regeling {study.year}). De samenstelling van de nieuwe hypotheek (meegenomen leningdelen en
            het benodigde nieuwe bedrag) bepaalt de weging.
          </p>

          {aboveTable && (
            <StudyRepaymentOptimizer
              study={study}
              budget={budget}
              onBudgetChange={onBudgetChange}
              labelFor={labelFor}
            />
          )}
        </>
      )}
    </div>
  );
}


// ---------------------------------------------------------------------------------------
// "Wat kunt u lenen?": de leencapaciteit als rekenstaat, met elke afslag apart. De cijfers komen
// uit buildCapacityBreakdown (capacityBreakdown.js), dat exact sluit; deze componenten tonen alleen.
// ---------------------------------------------------------------------------------------

// Korte omschrijving van de afslagmethode voor in lopende tekst tussen haakjes.
const AFSLAG_METHOD_SHORT = {
  marginaal: 'marginaal: rente nieuwe geldlening',
  gewogen: 'gewogen toetsrente',
};

function formatPct1(fraction) {
  return (safeNum(fraction) * 100).toFixed(1).replace('.', ',') + '%';
}

function signedEuro(amount) {
  return `${amount < 0 ? '−' : '+'} ${formatEuro(Math.abs(amount))}`;
}

function ownerName(owner, hasPartner2) {
  return hasPartner2 ? (Number(owner) === 2 ? 'Partner 2' : 'Partner 1') : 'Aanvrager';
}

function describeCapacityRow(row, ctx) {
  const m = row.meta || {};
  const cf = (v) => safeNum(v).toFixed(2).replace('.', ',');
  switch (row.key) {
    case 'income':
      return {
        label: 'Leencapaciteit op basis van inkomen',
        text: `Toetsinkomen ${formatEuro(m.toetsinkomen)} × woonquote ${formatPct1(m.woonquote)} ÷ 12 = ${formatEuro(
          m.maxWoonlastMonthly
        )} woonlast per maand, gekapitaliseerd tegen ${formatRate(m.rate)} over 360 maanden (factor ${cf(
          m.capitalizationFactor
        )})${m.toetsrenteApplies ? ' — AFM-toetsrente, want de rentevaste periode is korter dan 10 jaar' : ''}.`,
      };
    case 'secondHome':
      return {
        label: 'Afslag tweede woning (aanhouden)',
        text: `Maandlast ${formatEuro(m.monthly)} × factor ${cf(m.capitalizationFactor)}.`,
      };
    case 'otherDebts':
      return {
        label: 'Afslag overige schulden',
        text: `2% van het schuldbedrag per maand = ${formatEuro(m.monthly)} × factor ${cf(m.capitalizationFactor)}.`,
      };
    case 'familyLoan':
      return {
        label: 'Afslag familielening (maandelijkse aflossing)',
        text: `Maandlast ${formatEuro(m.monthly)} × factor ${cf(m.capitalizationFactor)}.`,
      };
    case 'study':
      return {
        label: 'Afslag studieschuld (DUO)',
        text: `Termijnen ${formatEuro(m.totalTermijn)} per maand × opslagfactor ${cf(m.factor)} (debetrente ${formatPct3(
          m.debetrente
        )}) = toetslast ${formatEuro(m.totalToetslast)} per maand, gekapitaliseerd tegen ${formatPct3(
          m.afslagRatePct
        )} (${AFSLAG_METHOD_SHORT[m.afslagMethod]}).`,
      };
    case 'floor':
      return {
        label: 'Correctie: niet onder € 0',
        text: 'De afslagen zijn hoger dan de leencapaciteit; die kan niet negatief worden.',
      };
    case 'aow':
      return {
        label: 'AOW-toets: lagere capaciteit op pensioeninkomen',
        text: 'Binnen 10 jaar van de AOW-leeftijd is het verwachte pensioeninkomen bindend.',
      };
    case 'energy':
      return { label: `Energielabelbonus (label ${ctx.energyLabel})`, text: 'Extra leenruimte voor een energiezuinige woning.' };
    case 'incomeMax':
      return { label: 'Maximale hypotheek o.b.v. inkomen', text: 'Na alle afslagen en bonussen hierboven.' };
    case 'rateRisk':
      return {
        label: 'Renterisico meegenomen leningdelen',
        text: `Leningdelen met minder dan 10 jaar rentevast worden getoetst tegen de AFM-toetsrente (${formatRate(
          TOETSRENTE
        )}) in plaats van hun lage contractrente.`,
      };
    case 'effectiveMax':
      return { label: 'Werkelijke leencapaciteit (totale hypotheek)', text: 'Meegenomen én nieuw geld samen.' };
    case 'ported':
      return { label: 'Al geleend: meegenomen hypotheek', text: 'Restschuld van uw huidige hypotheek per vandaag.' };
    case 'noRoom':
      return { label: 'Geen ruimte meer', text: 'De meegenomen hypotheek is groter dan de leencapaciteit.' };
    case 'newMaxNibud':
      return { label: 'Ruimte voor nieuw geld (inkomen)', text: 'Wat uw inkomen nog toelaat bovenop de meegenomen hypotheek.' };
    case 'lenderCap':
      return {
        label: 'Plafond van uw geldverstrekker',
        text: `Maximum totale hypotheek ${formatEuro(m.lenderCap)}; na de meegenomen hypotheek blijft ${formatEuro(
          m.lenderCapRoom
        )} over.`,
      };
    case 'newMax':
      return { label: 'Maximaal nieuw te lenen', text: 'Het laagste van de inkomensruimte en het plafond van de geldverstrekker.' };
    case 'maxMortgage':
      return { label: 'Maximale hypotheek', text: 'Het laagste van de inkomensruimte en het plafond van de geldverstrekker.' };
    default:
      return { label: row.key, text: '' };
  }
}

// Dezelfde regels als op het scherm, als platte tekst voor de PDF (ASCII-tekens, want de
// standaardlettertypen van jsPDF kennen geen minteken of vinkje).
function buildCapacityPdfRows(b, ctx) {
  const euro = (v) => formatEuro(Math.abs(v));
  const doorstromer = b.kind === 'doorstromer';
  const margin = doorstromer ? b.need.netMargin : b.need.margin;
  const summary = [
    [doorstromer ? 'Maximale totale hypotheek' : 'Maximale hypotheek', euro(b.maxTotalMortgage)],
    ...(doorstromer
      ? [
          ['   waarvan meegenomen (al geleend)', euro(b.portedDebt)],
          ['   waarvan nieuw te lenen (max.)', euro(b.newMax)],
        ]
      : []),
    [doorstromer ? 'Nieuw geld nodig voor deze woning' : 'Hypotheek nodig voor deze woning', euro(b.need.required)],
    [margin >= 0 ? 'Ruimte over' : 'Tekort', euro(margin)],
    ['Totaal aan afslagen op uw leencapaciteit', `- ${euro(b.afslagen.total)}`],
  ];
  const rows = b.rows.map((row) => [
    describeCapacityRow(row, ctx).label,
    row.type === 'delta' ? `${row.amount < 0 ? '-' : '+'} ${euro(row.amount)}` : euro(row.amount),
  ]);
  return { summary, rows };
}

function CapacityRowChildren({ row, hasPartner2 }) {
  if (!row.children || row.children.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1 border-l-2 border-slate-100 pl-3 text-[11px] text-slate-500">
      {row.children.map((child, i) => {
        if (row.key === 'study') {
          return (
            <li key={child.id} className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span>
                Studielening {i + 1} ({ownerName(child.owner, hasPartner2)}): termijn {formatEuro(child.termijn)} ×{' '}
                {safeNum(child.factor).toFixed(2).replace('.', ',')} = {formatEuro(child.toetslast)} per maand
                <span className="text-slate-400"> · {TERMIJN_SOURCE_LABELS[child.termijnSource]}</span>
              </span>
              <span className="font-medium text-red-600">−{formatEuro(child.afslag)}</span>
            </li>
          );
        }
        if (row.key === 'rateRisk') {
          return (
            <li key={child.id} className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span>
                Leningdeel {child.index + 1}: {formatEuro(child.balance)} van {formatRate(child.rate)} getoetst tegen{' '}
                {formatRate(child.testRate)} (nog {Math.floor(child.remainingFixedYears)} jaar{' '}
                {Math.round((child.remainingFixedYears % 1) * 12)} mnd rentevast)
              </span>
              <span className="font-medium text-red-600">−{formatEuro(child.haircut)}</span>
            </li>
          );
        }
        return (
          <li key={child.id} className="flex flex-wrap items-baseline justify-between gap-x-3">
            <span>
              Leningdeel {child.index + 1}: {formatRate(child.rate)}
            </span>
            <span>{formatEuro(child.balance)}</span>
          </li>
        );
      })}
    </ul>
  );
}

function CapacityRow({ row, ctx, barMax }) {
  const { label, text } = describeCapacityRow(row, ctx);
  const isDelta = row.type === 'delta';
  const negative = isDelta && row.amount < 0;
  const positive = isDelta && row.amount > 0;
  const strong = row.type === 'subtotal' || row.type === 'total';

  const before = row.running - (isDelta ? row.amount : 0);
  const left = isDelta ? Math.min(before, row.running) : 0;
  const span = isDelta ? Math.abs(row.amount) : row.amount;
  const leftPct = barMax > 0 ? (left / barMax) * 100 : 0;
  const widthPct = barMax > 0 ? Math.max((span / barMax) * 100, span > 0 ? 0.6 : 0) : 0;
  const barColor = negative
    ? 'bg-red-400'
    : positive
      ? 'bg-emerald-400'
      : row.type === 'total'
        ? 'bg-blue-600'
        : row.type === 'subtotal'
          ? 'bg-indigo-400'
          : 'bg-slate-400';

  return (
    <li
      className={`py-3 ${strong ? 'rounded-xl bg-slate-50 px-3 -mx-3' : ''}`}
      data-capacity-row={row.key}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className={`text-sm ${strong ? 'font-semibold text-slate-800' : 'text-slate-700'}`}>{label}</span>
        <span
          className={`whitespace-nowrap text-sm font-semibold tabular-nums ${
            negative ? 'text-red-600' : positive ? 'text-emerald-600' : 'text-slate-900'
          }`}
        >
          {isDelta ? signedEuro(row.amount) : formatEuro(row.amount)}
        </span>
      </div>
      {text && <p className="mt-0.5 text-xs text-slate-400">{text}</p>}
      <CapacityRowChildren row={row} hasPartner2={ctx.hasPartner2} />
      <div className="relative mt-2 h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
        <div
          className={`absolute inset-y-0 rounded-full ${barColor}`}
          style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
        />
      </div>
      {isDelta && (
        <p className="mt-1 text-right text-[11px] tabular-nums text-slate-400">
          {strong ? '' : `blijft over: ${formatEuro(row.running)}`}
        </p>
      )}
    </li>
  );
}

function CapacityBreakdownSection({ breakdown: b, price, energyLabel, hasPartner2, maxPrice, onGoToDebts }) {
  const barMax = Math.max(1, ...b.rows.map((r) => Math.max(r.running, r.type === 'delta' ? r.running - r.amount : r.amount)));
  const need = b.need;
  const doorstromer = b.kind === 'doorstromer';
  const ctx = { energyLabel, hasPartner2 };
  const margin = doorstromer ? need.netMargin : need.margin;

  return (
    <div
      id="sectie-leencapaciteit"
      className="mt-8 rounded-2xl border border-l-4 border-slate-100 border-l-blue-500 bg-white p-6 shadow-xl"
    >
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
            <Calculator className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-base font-semibold text-slate-800">Wat kunt u lenen?</h2>
            <p className="text-xs text-slate-400">
              Van uw inkomen tot de ruimte voor nieuw geld — met elke afslag apart.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onGoToDebts}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-all duration-200 hover:bg-slate-50"
        >
          Schulden en studieschuld aanpassen
        </button>
      </div>

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
          <dt className="text-xs text-slate-400">
            {doorstromer ? 'Maximale totale hypotheek' : 'Maximale hypotheek'}
          </dt>
          <dd className="text-xl font-bold text-slate-900">{formatEuro(b.maxTotalMortgage)}</dd>
          {doorstromer && (
            <p className="mt-0.5 text-[11px] text-slate-400">
              {formatEuro(b.portedDebt)} meegenomen + {formatEuro(b.newMax)} nieuw
            </p>
          )}
        </div>
        <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
          <dt className="text-xs text-slate-400">
            {doorstromer ? 'Nieuw te lenen' : 'Benodigde hypotheek'} voor {formatEuro(price)}
          </dt>
          <dd className="text-xl font-bold text-slate-900">{formatEuro(need.required)}</dd>
          <p className="mt-0.5 text-[11px] text-slate-400">
            {doorstromer
              ? `na ${formatEuro(need.ownCapitalApplied)} eigen geld`
              : 'aanschafprijs min eigen geld na kosten koper'}
          </p>
        </div>
        <div
          className={`rounded-xl border p-4 ${
            margin >= 0 ? 'border-emerald-100 bg-emerald-50/60' : 'border-red-100 bg-red-50/60'
          }`}
        >
          <dt className="text-xs text-slate-500">{margin >= 0 ? 'Ruimte over' : 'Tekort'}</dt>
          <dd className={`text-xl font-bold ${margin >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
            {formatEuro(Math.abs(margin))}
          </dd>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {need.feasible ? 'Deze woning past.' : 'Deze woning past nog niet.'}
            {doorstromer && need.familyLoanApplied > 0
              ? ` Incl. familielening ${formatEuro(need.familyLoanApplied)}.`
              : ''}
          </p>
        </div>
        <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
          <dt className="text-xs text-slate-400">Totaal aan afslagen</dt>
          <dd className="text-xl font-bold text-red-600">−{formatEuro(b.afslagen.total)}</dd>
          <p className="mt-0.5 text-[11px] text-slate-400">schulden, studieschuld
            {doorstromer ? ', renterisico' : ''}
            {b.afslagen.aow > 0 ? ', AOW' : ''}
          </p>
        </div>
      </dl>

      {maxPrice != null && (
        <p className="mt-3 text-xs text-slate-500">
          Met deze invoer kunt u een woning kopen tot ca.{' '}
          <span className="font-semibold text-slate-700">
            {maxPrice >= SOLVER_PRICE_CEILING ? `meer dan ${formatEuro(SOLVER_PRICE_CEILING)}` : formatEuro(maxPrice)}
          </span>{' '}
          (kosten koper meegerekend).
        </p>
      )}

      <ol className="mt-5 divide-y divide-slate-100 border-t border-slate-100">
        {b.rows.map((row) => (
          <CapacityRow key={row.key} row={row} ctx={ctx} barMax={barMax} />
        ))}
      </ol>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[11px]">
        <span className={b.reconciles ? 'text-emerald-600' : 'font-semibold text-red-600'}>
          {b.reconciles
            ? `✓ Controle: alle regels sluiten exact op ${formatEuro(b.finalAmount)}.`
            : `Let op: de opbouw sluit niet (afwijking ${formatEuro(b.maxError)}).`}
        </span>
        <span className="text-slate-400">Indicatief; geen bindend advies.</span>
      </div>
    </div>
  );
}

// Compacte variant voor het resultaatpaneel (witte tekst op blauw).
function CapacitySummary({ breakdown: b, price, onOpen }) {
  const doorstromer = b.kind === 'doorstromer';
  const a = b.afslagen;
  const lines = [
    ['Schulden en tweede woning', a.debts - a.floor],
    ['Studieschuld', a.study],
    ['Renterisico meegenomen delen', a.rateRisk],
    ['AOW-toets', a.aow],
  ].filter(([, v]) => v > 0.5);

  return (
    <div className="mt-5 rounded-xl bg-white/10 px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-200">Wat u kunt lenen</p>
      <dl className="mt-2 space-y-1.5 text-sm">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-blue-100">{doorstromer ? 'Maximale totale hypotheek' : 'Maximale hypotheek'}</dt>
          <dd className="font-bold text-white">{formatEuro(b.maxTotalMortgage)}</dd>
        </div>
        {doorstromer && (
          <>
            <div className="flex items-baseline justify-between gap-3 pl-3 text-xs">
              <dt className="text-blue-200">waarvan al geleend (meegenomen)</dt>
              <dd className="text-blue-50">{formatEuro(b.portedDebt)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3 pl-3 text-xs">
              <dt className="text-blue-200">waarvan nieuw te lenen (max.)</dt>
              <dd className="font-semibold text-white">{formatEuro(b.newMax)}</dd>
            </div>
          </>
        )}
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-blue-100">
            {doorstromer ? 'Nieuw geld nodig' : 'Hypotheek nodig'} voor {formatEuro(price)}
          </dt>
          <dd className="font-semibold text-white">{formatEuro(b.need.required)}</dd>
        </div>
      </dl>
      {lines.length > 0 && (
        <>
          <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-blue-200">
            Afslagen op uw leencapaciteit
          </p>
          <dl className="mt-1.5 space-y-1 text-xs">
            {lines.map(([label, value]) => (
              <div key={label} className="flex items-baseline justify-between gap-3">
                <dt className="text-blue-100">{label}</dt>
                <dd className="font-medium text-red-200">−{formatEuro(value)}</dd>
              </div>
            ))}
            <div className="flex items-baseline justify-between gap-3 border-t border-white/15 pt-1.5">
              <dt className="font-medium text-blue-50">Totaal</dt>
              <dd className="font-semibold text-red-200">−{formatEuro(a.total)}</dd>
            </div>
          </dl>
        </>
      )}
      <button
        type="button"
        onClick={onOpen}
        className="mt-3 text-xs font-medium text-blue-100 underline-offset-2 transition-colors hover:text-white hover:underline"
      >
        Bekijk de volledige opbouw ↓
      </button>
    </div>
  );
}


function MortgageCalculatorForm({ onReset }) {
  const [income1, setIncome1] = useState(118000);
  const [income2, setIncome2] = useState(115000);
  const [age1, setAge1] = useState('36');
  const [age2, setAge2] = useState('36');
  const [ownCapital1, setOwnCapital1] = useState(125000);
  const [ownCapital2, setOwnCapital2] = useState(25000);
  // Is dit eigen vermogen nu al liquide, of komt het pas vrij bij een latere gebeurtenis
  // (bijv. de verkoop van een aangehouden tweede woning)? Standaard "nu beschikbaar", zoals
  // voorheen impliciet werd aangenomen.
  const [ownCapital1Liquid, setOwnCapital1Liquid] = useState(true);
  const [ownCapital2Liquid, setOwnCapital2Liquid] = useState(true);
  const [rate, setRate] = useState(4.0);
  const [fixedRatePeriod, setFixedRatePeriod] = useState(10);
  const [energyLabel, setEnergyLabel] = useState('A');
  const [purchasePrice, setPurchasePrice] = useState(DOSSIER_DEFAULTS.purchasePrice);
  // Standaard twee aanvragers; schakelbaar naar één aanvrager (Partner 2 telt dan
  // nergens in de berekening mee, ongeacht wat er nog in die velden staat).
  const [hasPartner2, setHasPartner2] = useState(true);
  const [debt1, setDebt1] = useState('0');
  const [debt2, setDebt2] = useState('0');
  const [studyLoans, setStudyLoans] = useState(DOSSIER_DEFAULTS.studyLoans);
  const [studyDebtRateMode, setStudyDebtRateMode] = useState(DOSSIER_DEFAULTS.studyDebtRateMode);
  const [studyDebtAfslagMethod, setStudyDebtAfslagMethod] = useState(
    DOSSIER_DEFAULTS.studyDebtAfslagMethod
  );
  // Aflosbudget voor de optimalisatie is een hulpmiddel en geen onderdeel van het dossier.
  const [studyRepayBudget, setStudyRepayBudget] = useState('');

  const addStudyLoan = (owner) => {
    setStudyLoans((prev) => [
      ...prev,
      {
        id: Date.now(),
        owner,
        balance: '',
        ratePct: STUDY_LOAN_PRESETS.oud.ratePct,
        remainingMonths: STUDY_LOAN_PRESETS.oud.months,
        monthlyPayment: '',
        status: 'regulier',
        revisionDate: '',
        revisionRatePct: '',
      },
    ]);
  };
  const updateStudyLoan = (id, field, value) => {
    setStudyLoans((prev) => prev.map((l) => (l.id === id ? { ...l, [field]: value } : l)));
  };
  const removeStudyLoan = (id) => {
    setStudyLoans((prev) => prev.filter((l) => l.id !== id));
  };

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
  const [includeKostenKoperInCalc, setIncludeKostenKoperInCalc] = useState(true);
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
  // Weergavemodus (Fase 2): 'geleid' toont een op de intake toegesneden set secties;
  // 'expert' toont de volledige scroll-pagina met alles erop en eraan (scenario's, tweede
  // woning altijd beschikbaar, enz.). De keuze wordt onthouden in een eigen, lichte
  // localStorage-sleutel (los van het financiële dossier, zodat een gedeelde link niemands
  // modus-voorkeur oplegt en scenario-snapshots schoon blijven). Default 'geleid'.
  const [uiMode, setUiMode] = useState('geleid');
  const uiModeHydratedRef = useRef(false);
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(UI_MODE_STORAGE_KEY);
      if (stored === 'geleid' || stored === 'expert') setUiMode(stored);
    } catch {
      // localStorage onbeschikbaar (privénavigatie e.d.) — blijf bij de default 'geleid'.
    } finally {
      uiModeHydratedRef.current = true;
    }
  }, []);
  useEffect(() => {
    if (!uiModeHydratedRef.current) return;
    try {
      window.localStorage.setItem(UI_MODE_STORAGE_KEY, uiMode);
    } catch {
      // Zie boven: dan wordt de modus simpelweg niet onthouden tussen bezoeken.
    }
  }, [uiMode]);
  const guided = uiMode === 'geleid';
  const [hasExistingHome, setHasExistingHome] = useState(true);
  // Tweede woning met een eigen, los van de verhuizing staande hypotheekschuld —
  // onafhankelijk van de "huidige woning" hierboven (die gaat over de woning die u
  // verlaat bij de verhuizing). secondHomeWillSell bepaalt of de schuld (aanhouden)
  // blijft meetellen als maandlast, of dat de netto-verkoopopbrengst (verkopen)
  // vrijkomt als extra eigen middelen. useSecondHomeProceeds is een aparte schakelaar:
  // ook bij verkoop wilt u een positieve netto-opbrengst misschien niet (volledig)
  // inzetten voor déze aankoop.
  const [showSecondHome, setShowSecondHome] = useState(false);
  const [hasSecondHome, setHasSecondHome] = useState(true);
  const [secondHomeWillSell, setSecondHomeWillSell] = useState(false);
  const [useSecondHomeProceeds, setUseSecondHomeProceeds] = useState(true);
  const [secondHomeValue, setSecondHomeValue] = useState('300000');
  const [secondHomeMortgageDebt, setSecondHomeMortgageDebt] = useState('42000');
  const [secondHomeInterestRate, setSecondHomeInterestRate] = useState(1.0);
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
  // Aflosvorm van de familielening: "ineens" (bijv. bij verkoop van de tweede woning) heeft
  // geen invloed op de Nibud-toets; "maandelijks" is een reguliere verplichting en telt mee
  // als schuld, net als overige schulden.
  const [familyLoanRepaymentType, setFamilyLoanRepaymentType] = useState('ineens');
  const [familyLoanMonthlyRepayment, setFamilyLoanMonthlyRepayment] = useState('');
  // Veiligheidsmarge bovenop het niet-liquide eigen vermogen bij het suggereren van een
  // familieleningbedrag: dekt rente tijdens de looptijd en onzekerheid over de uiteindelijke
  // verkoopprijs/kosten van de tweede woning.
  const [familyLoanBufferPct, setFamilyLoanBufferPct] = useState(10);
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
  const [saleDiscountPercentage, setSaleDiscountPercentage] = useState(95);
  const [currentEnergyLabel, setCurrentEnergyLabel] = useState('A');
  const [startDate, setStartDate] = useState(DOSSIER_DEFAULTS.startDate);
  const [viewMode, setViewMode] = useState('bruto');
  const [loanParts, setLoanParts] = useState(DOSSIER_DEFAULTS.loanParts);

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
    setLoanParts((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        const next = { ...p, [field]: value };
        // Een nieuw ingevuld restsaldo geldt per vandaag; vanaf dan wordt het doorgerekend.
        if (field === 'knownBalance') next.balanceAsOf = getTodayIsoLocal();
        return next;
      })
    );
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

  // Volgt of de gebruiker de aanvullende leningdelen zélf heeft aangepast. Zolang dit false
  // is, volgen de leningdelen automatisch het benodigde aanvullende bedrag (zie de auto-sync
  // useEffect verderop), zodat een wijziging in eerdere parameters meteen doorwerkt. Zodra de
  // gebruiker handmatig iets aanpast wordt dit true en respecteren we hun invoer.
  const [additionalLoanTouched, setAdditionalLoanTouched] = useState(false);

  const addAdditionalLoanPart = () => {
    setAdditionalLoanTouched(true);
    setAdditionalLoanParts((prev) => {
      if (prev.length >= 2) return prev;
      return [
        ...prev,
        { id: Date.now(), type: 'Annuïteit', principal: '0', rate: 4.0, originalFixedYears: 10 },
      ];
    });
  };

  const removeAdditionalLoanPart = (id) => {
    setAdditionalLoanTouched(true);
    setAdditionalLoanParts((prev) => (prev.length > 1 ? prev.filter((p) => p.id !== id) : prev));
  };

  const updateAdditionalLoanPart = (id, field, value) => {
    setAdditionalLoanTouched(true);
    setAdditionalLoanParts((prev) => prev.map((p) => (p.id === id ? { ...p, [field]: value } : p)));
  };

  // Starters-leningdelen: voor wie nog geen woning heeft. Splitst de benodigde hypotheek in
  // maximaal 3 delen met eigen aflosvorm, rente en rentevastperiode. Starten vandaag.
  const [starterLoanParts, setStarterLoanParts] = useState([
    { id: 1, type: 'Annuïteit', principal: '0', rate: 4.0, originalFixedYears: 10 },
  ]);
  const [starterViewMode, setStarterViewMode] = useState('bruto');

  // ---------------------------------------------------------------------------------
  // Dossier: één plat, serialiseerbaar object met alle financiële invoervelden hierboven
  // (dus niet de klap-open/dicht- of weergave-toggles). Dit maakt drie dingen mogelijk
  // zonder de ~75 losse useState-velden hierboven te hoeven vervangen: (1) een deelbare
  // link, (2) automatisch onthouden in deze browser, (3) scenario's opslaan/laden/
  // vergelijken. Bewust geen useReducer: dat zou elke individuele onChange-call site in
  // de JSX hieronder moeten wijzigen, met veel grotere kans op regressies dan deze
  // additieve laag.
  // ---------------------------------------------------------------------------------
  const dossierSnapshot = useMemo(
    () => ({
      income1,
      income2,
      age1,
      age2,
      ownCapital1,
      ownCapital2,
      ownCapital1Liquid,
      ownCapital2Liquid,
      rate,
      fixedRatePeriod,
      energyLabel,
      purchasePrice,
      hasPartner2,
      debt1,
      debt2,
      studyLoans,
      studyDebtRateMode,
      studyDebtAfslagMethod,
      propertyUsage,
      starterExemption1,
      starterExemption2,
      bouwdepotAmount,
      constructionMonths,
      notaryCosts,
      valuationCosts,
      advisoryCosts,
      includeBankGuarantee,
      includeBuyersAgent,
      includeNhgFee,
      includeEwfInNetCalc,
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
      hasExistingHome,
      hasSecondHome,
      secondHomeWillSell,
      useSecondHomeProceeds,
      secondHomeValue,
      secondHomeMortgageDebt,
      secondHomeInterestRate,
      secondHomeRepaymentType,
      secondHomeRemainingYears,
      secondHomeSaleCostsPct,
      lenderCapThreshold,
      limitOwnContribution,
      desiredMaxOwnContribution,
      useFamilyLoan,
      familyLoanAmount,
      familyLoanRate,
      familyLoanRepaymentType,
      familyLoanMonthlyRepayment,
      familyLoanBufferPct,
      takeOverMortgage,
      oldMortgageStance,
      bridgePeriodMonths,
      includeOwnCapitalInDoubleTest,
      liquidityBuffer,
      useBridgeLoan,
      bridgeLoanAmount,
      bridgeLoanRate,
      marketValue,
      saleDiscountPercentage,
      currentEnergyLabel,
      startDate,
      loanParts,
      loanPartsBasis: 'aanvang',
      additionalLoanParts,
      additionalLoanTouched,
      aflossingsvrijMaxPct,
      scheduleWindowStartMonth,
      scheduleAppreciationPct,
      starterLoanParts,
    }),
    [
      income1, income2, age1, age2, ownCapital1, ownCapital2, ownCapital1Liquid,
      ownCapital2Liquid, rate, fixedRatePeriod, energyLabel, purchasePrice, hasPartner2,
      debt1, debt2, studyLoans, studyDebtRateMode, studyDebtAfslagMethod, propertyUsage,
      starterExemption1, starterExemption2, bouwdepotAmount, constructionMonths,
      notaryCosts, valuationCosts, advisoryCosts, includeBankGuarantee, includeBuyersAgent,
      includeNhgFee, includeEwfInNetCalc, includeKostenKoperInCalc, partnerAlimony1,
      partnerAlimony2, pensionIncome1, pensionIncome2, incomeType1, incomeType2,
      incomeHistory1, incomeHistory2, thirteenthMonth1, thirteenthMonth2, avgBonus1,
      avgBonus2, hasExistingHome, hasSecondHome, secondHomeWillSell, useSecondHomeProceeds,
      secondHomeValue, secondHomeMortgageDebt, secondHomeInterestRate,
      secondHomeRepaymentType, secondHomeRemainingYears, secondHomeSaleCostsPct,
      lenderCapThreshold, limitOwnContribution, desiredMaxOwnContribution, useFamilyLoan,
      familyLoanAmount, familyLoanRate, familyLoanRepaymentType, familyLoanMonthlyRepayment,
      familyLoanBufferPct, takeOverMortgage, oldMortgageStance, bridgePeriodMonths,
      includeOwnCapitalInDoubleTest, liquidityBuffer, useBridgeLoan, bridgeLoanAmount,
      bridgeLoanRate, marketValue, saleDiscountPercentage, currentEnergyLabel,
      startDate, loanParts, additionalLoanParts, additionalLoanTouched, aflossingsvrijMaxPct,
      scheduleWindowStartMonth, scheduleAppreciationPct, starterLoanParts,
    ]
  );

  // Herstelt alle dossiervelden in één keer vanuit een (volledig gevuld, zie
  // fillDossierDefaults) snapshot-object — gebruikt bij het laden van een gedeelde link,
  // het automatisch herstellen bij openen, en het laden van een opgeslagen scenario.
  // Setters zijn stabiel over renders, dus een lege dependency-array is hier correct.
  const loadDossier = useCallback((snap) => {
    setIncome1(snap.income1);
    setIncome2(snap.income2);
    setAge1(snap.age1);
    setAge2(snap.age2);
    setOwnCapital1(snap.ownCapital1);
    setOwnCapital2(snap.ownCapital2);
    setOwnCapital1Liquid(snap.ownCapital1Liquid);
    setOwnCapital2Liquid(snap.ownCapital2Liquid);
    setRate(snap.rate);
    setFixedRatePeriod(snap.fixedRatePeriod);
    setEnergyLabel(snap.energyLabel);
    setPurchasePrice(snap.purchasePrice);
    setHasPartner2(snap.hasPartner2);
    setDebt1(snap.debt1);
    setDebt2(snap.debt2);
    setStudyLoans(snap.studyLoans);
    setStudyDebtRateMode(snap.studyDebtRateMode);
    setStudyDebtAfslagMethod(snap.studyDebtAfslagMethod);
    setPropertyUsage(snap.propertyUsage);
    setStarterExemption1(snap.starterExemption1);
    setStarterExemption2(snap.starterExemption2);
    setBouwdepotAmount(snap.bouwdepotAmount);
    setConstructionMonths(snap.constructionMonths);
    setNotaryCosts(snap.notaryCosts);
    setValuationCosts(snap.valuationCosts);
    setAdvisoryCosts(snap.advisoryCosts);
    setIncludeBankGuarantee(snap.includeBankGuarantee);
    setIncludeBuyersAgent(snap.includeBuyersAgent);
    setIncludeNhgFee(snap.includeNhgFee);
    setIncludeEwfInNetCalc(snap.includeEwfInNetCalc);
    setIncludeKostenKoperInCalc(snap.includeKostenKoperInCalc);
    setPartnerAlimony1(snap.partnerAlimony1);
    setPartnerAlimony2(snap.partnerAlimony2);
    setPensionIncome1(snap.pensionIncome1);
    setPensionIncome2(snap.pensionIncome2);
    setIncomeType1(snap.incomeType1);
    setIncomeType2(snap.incomeType2);
    setIncomeHistory1(snap.incomeHistory1);
    setIncomeHistory2(snap.incomeHistory2);
    setThirteenthMonth1(snap.thirteenthMonth1);
    setThirteenthMonth2(snap.thirteenthMonth2);
    setAvgBonus1(snap.avgBonus1);
    setAvgBonus2(snap.avgBonus2);
    setHasExistingHome(snap.hasExistingHome);
    setHasSecondHome(snap.hasSecondHome);
    setSecondHomeWillSell(snap.secondHomeWillSell);
    setUseSecondHomeProceeds(snap.useSecondHomeProceeds);
    setSecondHomeValue(snap.secondHomeValue);
    setSecondHomeMortgageDebt(snap.secondHomeMortgageDebt);
    setSecondHomeInterestRate(snap.secondHomeInterestRate);
    setSecondHomeRepaymentType(snap.secondHomeRepaymentType);
    setSecondHomeRemainingYears(snap.secondHomeRemainingYears);
    setSecondHomeSaleCostsPct(snap.secondHomeSaleCostsPct);
    setLenderCapThreshold(snap.lenderCapThreshold);
    setLimitOwnContribution(snap.limitOwnContribution);
    setDesiredMaxOwnContribution(snap.desiredMaxOwnContribution);
    setUseFamilyLoan(snap.useFamilyLoan);
    setFamilyLoanAmount(snap.familyLoanAmount);
    setFamilyLoanRate(snap.familyLoanRate);
    setFamilyLoanRepaymentType(snap.familyLoanRepaymentType);
    setFamilyLoanMonthlyRepayment(snap.familyLoanMonthlyRepayment);
    setFamilyLoanBufferPct(snap.familyLoanBufferPct);
    setTakeOverMortgage(snap.takeOverMortgage);
    setOldMortgageStance(snap.oldMortgageStance);
    setBridgePeriodMonths(snap.bridgePeriodMonths);
    setIncludeOwnCapitalInDoubleTest(snap.includeOwnCapitalInDoubleTest);
    setLiquidityBuffer(snap.liquidityBuffer);
    setUseBridgeLoan(snap.useBridgeLoan);
    setBridgeLoanAmount(snap.bridgeLoanAmount);
    setBridgeLoanRate(snap.bridgeLoanRate);
    setMarketValue(snap.marketValue);
    setSaleDiscountPercentage(snap.saleDiscountPercentage);
    setCurrentEnergyLabel(snap.currentEnergyLabel);
    setStartDate(snap.startDate);
    setLoanParts(snap.loanParts);
    setAdditionalLoanParts(snap.additionalLoanParts);
    setAdditionalLoanTouched(snap.additionalLoanTouched ?? false);
    setAflossingsvrijMaxPct(snap.aflossingsvrijMaxPct);
    setScheduleWindowStartMonth(snap.scheduleWindowStartMonth);
    setScheduleAppreciationPct(snap.scheduleAppreciationPct);
    setStarterLoanParts(snap.starterLoanParts);
  }, []);

  // Bij het openen: een gedeelde link (URL-hash) weegt zwaarder dan wat lokaal onthouden
  // is, wat weer zwaarder weegt dan de standaardwaarden. hydratedRef voorkomt dat de
  // opslag-effect hieronder dit meteen weer overschrijft vóór het herstellen is voltooid.
  const hydratedRef = useRef(false);
  useEffect(() => {
    try {
      const hash = window.location.hash;
      if (hash && hash.startsWith('#d=')) {
        const parsed = JSON.parse(decodeURIComponent(hash.slice(3)));
        loadDossier(fillDossierDefaults(parsed));
        hydratedRef.current = true;
        return;
      }
      const stored = window.localStorage.getItem(DOSSIER_STORAGE_KEY);
      if (stored) {
        loadDossier(fillDossierDefaults(JSON.parse(stored)));
      }
    } catch {
      // Corrupte of onleesbare link/opslag: gewoon bij de standaardwaarden blijven.
    } finally {
      hydratedRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Onthoudt elke wijziging automatisch (gedebouncet), zowel lokaal als in de URL, zodat
  // de pagina delen ("kopieer link") en verversen altijd de actuele invoer teruggeeft.
  useEffect(() => {
    if (!hydratedRef.current) return undefined;
    const timeout = setTimeout(() => {
      try {
        const encoded = encodeURIComponent(JSON.stringify(dossierSnapshot));
        window.localStorage.setItem(DOSSIER_STORAGE_KEY, JSON.stringify(dossierSnapshot));
        window.history.replaceState(null, '', `#d=${encoded}`);
      } catch {
        // localStorage kan vol/uitgeschakeld zijn (bijv. privénavigatie) — dan onthoudt de
        // app de invoer simpelweg niet tussen bezoeken, de berekening blijft werken.
      }
    }, 500);
    return () => clearTimeout(timeout);
  }, [dossierSnapshot]);

  // Scenario's: losstaande, met naam opgeslagen dossier-snapshots (niet de actieve
  // invoer), zodat u twee of meer volledige situaties kunt vergelijken zonder steeds
  // handmatig velden om te zetten. Persistent in dezelfde browser, net als het dossier.
  const [scenarios, setScenarios] = useState(() => {
    try {
      const stored = window.localStorage.getItem(SCENARIOS_STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(SCENARIOS_STORAGE_KEY, JSON.stringify(scenarios));
    } catch {
      // Zie hierboven: opslag kan onbeschikbaar zijn, dan blijft dit alleen in-memory.
    }
  }, [scenarios]);

  const saveCurrentAsScenario = (name) => {
    const trimmed = (name || '').trim() || `Scenario ${scenarios.length + 1}`;
    setScenarios((prev) => [
      ...prev,
      { id: Date.now(), name: trimmed, snapshot: dossierSnapshot, createdAt: Date.now() },
    ]);
  };

  const loadScenario = (id) => {
    const scenario = scenarios.find((s) => s.id === id);
    if (scenario) loadDossier(fillDossierDefaults(scenario.snapshot));
  };

  const deleteScenario = (id) => {
    setScenarios((prev) => prev.filter((s) => s.id !== id));
  };

  const renameScenario = (id, name) => {
    setScenarios((prev) => prev.map((s) => (s.id === id ? { ...s, name } : s)));
  };

  const [linkCopied, setLinkCopied] = useState(false);
  const [showScenarios, setShowScenarios] = useState(false);
  const [newScenarioName, setNewScenarioName] = useState('');
  const [scenarioJustSaved, setScenarioJustSaved] = useState(false);

  // Snel opslaan vanuit het resultaatpaneel, met de aanschafprijs in de naam zodat varianten
  // in de vergelijkingstabel direct herkenbaar zijn (de naam blijft daar aanpasbaar).
  const quickSaveScenario = () => {
    saveCurrentAsScenario(`Scenario ${scenarios.length + 1} · ${formatEuro(purchasePrice)}`);
    setScenarioJustSaved(true);
    setTimeout(() => setScenarioJustSaved(false), 2000);
  };

  const openScenarioComparison = () => {
    setShowScenarios(true);
    document.getElementById('sectie-scenarios')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Resultaatdetails: standaard dicht in Geleid (kort antwoord eerst), open in Expert. Een
  // handmatige keuze geldt alleen binnen de modus waarin die gemaakt is.
  const [resultDetailsChoice, setResultDetailsChoice] = useState(null);
  const showResultDetails =
    resultDetailsChoice?.mode === uiMode ? resultDetailsChoice.open : !guided;
  const toggleResultDetails = () =>
    setResultDetailsChoice({ mode: uiMode, open: !showResultDetails });

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

  const core = useMemo(() => computeCore(dossierSnapshot), [dossierSnapshot]);
  const calc = core.calc;
  const currentMortgage = core.currentMortgage;
  const combinedGapCalc = core.combinedGap;

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
  const currentLoanParts = useMemo(
    () => toCurrentLoanParts(loanParts, startDate),
    [loanParts, startDate]
  );
  const originalDebtTotal = loanParts.reduce((sum, p) => sum + safeNum(p.principal), 0);


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

  const starterGapCalc = useMemo(() => computeStarterGap(dossierSnapshot, calc), [dossierSnapshot, calc]);
  const affordabilityLevers = useMemo(() => solveAffordabilityLevers(dossierSnapshot), [dossierSnapshot]);
  const capacityBreakdown = useMemo(
    () => buildCapacityBreakdown(dossierSnapshot, core, starterGapCalc),
    [dossierSnapshot, core, starterGapCalc]
  );
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);

  // Auto-sync aanvullende leningdelen: zolang de gebruiker ze niet zelf heeft aangepast
  // (additionalLoanTouched), volgen ze automatisch het benodigde aanvullende bedrag
  // (combinedGapCalc.additionalMortgage). Zo werkt een wijziging in eerdere parameters
  // (aanschafprijs, inkomen, eigen geld, kosten koper, …) meteen door in dit blok, in plaats
  // van dat de eerder ingevulde leningdelen blijven staan tot je "Automatisch verdelen" klikt.
  // De verdeling is dezelfde als die knop (eerst aflossingsvrij tot de bancaire ruimte, rest
  // annuïteit); de berekening gebeurt hier los van additionalLoanCalc om een render-lus te
  // vermijden.
  useEffect(() => {
    if (!hasExistingHome || additionalLoanTouched) return;
    const needed = Math.max(0, Math.round(combinedGapCalc.additionalMortgage));
    const priceNum = safeNum(purchasePrice);
    const portedAflossingsvrij = takeOverMortgage
      ? currentLoanParts
          .filter((p) => p.type === 'Aflossingsvrij')
          .reduce((s, p) => s + safeNum(p.principal), 0)
      : 0;
    const room = Math.max(0, priceNum * (aflossingsvrijMaxPct / 100) - portedAflossingsvrij);
    const aflossingsvrijPortion = Math.min(room, needed);
    const restPortion = needed - aflossingsvrijPortion;
    const currentRate = safeNum(rate);
    const parts = [];
    if (aflossingsvrijPortion > 0) {
      parts.push({
        id: 1,
        type: 'Aflossingsvrij',
        principal: String(Math.round(aflossingsvrijPortion)),
        rate: currentRate,
        originalFixedYears: 10,
      });
    }
    if (restPortion > 0 || parts.length === 0) {
      parts.push({
        id: 2,
        type: 'Annuïteit',
        principal: String(Math.round(restPortion)),
        rate: currentRate,
        originalFixedYears: 10,
      });
    }
    setAdditionalLoanParts((prev) => {
      const same =
        prev.length === parts.length &&
        prev.every(
          (p, i) =>
            p.type === parts[i].type &&
            safeNum(p.principal) === safeNum(parts[i].principal) &&
            safeNum(p.rate) === safeNum(parts[i].rate)
        );
      return same ? prev : parts;
    });
  }, [
    hasExistingHome,
    additionalLoanTouched,
    combinedGapCalc.additionalMortgage,
    purchasePrice,
    takeOverMortgage,
    currentLoanParts,
    aflossingsvrijMaxPct,
    rate,
  ]);

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
    const restschuldTekort = hasExistingHome ? currentMortgage.restschuldTekort : 0;
    const portedGrossMonthly = hasExistingHome && takeOverMortgage ? currentMortgage.totalGross : 0;
    const portedTaxBenefit = hasExistingHome && takeOverMortgage ? currentMortgage.taxBenefit : 0;
    const extraBorrowCapacity = hasExistingHome
      ? currentMortgage.extraBorrowCapacity
      : calc.incomeBasedMax;
    // Zelfde eigen-middelen-bron als combinedGapCalc: kosten koper gaan er (indien
    // meegeteld) eerst af, en een eventuele eigen-inleg-limiet begrenst wat hiervan nog voor
    // het gat wordt ingezet. Zonder deze twee zou het 0%-scenario hieronder afwijken van de
    // headline "aanvullend te lenen" bij de aanschafprijs.
    const kostenKoperCash = includeKostenKoperInCalc ? calc.kostenKoper.total : 0;
    const ownCapitalForGapBase = Math.max(0, calc.totalOwnCapital - kostenKoperCash);
    const ownContributionCap = limitOwnContribution
      ? Math.max(0, safeNum(desiredMaxOwnContribution))
      : Infinity;

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
      const gap = financeablePrice - portedDebt - overwaarde + restschuldTekort;
      const ownCapitalForGap = Math.min(
        ownCapitalForGapBase,
        Math.max(0, gap),
        ownContributionCap
      );
      const additionalMortgage = Math.max(0, gap - ownCapitalForGap);
      const remainingOwnCapital = calc.totalOwnCapital - kostenKoperCash - ownCapitalForGap;
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
    includeKostenKoperInCalc,
    limitOwnContribution,
    desiredMaxOwnContribution,
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
    const exceedsLenderCap = totalDebtAfterMove > getLenderCap(lenderCapThreshold);

    // B10-stijl: de totale hypotheek (meegenomen plus nieuw) kan nooit boven de aanschafprijs
    // van de beoogde woning uitkomen (maximale LTV van 100%).
    const priceNum = safeNum(purchasePrice);
    const newLtv = priceNum > 0 ? (totalDebtAfterMove / priceNum) * 100 : 0;
    const withinLtvCap = priceNum === 0 || totalDebtAfterMove <= priceNum;

    // Bancaire norm: maximaal het ingestelde percentage van de woningwaarde mag
    // aflossingsvrij gefinancierd worden, over de meegenomen én de nieuwe leningdelen samen.
    // Alleen relevant als de bestaande hypotheek daadwerkelijk wordt meegenomen.
    const portedAflossingsvrij = takeOverMortgage
      ? currentLoanParts
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
    currentLoanParts,
    combinedGapCalc,
    aflossingsvrijMaxPct,
    takeOverMortgage,
    lenderCapThreshold,
  ]);

  const autoDistributeAdditionalLoan = () => {
    const needed = Math.max(0, combinedGapCalc.additionalMortgage);
    const aflossingsvrijPortion = Math.min(additionalLoanCalc.aflossingsvrijRoomRemaining, needed);
    const restPortion = needed - aflossingsvrijPortion;
    const currentRate = safeNum(rate);
    const parts = [];
    if (aflossingsvrijPortion > 0) {
      parts.push({
        id: 1,
        type: 'Aflossingsvrij',
        principal: String(Math.round(aflossingsvrijPortion)),
        rate: currentRate,
        originalFixedYears: 10,
      });
    }
    if (restPortion > 0 || parts.length === 0) {
      parts.push({
        id: 2,
        type: 'Annuïteit',
        principal: String(Math.round(restPortion)),
        rate: currentRate,
        originalFixedYears: 10,
      });
    }
    setAdditionalLoanParts(parts);
    // Hervat automatisch volgen: na "Automatisch verdelen" werken latere wijzigingen in
    // eerdere parameters weer direct door (tot de gebruiker opnieuw handmatig aanpast).
    setAdditionalLoanTouched(false);
  };

  // Starters-toets: benodigde hypotheek = aanschafprijs min het eigen vermogen dat na kosten
  // koper overblijft (zie computeStarterGap), begrensd op de maximale hypotheek o.b.v. inkomen.
  const starterRequiredMortgage = Math.min(calc.maxMortgage, starterGapCalc.requiredMortgage);

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
    const exceedsLenderCap = totalPrincipal > getLenderCap(lenderCapThreshold);

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

  const maxBudgetCalc = useMemo(
    () => computeMaxBudget(dossierSnapshot, calc, currentMortgage, combinedGapCalc),
    [dossierSnapshot, calc, currentMortgage, combinedGapCalc]
  );
  // Het hoofdbedrag bovenaan: het aankoopbudget voor doorstromers; voor starters de maximale
  // hypotheek, begrensd door de aanschafprijs en het plafond van de geldverstrekker.
  const headlineValue = hasExistingHome
    ? maxBudgetCalc.maxBudget
    : Math.min(calc.maxMortgage, starterGapCalc.capacity);

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
        currentLoanParts.forEach((part) => {
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
  }, [currentLoanParts, additionalLoanParts, elapsedMonthsSinceStart, takeOverMortgage]);

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
        ? currentLoanParts.map((p) => ({ ...p, remainingMonthsNow: portedRemainingMonthsNow }))
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
    currentLoanParts,
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

  // Eén eindoordeel voor de hele app (chip, resultaat, rail, mobiele balk en de solver): voor
  // starters past de benodigde hypotheek (na eigen geld en kosten koper) binnen inkomen en
  // geldverstrekkersmaximum; voor doorstromers past het financieringsgat binnen de
  // bijleenruimte (incl. eventuele familielening). Zie evaluateAffordability.
  const overallAffordable = hasExistingHome
    ? combinedGapCalc.withinCapacityAfterFamilyLoan
    : starterGapCalc.feasible;
  const affordabilityShortfall = hasExistingHome
    ? combinedGapCalc.remainingShortfall
    : starterGapCalc.shortfall;
  // Schiet een starter alléén eigen geld voor kosten koper tekort, dan is "verlaag de prijs"
  // geen zinvol advies: de vaste kosten (notaris, taxatie, advies) domineren.
  const showPriceLever = hasExistingHome || starterGapCalc.capacityShortfall > 0;

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
      // Alleen bepalend als het plafond de strengste grens is; ligt de inkomensruimte lager, dan
      // is dat de bepalende factor (zie de bijleenruimte-tak hieronder).
      if (combinedGapCalc.exceedsLenderCap && combinedGapCalc.bindingCapIsLender) {
        return {
          label: 'Uw maximum bij de geldverstrekker',
          explanation: `Uw totale hypotheek (meegenomen plus aanvullend) komt boven de ${formatEuro(
            getLenderCap(lenderCapThreshold)
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
                getLenderCap(lenderCapThreshold)
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
    if (starterGapCalc.cashShortfall > 0) {
      return {
        label: 'Uw eigen geld voor kosten koper',
        explanation: `Kosten koper (${formatEuro(
          starterGapCalc.kostenKoperCash
        )}) kunnen niet worden meegefinancierd en moeten uit eigen middelen komen; uw direct beschikbare eigen vermogen is daarvoor niet toereikend.`,
      };
    }
    if (starterGapCalc.capacityShortfall > 0) {
      return starterGapCalc.bindingCapIsLender
        ? {
            label: 'Uw geldverstrekkersmaximum',
            explanation: `De benodigde hypotheek past niet binnen het ingestelde maximum van ${formatEuro(
              getLenderCap(lenderCapThreshold)
            )} bij uw geldverstrekker.`,
          }
        : {
            label: 'Uw woonquote (inkomen)',
            explanation: `De benodigde hypotheek (${formatEuro(
              starterGapCalc.requiredMortgage
            )}) is hoger dan wat u op basis van uw inkomen kunt lenen (${formatEuro(
              calc.incomeBasedMax
            )}).`,
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
  }, [calc, currentMortgage, combinedGapCalc, starterGapCalc, hasExistingHome, lenderCapThreshold]);

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
  // Secties + per-stap-status voor de stepper (Fase 3). De status leunt volledig op de
  // validatie-afleidingen die de calculator toch al berekent (isOverIndebted,
  // cappedByPropertyValue, withinCapacityAfterFamilyLoan, restschuldTekort, …) — hier
  // alleen vertaald naar done / attention / ignored / todo (zie SectionRail). In geleide
  // modus (Fase 2) tonen we alleen de secties die bij de intake-antwoorden passen
  // (`guidedHidden` eruit gefilterd); expert-modus toont alles.
  const railSections = useMemo(() => {
    const hasAnyDebt =
      safeNum(debt1) + safeNum(debt2) + studyLoans.reduce((s, l) => s + safeNum(l.balance), 0) > 0;
    const all = [
      { id: 'sectie-situatie', label: guided ? 'Intake' : 'Uw situatie', status: 'done' },
      {
        id: 'sectie-scenarios',
        label: "Scenario's",
        status: scenarios.length > 0 ? 'done' : 'ignored',
        guidedHidden: scenarios.length === 0,
      },
      {
        id: 'sectie-beoogde-woning',
        label: 'Beoogde woning',
        status: safeNum(purchasePrice) > 0 ? 'done' : 'todo',
      },
      {
        id: 'sectie-inkomen',
        label: 'Inkomen',
        status: calc.combinedIncome > 0 ? 'done' : 'todo',
      },
      {
        id: 'sectie-schulden',
        label: 'Schulden',
        status: !incomeStepDone
          ? 'todo'
          : calc.isOverIndebted
            ? 'attention'
            : hasAnyDebt
              ? 'done'
              : 'ignored',
      },
      {
        id: 'sectie-tweede-woning',
        label: 'Tweede woning',
        status: safeNum(secondHomeValue) > 0 ? 'done' : 'ignored',
        guidedHidden: !hasSecondHome,
      },
      { id: 'sectie-kosten-koper', label: 'Kosten koper', status: 'done' },
      ...(propertyUsage === 'nieuwbouw'
        ? [
            {
              id: 'sectie-bouwdepot',
              label: 'Bouwdepot',
              status: safeNum(bouwdepotAmount) > 0 ? 'done' : 'ignored',
            },
          ]
        : []),
      hasExistingHome
        ? {
            id: 'sectie-huidige-woning',
            label: 'Huidige woning',
            status:
              currentMortgage.restschuldTekort > 0 ||
              !combinedGapCalc.withinCapacityAfterFamilyLoan
                ? 'attention'
                : safeNum(marketValue) > 0
                  ? 'done'
                  : 'todo',
          }
        : {
            id: 'sectie-starter-hypotheek',
            label: 'Uw hypotheek',
            status: !starterGapCalc.feasible
              ? 'attention'
              : safeNum(purchasePrice) > 0 && incomeStepDone
                ? 'done'
                : 'todo',
          },
      {
        id: 'sectie-resultaat',
        label: 'Resultaat',
        status: overallAffordable ? 'done' : 'attention',
      },
      ...(calc.combinedIncome > 0
        ? [
            {
              id: 'sectie-leencapaciteit',
              label: 'Leencapaciteit',
              status: capacityBreakdown.need.feasible ? 'done' : 'attention',
            },
          ]
        : []),
    ];
    return guided ? all.filter((s) => !s.guidedHidden) : all;
  }, [
    guided,
    hasExistingHome,
    propertyUsage,
    hasSecondHome,
    incomeStepDone,
    overallAffordable,
    calc,
    combinedGapCalc,
    starterGapCalc,
    capacityBreakdown,
    currentMortgage,
    purchasePrice,
    marketValue,
    secondHomeValue,
    bouwdepotAmount,
    debt1,
    debt2,
    studyLoans,
    scenarios.length,
  ]);
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
  const mobileSummaryValue = headlineValue;

  // Klein "vier het moment"-effect: zodra de situatie omslaat van niet-haalbaar naar
  // haalbaar (niet bij elke wijziging, alleen bij die ene overgang) een korte, speelse
  // wiebel/schaal-animatie op de statuspil in de sidebar, in plaats van dat de kleur
  // stilletjes van rood/amber naar groen verspringt.
  const isAffordableNow = overallAffordable;
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
      capacity: buildCapacityPdfRows(capacityBreakdown, { energyLabel, hasPartner2 }),
      bindingFactor,
      resultLabel: hasExistingHome ? 'Maximaal aankoopbudget' : 'Maximale hypotheek',
      resultValue: headlineValue,
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
            <div
              role="tablist"
              aria-label="Weergavemodus"
              className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1"
              title="Geleid toont alleen de secties die bij uw situatie passen; Expert toont de volledige pagina met alle opties."
            >
              <button
                type="button"
                role="tab"
                aria-selected={guided}
                onClick={() => setUiMode('geleid')}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all duration-200 ${
                  guided
                    ? 'bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <Wand2 className="h-3.5 w-3.5" />
                Geleid
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={!guided}
                onClick={() => setUiMode('expert')}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all duration-200 ${
                  !guided
                    ? 'bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                Expert
              </button>
            </div>
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
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(window.location.href);
                  setLinkCopied(true);
                  setTimeout(() => setLinkCopied(false), 2000);
                } catch {
                  // Klembord niet beschikbaar (bijv. onveilige context) — geen harde fout.
                }
              }}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-500 transition-all duration-200 hover:border-slate-300 hover:text-slate-700"
            >
              <Link2 className="h-3.5 w-3.5" />
              {linkCopied ? 'Link gekopieerd!' : 'Kopieer deelbare link'}
            </button>
            <button
              type="button"
              onClick={() => {
                if (
                  window.confirm(
                    'Weet u zeker dat u opnieuw wilt beginnen? Alle ingevoerde gegevens gaan verloren.'
                  )
                ) {
                  try {
                    window.localStorage.removeItem(DOSSIER_STORAGE_KEY);
                    window.history.replaceState(null, '', window.location.pathname + window.location.search);
                  } catch {
                    // Zie boven: opslag kan onbeschikbaar zijn, dan is er ook niets te wissen.
                  }
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
          <div className="flex items-center gap-2">
            {guided && <Wand2 className="h-4 w-4 text-blue-600" />}
            <span className="text-sm font-medium text-slate-700">
              {guided ? 'Intake' : 'Uw situatie'}
            </span>
          </div>
          <p className="mb-4 text-xs text-slate-400">
            {guided
              ? 'Beantwoord deze vragen; hieronder verschijnen alleen de onderdelen die bij uw situatie horen. Wilt u alles zien? Zet rechtsboven om naar Expert.'
              : 'Deze keuzes bepalen de vorm van de rest van de berekening.'}
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
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
              <p className="text-xs text-slate-500">
                Heeft u een tweede woning met een eigen hypotheekschuld?
              </p>
              <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
                <button
                  type="button"
                  onClick={() => {
                    setHasSecondHome(true);
                    setShowSecondHome(true);
                  }}
                  className={`rounded-md px-3 py-2 sm:py-1.5 text-xs font-semibold transition-all duration-200 ${
                    hasSecondHome
                      ? 'bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  Ja
                </button>
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

        {(!guided || scenarios.length > 0) && (
        <div id="sectie-scenarios" className="mb-6 overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
          <button
            type="button"
            onClick={() => setShowScenarios((prev) => !prev)}
            aria-expanded={showScenarios}
            className="flex w-full items-center justify-between gap-3 p-4 text-left transition-colors duration-200 hover:bg-slate-50"
          >
            <div className="flex items-center gap-2">
              <Save className="h-4 w-4 flex-shrink-0 text-slate-500" />
              <div>
                <span className="text-sm font-medium text-slate-700">
                  Scenario's vergelijken {scenarios.length > 0 ? `(${scenarios.length})` : ''}
                </span>
                {!showScenarios && (
                  <p className="text-xs text-slate-400">
                    {scenarios.length > 0
                      ? 'Bekijk uw opgeslagen varianten naast de huidige invoer'
                      : 'Sla varianten op (andere prijs, rente, aflosvorm) en zet ze naast elkaar'}
                  </p>
                )}
              </div>
            </div>
            {showScenarios ? (
              <ChevronUp className="h-4 w-4 text-slate-400" />
            ) : (
              <ChevronDown className="h-4 w-4 text-slate-400" />
            )}
          </button>
          <AnimatePresence initial={false}>
            {showScenarios && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
                className="overflow-hidden"
              >
                <div className="space-y-4 border-t border-slate-100 p-4">
                  <p className="text-xs text-slate-400">
                    Sla de huidige invoer op als scenario om varianten naast elkaar te
                    vergelijken (bijv. andere aanschafprijs, aflosvorm of rentevastperiode).
                    Scenario's blijven bewaard in deze browser.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      value={newScenarioName}
                      onChange={(e) => setNewScenarioName(e.target.value)}
                      placeholder={`Scenario ${scenarios.length + 1}`}
                      className="min-w-[160px] flex-1 rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        saveCurrentAsScenario(newScenarioName);
                        setNewScenarioName('');
                      }}
                      className="flex items-center gap-1.5 rounded-lg bg-gradient-to-br from-blue-600 to-indigo-700 px-3 py-2 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
                    >
                      <Save className="h-3.5 w-3.5" />
                      Huidige situatie opslaan
                    </button>
                  </div>

                  {scenarios.length > 0 && (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[560px] text-xs">
                        <thead>
                          <tr className="border-b border-slate-100 text-left text-slate-400">
                            <th className="py-2 pr-3 font-medium">Scenario</th>
                            <th className="py-2 pr-3 font-medium">Max. hypotheek</th>
                            <th className="py-2 pr-3 font-medium">Woonquote</th>
                            <th className="py-2 pr-3 font-medium">Bruto woonlast p/m</th>
                            <th className="py-2 pr-3 font-medium">Schulden p/m</th>
                            <th className="py-2 font-medium"></th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr className="border-b border-slate-50 bg-blue-50/40">
                            <td className="py-2 pr-3 font-semibold text-blue-900">
                              Huidig (actieve invoer)
                            </td>
                            <td className="py-2 pr-3 font-semibold text-slate-800">
                              {formatEuro(calc.maxMortgage)}
                            </td>
                            <td className="py-2 pr-3 text-slate-600">
                              {(calc.woonquote * 100).toFixed(1).replace('.', ',')}%
                            </td>
                            <td className="py-2 pr-3 text-slate-600">
                              {formatEuro(calc.maxWoonlastMonthly)}
                            </td>
                            <td className="py-2 pr-3 text-slate-600">
                              {formatEuro(calc.monthlyDebt + calc.studyToetslast)}
                            </td>
                            <td className="py-2"></td>
                          </tr>
                          {scenarios.map((s) => {
                            const summary = computeScenarioSummary(fillDossierDefaults(s.snapshot));
                            return (
                              <tr key={s.id} className="border-b border-slate-50">
                                <td className="py-2 pr-3">
                                  <input
                                    type="text"
                                    value={s.name}
                                    onChange={(e) => renameScenario(s.id, e.target.value)}
                                    className="w-full min-w-[100px] rounded border border-transparent bg-transparent px-1 py-0.5 font-medium text-slate-700 hover:border-slate-200 focus:border-blue-400 focus:outline-none"
                                  />
                                </td>
                                <td className="py-2 pr-3 font-semibold text-slate-800">
                                  {formatEuro(summary.maxMortgage)}
                                </td>
                                <td className="py-2 pr-3 text-slate-600">
                                  {(summary.woonquote * 100).toFixed(1).replace('.', ',')}%
                                </td>
                                <td className="py-2 pr-3 text-slate-600">
                                  {formatEuro(summary.maxWoonlastMonthly)}
                                </td>
                                <td className="py-2 pr-3 text-slate-600">
                                  {formatEuro(summary.monthlyDebt)}
                                </td>
                                <td className="py-2">
                                  <div className="flex items-center gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => loadScenario(s.id)}
                                      title="Laden als actieve invoer"
                                      className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-blue-600"
                                    >
                                      <FolderOpen className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => deleteScenario(s.id)}
                                      title="Verwijderen"
                                      className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-red-600"
                                    >
                                      <X className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      <p className="mt-2 text-[11px] text-slate-400">
                        Alle rijen, ook de opgeslagen scenario's, zijn met dezelfde volledige
                        berekening doorgerekend (inkomen, schulden incl. studieschuld, AOW-toets,
                        energiebonus). De restschuld van uw bestaande hypotheek wordt daarbij
                        per vandaag berekend, niet per de dag van opslaan.
                      </p>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        )}

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
                  <LiquidityToggle
                    amount={ownCapital1}
                    liquid={ownCapital1Liquid}
                    onChange={setOwnCapital1Liquid}
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
                  <LiquidityToggle
                    amount={ownCapital2}
                    liquid={ownCapital2Liquid}
                    onChange={setOwnCapital2Liquid}
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
              <StudyDebtPanel
                loans={studyLoans}
                hasPartner2={hasPartner2}
                study={calc.studyDebt}
                rateMode={studyDebtRateMode}
                onRateModeChange={setStudyDebtRateMode}
                afslagMethod={studyDebtAfslagMethod}
                onAfslagMethodChange={setStudyDebtAfslagMethod}
                onAdd={addStudyLoan}
                onUpdate={updateStudyLoan}
                onRemove={removeStudyLoan}
                budget={studyRepayBudget}
                onBudgetChange={setStudyRepayBudget}
              />
              <p className="mt-3 text-xs text-slate-400">
                Overige schulden tellen mee als 2% van het schuldbedrag per maand en worden van de
                maximale woonlast afgetrokken.
              </p>
              <p className="mt-2 text-xs text-slate-400">
                Betaalde partneralimentatie werkt anders: die gaat bruto (×12) van het
                toetsinkomen af, vóór de woonquote-bepaling. Ontvangen partneralimentatie telt in
                deze indicatieve berekening niet mee als toetsinkomen (geldverstrekkers gaan hier
                verschillend mee om). Kinderalimentatie heeft geen invloed op de maximale
                hypotheek.
              </p>
            </SectionCard>

          {(!guided || hasSecondHome) && (
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
                              <p className="mt-3 text-[11px] text-slate-400">
                                Dit bedrag rechts is hetzelfde bedrag als "Met afslag schulden" /
                                "O.b.v. inkomen alleen" elders in het resultaat — deze afslag zit
                                daar dus al in verwerkt en komt er niet nogmaals bovenop (bijv.
                                bij de renterisicocorrectie op uw meegenomen hypotheek).
                              </p>
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
          )}

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
                className={`mb-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
                  overallAffordable ? 'bg-emerald-500/20 text-emerald-50' : 'bg-red-500/20 text-red-50'
                }`}
              >
                {overallAffordable ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : (
                  <AlertTriangle className="h-3.5 w-3.5" />
                )}
                {overallAffordable ? 'Haalbaar' : 'Nog niet haalbaar'}
              </motion.div>

              <p className="text-lg font-semibold leading-snug text-white">
                {calc.combinedIncome <= 0
                  ? 'Vul uw inkomen in om te zien of deze woning haalbaar is.'
                  : overallAffordable
                    ? `U kunt een woning van ${formatEuro(purchasePrice)} financieren.`
                    : `Voor een woning van ${formatEuro(purchasePrice)} komt u ${formatEuro(
                        affordabilityShortfall
                      )} tekort.`}
              </p>
              {bindingFactor && (
                <p className="mt-1.5 flex items-center gap-1.5 text-xs text-blue-100">
                  <span>
                    Bepalend: <span className="font-semibold text-white">{bindingFactor.label}</span>
                  </span>
                  <InfoTooltip variant="light" text={bindingFactor.explanation} />
                </p>
              )}
              {calc.pensionIncomplete && (
                <p className="mt-1.5 text-xs text-amber-200">
                  Let op: vul het verwachte pensioeninkomen in — de AOW-toets is nog onvolledig.
                </p>
              )}

              <div className="mt-6 space-y-1">
                <p className="text-sm text-blue-100">
                  {hasExistingHome ? 'Maximaal aankoopbudget' : 'Maximale hypotheek'}
                </p>
                <AnimatedEuro
                  value={headlineValue}
                  className="block text-4xl font-bold tracking-tight sm:text-5xl"
                />
                {hasExistingHome && (
                  <p className="text-xs text-blue-200">
                    Incl. meegenomen hypotheek en overwaarde uit verkoop van uw huidige woning.
                  </p>
                )}
              </div>

              {calc.combinedIncome > 0 && (
                <CapacitySummary
                  breakdown={capacityBreakdown}
                  price={safeNum(purchasePrice)}
                  onOpen={() => scrollToSection('sectie-leencapaciteit')}
                />
              )}

              {calc.combinedIncome > 0 && (
                <div className="mt-5 rounded-xl bg-white/10 px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-200">
                    {overallAffordable ? 'Uw ruimte' : 'Zo wordt het haalbaar'}
                  </p>
                  {overallAffordable ? (
                    affordabilityLevers.maxPrice != null && (
                      <p className="mt-1 text-sm leading-relaxed text-blue-50">
                        Met deze invoer kunt u een woning kopen tot ca.{' '}
                        <span className="font-semibold text-white">
                          {affordabilityLevers.maxPrice >= SOLVER_PRICE_CEILING
                            ? `meer dan ${formatEuro(SOLVER_PRICE_CEILING)}`
                            : formatEuro(affordabilityLevers.maxPrice)}
                        </span>
                        {includeKostenKoperInCalc && ' (kosten koper al meegerekend)'}.
                      </p>
                    )
                  ) : (
                    <ul className="mt-2 space-y-2.5 text-sm text-blue-50">
                      {showPriceLever && (
                        <li className="flex flex-col items-start gap-1.5">
                          <span>
                            {affordabilityLevers.maxPrice != null ? (
                              <>
                                Verlaag de aanschafprijs naar max.{' '}
                                <span className="font-semibold text-white">
                                  {formatEuro(affordabilityLevers.maxPrice)}
                                </span>
                              </>
                            ) : (
                              'Met deze invoer is geen enkele aanschafprijs haalbaar.'
                            )}
                          </span>
                          {affordabilityLevers.maxPrice != null && (
                            <button
                              type="button"
                              onClick={() => setPurchasePrice(affordabilityLevers.maxPrice)}
                              className="flex-shrink-0 rounded-md bg-white/15 px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-white/25"
                            >
                              Toepassen
                            </button>
                          )}
                        </li>
                      )}
                      {affordabilityLevers.extraOwnCapital > 0 && (
                        <li>
                          {showPriceLever ? 'Of breng' : 'Breng'}{' '}
                          <span className="font-semibold text-white">
                            {formatEuro(affordabilityLevers.extraOwnCapital)}
                          </span>{' '}
                          extra direct beschikbaar eigen geld in
                        </li>
                      )}
                      {affordabilityLevers.extraOwnCapital == null && limitOwnContribution && hasExistingHome && (
                        <li className="text-xs text-blue-200">
                          Extra eigen geld helpt niet zolang uw eigen-inleg-limiet (kaart Extra
                          bijleenruimte) actief is.
                        </li>
                      )}
                      {affordabilityLevers.fixedRate && (
                        <li className="flex flex-col items-start gap-1.5">
                          <span>
                            Of kies een rentevastperiode van 10 jaar of langer —{' '}
                            {affordabilityLevers.fixedRate.affordable
                              ? 'dan vervalt de toetsrente en is het haalbaar'
                              : `dan vervalt de toetsrente en daalt het tekort naar ${formatEuro(
                                  affordabilityLevers.fixedRate.shortfall
                                )}`}
                          </span>
                          <button
                            type="button"
                            onClick={() => setFixedRatePeriod(10)}
                            className="flex-shrink-0 rounded-md bg-white/15 px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-white/25"
                          >
                            Toepassen
                          </button>
                        </li>
                      )}
                    </ul>
                  )}
                </div>
              )}

              <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-white/15 pt-4">
                <button
                  type="button"
                  onClick={toggleResultDetails}
                  aria-expanded={showResultDetails}
                  className="flex items-center gap-1.5 text-sm font-medium text-blue-100 transition-colors hover:text-white"
                >
                  {showResultDetails ? 'Verberg details' : 'Toon alle details'}
                  {showResultDetails ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                </button>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={quickSaveScenario}
                    className="flex items-center gap-1.5 rounded-lg bg-white/15 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/25"
                  >
                    {scenarioJustSaved ? (
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    ) : (
                      <Save className="h-3.5 w-3.5" />
                    )}
                    {scenarioJustSaved ? 'Opgeslagen' : 'Bewaar als scenario'}
                  </button>
                  {scenarios.length > 0 && (
                    <button
                      type="button"
                      onClick={openScenarioComparison}
                      className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-blue-100 underline-offset-2 transition-colors hover:text-white hover:underline"
                    >
                      Vergelijk ({scenarios.length})
                    </button>
                  )}
                </div>
              </div>

              <AnimatePresence initial={false}>
                {showResultDetails && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.3, ease: 'easeOut' }}
                    className="overflow-hidden"
                  >
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
                          Leencapaciteit zonder afslagen
                          <InfoTooltip
                            variant="light"
                            text="Uw leencapaciteit op basis van de Nibud-woonquote en uw werkelijke rente, zonder rekening te houden met bestaande schulden of renterisico."
                          />
                        </span>
                        <span className="text-sm font-semibold text-white">
                          {formatEuro(calc.maxLoanIncomeOnly)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="flex items-center gap-1.5 text-xs text-blue-100">
                          Met afslag schulden
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
                          Met afslag schulden + renterisico
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
                            {calc.studyAfslag > 0 && (
                              <li className="rounded-lg bg-white/10 p-3">
                                <p className="font-semibold text-white">
                                  {calc.monthlyDebt > 0 ? '6' : '5'}. Studieschuld (DUO)
                                </p>
                                <p className="mt-1.5">
                                  Termijnen {formatEuro(calc.studyDebt.totalTermijn)}/mnd × opslagfactor{' '}
                                  {formatFactor(calc.studyDebt.factor)} (debetrente{' '}
                                  {formatPct3(calc.studyDebt.debetrente)}) ={' '}
                                  {formatEuro(calc.studyToetslast)}/mnd toetslast
                                </p>
                                <p className="mt-1">
                                  Gekapitaliseerd tegen {formatPct3(calc.studyDebt.afslagRatePct)} (
                                  {AFSLAG_METHOD_SHORT[calc.studyDebt.afslagMethod]}, 360 mnd):
                                  −{formatEuro(calc.studyAfslag)} afslag
                                </p>
                              </li>
                            )}
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
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            </BorderGlow>
          </div>
        </div>

        {calc.combinedIncome > 0 && (
          <CapacityBreakdownSection
            breakdown={capacityBreakdown}
            price={safeNum(purchasePrice)}
            energyLabel={energyLabel}
            hasPartner2={hasPartner2}
            maxPrice={affordabilityLevers.maxPrice}
            onGoToDebts={() => scrollToSection('sectie-schulden')}
          />
        )}

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
                maandlasten. De benodigde hypotheek is de aanschafprijs minus het eigen vermogen
                dat overblijft nadat de kosten koper (niet mee te financieren) eruit zijn betaald,
                begrensd op uw maximale hypotheek o.b.v. inkomen.
              </p>

              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
                  <span className="text-xs text-slate-400">Benodigde hypotheek</span>
                  <p className="text-lg font-bold text-slate-800">
                    {formatEuro(starterRequiredMortgage)}
                  </p>
                  <span className="text-[11px] text-slate-400">
                    {starterGapCalc.requiredMortgage > calc.maxMortgage
                      ? `Begrensd op max. hypotheek o.b.v. inkomen (${formatEuro(calc.maxMortgage)})`
                      : `Aanschafprijs ${formatEuro(purchasePrice)} − eigen vermogen${
                          includeKostenKoperInCalc ? ' na kosten koper' : ''
                        } ${formatEuro(Math.max(0, starterGapCalc.ownCapitalAfterCosts))}`}
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
                      maximum van {formatEuro(getLenderCap(lenderCapThreshold))} bij uw
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
                        Restschuld per vandaag {formatEuro(currentMortgage.currentDebtBalance)}
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
                    <div className="space-y-1.5">
                      <span className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                        <Euro className="h-3.5 w-3.5 text-slate-400" />
                        Oorspronkelijke hypotheekschuld
                      </span>
                      <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-base text-slate-800">
                        {formatEuro(originalDebtTotal)}
                      </p>
                      <p className="text-xs text-slate-400">
                        Som van de hoofdsommen bij aanvang van de leningdelen hieronder (niet de
                        restschuld)
                      </p>
                    </div>
                    <DateField
                      id="startDate"
                      label="Ingangsdatum hypotheek"
                      icon={<CalendarDays className="h-3.5 w-3.5 text-slate-400" />}
                      value={startDate}
                      onChange={setStartDate}
                      hint="Geldt voor alle leningdelen; bepaalt samen met de rente de restschuld per vandaag"
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
                          currentBalance={safeNum(currentLoanParts[index]?.principal)}
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
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                      <div>
                        <span className="flex items-center gap-1.5 text-xs text-slate-400">
                          Leencapaciteit zonder afslagen
                          <InfoTooltip text="Uw leencapaciteit op basis van de Nibud-woonquote en uw werkelijke rente, zonder rekening te houden met bestaande schulden of renterisico." />
                        </span>
                        <p className="text-lg font-semibold text-slate-800">
                          {formatEuro(calc.maxLoanIncomeOnly)}
                        </p>
                      </div>
                      <div>
                        <span className="flex items-center gap-1.5 text-xs text-slate-400">
                          Met afslag schulden
                          <InfoTooltip text="Hetzelfde bedrag, nu met de maandlast van uw overige schulden en studieschuld erin verwerkt." />
                        </span>
                        <p className="text-lg font-semibold text-slate-800">
                          {formatEuro(calc.incomeBasedMaxAtActualRate)}
                        </p>
                      </div>
                      <div>
                        <span className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
                          Met afslag schulden + renterisico
                          <InfoTooltip text="Definitief bindend bedrag: ook getoetst tegen de AFM-toetsrente zodra een leningdeel — nieuw of meegenomen — korter dan 10 jaar rentevast is." />
                        </span>
                        <p
                          className={`text-lg font-bold ${
                            currentMortgage.hasRateRiskOnPortedDebt
                              ? 'text-amber-600'
                              : 'text-slate-900'
                          }`}
                        >
                          {formatEuro(currentMortgage.effectiveMaxMortgage)}
                        </p>
                        {currentMortgage.hasRateRiskOnPortedDebt && (
                          <span className="text-[11px] text-amber-600">Na renterisicocorrectie</span>
                        )}
                      </div>
                    </div>
                    <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
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

                          {calc.illiquidOwnCapital > 0 && (
                            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
                              <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-700">
                                Tijdelijk financieringsgat vóór verkoop tweede woning
                                <InfoTooltip text="U heeft aangegeven dat een deel van uw ingebrachte eigen vermogen nu nog niet liquide is. Dat bedrag telt daarom niet mee bij 'Gedekt door inbreng eigen vermogen' hierboven en verhoogt in plaats daarvan de aanvullende hypotheek — totdat het vrijkomt." />
                              </span>
                              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                                <div>
                                  <span className="text-xs text-slate-500">Aanvullende hypotheek nu</span>
                                  <p className="text-sm font-semibold text-slate-800">
                                    {formatEuro(combinedGapCalc.additionalMortgage)}
                                  </p>
                                </div>
                                <div>
                                  <span className="text-xs text-slate-500">
                                    Zou zijn geweest mét dit vermogen
                                  </span>
                                  <p className="text-sm font-semibold text-slate-800">
                                    {formatEuro(
                                      Math.max(
                                        0,
                                        combinedGapCalc.additionalMortgage - calc.illiquidOwnCapital
                                      )
                                    )}
                                  </p>
                                </div>
                                <div>
                                  <span className="text-xs font-medium text-amber-700">
                                    Te overbruggen bedrag
                                  </span>
                                  <p className="text-sm font-bold text-amber-800">
                                    {formatEuro(
                                      Math.min(calc.illiquidOwnCapital, combinedGapCalc.additionalMortgage)
                                    )}
                                  </p>
                                </div>
                              </div>
                              <p className="mt-3 text-[11px] text-amber-700">
                                Dit bedrag is niet per se een extra kostenpost — het is het deel van
                                uw eigen vermogen dat u tijdelijk elders vandaan moet halen (bijv. een
                                overbruggingskrediet of familielening hieronder) totdat het vrijkomt.
                              </p>
                            </div>
                          )}

                          {combinedGapCalc.exceedsLenderCap && (
                            <div className="mt-3">
                              <StatusBadge status="warning">
                                Let op: uw totale hypotheek na verhuizing (meegenomen plus
                                aanvullend) komt uit op{' '}
                                {formatEuro(combinedGapCalc.totalMortgageAfterMove)}, boven het
                                door u ingestelde maximum van{' '}
                                {formatEuro(getLenderCap(lenderCapThreshold))} bij uw geldverstrekker
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

                          {combinedGapCalc.withinCapacity && calc.illiquidOwnCapital <= 0 ? (
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
                              {combinedGapCalc.withinCapacity ? (
                                <StatusBadge status="success">
                                  Haalbaar: de aanvullende hypotheek past binnen{' '}
                                  {combinedGapCalc.bindingCapIsLender
                                    ? 'uw ingestelde geldverstrekkersmaximum'
                                    : 'uw bijleenruimte o.b.v. inkomen'}
                                  , met nog {formatEuro(combinedGapCalc.capacityMargin)} marge. Een
                                  deel hiervan komt doordat uw niet-liquide eigen vermogen (zie
                                  hierboven) nu als hypotheek wordt meegefinancierd — u kunt dat met
                                  een familielening hieronder vervangen, zodat u niet harder op uw
                                  hypotheek leunt dan nodig.
                                </StatusBadge>
                              ) : (
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
                              )}

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
                                  {calc.illiquidOwnCapital > 0 && (
                                    <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-4">
                                      <span className="text-xs font-semibold uppercase tracking-wide text-indigo-700">
                                        Suggestie voor het te vragen bedrag
                                      </span>
                                      <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                                        <div>
                                          <span className="text-xs text-slate-500">
                                            Minimaal nodig (sluit alleen uw bijleenruimte-gat)
                                          </span>
                                          <p className="text-sm font-semibold text-slate-800">
                                            {formatEuro(combinedGapCalc.shortfallBeforeFamilyLoan)}
                                          </p>
                                        </div>
                                        <div>
                                          <span className="text-xs text-slate-500">
                                            Aanbevolen (niet-liquide vermogen + buffer)
                                          </span>
                                          <p className="text-sm font-semibold text-indigo-700">
                                            {formatEuro(
                                              calc.illiquidOwnCapital *
                                                (1 + safeNum(familyLoanBufferPct) / 100)
                                            )}
                                          </p>
                                        </div>
                                      </div>
                                      <div className="mt-3">
                                        <Slider
                                          id="familyLoanBufferPct"
                                          label="Buffer bovenop niet-liquide vermogen"
                                          icon={<Percent className="h-3.5 w-3.5 text-slate-400" />}
                                          value={familyLoanBufferPct}
                                          min={0}
                                          max={25}
                                          step={1}
                                          onChange={setFamilyLoanBufferPct}
                                          formatValue={(v) => `${v}%`}
                                          hint="Marge voor rente tijdens de looptijd en onzekerheid over de uiteindelijke verkoopprijs/kosten."
                                        />
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setFamilyLoanAmount(
                                            String(
                                              Math.round(
                                                calc.illiquidOwnCapital *
                                                  (1 + safeNum(familyLoanBufferPct) / 100)
                                              )
                                            )
                                          )
                                        }
                                        className="mt-3 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-indigo-700"
                                      >
                                        Vul aanbevolen bedrag in
                                      </button>
                                      {hasSecondHome && !secondHomeWillSell && (
                                        <p className="mt-3 text-[11px] text-indigo-700">
                                          Deze lening overbrugt tot de verkoop van uw tweede woning
                                          (verwachte netto-opbrengst{' '}
                                          {formatEuro(calc.secondHomeNetProceedsIfSold)}); zodra die
                                          verkocht is, lost u 'm af.
                                        </p>
                                      )}
                                    </div>
                                  )}
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

                                  <div>
                                    <span className="text-xs font-medium text-slate-600">
                                      Aflossing familielening
                                    </span>
                                    <div className="mt-1.5 inline-flex rounded-lg border border-slate-200 bg-white p-1">
                                      <button
                                        type="button"
                                        onClick={() => setFamilyLoanRepaymentType('ineens')}
                                        className={`rounded-md px-3 py-2 sm:py-1.5 text-xs font-semibold transition-all duration-200 ${
                                          familyLoanRepaymentType === 'ineens'
                                            ? 'bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-sm'
                                            : 'text-slate-500 hover:text-slate-700'
                                        }`}
                                      >
                                        Ineens (bijv. bij verkoop)
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setFamilyLoanRepaymentType('maandelijks')}
                                        className={`rounded-md px-3 py-2 sm:py-1.5 text-xs font-semibold transition-all duration-200 ${
                                          familyLoanRepaymentType === 'maandelijks'
                                            ? 'bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-sm'
                                            : 'text-slate-500 hover:text-slate-700'
                                        }`}
                                      >
                                        Maandelijks
                                      </button>
                                    </div>
                                    <p className="mt-1.5 text-[11px] text-slate-400">
                                      {familyLoanRepaymentType === 'ineens'
                                        ? 'Ineens (bijv. bij verkoop van de tweede woning) heeft geen invloed op uw leencapaciteit hierboven.'
                                        : 'Een maandelijkse aflossing is een reguliere verplichting en telt daarom mee als schuld in de Nibud-toets — dit verlaagt uw leencapaciteit.'}
                                    </p>
                                    {familyLoanRepaymentType === 'maandelijks' && (
                                      <div className="mt-3 max-w-xs">
                                        <CurrencyField
                                          id="familyLoanMonthlyRepayment"
                                          label="Maandelijkse aflossing"
                                          icon={<Euro className="h-3.5 w-3.5 text-slate-400" />}
                                          value={familyLoanMonthlyRepayment}
                                          onChange={setFamilyLoanMonthlyRepayment}
                                          placeholder="0"
                                        />
                                      </div>
                                    )}
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
                                        {formatEuro(
                                          combinedGapCalc.familyLoanMonthlyInterest +
                                            calc.familyLoanMonthlyDebt
                                        )}
                                      </p>
                                      <span className="text-[11px] text-slate-400">
                                        {familyLoanRepaymentType === 'maandelijks'
                                          ? 'Rente + aflossing, telt mee in de Nibud-toets'
                                          : 'Alleen rente, geen aflossingsaanname'}
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
                            {formatEuro(getLenderCap(lenderCapThreshold))} bij uw geldverstrekker
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
                ...(maxBudgetCalc.oudeHypotheek > 0
                  ? [
                      {
                        label: 'Oude hypotheek (meegenomen)',
                        value: maxBudgetCalc.oudeHypotheek,
                        className: 'bg-blue-400',
                        dotClassName: 'bg-blue-400',
                      },
                    ]
                  : []),
                {
                  label: 'Overwaarde',
                  value: maxBudgetCalc.overwaarde,
                  className: 'bg-teal-400',
                  dotClassName: 'bg-teal-400',
                },
                {
                  label: 'Nieuwe hypotheek (max. extra)',
                  value: maxBudgetCalc.nieuweHypotheekMax,
                  className: 'bg-indigo-500',
                  dotClassName: 'bg-indigo-500',
                },
                {
                  label: 'Eigen vermogen inbreng',
                  value: maxBudgetCalc.eigenVermogen,
                  className: 'bg-emerald-400',
                  dotClassName: 'bg-emerald-400',
                },
              ]}
              total={maxBudgetCalc.maxBudget}
              marker={maxBudgetCalc.price}
              costZone={
                maxBudgetCalc.kostenKoper > 0
                  ? {
                      start: maxBudgetCalc.price,
                      amount: maxBudgetCalc.kostenKoper,
                      label: 'Kosten koper',
                    }
                  : null
              }
            />

            <div
              className={`mt-6 grid grid-cols-1 gap-4 ${
                maxBudgetCalc.kostenKoper > 0 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'
              }`}
            >
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                <span className="text-xs text-slate-400">Maximaal aankoopbudget</span>
                <p className="text-2xl font-bold text-slate-900">
                  {formatEuro(maxBudgetCalc.maxBudget)}
                </p>
              </div>
              {maxBudgetCalc.kostenKoper > 0 && (
                <div className="rounded-xl border border-violet-100 bg-violet-50 p-4">
                  <span className="text-xs text-violet-600">Kosten koper (indicatief)</span>
                  <p className="text-2xl font-bold text-violet-700">
                    {formatEuro(maxBudgetCalc.kostenKoper)}
                  </p>
                </div>
              )}
              {(() => {
                const useAfterCosts = maxBudgetCalc.kostenKoper > 0;
                const value = useAfterCosts
                  ? maxBudgetCalc.remainingAfterCosts
                  : maxBudgetCalc.remainingRoom;
                const positive = value >= 0;
                const label = positive
                  ? useAfterCosts
                    ? 'Overgebleven ruimte (na woning + kosten koper)'
                    : 'Overgebleven ruimte t.o.v. aanschafprijs'
                  : useAfterCosts
                    ? 'Tekort (na woning + kosten koper)'
                    : 'Tekort t.o.v. aanschafprijs';
                return (
                  <div
                    className={`rounded-xl border p-4 ${
                      positive ? 'border-emerald-100 bg-emerald-50' : 'border-red-100 bg-red-50'
                    }`}
                  >
                    <span className={`text-xs ${positive ? 'text-emerald-600' : 'text-red-600'}`}>
                      {label}
                    </span>
                    <p
                      className={`text-2xl font-bold ${
                        positive ? 'text-emerald-700' : 'text-red-700'
                      }`}
                    >
                      {formatEuro(Math.abs(value))}
                    </p>
                  </div>
                );
              })()}
            </div>

            <p className="mt-4 text-xs text-slate-400">
              De gearceerde violette zone laat zien welk deel van uw budget na de aanschafprijs
              nog naar kosten koper gaat — dat geld (grotendeels eigen middelen) kunt u niet óók
              aan de woning zelf besteden. Nieuwe hypotheek (max. extra) is uw
              inkomensgebaseerde bijleenruimte, al gecorrigeerd voor eventueel renterisico op
              leningdelen met een resterende rentevastperiode korter dan 10 jaar. Dit is een
              theoretisch maximum: het is niet per definitie verstandig om dit volledig te
              benutten.
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
