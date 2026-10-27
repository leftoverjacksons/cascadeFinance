// Suggests a rule pattern from a bank description, e.g.
//   "PUBLIX SUPER MAR 3695 C  ATLANTA GA"  -> "PUBLIX SUPER MAR"
//   "SQ *JUST ADD HONEY T  102426"         -> "JUST ADD HONEY"
//   "AMAZON.COM*752GY6RQ3"                 -> "AMAZON.COM"
// The user can always edit the suggestion before saving.

// Payment-processor prefixes that precede the actual merchant name.
const PROCESSOR_PREFIX = /^(SQ|TST|SP|PY|PP|PAYPAL|LS|IN|DD|DOORDASH|UBER|SQU)\s*\*\s*/i;

export function suggestPattern(raw: string): string {
  // Bank descriptions are fixed-width: the merchant comes first and is
  // separated from city/state by a run of spaces.
  let s = raw.trim().split(/\s{2,}/)[0];
  s = s.replace(PROCESSOR_PREFIX, '');
  // Cut at the first '*' (order ids) after the merchant.
  s = s.split('*')[0].trim();

  const words: string[] = [];
  for (const word of s.split(' ')) {
    // Stop at store numbers, references, phone numbers and similar.
    if (/[0-9#]/.test(word) && words.length > 0) break;
    if (/^[0-9#]/.test(word)) break;
    words.push(word);
    if (words.length === 3) break;
  }
  const result = words.join(' ').replace(/[\s\-–/&,.:]+$/, '');
  return result.length >= 3 ? result : s.slice(0, 30).trim();
}
