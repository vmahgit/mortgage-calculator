# Hypotheekcalculator 2026 — projectsamenvatting

**Laatste commit**: `fc5a33a` — bekijk `git log --oneline` voor de volledige geschiedenis
(21+ commits, elke stap apart, dus alles is terug te draaien met `git revert <hash>`).

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
- **Hoofdcomponent** (`src/MortgageCalculator.jsx`, ~3900 regels): alle calculator-state
  en -logica. Bevat o.a. financieringsgat-berekening (meegenomen hypotheek + overwaarde +
  eigen vermogen + restschuld-tekort bij onderwaarde), scenario-analyse, aflossingsgrafiek,
  starters-maandlastenblok, instelbare aflossingsvrij-norm (30/50/100%).
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

## Herbruikbare bouwstenen (ken je deze, dan bouw je sneller mee)
In `src/MortgageCalculator.jsx`: `SectionCard`, `StatusBadge` (status=
"success"|"warning"|"error"|"info"), `AnimatedEuro` (count-up-getal), `Slider`,
`CurrencyField`, `EnergyLabelPicker`, `AflossingsvrijMaxToggle`, `DonutChart`,
`AmortizationChart`, `AdditionalLoanPartCard`, `calculateLoanPart()`, `formatEuro()`,
`formatRate()`, `safeNum()`.

## Belangrijke lessen / valkuilen (voor vervolgwerk)
- **Scroll-reveal bug**: een `whileInView`-animatie met `amount: 0.2` op een element dat
  veel hoger is dan het scherm (zoals de hele calculator) triggert nooit. Los element
  amount={0} geven.
- **WOZ-zoekbug**: de vrije-tekstzoeker van wozwaardeloket indexeert niet elke straat
  betrouwbaar; de straatnaam-zoeker (`?straat=`) werkt wel consistent.
- **Twee gap-berekeningen** (`newHomeCalc` en `combinedGapCalc`) bestaan naast elkaar in
  de code — `combinedGapCalc` is de actief gebruikte/UI-tonende variant.
- Elke wijziging deze hele sessie is als aparte git-commit vastgelegd. Werkwijze die
  steeds is aangehouden: (1) research bij officiële bron indien harde cijfers/regels
  nodig zijn, (2) implementeren, (3) verifiëren in de browser via de preview-tool
  (console-errors checken, functioneel testen, kort mobiel-formaat checken), (4) pas dan
  committen. Hou dit vol — het is de reden dat alles tot nu toe stabiel is gebleven.
- Een eerdere poging om dit werk 's nachts autonoom door een achtergrond-agent te laten
  doen is **gecrasht zonder iets af te maken** (proces stopte voortijdig). Niets ging
  verloren omdat er nog niets gecommit was, maar: laat groot werk liever gewoon in een
  gewone, actieve sessie doen in plaats van in de achtergrond terwijl niemand kijkt.

## Openstaande taken (expliciete lijst, nog NIET gebouwd)
Dit is de volledige, door de gebruiker aangeleverde lijst. Geef deze 1-op-1 aan Claude in
de nieuwe sessie zodat er niets verloren gaat:

1. **NHG (Nationale Hypotheek Garantie)**: kostengrens (jaarlijks geïndexeerd, hoger bij
   verduurzaming), lagere NHG-rente, 0,4% borgtochtprovisie. Bijna elke starter valt
   hieronder → tientallen euro's/maand verschil. **Zoek actuele 2026-cijfers op bij
   nhg.nl voordat je iets hardcodet.**
2. **Kosten koper realistisch uitgesplitst** i.p.v. platte 3,5%: aparte posten voor
   notaris, taxatie, advies/bemiddeling, NHG-kosten, makelaarscourtage, bankgarantie.
3. **Overdrachtsbelasting gedifferentieerd**: 0% startersvrijstelling (<35 jr, onder de
   woningwaardegrens), 2% eigen bewoning, hoog tarief (belegger/niet-zelfbewoning), 0%/
   n.v.t. bij nieuwbouw (BTW i.p.v. overdrachtsbelasting). Nu staat het vast op 2%.
4. **AOW/pensioen als echte toets** i.p.v. alleen een waarschuwing: toetsen op (lager)
   verwacht pensioeninkomen wanneer iemand binnen 10 jaar van de AOW-leeftijd zit.
5. **Erfpacht (canon)** als maandlast die de leencapaciteit verlaagt (kapitaliseren tegen
   de toetsrente, net als overige schulden nu al gebeurt).
6. **Alimentatie**: betaalde partneralimentatie als last meewegen; ontvangen alimentatie
   telt niet mee als toetsinkomen.
7. **Flexibel/variabel inkomen**: ZZP (3-jaarsgemiddelde winst), flexcontract met
   intentieverklaring, en onderscheid structureel vs. incidenteel (bonus, 13e maand,
   vakantiegeld).
8. **Verduurzaming boven 100% LTV**: energiebesparende maatregelen mogen tot ~106%
   meegefinancierd worden; nu is het een platte bonus zonder LTV-verhoging.
9. **Nieuwbouw-flow**: geen overdrachtsbelasting, bouwdepot met rente, geen
   makelaarskosten (hangt samen met punt 2 en 3 — waarschijnlijk één toggle
   "bestaande bouw / nieuwbouw" die meerdere berekeningen tegelijk beïnvloedt).
10. **Auditbare toetsopbouw**: toon expliciet, stap voor stap, waarom de max hypotheek X
    is (woonquote Y × inkomen Z − schulden = ...). Bouwt vertrouwen, maakt fouten
    zichtbaar. Grotendeels UI-werk op basis van al bestaande berekende waarden.
11. **PDF-klantrapport**: export met alle aannames, bronnen en de uitkomst — wat een
    klant normaal van een adviseur meekrijgt.
12. **Referentie-/unit tests**: tegen bekende Nibud-uitkomsten (bijv. vitest, past
    natuurlijk bij Vite), zodat een wijziging de rekenkern niet stilletjes breekt.
13. **Visuele polish-pas**: de hele app bloedmooi, interactief en als logisch geheel
    afwerken — subtiele verfijning (schaduwen, ritme, iconografie) over de bestaande
    stijl, geen risicovolle volledige herontwerp.

**Aanbevolen volgorde** (hoogste impact op de kloppendheid van de uitkomst eerst):
NHG → overdrachtsbelasting + nieuwbouw-flow (horen bij elkaar) → kosten koper → erfpacht
→ alimentatie → AOW-toets → flexibel inkomen → verduurzaming >100% LTV → auditbare
toetsopbouw → PDF-export → tests → visuele polish.

## Hoe verder te werken (voor een nieuwe sessie / beginner-instructies)
Zie de losse instructies die apart zijn meegegeven bij het delen van dit bestand.
