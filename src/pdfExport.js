import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

const PAGE_MARGIN = 14;
const ACCENT = [37, 99, 235]; // blue-600
const ACCENT_DARK = [15, 23, 42]; // slate-900
const MUTED = [100, 116, 139]; // slate-500

function formatEuro(amount) {
  return new Intl.NumberFormat('nl-NL', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(Math.round(amount || 0));
}

function formatPct(fraction, decimals = 1) {
  return `${(fraction * 100).toFixed(decimals).replace('.', ',')}%`;
}

function formatDateNL(date) {
  return new Intl.DateTimeFormat('nl-NL', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

// Bestandsnaam: logisch en herkenbaar terug te vinden — het type advies, kernbedrag en de
// datum van generatie, zonder speciale tekens die op sommige besturingssystemen problemen
// geven in bestandsnamen.
export function buildPdfFilename({ hasExistingHome, resultValue, generatedAt }) {
  const kind = hasExistingHome ? 'doorstromer' : 'starter';
  const amount = Math.round(resultValue || 0);
  const dateStr = generatedAt.toISOString().slice(0, 10); // YYYY-MM-DD
  return `Hypotheekadvies_${kind}_${amount}_${dateStr}.pdf`;
}

function addSectionHeader(doc, title, y) {
  doc.setFillColor(...ACCENT);
  doc.rect(PAGE_MARGIN, y, 3, 5, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...ACCENT_DARK);
  doc.text(title, PAGE_MARGIN + 5, y + 4.2);
  return y + 10;
}

function ensureSpace(doc, y, needed) {
  const pageHeight = doc.internal.pageSize.getHeight();
  if (y + needed > pageHeight - 20) {
    doc.addPage();
    return 18;
  }
  return y;
}

function keyValueTable(doc, y, rows) {
  autoTable(doc, {
    startY: y,
    margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
    theme: 'plain',
    styles: { fontSize: 9.5, cellPadding: 1.5, textColor: ACCENT_DARK },
    columnStyles: {
      0: { textColor: MUTED, cellWidth: 90 },
      1: { fontStyle: 'bold', halign: 'right' },
    },
    body: rows,
  });
  return doc.lastAutoTable.finalY + 6;
}

// Bouwt en downloadt het PDF-adviesrapport. `data` bevat een bewust beperkte, samengevatte
// set gegevens (niet de volledige interne calc-objecten) zodat dit bestand losstaat van de
// interne structuur van MortgageCalculator.jsx.
export function exportHypotheekAdviesPdf(data) {
  const {
    generatedAt,
    hasExistingHome,
    hasPartner2,
    purchasePrice,
    rate,
    fixedRatePeriod,
    energyLabel,
    propertyUsageLabel,
    toets1,
    toets2,
    combinedIncome,
    woonquote,
    maxWoonlastMonthly,
    monthlyDebt,
    bindingFactor,
    resultLabel,
    resultValue,
    kostenKoperTotal,
    transferTaxLabel,
    kostenKoperItems,
    current, // { marketValue, currentDebtBalance, overwaarde, ltv } | null
    gap, // { additionalMortgage, ownCapitalApplied, portedDebt } | null
    maxBudget, // { maxBudget, remainingRoom } | null
    starter, // { parts: [{label, principal, rate}], totalGross, totalNet } | null
  } = data;

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  let y = 20;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(...ACCENT_DARK);
  doc.text('Hypotheekadvies', PAGE_MARGIN, y);
  y += 7;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(...MUTED);
  doc.text(
    `Indicatieve berekening op basis van de Nibud-systematiek 2026 — gegenereerd op ${formatDateNL(generatedAt)}`,
    PAGE_MARGIN,
    y
  );
  y += 10;

  // Resultaat, prominent bovenaan.
  doc.setFillColor(239, 246, 255); // blue-50
  doc.roundedRect(PAGE_MARGIN, y, 182, 26, 2, 2, 'F');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(...MUTED);
  doc.text(resultLabel, PAGE_MARGIN + 5, y + 8);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(...ACCENT_DARK);
  doc.text(formatEuro(resultValue), PAGE_MARGIN + 5, y + 18);
  if (bindingFactor) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...MUTED);
    const wrapped = doc.splitTextToSize(
      `Bepalend: ${bindingFactor.label} — ${bindingFactor.explanation}`,
      95
    );
    doc.text(wrapped, PAGE_MARGIN + 95, y + 8);
  }
  y += 32;

  y = addSectionHeader(doc, 'Uw situatie', y);
  y = keyValueTable(doc, y, [
    ['Aantal aanvragers', hasPartner2 ? '2 aanvragers' : '1 aanvrager'],
    ['Situatie', hasExistingHome ? 'Doorstromer (bestaande woning)' : 'Starter (geen bestaande woning)'],
  ]);

  y = ensureSpace(doc, y, 40);
  y = addSectionHeader(doc, 'Beoogde woning', y);
  y = keyValueTable(doc, y, [
    ['Aanschafprijs', formatEuro(purchasePrice)],
    ['Beoogde hypotheekrente', `${rate.toFixed(2).replace('.', ',')}%`],
    ['Rentevastperiode', `${fixedRatePeriod} jaar`],
    ['Energielabel', energyLabel],
    ['Type aankoop', propertyUsageLabel],
  ]);

  y = ensureSpace(doc, y, 40);
  y = addSectionHeader(doc, 'Inkomen', y);
  const incomeRows = [['Toetsinkomen aanvrager 1', formatEuro(toets1.toetsinkomen)]];
  if (hasPartner2) incomeRows.push(['Toetsinkomen aanvrager 2', formatEuro(toets2.toetsinkomen)]);
  incomeRows.push(['Gezamenlijk toetsinkomen', formatEuro(combinedIncome)]);
  incomeRows.push(['Woonquote (Nibud 2026)', formatPct(woonquote)]);
  incomeRows.push(['Max. bruto woonlast per maand', formatEuro(maxWoonlastMonthly)]);
  if (monthlyDebt > 0) incomeRows.push(['Maandlast schulden (afgetrokken)', `- ${formatEuro(monthlyDebt)}`]);
  y = keyValueTable(doc, y, incomeRows);

  if (hasExistingHome && current) {
    y = ensureSpace(doc, y, 55);
    y = addSectionHeader(doc, 'Huidige woning en hypotheek', y);
    y = keyValueTable(doc, y, [
      ['Huidige marktwaarde', formatEuro(current.marketValue)],
      ['Huidige hypotheekschuld', formatEuro(current.currentDebtBalance)],
      ['Overwaarde', formatEuro(current.overwaarde)],
      ['Huidige LTV', `${current.ltv.toFixed(0)}%`],
    ]);

    if (gap) {
      y = ensureSpace(doc, y, 45);
      y = addSectionHeader(doc, 'Financieringsgat beoogde woning', y);
      y = keyValueTable(doc, y, [
        ['Mee te nemen hypotheek', formatEuro(gap.portedDebt)],
        ['Gedekt door eigen vermogen', formatEuro(gap.ownCapitalApplied)],
        ['Aanvullende hypotheek', formatEuro(gap.additionalMortgage)],
      ]);
    }

    if (maxBudget) {
      y = ensureSpace(doc, y, 35);
      y = addSectionHeader(doc, 'Maximaal aankoopbudget', y);
      y = keyValueTable(doc, y, [
        ['Maximaal aankoopbudget', formatEuro(maxBudget.maxBudget)],
        [
          maxBudget.remainingRoom >= 0 ? 'Ruimte t.o.v. aanschafprijs' : 'Tekort t.o.v. aanschafprijs',
          formatEuro(Math.abs(maxBudget.remainingRoom)),
        ],
      ]);
    }
  }

  if (!hasExistingHome && starter) {
    y = ensureSpace(doc, y, 60);
    y = addSectionHeader(doc, 'Samenstelling hypotheek', y);
    autoTable(doc, {
      startY: y,
      margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
      head: [['Leningdeel', 'Aflosvorm', 'Hoofdsom', 'Rente']],
      body: starter.parts.map((p, i) => [
        `Leningdeel ${i + 1}`,
        p.type,
        formatEuro(p.principal),
        `${Number(p.rate).toFixed(2).replace('.', ',')}%`,
      ]),
      styles: { fontSize: 9, cellPadding: 2 },
      headStyles: { fillColor: ACCENT, textColor: 255 },
    });
    y = doc.lastAutoTable.finalY + 6;
    y = keyValueTable(doc, y, [
      ['Bruto maandlast totaal', formatEuro(starter.totalGross)],
      ['Netto maandlast totaal', formatEuro(starter.totalNet)],
    ]);
  }

  y = ensureSpace(doc, y, 45);
  y = addSectionHeader(doc, 'Kosten koper', y);
  autoTable(doc, {
    startY: y,
    margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
    head: [['Kostenpost', 'Bedrag']],
    body: [
      ...kostenKoperItems.map((item) => [item.label, formatEuro(item.amount)]),
      [`Totaal kosten koper (${transferTaxLabel})`, formatEuro(kostenKoperTotal)],
    ],
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: ACCENT, textColor: 255 },
    columnStyles: { 1: { halign: 'right' } },
    didParseCell: (hookData) => {
      if (hookData.row.index === kostenKoperItems.length && hookData.section === 'body') {
        hookData.cell.styles.fontStyle = 'bold';
      }
    },
  });
  y = doc.lastAutoTable.finalY + 10;

  // Disclaimer + paginanummering op elke pagina.
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    const pageHeight = doc.internal.pageSize.getHeight();
    doc.setDrawColor(226, 232, 240);
    doc.line(PAGE_MARGIN, pageHeight - 16, 210 - PAGE_MARGIN, pageHeight - 16);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(
      'Indicatieve berekening op basis van de Nibud-systematiek 2026. Geen rechten kunnen aan deze uitkomst worden ontleend.',
      PAGE_MARGIN,
      pageHeight - 11
    );
    doc.text(`Pagina ${i} van ${pageCount}`, 210 - PAGE_MARGIN, pageHeight - 11, { align: 'right' });
  }

  doc.save(buildPdfFilename({ hasExistingHome, resultValue, generatedAt }));
}
