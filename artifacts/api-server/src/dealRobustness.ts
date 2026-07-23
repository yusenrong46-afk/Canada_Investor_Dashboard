import { ROBUSTNESS_DRAWS, type DealRobustness } from "@vvl/shared";

export { ROBUSTNESS_DRAWS };

// Fixed seed keeps the simulation reproducible: identical requests must return identical robustness numbers.
const ROBUSTNESS_SEED = 0x5eed2026;

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

// Inverse-CDF triangular sample; a zero-width interval collapses to the mode instead of inventing a spread.
function sampleTriangular(low: number, mode: number, high: number, u: number): number {
  if (!(high > low)) {
    return mode;
  }
  const peak = Math.min(Math.max(mode, low), high);
  const cut = (peak - low) / (high - low);
  if (u < cut) {
    return low + Math.sqrt(u * (high - low) * (peak - low));
  }
  return high - Math.sqrt((1 - u) * (high - low) * (high - peak));
}

function percentile(sortedValues: number[], q: number): number {
  const position = (sortedValues.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) {
    return sortedValues[lower];
  }
  return sortedValues[lower] + (sortedValues[upper] - sortedValues[lower]) * (position - lower);
}

function roundProbability(value: number): number {
  return Number(value.toFixed(3));
}

export interface DealRobustnessInputs {
  askingPrice: number;
  baseValue: number;
  confidenceLow: number;
  confidenceHigh: number;
  afterPlanValue: number;
  /** Null when the deal calculus had no target price (e.g. the plan came back data-missing). */
  targetPrice?: number | null;
  /** Observed uplift band in dollars when the scenario reported one; omitted bands stay zero-width. */
  upliftConfidenceLow?: number | null;
  upliftConfidenceHigh?: number | null;
  /** Renovation work cost deducted from every upside draw. */
  plannedSpend?: number;
}

// Propagates the calibrated estimate band and uplift range through the same cost-aware arithmetic
// as the point estimate: after-plan value minus asking price and planned renovation spend.
export function computeDealRobustness(inputs: DealRobustnessInputs): DealRobustness {
  const upliftPoint = inputs.afterPlanValue - inputs.baseValue;
  const upliftLow = inputs.upliftConfidenceLow;
  const upliftHigh = inputs.upliftConfidenceHigh;
  const hasUpliftBand = upliftLow != null && upliftHigh != null;
  const random = mulberry32(ROBUSTNESS_SEED);
  const upsides: number[] = [];
  let positiveUpside = 0;
  let targetHits = 0;

  for (let draw = 0; draw < ROBUSTNESS_DRAWS; draw += 1) {
    const currentValueDraw = sampleTriangular(inputs.confidenceLow, inputs.baseValue, inputs.confidenceHigh, random());
    const upliftDraw = hasUpliftBand ? sampleTriangular(upliftLow, upliftPoint, upliftHigh, random()) : upliftPoint;
    const afterPlanDraw = currentValueDraw + upliftDraw;
    const upside = afterPlanDraw - inputs.askingPrice - (inputs.plannedSpend ?? 0);
    upsides.push(upside);
    if (upside > 0) {
      positiveUpside += 1;
    }
    if (inputs.targetPrice != null && afterPlanDraw >= inputs.targetPrice) {
      targetHits += 1;
    }
  }

  upsides.sort((left, right) => left - right);

  return {
    method: "seeded-triangular-stress-test",
    draws: ROBUSTNESS_DRAWS,
    positiveUpsideShare: roundProbability(positiveUpside / ROBUSTNESS_DRAWS),
    targetAchievableShare: inputs.targetPrice != null ? roundProbability(targetHits / ROBUSTNESS_DRAWS) : null,
    upsideP10: Math.round(percentile(upsides, 0.1)),
    upsideP50: Math.round(percentile(upsides, 0.5)),
    upsideP90: Math.round(percentile(upsides, 0.9)),
    note: "Illustrative seeded triangular stress test over the estimate band and observed uplift range, net of planned renovation spend. Scenario shares are not calibrated probabilities and exclude transaction, financing, tax, and carrying costs.",
  };
}
