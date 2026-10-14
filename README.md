# Hypotheekcalculator 2026

Indicatieve Nederlandse hypotheekcalculator (Vite + React + Tailwind). Een uitgebreide
projectsamenvatting staat in [PROJECT_SUMMARY.md](PROJECT_SUMMARY.md).

```bash
npm run dev     # lokaal draaien
npm test        # unit tests (Vitest)
npm run build   # productiebuild
npm run lint    # oxlint
```

## Wat kunt u lenen? (opbouw van de leencapaciteit)

De sectie 'Wat kunt u lenen?' en de samenvatting in het resultaatpaneel tonen de leencapaciteit als een
rekenstaat, met elke afslag apart. De opbouw komt uit [`src/capacityBreakdown.js`](src/capacityBreakdown.js)
en gebruikt dezelfde rekenkern ([`src/calcEngine.js`](src/calcEngine.js)) als de rest van de app:

1. leencapaciteit op basis van inkomen (woonquote × toetsinkomen, gekapitaliseerd tegen de toetsrente);
2. − afslag tweede woning, overige schulden en een maandelijkse familielening (maandlast × kapitalisatiefactor);
3. − afslag studieschuld (per lening zichtbaar), en een correctieregel als de afslagen de capaciteit onder € 0 zouden brengen;
4. − AOW-toets (alleen als het pensioeninkomen bindend is), + energielabelbonus en + alleenstaandenbedrag
   (€ 17.000 bij één aanvrager met toetsinkomen ≥ € 30.000) = maximale hypotheek o.b.v. inkomen;
5. doorstromer die de hypotheek meeneemt: toets van de samenstelling (zie hieronder) = ruimte voor nieuw geld;
   − plafond van de geldverstrekker (alleen als dat lager is) = maximaal nieuw te lenen.
   Starter: − plafond van de geldverstrekker = maximale hypotheek.

### Toets van de samenstelling bij meenemen

Zoals een geldverstrekker een hypotheek met meerdere leningdelen toetst (Tijdelijke regeling hypothecair krediet,
art. 3; NHG-systematiek):

- elk meegenomen deel heeft een **toetslast**: annuïtair tegen de contractrente als het nog 10 jaar of langer
  vaststaat, anders tegen de AFM-toetsrente (ook bij een variabele of verlopen rentevaste periode); looptijd = de
  resterende looptijd (aflossingsvrij: altijd 30 jaar), of 30 jaar als u 'Looptijd toetslast' daarop zet;
- het nieuwe geld telt annuïtair over 30 jaar tegen zijn eigen toetsrente;
- de **woonquote** komt uit de kolom van de **gewogen toetsrente** van alle delen samen (gewicht hoofdsom × looptijd);
- het maximum nieuw geld is het hoogste bedrag waarvoor de woonlast de toetslasten dekt, waarbij de gewogen toetsrente
  (en dus de kolom) zelf met dat bedrag meebeweegt (`computeCompositeCapacity`); een concrete samenstelling van
  aanvullende leningdelen wordt met `testLoanComposition` getoetst.

De woonquote-tabellen staan volledig in `nibudTables2026.js`, letterlijk overgenomen uit Stcrt. 2025, 36471 (Bijlage 1:
Tabel 1–4, rijen per € 1.000, twaalf rentekolommen t/m ≥ 6,501%). `nibud2026.js` zoekt exact op: rij = toetsinkomen naar
beneden op € 1.000 (onder € 30.000 de eerste, boven € 125.000 de laatste rij; AOW-tabellen € 29.000–€ 110.000), kolom =
toetsrente per 0,5%-punt op drie decimalen. Er wordt niet geïnterpoleerd en er zijn geen geschatte kolommen meer.

