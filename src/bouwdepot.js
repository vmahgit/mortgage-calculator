// Bouwdepot bij nieuwbouw: het deel van de hypotheek voor de aanneemsom wordt niet in
// één keer uitgekeerd, maar in termijnen ("bouwtermijnen") opgenomen naarmate de bouw
// vordert. Tijdens de bouw betaalt u alleen rente over het al opgenomen bedrag, niet over
// het volledige bouwdepot — dat is het kenmerkende, tijdelijke rentevoordeel van nieuwbouw
// ten opzichte van een hypotheek die vanaf dag 1 volledig is opgenomen.
//
// Vereenvoudiging voor deze indicatieve berekening: een lineaire opname verondersteld (0%
// bij start, 100% bij oplevering), in plaats van de werkelijke, projectspecifieke
// bouwtermijnenstaat (die per project verschilt). Bij een lineaire opname is het gemiddeld
// opgenomen bedrag tijdens de bouw de helft van het bouwdepot — dat gemiddelde bepaalt de
// rentelasten tijdens de bouwperiode.
//
// Dit is puur informatief (cashflow tijdens de bouw) en telt niet mee in de
// leencapaciteit: de maximale hypotheek wordt, net als bij bestaande bouw, bepaald door de
// Nibud-woonquote-systematiek (zie nibud2026.js).
export function getBouwdepotEstimate({ bouwdepotAmount, constructionMonths, ratePct }) {
  const amount = Math.max(0, bouwdepotAmount || 0);
  const months = Math.max(1, constructionMonths || 12);
  const monthlyRate = Math.max(0, ratePct || 0) / 100 / 12;

  const averageDrawn = amount * 0.5;
  const monthlyInterestAtCompletion = amount * monthlyRate;
  const monthlyInterestAverage = averageDrawn * monthlyRate;
  const totalInterestDuringConstruction = monthlyInterestAverage * months;
  // Rentevoordeel t.o.v. een hypotheek die vanaf dag 1 volledig zou zijn opgenomen.
  const interestSavedVsImmediate = monthlyInterestAtCompletion * months - totalInterestDuringConstruction;

  return {
    amount,
    months,
    averageDrawn,
    monthlyInterestAtStart: 0,
    monthlyInterestAtCompletion,
    monthlyInterestAverage,
    totalInterestDuringConstruction,
    interestSavedVsImmediate,
  };
}
