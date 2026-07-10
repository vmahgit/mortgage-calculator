import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';

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

// Desktop: dunne stippen-rail vast aan de linkerrand van het scherm, buiten de
// content-kolommen om (die zelf al de volle breedte gebruiken tot lg:grid-cols-5). Op
// kleinere/lagere breedtes (< xl) staat hij uit, dan is de mobiele chipbalk het overzicht.
export default function SectionRail({ sections, activeId, progress, onNavigate }) {
  return (
    <div className="pointer-events-none fixed inset-y-0 left-0 z-30 hidden w-14 xl:flex xl:items-center">
      <div className="pointer-events-auto relative mx-auto flex flex-col items-center">
        <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-slate-200" />
        <div
          className="absolute left-1/2 top-0 w-px -translate-x-1/2 rounded-full bg-gradient-to-b from-blue-500 to-indigo-500 transition-[height] duration-150 ease-linear"
          style={{ height: `${progress * 100}%` }}
        />
        <div className="relative flex flex-col gap-6 py-6">
          {sections.map((s) => {
            const isActive = s.id === activeId;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => onNavigate(s.id)}
                aria-label={s.label}
                aria-current={isActive ? 'true' : undefined}
                className="group relative flex h-3 w-3 items-center justify-center"
              >
                <motion.span
                  animate={{
                    scale: isActive ? 1 : 0.55,
                    backgroundColor: isActive ? '#2563eb' : '#cbd5e1',
                  }}
                  whileHover={{ scale: isActive ? 1.15 : 0.85 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                  className="block h-3 w-3 rounded-full shadow-sm"
                />
                {isActive && (
                  <motion.span
                    layoutId="section-rail-ring"
                    className="absolute inset-0 rounded-full border-2 border-blue-400/50"
                    initial={{ scale: 1, opacity: 0.6 }}
                    animate={{ scale: 2.1, opacity: 0 }}
                    transition={{ duration: 1.1, repeat: Infinity, ease: 'easeOut' }}
                  />
                )}
                <span className="pointer-events-none absolute left-6 top-1/2 -translate-y-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-[11px] font-medium text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100">
                  {s.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
