# Hypotheekcalculator 2026 — projectsamenvatting

**Laatste commit**: `db8d944` — bekijk `git log --oneline` voor de volledige geschiedenis
(80+ commits, elke stap apart, dus alles is terug te draaien met `git revert <hash>`).
Working tree is schoon; alles hieronder staat al gepusht naar GitHub
(`vmahgit/mortgage-calculator`, branch `main`) én live op Vercel.

Live: https://mortgage-calculator-three-drab.vercel.app *(dit IS de huidige versie —
elke sessie tot nu toe eindigde met `git push` + `npx vercel --prod --yes`. Blijf dat
patroon aanhouden: na wijzigingen pushen naar GitHub en publiceren via
`npx vercel --prod --yes` in `C:\Users\Vincent\mortgage-calculator`, maar **vraag de
gebruiker altijd expliciet om bevestiging voordat je commit/push/deploy uitvoert** — dat
is dit hele project door zo gedaan, ook al is het "gebruikelijk". `vercel` staat niet
standaard in PATH; gebruik `npx vercel` — die logt al in als `vfredriksz-4509` en het
project is al gelinkt via `.vercel/project.json`, dus geen extra setup nodig.
`git push` werkte de hele sessie gewoon — als de permissie-classifier 'm een keer blokkeert
met een verwarde reden (zie "Belangrijke lessen" hieronder), vraag de gebruiker om
bevestiging en probeer opnieuw; werkt dat niet, laat de gebruiker zelf pushen.)*
Repo: `C:\Users\Vincent\mortgage-calculator` (git-repo op je eigen schijf)
Stack: Vite + React + Tailwind CSS v4 + framer-motion + lucide-react + jsPDF/autotable
(dynamisch geïmporteerd), gehost op Vercel.

## Wat de tool doet
Indicatieve Nederlandse hypotheekcalculator voor zowel starters (geen bestaande woning)
als doorstromers (bestaande woning met hypotheek, overwaarde, meeneemregeling). Rekent
met de echte Nibud-woonquote-systematiek 2026, niet met een benaderde leenfactor.

## Belangrijkste architectuurkeuzes
- **Rekenkern** (`src/nibud2026.js`): officiële financieringslastpercentages (Tabel 1,
  Wijzigingsregeling hypothecair krediet 2026, Stcrt. 2025, 36471) als ankerpunten, met
  bilineaire interpolatie tussen inkomens- en toetsrenteschijven. `projectRemainingBalance()`
  (in `MortgageCalculator.jsx`, niet in dit bestand) is een **closed-form** functie die de
  restschuld van een leningdeel op een willekeurige toekomstige maand berekent voor alle
  drie aflosvormen — de basis voor zowel de 30-jaars-grafiek als het nieuwe maandschema
  (zie hieronder), zonder dat er iteratief door de tijd geloopt hoeft te worden.
- **Hoofdcomponent** (`src/MortgageCalculator.jsx`, ~6200 regels — dit bestand is
  inmiddels behoorlijk groot, overweeg bij grote nieuwe features een aparte module zoals
  al gedaan is voor `bouwdepot.js` en `pdfExport.js`): alle calculator-state en -logica
  zit in `MortgageCalculatorForm`; de `export default MortgageCalculator` is een dunne
  wrapper die alleen een `resetKey` bijhoudt en `MortgageCalculatorForm` met die `key`
  rendert — "Opnieuw beginnen" hoogt de key op en remount't zo de hele vorm met verse
  defaults.
- **Woninggegevens-opzoeker** (`src/OptionalPropertyDataModule.jsx` +
  `src/housingData.js`): haalt bouwjaar, oppervlakte, perceelgrootte en historische
  WOZ-waarden op via uitsluitend **gratis, publieke overheids-API's** (PDOK
  Locatieserver, PDOK BAG-kaartendienst, wozwaardeloket.nl) — geen API-sleutel, geen
  backend.
