import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Check, AlertTriangle, Minus } from 'lucide-react';

// offsetTop (via de offsetParent-keten) geeft de positie van een element zoals het in de
// normale document-flow zou staan — anders dan getBoundingClientRect(), dat bij
// `position: sticky` de actuele, "vastgeplakte" schermpositie teruggeeft zodra het
// element sticky wordt. Het Resultaat-paneel is `lg:sticky`, dus zonder deze correctie
// blijft zijn rect-top de hele tijd vlak bij de bovenkant van het scherm hangen — waardoor
// hij bijna altijd "wint" van de sectie waar je écht doorheen aan het scrollen bent
// (Inkomen, Schulden, ...). offsetTop is daar ongevoelig voor.
function getDocumentTop(el) {
  let top = 0;
  let node = el;
  while (node) {
    top += node.offsetTop;
    node = node.offsetParent;
  }
  return top;
}

// Volgt welke sectie nu het dichtst bij de bovenkant van het scherm staat (rekening
// houdend met de sticky topbar) én hoe ver je über haupt door de hele reeks secties heen
// bent gescrold. `active` drijft de gemarkeerde stip/chip aan, `progress` (0-1) de vullijn
// — apart bijgehouden omdat "welke sectie" en "hoe ver in het geheel" niet hetzelfde zijn
// (bijv. lange Schulden-sectie: lang actief, maar de voortgang loopt er gestaag doorheen).
export function useScrollSpy(ids) {
  const [active, setActive] = useState(ids[0]);
  const [progress, setProgress] = useState(0);
  const tickingRef = useRef(false);

  useEffect(() => {
    function measure() {
      // De laatste id (Resultaat) is een sticky metgezel van de hele linkerkolom-rij, niet
      // een eigen opeenvolgende stop: zijn natuurlijke (unstuck) top valt in dezelfde grid-
      // rij als Inkomen, dus in de gewone "dichtstbijzijnde-top"-race is hij structureel
      // gelijk aan Inkomen. Daarom doet hij niet mee in die race; hij wordt pas actief
      // zodra je voorbij de hele linkerkolom-inhoud bent gescrold.
      const contentIds = ids.slice(0, -1);
      const companionId = ids[ids.length - 1];

      let bestId = contentIds[0] ?? companionId;
      let bestDist = Infinity;
      for (const id of contentIds) {
        const el = document.getElementById(id);
        if (!el) continue;
        const top = getDocumentTop(el) - window.scrollY;
        // "Actief" = de sectie waarvan de bovenkant het dichtst bij ~1/4e van het scherm
        // ligt, zolang hij niet al voorbij gescrold is. Zo wordt de net-in-beeld-komende
        // sectie actief, niet pas wanneer hij het scherm domineert.
        if (top <= window.innerHeight * 0.35) {
          const dist = Math.abs(top - window.innerHeight * 0.15);
          if (dist < bestDist) {
            bestDist = dist;
            bestId = id;
          }
        }
      }

      const lastContentEl = document.getElementById(contentIds[contentIds.length - 1]);
      if (lastContentEl) {
        const lastContentBottom = getDocumentTop(lastContentEl) + lastContentEl.offsetHeight;
        const scanline = window.scrollY + window.innerHeight * 0.35;
        if (scanline > lastContentBottom) bestId = companionId;
      }
      setActive(bestId);

      const first = document.getElementById(ids[0]);
      const last = document.getElementById(ids[ids.length - 1]);
      if (first && last) {
        const firstTop = getDocumentTop(first);
        const lastBottom = getDocumentTop(last) + last.offsetHeight;
        const total = lastBottom - firstTop;
        const scrolled = window.scrollY + window.innerHeight * 0.35 - firstTop;
        setProgress(total > 0 ? Math.min(1, Math.max(0, scrolled / total)) : 0);
      }
    }

    function onScroll() {
      if (tickingRef.current) return;
      tickingRef.current = true;
      setTimeout(() => {
        tickingRef.current = false;
        measure();
      }, 50);
    }

    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join('|')]);

  return { active, progress };
}

// Per-stap-status → node-uiterlijk. De statussen komen uit de validatie-afleidingen die de
// calculator toch al berekent (isOverIndebted, cappedByPropertyValue, withinCapacity, …),
// hier alleen vertaald naar een glyph + kleur:
//   done      ✓  groen   — sectie ingevuld en zonder knelpunt
//   attention ⚠  amber   — een validatie-afleiding vraagt aandacht (schuldenknelpunt,
//                          restschuld, financieringsgat, boven aanschafprijs, …)
//   ignored   –  grijs   — optionele sectie die (nog) niet is ingevuld / niet van toepassing
//   todo      ○  grijs   — verplichte sectie die nog wacht op invoer
const STATUS_STYLES = {
  done: { ring: 'border-emerald-500', bg: 'bg-emerald-500', text: 'text-white' },
  attention: { ring: 'border-amber-400', bg: 'bg-amber-400', text: 'text-white' },
  ignored: { ring: 'border-slate-300', bg: 'bg-white', text: 'text-slate-300' },
  todo: { ring: 'border-slate-300', bg: 'bg-white', text: 'text-slate-300' },
};

