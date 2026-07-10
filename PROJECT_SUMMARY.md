# Hypotheekcalculator 2026 — projectsamenvatting

**Laatste commit**: `58a00a3` — bekijk `git log --oneline` voor de volledige geschiedenis
(65+ commits, elke stap apart, dus alles is terug te draaien met `git revert <hash>`).
Working tree is schoon; alles hieronder staat al gepusht naar GitHub
(`vmahgit/mortgage-calculator`, branch `main`) én live op Vercel.

Live: https://mortgage-calculator-three-drab.vercel.app *(dit IS de huidige versie —
elke sessie tot nu toe eindigde met `git push` + `npx vercel --prod --yes`. Blijf dat
patroon aanhouden: na wijzigingen pushen naar GitHub en publiceren via
`npx vercel --prod --yes` in `C:\Users\Vincent\mortgage-calculator`. `vercel`/`gh` staan
niet standaard in PATH; gebruik `npx vercel` — die logt al in als `vfredriksz-4509` en
het project is al gelinkt via `.vercel/project.json`, dus geen extra setup nodig.)*
Repo: `C:\Users\Vincent\mortgage-calculator` (git-repo op je eigen schijf)
Stack: Vite + React + Tailwind CSS v4 + framer-motion + lucide-react, gehost op Vercel.

## Wat de tool doet
Indicatieve Nederlandse hypotheekcalculator voor zowel starters (geen bestaande woning)
als doorstromers (bestaande woning met hypotheek, overwaarde, meeneemregeling). Rekent
met de echte Nibud-woonquote-systematiek 2026, niet met een benaderde leenfactor.

## Belangrijkste architectuurkeuzes
- **Rekenkern** (`src/nibud2026.js`): officiële financieringslastpercentages (Tabel 1,
  Wijzigingsregeling hypothecair krediet 2026, Stcrt. 2025, 36471) als ankerpunten, met
  bilineaire interpolatie tussen inkomens- en toetsrenteschijven.
- **Hoofdcomponent** (`src/MortgageCalculator.jsx`, ~4900 regels): alle calculator-state
  en -logica zit in `MortgageCalculatorForm`; de `export default MortgageCalculator` is
  een dunne wrapper die alleen een `resetKey` bijhoudt en `MortgageCalculatorForm` met
  die `key` rendert — "Opnieuw beginnen" hoogt de key op en remount't zo de hele vorm met
  verse defaults, zonder elk los state-veld handmatig te moeten resetten. Bevat o.a.
  financieringsgat-berekening (meegenomen hypotheek + overwaarde + eigen vermogen +
  restschuld-tekort bij onderwaarde, schakelbaar via de meeneemregeling-toggle),
  scenario-analyse, aflossingsgrafiek, starters-maandlastenblok, instelbare
  aflossingsvrij-norm (30/50/100%).
- **Woninggegevens-opzoeker** (`src/OptionalPropertyDataModule.jsx` +
  `src/housingData.js`): haalt bouwjaar, oppervlakte, perceelgrootte en historische
  WOZ-waarden (incl. cumulatieve waardeontwikkeling-grafiek en %-wijziging per jaar) op
  via uitsluitend **gratis, publieke overheids-API's** (PDOK Locatieserver, PDOK
  BAG-kaartendienst, en de publieke API die wozwaardeloket.nl zelf gebruikt) — geen
  API-sleutel, geen backend, geen scraping nodig.
- **Scenario-analyse** (`src/ScenarioAnalysis.jsx`): "wat als ik X% meer/minder bied"-
  tabel, gekoppeld aan de daadwerkelijk ingestelde leningdelen (niet een generieke
  aanname), incl. maandlast van alleen het nieuwe leningdeel apart van het totaal.
- **Landingspagina** (`src/LandingPage.jsx`): cinematische hero met roterende
  Nederlandse villafoto's (Unsplash), scroll-parallax, count-up-animaties, titel
  "Hypotheek Calculator" met gouden gradient.
