interface NameMatchResult {
  score: number;
  match: 'exact' | 'high' | 'medium' | 'low' | 'none';
}

const MIN_TOKEN_SIMILARITY = 0.75;
const MISSING_TOKEN_PENALTY = 0.9;

const tokenize = (name: string): string[] =>
  name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[']/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

const levenshteinDistance = (left: string, right: string): number => {
  if (left === right) return 0;
  if (left.length === 0) return right.length;
  if (right.length === 0) return left.length;

  let previousRow = Array.from(
    { length: right.length + 1 },
    (_, index) => index,
  );

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex++) {
    const currentRow = [leftIndex];

    for (let rightIndex = 1; rightIndex <= right.length; rightIndex++) {
      const substitutionCost =
        left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;

      currentRow[rightIndex] = Math.min(
        currentRow[rightIndex - 1] + 1,
        previousRow[rightIndex] + 1,
        previousRow[rightIndex - 1] + substitutionCost,
      );
    }

    previousRow = currentRow;
  }

  return previousRow[right.length];
};

const tokenSimilarity = (left: string, right: string): number => {
  if (left === right) return 1;

  // Bank account names sometimes contain an initial instead of a full name.
  if (
    (left.length === 1 && right.startsWith(left)) ||
    (right.length === 1 && left.startsWith(right))
  ) {
    return 1;
  }

  const longestLength = Math.max(left.length, right.length);
  return 1 - levenshteinDistance(left, right) / longestLength;
};

const alignTokens = (leftTokens: string[], rightTokens: string[]): number[] => {
  const [shorterTokens, longerTokens] =
    leftTokens.length <= rightTokens.length
      ? [leftTokens, rightTokens]
      : [rightTokens, leftTokens];
  let bestScores: number[] = [];
  let bestTotal = -1;

  const visit = (
    tokenIndex: number,
    usedLongerIndexes: Set<number>,
    scores: number[],
    total: number,
  ) => {
    if (tokenIndex === shorterTokens.length) {
      if (total > bestTotal) {
        bestTotal = total;
        bestScores = [...scores];
      }
      return;
    }

    for (let index = 0; index < longerTokens.length; index++) {
      if (usedLongerIndexes.has(index)) continue;

      const similarity = tokenSimilarity(
        shorterTokens[tokenIndex],
        longerTokens[index],
      );
      usedLongerIndexes.add(index);
      scores.push(similarity);
      visit(tokenIndex + 1, usedLongerIndexes, scores, total + similarity);
      scores.pop();
      usedLongerIndexes.delete(index);
    }
  };

  visit(0, new Set<number>(), [], 0);
  return bestScores;
};

const normalizedName = (tokens: string[]): string =>
  [...tokens].sort().join(' ');

const getMatchLevel = (
  score: number,
): 'high' | 'medium' | 'low' | 'none' => {
  if (score >= 80) return 'high';
  if (score >= 60) return 'medium';
  if (score >= 40) return 'low';
  return 'none';
};

export class NameMatcher {
  /**
   * Compare two names using token-aligned Levenshtein similarity.
   * Word order is ignored and one omitted name receives only a small penalty.
   */
  static compare(name1: string, name2: string): NameMatchResult {
    if (!name1 || !name2) {
      return { score: 0, match: 'none' };
    }

    const tokens1 = tokenize(name1);
    const tokens2 = tokenize(name2);
    if (tokens1.length === 0 || tokens2.length === 0) {
      return { score: 0, match: 'none' };
    }

    if (normalizedName(tokens1) === normalizedName(tokens2)) {
      return { score: 100, match: 'exact' };
    }

    const scores = alignTokens(tokens1, tokens2);
    const averageSimilarity =
      scores.reduce((total, score) => total + score, 0) / scores.length;
    const tokenCountDifference = Math.abs(tokens1.length - tokens2.length);
    const coveragePenalty =
      tokenCountDifference === 0
        ? 1
        : tokenCountDifference === 1
          ? MISSING_TOKEN_PENALTY
          : Math.min(tokens1.length, tokens2.length) /
            Math.max(tokens1.length, tokens2.length);
    const score = Math.round(averageSimilarity * coveragePenalty * 100);

    return { score, match: getMatchLevel(score) };
  }
}

export const isAcceptableAccountName = (
  accountName: string,
  profileName: string,
): boolean => {
  const accountTokens = tokenize(accountName);
  const profileTokens = tokenize(profileName);

  // A single shared name is not enough to establish account ownership.
  if (Math.min(accountTokens.length, profileTokens.length) < 2) return false;
  if (Math.abs(accountTokens.length - profileTokens.length) > 1) return false;

  const tokenScores = alignTokens(accountTokens, profileTokens);
  if (tokenScores.some((score) => score < MIN_TOKEN_SIMILARITY)) return false;

  const result = NameMatcher.compare(accountName, profileName);
  return result.match === 'exact' || result.match === 'high';
};
