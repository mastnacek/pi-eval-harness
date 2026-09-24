/**
 * pi-eval-harness — evaluation, motivation, and grading harness for the Pi
 * coding agent.
 *
 * Three moving parts:
 *   1. Compact monitor summary + "How You're Graded" rubric injected into the
 *      system prompt (RLHF alignment, ~6 lines, never the ledger).
 *   2. Deterministic gate (/eval run): criteria verified by running commands
 *      and scanning session evidence in extension code. The agent never
 *      grades itself; only an ACCEPTED verdict closes the task.
 *   3. Human quick-rating dialog on settle + report card (/eval card),
 *      persisted to ~/.pi/agent/eval-harness/scores.jsonl.
 *
 * Rubric source: `.pi/eval-harness/RUBRIC.md` in the project (human-editable,
 * JSON block inside markdown) or the built-in default.
 *
 * Composition root only: the extension factory lives in src/extension.ts.
 */

import evalHarnessExtension from "./src/extension.js";

export default evalHarnessExtension;