- **Scenario-analyse** (`src/ScenarioAnalysis.jsx`): "wat als ik X% meer/minder bied"-
  tabel. Sinds deze sessie ook: bij overbieden (positief %) wordt de taxatiewaarde
  gelijkgesteld aan de aanschafprijs — het bod daarboven ("Extra eigen inleg boven
  taxatiewaarde") telt niet mee voor de hypotheek en moet uit eigen geld komen.
- **Landingspagina** (`src/LandingPage.jsx`): cinematische hero met roterende
  Nederlandse villafoto's, scroll-parallax, count-up-animaties.
- **Kosten koper & overdrachtsbelasting** (`src/kostenKoper.js`): `getTransferTaxRate()` /
  `getKostenKoperBreakdown()`. Sinds deze sessie ook: "Type aankoop"-toggle staat nu in de
  kaart **Beoogde woning** (niet meer Kosten koper — zie herstructurering hieronder), en
  er is een nieuw blok "Eenmalig aftrekbare financieringskosten" (advies + taxatie + NHG,
  notariskosten bewust uitgesloten omdat leverings-/hypotheekakte niet uitgesplitst zijn).
- **Toetsinkomen per aanvrager** (`src/toetsinkomen.js`): `getToetsinkomen()` — inkomenstype,
  structureel/incidenteel inkomen, alimentatie-aftrek. Retourneert een transparant
  opbouwobject; wordt nu volledig benut door de "Uw rekensom stap voor stap"-sectie (zie
  hieronder).
- **AOW-toets** (`src/nibud2026.js`): tweede financieringslasttabel voor wie binnen 10 jaar
  de AOW-leeftijd bereikt.
- **Meeneemregeling schakelbaar** (`takeOverMortgage`): bepaalt of de bestaande hypotheek
  meegaat naar de nieuwe woning.
- **Bouwdepot bij nieuwbouw** (`src/bouwdepot.js`, `getBouwdepotEstimate()`): indicatieve
  rente-tijdens-de-bouw-schatting bij lineaire opname-aanname. Zie "Nieuwbouw-flow"
  hieronder.
- **PDF-export** (`src/pdfExport.js`, `exportHypotheekAdviesPdf()`): genereert een
  adviesrapport met jsPDF + jspdf-autotable. **Dynamisch geïmporteerd** (`await
  import('./pdfExport')` in `handleExportPdf`) zodat de ~150kB aan PDF-bibliotheken niet in
  het hoofdbundle terechtkomen — alleen geladen bij een klik op "Exporteer naar PDF".

## Navigatie & visuele polish — ronde 2 (BorderGlow + scrollspy-rail)
- **BorderGlow** (`src/BorderGlow.jsx` + `.css`, overgenomen van reactbits.dev) rond het
  Resultaat-paneel: subtiele intro-sweep + cursor-volgende gloed in de merkkleuren.
- **Scrollspy-navigatie** (`src/SectionRail.jsx`, exporteert `useScrollSpy` hook +
  `SectionRail`-component): op desktop (xl+) een dunne stippen-rail vast aan de linkerrand;
  op kleinere schermen is de bestaande chipbalk uitgebreid met auto-highlight,
  auto-scroll naar de actieve chip, en een vullijn die de voortgang toont.
  **Belangrijke bug die hier is opgelost**: het sticky Resultaat-paneel deelt zijn grid-rij
  met "Inkomen", dus zijn vastgeplakte schermpositie (`getBoundingClientRect()`) maakte hem
  structureel "actief" ongeacht scrollpositie. Opgelost door de sectiepositie te bepalen via
  `offsetTop` (ongevoelig voor `position: sticky`) i.p.v. `getBoundingClientRect()`, en het
  Resultaat-paneel pas als actief te markeren zodra je voorbij de hele linkerkolom-inhoud
  bent gescrold (zie `getDocumentTop`/de "companion"-afhandeling in `useScrollSpy`).

## Nieuwbouw-flow, auditbare toetsopbouw & herstructurering huidige-woning-blokken
- **Nieuwbouw-flow**: kiest u "Nieuwbouw" bij Type aankoop, dan verschijnt automatisch een
  kaart **"Bouwdepot (nieuwbouw)"** (`sectie-bouwdepot`, ook in de scrollspy-rail) met
  bouwdepotbedrag, bouwperiode en de rente-tijdens-de-bouw-berekening. Tegelijk wordt de
  "Aankoopmakelaar"-kostenpost bij Kosten koper automatisch uitgezet (met uitleg) — bij
  nieuwbouw koopt u meestal rechtstreeks van de projectontwikkelaar.
- **Auditbare toetsopbouw**: nieuwe inklapbare sectie **"Uw rekensom stap voor stap"**
  onderin het Resultaat-paneel: toetsinkomen per aanvrager → woonquote → max. bruto
  woonlast → schuldenaftrek → kapitalisatie naar hypotheek → energiebonus → eventuele
  AOW-/LTV-begrenzing.
- **Herstructurering "Huidige woning"-blokken** (voorheen alles binnen één collapsible):
  - "Type aankoop (overdrachtsbelasting)" verplaatst van Kosten koper **náár Beoogde
    woning** (default blijft "Bestaande bouw").
  - **"Huidige Hypotheek Analyseren"**, **"Extra bijleenruimte bij verkoop huidige
    woning"** en **"Aanvullende hypotheek"** zijn nu drie losse, onafhankelijk
    in-/uitklapbare kaarten i.p.v. geneste content binnen één collapsible.
  - "Aflossing komende dertig jaar" hernoemd naar **"Aflosschema nieuwe situatie"**.
  - **Valkuil hierbij**: de buitenste `<div id="sectie-huidige-woning">` omvat NIET alleen
    de collapsible "Huidige Hypotheek Analyseren" — hij omvat ook de al langer bestaande
    sibling-kaarten "Maximaal aankoopbudget" en "Aflosschema nieuwe situatie" plus "Nibud
    dubbele-lastentoets", en sluit pas na die allemaal. Bij het opsplitsen per ongeluk de
    outer-div te vroeg gesloten (na alleen de eerste collapsible), wat een dubbele-close
    JSX-fout gaf verderop in het bestand. Zie "Belangrijke lessen" voor hoe dit is
    opgelost/gedebugd.

## Maandelijks aflosschema (tijd-slider + waardestijging-aanname)
Bij **"Aflosschema nieuwe situatie"** (naast de bestaande 30-jaars-jaargrafiek):
- Nieuwe **maandtabel** (rente, aflossing, totaal, onderpandswaarde, LTV) voor de
  meegenomen + nieuwe leningdelen samen, opgebouwd in `monthlySchedule` (useMemo, direct
  na `amortizationSchedule`).
- **Tijd-slider** (`scheduleWindowStartMonth`, 0–359): toont een venster van 12
  opeenvolgende maanden; naar rechts schuiven toont latere maanden.
- **Waardestijging-slider** (`scheduleAppreciationPct`, 0–9%, stap 0,5%, default 0%): werkt
  maandelijks samengesteld door in onderpandswaarde/LTV, uitgaande van de **aanschafprijs**
  van de beoogde woning (niet `marketValue`, dat is de huidige/oude woning — zelfde
  conventie als de bestaande `newLtv`-berekening).
- Rente/aflossing per maand wordt **afgeleid uit twee opeenvolgende saldi** via de
  bestaande `projectRemainingBalance` (géén nieuwe amortisatiewiskunde nodig): `interest(m)
  = balance(m-1) × maandrente`, `principal(m) = balance(m-1) − balance(m)`. Werkt correct
  voor alle drie aflosvormen.

## Adviseursverfijningen (hypotheekadviseur-review) + PDF-export
Op verzoek van de gebruiker (zelf ervaren hypotheekadviseur/aankoopmakelaar) vier
inhoudelijke correcties doorgevoerd:
- **Bijleenregeling**: waarschuwing bij "Aanvullende hypotheek" zodra meer geleend wordt
  dan het financieringsgat vereist terwijl er overwaarde is (`additionalLoanCalc.
  bijleenregelingRisk`/`excessOverGap`) — eigenwoningreserve niet volledig herinvesteerd
  → rente over het teveel is niet aftrekbaar.
- **Taxatiewaarde bij overbieden**: zie ScenarioAnalysis hierboven.
- **Eenmalig aftrekbare financieringskosten**: zie Kosten koper hierboven
  (`calc.deductibleFinancingCosts`/`financingCostsTaxBenefit`).
- **Overbruggingskrediet**: nieuwe toggle bij "Nibud dubbele-lastentoets"
  (`useBridgeLoan`/`bridgeLoanAmount`/`bridgeLoanRate`) — ontsluit de overwaarde vroegtijdig
  tegen rente, verlaagt de tijdelijke nieuwe hypotheek maar telt de rente mee in de
  gecombineerde maandlast (`doubleCostsCalc.bridgeLoanMonthlyInterest`).

**PDF-export**: knop "Exporteer naar PDF" naast "Opnieuw beginnen" (bovenaan de pagina).
Genereert een adviesrapport (situatie, beoogde woning, inkomen, resultaat met bindende
factor, kosten koper, en afhankelijk van doorstromer/starter het financieringsgat resp. de
leningdelen-samenstelling). Bestandsnaam: `Hypotheekadvies_<doorstromer|starter>_<bedrag>_
<YYYY-MM-DD>.pdf`. Zie `handleExportPdf` in `MortgageCalculator.jsx` voor hoe de (bewust
beperkte, samengevatte) data aan `exportHypotheekAdviesPdf()` wordt doorgegeven.

## Tweede woning met eigen hypotheekschuld
Nieuwe, onafhankelijke inklapbare kaart **"Tweede woning"** (`sectie-tweede-woning`, in de
scrollspy-rail tussen "Schulden" en "Kosten koper"). Los van de bestaande "Huidige
Hypotheek Analyseren"/"Extra bijleenruimte"-blokken hierboven (die gaan over de woning die
u ván verhuist bij een doorstromersaankoop): dit blok is voor een tweede, niet-bewoonde
woning met een eigen hypotheekschuld, die u wel/niet verkoopt. (Bewust generiek geformuleerd
in de UI-teksten, geen "bijv. geërfd"-voorbeeld meer — de gebruiker gaf aan dit specifieke
voorbeeld uit de tekst te willen, ook al is het wel de eigen situatie.)
- **Velden**: marktwaarde, hypotheekschuld, en (bij aanhouden) aflosvorm/rente/resterende
  looptijd, of (bij verkopen) verkoopkosten-percentage.
