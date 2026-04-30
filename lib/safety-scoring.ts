import type { SafetyWeights } from './crime-taxonomy';
import { DEFAULT_WEIGHTS } from './crime-taxonomy';

export interface AreaCrimeCounts {
  violent: number;
  property: number;
  vehicle: number;
  qualityOfLife: number;
  population?: number;
}

export interface SafetyScoreResult {
  score: number | null;
  percentile: number | null;
  confidence: number;
  reason?: 'no_population' | 'no_observations';
}

// Result for the equal-weight ensemble path (tracts only).
// score is on the 0..1 scale: 0 = safest, 1 = most dangerous.
// confidence is the count of sources that cover this tract.
export interface TractEnsembleResult {
  score: number;
  confidence: number;
}

// α: empirical-Bayes prior strength. Interpreted as "pseudo-population" added to
// every area. 1000 ≈ small-block scale; large enough to tame zero/low-pop noise,
// small enough that well-sampled tracts (pop >> 1000) are barely shrunk.
const EB_ALPHA = 1000;

export function weightedScore(counts: AreaCrimeCounts, weights: SafetyWeights = DEFAULT_WEIGHTS): number {
  return counts.violent * weights.violent
    + counts.property * weights.property
    + counts.vehicle * weights.vehicle
    + counts.qualityOfLife * weights.qualityOfLife;
}

function totalIncidents(counts: AreaCrimeCounts): number {
  return counts.violent + counts.property + counts.vehicle + counts.qualityOfLife;
}

function hasValidPopulation(counts: AreaCrimeCounts): boolean {
  const pop = counts.population;
  return typeof pop === 'number' && pop > 0;
}

// Global μ: per-capita weighted crime rate across all areas with valid pop>0,
// pooled (sum of weighted incidents / sum of population). Pooled (vs. simple mean)
// avoids letting a tiny-pop outlier dominate the prior.
function computeGlobalMu(
  areas: Map<string, AreaCrimeCounts>,
  weights: SafetyWeights
): number {
  let incidentSum = 0;
  let popSum = 0;
  for (const [, counts] of areas) {
    if (!hasValidPopulation(counts)) continue;
    incidentSum += weightedScore(counts, weights);
    popSum += counts.population!;
  }
  return popSum > 0 ? incidentSum / popSum : 0;
}

// Equal-weight ensemble score for tracts (CLAUDE.md "Safety System").
//
// For each source s:
//   weighted_count(s, t) = Σ_cat  weight_cat * count(s, t, cat)
//   μ_s = Σ_t weighted_count(s, t) / Σ_t pop(t)   (pop-weighted, over t covered by s)
//   shrunk_rate(s, t) = (weighted_count + α·μ_s) / (pop + α)
//   rank(s, t)        = percentile_rank of shrunk_rate within s's coverage
//                        0 = lowest rate (safest), 1 = highest rate (most dangerous)
//
// For each tract t covered by >= 1 source:
//   final_score(t) = mean over s covering t of rank(s, t)
//   confidence(t)  = number of sources covering t
//
// Tracts without any covering source return no result (caller skips them).
// Tracts with pop<=0 are excluded from source-level ranking (they can't have a rate).
export function computeTractEnsembleScores(
  perSourceTractData: Map<string, Map<string, AreaCrimeCounts>>,
  weights: SafetyWeights = DEFAULT_WEIGHTS
): Map<string, TractEnsembleResult> {
  // For each source, collect per-tract rank into this accumulator.
  const rankSum = new Map<string, number>();
  const rankCount = new Map<string, number>();

  for (const [, sourceTracts] of perSourceTractData) {
    // Pop-weighted μ within this source's coverage.
    let incidentSum = 0;
    let popSum = 0;
    for (const [, counts] of sourceTracts) {
      if (!hasValidPopulation(counts)) continue;
      incidentSum += weightedScore(counts, weights);
      popSum += counts.population!;
    }
    const mu = popSum > 0 ? incidentSum / popSum : 0;

    // Compute shrunk rate per tract for this source.
    const rates: Array<{ tractId: string; rate: number }> = [];
    for (const [tractId, counts] of sourceTracts) {
      if (!hasValidPopulation(counts)) continue;
      const weighted = weightedScore(counts, weights);
      const rate = (weighted + EB_ALPHA * mu) / (counts.population! + EB_ALPHA);
      rates.push({ tractId, rate });
    }
    if (rates.length === 0) continue;

    // Percentile-rank within this source. 0 = lowest rate = safest; 1 = highest = dangerous.
    rates.sort((a, b) => a.rate - b.rate);
    const n = rates.length;
    for (let i = 0; i < n; i++) {
      // Tie-aware lower-rank: all tracts sharing the same rate get the rank of the first tied index.
      let rankStart = i;
      while (rankStart > 0 && rates[rankStart - 1].rate === rates[i].rate) rankStart--;
      const rank = n > 1 ? rankStart / (n - 1) : 0;
      const tractId = rates[i].tractId;
      rankSum.set(tractId, (rankSum.get(tractId) ?? 0) + rank);
      rankCount.set(tractId, (rankCount.get(tractId) ?? 0) + 1);
    }
  }

  const result = new Map<string, TractEnsembleResult>();
  for (const [tractId, cnt] of rankCount) {
    const sum = rankSum.get(tractId)!;
    result.set(tractId, { score: sum / cnt, confidence: cnt });
  }
  return result;
}