- **Box 3**: een leningdeel waarvan de rente niet aftrekbaar is (standaard: aflossingsvrij aangegaan na 2013; per deel in te
  stellen via `fiscal` 'auto' | 'box1' | 'box3') telt mee met de **bruteringsfactor** Tabel 1 ÷ Tabel 3 (bij AOW Tabel 2 ÷
  Tabel 4) op zijn toetslast (`getGrossedToetslast`), per kolom in `computeCompositeCapacity` en `testLoanComposition`.
  Een nieuw aflossingsvrij deel valt daarmee ook onder box 3.
- **Alleenstaandenbedrag** € 17.000 bij een toetsinkomen *hoger dan* € 30.000 (AOW: € 29.000), art. 3 lid 8.
- Aflossingsvrije meegenomen delen tellen over 30 jaar; de NHG-norm noemt de resterende looptijd (max. 30 jaar) en staat
  een fictieve looptijd van 30 jaar voor aflossingsvrij toe (C.7.2).

Elke regel krijgt het lopende bedrag; `reconciles` is alleen waar als dat op elk tussentotaal en aan het eind gelijk is
aan wat de berekening zelf oplevert (en de pagina toont die controle). De tests rekenen het standaardscenario
onafhankelijk na met alleen basisformules en controleren de sluiting in 19 uiteenlopende situaties.

Het maximaal aankoopbudget (`computeMaxBudget`) gebruikt dezelfde nieuwe-hypotheekruimte als de haalbaarheidscontrole,
inclusief het plafond van de geldverstrekker, zodat budget en oordeel elkaar niet kunnen tegenspreken.

## Excel-toetsmodel en kruiscontrole

