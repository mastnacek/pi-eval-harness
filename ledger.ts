/**
 * Global append-only score ledger for pi-eval-harness.
 *
 * One JSON line per gate run at ~/.pi/agent/eval-harness/scores.jsonl.
 * Global on purpose: motivation comes from cross-project history; the rubric
 * that defines "good work" stays per-project (.pi/eval-harness/RUBRIC.md).
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface ScoreRecord {
	at: string;
	project: string;
	rubric: string;
	verdict: "ACCEPTED" | "BLOCKED";
	score: number;
	maxScore: number;
	failed: string[];
	instantFailures: string[];
}

export const SCORES_DIR = join(homedir(), ".pi", "agent", "eval-harness");
export const SCORES_FILE = join(SCORES_DIR, "scores.jsonl");

export function appendRecord(record: ScoreRecord): void {
	try {
		if (!existsSync(SCORES_DIR)) mkdirSync(SCORES_DIR, { recursive: true });
		appendFileSync(SCORES_FILE, `${JSON.stringify(record)}\n`, "utf8");
	} catch {
		// Persistence is best-effort; the verdict is still returned to the caller.
	}
}

export function readRecords(): ScoreRecord[] {
	if (!existsSync(SCORES_FILE)) return [];
	try {
		return readFileSync(SCORES_FILE, "utf8")
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line) as ScoreRecord);
	} catch {
		return [];
	}
}
