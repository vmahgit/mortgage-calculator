import { describe, expect, it } from 'vitest';
import { editableDisplay, formatThousandsDisplay, parseDisplayInput } from './numberInput';

// Simuleert het veld: de state is de interne tekst, tijdens het typen toont het veld editableDisplay(state)
// en elke toetsaanslag leest parseDisplayInput van de nieuwe tekst.
function type(state, edit) {
  const shown = editableDisplay(state);
  return parseDisplayInput(edit(shown));
}

describe('bedragen typen', () => {
  it('parseert Nederlandse notatie', () => {
    expect(parseDisplayInput('13.803,67')).toBe('13803.67');
    expect(parseDisplayInput('1.380.367')).toBe('1380367');
    expect(parseDisplayInput('142')).toBe('142');
    expect(parseDisplayInput('')).toBe('');
    expect(parseDisplayInput('€ 2.995')).toBe('2995');
    expect(parseDisplayInput('1,5')).toBe('1.5');
  });

  it('een decimaalpunt met 1 of 2 cijfers is een decimaal (geplakt bedrag), anders een duizendtal', () => {
    expect(parseDisplayInput('13803.67')).toBe('13803.67');
    expect(parseDisplayInput('13803.6')).toBe('13803.6');
    expect(parseDisplayInput('1.380')).toBe('1380');
    expect(parseDisplayInput('269.480')).toBe('269480');
  });

  it('REGRESSIE: een bedrag met decimalen blijft heel als u erin bewerkt (13803,67 werd 1.380.367)', () => {
    let state = '13803.67';
    expect(editableDisplay(state)).toBe('13803,67');
    // Een cijfer toevoegen, verwijderen en een cijfer wijzigen midden in het bedrag.
    state = type(state, (t) => t + '1');
    expect(state).toBe('13803.671');
    state = type('13803.67', (t) => t.slice(0, -1));
    expect(state).toBe('13803.6');
    state = type('13803.67', (t) => t.replace('3,6', '3,9'));
    expect(state).toBe('13803.97');
    state = type('13803.67', (t) => '9' + t);
    expect(Number(state)).toBeCloseTo(913803.67, 2);
  });

  it('typen van links naar rechts: elke tussenstand blijft zoals getypt', () => {
    let state = '';
    for (const ch of '13803,67') {
      state = type(state, (t) => t + ch);
    }
    expect(state).toBe('13803.67');
    // Tussenstand met een afsluitende komma blijft behouden.
    expect(type('13803', (t) => t + ',')).toBe('13803.');
    expect(editableDisplay('13803.')).toBe('13803,');
  });

  it('formatteert voor weergave met duizendtallen en decimaalkomma', () => {
    expect(formatThousandsDisplay('13803.67')).toBe('13.803,67');
    expect(formatThousandsDisplay('1380367')).toBe('1.380.367');
    expect(formatThousandsDisplay('')).toBe('');
  });
});
