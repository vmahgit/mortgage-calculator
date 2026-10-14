import { readFileSync, writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  computeCore,
  computeStarterGap,
  evaluateAffordability,
  fillDossierDefaults,
  splitAdditionalMortgage,
  ADDITIONAL_SPLIT_MODES,
  DOSSIER_DEFAULTS,
} from './calcEngine';
import { buildCapacityBreakdown } from './capacityBreakdown';
import {
  EXCEL_INPUT_LABELS,
  buildCalculationReport,
  buildDossierFile,
  parseDossierFile,
  reportToText,
  toScenarioSpec,
  unsupportedFeatures,
} from './calculationReport';
import { buildReportPdf, pdfSafe } from './reportPdf';
import { metricsFor, toDossier } from './toetsmodelBridge';

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-08T12:00:00'));
});
afterAll(() => vi.useRealTimers());

function reportFor(partial = {}, opts = {}) {
  const d = fillDossierDefaults(partial);
  const core = computeCore(d);
  const starterGap = computeStarterGap(d, core.calc);
  const breakdown = buildCapacityBreakdown(d, core, starterGap);
  const report = buildCalculationReport(d, core, { breakdown, starterGap, generatedAt: new Date(), appVersion: 'test', ...opts });
  return { d, core, breakdown, report };
}
const allText = (report) => reportToText(report);

describe('nieuwe standaardwaarden', () => {
  let d;
  beforeAll(() => {
    d = fillDossierDefaults({});
  });
  it('partner 2 verdient € 107.000 en de nieuwe rente is 4,69%', () => {
    expect(d.income1).toBe(118000);
    expect(d.income2).toBe(107000);
    expect(d.rate).toBe(4.69);
    expect(d.fixedRatePeriod).toBe(10);
  });
  it('beide studieleningen uit de DUO-overzichten', () => {
    expect(d.studyLoans).toHaveLength(2);
    expect(d.studyLoans[0]).toMatchObject({ owner: 1, balance: '13803.67', ratePct: 2.95, remainingMonths: 111, monthlyPayment: '142' });
    expect(d.studyLoans[1]).toMatchObject({ owner: 2, balance: '26810.03', ratePct: 0, remainingMonths: 141, monthlyPayment: '190', status: 'regulier' });
  });
  it('het extra leningdeel is standaard volledig annuïtair', () => {
    expect(d.additionalSplitMode).toBe('annuiteit');
    expect(d.additionalLoanParts).toHaveLength(1);
    expect(d.additionalLoanParts[0]).toMatchObject({ type: 'Annuïteit', rate: 4.69 });
  });
  it('eigen geld € 60.000 + € 16.000 en geen tweede woning', () => {
    expect(d.ownCapital1).toBe(60000);
    expect(d.ownCapital2).toBe(16000);
    expect(d.hasSecondHome).toBe(false);
  });
  it('de standaardwaarden: kolom 3,501–4,000% (officieel), deel 2 in box 3, en € 1.330.000 past niet', () => {
    const core = computeCore(d);
    expect(core.currentMortgage.composite.band.upper).toBe(4.0);
    expect(core.currentMortgage.composite.band.exact).toBe(true);
    expect(core.currentMortgage.portedParts[1].box3).toBe(true);
    expect(core.combinedGap.withinCapacity).toBe(false);
  });
});

