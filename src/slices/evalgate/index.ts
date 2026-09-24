/**
 * EvalGate slice — the deterministic grading gate. Barrel module: rubric
 * loading/parsing, gate execution, and the global score ledger.
 */

export { loadRubric, rubricToPrompt, signalPenaltyCatalog, extractJsonBlock, parseRubric, DEFAULT_RUBRIC, type Rubric, type Criterion, type InstantFailure, type SignalPenalty } from "./rubric.js";
export { runGate, type GateVerdict, type CriterionResult, type InstantFailureHit, type SignalPenaltyHit } from "./gate.js";
export { appendRecord, readRecords, SCORES_FILE, type ScoreRecord } from "./ledger.js";
