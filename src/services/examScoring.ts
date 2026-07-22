export type MatchingAnswer = number[] | Record<number, number>;

export function normalizeMatchingAnswer(
  answer: unknown,
  pairCount: number,
): number[] {
  const source = Array.isArray(answer) ? answer : (answer ?? {});

  return Array.from({ length: pairCount }, (_, index) => {
    const value = Array.isArray(source) ? source[index] : (source as Record<number, unknown>)[index];
    return Number.isInteger(Number(value)) ? Number(value) : -1;
  });
}

export function isMatchingAnswerCorrect(answer: unknown, pairs: unknown): boolean {
  if (!Array.isArray(pairs) || pairs.length === 0) return false;

  const normalized = normalizeMatchingAnswer(answer, pairs.length);
  return normalized.length === pairs.length && normalized.every((value, index) => value === index);
}
