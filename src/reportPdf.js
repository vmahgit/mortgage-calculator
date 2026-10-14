// PDF-weergave van de rekenverantwoording (zie calculationReport.js voor de inhoud). Bewust los van
// pdfExport.js (het adviesrapport): dit document is een nalopbare rekenstaat voor een adviseur.

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

const MARGIN = 14;
const ACCENT = [37, 99, 235];
const DARK = [15, 23, 42];
const MUTED = [100, 116, 139];
const WARN = [180, 83, 9];
const PAGE_W = 210;
const CONTENT_W = PAGE_W - 2 * MARGIN;

// De standaardlettertypen van jsPDF kennen alleen Latin-1: vervang tekens daarbuiten.
export function pdfSafe(value) {
  return String(value ?? '')
    .replace(/[−–—]/g, '-')
    .replace(/≥/g, '>=')
    .replace(/≤/g, '<=')
    .replace(/[→⇒]/g, '->')
    .replace(/≈/g, 'ca.')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
    .replace(/[  ]/g, ' ');
}

export function buildReportFilename(report) {
  return `Rekenverantwoording_${report.meta.kind}_${report.meta.generatedAt.slice(0, 10)}.pdf`;
}

function ensureSpace(doc, y, needed) {
  if (y + needed > doc.internal.pageSize.getHeight() - 18) {
    doc.addPage();
    return 18;
  }
  return y;
}

function sectionHeader(doc, title, y) {
  y = ensureSpace(doc, y, 20);
  doc.setFillColor(...ACCENT);
  doc.rect(MARGIN, y, 3, 5.5, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...DARK);
  doc.text(pdfSafe(title), MARGIN + 5, y + 4.4);
  return y + 10;
}

function paragraph(doc, y, textValue, { style = 'normal', size = 9 } = {}) {
  doc.setFont('helvetica', style === 'note' ? 'italic' : 'normal');
  doc.setFontSize(size);
  doc.setTextColor(...(style === 'warning' ? WARN : style === 'note' ? MUTED : DARK));
  const lines = doc.splitTextToSize(pdfSafe(textValue), CONTENT_W);
  y = ensureSpace(doc, y, lines.length * 4.2 + 2);
  doc.text(lines, MARGIN, y + 3);
  return y + lines.length * 4.2 + 3;
}

function renderBlock(doc, y, block) {
  switch (block.type) {
    case 'heading': {
      y = ensureSpace(doc, y, 14);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(...ACCENT);
      doc.text(pdfSafe(block.text), MARGIN, y + 3);
      return y + 6.5;
    }
    case 'text':
      return paragraph(doc, y, block.text, { style: block.style });
    case 'kv': {
      const isList = block.rows.length > 0 && block.rows.every((r) => /^\d+$/.test(String(r[0])));
      autoTable(doc, {
        startY: y,
        margin: { left: MARGIN, right: MARGIN },
        theme: 'plain',
        styles: { fontSize: 9, cellPadding: { top: 1.1, bottom: 1.1, left: 1, right: 1 }, textColor: DARK, overflow: 'linebreak' },
        columnStyles: isList
          ? { 0: { cellWidth: 7, textColor: MUTED }, 1: { halign: 'left' } }
          : { 0: { textColor: MUTED, cellWidth: 98 }, 1: { fontStyle: 'bold', halign: 'right' } },
        body: block.rows.map((r) => [pdfSafe(r[0]), pdfSafe(r[1])]),
      });
      return doc.lastAutoTable.finalY + 4;
    }
    case 'table': {
      const bold = new Set(block.boldRows || []);
      const aligns = block.align || [];
      const columnStyles = {};
      aligns.forEach((a, i) => {
        columnStyles[i] = { halign: a };
      });
      autoTable(doc, {
        startY: y,
        margin: { left: MARGIN, right: MARGIN },
        theme: 'striped',
        headStyles: { fillColor: ACCENT, fontSize: block.compact ? 8 : 7.5, halign: 'left' },
        styles: { fontSize: block.compact ? 8.5 : 7.5, cellPadding: 1.3, textColor: DARK, overflow: 'linebreak' },
        alternateRowStyles: { fillColor: [244, 247, 252] },
        columnStyles,
        head: [block.head.map(pdfSafe)],
        body: block.rows.map((r) => r.map(pdfSafe)),
        didParseCell: (data) => {
          if (data.section === 'head' && aligns[data.column.index]) data.cell.styles.halign = aligns[data.column.index];
          if (data.section === 'body' && bold.has(data.row.index)) data.cell.styles.fontStyle = 'bold';
        },
      });
      return doc.lastAutoTable.finalY + 4;
    }
    case 'step': {
      y = ensureSpace(doc, y, 22);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.setTextColor(...DARK);
      doc.text(pdfSafe(`${block.n}. ${block.title}`), MARGIN, y + 3);
      y += 6;
      for (const line of block.lines) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.5);
        doc.setTextColor(...DARK);
        const wrapped = doc.splitTextToSize(pdfSafe(line), CONTENT_W - 6);
        y = ensureSpace(doc, y, wrapped.length * 3.9 + 1);
        doc.text(wrapped, MARGIN + 4, y + 2.6);
        y += wrapped.length * 3.9 + 1;
      }
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(...ACCENT);
      const res = doc.splitTextToSize(pdfSafe(`=> ${block.result}`), CONTENT_W - 6);
      y = ensureSpace(doc, y, res.length * 4 + 2);
      doc.text(res, MARGIN + 4, y + 3);
      return y + res.length * 4 + 4;
    }
    default:
      return y;
  }
}

export function buildReportPdf(report) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  let y = 20;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(...DARK);
  doc.text(pdfSafe(report.meta.title), MARGIN, y);
  y += 7;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  const gen = report.meta.generatedAt.slice(0, 10).split('-').reverse().join('-');
  const peil = report.meta.peildatum.split('-').reverse().join('-');
  doc.text(
    pdfSafe(`Gegenereerd op ${gen} | peildatum ${peil} | regelgeving ${report.meta.regulationYear} | versie ${report.meta.appVersion}`),
    MARGIN,
    y
  );
  y += 4.5;
  doc.text(pdfSafe(`Verdeling nieuw geld: ${report.meta.splitMode}`), MARGIN, y);
  y += 8;

  for (const section of report.sections) {
    y = sectionHeader(doc, section.title, y);
    for (const block of section.blocks) y = renderBlock(doc, y, block);
    y += 3;
  }

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(pdfSafe('Indicatieve berekening, geen bindend advies. Zie sectie 5 voor aannames en beperkingen.'), MARGIN, 290);
    doc.text(`Pagina ${p} van ${pages}`, PAGE_W - MARGIN, 290, { align: 'right' });
  }
  return doc;
}

export function exportCalculationReportPdf(report) {
  buildReportPdf(report).save(buildReportFilename(report));
}