- **Kosten koper & overdrachtsbelasting** (`src/kostenKoper.js`): `getTransferTaxRate()`
  bepaalt het gedifferentieerde tarief (0% startersvrijstelling 18–34 jr onder
  €555.000, 2% eigen woning, 8% niet-hoofdverblijf, 0%/n.v.t. bij nieuwbouw);
  `getKostenKoperBreakdown()` splitst kosten koper op in per-post aanpasbare en
  aan/uit te zetten bedragen (notaris, taxatie, advies, bankgarantie, makelaar,
  NHG-provisie). `calc` in MortgageCalculator.jsx is de ene gedeelde bron —
  `newHomeCalc`, `doubleCostsCalc`, de sidebar en het financieringsgatblok lezen
  er allemaal uit.
- **Toetsinkomen per aanvrager** (`src/toetsinkomen.js`): `getToetsinkomen()` bouwt
  het toetsinkomen op uit inkomenstype (vast / flex met of zonder
  intentieverklaring / ZZP, met 3-jaarsmiddeling gemaximeerd op het laatste jaar),
  structureel inkomen (13e maand, telt volledig) en incidenteel inkomen (gemiddelde
  bonus/overwerk), min betaalde partneralimentatie (bruto ×12, vóór de
  woonquote-bepaling — dus geen kapitalisatie zoals schulden). Retourneert een
  transparant opbouwobject (basis, structureel, aftrek, cap-vlaggen) — een
  voorschot op de nog openstaande auditbare-toetsopbouw-taak.
- **AOW-toets** (`src/nibud2026.js`): tweede financieringslasttabel (Tabel 2, zelfde
  Stcrt. 2025-36471) voor consumenten die de AOW-leeftijd al bereikt hebben, via de
  optie `{ aow: true }` op `getWoonquote()`/`getIncomeBasedMortgage()`. Vanaf
  leeftijd 57 (binnen 10 jaar van AOW-leeftijd 67) toetst `calc` in
  MortgageCalculator.jsx zowel het huidige inkomen als het ingevoerde verwachte
  pensioeninkomen; de laagste `maxLoan` is bindend, toegepast vóór de
  energiebonus/LTV-cap zodat ook de doorstromer-bijleenruimte de toets volgt. Leeg
  pensioenveld → expliciete waarschuwing, geen toets op €0.
- **Meeneemregeling schakelbaar** (`takeOverMortgage`, default aan): bij "nee, aflossen"
  wordt `currentMortgage.portedDebt` 0 en vervalt het renterisico op de oude leningdelen.
  Dit is de ene plek waar dat wordt bepaald; `combinedGapCalc`, `maxBudgetCalc`,
  `scenarioAnalysis`, `additionalLoanCalc` en de aflossingsgrafiek lezen er allemaal uit.

## Visuele/UX-polish (op verzoek, na de professionaliseringsronde)
Acht kleine fases, elk als eigen commit met browser-verificatie (zie
`git log --oneline` rond de commits ná "Alimentatie..."):
1. Hero-overlay verlicht (was bijna ondoorzichtig) + Ken Burns-zoom op de villafoto's.
2. Mobiele voortgangsbalk (horizontaal scrollbaar i.p.v. lelijk wrappen) + een fixed
   bottom-bar met live resultaat-samenvatting zolang het echte paneel niet in beeld is
   (`IntersectionObserver` op `sectie-resultaat`).
3. `AdvancedFieldsToggle` verbergt zelden-gebruikte velden (13e maand, bonus,
   alimentatie) achter "Meer opties", standaard dicht.
4. `SectionCard`-accentkleuren per categorie + hover-lift op alle kaarten.
5. `InfoTooltip` bij vaktermen (toetsinkomen, woonquote, AFM-toetsrente, ...). Let op:
   een tooltip-popover (div) mag nooit in een `<p>` genest worden — geeft een
   HTML-nesting/hydration-fout; gebruik `<span>` als wrapper.
