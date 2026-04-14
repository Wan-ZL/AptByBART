import type { SafetyWeights } from './crime-taxonomy';
import { DEFAULT_WEIGHTS } from './crime-taxonomy';

export interface AreaCrimeCounts {
  violent: number;
  property: number;
  vehicle: number;
  qualityOfLife: number;
  population?: number;
}

export function weightedScore(counts: AreaCrimeCounts, weights: SafetyWeights = DEFAULT_WEIGHTS): number {
  return counts.violent * weights.violent
    + counts.property * weights.property
    + counts.vehicle * weights.vehicle
    + counts.qualityOfLife * weights.qualityOfLife;
}

// Compute safety scores for all areas using per-capita rates when population is available.
// Returns Map<areaId, { score (1-10), percentile (0-100) }>
//
// When perSourceData is provided, uses per-source percentile normalization:
// each data source is ranked independently, then percentiles are averaged across sources.
// This prevents areas covered by multiple sources from appearing worse than areas with one source.
export function computeSafetyScores(
  areas: Map<string, AreaCrimeCounts>,
  weights: SafetyWeights = DEFAULT_WEIGHTS,
  perSourceData?: Map<string, Map<string, AreaCrimeCounts>>
): Map<string, { score: number; percentile: number }> {
  const result = new Map<string, { score: number; percentile: number }>();
  if (areas.size === 0) return result;

  if (perSourceData && perSourceData.size > 0) {
    return computePerSourceNormalized(areas, weights, perSourceData);
  }

  return computeAggregatedScores(areas, weights);
}

// Fallback: percentile-based scoring on aggregated counts (used client-side and when no per-source data)
function computeAggregatedScores(
  areas: Map<string, AreaCrimeCounts>,
  weights: SafetyWeights
): Map<string, { score: number; percentile: number }> {
  const result = new Map<string, { score: number; percentile: number }>();

  // Convert to per-capita rates (per 10K population) where possible
  const weighted = new Map<string, number>();
  const zeroPopIds = new Set<string>();

  for (const [id, counts] of areas) {
    const pop = counts.population;

    if (pop === 0 || pop === null || pop === undefined) {
      // Zero/missing population → neutral score
      zeroPopIds.add(id);
      weighted.set(id, 0); // placeholder, will be overridden
      continue;
    }

    const rate = {
      violent: (counts.violent / pop) * 10000,
      property: (counts.property / pop) * 10000,
      vehicle: (counts.vehicle / pop) * 10000,
      qualityOfLife: (counts.qualityOfLife / pop) * 10000,
    };

    const w = rate.violent * weights.violent
      + rate.property * weights.property
      + rate.vehicle * weights.vehicle
      + rate.qualityOfLife * weights.qualityOfLife;
    weighted.set(id, w);
  }

  // Cap outliers: for very small populations (1-100), cap weighted value at 99th percentile
  const validWeights = [...weighted.entries()]
    .filter(([id]) => !zeroPopIds.has(id))
    .map(([, w]) => w)
    .sort((a, b) => a - b);

  if (validWeights.length > 0) {
    const p99Index = Math.floor(validWeights.length * 0.99);
    const p99Value = validWeights[Math.min(p99Index, validWeights.length - 1)];

    for (const [id, counts] of areas) {
      const pop = counts.population;
      if (pop && pop > 0 && pop <= 100) {
        const currentW = weighted.get(id)!;
        if (currentW > p99Value) {
          weighted.set(id, p99Value);
        }
      }
    }
  }

  // Percentile-based scoring: rank areas by weighted value, derive score from position
  // This avoids score compression from outliers dominating max-normalization
  const validEntries = [...weighted.entries()]
    .filter(([id]) => !zeroPopIds.has(id))
    .sort((a, b) => a[1] - b[1]); // ascending: safest (lowest crime rate) first

  const total = validEntries.length;
  const entries: Array<{ id: string; score: number }> = [];

  for (let i = 0; i < total; i++) {
    const [id] = validEntries[i];
    // Position 0 (safest) → score 10, position last (worst) → score 1
    const position = total > 1 ? i / (total - 1) : 0;
    const score = Math.round((10 - position * 9) * 10) / 10;
    entries.push({ id, score });
  }

  // Add zero-pop areas with neutral score
  for (const id of zeroPopIds) {
    entries.push({ id, score: 5.0 });
  }

  // Compute percentile rank: sort ascending by score, higher percentile = safer
  entries.sort((a, b) => a.score - b.score);
  const allTotal = entries.length;
  for (let i = 0; i < allTotal; i++) {
    const percentile = Math.round(((i + 1) / allTotal) * 100);
    result.set(entries[i].id, { score: entries[i].score, percentile });
  }

  return result;
}

type CategoryKey = 'violent' | 'property' | 'vehicle' | 'qualityOfLife';
const CATEGORIES: CategoryKey[] = ['violent', 'property', 'vehicle', 'qualityOfLife'];

