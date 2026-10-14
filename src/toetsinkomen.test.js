import { describe, expect, it } from 'vitest';
import { getToetsinkomen } from './toetsinkomen';

describe('toetsinkomen', () => {
  it('vaste 13e maand telt volledig, een gemiddelde bonus voor bonusWeight (Woonnu zonder NHG: 50%)', () => {
    const woonnu = getToetsinkomen({ income: 100000, thirteenthMonth: 8000, avgBonus: 4050, bonusWeight: 0.5 });
    expect(woonnu.structural).toBe(8000 + 2025);
    expect(woonnu.toetsinkomen).toBe(110025);
    const algemeen = getToetsinkomen({ income: 100000, thirteenthMonth: 8000, avgBonus: 4050 });
    expect(algemeen.toetsinkomen).toBe(112050);
  });

  it('betaalde partneralimentatie gaat van het toetsinkomen af', () => {
    expect(getToetsinkomen({ income: 60000, alimonyMonthly: 500 }).toetsinkomen).toBe(54000);
  });
});
