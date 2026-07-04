// Toetsinkomen per aanvrager: van bruto inkomen naar het inkomen waarmee de
// Nibud-woonquote-toets rekent.
//
// Systematiek (Tijdelijke regeling hypothecair krediet; gangbare acceptatienormen):
// - Loondienst vast contract: bruto jaarinkomen telt volledig mee.
// - Flexcontract mét intentieverklaring werkgever: telt volledig mee, als vast.
// - Flexcontract zónder intentieverklaring: gemiddelde van de laatste drie
//   jaarinkomens, gemaximeerd op het laatste jaar.
// - ZZP/ondernemer: gemiddelde fiscale winst van de laatste drie jaren, gemaximeerd
//   op het laatste jaar. Korter dan drie jaar actief → beperkter beoordeeld
//   (hier: waarschuwing via insufficientHistory).
// - Structureel inkomen (vaste 13e maand, vaste eindejaarsuitkering) telt mee;
//   incidenteel inkomen (bonus, overwerk) alleen als gemiddelde over drie jaar.
// - Betaalde partneralimentatie gaat bruto van het toetsinkomen af (×12), vóór de
//   woonquote-bepaling — dus geen kapitalisatie zoals bij consumptieve schulden.
//   Ontvangen partneralimentatie telt niet mee als toetsinkomen; kinderalimentatie
//   heeft geen invloed.
//
// Retourneert een transparant opbouwobject zodat de UI stap voor stap kan tonen hoe
// het toetsinkomen tot stand komt.

function num(value) {
  const n = parseFloat(value);
  return isNaN(n) || !isFinite(n) ? 0 : n;
}

export const INCOME_TYPES = {
  vast: 'Loondienst, vast contract',
  flexMet: 'Flexcontract mét intentieverklaring',
  flexZonder: 'Flexcontract zónder intentieverklaring',
  zzp: 'ZZP / ondernemer',
};

export function getToetsinkomen({
  incomeType = 'vast',
  income = 0,
  history = { y1: '', y2: '', y3: '' },
  thirteenthMonth = 0,
  avgBonus = 0,
  alimonyMonthly = 0,
}) {
  const usesHistory = incomeType === 'flexZonder' || incomeType === 'zzp';

  let base;
  let cappedAtLastYear = false;
  let insufficientHistory = false;

  if (usesHistory) {
    const years = [history.y1, history.y2, history.y3].map(num);
    const filledYears = [history.y1, history.y2, history.y3].filter(
      (v) => v !== '' && v !== null && v !== undefined && num(v) > 0
    ).length;
    insufficientHistory = filledYears < 3;
    const average = (years[0] + years[1] + years[2]) / 3;
    const lastYear = years[0];
    // Gemiddelde van drie jaar, gemaximeerd op het laatste jaar: een dalend inkomen
    // telt dus tegen het laatste (lagere) jaar, een stijgend inkomen tegen het
    // (lagere) gemiddelde.
    base = Math.min(average, lastYear);
    cappedAtLastYear = average > lastYear;
  } else {
    base = num(income);
  }

  const structural = Math.max(0, num(thirteenthMonth)) + Math.max(0, num(avgBonus));
  const alimonyDeduction = 12 * Math.max(0, num(alimonyMonthly));
  const toetsinkomen = Math.max(0, base + structural - alimonyDeduction);

  return {
    toetsinkomen,
    base,
    structural,
    alimonyDeduction,
    cappedAtLastYear,
    insufficientHistory,
    usesHistory,
  };
}
