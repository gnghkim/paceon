export interface WordDifference { kind: 'missing' | 'added'; word: string }
// Bound work and output even for a full 8,000-character transcript.
export function speechWordDifferences(reference: string, transcript: string): WordDifference[] {
  const words = (text: string) => (text.toLowerCase().match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? []).slice(0, 300);
  const a = words(reference), b = words(transcript);
  const rows = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--)
    rows[i]![j]! = a[i] === b[j] ? rows[i + 1]![j + 1]! + 1 : Math.max(rows[i + 1]![j]!, rows[i]![j + 1]!);
  const result: WordDifference[] = [];
  let i = 0, j = 0;
  while ((i < a.length || j < b.length) && result.length < 40) {
    if (i < a.length && j < b.length && a[i] === b[j]) { i++; j++; }
    else if (i < a.length && (j === b.length || rows[i + 1]![j]! >= rows[i]![j + 1]!)) result.push({ kind: 'missing', word: a[i++]! });
    else result.push({ kind: 'added', word: b[j++]! });
  }
  return result;
}