// Compute safety scores for all areas using per-capita rates when population is available.
// Returns Map<areaId, SafetyScoreResult>.
//
// Score scale: 0 = safest, 1 = most dangerous (unified with the tract ensemble path
// in computeTractEnsembleScores). Legacy 1-10 outputs were migrated in-place via
// scripts/migrate-scores-to-01-scale.ts; this function now emits 0-1 natively.
//
// Areas without valid population OR without any incident observations return
// { score: null, percentile: null, confidence: 0, reason: 'no_data' } — consumers
// use score===null to render "no data" rather than a misleading neutral midpoint.
//
// When perSourceData is provided, uses per-source percentile normalization:
// each data source is ranked independently, then percentiles are averaged across sources.
export function computeSafetyScores(
  areas: Map<string, AreaCrimeCounts>,
  weights: SafetyWeights = DEFAULT_WEIGHTS,
  perSourceData?: Map<string, Map<string, AreaCrimeCounts>>
): Map<string, SafetyScoreResult> {
  const result = new Map<string, SafetyScoreResult>();
  if (areas.size === 0) return result;

  if (perSourceData && perSourceData.size > 0) {
    return computePerSourceNormalized(areas, weights, perSourceData);
  }

  return computeAggregatedScores(areas, weights);
}

function computeAggregatedScores(
  areas: Map<string, AreaCrimeCounts>,
  weights: SafetyWeights
): Map<string, SafetyScoreResult> {
  const result = new Map<string, SafetyScoreResult>();

  const mu = computeGlobalMu(areas, weights);
  const shrunk = new Map<string, number>();
  const noData = new Map<string, 'no_population' | 'no_observations'>();

  for (const [id, counts] of areas) {
    if (!hasValidPopulation(counts)) {
      noData.set(id, 'no_population');
      continue;
    }
    if (totalIncidents(counts) === 0 && mu === 0) {
      // Nothing observed anywhere: cannot form a prior, mark as no-data.
      noData.set(id, 'no_observations');
      continue;
    }
    const pop = counts.population!;
    const rawIncidents = weightedScore(counts, weights);
    // shrunk_rate = (incidents + α·μ) / (pop + α)
    const rate = (rawIncidents + EB_ALPHA * mu) / (pop + EB_ALPHA);
    shrunk.set(id, rate);
  }

  const validEntries = [...shrunk.entries()].sort((a, b) => a[1] - b[1]);
  const total = validEntries.length;

  // Tie-aware ranking: areas with identical shrunk rates receive identical scores.
  // position is already 0 = safest (lowest rate) -> 1 = most dangerous (highest rate),
  // which matches the unified 0-1 output convention.
  for (let i = 0; i < total; i++) {
    const [id, rate] = validEntries[i];
    let rankStart = i;
    while (rankStart > 0 && validEntries[rankStart - 1][1] === rate) rankStart--;
    const position = total > 1 ? rankStart / (total - 1) : 0;
    const score = Math.round(position * 1000) / 1000;
    const percentile = total > 1 ? Math.round(((total - rankStart) / total) * 100) : 100;
    const pop = areas.get(id)!.population!;
    const confidence = pop / (pop + EB_ALPHA);
    result.set(id, { score, percentile, confidence });
  }

  for (const [id, reason] of noData) {
    result.set(id, { score: null, percentile: null, confidence: 0, reason });
  }

  return result;
}

type CategoryKey = 'violent' | 'property' | 'vehicle' | 'qualityOfLife';
const CATEGORIES: CategoryKey[] = ['violent', 'property', 'vehicle', 'qualityOfLife'];

