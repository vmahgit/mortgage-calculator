# Hypotheekcalculator 2026 — projectsamenvatting

**Laatste commit**: `719dcc8` — bekijk `git log --oneline` voor de volledige geschiedenis
(45+ commits, elke stap apart, dus alles is terug te draaien met `git revert <hash>`).

Live: https://mortgage-calculator-three-drab.vercel.app *(let op: dit is de vorige
versie — na nieuwe wijzigingen moet je zelf opnieuw `vercel --prod` draaien om de live
link bij te werken, dat gebeurt niet automatisch)*
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

## Herbruikbare bouwstenen (ken je deze, dan bouw je sneller mee)
In `src/MortgageCalculator.jsx`: `SectionCard` (met `accent`-prop: blue/amber/emerald/
violet/indigo — gekleurde linkerrand + icoon-achtergrond per categorie), `StatusBadge`
(status="success"|"warning"|"error"|"info", gereserveerd voor verdicts/acties),
`InlineNote` (rustige grijze tekst + info-icoon, voor puur informatieve toelichtingen),
`InfoTooltip` (klein (i)-icoon, klik/tik-tooltip, `variant="light"` voor donkere
achtergronden), `AdvancedFieldsToggle` ("Meer opties"-inklapper, standaard dicht),
`AnimatedEuro` (count-up-getal + puls bij >5% wijziging), `Slider` (met optionele
`labelExtra`-node, bijv. voor een InfoTooltip), `CurrencyField`, `EnergyLabelPicker`,
`AflossingsvrijMaxToggle`, `DonutChart`, `AmortizationChart` (fade-in bij laden),
`AdditionalLoanPartCard`, `calculateLoanPart()`, `formatEuro()`, `formatRate()`,
`safeNum()`.

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
10. **Auditbare toetsopbouw**: toon expliciet, stap voor stap, waarom de max hypotheek X
    is (woonquote Y × inkomen Z − schulden = ...). `toetsinkomen.js` retourneert al een
    transparant opbouwobject per aanvrager (basis/structureel/aftrek/cap-vlaggen) —
    grotendeels UI-werk op basis van al bestaande berekende waarden.
11. **PDF-klantrapport**: export met alle aannames, bronnen en de uitkomst — wat een
    klant normaal van een adviseur meekrijgt.
12. **Referentie-/unit tests**: tegen bekende Nibud-uitkomsten (bijv. vitest, past
    natuurlijk bij Vite), zodat een wijziging de rekenkern niet stilletjes breekt.
13. **Visuele polish-pas**: de hele app bloedmooi, interactief en als logisch geheel
    afwerken — subtiele verfijning (schaduwen, ritme, iconografie) over de bestaande
    stijl, geen risicovolle volledige herontwerp.

**Aanbevolen volgorde**: NHG (kostengrens + rente) → erfpacht → verduurzaming >100% LTV
→ nieuwbouw-flow afmaken (bouwdepot) → auditbare toetsopbouw → PDF-export → tests →
visuele polish.

## Hoe verder te werken (voor een nieuwe sessie / beginner-instructies)
Zie de losse instructies die apart zijn meegegeven bij het delen van dit bestand.
