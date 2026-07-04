// Overdrachtsbelasting en kosten koper 2026.
//
// Bronnen:
// - Belastingdienst / Rijksoverheid, tarieven overdrachtsbelasting 2026:
//   0% startersvrijstelling (18 t/m 34 jaar, woningwaarde ≤ €555.000, zelfbewoning,
//   eenmalig te gebruiken), 2% eigen woning (zelfbewoning), 8% woning niet-hoofdverblijf
//   (per 1 januari 2026 verlaagd van 10,4% naar 8%).
// - Woningwaardegrens startersvrijstelling 2026: €555.000 (2027: €615.000).
// - Nieuwbouw: geen overdrachtsbelasting; de koopsom is vrij op naam (v.o.n.) en bevat
//   BTW in plaats van overdrachtsbelasting.

// Kosten koper: realistische, per post aanpasbare 2026-defaults in plaats van een
// platte 3,5%. Indicatieve bedragen (NN, Viisi, De Hypotheker, 2026):
// - Notaris (leverings- + hypotheekakte, inschrijving Kadaster): ~€1.200
// - Taxatie (fysiek taxatierapport): ~€600
// - Hypotheekadvies en bemiddeling: ~€2.500
// - Bankgarantie: ~1% van de waarborgsom (10% van de koopsom) → 0,1% van de koopsom
// - Aankoopmakelaar (courtage, optioneel): ~1,2% van de koopsom
// - NHG-borgtochtprovisie 2026: 0,4% van het hypotheekbedrag (optioneel; de volledige
//   NHG-toets — kostengrens, lagere rente — zit nog niet in deze calculator)
export const KOSTEN_KOPER_DEFAULTS = {
  notaryCosts: 1200,
  valuationCosts: 600,
  advisoryCosts: 2500,
};
export const BANK_GUARANTEE_RATE = 0.001; // 1% van de 10%-waarborgsom
export const BUYERS_AGENT_RATE = 0.012;
export const NHG_FEE_RATE = 0.004;

export const STARTER_EXEMPTION_PRICE_CAP = 555000; // woningwaardegrens 2026
export const STARTER_EXEMPTION_MIN_AGE = 18;
export const STARTER_EXEMPTION_MAX_AGE = 34; // t/m 34 jaar (jonger dan 35)
export const OWNER_OCCUPIED_TAX_RATE = 0.02;
export const NON_PRIMARY_TAX_RATE = 0.08; // tweede woning / verhuur, tarief 2026

// Bepaalt het effectieve overdrachtsbelastingtarief.
//
// - propertyUsage: 'zelfbewoning' | 'nieuwbouw' | 'nietHoofdverblijf'
// - price: de aanschafprijs (bepalend voor de woningwaardegrens van de vrijstelling)
// - buyers: [{ age, exemption }] — alleen kopers meegeven (leeftijd ingevuld);
//   `exemption` betekent: de startersvrijstelling is nog niet eerder gebruikt.
//
// Bij twee kopers geldt de vrijstelling wettelijk per koper over diens aandeel in de
// woning. Deze calculator hanteert de indicatieve vereenvoudiging van een 50/50-aandeel:
// beide kopers vrijgesteld → 0%, één van de twee → 1% over het geheel, geen → 2%.
export function getTransferTaxRate({ propertyUsage, price, buyers = [] }) {
  if (propertyUsage === 'nieuwbouw') {
    return {
      rate: 0,
      label: 'n.v.t. (nieuwbouw)',
      shortLabel: 'n.v.t.',
      explanation:
        'Bij nieuwbouw betaalt u geen overdrachtsbelasting: de koopsom is vrij op naam en bevat BTW.',
      exemptBuyers: 0,
      totalBuyers: buyers.length,
    };
  }

  if (propertyUsage === 'nietHoofdverblijf') {
    return {
      rate: NON_PRIMARY_TAX_RATE,
      label: '8% (niet-hoofdverblijf)',
      shortLabel: '8%',
      explanation:
        'Voor een woning die niet uw hoofdverblijf wordt (tweede woning, verhuur) geldt in 2026 het tarief van 8%.',
      exemptBuyers: 0,
      totalBuyers: buyers.length,
    };
  }

  // Zelfbewoning: per koper toetsen of de startersvrijstelling geldt.
  const priceWithinCap = price > 0 && price <= STARTER_EXEMPTION_PRICE_CAP;
  const exemptBuyers = buyers.filter(
    (b) =>
      priceWithinCap &&
      b.exemption &&
      b.age >= STARTER_EXEMPTION_MIN_AGE &&
      b.age <= STARTER_EXEMPTION_MAX_AGE
  ).length;
  const totalBuyers = buyers.length;

  if (totalBuyers > 0 && exemptBuyers === totalBuyers) {
    return {
      rate: 0,
      label: '0% (startersvrijstelling)',
      shortLabel: '0%',
      explanation:
        'Alle kopers voldoen aan de startersvrijstelling: 18 t/m 34 jaar, woningwaarde maximaal €555.000 (grens 2026), zelfbewoning en de vrijstelling niet eerder gebruikt.',
      exemptBuyers,
      totalBuyers,
    };
  }

  if (exemptBuyers > 0) {
    // Indicatieve vereenvoudiging: vrijstelling per koper over een 50/50-aandeel.
    const rate = OWNER_OCCUPIED_TAX_RATE * ((totalBuyers - exemptBuyers) / totalBuyers);
    return {
      rate,
      label: `${(rate * 100).toLocaleString('nl-NL')}% (deels startersvrijstelling)`,
      shortLabel: `${(rate * 100).toLocaleString('nl-NL')}%`,
      explanation:
        'Eén van de kopers voldoet aan de startersvrijstelling. Indicatief is gerekend met een 50/50-eigendomsaandeel: over het vrijgestelde aandeel 0%, over het overige aandeel 2%. De werkelijke verdeling kan afwijken.',
      exemptBuyers,
      totalBuyers,
    };
  }

  return {
    rate: OWNER_OCCUPIED_TAX_RATE,
    label: '2% (eigen woning)',
    shortLabel: '2%',
    explanation:
      price > STARTER_EXEMPTION_PRICE_CAP
        ? 'De woningwaarde ligt boven de grens van €555.000 (2026), dus de startersvrijstelling geldt niet; voor een eigen woning geldt het tarief van 2%.'
        : 'Voor een eigen woning (zelfbewoning) zonder startersvrijstelling geldt het tarief van 2%.',
    exemptBuyers: 0,
    totalBuyers,
  };
}