function computePerSourceNormalized(
  areas: Map<string, AreaCrimeCounts>,
  weights: SafetyWeights,
  perSourceData: Map<string, Map<string, AreaCrimeCounts>>
): Map<string, SafetyScoreResult> {
  const result = new Map<string, SafetyScoreResult>();
  const areaPercentiles = new Map<string, Map<CategoryKey, number[]>>();

  // Global μ per category, pooled across all sources' valid-pop areas.
  const muByCat: Record<CategoryKey, number> = { violent: 0, property: 0, vehicle: 0, qualityOfLife: 0 };
  for (const cat of CATEGORIES) {
    let inc = 0;
    let pop = 0;
    for (const [, sourceAreas] of perSourceData) {
      for (const [, counts] of sourceAreas) {
        if (!hasValidPopulation(counts)) continue;
        inc += counts[cat];
        pop += counts.population!;
      }
    }
    muByCat[cat] = pop > 0 ? inc / pop : 0;
  }

  for (const [, sourceAreas] of perSourceData) {
    for (const cat of CATEGORIES) {
      const rateEntries: Array<{ areaId: string; rate: number }> = [];

      for (const [areaId, counts] of sourceAreas) {
        if (!hasValidPopulation(counts)) continue;
        const pop = counts.population!;
        // EB-shrunk per-category rate
        const rate = (counts[cat] + EB_ALPHA * muByCat[cat]) / (pop + EB_ALPHA);
        rateEntries.push({ areaId, rate });
      }

      if (rateEntries.length === 0) continue;

      rateEntries.sort((a, b) => a.rate - b.rate);
      const n = rateEntries.length;

      for (let i = 0; i < n; i++) {
        const { areaId } = rateEntries[i];
        const percentile = n > 1 ? ((n - 1 - i) / (n - 1)) * 100 : 50;

        if (!areaPercentiles.has(areaId)) {
          areaPercentiles.set(areaId, new Map());
        }
        const catMap = areaPercentiles.get(areaId)!;
        if (!catMap.has(cat)) catMap.set(cat, []);
        catMap.get(cat)!.push(percentile);
      }
    }
  }

  const noData = new Map<string, 'no_population' | 'no_observations'>();
  const dangerScores = new Map<string, number>();

  for (const [areaId, counts] of areas) {
    if (!hasValidPopulation(counts)) {
      noData.set(areaId, 'no_population');
      continue;
    }
    const catMap = areaPercentiles.get(areaId);
    if (!catMap || catMap.size === 0) {
      noData.set(areaId, 'no_observations');
      continue;
    }

    const avgPercentiles: Record<CategoryKey, number> = {
      violent: 50, property: 50, vehicle: 50, qualityOfLife: 50,
    };

    for (const cat of CATEGORIES) {
      const pcts = catMap.get(cat);
      if (pcts && pcts.length > 0) {
        avgPercentiles[cat] = pcts.reduce((a, b) => a + b, 0) / pcts.length;
      }
    }

    const weightedDanger =
      (100 - avgPercentiles.violent) * weights.violent +
      (100 - avgPercentiles.property) * weights.property +
      (100 - avgPercentiles.vehicle) * weights.vehicle +
      (100 - avgPercentiles.qualityOfLife) * weights.qualityOfLife;

    dangerScores.set(areaId, weightedDanger);
  }

  const validEntries = [...dangerScores.entries()].sort((a, b) => a[1] - b[1]);
  const total = validEntries.length;

  // position is already 0 = safest (lowest danger) -> 1 = most dangerous,
  // matching the unified 0-1 output convention.
  for (let i = 0; i < total; i++) {
    const [id, danger] = validEntries[i];
    let rankStart = i;
    while (rankStart > 0 && validEntries[rankStart - 1][1] === danger) rankStart--;
    const position = total > 1 ? rankStart / (total - 1) : 0;
    const score = Math.round(position * 1000) / 1000;
    const percentile = total > 1 ? Math.round(((total - rankStart) / total) * 100) : 100;
    const pop = areas.get(id)!.population!;
    const confidence = pop / (pop + EB_ALPHA);
    result.set(id, { score, percentile, confidence });
  }

  for (const [id, reason] of noData) {
    result.set(id, {
      score: null,
      percentile: null,
      confidence: 0,
      reason: reason === 'no_population' ? 'no_population' : 'no_observations',
    });
  }

  return result;
}

// Recompute a single area's score given its counts, weights, and the max weighted score across all areas.
// Returns null when the area has no valid population (honest no-data signal).
// Output scale: 0 = safest, 1 = most dangerous (unified with computeSafetyScores).
export function recomputeScore(
  counts: AreaCrimeCounts,
  weights: SafetyWeights,
  maxWeighted: number
): number | null {
  if (!hasValidPopulation(counts)) return null;
  if (maxWeighted <= 0) return null;

  const pop = counts.population!;
  const rawIncidents = weightedScore(counts, weights);
  // Per-capita rate (no global μ available in single-area recompute, so no shrinkage)
  const w = (rawIncidents / pop) * 10000;

  // w/maxWeighted ∈ [0,1]: 0 = no crime (safest), 1 = max observed (most dangerous).
  const ratio = Math.max(0, Math.min(1, w / maxWeighted));
  return Math.round(ratio * 1000) / 1000;
}

export function letterGrade(score: number): string {
  if (score <= 0.2) return 'A';
  if (score <= 0.4) return 'B';
  if (score <= 0.6) return 'C';
  if (score <= 0.8) return 'D';
  return 'F';
}
