// Bedragen typen in Nederlandse notatie: punt = duizendtal, komma = decimaal. De waarde in de state is
// een gewone tekst met een decimaalpunt ("13803.67"); tijdens het typen tonen we die met een komma,
// zodat elke toetsaanslag dezelfde tekst terugleest die erin staat. (Voorheen toonde het veld
// "13803.67" en las een bewerking de punt als duizendtal: 13803.67 werd 1380367.)

// Opgemaakte weergave als het veld niet actief is: "13.803,67".
export function formatThousandsDisplay(value) {
  const raw = String(value ?? '').trim();
  if (raw === '' || raw === '-') return raw;
  const num = parseFloat(raw.replace(',', '.'));
  if (isNaN(num)) return raw;
  const [intPartRaw, decimalPart] = raw.replace(',', '.').split('.');
  const intNum = parseInt(intPartRaw, 10);
  const intFormatted = isNaN(intNum)
    ? intPartRaw
    : intNum.toLocaleString('nl-NL', { maximumFractionDigits: 0 });
  return decimalPart !== undefined ? `${intFormatted},${decimalPart}` : intFormatted;
}

// Weergave tijdens het typen: ongegroepeerd, met decimaalkomma ("13803,67").
export function editableDisplay(value) {
  return String(value ?? '').replace('.', ',');
}

// Leest wat de gebruiker typt en geeft de interne tekst terug (decimaalpunt, zonder duizendtallen).
export function parseDisplayInput(str) {
  if (str === '' || str == null) return '';
  const s = String(str).replace(/[^0-9.,]/g, '');
  if (s.includes(',')) {
    // Komma = decimaal; punten ervoor zijn duizendtallen.
    const i = s.indexOf(',');
    const intPart = s.slice(0, i).replace(/\./g, '');
    const decPart = s.slice(i + 1).replace(/[.,]/g, '');
    return `${intPart}.${decPart}`;
  }
  // Zonder komma: één punt met 1 of 2 cijfers erachter is een decimaalpunt ("13803.67", zoals in veel
  // geplakte bedragen); anders zijn punten duizendtallen ("1.380" of "1.380.000").
  if (/^\d+\.\d{1,2}$/.test(s)) return s;
  return s.replace(/\./g, '');
}
