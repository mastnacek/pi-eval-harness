/**
 * /eval command + eval_gate tool — user- and agent-facing entry points into
 * the evalgate slice. Completions follow the Trailing Space Contract
 * (rating is non-terminal).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { EvalHarnessState } from "../../shared/state.js";
import { loadRubric, rubricToPrompt, runGate } from "../evalgate/index.js";
import { appendRecord, readRecords } from "../evalgate/ledger.js";
import { saveConfig } from "../../shared/config.js";
import type { GateVerdict, ScoreRecord } from "../evalgate/index.js";

export function registerEvalGateTool(pi: ExtensionAPI, state: EvalHarnessState): void {
	pi.registerTool({
		name: "eval_gate",
		label: "Evaluation Gate",
		description:
			"Run the deterministic grading gate for this project. Verifies every rubric criterion (test commands, artifacts, session evidence) " +
			"and returns a typed ACCEPTED/BLOCKED verdict with score. Only an ACCEPTED verdict closes a task; self-assessment is not accepted.",
		parameters: Type.Object({
			dry_run: Type.Optional(
				Type.Boolean({
					description: "Skip shell commands; only scan session evidence. Use for a preview.",
				}),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const rubric = loadRubric(ctx.cwd ?? process.cwd());
			const verdict = runGate(rubric, {
				sessionText: state.sessionEvidence,
				skipCommands: params.dry_run === true,
				signals: state.signalCounts,
			});
			appendRecord({
				at: new Date().toISOString(),
				project: ctx.cwd ?? process.cwd(),
				rubric: rubric.name,
				verdict: verdict.verdict,
				score: verdict.score,
				maxScore: verdict.maxScore,
				failed: verdict.results.filter((r) => !r.ok).map((r) => r.id),
				instantFailures: verdict.failures.map((f) => f.id),
			});
			return {
				content: [{ type: "text", text: formatVerdict(verdict) }],
				details: { verdict: verdict.verdict, score: verdict.score },
			};
		},
	});
}

export function registerEvalCommand(pi: ExtensionAPI, state: EvalHarnessState): void {
	pi.registerCommand("eval", {
		description: "Evaluation harness (/eval [run|card|rubric|rating <on|off>])",
		getArgumentCompletions: (prefix) => {
			const subcmds = [
				{ label: "run", value: "run" },
				{ label: "card", value: "card" },
				{ label: "rubric", value: "rubric" },
				{ label: "rating", value: "rating " },
			];
			if (prefix.startsWith("rating ")) {
				return [
					{ label: "on", value: "rating on" },
					{ label: "off", value: "rating off" },
				];
			}
			return subcmds.filter((s) => s.label.startsWith(prefix));
		},
		handler: async (args, ctx) => {
			const sub = args.trim() || "run";
			const rubric = loadRubric(ctx.cwd ?? process.cwd());

			if (sub === "rubric") {
				if (ctx.hasUI) ctx.ui.notify(rubricToPrompt(rubric), "info");
				return;
			}

			if (sub === "card") {
				if (ctx.hasUI) ctx.ui.notify(readScoreSummary(), "info");
				return;
			}

			if (sub.startsWith("rating")) {
				const mode = sub.slice(6).trim();
				if (mode === "on" || mode === "off") {
					state.config.humanRating = mode === "on";
					saveConfig(state.config);
				}
				if (ctx.hasUI) {
					ctx.ui.notify(
						`Human rating: ${state.config.humanRating ? "ON" : "OFF"} | Auto-gate: ${state.config.autoGate ? "ON" : "OFF"} | Only-when-BLOCKED: ${state.config.ratingOnlyWhenBlocked ? "ON" : "OFF"} | Timeout: ${state.config.ratingTimeoutMs}ms\nUsage: /eval rating [on|off]`,
						"info",
					);
				}
				return;
			}

			// /eval run
			const verdict = runGate(rubric, {
				sessionText: state.sessionEvidence,
				signals: state.signalCounts,
			});
			appendRecord({
				at: new Date().toISOString(),
				project: ctx.cwd ?? process.cwd(),
				rubric: rubric.name,
				verdict: verdict.verdict,
				score: verdict.score,
				maxScore: verdict.maxScore,
				failed: verdict.results.filter((r) => !r.ok).map((r) => r.id),
				instantFailures: verdict.failures.map((f) => f.id),
			});
			if (ctx.hasUI) ctx.ui.notify(formatVerdict(verdict), verdict.verdict === "ACCEPTED" ? "info" : "warning");
		},
	});
}

function formatVerdict(v: GateVerdict): string {
	const lines: string[] = [];
	for (const r of v.results) {
		lines.push(`[${r.ok ? "PASS" : "FAIL"}] ${r.id} (${r.weight} pts) — ${r.reason.split("\n")[0]}`);
	}
	for (const p of v.penalties) {
		lines.push(`[PENALTY] ${p.id} ×${p.hits} (-${p.deduction} pts) — ${p.description}`);
	}
	for (const f of v.failures) {
		lines.push(`[INSTANT-FAIL] ${f.id}: ${f.description} — evidence: "${f.evidence}"`);
	}
	lines.push(`VERDICT: ${v.verdict} (${v.score}/${v.maxScore} pts)`);
	return lines.join("\n");
}

function readScoreSummary(): string {
	const records = readRecords();
	if (records.length === 0) return "No evaluations recorded yet. Run /eval run first.";
	return records
		.slice(-10)
		.map(
			(r: ScoreRecord) =>
				`${r.at.slice(0, 16)}  ${r.verdict.padEnd(8)}  ${r.score}/${r.maxScore}  ${r.project.split(/[\\/]/).pop()}`,
		)
		.join("\n");
}