function StatusGlyph({ status }) {
  if (status === 'done') return <Check className="h-3.5 w-3.5" strokeWidth={3} />;
  if (status === 'attention') return <AlertTriangle className="h-3 w-3" strokeWidth={2.5} />;
  if (status === 'ignored') return <Minus className="h-3 w-3" strokeWidth={2.5} />;
  return null; // todo: lege node
}

// Desktop: een verticale stepper vast aan de linkerrand, buiten de content-kolommen om.
// Vervangt de oude stippen-rail: nu genummerde/gestatuste stappen met een doorlopende
// voortgangslijn en per-stap-status. Op < xl staat hij uit (dan is de mobiele chipbalk het
// overzicht). Labels staan inline vanaf 2xl (daar is genoeg gutter-ruimte naast de
// max-w-6xl-kolom); op xl verschijnt het label als hover-tooltip zodat de smalle gutter
// niet over de content valt.
export default function SectionRail({ sections, activeId, progress, onNavigate }) {
  return (
    <nav
      aria-label="Voortgang"
      className="pointer-events-none fixed inset-y-0 left-0 z-30 hidden xl:flex xl:items-center"
    >
      <div className="pointer-events-auto relative ml-1 flex max-h-[90vh] flex-col overflow-y-auto py-6 pl-1 pr-0 [-ms-overflow-style:none] [scrollbar-width:none] 2xl:ml-5 2xl:pl-2 2xl:pr-2 [&::-webkit-scrollbar]:hidden">
        <ol className="relative flex flex-col gap-1.5">
          {/* Doorlopende baan + voortgangsvulling, uitgelijnd op het midden van de nodes (14px). */}
          <div className="absolute left-[14px] top-4 bottom-4 w-px -translate-x-1/2 bg-slate-200" />
          <div
            className="absolute left-[14px] top-4 w-px -translate-x-1/2 rounded-full bg-gradient-to-b from-blue-500 to-indigo-500 transition-[height] duration-150 ease-linear"
            style={{ height: `calc(${progress * 100}% - 2rem)` }}
          />
          {sections.map((s, i) => {
            const isActive = s.id === activeId;
            const status = s.status || 'todo';
            const style = STATUS_STYLES[status] || STATUS_STYLES.todo;
            return (
              <li key={s.id} className="relative">
                <button
                  type="button"
                  onClick={() => onNavigate(s.id)}
                  aria-label={`${s.label} — ${status}`}
                  aria-current={isActive ? 'step' : undefined}
                  className="group flex items-center gap-3 rounded-lg py-1 pr-1 text-left transition-colors duration-150 2xl:pr-3"
                >
                  <span className="relative flex h-7 w-7 flex-shrink-0 items-center justify-center">
                    {isActive && (
                      <motion.span
                        layoutId="section-rail-ring"
                        className="absolute inset-0 rounded-full border-2 border-blue-400/50"
                        initial={{ scale: 1, opacity: 0.6 }}
                        animate={{ scale: 1.9, opacity: 0 }}
                        transition={{ duration: 1.1, repeat: Infinity, ease: 'easeOut' }}
                      />
                    )}
                    <motion.span
                      animate={{ scale: isActive ? 1.12 : 1 }}
                      transition={{ duration: 0.2, ease: 'easeOut' }}
                      className={`flex h-7 w-7 items-center justify-center rounded-full border-2 shadow-sm ring-2 ring-transparent transition-colors duration-200 ${
                        style.ring
                      } ${style.bg} ${style.text} ${
                        isActive ? 'ring-blue-200' : ''
                      }`}
                    >
                      {status === 'todo' ? (
                        <span className="text-[11px] font-semibold text-slate-400">{i + 1}</span>
                      ) : (
                        <StatusGlyph status={status} />
                      )}
                    </motion.span>
                  </span>
                  {/* Inline label vanaf 2xl. */}
                  <span
                    className={`hidden max-w-[9rem] truncate text-xs font-medium transition-colors duration-150 2xl:block ${
                      isActive ? 'text-slate-900' : 'text-slate-500 group-hover:text-slate-800'
                    }`}
                  >
                    {s.label}
                  </span>
                  {/* Hover-tooltip op xl (waar de inline labels verborgen zijn). */}
                  <span className="pointer-events-none absolute left-9 top-1/2 -translate-y-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-[11px] font-medium text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 2xl:hidden">
                    {s.label}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </nav>
  );
}
