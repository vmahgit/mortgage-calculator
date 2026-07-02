import { useRef } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';
import { ChevronDown, Home, Sparkles } from 'lucide-react';
import MortgageCalculator from './MortgageCalculator';

// Sfeerbeeld: Amsterdams grachtenpand (Unsplash). Losse constante zodat je 'm makkelijk
// kunt vervangen door een eigen beeld.
const HERO_IMAGE =
  'https://images.unsplash.com/photo-1512470876302-972faa2aa9a4?auto=format&fit=crop&w=2400&q=80';

// Herbruikbare scroll-reveal wrapper: laat kinderen elegant infaden zodra ze in beeld
// scrollen. `once` zodat het niet steeds opnieuw animeert bij op-en-neer scrollen.
function Reveal({ children, className = '', delay = 0 }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 32 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1], delay }}
    >
      {children}
    </motion.div>
  );
}

function Hero({ onScrollToCalculator }) {
  const heroRef = useRef(null);
  // Parallax: de achtergrond beweegt langzamer dan de scroll, de tekst iets sneller weg.
  const { scrollYProgress } = useScroll({
    target: heroRef,
    offset: ['start start', 'end start'],
  });
  const bgY = useTransform(scrollYProgress, [0, 1], ['0%', '30%']);
  const contentY = useTransform(scrollYProgress, [0, 1], ['0%', '60%']);
  const contentOpacity = useTransform(scrollYProgress, [0, 0.7], [1, 0]);

  return (
    <section ref={heroRef} className="relative h-dvh w-full overflow-hidden">
      {/* Parallax-achtergrond */}
      <motion.div style={{ y: bgY }} className="absolute inset-0 z-0 h-[130%] w-full">
        <img
          src={HERO_IMAGE}
          alt="Amsterdams grachtenpand"
          className="h-full w-full object-cover"
          loading="eager"
        />
        {/* Gradient-overlay voor leesbaarheid van de tekst, met een vloeiende overgang naar
            de donkere calculator-sectie onderaan. */}
        <div className="absolute inset-0 bg-gradient-to-b from-slate-950/40 via-slate-950/45 to-slate-950" />
      </motion.div>

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
          Jouw Nederlandse
          <span className="block bg-gradient-to-r from-amber-200 via-amber-400 to-amber-200 bg-clip-text text-transparent">
            droomhuis begint hier
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
    <div className="min-h-dvh w-full bg-slate-950">
      <Hero onScrollToCalculator={scrollToCalculator} />

      <section ref={calculatorRef} className="relative w-full">
        {/* Zachte gloed-accenten in de achtergrond voor diepte */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -top-40 left-1/4 h-96 w-96 rounded-full bg-amber-500/10 blur-3xl" />
          <div className="absolute top-1/3 right-0 h-96 w-96 rounded-full bg-blue-500/10 blur-3xl" />
        </div>

        <div className="relative mx-auto max-w-6xl px-4 pt-16 sm:px-6 lg:px-10">
          <Reveal className="text-center">
            <span className="text-sm font-medium uppercase tracking-widest text-amber-300/80">
              De berekening
            </span>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Wat kunt u lenen?
            </h2>
            <p className="mx-auto mt-3 max-w-2xl text-sm text-slate-300 sm:text-base">
              Vul uw gegevens in en zie direct uw maximale hypotheek. Alles wordt live
              herberekend — geen knoppen, geen wachten.
            </p>
          </Reveal>
        </div>

        <Reveal delay={0.1}>
          <MortgageCalculator />
        </Reveal>
      </section>
    </div>
  );
}
