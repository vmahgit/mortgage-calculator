import { beforeEach, describe, expect, it, vi } from 'vitest';

// jsPDF en jspdf-autotable worden nagebootst: we controleren welke tabellen de export opbouwt,
// niet de pixels. Zo valt een fout in de nieuwe "Wat kunt u lenen?"-sectie meteen op.
const tables = [];
const saved = [];

vi.mock('jspdf', () => {
  class FakePdf {
    constructor() {
      this.internal = {
        pageSize: { getHeight: () => 297, getWidth: () => 210 },
        getNumberOfPages: () => 1,
      };
      return new Proxy(this, {
        get(target, prop) {
          if (prop in target) return target[prop];
          if (prop === 'save') return (name) => saved.push(name);
          if (prop === 'splitTextToSize') return (text) => [text];
          return () => undefined;
        },
      });
    }
  }
  return { jsPDF: FakePdf };
});
vi.mock('jspdf-autotable', () => ({
  default: (doc, options) => {
    tables.push(options.body);
    doc.lastAutoTable = { finalY: 40 };
  },
}));

const { exportHypotheekAdviesPdf } = await import('./pdfExport.js');

const base = {
  generatedAt: new Date('2026-10-08T12:00:00'),
  hasExistingHome: true,
  hasPartner2: true,
  purchasePrice: 1330000,
  rate: 4,
  fixedRatePeriod: 10,
  energyLabel: 'A',
  propertyUsageLabel: 'Bestaande bouw',
  toets1: { toetsinkomen: 118000 },
  toets2: { toetsinkomen: 115000 },
  combinedIncome: 233000,
  woonquote: 0.274,
  maxWoonlastMonthly: 5320,
  monthlyDebt: 193,
  bindingFactor: null,
  resultLabel: 'Maximaal aankoopbudget',
  resultValue: 1364675,
  kostenKoperTotal: 32650,
  transferTaxLabel: 'Overdrachtsbelasting (2%)',
  kostenKoperItems: [],
  current: { marketValue: 935000, currentDebtBalance: 623750, overwaarde: 311250, ltv: 67 },
  gap: { portedDebt: 623750, ownCapitalApplied: 117770, additionalMortgage: 323980 },
  maxBudget: { maxBudget: 1364675, remainingRoom: 34675 },
  starter: null,
};

describe('PDF-export: wat kunt u lenen', () => {
  beforeEach(() => {
    tables.length = 0;
    saved.length = 0;
  });

  it('neemt samenvatting en alle regels van de opbouw op, in volgorde', () => {
    const capacity = {
      summary: [
        ['Maximale totale hypotheek', '€ 950.175'],
        ['Nieuw geld nodig voor deze woning', '€ 323.980'],
      ],
      rows: [
        ['Leencapaciteit op basis van inkomen', '€ 1.114.369'],
        ['Afslag studieschuld (DUO)', '- € 35.692'],
        ['Maximaal nieuw te lenen', '€ 326.425'],
      ],
    };
    exportHypotheekAdviesPdf({ ...base, capacity });
    expect(tables).toContainEqual(capacity.summary);
    expect(tables).toContainEqual(capacity.rows);
    expect(tables.indexOf(capacity.summary)).toBeLessThan(tables.indexOf(capacity.rows));
    expect(saved).toHaveLength(1);
  });

  it('werkt ook zonder opbouw (oudere aanroepen)', () => {
    exportHypotheekAdviesPdf({ ...base, capacity: null });
    expect(tables.some((t) => t.some((r) => r[0] === 'Maximale totale hypotheek'))).toBe(false);
    expect(saved).toHaveLength(1);
  });
});