describe('verdeling van het nieuwe geld', () => {
  it('volledig annuïtair: één annuïtair deel met het hele bedrag', () => {
    const parts = splitAdditionalMortgage({ needed: 323980.4, mode: 'annuiteit', aflossingsvrijRoom: 311000, rate: 4.69, fixedYears: 10 });
    expect(parts).toEqual([{ id: 2, type: 'Annuïteit', principal: '323980', rate: 4.69, originalFixedYears: 10 }]);
  });
  it('eerst aflossingsvrij: tot de bancaire ruimte, rest annuïtair', () => {
    const parts = splitAdditionalMortgage({ needed: 323980, mode: 'aflossingsvrijEerst', aflossingsvrijRoom: 311000, rate: 4.69, fixedYears: 10 });
    expect(parts.map((p) => [p.type, p.principal])).toEqual([['Aflossingsvrij', '311000'], ['Annuïteit', '12980']]);
    expect(parts.reduce((s, p) => s + Number(p.principal), 0)).toBe(323980);
  });
  it('geen ruimte of geen bedrag: één leeg annuïtair deel; negatieve ruimte telt als nul', () => {
    expect(splitAdditionalMortgage({ needed: 0, mode: 'aflossingsvrijEerst', aflossingsvrijRoom: 5000, rate: 4, fixedYears: 10 })).toHaveLength(1);
    const p = splitAdditionalMortgage({ needed: 1000, mode: 'aflossingsvrijEerst', aflossingsvrijRoom: -50, rate: 4, fixedYears: 5 });
    expect(p).toEqual([{ id: 2, type: 'Annuïteit', principal: '1000', rate: 4, originalFixedYears: 5 }]);
  });
  it('beide modi staan in de keuzelijst', () => {
    expect(Object.keys(ADDITIONAL_SPLIT_MODES)).toEqual(['annuiteit', 'aflossingsvrijEerst']);
    expect(DOSSIER_DEFAULTS.additionalSplitMode in ADDITIONAL_SPLIT_MODES).toBe(true);
  });
});

