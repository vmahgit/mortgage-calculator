import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useScroll, useTransform } from 'framer-motion';
import { ChevronDown, Home, Sparkles } from 'lucide-react';
import MortgageCalculator from './MortgageCalculator';

// Sfeerbeelden: moderne, Noord-Europese/Nederlandse vrijstaande villa's (Unsplash) —
// baksteen/betonarchitectuur met platte daken en grote raampartijen, in plaats van de
// eerdere witgestucte mediterrane stijl. Een reeks i.p.v. één beeld, die op de
// achtergrond langzaam doorkruist zodat de hero nooit statisch aanvoelt.
const HERO_IMAGES = [
  'https://images.unsplash.com/photo-1696237461860-630be53f179c?auto=format&fit=crop&w=2400&q=80',
  'https://images.unsplash.com/photo-1696237583261-029171ee31fa?auto=format&fit=crop&w=2400&q=80',
  'https://images.unsplash.com/photo-1686385798052-0e86d41b4a60?auto=format&fit=crop&w=2400&q=80',
  'https://images.unsplash.com/photo-1549357957-99ab8644c268?auto=format&fit=crop&w=2400&q=80',
];

// Herbruikbare scroll-reveal wrapper: laat kinderen elegant infaden zodra ze in beeld
// scrollen. `once` zodat het niet steeds opnieuw animeert bij op-en-neer scrollen.
// `amount` is het aandeel van het element dat zichtbaar moet zijn voor de trigger: voor
// compacte content is 0.2 (20%) een mooie drempel, maar voor een element dat veel hoger
// is dan het beeldscherm (zoals de hele calculator) is 20% van de totale hoogte nooit
// gelijktijdig zichtbaar — dan moet amount laag (of 0) staan, anders blijft het element
// permanent onzichtbaar (opacity 0) zodra je er direct naartoe scrollt/linkt.
function Reveal({ children, className = '', delay = 0, amount = 0.2 }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 32 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount }}
      transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1], delay }}
    >
      {children}
    </motion.div>
  );
}