// Volledige kosten-koper-uitsplitsing. Alle bedragen zijn indicatief en door de
// gebruiker aanpasbaar of aan/uit te zetten; de overdrachtsbelasting komt uit
// getTransferTaxRate() en wordt hier alleen als post opgenomen.
//
// - price: aanschafprijs (basis voor bankgarantie en makelaarscourtage)
// - mortgageAmount: indicatieve hypotheek (basis voor de NHG-borgtochtprovisie)
// - transferTax: berekend bedrag overdrachtsbelasting
// - transferTaxLabel: korte tariefaanduiding voor de weergave (bijv. '2%')
// - options: { notaryCosts, valuationCosts, advisoryCosts,
//              includeBankGuarantee, includeBuyersAgent, includeNhgFee }
export function getKostenKoperBreakdown({
  price,
  mortgageAmount,
  transferTax,
  transferTaxLabel,
  options,
}) {
  const p = Math.max(0, price || 0);
  const m = Math.max(0, mortgageAmount || 0);
  const num = (v) => {
    const n = parseFloat(v);
    return isNaN(n) || !isFinite(n) ? 0 : Math.max(0, n);
  };

  const items = [
    {
      key: 'transferTax',
      label: `Overdrachtsbelasting (${transferTaxLabel})`,
      amount: Math.max(0, transferTax || 0),
      editable: false,
      included: true,
    },
    {
      key: 'notary',
      label: 'Notaris (leverings- en hypotheekakte)',
      amount: num(options.notaryCosts),
      editable: true,
      included: true,
    },
    {
      key: 'valuation',
      label: 'Taxatie',
      amount: num(options.valuationCosts),
      editable: true,
      included: true,
    },
    {
      key: 'advisory',
      label: 'Hypotheekadvies en bemiddeling',
      amount: num(options.advisoryCosts),
      editable: true,
      included: true,
    },
    {
      key: 'bankGuarantee',
      label: 'Bankgarantie (0,1% koopsom)',
      amount: p * BANK_GUARANTEE_RATE,
      editable: false,
      included: !!options.includeBankGuarantee,
    },
    {
      key: 'buyersAgent',
      label: 'Aankoopmakelaar (1,2% koopsom)',
      amount: p * BUYERS_AGENT_RATE,
      editable: false,
      included: !!options.includeBuyersAgent,
    },
    {
      key: 'nhgFee',
      label: 'NHG-borgtochtprovisie (0,4% hypotheek)',
      amount: m * NHG_FEE_RATE,
      editable: false,
      included: !!options.includeNhgFee,
    },
  ];

  const total = items.reduce((sum, item) => sum + (item.included ? item.amount : 0), 0);
  // Overige kosten koper: alles behalve de overdrachtsbelasting, voor weergaven die de
  // belasting apart tonen (financieringsgatblok).
  const otherCostsTotal = total - items[0].amount;

  return { items, total, otherCostsTotal };
}
