import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronUp, TrendingUp, AlertTriangle } from 'lucide-react';

const currencyFormatter = new Intl.NumberFormat('nl-NL', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
});

function formatEuro(amount) {
  return currencyFormatter.format(amount ?? 0);
}

function formatPct(pct) {
  return pct > 0 ? `+${pct}%` : `${pct}%`;
}

// Losstaand, optioneel blok: vergelijkt wat een hogere/lagere bieding t.o.v. de
// aanschafprijs betekent voor de benodigde hypotheek en de bruto/netto maandlast.
// Kolommen die de leencapaciteit o.b.v. inkomen overschrijden worden rood gemarkeerd.
export default function ScenarioAnalysis({ scenarios, incomeBasedMax }) {
  const [expanded, setExpanded] = useState(false);
  const anyExceeds = scenarios.some((s) => s.exceedsCapacity);

  return (
    <div className="mt-8 overflow-hidden rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 shadow-sm">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-center justify-between p-5 text-left transition-all duration-200 hover:bg-slate-100/60"
      >
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-200/70 text-slate-600">
            <TrendingUp className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-slate-700">
              📊 Scenario-analyse: biedingen (optioneel)
            </h2>
            <p className="text-xs text-slate-400">
              Vergelijk wat een hogere of lagere bieding betekent voor uw maandlasten.
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
            <div className="space-y-3 border-t border-slate-200 p-5">
              {anyExceeds && (
                <div className="flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 p-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" />
                  <p className="text-xs text-red-700">
                    Rood gemarkeerde biedingen vereisen een hypotheek boven uw leencapaciteit
                    o.b.v. inkomen ({formatEuro(incomeBasedMax)}) en zijn naar verwachting niet
                    (volledig) te financieren.
                  </p>
                </div>
              )}

              <div className="overflow-x-auto rounded-xl border border-slate-100 bg-white">
                <table className="w-full min-w-[760px] border-collapse text-xs">
                  <thead>
                    <tr>
                      <th className="sticky left-0 z-10 bg-white p-2.5 text-left font-semibold text-slate-500">
                        Bieding
                      </th>
                      {scenarios.map((s) => (
                        <th
                          key={s.pct}
                          className={`p-2.5 text-right font-semibold ${
                            s.pct === 0 ? 'border-x-2 border-blue-300 bg-blue-50 text-blue-700' : 'text-slate-500'
                          } ${s.exceedsCapacity ? 'bg-red-50 text-red-600' : ''}`}
                        >
                          {formatPct(s.pct)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-t border-slate-100">
                      <td className="sticky left-0 z-10 bg-white p-2.5 font-medium text-slate-600">
                        Aankoopprijs
                      </td>
                      {scenarios.map((s) => (
                        <td
                          key={s.pct}
                          className={`p-2.5 text-right ${
                            s.pct === 0 ? 'border-x-2 border-blue-300 bg-blue-50/60' : ''
                          } ${s.exceedsCapacity ? 'bg-red-50 font-semibold text-red-700' : 'text-slate-700'}`}
                        >
                          {formatEuro(s.price)}
                        </td>
                      ))}
                    </tr>
                    <tr className="border-t border-slate-100">
                      <td className="sticky left-0 z-10 bg-white p-2.5 font-medium text-slate-600">
                        Hyp. maandlast bruto
                      </td>
                      {scenarios.map((s) => (
                        <td
                          key={s.pct}
                          className={`p-2.5 text-right ${
                            s.pct === 0 ? 'border-x-2 border-blue-300 bg-blue-50/60' : ''
                          } ${s.exceedsCapacity ? 'bg-red-50 font-semibold text-red-700' : 'text-slate-700'}`}
                        >
                          {formatEuro(s.grossMonthly)}
                        </td>
                      ))}
                    </tr>
                    <tr className="border-t border-slate-100">
                      <td className="sticky left-0 z-10 bg-white p-2.5 font-medium text-slate-600">
                        Hyp. maandlast netto
                      </td>
                      {scenarios.map((s) => (
                        <td
                          key={s.pct}
                          className={`p-2.5 text-right ${
                            s.pct === 0 ? 'border-x-2 border-b-2 border-blue-300 bg-blue-50/60' : ''
                          } ${s.exceedsCapacity ? 'bg-red-50 font-semibold text-red-700' : 'text-slate-700'}`}
                        >
                          {formatEuro(s.netMonthly)}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>

              <p className="text-xs text-slate-400">
                Bruto/netto maandlast o.b.v. annuïteit, de huidige hypotheekrente en 30 jaar
                looptijd, uitgaande van uw ingebrachte eigen vermogen. Netto is inclusief
                hypotheekrenteaftrek (HRA) en het eigenwoningforfait. Indicatief.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
