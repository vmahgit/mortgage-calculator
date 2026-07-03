import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronDown,
  ChevronUp,
  Search,
  MapPin,
  Loader2,
  AlertTriangle,
  TrendingUp,
} from 'lucide-react';
import { getCompleteHousingData } from './housingData';

const currencyFormatter = new Intl.NumberFormat('nl-NL', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
});

function formatEuro(amount) {
  return currencyFormatter.format(amount ?? 0);
}

function formatDateNL(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' }).format(d);
}

// Lijn-/vlakgrafiek van de absolute WOZ-waarde per peildatum, zodat je in één oogopslag
// zowel het verloop (cumulatief) als de daadwerkelijke bedragen ziet — i.p.v. losse
// procentuele staafjes per jaar.
function WozValueChart({ points }) {
  const width = 640;
  const height = 200;
  const padding = { top: 20, right: 16, bottom: 28, left: 56 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const years = points.map((p) => new Date(p.peildatum).getFullYear());
  const minYear = Math.min(...years);
  const maxYear = Math.max(...years);
  const values = points.map((p) => p.vastgesteldeWaarde);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const valueRange = Math.max(1, maxValue - minValue);
  const yPad = valueRange * 0.2;
  const yMin = minValue - yPad;
  const yMax = maxValue + yPad;

  const xScale = (year) =>
    maxYear === minYear
      ? padding.left + chartWidth / 2
      : padding.left + ((year - minYear) / (maxYear - minYear)) * chartWidth;
  const yScale = (value) =>
    padding.top + chartHeight - ((value - yMin) / (yMax - yMin)) * chartHeight;

  const linePoints = points.map((p) => [
    xScale(new Date(p.peildatum).getFullYear()),
    yScale(p.vastgesteldeWaarde),
  ]);
  const baseline = padding.top + chartHeight;

  const areaPath =
    `M ${linePoints[0][0]},${baseline} ` +
    linePoints.map(([x, y]) => `L ${x},${y}`).join(' ') +
    ` L ${linePoints[linePoints.length - 1][0]},${baseline} Z`;
  const linePath = `M ${linePoints.map(([x, y]) => `${x},${y}`).join(' L ')}`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full">
      <defs>
        <linearGradient id="wozAreaGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6366f1" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0, 0.5, 1].map((f, i) => {
        const y = padding.top + chartHeight * f;
        const value = yMax - f * (yMax - yMin);
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
              €{Math.round(value / 1000)}k
            </text>
          </g>
        );
      })}
      <path d={areaPath} fill="url(#wozAreaGradient)" />
      <path d={linePath} fill="none" stroke="#6366f1" strokeWidth="2.5" strokeLinejoin="round" />
      {points.map((p, i) => (
        <circle key={p.peildatum} cx={linePoints[i][0]} cy={linePoints[i][1]} r="3.5" fill="#6366f1" />
      ))}
      {points.map((p, i) => (
        <text
          key={`${p.peildatum}-label`}
          x={linePoints[i][0]}
          y={height - 8}
          textAnchor="middle"
          fontSize="10"
          fill="#94a3b8"
        >
          {new Date(p.peildatum).getFullYear()}
        </text>
      ))}
    </svg>
  );
}