function Hero({ onScrollToCalculator }) {
  const heroRef = useRef(null);
  const [imageIndex, setImageIndex] = useState(0);

  // Parallax: de achtergrond beweegt langzamer dan de scroll, de tekst iets sneller weg.
  const { scrollYProgress } = useScroll({
    target: heroRef,
    offset: ['start start', 'end start'],
  });
  const bgY = useTransform(scrollYProgress, [0, 1], ['0%', '30%']);
  const contentY = useTransform(scrollYProgress, [0, 1], ['0%', '60%']);
  const contentOpacity = useTransform(scrollYProgress, [0, 0.7], [1, 0]);

  // Rotatie door de villa-foto's op de achtergrond. Staat stil bij "verminderde beweging".
  useEffect(() => {
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced || HERO_IMAGES.length <= 1) return;

    const interval = setInterval(() => {
      setImageIndex((i) => (i + 1) % HERO_IMAGES.length);
    }, 6000);
    return () => clearInterval(interval);
  }, []);

  return (
    <section ref={heroRef} className="relative h-dvh w-full overflow-hidden">
      {/* Parallax-achtergrond: kruisvervagende villa-foto's, met een langzame Ken
          Burns-zoom per foto zodat de achtergrond nooit stilstaat. */}
      <motion.div style={{ y: bgY }} className="absolute inset-0 z-0 h-[130%] w-full">
        <AnimatePresence>
          <motion.img
            key={imageIndex}
            src={HERO_IMAGES[imageIndex]}
            alt="Moderne Nederlandse vrijstaande villa"
            initial={{ opacity: 0, scale: 1 }}
            animate={{ opacity: 1, scale: 1.08 }}
            exit={{ opacity: 0 }}
            transition={{ opacity: { duration: 1.5, ease: 'easeInOut' }, scale: { duration: 6.5, ease: 'linear' } }}
            className="absolute inset-0 h-full w-full object-cover"
            loading="eager"
          />
        </AnimatePresence>
        {/* Lichte gradient-overlay: alleen bovenin/onderin getint zodat de foto in het
            midden goed zichtbaar blijft, met een vloeiende overgang naar de lichte
            calculator-sectie onderaan. Leesbaarheid van de tekst komt van de aparte
            vignet-laag hieronder, niet van deze vlakke tint. */}
        <div className="absolute inset-0 bg-gradient-to-b from-slate-900/35 via-slate-900/10 to-slate-50" />
        {/* Radiale vignet, gecentreerd op de tekst, voor contrast zonder de hele foto te
            verdonkeren. */}
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(ellipse 70% 55% at 50% 42%, rgba(15,23,42,0.55) 0%, rgba(15,23,42,0) 70%)',
          }}
        />
      </motion.div>

      {/* Indicatordots voor de fotoreeks */}
      <div className="absolute bottom-20 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5">
        {HERO_IMAGES.map((_, i) => (
          <span
            key={i}
            className={`h-1.5 rounded-full transition-all duration-500 ${
              i === imageIndex ? 'w-5 bg-amber-400' : 'w-1.5 bg-white/40'
            }`}
          />
        ))}
      </div>

      <motion.div
        style={{ y: contentY, opacity: contentOpacity }}
        className="relative z-10 mx-auto flex h-full max-w-5xl flex-col items-center justify-center px-6 text-center"
      >
        <motion.span
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className="mb-6 inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-white/10 px-4 py-1.5 text-xs font-medium text-amber-200 backdrop-blur-sm"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Nibud-systematiek 2026
        </motion.span>

        <motion.h1
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
          className="text-4xl font-bold leading-tight tracking-tight text-white sm:text-6xl lg:text-7xl"
        >
          Hypotheek
          <span className="block bg-gradient-to-r from-amber-200 via-amber-400 to-amber-200 bg-clip-text text-transparent">
            Calculator
          </span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.25 }}
          className="mt-6 max-w-2xl text-base text-slate-200 sm:text-lg"
        >
          Ontdek in enkele seconden wat u kunt lenen. Een heldere, indicatieve
          hypotheekberekening — inclusief energielabel, schulden en overwaarde.
        </motion.p>

        <motion.button
          type="button"
          onClick={onScrollToCalculator}
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.4 }}
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.97 }}
          className="mt-10 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-amber-400 to-amber-500 px-8 py-4 text-base font-semibold text-slate-950 shadow-lg shadow-amber-500/20 transition-shadow hover:shadow-xl hover:shadow-amber-500/30"
        >
          <Home className="h-5 w-5" />
          Bereken mijn hypotheek
        </motion.button>
      </motion.div>

      {/* Scroll-indicator */}
      <motion.button
        type="button"
        onClick={onScrollToCalculator}
        aria-label="Scroll naar de calculator"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1, duration: 0.6 }}
        className="absolute bottom-8 left-1/2 -translate-x-1/2 text-white/70"
      >
        <motion.span
          animate={{ y: [0, 8, 0] }}
          transition={{ repeat: Infinity, duration: 1.8, ease: 'easeInOut' }}
          className="block"
        >
          <ChevronDown className="h-7 w-7" />
        </motion.span>
      </motion.button>
    </section>
  );
}

export default function LandingPage() {
  const calculatorRef = useRef(null);

  const scrollToCalculator = () => {
    calculatorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="min-h-dvh w-full bg-gradient-to-b from-slate-50 via-white to-slate-50">
      <Hero onScrollToCalculator={scrollToCalculator} />

      <section ref={calculatorRef} className="relative w-full">
        {/* Zachte gloed-accenten in de achtergrond voor diepte */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -top-40 left-1/4 h-96 w-96 rounded-full bg-amber-300/20 blur-3xl" />
          <div className="absolute top-1/3 right-0 h-96 w-96 rounded-full bg-blue-300/20 blur-3xl" />
        </div>

        <div className="relative mx-auto max-w-6xl px-4 pt-16 sm:px-6 lg:px-10">
          <Reveal className="text-center">
            <span className="text-sm font-medium uppercase tracking-widest text-amber-600">
              De berekening
            </span>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              Wat kunt u lenen?
            </h2>
            <p className="mx-auto mt-3 max-w-2xl text-sm text-slate-500 sm:text-base">
              Vul uw gegevens in en zie direct uw maximale hypotheek. Alles wordt live
              herberekend — geen knoppen, geen wachten.
            </p>
          </Reveal>
        </div>

        <Reveal delay={0.1} amount={0}>
          <MortgageCalculator />
        </Reveal>
      </section>
    </div>
  );
}