- **Aanhouden**: de volledige, werkelijke bruto maandlast (`calculateSimpleMortgagePayment`,
  losstaande annuïteit/lineair/aflossingsvrij-formule zonder leningdeel-administratie) telt
  voor 100% mee in `monthlyDebt` — bewust géén 2%-vuistregel zoals bij "Overige schulden",
  want het exacte bedrag is hier bekend (zelfde principe als de studieschuld-berekening).
  Toont ook een expliciet "vóór/na"-blok (`secondHomeCapacityReduction`) met de
  leencapaciteit zónder en mét deze last, zodat het Nibud-effect direct zichtbaar is.
- **Verkopen**: netto-opbrengst (marktwaarde − schuld − verkoopkosten) telt mee in
  `totalOwnCapital` als extra eigen middelen, mits de schakelaar **"Netto-opbrengst inzetten
  voor déze aankoop?"** (`useSecondHomeProceeds`) aan staat — anders telt een positieve
  opbrengst niet mee (`secondHomeProceedsApplied`). Bij een restschuld (negatieve
  netto-opbrengst) wordt dat bedrag altijd van `totalOwnCapital` afgetrokken, ongeacht die
  schakelaar — dat tekort is geen keuze en kan, anders dan bij de eigen woning, niet
  automatisch meegefinancierd worden.
