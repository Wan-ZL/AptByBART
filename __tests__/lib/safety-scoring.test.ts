import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  weightedScore,
  computeSafetyScores,
  computeTractEnsembleScores,
  recomputeScore,
  letterGrade,
  type AreaCrimeCounts,
} from '@/lib/safety-scoring';
import { DEFAULT_WEIGHTS, type SafetyWeights } from '@/lib/crime-taxonomy';

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

  it('area with valid population produces a numeric score in [0,1]', () => {
    const areas = new Map([
      ['a', makeCounts({ violent: 5, property: 10, population: 10000 })],
    ]);
    const result = computeSafetyScores(areas);
    const entry = result.get('a')!;
    expect(entry.score).not.toBeNull();
    expect(entry.score!).toBeGreaterThanOrEqual(0);
    expect(entry.score!).toBeLessThanOrEqual(1);
    expect(entry.confidence).toBeGreaterThan(0);
    expect(entry.confidence).toBeLessThanOrEqual(1);
  });

  it('all identical counts+population produce all identical scores', () => {
    const c = makeCounts({ violent: 5, property: 10, vehicle: 3, qualityOfLife: 2, population: 20000 });
    const areas = new Map([
      ['a', { ...c }],
      ['b', { ...c }],
      ['c', { ...c }],
    ]);
    const result = computeSafetyScores(areas);
    const scores = [...result.values()].map((v) => v.score);
    expect(new Set(scores).size).toBe(1);
  });

  it('area with highest crime rate gets score 1, lowest gets 0', () => {
    const areas = new Map([
      ['safe', makeCounts({ violent: 0, property: 0, vehicle: 0, qualityOfLife: 0, population: 10000 })],
      ['danger', makeCounts({ violent: 100, property: 100, vehicle: 100, qualityOfLife: 100, population: 10000 })],
    ]);
    const result = computeSafetyScores(areas);
    expect(result.get('safe')!.score).toBe(0);
    expect(result.get('danger')!.score).toBe(1);
  });

  it('all scores are in [0, 1] range for valid-pop areas', () => {
    const areas = new Map([
      ['a', makeCounts({ violent: 0, population: 10000 })],
      ['b', makeCounts({ violent: 1000, property: 5000, vehicle: 2000, qualityOfLife: 9999, population: 10000 })],
      ['c', makeCounts({ violent: 50, property: 20, population: 10000 })],
    ]);
    const result = computeSafetyScores(areas);
    for (const [, v] of result) {
      expect(v.score).not.toBeNull();
      expect(v.score!).toBeGreaterThanOrEqual(0);
      expect(v.score!).toBeLessThanOrEqual(1);
    }
  });

  it('NULL handling: population=0 emits score=null, confidence=0, reason=no_population', () => {
    const areas = new Map([
      ['a', makeCounts({ violent: 10, population: 0 })],
      ['b', makeCounts({ violent: 20, population: 50000 })],
    ]);
    const result = computeSafetyScores(areas);
    const a = result.get('a')!;
    expect(a.score).toBeNull();
    expect(a.percentile).toBeNull();
    expect(a.confidence).toBe(0);
    expect(a.reason).toBe('no_population');
    const b = result.get('b')!;
    expect(b.score).not.toBeNull();
  });

  it('NULL handling: population=undefined emits score=null, not a 5.0 fallback', () => {
    const areas = new Map([
      ['a', makeCounts({ violent: 10 })],
      ['b', makeCounts({ violent: 20 })],
    ]);
    const result = computeSafetyScores(areas);
    for (const [, v] of result) {
      expect(v.score).toBeNull();
      expect(v.confidence).toBe(0);
      expect(v.reason).toBeDefined();
    }
  });

  it('per-capita normalization: lower crime rate scores safer (0-1 scale, 0=safest)', () => {
    // A: 100 crimes / 100K pop; B: 50 crimes / 10K pop → B has higher rate (more dangerous)
    const areas = new Map([
      ['a', makeCounts({ violent: 100, population: 100000 })],
      ['b', makeCounts({ violent: 50, population: 10000 })],
    ]);
    const result = computeSafetyScores(areas);
    expect(result.get('a')!.score!).toBeLessThan(result.get('b')!.score!);
  });

  it('EB shrinkage: tiny-pop area with few crimes is pulled toward the global mean', () => {
    // Two large well-sampled areas define μ.
    // A small-pop area with zero crimes should NOT reach the same score
    // as a large-pop area with zero crimes — shrinkage pulls it toward μ.
    const areas = new Map([
      ['big-safe', makeCounts({ violent: 0, property: 0, population: 500000 })],
      ['big-danger', makeCounts({ violent: 500, property: 500, population: 500000 })],
      ['tiny-zero', makeCounts({ violent: 0, property: 0, population: 50 })],
    ]);
    const result = computeSafetyScores(areas);
    // On 0-1 scale (0=safest, 1=most dangerous):
    // big-safe has pop >> α, so its shrunk rate stays near its raw rate (~0) → lowest score.
    // tiny-zero has pop << α, so its shrunk rate is pulled toward μ > 0 → higher score than big-safe.
    expect(result.get('big-safe')!.score!).toBeLessThanOrEqual(result.get('tiny-zero')!.score!);
    // And tiny-zero should still be safer than big-danger (lower score).
    expect(result.get('tiny-zero')!.score!).toBeLessThan(result.get('big-danger')!.score!);
  });

  it('confidence correlates with population: bigger pop → higher confidence', () => {
    const areas = new Map([
      ['small', makeCounts({ violent: 5, population: 100 })],
      ['large', makeCounts({ violent: 5000, population: 100000 })],
    ]);
    const result = computeSafetyScores(areas);
    expect(result.get('large')!.confidence).toBeGreaterThan(result.get('small')!.confidence);
  });

  it('percentiles are in 0-100 range and safer areas get higher percentile', () => {
    const areas = new Map([
      ['safest', makeCounts({ violent: 0, property: 0, population: 10000 })],
      ['mid', makeCounts({ violent: 50, property: 50, population: 10000 })],
      ['worst', makeCounts({ violent: 100, property: 100, population: 10000 })],
    ]);
    const result = computeSafetyScores(areas);
    for (const [, v] of result) {
      expect(v.percentile!).toBeGreaterThanOrEqual(0);
      expect(v.percentile!).toBeLessThanOrEqual(100);
    }
    expect(result.get('safest')!.percentile!).toBeGreaterThan(result.get('worst')!.percentile!);
  });

  it('custom weights change the scores (0-1 scale, higher=more dangerous)', () => {
    const areas = new Map([
      ['a', makeCounts({ violent: 10, property: 100, population: 10000 })],
      ['b', makeCounts({ violent: 100, property: 10, population: 10000 })],
    ]);
    const violentFocused: SafetyWeights = { violent: 10, property: 0, vehicle: 0, qualityOfLife: 0 };
    const propertyFocused: SafetyWeights = { violent: 0, property: 10, vehicle: 0, qualityOfLife: 0 };

    const vResult = computeSafetyScores(areas, violentFocused);
    const pResult = computeSafetyScores(areas, propertyFocused);

    // Under violent weights, B (higher violent) is more dangerous → higher score
    expect(vResult.get('b')!.score!).toBeGreaterThan(vResult.get('a')!.score!);
    // Under property weights, A (higher property) is more dangerous → higher score
    expect(pResult.get('a')!.score!).toBeGreaterThan(pResult.get('b')!.score!);
  });

  it('all-zero crime everywhere: μ=0 → no_observations, score=null', () => {
    // No signal anywhere → no prior → honest no-data rather than fake neutral 5.
    const areas = new Map([
      ['a', makeCounts({ population: 10000 })],
      ['b', makeCounts({ population: 10000 })],
    ]);
    const result = computeSafetyScores(areas);
    expect(result.get('a')!.score).toBeNull();
    expect(result.get('b')!.score).toBeNull();
    expect(result.get('a')!.reason).toBe('no_observations');
  });
});