// Losstaand, optioneel hulpmiddel: haalt woninggegevens op via een adres en toont deze,
// zonder dat het de hoofdberekening van de hypotheekcalculator raakt. Alleen als de
// gebruiker expliciet op de knop klikt, wordt een waarde overgenomen in de calculator (via
// de onUseValue-callback). De state hier (adresinvoer, laadstatus, resultaat) is bewust
// volledig lokaal en losstaand van de calculator-state in MortgageCalculator.
export default function OptionalPropertyDataModule({ onUseValue, useValueLabel, purchasePrice }) {
  const [expanded, setExpanded] = useState(false);
  const [addressInput, setAddressInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [showAllWoz, setShowAllWoz] = useState(false);

  const handleSearch = async () => {
    if (!addressInput.trim()) return;
    setExpanded(true);
    setLoading(true);
    setError(null);
    setResult(null);
    setShowAllWoz(false);
    try {
      const data = await getCompleteHousingData(addressInput.trim());
      setResult(data);
    } catch (err) {
      setError(err.message || 'Er ging iets mis bij het opzoeken van dit adres.');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSearch();
    }
  };

  const mostRecentWoz = result?.woz?.waarden?.[0] ?? null;
  const allOlderWozValues = result?.woz?.waarden?.slice(1) ?? [];
  // Net als wozwaardeloket.nl zelf: standaard maar 3 peildatums tonen (de meest recente
  // plus de 2 daaronder), met een "Alles weergeven"-link voor de rest.
  const olderWozValues = showAllWoz ? allOlderWozValues : allOlderWozValues.slice(0, 2);
  const hasMoreWozValues = allOlderWozValues.length > 2;

  // Cumulatieve waardeontwikkeling o.b.v. alle beschikbare peildatums (niet beperkt tot
  // de 3 die standaard zichtbaar zijn in de tabel erboven), inclusief de absolute
  // WOZ-waarden zelf voor de grafiek.
  const wozTimeline = (() => {
    const waarden = result?.woz?.waarden;
    if (!waarden || waarden.length < 2) return null;
    const points = [...waarden].sort((a, b) => new Date(a.peildatum) - new Date(b.peildatum));
    const first = points[0];
    const last = points[points.length - 1];
    const cumulativePct =
      first.vastgesteldeWaarde > 0
        ? ((last.vastgesteldeWaarde - first.vastgesteldeWaarde) / first.vastgesteldeWaarde) * 100
        : 0;
    return { points, first, last, cumulativePct };
  })();

  // Prijs per vierkante meter wordt normaliter berekend op de gebruiksoppervlakte (het
  // woonoppervlak), niet de perceelgrootte.
  const gebruiksoppervlakte = result?.bag?.gebruiksoppervlakte || null;
  const pricePerM2Woz =
    mostRecentWoz && gebruiksoppervlakte ? mostRecentWoz.vastgesteldeWaarde / gebruiksoppervlakte : null;
  const pricePerM2Purchase =
    purchasePrice && gebruiksoppervlakte ? purchasePrice / gebruiksoppervlakte : null;

  return (
    <div className="mt-8 overflow-hidden rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 shadow-sm">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-center justify-between p-5 text-left transition-all duration-200 hover:bg-slate-100/60"
      >
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-200/70 text-slate-600">
            <MapPin className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-slate-700">
              👉 Woninggegevens opzoeken via adres (optioneel)
            </h2>
            <p className="text-xs text-slate-400">
              Hulpmiddel om bouwjaar, oppervlakte en WOZ-waarden op te zoeken. Heeft geen
              invloed op de berekening, tenzij u dat zelf kiest.
            </p>
          </div>
        </div>
        {expanded ? (
          <ChevronUp className="h-5 w-5 flex-shrink-0 text-slate-400" />
        ) : (
          <ChevronDown className="h-5 w-5 flex-shrink-0 text-slate-400" />
        )}
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="space-y-4 border-t border-slate-200 p-5">
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  type="text"
                  value={addressInput}
                  onChange={(e) => setAddressInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Bijv. Damrak 1, Amsterdam"
                  className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition-all duration-200 focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                />
                <button
                  type="button"
                  onClick={handleSearch}
                  disabled={loading || !addressInput.trim()}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-slate-700 px-4 py-2 text-sm font-semibold text-white transition-all duration-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Search className="h-4 w-4" />
                  )}
                  Zoek woning
                </button>
              </div>
              <p className="text-xs text-slate-400">
                Gegevens afkomstig van de publieke, gratis registraties van het Kadaster (BAG,
                Kadastrale Kaart) en het WOZ-waardeloket. Indicatief, geen rechten aan te
                ontlenen.
              </p>

              <AnimatePresence>
                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.2 }}
                    className="flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 p-3"
                  >
                    <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" />
                    <p className="text-xs text-red-700">{error}</p>
                  </motion.div>
                )}
              </AnimatePresence>

              {result && (
                <div className="space-y-4">
                  <div>
                    <p className="text-sm font-medium text-slate-700">{result.address.weergavenaam}</p>
                    {(result.woz?.wozobjectnummer || result.bag?.gebruiksdoel) && (
                      <p className="text-xs text-slate-400">
                        {result.woz?.wozobjectnummer && (
                          <>WOZ-identificatie: {result.woz.wozobjectnummer}</>
                        )}
                        {result.woz?.wozobjectnummer && result.bag?.gebruiksdoel && ' · '}
                        {result.bag?.gebruiksdoel && <>Gebruiksdoel: {result.bag.gebruiksdoel}</>}
                      </p>
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="rounded-xl border border-slate-100 bg-white p-3">
                      <span className="text-xs font-medium text-slate-400">Bouwjaar</span>
                      <p className="text-lg font-semibold text-slate-800">
                        {result.bag?.bouwjaar ?? '—'}
                      </p>
                      {!result.bag && <p className="text-xs text-amber-600">Niet beschikbaar</p>}
                    </div>
                    <div className="rounded-xl border border-slate-100 bg-white p-3">
                      <span className="text-xs font-medium text-slate-400">Gebruiksoppervlakte</span>
                      <p className="text-lg font-semibold text-slate-800">
                        {result.bag?.gebruiksoppervlakte ? `${result.bag.gebruiksoppervlakte} m²` : '—'}
                      </p>
                      {!result.bag && <p className="text-xs text-amber-600">Niet beschikbaar</p>}
                    </div>
                    <div className="rounded-xl border border-slate-100 bg-white p-3">
                      <span className="text-xs font-medium text-slate-400">Perceelgrootte</span>
                      <p className="text-lg font-semibold text-slate-800">
                        {result.grondoppervlakte ? `${result.grondoppervlakte} m²` : '—'}
                      </p>
                      {!result.grondoppervlakte && (
                        <p className="text-xs text-slate-400">
                          Niet gekoppeld (bijv. bij appartementsrecht)
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-100 bg-white p-4">
                    <div className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      <TrendingUp className="h-3.5 w-3.5" />
                      Historische WOZ-waarden
                    </div>
                    {mostRecentWoz ? (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between rounded-lg bg-emerald-50 px-3 py-2">
                          <span className="text-xs text-emerald-700">
                            Meest recent ({formatDateNL(mostRecentWoz.peildatum)})
                          </span>
                          <span className="text-sm font-bold text-emerald-800">
                            {formatEuro(mostRecentWoz.vastgesteldeWaarde)}
                          </span>
                        </div>
                        {olderWozValues.length > 0 && (
                          <ul className="space-y-1 text-xs text-slate-500">
                            {olderWozValues.map((w) => (
                              <li key={w.peildatum} className="flex items-center justify-between">
                                <span>{formatDateNL(w.peildatum)}</span>
                                <span className="font-medium text-slate-700">
                                  {formatEuro(w.vastgesteldeWaarde)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                        {hasMoreWozValues && (
                          <button
                            type="button"
                            onClick={() => setShowAllWoz((prev) => !prev)}
                            className="text-xs font-medium text-blue-600 hover:text-blue-700 hover:underline"
                          >
                            {showAllWoz ? '‹ Minder weergeven' : `› Alles weergeven (${allOlderWozValues.length + 1} peildatums)`}
                          </button>
                        )}
                        {onUseValue && (
                          <button
                            type="button"
                            onClick={() => onUseValue(mostRecentWoz.vastgesteldeWaarde)}
                            className="mt-2 w-full rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition-all duration-200 hover:bg-blue-700"
                          >
                            Gebruik deze WOZ-waarde {useValueLabel ? `in ${useValueLabel}` : 'in de berekening'}
                          </button>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400">
                        {result.wozError ?? 'Geen WOZ-waarden gevonden voor dit adres.'}
                      </p>
                    )}
                  </div>

                  {wozTimeline && (
                    <div className="rounded-xl border border-slate-100 bg-white p-4">
                      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                          <TrendingUp className="h-3.5 w-3.5" />
                          Waardeontwikkeling (cumulatief)
                        </div>
                        <span
                          className={`text-sm font-bold ${
                            wozTimeline.cumulativePct >= 0 ? 'text-emerald-600' : 'text-red-600'
                          }`}
                        >
                          {wozTimeline.cumulativePct >= 0 ? '+' : ''}
                          {wozTimeline.cumulativePct.toFixed(1)}% sinds{' '}
                          {new Date(wozTimeline.first.peildatum).getFullYear()}
                        </span>
                      </div>
                      <p className="mb-3 text-xs text-slate-400">
                        Van {formatEuro(wozTimeline.first.vastgesteldeWaarde)} (
                        {new Date(wozTimeline.first.peildatum).getFullYear()}) naar{' '}
                        {formatEuro(wozTimeline.last.vastgesteldeWaarde)} (
                        {new Date(wozTimeline.last.peildatum).getFullYear()})
                      </p>
                      <WozValueChart points={wozTimeline.points} />
                    </div>
                  )}

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-slate-100 bg-white p-3">
                      <span className="text-xs font-medium text-slate-400">
                        m²-prijs o.b.v. meest actuele WOZ-waarde
                      </span>
                      <p className="text-lg font-semibold text-slate-800">
                        {pricePerM2Woz ? `${formatEuro(pricePerM2Woz)} / m²` : '—'}
                      </p>
                      {!pricePerM2Woz && (
                        <p className="text-xs text-slate-400">
                          {mostRecentWoz ? 'Gebruiksoppervlakte niet beschikbaar' : 'Geen WOZ-waarde beschikbaar'}
                        </p>
                      )}
                    </div>
                    <div className="rounded-xl border border-slate-100 bg-white p-3">
                      <span className="text-xs font-medium text-slate-400">
                        m²-prijs o.b.v. aanschafprijs beoogde woning
                      </span>
                      <p className="text-lg font-semibold text-slate-800">
                        {pricePerM2Purchase ? `${formatEuro(pricePerM2Purchase)} / m²` : '—'}
                      </p>
                      {!pricePerM2Purchase && (
                        <p className="text-xs text-slate-400">
                          {purchasePrice ? 'Gebruiksoppervlakte niet beschikbaar' : 'Geen aanschafprijs ingevuld'}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