// Per-source percentile normalization: each source is ranked independently, then averaged
function computePerSourceNormalized(
  areas: Map<string, AreaCrimeCounts>,
  weights: SafetyWeights,
  perSourceData: Map<string, Map<string, AreaCrimeCounts>>
): Map<string, { score: number; percentile: number }> {
  const result = new Map<string, { score: number; percentile: number }>();

  // Step 1: For each source + category, compute per-capita rates and rank → percentile
  // sourcePercentiles: areaId → category → percentile[]
  const areaPercentiles = new Map<string, Map<CategoryKey, number[]>>();

  for (const [, sourceAreas] of perSourceData) {
    // For each category, compute per-capita rate for all areas in this source
    for (const cat of CATEGORIES) {
      const rateEntries: Array<{ areaId: string; rate: number }> = [];
      const zeroPopAreas: string[] = [];

      for (const [areaId, counts] of sourceAreas) {
        const pop = counts.population;
        if (!pop || pop <= 0) {
          zeroPopAreas.push(areaId);
          continue;
        }
        const rate = (counts[cat] / pop) * 10000;
        rateEntries.push({ areaId, rate });
      }

      if (rateEntries.length === 0) continue;

      // Rank ascending by rate (lowest crime rate = safest = highest percentile)
      rateEntries.sort((a, b) => a.rate - b.rate);
      const n = rateEntries.length;

      for (let i = 0; i < n; i++) {
        const { areaId } = rateEntries[i];
        // percentile: 0 = worst (highest crime), 100 = safest (lowest crime)
        const percentile = n > 1 ? ((n - 1 - i) / (n - 1)) * 100 : 50;

        if (!areaPercentiles.has(areaId)) {
          areaPercentiles.set(areaId, new Map());
        }
        const catMap = areaPercentiles.get(areaId)!;
        if (!catMap.has(cat)) catMap.set(cat, []);
        catMap.get(cat)!.push(percentile);
      }

      // Zero-pop areas get neutral percentile (50)
      for (const areaId of zeroPopAreas) {
        if (!areaPercentiles.has(areaId)) {
          areaPercentiles.set(areaId, new Map());
        }
        const catMap = areaPercentiles.get(areaId)!;
        if (!catMap.has(cat)) catMap.set(cat, []);
        catMap.get(cat)!.push(50);
      }
    }
  }

  // Step 2: For each area, average percentiles across sources, then compute weighted danger
  const zeroPopIds = new Set<string>();
  const dangerScores = new Map<string, number>();

  for (const [areaId] of areas) {
    const catMap = areaPercentiles.get(areaId);

    if (!catMap) {
      // Area not covered by any source in perSourceData — neutral
      zeroPopIds.add(areaId);
      continue;
    }

    const pop = areas.get(areaId)?.population;
    if (!pop || pop <= 0) {
      zeroPopIds.add(areaId);
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

    // weighted_danger: higher = more dangerous
    // (100 - percentile) converts "safest=100" to "danger=0"
    const weightedDanger =
      (100 - avgPercentiles.violent) * weights.violent +
      (100 - avgPercentiles.property) * weights.property +
      (100 - avgPercentiles.vehicle) * weights.vehicle +
      (100 - avgPercentiles.qualityOfLife) * weights.qualityOfLife;

    dangerScores.set(areaId, weightedDanger);
  }

  // Step 3: Rank all areas by weighted danger → final percentile-based score (1-10)
  const validEntries = [...dangerScores.entries()]
    .sort((a, b) => a[1] - b[1]); // ascending: least dangerous first

  const total = validEntries.length;
  const entries: Array<{ id: string; score: number }> = [];

  for (let i = 0; i < total; i++) {
    const [id] = validEntries[i];
    const position = total > 1 ? i / (total - 1) : 0;
    const score = Math.round((10 - position * 9) * 10) / 10;
    entries.push({ id, score });
  }

  // Add zero-pop / uncovered areas with neutral score
  for (const id of zeroPopIds) {
    entries.push({ id, score: 5.0 });
  }

  // Compute percentile rank: sort ascending by score, higher percentile = safer
  entries.sort((a, b) => a.score - b.score);
  const allTotal = entries.length;
  for (let i = 0; i < allTotal; i++) {
    const percentile = Math.round(((i + 1) / allTotal) * 100);
    result.set(entries[i].id, { score: entries[i].score, percentile });
  }

  return result;
}

// Recompute a single area's score given its counts, weights, and the max weighted score across all areas
export function recomputeScore(
  counts: AreaCrimeCounts,
  weights: SafetyWeights,
  maxWeighted: number
): number {
  const pop = counts.population;
  let w: number;
  if (pop && pop > 0) {
    const rate = {
      violent: (counts.violent / pop) * 10000,
      property: (counts.property / pop) * 10000,
      vehicle: (counts.vehicle / pop) * 10000,
      qualityOfLife: (counts.qualityOfLife / pop) * 10000,
    };
    w = rate.violent * weights.violent + rate.property * weights.property + rate.vehicle * weights.vehicle + rate.qualityOfLife * weights.qualityOfLife;
  } else if (pop === 0 || pop === null) {
    return 5; // neutral for zero/missing population
  } else {
    w = weightedScore(counts, weights);
  }
  if (maxWeighted <= 0) return 5;
  return Math.max(1, Math.min(10, Math.round((10 - (w / maxWeighted) * 9) * 10) / 10));
}

export function letterGrade(score: number): string {
  if (score >= 9) return 'A';
  if (score >= 7) return 'B';
  if (score >= 5) return 'C';
  if (score >= 3) return 'D';
  return 'F';
}
