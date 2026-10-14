import { describe, expect, it } from 'vitest';
import { getBox3GrossUp, getIncomeRow, getToetsrenteBand, getWoonquote } from './nibud2026';

const getRateColumn = (rate) => getToetsrenteBand(rate).index;

// Verwachte waarden letterlijk overgenomen uit Stcrt. 2025, 36471 (Bijlage 1), los van de
// gegenereerde tabelmodule.
describe('financieringslastpercentages 2026: exacte opzoeking', () => {
  it.each([
    // [toetsinkomen, toetsrente, verwacht %]
    [30000, 4.0, 20.1],
    [95000, 5.0, 27.8], // AFM-toetsrente: kolom 4,501–5,000%
    [95999, 5.0, 27.8], // zelfde rij tot de volgende € 1.000
    [96000, 5.0, 27.9],
    [75000, 4.0, 24.6],
    [233000, 4.0, 27.4], // boven de laatste rij: rij € 125.000
    [125000, 3.5, 26.5],
    [20000, 3.0, 18.4], // onder € 30.000: eerste rij
    [62000, 1.0, 17.8],
    [110000, 7.5, 31.5],
  ])('Tabel 1: %i bij %f%% → %f%%', (income, rate, pct) => {
    expect(getWoonquote(income, rate)).toBeCloseTo(pct / 100, 10);
  });

  it('geen interpolatie tussen rentekolommen: 3,6% valt in 3,501–4,000%', () => {
    expect(getWoonquote(125000, 3.6)).toBeCloseTo(0.274, 10);
    expect(getWoonquote(125000, 3.5)).toBeCloseTo(0.265, 10);
  });

  it('kolomgrenzen: 1,500 / 1,501 / 4,000 / 4,001 / 6,500 / 6,501', () => {
    expect(getRateColumn(1.5)).toBe(0);
    expect(getRateColumn(1.501)).toBe(1);
    expect(getRateColumn(4.0)).toBe(5);
    expect(getRateColumn(4.001)).toBe(6);
    expect(getRateColumn(6.5)).toBe(10);
    expect(getRateColumn(6.501)).toBe(11);
    expect(getRateColumn(9)).toBe(11);
    expect(getRateColumn(0)).toBe(0);
  });

  it('rij: naar beneden afgerond op € 1.000 en begrensd op de tabel', () => {
    expect(getIncomeRow(95999)).toBe(95000);
    expect(getIncomeRow(10000)).toBe(30000);
    expect(getIncomeRow(500000)).toBe(125000);
    expect(getIncomeRow(500000, { aow: true })).toBe(110000);
    expect(getIncomeRow(20000, { aow: true })).toBe(29000);
  });

  it('Tabel 2 (AOW), Tabel 3 en 4 (box 3)', () => {
    expect(getWoonquote(110000, 7, { aow: true })).toBeCloseTo(0.417, 10);
    expect(getWoonquote(29000, 1.0, { aow: true })).toBeCloseTo(0.185, 10);
    expect(getWoonquote(125000, 3.5, { box3: true })).toBeCloseTo(0.223, 10);
    expect(getWoonquote(125000, 7, { box3: true })).toBeCloseTo(0.24, 10);
    expect(getWoonquote(110000, 7, { aow: true, box3: true })).toBeCloseTo(0.306, 10);
  });

  it('bruteringsfactor box 3 = Tabel 1 ÷ Tabel 3 in dezelfde rij en kolom', () => {
    expect(getBox3GrossUp(233000, 4.0)).toBeCloseTo(0.274 / 0.226, 10);
    expect(getBox3GrossUp(110000, 7, { aow: true })).toBeCloseTo(0.417 / 0.306, 10);
  });
});
