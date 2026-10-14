import { readFileSync, writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { metricsFor } from './toetsmodelBridge';

// Golden-test voor het Excel-toetsmodel (docs/toetsmodel). De scenario's staan in scenarios.json
// (zelfde invoer als in de spreadsheet); expected.json bevat wat deze engine ervoor uitrekent.
// build_toetsmodel.py zet die waarden naast de onafhankelijke Excel-formules, dus een afwijking
// in één van beide valt op. Opnieuw vastleggen na een bewuste rekenwijziging:
//   UPDATE_EXPECTED=1 npx vitest run src/toetsmodel.test.js

const DIR = new URL('../docs/toetsmodel/', import.meta.url);
const SCEN_URL = process.env.SCENARIOS_FILE ? new URL(`file://${process.env.SCENARIOS_FILE}`) : new URL('scenarios.json', DIR);
const EXP_URL = process.env.EXPECTED_FILE ? new URL(`file://${process.env.EXPECTED_FILE}`) : new URL('expected.json', DIR);
const scenarios = JSON.parse(readFileSync(SCEN_URL, 'utf-8'));

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-08T12:00:00'));
});
afterAll(() => vi.useRealTimers());

describe('Excel-toetsmodel: scenario\'s van de app-engine', () => {
  // Pas binnen de test berekenen: dan staat de vaste datum (8 okt. 2026) al, zoals de peildatum
  // in het Excel-model. Tijdens het inlezen van het bestand geldt nog de echte datum.
  if (process.env.UPDATE_EXPECTED) {
    it('legt de uitkomsten vast in expected.json', () => {
      writeFileSync(EXP_URL, JSON.stringify(scenarios.map(metricsFor), null, 1));
    });
    return;
  }

  const expected = JSON.parse(readFileSync(EXP_URL, 'utf-8'));
  it.each(scenarios.map((s, i) => [s.name, i]))('%s', (_name, i) => {
    const got = metricsFor(scenarios[i]);
    for (const [k, v] of Object.entries(expected[i])) {
      if (v === null) continue;
      expect(got[k], k).toBeCloseTo(v, 4);
    }
  });
});