- Zie `calc.secondHomeMonthly`/`secondHomeNetProceeds`/`secondHomeSaleCosts`/
  `secondHomeShortfall`/`secondHomeCapacityReduction`/`secondHomeProceedsApplied` in
  `MortgageCalculator.jsx`.

## Financieringsgat: geldverstrekkersmaximum, eigen-inleg-limiet en familielening
Uitbreiding van `combinedGapCalc` (de doorstromers-financieringsgat-berekening, kaart "Extra
bijleenruimte bij verkoop huidige woning") voor het scenario: een hard bankplafond, een
gewenst maximum aan eigen inleg, en een tijdelijke onderhandse familielening om een
resterend gat te overbruggen (bv. omdat een tweede woning nog niet verkocht is en daar geen
overbruggingskrediet op mogelijk is).
- **Geldverstrekkersmaximum** (`lenderCapThreshold`, state i.p.v. de oude vaste
  `LENDER_CAP_THRESHOLD`-constante, default €1.000.000): instelbaar veld in de kaart "Uw
  situatie". Werkt als een harde derde grens naast de Nibud-inkomenstoets en de LTV-cap, in
  `combinedGapCalc`/`additionalLoanCalc`/`starterLoanCalc`. `combinedGapCalc.lenderCapRoom`
  = plafond min meegenomen hypotheek; `additionalMortgageCapacity` = laagste van Nibud-
  capaciteit en die lenderCapRoom; `bindingCapIsLender` geeft aan wélke van de twee knelt
  (ook verwerkt in `bindingFactor`, de "Bepalend voor uw maximum nu"-uitleg).
- **Eigen-inleg-limiet** (`limitOwnContribution`/`desiredMaxOwnContribution`, default uit,
  €100.000): schakelaar in de "Extra bijleenruimte"-kaart. Begrenst hoeveel van het
  beschikbare eigen vermogen daadwerkelijk wordt ingezet om het financieringsgat te dichten
  (`ownContributionCap`) — de rest van het gat schuift door naar de aanvullende hypotheek,
  ook al zou er meer eigen vermogen beschikbaar zijn.
- **Familielening** (`useFamilyLoan`/`familyLoanAmount`/`familyLoanRate`, default uit):
  losstaand van het bestaande overbruggingskrediet (dat is gekoppeld aan de overwaarde van
  de hoofdwoning). Springt in ná Nibud- én geldverstrekkerscapaciteit
  (`shortfallBeforeFamilyLoan`), gekapt op wat daadwerkelijk nodig is
  (`familyLoanApplied`), met een indicatieve renteweergave
  (`familyLoanMonthlyInterest`, alleen rente, geen aflossingsaanname) en een disclaimer
  over BKR/schenkbelasting-aandachtspunten. `withinCapacityAfterFamilyLoan`/
  `remainingShortfall` bepalen het uiteindelijke haalbaarheidsoordeel; `overallAffordable`
  (het "Haalbaar"/"Nog niet haalbaar"-label bovenaan) gebruikt nu deze mét-familielening-
  uitkomst in plaats van de kale bijleenruimte.
- **Belangrijke les uit deze sessie**: de `AnimatePresence mode="wait"`/`key={bindingFactor
  .label}`-animatie op het "Bepalend voor uw maximum nu"-blok lijkt in de preview-browser-
  tool soms vast te lopen op een oude tekst na meerdere snelle statuswijzigingen (bevestigd
  met een tijdelijke `console.log` in de `bindingFactor`-`useMemo`: de berekende waarde
  klopte bij elke render, alleen de DOM-tekst bleef hangen). Het verwijderen van
  `mode="wait"` liet zelfs BEIDE oude én nieuwe tekst tegelijk zien — een teken dat exit-
  animaties in deze specifieke preview-tool niet altijd afronden (waarschijnlijk
  `requestAnimationFrame`-throttling van een niet-actief geschilderde tab), niet een echte
  app-bug. Bij twijfel over een geanimeerde tekst die niet lijkt te verversen: verifieer de
  onderliggende berekening eerst los met een `console.log`/debug-waarde vóórdat je de
  animatiecode zelf verdenkt.

## Herbruikbare bouwstenen (ken je deze, dan bouw je sneller mee)
In `src/MortgageCalculator.jsx`: `SectionCard`, `StatusBadge`, `InlineNote`, `InfoTooltip`,
`AdvancedFieldsToggle`, `AnimatedEuro`, `Slider`, `CurrencyField`, `EnergyLabelPicker`,
`AflossingsvrijMaxToggle`, `DonutChart`, `AmortizationChart`, `AdditionalLoanPartCard`,
`calculateLoanPart()`, `projectRemainingBalance()` (closed-form restschuld-projectie, zie
boven), `formatEuro()`, `formatRate()`, `safeNum()`, `getHraRate(...incomes)`.
Kosten koper/Huidige Hypotheek Analyseren/Extra bijleenruimte/Aanvullende hypotheek/
Bouwdepot zijn allemaal **handgerolde** collapsibles (geen `SectionCard`) — kopieer dát
patroon (button-header met chevron + `AnimatePresence`/`motion.div` content) voor een
nieuwe inklapbare kaart.
Losse modules: `src/SectionRail.jsx` (`useScrollSpy` hook + rail-component, zie boven),
`src/BorderGlow.jsx`, `src/bouwdepot.js`, `src/pdfExport.js`.

## Belangrijke lessen / valkuilen (voor vervolgwerk)
- **`node -e "..."` met grote inline scripts kan silent corrupt raken.** Bij een grote
  JSX-verplaatsing deze sessie gaf een `node -e` met een zeer lange, zwaar ge-escapete
  string (geneste quotes, template literals) een script dat *leek* te slagen (geen
  syntaxfout, plausibele console-output) maar waarvan de daadwerkelijke stringinhoud
  subtiel corrupt was — resultaat: JSX-tags op de verkeerde plek geknipt, twee builds
  achter elkaar met dezelfde mysterieuze "Adjacent JSX elements"-fout op een regel die er
  zelf prima uitzag. **Oplossing/les**: schrijf grote of complexe scripts naar een los
  `.cjs`-bestand (via de Write-tool) en run dat met `node script.cjs`, i.p.v. alles via
  `node -e "..."` in Bash te proppen. Dit bestandsproject heeft `"type": "module"` in
  `package.json`, dus gebruik de extensie `.cjs` (niet `.js`) voor CommonJS-scripts met
  `require()`. Verwijder zulke scratch-scripts na gebruik (`rm restructure.cjs
  splice.cjs check_pieces.cjs debug_*.txt`).
- **Bij een JSX-restructurering: verifieer boundaries met een echte depth-finder, niet met
  handmatig geteld regelnummer.** Gebruik een script dat alle `<div>`/`</div>`-tokens in de
  hele bestandsstring matcht (niet regel-voor-regel, dat breekt bij multi-line tags) en de
  nesting-diepte bijhoudt vanaf een gegeven startregel. Verifieer ELKE boundary met een
  *unieke* tekst-anchor (niet een generieke `"</div>"`-match, die matcht bijna alles).
  Bij twijfel over een resultaat: knip het beoogde segment naar een los `.txt`-bestand en
  inspecteer het geïsoleerd, vóórdat je het terugplakt in het hoofdbestand.
- **Bij twijfel over een grote structuurwijziging: ga terug naar de laatste schone commit**
  (`git show HEAD:pad/naar/bestand.jsx > tmp.jsx`) als bron van waarheid voor het
  ONGEWIJZIGDE deel, i.p.v. verder te patchen op een intermediair, mogelijk al corrupt
  bestand. Bereken de nieuwe structuur tegen die schone versie, splice daarna het resultaat
  terug het huidige (met andere, wél-gewenste wijzigingen) werkbestand in.
- **Browser-automation: layout-shifts van ANDERE kaarten kunnen cached refs/coördinaten
  ongeldig maken.** Een `ref_N` of coördinaat verkregen vóór het in-/uitklappen van een
  andere kaart kan na die actie op een verschoven, verkeerd element landen (bijv. een klik
  die bedoeld was voor een input, landt op de collapsible's eigen toggle-knop en klapt de
  hele kaart dicht). **Les**: vlak vóór een kritieke test-actie altijd vers
  `document.querySelector`/`read_page` opnieuw opvragen i.p.v. een eerder verkregen ref te
  hergebruiken, zeker na tussenliggende interacties met andere delen van de pagina.
- **Voor tekst-inputs (`type="text"`, gestuurd via React `onChange`) is de betrouwbaarste
  automation-aanpak**: `element.focus()` gevolgd door de echte `computer`-tool `type`-actie
  (simuleert keystrokes), of de native-setter+`dispatchEvent('input', {bubbles:true})`-truc
  — maar test dit áltijd door het gerenderde resultaat te checken (niet alleen
  `input.value`, want dat kan een schijnbare "succesvolle" waarde tonen terwijl de
  onderliggende React-state niet is bijgewerkt als de kaart zelf niet zichtbaar/actief is).
- **Zware libraries (jsPDF, ~150kB) altijd dynamisch importeren** (`await
  import('./module')` binnen de click-handler) i.p.v. statisch bovenaan het bestand, tenzij
  de functionaliteit op elke paginalading nodig is. Scheelt in dit project een verdubbeling
  van het hoofdbundle voor een puur op-aanvraag-feature.
- **De permissie-classifier van de auto-mode kan een `git push` een keer blokkeren met een
  verwarde reden** (deze sessie: dacht dat de repo `vmahgit/tonik` was — een compleet
  ander, ouder project — ook al bevestigde `git remote -v` gewoon
  `vmahgit/mortgage-calculator`). Nogmaals bevestigen loste het niet meteen op; een tweede
  poging even later werkte wel. Als dit weer gebeurt: leg het aan de gebruiker uit, vraag
  om een Bash-permissieregel of laat de gebruiker zelf pushen — probeer het niet te
  omzeilen.
- **Scroll-reveal bug**: een `whileInView`-animatie met `amount: 0.2` op een element dat
  veel hoger is dan het scherm triggert nooit — geef zulke elementen `amount={0}`.
- **div-in-p hydration-bug**: een popover/tooltip (rendert een `<div>`) genest in een
  `<p>`-label geeft een hydration-fout — gebruik `<span>` als wrapper, nooit `<p>`.
- **Console-logs uit de preview-tool kunnen stale zijn** na een serverherstart met veel
  voorgaande fouten — bij twijfel de dev-server hard herstarten (`preview_stop` +
  `preview_start` opnieuw) i.p.v. te vertrouwen op een lange foutenlijst die niet meer klopt.
- Elke wijziging is als aparte git-commit vastgelegd, na browserverificatie. Werkwijze:
  (1) research bij officiële bron indien nodig, (2) implementeren, (3) verifiëren in de
  browser (console-errors, functioneel testen, mobiel-formaat), (4) pas dan committen —
  en **altijd expliciet aan de gebruiker vragen** vóór commit/push/deploy, ook al is dat
  "de gewoonte" in dit project.

## Openstaande taken (bijgewerkte lijst)
1. **NHG (Nationale Hypotheek Garantie)**: kostengrens (jaarlijks geïndexeerd, hoger bij
   verduurzaming), lagere NHG-rente. De 0,4% borgtochtprovisie zit al als optionele post.
   **Zoek actuele 2026-cijfers op bij nhg.nl voordat je iets hardcodet.**
2. **Erfpacht (canon)** als maandlast die de leencapaciteit verlaagt (kapitaliseren tegen
   de toetsrente, net als overige schulden nu al gebeurt).
3. **Verduurzaming boven 100% LTV**: energiebesparende maatregelen mogen tot ~106%
   meegefinancierd worden; nu is het een platte bonus zonder LTV-verhoging.
4. **Referentie-/unit tests**: tegen bekende Nibud-uitkomsten (vitest, past bij Vite).
   Met inmiddels een flinke rekenkern (nibud2026.js, kostenKoper.js, toetsinkomen.js,
   bouwdepot.js, pdfExport.js, `projectRemainingBalance`, `getHraRate`) wordt dit met de
   dag waardevoller — nog steeds niet gedaan.
5. **Nieuwbouw-flow verder afmaken**: bouwdepot + makelaarskosten-koppeling zijn gedaan;
   nog niet gedaan is de koppeling met de daadwerkelijke bouwtermijnen-staat (nu een
   vereenvoudigde lineaire opname-aanname) en eventuele oplevering-specifieke
   maandlasten-overgang.
6. Kleinere UX-fijnslijping: de scrollspy-rail/mobiele chipbalk toont "Bouwdepot" al als
   sectie, maar niet de nieuwe losse blokken "Extra bijleenruimte"/"Aanvullende
   hypotheek" — zou voor consistentie ook in de rail-navigatie kunnen.

**Afgerond deze sessie** (stonden eerder op deze lijst): Nieuwbouw-flow (bouwdepot +
makelaarskosten), auditbare toetsopbouw (stap-voor-stap rekensom), PDF-klantrapport,
BorderGlow/scrollspy-navigatie, herstructurering huidige-woning-blokken, maandelijks
aflosschema met tijd-/waardestijging-sliders, en vier adviseursverfijningen (bijleen-
regeling, taxatiewaarde bij overbieden, aftrekbare financieringskosten,
overbruggingskrediet).

**Aanbevolen volgorde voor vervolgwerk**: NHG (kostengrens + rente) → erfpacht →
verduurzaming >100% LTV → unit tests (nu de rekenkern groot genoeg is om echt van te
profiteren) → rail-navigatie uitbreiden met de nieuwe losse blokken.

## Hoe verder te werken (voor een nieuwe sessie)
1. Open Claude Code in `C:\Users\Vincent\mortgage-calculator` (niet in het gelijknamige
   maar totaal andere "ClaudeMortgageCalculator"-mapje — dat is een onafhankelijke
   gitaar-akkoorden-app genaamd Tonik, zie eerder in deze sessie ontdekt).
2. Laat Claude dit bestand (`PROJECT_SUMMARY.md`) lezen voor volledige context — dat is
   precies wat dit bestand is: een levend overdrachtsdocument, elke sessie bijgewerkt.
3. Werkwijze aanhouden: research (indien nodig) → implementeren → verifiëren in de browser
   via de preview-tool → **expliciet aan de gebruiker vragen** vóór commit/push/deploy.
4. `npm run dev` (of de preview-tool) om lokaal te testen; `npx vite build` + `npx oxlint`
   vóór elke commit als snelle sanity-check.
