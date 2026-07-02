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

// Losstaand, optioneel hulpmiddel: haalt woninggegevens op via een adres en toont deze,
// zonder dat het de hoofdberekening van de hypotheekcalculator raakt. Alleen als de
// gebruiker expliciet op de knop klikt, wordt een waarde overgenomen in de calculator (via
// de onUseValue-callback). De state hier (adresinvoer, laadstatus, resultaat) is bewust
// volledig lokaal en losstaand van de calculator-state in MortgageCalculator.
export default function OptionalPropertyDataModule({ onUseValue, useValueLabel }) {
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
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