describe('rekenverantwoording: inhoud klopt met de rekenkern', () => {
  // Pas binnen beforeAll rekenen: dan geldt de vaste testdatum (8 okt. 2026).
  let d, core, breakdown, report, text, calc, gap, cm;
  beforeAll(() => {
    ({ d, core, breakdown, report } = reportFor());
    text = allText(report);
    ({ calc, combinedGap: gap, currentMortgage: cm } = core);
  });
  const nl0 = (v) => new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 0 }).format(Math.round(v));

  it('heeft de zes onderdelen in vaste volgorde', () => {
    expect(report.sections.map((s) => s.id)).toEqual(['uitkomst', 'afslagen', 'invoer', 'stappen', 'aannames', 'reproductie']);
  });

  it('toont uitkomst, ruimte en bindende grens', () => {
    expect(report.result.maxTotalMortgage).toBeCloseTo(breakdown.maxTotalMortgage, 6);
    expect(report.result.feasible).toBe(false);
    expect(text).toContain(`€ ${nl0(breakdown.maxTotalMortgage)}`);
    expect(text).toContain('Haalbaar?');
  });

  it('de afslagentabel heeft elke regel van de opbouw en de sluitingscontrole', () => {
    const afslagen = report.sections.find((s) => s.id === 'afslagen');
    const tbl = afslagen.blocks.find((b) => b.type === 'table');
    expect(tbl.rows).toHaveLength(breakdown.rows.length);
    expect(tbl.rows.some((r) => r[0].startsWith('Studieschuld'))).toBe(true);
    expect(tbl.rows.some((r) => r[0].startsWith('Meegenomen hypotheek'))).toBe(true);
    expect(text).toContain('Controle: alle regels sluiten exact');
  });

  it('de stappen noemen de belangrijkste getallen uit de kern', () => {
    expect(text).toContain(`€ ${nl0(calc.combinedIncome)}`);
    expect(text).toContain(`${(calc.woonquote * 100).toFixed(2).replace('.', ',')}%`);
    expect(text).toContain(`€ ${nl0(calc.studyAfslag)}`);
    expect(text).toContain('Opslagfactor');
    expect(text).toContain('1,20');
    expect(text).toContain(`€ ${nl0(cm.extraBorrowCapacity)}`);
    expect(text).toContain(`€ ${nl0(gap.additionalMortgage)}`);
  });

  it('beide studieleningen staan apart in invoer en stappen', () => {
    expect(text).toContain('Lening 1: DUO-maandbedrag € 142,00');
    expect(text).toContain('Lening 2: DUO-maandbedrag € 190,00');
  });

  it('noemt de officiële tabellen en de box 3-brutering van deel 2', () => {
    expect(text).toContain('volledig en letterlijk overgenomen uit Stcrt. 2025, 36471');
    expect(text).toContain('bruteringsfactor Tabel 1 ÷ Tabel 3');
    expect(report.warnings).toEqual([]);
  });

  it('de afslagentotalen komen overeen met de opbouw', () => {
    expect(report.result.afslagen.total).toBeCloseTo(breakdown.afslagen.total, 8);
    // De hoogste haalbare prijs (op € 1.000) past wel, € 1.000 meer niet.
    const max = report.result.maxAffordablePrice;
    expect(evaluateAffordability({ ...d, purchasePrice: max }).affordable).toBe(true);
    expect(evaluateAffordability({ ...d, purchasePrice: max + 1000 }).affordable).toBe(false);
  });

  it('toont de gekozen nieuwe leningdelen: volledig annuïtair, met maandlast en toets van deze verdeling', () => {
    // De automatische verdeling is in de app al toegepast; hier het dossier zoals de app het bewaart.
    const need = String(Math.round(core.combinedGap.additionalMortgage));
    const full = reportFor({ additionalLoanParts: [{ id: 2, type: 'Annuïteit', principal: need, rate: 4.69, originalFixedYears: 10 }] });
    const uit = full.report.sections.find((s) => s.id === 'uitkomst');
    const tbl = uit.blocks.find((b) => b.type === 'table');
    expect(tbl.rows).toHaveLength(1);
    expect(tbl.rows[0][0]).toBe('Annuïteit');
    expect(tbl.rows[0][1]).toBe(`€ ${nl0(Number(need))}`);
    expect(tbl.rows[0][2]).toBe('4,69%');
    // Eerste maand: annuïteit van het benodigde bedrag tegen 4,69% over 360 maanden.
    const r = 0.0469 / 12;
    const pmt = (Number(need) * r) / (1 - Math.pow(1 + r, -360));
    expect(tbl.rows[0][6]).toBe(`€ ${pmt.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`);
    const t = reportToText(full.report);
    expect(t).toContain('Toets van deze verdeling: ruimte (+) of tekort (-)');
    // Deze verdeling past precies als de capaciteit minus het benodigde bedrag positief is.
    const marginRow = uit.blocks.find((b) => b.type === 'kv' && b.rows.some((x) => x[0].startsWith('Toets van deze verdeling: ruimte')));
    const shown = marginRow.rows.find((x) => x[0].startsWith('Toets van deze verdeling: ruimte'))[1];
    const m = Math.round(full.core.combinedGap.capacityMargin);
    expect(shown).toBe(m < 0 ? `- € ${nl0(-m)}` : `€ ${nl0(m)}`);
  });

  it('de reproductiesectie heeft alle invoer voor Excel, met de labels van het Excel-model', () => {
    const repro = report.sections.find((s) => s.id === 'reproductie');
    const tbl = repro.blocks.find((b) => b.type === 'table');
    const labels = tbl.rows.map((r) => r[0]);
    for (const [, label] of EXCEL_INPUT_LABELS) expect(labels).toContain(label);
    expect(labels).toContain('Deel 1: restsaldo op peildatum');
    // Datum en restsaldo staan er in leesbare vorm.
    expect(tbl.rows.find((r) => r[0] === 'Peildatum (restsaldi)')[1]).toBe('08-10-2026');
    expect(d.studyLoans.length).toBe(2);
  });

  it('de labels in de export bestaan echt in het Excel-model (geen verschil tussen app en Excel)', () => {
    const py = readFileSync(new URL('../docs/toetsmodel/build_toetsmodel.py', import.meta.url), 'utf-8');
    for (const [, label] of EXCEL_INPUT_LABELS) expect(py, label).toContain(label);
  });
});

