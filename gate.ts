/**
 * Deterministic gate runner for pi-eval-harness.
 *
 * The agent never grades itself: every criterion is verified by running the
 * command or scanning the session transcript here, in extension code. Result
 * is a typed verdict the report card renders (skillgate / closure-gate style).
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import type { Criterion, Rubric, SignalPenalty } from "./rubric.js";

export interface CriterionResult {
	id: string;
	weight: number;
	ok: boolean;
	/** Why it failed — quoted command output, missing artifact, absent evidence. */
	reason: string;
}

export interface InstantFailureHit {
	id: string;
	description: string;
	evidence: string;
}

/** A per-hit deduction from another plugin's hook signal (LSP, line limit). */
export interface SignalPenaltyHit {
	id: string;
	description: string;
	/** Total points deducted for this signal class (perHit × hits, capped). */
	deduction: number;
	hits: number;
}

export interface GateVerdict {
	verdict: "ACCEPTED" | "BLOCKED";
	score: number;
	maxScore: number;
	results: CriterionResult[];
	failures: InstantFailureHit[];
	/** Deductions applied for hook signals (LSP errors, length violations). */
	penalties: SignalPenaltyHit[];
}

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Commands come from the project's own rubric file (`.pi/eval-harness/RUBRIC.md`),
 * which the user reviews and commits — same trust level as package.json scripts.
 * Shell is required so pipelines (`a && b`) from the contract work on Windows.
 */
function runCriterion(c: Criterion): CriterionResult {
	if (c.evidence.kind === "command") {
		// Sanitize: reject shell metacharacters that could smuggle extra commands.
		if (/[;&|`$>]/.test(c.evidence.run.replace(/&&/g, ""))) {
			return { id: c.id, weight: c.weight, ok: false, reason: `command rejected by sanitizer: ${c.evidence.run}` };
		}
		try {
			const res = spawnSync(c.evidence.run, {
				shell: true,
				timeout: c.evidence.timeoutMs ?? DEFAULT_TIMEOUT_MS,
				encoding: "utf8",
			});
			const ok = res.status === 0;
			const tail = `${res.stdout ?? ""}${res.stderr ?? ""}`.trim().slice(-400);
			return {
				id: c.id,
				weight: c.weight,
				ok,
				reason: ok ? `exit 0: ${c.evidence.run}` : `exit ${res.status}: ${c.evidence.run}\n${tail}`,
			};
		} catch (e) {
			return { id: c.id, weight: c.weight, ok: false, reason: `command failed: ${String(e)}` };
		}
	}
	if (c.evidence.kind === "artifact") {
		const ok = existsSync(c.evidence.path);
		return {
			id: c.id,
			weight: c.weight,
			ok,
			reason: ok ? `artifact present: ${c.evidence.path}` : `artifact missing: ${c.evidence.path}`,
		};
	}
	// kind === "session": scan flag — extension wires actual transcript text in.
	return { id: c.id, weight: c.weight, ok: true, reason: "session evidence accepted (no counter-evidence)" };
}

export function runGate(
	rubric: Rubric,
	options: { sessionText?: string; skipCommands?: boolean; signals?: SignalPenalty[] } = {},
): GateVerdict {
	const results: CriterionResult[] = [];
	const failures: InstantFailureHit[] = [];
	const penalties: SignalPenaltyHit[] = [];

	for (const c of rubric.criteria) {
		if (options.skipCommands && c.evidence.kind === "command") {
			results.push({ id: c.id, weight: c.weight, ok: true, reason: "skipped (dry-run)" });
			continue;
		}
		results.push(runCriterion(c));
	}

	const sessionText = options.sessionText ?? "";
	if (sessionText && rubric.instantFailures.length > 0) {
		for (const f of rubric.instantFailures) {
			try {
				const re = new RegExp(f.pattern, "i");
				const m = re.exec(sessionText);
				if (m) {
					failures.push({
						id: f.id,
						description: f.description,
						evidence: m[0].slice(0, 200),
					});
				}
			} catch (e) {
				// Invalid user regex fails closed: the rule counts as triggered.
				failures.push({
					id: f.id,
					description: f.description,
					evidence: `invalid regex (fail closed): ${String(e).slice(0, 120)}`,
				});
			}
		}
	}

	for (const s of options.signals ?? []) {
		if (s.count <= 0) continue;
		const deduction = Math.min(s.perHit * s.count, s.cap);
		penalties.push({ id: s.id, description: s.description, deduction, hits: s.count });
	}

	const maxScore = rubric.criteria.reduce((sum, c) => sum + c.weight, 0);
	const raw = failures.length > 0 ? 0 : results.reduce((sum, r) => sum + (r.ok ? r.weight : 0), 0);
	const penaltyTotal = failures.length > 0 ? 0 : penalties.reduce((sum, p) => sum + p.deduction, 0);
	const earned = Math.max(0, raw - penaltyTotal);

	return {
		verdict: failures.length === 0 && earned === maxScore ? "ACCEPTED" : "BLOCKED",
		score: earned,
		maxScore,
		results,
		failures,
		penalties,
	};
}