// ---------------------------------------------------------------------------
// recomputeScore
// ---------------------------------------------------------------------------

describe('recomputeScore', () => {
  it('basic computation produces a value in [0,1]', () => {
    const counts = makeCounts({ violent: 10, property: 5, population: 10000 });
    const weights = DEFAULT_WEIGHTS;
    const rate = (weightedScore(counts, weights) / counts.population!) * 10000;
    const score = recomputeScore(counts, weights, rate * 2);
    expect(score).not.toBeNull();
    expect(score!).toBeCloseTo(0.5, 1);
    expect(score!).toBeGreaterThanOrEqual(0);
    expect(score!).toBeLessThanOrEqual(1);
  });

  it('maxWeighted=0 returns null (no-data signal)', () => {
    const counts = makeCounts({ violent: 10, property: 20, population: 10000 });
    expect(recomputeScore(counts, DEFAULT_WEIGHTS, 0)).toBeNull();
  });

  it('maxWeighted negative returns null', () => {
    const counts = makeCounts({ violent: 10, population: 10000 });
    expect(recomputeScore(counts, DEFAULT_WEIGHTS, -1)).toBeNull();
  });

  it('missing population returns null, not a fabricated neutral', () => {
    const counts = makeCounts({ violent: 10 });
    expect(recomputeScore(counts, DEFAULT_WEIGHTS, 100)).toBeNull();
  });

  it('zero population returns null', () => {
    const counts = makeCounts({ violent: 10, population: 0 });
    expect(recomputeScore(counts, DEFAULT_WEIGHTS, 100)).toBeNull();
  });

  it('zero crime with positive maxWeighted returns 0 (safest)', () => {
    const counts = makeCounts({ population: 10000 });
    expect(recomputeScore(counts, DEFAULT_WEIGHTS, 100)).toBe(0);
  });

  it('counts equal to max returns score 1 (most dangerous)', () => {
    const counts = makeCounts({ violent: 10, property: 5, vehicle: 3, qualityOfLife: 2, population: 10000 });
    const maxW = (weightedScore(counts, DEFAULT_WEIGHTS) / counts.population!) * 10000;
    expect(recomputeScore(counts, DEFAULT_WEIGHTS, maxW)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// letterGrade
// ---------------------------------------------------------------------------

describe('letterGrade', () => {
  it('score <= 0.2 returns A (safest)', () => {
    expect(letterGrade(0)).toBe('A');
    expect(letterGrade(0.1)).toBe('A');
    expect(letterGrade(0.2)).toBe('A');
  });

  it('score > 0.2 but <= 0.4 returns B', () => {
    expect(letterGrade(0.21)).toBe('B');
    expect(letterGrade(0.3)).toBe('B');
    expect(letterGrade(0.4)).toBe('B');
  });

  it('score > 0.4 but <= 0.6 returns C', () => {
    expect(letterGrade(0.41)).toBe('C');
    expect(letterGrade(0.5)).toBe('C');
    expect(letterGrade(0.6)).toBe('C');
  });

  it('score > 0.6 but <= 0.8 returns D', () => {
    expect(letterGrade(0.61)).toBe('D');
    expect(letterGrade(0.7)).toBe('D');
    expect(letterGrade(0.8)).toBe('D');
  });

  it('score > 0.8 returns F (most dangerous)', () => {
    expect(letterGrade(0.81)).toBe('F');
    expect(letterGrade(0.9)).toBe('F');
    expect(letterGrade(1)).toBe('F');
  });

  it('boundary: 0.2 is A, 0.21 is B', () => {
    expect(letterGrade(0.2)).toBe('A');
    expect(letterGrade(0.21)).toBe('B');
  });
});

// ---------------------------------------------------------------------------
// computeTractEnsembleScores — equal-weight ensemble over sources, score ∈ [0,1]
// ---------------------------------------------------------------------------

describe('computeTractEnsembleScores', () => {
  it('returns empty when no source data provided', () => {
    const result = computeTractEnsembleScores(new Map());
    expect(result.size).toBe(0);
  });

  it('single source, highest rate gets score=1, lowest gets score=0', () => {
    const src = new Map<string, AreaCrimeCounts>([
      ['tract:safe', makeCounts({ population: 10000 })],
      ['tract:danger', makeCounts({ violent: 500, property: 500, vehicle: 500, qualityOfLife: 500, population: 10000 })],
    ]);
    const perSource = new Map([['datasf', src]]);
    const result = computeTractEnsembleScores(perSource);
    expect(result.get('tract:safe')!.score).toBe(0);
    expect(result.get('tract:danger')!.score).toBe(1);
  });

  it('scale inverted from legacy: higher score = more dangerous', () => {
    const src = new Map<string, AreaCrimeCounts>([
      ['a', makeCounts({ violent: 0, population: 10000 })],
      ['b', makeCounts({ violent: 10, population: 10000 })],
      ['c', makeCounts({ violent: 100, population: 10000 })],
    ]);
    const result = computeTractEnsembleScores(new Map([['s1', src]]));
    const scores = [
      result.get('a')!.score,
      result.get('b')!.score,
      result.get('c')!.score,
    ];
    expect(scores[0]).toBeLessThan(scores[1]);
    expect(scores[1]).toBeLessThan(scores[2]);
  });

  it('confidence = number of sources covering tract', () => {
    const sfData = new Map<string, AreaCrimeCounts>([
      ['tract:sf1', makeCounts({ violent: 10, population: 10000 })],
      ['tract:sf2', makeCounts({ violent: 20, population: 10000 })],
    ]);
    const dojData = new Map<string, AreaCrimeCounts>([
      ['tract:sf1', makeCounts({ violent: 5, population: 10000 })],
    ]);
    const fbiData = new Map<string, AreaCrimeCounts>([
      ['tract:sf1', makeCounts({ violent: 8, population: 10000 })],
      ['tract:sf2', makeCounts({ violent: 16, population: 10000 })],
    ]);
    const result = computeTractEnsembleScores(
      new Map([['datasf', sfData], ['ca_doj', dojData], ['fbi', fbiData]])
    );
    expect(result.get('tract:sf1')!.confidence).toBe(3);
    expect(result.get('tract:sf2')!.confidence).toBe(2);
  });

  it('ensemble is average of per-source percentile ranks', () => {
    // tract:a is middle in both sources, should score ~0.5
    const s1 = new Map<string, AreaCrimeCounts>([
      ['low', makeCounts({ violent: 0, population: 10000 })],
      ['a', makeCounts({ violent: 50, population: 10000 })],
      ['high', makeCounts({ violent: 100, population: 10000 })],
    ]);
    const s2 = new Map<string, AreaCrimeCounts>([
      ['low2', makeCounts({ violent: 0, population: 10000 })],
      ['a', makeCounts({ violent: 50, population: 10000 })],
      ['high2', makeCounts({ violent: 100, population: 10000 })],
    ]);
    const result = computeTractEnsembleScores(new Map([['s1', s1], ['s2', s2]]));
    expect(result.get('a')!.score).toBeCloseTo(0.5, 1);
    expect(result.get('a')!.confidence).toBe(2);
  });

  it('tracts covered by 0 sources are absent from result', () => {
    const src = new Map<string, AreaCrimeCounts>([
      ['tract:covered', makeCounts({ violent: 10, population: 10000 })],
    ]);
    const result = computeTractEnsembleScores(new Map([['s1', src]]));
    expect(result.has('tract:covered')).toBe(true);
    expect(result.has('tract:uncovered')).toBe(false);
  });

  it('tract with pop=0 in a source is skipped by that source', () => {
    const src = new Map<string, AreaCrimeCounts>([
      ['a', makeCounts({ violent: 10, population: 0 })],  // invalid pop
      ['b', makeCounts({ violent: 20, population: 10000 })],
      ['c', makeCounts({ violent: 0, population: 10000 })],
    ]);
    const result = computeTractEnsembleScores(new Map([['s1', src]]));
    expect(result.has('a')).toBe(false);
    expect(result.get('b')!.score).toBeGreaterThan(result.get('c')!.score);
  });

  it('all scores are in [0, 1]', () => {
    const src = new Map<string, AreaCrimeCounts>([
      ['a', makeCounts({ violent: 0, population: 10000 })],
      ['b', makeCounts({ violent: 10, property: 5, vehicle: 2, qualityOfLife: 1, population: 50000 })],
      ['c', makeCounts({ violent: 1000, property: 500, vehicle: 300, qualityOfLife: 200, population: 15000 })],
      ['d', makeCounts({ violent: 50, population: 20000 })],
    ]);
    const result = computeTractEnsembleScores(new Map([['s1', src]]));
    for (const [, r] of result) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
    }
  });

  it('preset weight change reshuffles ranks (weights applied BEFORE EB shrinkage)', () => {
    const src = new Map<string, AreaCrimeCounts>([
      ['violent-heavy', makeCounts({ violent: 100, property: 0, population: 10000 })],
      ['property-heavy', makeCounts({ violent: 0, property: 100, population: 10000 })],
    ]);
    const violentWeights: SafetyWeights = { violent: 10, property: 0, vehicle: 0, qualityOfLife: 0 };
    const propertyWeights: SafetyWeights = { violent: 0, property: 10, vehicle: 0, qualityOfLife: 0 };
    const perSource = new Map([['s1', src]]);

    const vRes = computeTractEnsembleScores(perSource, violentWeights);
    const pRes = computeTractEnsembleScores(perSource, propertyWeights);

    // Under violent weights, violent-heavy is more dangerous (higher score)
    expect(vRes.get('violent-heavy')!.score).toBeGreaterThan(vRes.get('property-heavy')!.score);
    // Under property weights, property-heavy is more dangerous
    expect(pRes.get('property-heavy')!.score).toBeGreaterThan(pRes.get('violent-heavy')!.score);
  });

  it('EB shrinkage pulls tiny-pop tract toward source mean', () => {
    // Two large well-sampled tracts define μ_s; a tiny-pop zero-crime tract
    // should not rank as safe as a large-pop zero-crime tract.
    const src = new Map<string, AreaCrimeCounts>([
      ['big-safe', makeCounts({ violent: 0, population: 500000 })],
      ['big-danger', makeCounts({ violent: 500, property: 500, population: 500000 })],
      ['tiny-zero', makeCounts({ violent: 0, property: 0, population: 50 })],
    ]);
    const result = computeTractEnsembleScores(new Map([['s1', src]]));
    // big-safe has pop >> α, raw rate near 0 → ranks safest (score near 0).
    // tiny-zero has pop << α, shrunk toward μ > 0 → score above big-safe's score.
    expect(result.get('big-safe')!.score).toBeLessThanOrEqual(result.get('tiny-zero')!.score);
    // tiny-zero still safer than big-danger
    expect(result.get('tiny-zero')!.score).toBeLessThan(result.get('big-danger')!.score);
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

  it('computeSafetyScores: non-null scores always in [0, 1], confidence in [0, 1]', () => {
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
        fc.integer({ min: 1, max: 500000 }),
        fc.integer({ min: 1, max: 500000 }),
        (v1, p1, v2, p2, ve1, q1, ve2, q2, pop1, pop2) => {
          const areas = new Map([
            ['a', makeCounts({ violent: v1, property: p1, vehicle: ve1, qualityOfLife: q1, population: pop1 })],
            ['b', makeCounts({ violent: v2, property: p2, vehicle: ve2, qualityOfLife: q2, population: pop2 })],
          ]);
          const result = computeSafetyScores(areas);
          for (const [, entry] of result) {
            expect(entry.confidence).toBeGreaterThanOrEqual(0);
            expect(entry.confidence).toBeLessThanOrEqual(1);
            if (entry.score !== null) {
              expect(entry.score).toBeGreaterThanOrEqual(0);
              expect(entry.score).toBeLessThanOrEqual(1);
              expect(entry.percentile!).toBeGreaterThanOrEqual(0);
              expect(entry.percentile!).toBeLessThanOrEqual(100);
            }
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it('recomputeScore returns null-or-[0,1] for positive maxWeighted', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 10000 }),
        fc.nat({ max: 10000 }),
        fc.nat({ max: 10000 }),
        fc.nat({ max: 10000 }),
        fc.integer({ min: 1, max: 100000 }),
        fc.integer({ min: 1, max: 500000 }),
        (v, p, ve, q, maxW, pop) => {
          const counts = makeCounts({ violent: v, property: p, vehicle: ve, qualityOfLife: q, population: pop });
          const score = recomputeScore(counts, DEFAULT_WEIGHTS, maxW);
          if (score !== null) {
            expect(score).toBeGreaterThanOrEqual(0);
            expect(score).toBeLessThanOrEqual(1);
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it('letterGrade always returns one of A/B/C/D/F for scores in [0, 1]', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        (score) => {
          const grade = letterGrade(score);
          expect(['A', 'B', 'C', 'D', 'F']).toContain(grade);
        }
      ),
      { numRuns: 200 }
    );
  });
});