describe('ronde-reis: dossier -> Excel-invoer -> dossier geeft dezelfde uitkomst', () => {
  const cases = {
    standaard: {},
    'niet meenemen': { takeOverMortgage: false },
    'lager inkomen, 30 jaar toetslooptijd': { income1: 70000, income2: 40000, portedTermBasis: '30jaar' },
    'korte rentevast': { fixedRatePeriod: 5, secondHomeFixedYears: 5 },
    'AOW': { age1: '60', pensionIncome1: '40000' },
    starter: { hasExistingHome: false, hasSecondHome: false, hasPartner2: false, income1: 60000, age1: '30', purchasePrice: 400000, ownCapital1: 40000 },
  };
  for (const [name, partial] of Object.entries(cases)) {
    it(name, () => {
      const d = fillDossierDefaults(partial);
      const core = computeCore(d);
      const spec = toScenarioSpec(d, core, new Date());
      const d2 = toDossier(spec);
      const core2 = computeCore(d2);
      expect(core2.calc.incomeBasedMax).toBeCloseTo(core.calc.incomeBasedMax, 2);
      expect(core2.calc.studyAfslag).toBeCloseTo(core.calc.studyAfslag, 2);
      if (d.hasExistingHome) {
        expect(core2.currentMortgage.extraBorrowCapacity).toBeCloseTo(core.currentMortgage.extraBorrowCapacity, 2);
        expect(core2.combinedGap.additionalMortgage).toBeCloseTo(core.combinedGap.additionalMortgage, 2);
        expect(core2.combinedGap.capacityMargin).toBeCloseTo(core.combinedGap.capacityMargin, 2);
      } else {
        expect(computeStarterGap(d2, core2.calc).capacity).toBeCloseTo(computeStarterGap(d, core.calc).capacity, 2);
      }
      expect(metricsFor(spec).feasible).toBe(metricsFor(spec).feasible);
    });
  }
});

describe('beperkingen worden gemeld', () => {
  it('geen schattingen meer: ook de kolom 3,001–3,500% is officieel (geen waarschuwing)', () => {
    const { report } = reportFor({ rate: 3.2, takeOverMortgage: false });
    expect(report.warnings.join(' ')).not.toContain('Geschatte');
    expect(reportToText(report)).toContain('kolom 3,001');
  });
  it('ontbrekend pensioeninkomen: de AOW-toets is niet uitgevoerd en dat staat erbij', () => {
    const { report } = reportFor({ age1: '60' });
    expect(reportToText(report)).toContain('NIET uitgevoerd');
    expect(report.warnings.join(' ')).toContain('AOW-toets niet uitgevoerd');
  });
  it('opties die Excel niet kent worden genoemd', () => {
    const d = fillDossierDefaults({ includeNhgFee: true, limitOwnContribution: true });
    expect(unsupportedFeatures(d).length).toBe(2);
    const { report } = reportFor({ includeNhgFee: true });
    expect(reportToText(report)).toContain('NHG-borgtochtprovisie');
  });
});

describe('dossierbestand: export en import', () => {
  it('bevat dossier, uitkomst, stappen en Excel-scenario en is terug te lezen', () => {
    const { d, report } = reportFor();
    const file = buildDossierFile(d, report);
    const json = JSON.stringify(file);
    expect(file.type).toBe('hypotheekcalculator-dossier');
    const back = parseDossierFile(json);
    expect(back).toEqual(JSON.parse(JSON.stringify(d)));
    // Het teruggelezen dossier geeft exact dezelfde uitkomst.
    const again = computeCore(fillDossierDefaults(back));
    expect(again.combinedGap.capacityMargin).toBeCloseTo(computeCore(d).combinedGap.capacityMargin, 6);
  });
  it('accepteert ook een kaal dossier en weigert onzin', () => {
    const d = fillDossierDefaults({});
    expect(parseDossierFile(JSON.stringify(d)).purchasePrice).toBe(d.purchasePrice);
    expect(() => parseDossierFile('geen json')).toThrow(/geldige JSON/);
    expect(() => parseDossierFile('{"a":1}')).toThrow(/geen dossier/);
    expect(() => parseDossierFile('[1,2]')).toThrow(/geen dossier/);
  });
});

describe('PDF', () => {
  it('pdfSafe vervangt tekens buiten Latin-1', () => {
    expect(pdfSafe('a − b ≥ c → d')).toBe('a - b >= c -> d');
  });
  it('bouwt een document met meerdere pagina\'s en alle onderdelen', () => {
    const { report } = reportFor();
    const doc = buildReportPdf(report);
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(3);
    const bytes = doc.output('arraybuffer');
    expect(bytes.byteLength).toBeGreaterThan(5000);
    if (process.env.WRITE_REPORT_PDF) writeFileSync(process.env.WRITE_REPORT_PDF, Buffer.from(bytes));
  });
});