6. `InlineNote` voor puur informatieve toelichtingen; `StatusBadge` alleen nog voor
   verdicts/acties.
7. Micro-interacties: puls op `AnimatedEuro` bij >5% wijziging, fade-in op
   `AmortizationChart`, een "vier het moment"-wiebel op de statuspil bij de overgang
   van niet-haalbaar naar haalbaar.
8. "Opnieuw beginnen"-knop (key-remount-patroon) + inklapbare "Bronnen & aannames".

## Workflow- en logica-ronde (na de visuele polish, meest recente werk)
Gebouwd naar aanleiding van een kritische UX-review ("voelt als een zwarte doos",
"voortgangsbalk liegt"), daarna verder verfijnd met concrete correcties. Elke stap
weer een eigen commit + browser-verificatie.

- **Voortgangsbalk is nu eerlijk anker-navigatie, geen pseudo-wizard**: geen
  verbindingslijnen, geen cumulatieve voortgangsbalk meer (die suggereerden een
  Volgende/Terug-flow die er nooit was — alles is en blijft altijd tegelijk
  zichtbaar/bewerkbaar, past bij de landingspagina-tekst "geen knoppen, geen
  wachten"). Chips zijn losse pills; volgorde matcht nu de fysieke paginavolgorde
  (zie hieronder). Korte ondertitel maakt expliciet dat je overal naartoe kunt
  springen.
- **"Uw situatie" is één paneel geworden**: woningsituatie-toggle (Ja/Nee al een
  woning) én de aantal-aanvragers-toggle (1/2, was verstopt in de Inkomen-kaart)
  staan nu samen bovenaan, vóórdat er een bedrag wordt gevraagd.
- **Paginavolgorde omgedraaid**: Uw situatie → **Beoogde woning** → Inkomen →
  Schulden → **Kosten koper** (i.p.v. Inkomen/Schulden eerst, Beoogde woning +
  Kosten koper als los blok erna). Reden: bezoekers hebben meestal al een
  concreet huis/prijsklasse in gedachten voordat ze hun inkomen intikken. De
  AOW-pensioenbanner verhuisde mee naar vlak vóór de Inkomen-kaart (waar hij
  inhoudelijk bij hoort). Puur JSX-herordening via een node-scriptje (cut/paste
  op exacte regelnummers) — geen calc-logica gewijzigd.
- **"Type aankoop (overdrachtsbelasting)" verhuisd** van de kaart Beoogde woning
  náár de kaart Kosten koper (logischer: het bepaalt daar direct een kostenpost).
- **Kosten koper is nu inklapbaar** (zelfde patroon als "Huidige Hypotheek
  Analyseren"/"Nibud dubbele-lastentoets": handgerolde collapsible i.p.v.
  `SectionCard`, met violet accent-linkerrand), **standaard dichtgeklapt**. De
  header toont altijd het totaalbedrag + of het meetelt, ook dicht.
- **Kosten koper telt standaard NIET mee in de berekening**: nieuwe
  `includeKostenKoperInCalc`-toggle ("Ja, meetellen"/"Nee, niet meetellen"),
  default **uit**. Kosten koper wordt altijd volledig berekend/getoond in de
  kaart zelf; de toggle bepaalt alleen `calc.ownMoney` (sidebar "Geschat eigen
  geld") en `doubleCostsCalc.kostenKoper` (dubbele-lastentoets) — de enige twee
  plekken waar het daadwerkelijk in een berekening werd meegenomen (de
  financieringsgat-berekening voor doorstromers sloot het al uit). Let op: de
  knoplabels zijn bewust "meetellen"/"niet meetellen" i.p.v. "meenemen" om
  verwarring met de bestaande meeneemregeling-toggle (hypotheek meenemen bij
  verhuizing) te voorkomen — die deelde eerder per ongeluk exact dezelfde
  knoptekst "Ja, meenemen".
- **Causaliteit zichtbaar gemaakt**: nieuw blok "Bepalend voor uw maximum nu"
  bovenaan het resultaatpaneel (sidebar), direct onder de statuspil. Eén
  geprioriteerde, samenhangende verklaring i.p.v. losse statuslabels: schulden >
  AOW-toets > (bij bestaande woning) lender-cap/restschuld/bijleenruimte/
  renterisico op meegenomen hypotheek, anders de normale woonquote, of (bij
  starter) de aanschafprijs als plafond. Berekend in een eigen `bindingFactor`
  useMemo die `calc`/`currentMortgage`/`combinedGapCalc` samenvoegt.
- **Inkomenstype-dropdown toont nu vooruitblik**: de opties zelf bevatten een
  korte gevolg-hint ("vraagt 3 jaarcijfers", "telt volledig mee"), zichtbaar
  zodra je de dropdown openklapt — vóór de keuze, niet pas erna
  (`INCOME_TYPES` in `toetsinkomen.js`).
- **Sliders ruimer, nieuwe defaults, schakelbare tweede aanvrager**: inkomen tot
  €300k (was €150k), eigen vermogen tot €400k (was €200k). Nieuwe
  `hasPartner2`-toggle (1/2 aanvragers, staat nu in "Uw situatie"): bij 1
  aanvrager telt niets van Partner 2 mee (inkomen, vermogen, schulden, leeftijd,
  startersvrijstelling), ook niet als er nog oude waarden in die velden staan —
  gegated via `hasPartner2 ?` op elke plek waar `income2`/`ownCapital2`/`debt2`/
  `age2`/etc. de `calc` ingaan.
- **iPhone-invoerfix**: alle tekst-inputs/selects naar 16px lettergrootte (onder
  16px zoomt Safari automatisch in bij focus — waarschijnlijk de oorzaak van
  eerdere "werkt niet optimaal"-klachten). Alle 20 wissel-knoppen groter
  tikoppervlak op mobiel (`py-2` i.p.v. `py-1.5`, ongewijzigd vanaf `sm:`).
  Slider-track iets dikker (`h-2` → `h-3`) + `touch-none` voor directere
  sleeprespons.
- **€1.000.000-grens-waarschuwing nu ook voor starters**: bestond al voor
  doorstromers (`combinedGapCalc.exceedsLenderCap`, `additionalLoanCalc.
  exceedsLenderCap`); nu ook `starterLoanCalc.exceedsLenderCap` met dezelfde
  `StatusBadge`-waarschuwing in de starters-hypotheekkaart.
- **Startersvrijstelling leeftijdsafhankelijk gemaakt**: het vinkje "nog niet
  gebruikt" wordt alleen nog getoond (en telt dus alleen nog mee) voor een koper
  van 18 t/m 34 jaar (`STARTER_EXEMPTION_MIN_AGE`/`MAX_AGE` uit `kostenKoper.js`)
  — daarbuiten een uitlegzin i.p.v. een inert vinkje. Default nu **false**
  ("al gebruikt") i.p.v. altijd `true`. Default leeftijd beide personen: **36**
  jaar (was 35/34) — dit is bewust bóven de startersgrens, dus met de defaults
  zie je meteen de "niet in aanmerking"-uitlegzin i.p.v. de checkbox.
- **HRA-tarief (hypotheekrenteaftrek) inkomensafhankelijk gemaakt** — was een
  vaste 37,56% voor iedereen, wat voor lagere inkomens te hoog is. Sinds 2023 is
  de aftrek wettelijk begrensd op het tarief van de **tweede** belastingschijf
  box 1 (37,56% in 2026); wie met zijn/haar toetsinkomen volledig binnen de
  **eerste** schijf blijft (tot €38.883, 2026) trekt af tegen het lagere
  eerste-schijftarief van **35,70%**. Nieuwe `getHraRate(...incomes)`-helper
  (module-level, gebruikt `Math.max` van de toetsinkomens van beide
  aanvragers) toegepast in `currentMortgage`, `scenarioAnalysis`,
  `additionalLoanCalc` én `starterLoanCalc` — alle 4 plekken die voorheen de
  vaste `HRA_RATE`-constante gebruikten. UI-labels tonen nu het daadwerkelijk
  toegepaste percentage (`formatRate(x.hraRate * 100)`) i.p.v. hardgecodeerde
  tekst "37,56%".
- **Eigenwoningforfait (EWF) staat nu default uit**: nieuwe checkbox
  "Eigenwoningforfait meenemen in de netto berekening" in de doorstromer-netto-
  weergave (`includeEwfInNetCalc`, default `false`). Dit was de ENE plek waar
  EWF automatisch werd afgetrokken van het netto belastingvoordeel; de starter-
  en aanvullende-hypotheek-netto-weergaven sloten het al standaard uit (met een
  eigen toelichtende tekst) — nu consistent overal default uit, met opt-in.

## Herbruikbare bouwstenen (ken je deze, dan bouw je sneller mee)
In `src/MortgageCalculator.jsx`: `SectionCard` (met `accent`-prop: blue/amber/emerald/
violet/indigo — gekleurde linkerrand + icoon-achtergrond per categorie; Kosten koper
gebruikt deze NIET meer, zie hieronder), `StatusBadge` (status=
"success"|"warning"|"error"|"info", gereserveerd voor verdicts/acties), `InlineNote`
(rustige grijze tekst + info-icoon, voor puur informatieve toelichtingen), `InfoTooltip`
(klein (i)-icoon, klik/tik-tooltip, `variant="light"` voor donkere achtergronden),
`AdvancedFieldsToggle` ("Meer opties"-inklapper, standaard dicht), `AnimatedEuro`
(count-up-getal + puls bij >5% wijziging), `Slider` (met optionele `labelExtra`-node,
bijv. voor een InfoTooltip), `CurrencyField`, `EnergyLabelPicker`,
`AflossingsvrijMaxToggle`, `DonutChart`, `AmortizationChart` (fade-in bij laden),
`AdditionalLoanPartCard`, `calculateLoanPart()`, `formatEuro()`, `formatRate()`,
`safeNum()`, `getHraRate(...incomes)` (inkomensafhankelijk HRA-tarief, zie boven).
Kosten koper is een **handgerolde** collapsible (geen `SectionCard`) — kopieer dát
patroon (button-header met chevron + `AnimatePresence`/`motion.div` content) als je
nóg een inklapbare kaart nodig hebt, zoals ook "Huidige Hypotheek Analyseren" en
"Nibud dubbele-lastentoets" al deden.

## Belangrijke lessen / valkuilen (voor vervolgwerk)
- **Scroll-reveal bug**: een `whileInView`-animatie met `amount: 0.2` op een element dat
  veel hoger is dan het scherm (zoals de hele calculator) triggert nooit. Los element
  amount={0} geven.
- **WOZ-zoekbug**: de vrije-tekstzoeker van wozwaardeloket indexeert niet elke straat
  betrouwbaar; de straatnaam-zoeker (`?straat=`) werkt wel consistent.
- **Twee gap-berekeningen** (`newHomeCalc` en `combinedGapCalc`) bestaan naast elkaar in
  de code — `combinedGapCalc` is de actief gebruikte/UI-tonende variant.
- **div-in-p hydration-bug**: een framer-motion-popover (rendert een `<div>`) genest in
  een `<p>`-label gaf een "cannot be a descendant of p"-hydration-fout — de browser
  sluit `<p>` stilletjes af zodra hij een blok-element tegenkomt. Gebruik `<span>` als
  wrapper voor labels die een popover/tooltip bevatten, nooit `<p>`.
- **Console-logs uit de preview-tool kunnen stale zijn**: na een reload bleven oude
  hydration-fouten in `preview_console_logs` staan alsof ze nog optraden. Controleer
  bij twijfel de live DOM direct (bijv. `document.querySelectorAll('p').filter(p =>
  p.querySelector('div'))`) i.p.v. alleen op de logregel te vertrouwen.
- **Twee knoppen met exact dezelfde tekst**: de nieuwe "meenemen in berekening"-toggle
  bij Kosten koper kreeg per ongeluk dezelfde labels ("Ja, meenemen"/"Nee, niet
  meenemen") als de al bestaande meeneemregeling-toggle (hypotheek meenemen bij
  verhuizing) — twee heel verschillende dingen, verwarrend voor gebruikers én voor
  tekst-gebaseerde test-selectors. Nu "Ja/Nee, meetellen". Check bij nieuwe
  Ja/Nee-knoppenparen altijd of de exacte tekst al elders in de app voorkomt
  (`grep -n "Ja, <label>"`) voordat je 'm hergebruikt.
- **Grote JSX-blokken verplaatsen**: reorderen van hele secties (Beoogde woning/Kosten
  koper naar een andere plek, Type aankoop-blok tussen kaarten) deed ik via een klein
  node-scriptje dat exacte 1-indexed regelnummers (uit de Read-tool) opknipt/plakt,
  i.p.v. handmatige Edit-calls op zulke grote tekstblokken — sneller en minder
  foutgevoelig. Reindenteer niet mee (JSX geeft niets om whitespace); check achteraf
  altijd of open/close-tags weer in balans zijn door de grep/read rond de naad.
- Elke wijziging deze hele sessie is als aparte git-commit vastgelegd. Werkwijze die
  steeds is aangehouden: (1) research bij officiële bron indien harde cijfers/regels
  nodig zijn, (2) implementeren, (3) verifiëren in de browser via de preview-tool
  (console-errors checken, functioneel testen, kort mobiel-formaat checken), (4) pas dan
  committen. Hou dit vol — het is de reden dat alles tot nu toe stabiel is gebleven.
- Een eerdere poging om dit werk 's nachts autonoom door een achtergrond-agent te laten
  doen is **gecrasht zonder iets af te maken** (proces stopte voortijdig). Niets ging
  verloren omdat er nog niets gecommit was, maar: laat groot werk liever gewoon in een
  gewone, actieve sessie doen in plaats van in de achtergrond terwijl niemand kijkt.

## Afgeronde uitbreidingen (professionaliseringsronde, punten 2/3/4/6/7)
In deze sessie gebouwd, elk als eigen commit met browser-verificatie:
- **Kosten koper realistisch uitgesplitst** (`src/kostenKoper.js`,
  `getKostenKoperBreakdown()`): notaris, taxatie, advies (aanpasbaar), bankgarantie,
  makelaarscourtage, NHG-provisie (aan/uit).
- **Overdrachtsbelasting gedifferentieerd** (`getTransferTaxRate()`): 0%
  startersvrijstelling, 2% eigen woning, 8% niet-hoofdverblijf, 0%/n.v.t. bij
  nieuwbouw. Vereenvoudiging bij twee kopers: één vrijgesteld → indicatief 1% via
  50/50-aandeel (uitgelegd in de UI).
- **AOW/pensioen als echte dubbele toets** (`nibud2026.js` Tabel 2 + `calc` in
  MortgageCalculator.jsx): huidig inkomen vs. verwacht pensioeninkomen, laagste
  bindend, met scenariovergelijking in de UI i.p.v. alleen een waarschuwing.
- **Alimentatie** (`src/toetsinkomen.js`): betaalde partneralimentatie bruto ×12 van
  het toetsinkomen af; ontvangen alimentatie en kinderalimentatie tellen niet mee
  (infotekst).
- **Flexibel/variabel inkomen** (`toetsinkomen.js`): inkomenstype-keuze per
  aanvrager (vast/flexMet/flexZonder/ZZP) met 3-jaarsmiddeling gemaximeerd op het
  laatste jaar, plus structureel (13e maand) en incidenteel (gem. bonus) inkomen.

Nog niet aangeraakt: punt 1 (NHG — de NHG-borgtochtprovisie is wél als optionele
kostenpost toegevoegd, maar de kostengrens en lagere NHG-rente ontbreken nog), 5
(erfpacht), 8 (verduurzaming >100% LTV), 9 (volledige nieuwbouw-flow — het
woningtype-onderscheid bestaat al voor overdrachtsbelasting, maar bouwdepot/
makelaarskosten-koppeling nog niet), 10–13 (zie hieronder).

## Openstaande taken (bijgewerkte lijst)
1. **NHG (Nationale Hypotheek Garantie)**: kostengrens (jaarlijks geïndexeerd, hoger bij
   verduurzaming), lagere NHG-rente. De 0,4% borgtochtprovisie zit al als optionele post
   in de Kosten koper-kaart. **Zoek actuele 2026-cijfers op bij nhg.nl voordat je iets
   hardcodet.**
2. ~~Kosten koper realistisch uitgesplitst~~ — **gedaan**.
3. ~~Overdrachtsbelasting gedifferentieerd~~ — **gedaan**.
4. ~~AOW/pensioen als echte toets~~ — **gedaan**.
5. **Erfpacht (canon)** als maandlast die de leencapaciteit verlaagt (kapitaliseren tegen
   de toetsrente, net als overige schulden nu al gebeurt).
6. ~~Alimentatie~~ — **gedaan**.
7. ~~Flexibel/variabel inkomen~~ — **gedaan**.
8. **Verduurzaming boven 100% LTV**: energiebesparende maatregelen mogen tot ~106%
   meegefinancierd worden; nu is het een platte bonus zonder LTV-verhoging.
9. **Nieuwbouw-flow**: bouwdepot met rente, geen makelaarskosten. Het woningtype-toggle
   ("bestaande bouw / nieuwbouw / niet-hoofdverblijf") bestaat al en regelt de
   overdrachtsbelasting; bouwdepot en de koppeling met makelaarskosten ontbreken nog.
10. **Auditbare toetsopbouw** — **deels gedaan**: het "Bepalend voor uw maximum nu"-blok
    (sidebar) toont al wélke ene factor nu bindend is, met uitleg. Nog niet gedaan: de
    volledige stap-voor-stap rekensom tonen (woonquote Y × toetsinkomen Z − schulden =
    ...). `toetsinkomen.js` retourneert al een transparant opbouwobject per aanvrager
    (basis/structureel/aftrek/cap-vlaggen) — grotendeels UI-werk op basis van al
    bestaande berekende waarden.
11. **PDF-klantrapport**: export met alle aannames, bronnen en de uitkomst — wat een
    klant normaal van een adviseur meekrijgt.
12. **Referentie-/unit tests**: tegen bekende Nibud-uitkomsten (bijv. vitest, past
    natuurlijk bij Vite), zodat een wijziging de rekenkern niet stilletjes breekt. Nog
    steeds niet gedaan — met inmiddels een flinke rekenkern (nibud2026.js, kostenKoper.js,
    toetsinkomen.js, getHraRate) wordt dit met de dag waardevoller.
13. **Visuele polish-pas** — **grotendeels gedaan**: acht fases visuele/interactie-polish
    zijn al doorgevoerd (zie hierboven), plus de workflow/logica-ronde daarna. Wat
    resteert is vooral fijnslijpen op detailniveau, geen grote herontwerp-stap meer.

**Aanbevolen volgorde**: NHG (kostengrens + rente) → erfpacht → verduurzaming >100% LTV
→ nieuwbouw-flow afmaken (bouwdepot) → auditbare toetsopbouw afmaken → PDF-export →
tests.

## Hoe verder te werken (voor een nieuwe sessie / beginner-instructies)
Zie de losse instructies die apart zijn meegegeven bij het delen van dit bestand.