`docs/toetsmodel/Hypotheek_Toetsmodel_2026.xlsx` is een onafhankelijke Excel-herimplementatie van de toets (formules, geen
macro's) om de calculator mee te controleren; zie blad 'Leesmij'. De scenario's staan in `docs/toetsmodel/scenarios.json`; de
uitkomsten van de engine in `expected.json` (golden test `src/toetsmodel.test.js`). `docs/toetsmodel/crosscheck.sh` draait de
engine en het Excel-model op willekeurige dossiers en vergelijkt ze (Vitest en LibreOffice). `src/invariants.test.js` toetst
eigenschappen die voor elk dossier moeten gelden (optimaliteit van het maximum, monotonie, sluiting van de opbouw).

## Studieschuld (DUO) in de leencapaciteit

**Bron:** Tijdelijke regeling hypothecair krediet, art. 3a (Wijzigingsregeling 2025; de
opslagfactor-tabel is ongewijzigd in 2026). De tabel is overgenomen uit de opdrachtspecificatie
en niet afzonderlijk tegen de Staatscourant gecontroleerd. De rekenregels staan in
[`src/studieschuld.js`](src/studieschuld.js), de tests in
[`src/studieschuld.test.js`](src/studieschuld.test.js).

### Rekenwijze

1. **Termijnbedrag per lening**
   - Status `regulier`: het werkelijke DUO-maandbedrag (rente + aflossing). Is dat niet ingevuld,
     dan wordt het geschat als annuïteit en dat staat zo in de UI ("geschat").
   - Status `aanloopfase`, `aflosvrij` of `draagkracht`: altijd een annuïteit op de actuele
     restschuld, de actuele rente en de resterende looptijd, ook als het werkelijke bedrag 0 of
     lager is.
   - DUO-maandrente = (1 + jaarrente)^(1/12) − 1 (effectief, niet jaarrente/12). Bij 0% rente is het
     termijnbedrag restschuld / maanden.
2. **Toetslast** = termijnbedrag × opslagfactor.
3. **Opslagfactor** uit de debetrente van de hypotheek, op drie decimalen afgerond, grenzen
   inclusief: ≤1,500: 1,05 · 1,501–2,000: 1,10 · 2,001–2,500: 1,15 · 2,501–3,500: 1,20 ·
   3,501–4,000: 1,25 · 4,001–5,000: 1,30 · 5,001–5,500: 1,35 · 5,501–6,500: 1,40 · ≥6,501: 1,45.
   De tabel en de AFM-toetsrente staan per kalenderjaar in `STUDY_DEBT_CONFIG_BY_YEAR`; een jaar
   zonder eigen regel valt terug op het laatste eerdere jaar.
4. **Afslag op de maximale hypotheek** (in euro) = toetslast / annuïteitfactor(rente, 360 mnd),
   met annuïteitfactor = r / (1 − (1 + r)^−n) en r = jaarrente / 12. De afslag wordt na de
   woonquote-toets toegepast en dus ook op het AOW-scenario en op de toets tegen de werkelijke rente.

### Debetrente voor de factor

Standaard de **gewogen toetsrente**: het gewogen gemiddelde (gewicht = hoofdsom) over de
leningdelen van de nieuwe hypotheek, exclusief overbruggingskrediet. Per leningdeel geldt de
contractrente bij 10 jaar of langer resterende rentevaste periode, anders de AFM-toetsrente.
Alternatief: de **gewogen contractrente**. De UI toont beide.

De leningdelen zijn de meegenomen delen van de bestaande hypotheek (restschuld per vandaag) plus
de nieuwe geldlening (benodigde aanvullende hypotheek, tegen de beoogde rente en rentevastperiode).
Bij een starter is de nieuwe geldlening het enige deel. Omdat het benodigde bedrag zelf van de
berekening afhangt, rekent `computeCore` in maximaal drie ronden naar een vast punt. Het scherm,
de scenariotabel en de haalbaarheids-solver gebruiken allemaal dezelfde functie.

### Afslagmethode (instelling)

- **Marginaal** (standaard): de toetslast wordt gekapitaliseerd tegen de toetsrente van de nieuwe
  geldlening.
- **Gewogen**: tegen de gewogen toetsrente van alle leningdelen.

### Aflos-optimalisatie

Winst per afgeloste euro = (termijn / restschuld) × factor / annuïteitfactor. Bij een annuïteit met
gelijke looptijd en rente is dat per lening constant, dus greedy op de hoogste winst per euro is
optimaal. Volledig af te lossen leningen staan apart. Gedeeltelijke aflossing telt pas mee zodra
DUO het nieuwe maandbedrag heeft vastgesteld; alleen volledige aflossing is direct zeker.

### Geplande renteherziening

Per lening een datum en een nieuwe rente. De restschuld op die datum volgt uit het huidige
termijnbedrag; daarna wordt het termijnbedrag opnieuw als annuïteit berekend over de resterende
looptijd. De UI toont de toetslast vóór en ná de herziening; de leencapaciteit rekent met de
toetslast van nu.

### Aannames en keuzes

- Onder 10 jaar rentevast geldt het **hoogste** van contractrente en AFM-toetsrente (zoals de rest
  van de app), niet altijd de AFM-toetsrente.
- Een looptijd van 0 maanden met een restschuld geeft termijn 0 met een waarschuwing in de UI, nooit
  NaN of oneindig.
- Meerdere leningen krijgen dezelfde opslagfactor; die hangt van de hypotheek af, niet van de lening.
- Studieleningen van Partner 2 tellen alleen mee bij twee aanvragers.
- Oude dossiers en links met één studieschuldbedrag per partner en een globaal stelsel worden bij
  het laden omgezet naar één lening per partner (SF15: 2,29% over 180 maanden, SF35: 2,33% over 420).

### Afwijking in de specificatie

Testcase 5.3 geeft afslagen die zijn berekend met de annuïteitfactor afgerond op 0,0051803; de
exacte waarde is 0,0051803693. Daardoor wijkt de exacte afslag tot € 1,03 af (lening A bij factor
1,25: exact € 34.263,97 tegen € 34.265). De tests controleren de formule daarom binnen € 1 met
de afgeronde factor en de exacte berekening binnen € 1,5.
