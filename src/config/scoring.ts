export const SCORING_WEIGHTS = {
  ambiguity: 0.35,
  timingSafety: 0.25,
  timeliness: 0.20,
  volumePotential: 0.20,
} as const;

export const THRESHOLDS = {
  minimumScore: 5.0,
  timingSafetyFloor: 4,
  passingScore: 6.0,
  maxIterations: 3,
} as const;
