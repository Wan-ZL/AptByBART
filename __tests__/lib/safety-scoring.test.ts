import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  weightedScore,
  computeSafetyScores,
  recomputeScore,
  letterGrade,
  type AreaCrimeCounts,
} from '@/lib/safety-scoring';
import { DEFAULT_WEIGHTS, type SafetyWeights } from '@/lib/crime-taxonomy';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCounts(overrides: Partial<AreaCrimeCounts> = {}): AreaCrimeCounts {
  return { violent: 0, property: 0, vehicle: 0, qualityOfLife: 0, ...overrides };
}

// ---------------------------------------------------------------------------
// weightedScore
// ---------------------------------------------------------------------------

describe('weightedScore', () => {
  it('computes known counts x known weights', () => {
    const counts = makeCounts({ violent: 10, property: 20, vehicle: 5, qualityOfLife: 8 });
    const weights: SafetyWeights = { violent: 3, property: 1, vehicle: 1.5, qualityOfLife: 0.5 };
    // 10*3 + 20*1 + 5*1.5 + 8*0.5 = 30 + 20 + 7.5 + 4 = 61.5
    expect(weightedScore(counts, weights)).toBeCloseTo(61.5);
  });

  it('uses DEFAULT_WEIGHTS when weights param omitted', () => {
    const counts = makeCounts({ violent: 2, property: 4, vehicle: 3, qualityOfLife: 10 });
    const expected =
      2 * DEFAULT_WEIGHTS.violent +
      4 * DEFAULT_WEIGHTS.property +
      3 * DEFAULT_WEIGHTS.vehicle +
      10 * DEFAULT_WEIGHTS.qualityOfLife;
    expect(weightedScore(counts)).toBeCloseTo(expected);
  });

  it('returns 0 for all-zero counts', () => {
    expect(weightedScore(makeCounts())).toBe(0);
  });

  it('returns 0 when all weights are 0', () => {
    const counts = makeCounts({ violent: 100, property: 200, vehicle: 50, qualityOfLife: 30 });
    const zeroWeights: SafetyWeights = { violent: 0, property: 0, vehicle: 0, qualityOfLife: 0 };
    expect(weightedScore(counts, zeroWeights)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// computeSafetyScores
// ---------------------------------------------------------------------------

describe('computeSafetyScores', () => {
  it('returns empty map for 0 areas', () => {
    const result = computeSafetyScores(new Map());
    expect(result.size).toBe(0);
  });

  it('single area returns a valid score and percentile', () => {
    const areas = new Map([['a', makeCounts({ violent: 5, property: 10 })]]);
    const result = computeSafetyScores(areas);
    expect(result.size).toBe(1);
    const entry = result.get('a')!;
    expect(entry.score).toBeGreaterThanOrEqual(1);
    expect(entry.score).toBeLessThanOrEqual(10);
    expect(entry.percentile).toBeGreaterThanOrEqual(0);
    expect(entry.percentile).toBeLessThanOrEqual(100);
    // Single area with crimes is the worst AND best — gets score 1 (max crime = score 1)
    expect(entry.score).toBe(1);
    expect(entry.percentile).toBe(100);
  });

  it('all identical counts produce all identical scores', () => {
    const c = makeCounts({ violent: 5, property: 10, vehicle: 3, qualityOfLife: 2 });
    const areas = new Map([
      ['a', { ...c }],
      ['b', { ...c }],
      ['c', { ...c }],
    ]);
    const result = computeSafetyScores(areas);
    const scores = [...result.values()].map((v) => v.score);
    expect(new Set(scores).size).toBe(1);
  });

  it('area with highest crime gets score 1, lowest gets 10', () => {
    const areas = new Map([
      ['safe', makeCounts({ violent: 0, property: 0, vehicle: 0, qualityOfLife: 0 })],
      ['danger', makeCounts({ violent: 100, property: 100, vehicle: 100, qualityOfLife: 100 })],
    ]);
    const result = computeSafetyScores(areas);
    expect(result.get('safe')!.score).toBe(10);
    expect(result.get('danger')!.score).toBe(1);
  });

  it('all scores are in [1, 10] range', () => {
    const areas = new Map([
      ['a', makeCounts({ violent: 0 })],
      ['b', makeCounts({ violent: 1000, property: 5000, vehicle: 2000, qualityOfLife: 9999 })],
      ['c', makeCounts({ violent: 50, property: 20 })],
    ]);
    const result = computeSafetyScores(areas);
    for (const [, v] of result) {
      expect(v.score).toBeGreaterThanOrEqual(1);
      expect(v.score).toBeLessThanOrEqual(10);
    }
  });

  it('population=0 falls back to raw counts (no divide by zero)', () => {
    const areas = new Map([
      ['a', makeCounts({ violent: 10, population: 0 })],
      ['b', makeCounts({ violent: 20, population: 50000 })],
    ]);
    const result = computeSafetyScores(areas);
    expect(result.size).toBe(2);
    for (const [, v] of result) {
      expect(Number.isFinite(v.score)).toBe(true);
      expect(Number.isNaN(v.score)).toBe(false);
    }
  });

  it('population=undefined falls back to raw counts', () => {
    const areas = new Map([
      ['a', makeCounts({ violent: 10 })], // population is undefined by default
      ['b', makeCounts({ violent: 20 })],
    ]);
    const result = computeSafetyScores(areas);
    expect(result.size).toBe(2);
    for (const [, v] of result) {
      expect(Number.isFinite(v.score)).toBe(true);
    }
  });

  it('per-capita normalization: lower crime rate scores safer', () => {
    // area A: 100 crimes with 100K pop = 10 per 10K
    // area B: 50 crimes with 10K pop = 50 per 10K
    // A should score BETTER (safer) than B
    const areas = new Map([
      ['a', makeCounts({ violent: 100, population: 100000 })],
      ['b', makeCounts({ violent: 50, population: 10000 })],
    ]);
    const result = computeSafetyScores(areas);
    expect(result.get('a')!.score).toBeGreaterThan(result.get('b')!.score);
  });

  it('percentiles are in 0-100 range and safer areas get higher percentile', () => {
    const areas = new Map([
      ['safest', makeCounts({ violent: 0, property: 0 })],
      ['mid', makeCounts({ violent: 50, property: 50 })],
      ['worst', makeCounts({ violent: 100, property: 100 })],
    ]);
    const result = computeSafetyScores(areas);
    for (const [, v] of result) {
      expect(v.percentile).toBeGreaterThanOrEqual(0);
      expect(v.percentile).toBeLessThanOrEqual(100);
    }
    // Safest area should have highest percentile
    expect(result.get('safest')!.percentile).toBeGreaterThan(result.get('worst')!.percentile);
  });

  it('custom weights change the scores', () => {
    const areas = new Map([
      ['a', makeCounts({ violent: 10, property: 100 })],
      ['b', makeCounts({ violent: 100, property: 10 })],
    ]);
    const violentFocused: SafetyWeights = { violent: 10, property: 0, vehicle: 0, qualityOfLife: 0 };
    const propertyFocused: SafetyWeights = { violent: 0, property: 10, vehicle: 0, qualityOfLife: 0 };

    const vResult = computeSafetyScores(areas, violentFocused);
    const pResult = computeSafetyScores(areas, propertyFocused);

    // With violent-focused weights, area B (100 violent) should be worse
    expect(vResult.get('a')!.score).toBeGreaterThan(vResult.get('b')!.score);
    // With property-focused weights, area A (100 property) should be worse
    expect(pResult.get('b')!.score).toBeGreaterThan(pResult.get('a')!.score);
  });

  it('all-zero crime areas get neutral score (5) since maxWeighted is 0', () => {
    const areas = new Map([
      ['a', makeCounts()],
      ['b', makeCounts()],
    ]);
    const result = computeSafetyScores(areas);
    expect(result.get('a')!.score).toBe(5);
    expect(result.get('b')!.score).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// recomputeScore
// ---------------------------------------------------------------------------

describe('recomputeScore', () => {
  it('basic computation matches expected formula', () => {
    const counts = makeCounts({ violent: 10, property: 5 });
    const weights = DEFAULT_WEIGHTS;
    const w = weightedScore(counts, weights);
    const maxW = w * 2; // counts are half the max
    const score = recomputeScore(counts, weights, maxW);
    // 10 - (w / (w*2)) * 9 = 10 - 4.5 = 5.5
    expect(score).toBeCloseTo(5.5, 0);
    expect(score).toBeGreaterThanOrEqual(1);
    expect(score).toBeLessThanOrEqual(10);
  });

  it('maxWeighted=0 returns neutral score 5', () => {
    const counts = makeCounts({ violent: 10, property: 20 });
    expect(recomputeScore(counts, DEFAULT_WEIGHTS, 0)).toBe(5);
  });

  it('maxWeighted negative returns neutral score 5', () => {
    const counts = makeCounts({ violent: 10 });
    expect(recomputeScore(counts, DEFAULT_WEIGHTS, -1)).toBe(5);
  });

  it('zero crime counts with positive maxWeighted returns 10', () => {
    const counts = makeCounts();
    expect(recomputeScore(counts, DEFAULT_WEIGHTS, 100)).toBe(10);
  });

  it('counts equal to max returns score 1', () => {
    const counts = makeCounts({ violent: 10, property: 5, vehicle: 3, qualityOfLife: 2 });
    const maxW = weightedScore(counts, DEFAULT_WEIGHTS);
    expect(recomputeScore(counts, DEFAULT_WEIGHTS, maxW)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// letterGrade
// ---------------------------------------------------------------------------

describe('letterGrade', () => {
  it('score >= 9 returns A', () => {
    expect(letterGrade(9)).toBe('A');
    expect(letterGrade(9.5)).toBe('A');
    expect(letterGrade(10)).toBe('A');
  });

  it('score >= 7 but < 9 returns B', () => {
    expect(letterGrade(7)).toBe('B');
    expect(letterGrade(8)).toBe('B');
    expect(letterGrade(8.999)).toBe('B');
  });

  it('score >= 5 but < 7 returns C', () => {
    expect(letterGrade(5)).toBe('C');
    expect(letterGrade(6)).toBe('C');
    expect(letterGrade(6.999)).toBe('C');
  });

  it('score >= 3 but < 5 returns D', () => {
    expect(letterGrade(3)).toBe('D');
    expect(letterGrade(4)).toBe('D');
    expect(letterGrade(4.999)).toBe('D');
  });

  it('score < 3 returns F', () => {
    expect(letterGrade(1)).toBe('F');
    expect(letterGrade(2)).toBe('F');
    expect(letterGrade(2.999)).toBe('F');
  });

  it('boundary: 8.999 is B, 9.0 is A', () => {
    expect(letterGrade(8.999)).toBe('B');
    expect(letterGrade(9.0)).toBe('A');
  });
});

// ---------------------------------------------------------------------------
// Property-based tests
// ---------------------------------------------------------------------------

describe('safety-scoring property-based tests', () => {
  it('weightedScore is always non-negative for non-negative inputs', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 10000 }),
        fc.nat({ max: 10000 }),
        fc.nat({ max: 10000 }),
        fc.nat({ max: 10000 }),
        (v, p, ve, q) => {
          const counts = makeCounts({ violent: v, property: p, vehicle: ve, qualityOfLife: q });
          expect(weightedScore(counts)).toBeGreaterThanOrEqual(0);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('computeSafetyScores always produces scores in [1, 10]', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 5000 }),
        fc.nat({ max: 5000 }),
        fc.nat({ max: 5000 }),
        fc.nat({ max: 5000 }),
        fc.nat({ max: 5000 }),
        fc.nat({ max: 5000 }),
        fc.nat({ max: 5000 }),
        fc.nat({ max: 5000 }),
        (v1, p1, v2, p2, ve1, q1, ve2, q2) => {
          const areas = new Map([
            ['a', makeCounts({ violent: v1, property: p1, vehicle: ve1, qualityOfLife: q1 })],
            ['b', makeCounts({ violent: v2, property: p2, vehicle: ve2, qualityOfLife: q2 })],
          ]);
          const result = computeSafetyScores(areas);
          for (const [, entry] of result) {
            expect(entry.score).toBeGreaterThanOrEqual(1);
            expect(entry.score).toBeLessThanOrEqual(10);
            expect(entry.percentile).toBeGreaterThanOrEqual(0);
            expect(entry.percentile).toBeLessThanOrEqual(100);
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it('recomputeScore always produces scores in [1, 10] for positive maxWeighted', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 10000 }),
        fc.nat({ max: 10000 }),
        fc.nat({ max: 10000 }),
        fc.nat({ max: 10000 }),
        fc.integer({ min: 1, max: 100000 }),
        (v, p, ve, q, maxW) => {
          const counts = makeCounts({ violent: v, property: p, vehicle: ve, qualityOfLife: q });
          const score = recomputeScore(counts, DEFAULT_WEIGHTS, maxW);
          expect(score).toBeGreaterThanOrEqual(1);
          expect(score).toBeLessThanOrEqual(10);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('letterGrade always returns one of A/B/C/D/F for scores in [1, 10]', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 10, noNaN: true }),
        (score) => {
          const grade = letterGrade(score);
          expect(['A', 'B', 'C', 'D', 'F']).toContain(grade);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('higher weighted score implies lower safety score (monotonicity)', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 1000 }),
        fc.nat({ max: 1000 }),
        fc.nat({ max: 1000 }),
        fc.nat({ max: 1000 }),
        fc.integer({ min: 1, max: 1000 }),
        (v, p, ve, q, extra) => {
          const countsLow = makeCounts({ violent: v, property: p, vehicle: ve, qualityOfLife: q });
          const countsHigh = makeCounts({
            violent: v + extra,
            property: p,
            vehicle: ve,
            qualityOfLife: q,
          });
          const maxW = weightedScore(countsHigh, DEFAULT_WEIGHTS) * 2;
          if (maxW <= 0) return; // skip degenerate case
          const scoreLow = recomputeScore(countsLow, DEFAULT_WEIGHTS, maxW);
          const scoreHigh = recomputeScore(countsHigh, DEFAULT_WEIGHTS, maxW);
          // More crime -> lower or equal safety score
          expect(scoreLow).toBeGreaterThanOrEqual(scoreHigh);
        }
      ),
      { numRuns: 200 }
    );
  });
});
