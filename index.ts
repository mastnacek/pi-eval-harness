/**
 * pi-eval-harness — evaluation, motivation, and grading harness for the Pi
 * coding agent.
 *
 * Three moving parts:
 *   1. Rubric injection ("How You're Graded"): a weighted, verifiable rubric
 *      is pushed into the agent's system prompt so RLHF-aligned models aim at
 *      high-score behavior before touching a tool.
 *   2. Deterministic gate (/eval run): criteria are verified by running
 *      commands and scanning session evidence in extension code. The agent
 *      never grades itself; only an ACCEPTED verdict closes the task.
 *   3. Report card (/eval card): per-run score, failed criteria with quoted
 *      reasons, and instant-failure hits, persisted to ~/.pi/agent/eval-harness/scores.json.
 *
 * Rubric source: `.pi/eval-harness/RUBRIC.md` in the project (human-editable,
 * JSON block inside markdown) or the built-in default.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { loadRubric, rubricToPrompt, type Rubric } from "./rubric.ts";
import { runGate, type GateVerdict } from "./gate.ts";
import { appendRecord, readRecords, type ScoreRecord } from "./ledger.ts";
import { summarize } from "./summary.ts";
import { loadConfig, saveConfig, type EvalHarnessConfig } from "./config.ts";

const SESSION_FLAG = "eval-harness-session-evidence";

/** Human quick-rating choices; pre-filled with the gate score. */
const RATING_CHOICES = ["Keep (accept)", "Over (penalize)", "Skip (no record)"] as const;

export default function evalHarnessExtension(pi: ExtensionAPI): void {
	const config: EvalHarnessConfig = loadConfig();
	const unsubscribers: Array<() => void> = [];
	const track = (result: unknown): void => {
		if (typeof result === "function") unsubscribers.push(result as () => void);
	};

	/** Rolling transcript evidence for instant-failure scanning. */
	let sessionEvidence = "";

	function persistVerdict(cwd: string, rubricName: string, verdict: GateVerdict): void {
		appendRecord({
			at: new Date().toISOString(),
			project: cwd,
			rubric: rubricName,
			verdict: verdict.verdict,
			score: verdict.score,
			maxScore: verdict.maxScore,
			failed: verdict.results.filter((r) => !r.ok).map((r) => r.id),
			instantFailures: verdict.failures.map((f) => f.id),
		});
	}

	function currentRubric(ctx: ExtensionContext): Rubric {
		return loadRubric(ctx.cwd ?? process.cwd());
	}

	// 1. Rubric injection: compact "How You're Graded" + monitor summary.
	// Notebook (Indie Dev Dan): grading section stays short bullet points;
	// context economy: the model sees ~6 lines, never the ledger or rubric JSON.
	track(
		pi.on("before_agent_start", (event, ctx) => {
			if (!event.systemPromptOptions?.promptGuidelines) return;
			const rubric = currentRubric(ctx);
			const descriptions: Record<string, string> = {};
			for (const c of rubric.criteria) descriptions[c.id] = c.description;
			for (const f of rubric.instantFailures) descriptions[f.id] = f.description;
			event.systemPromptOptions.promptGuidelines.push(summarize(descriptions));
			event.systemPromptOptions.promptGuidelines.push(rubricToPrompt(rubric));
		}),
	);

	// 2. Session evidence capture for instant-failure scanning.
	track(
		pi.on("tool_result", (event) => {
			if (!event.content || sessionEvidence.length > 400_000) return;
			for (const part of event.content) {
				if (part.type === "text") sessionEvidence += `\n${part.text}`;
			}
		}),
	);

	// 3. Tool: eval_gate — run the deterministic gate on demand.
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
			const rubric = currentRubric(ctx);
			const verdict = runGate(rubric, {
				sessionText: sessionEvidence,
				skipCommands: params.dry_run === true,
			});
			persistVerdict(ctx.cwd ?? process.cwd(), rubric.name, verdict);
			return { content: [{ type: "text", text: formatVerdict(verdict) }], details: { verdict: verdict.verdict, score: verdict.score } };
		},
	});

	// 4. Command: /eval
	pi.registerCommand("eval", {
		description: "Evaluation harness (/eval [run|card|rubric])",
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
			const rubric = currentRubric(ctx);

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
				config.humanRating = mode === "on";
				saveConfig(config);
			}
			if (ctx.hasUI) {
				ctx.ui.notify(
					`Human rating: ${config.humanRating ? "ON" : "OFF"} | Auto-gate: ${config.autoGate ? "ON" : "OFF"} | Only-when-BLOCKED: ${config.ratingOnlyWhenBlocked ? "ON" : "OFF"} | Timeout: ${config.ratingTimeoutMs}ms\nUsage: /eval rating [on|off]`,
					"info",
				);
			}
			return;
		}

		// /eval run
			const verdict = runGate(rubric, { sessionText: sessionEvidence });
			persistVerdict(ctx.cwd ?? process.cwd(), rubric.name, verdict);
			if (ctx.hasUI) ctx.ui.notify(formatVerdict(verdict), verdict.verdict === "ACCEPTED" ? "info" : "warning");
		},
	});

	// 5. Human quick-rating + optional auto-gate when the agent settles.
	// Notebook take: Dan's loop is unattended (out-of-loop) and the DoD closes work;
	// the human rating here is the in-loop signal layer — pre-filled, 1 keystroke,
	// auto-dismissing — so it motivates without babysitting the agent.
	track(
		pi.on("agent_settled", async (_event, ctx) => {
			if (!ctx.hasUI || ctx.mode !== "tui") return;
			const rubric = currentRubric(ctx);
			const verdict = runGate(rubric, { sessionText: sessionEvidence, skipCommands: !config.autoGate });
			persistVerdict(ctx.cwd ?? process.cwd(), rubric.name, verdict);

			if (!config.humanRating) return;
			if (config.ratingOnlyWhenBlocked && verdict.verdict !== "BLOCKED") return;

			try {
				const choice = await ctx.ui.select(
					`Gate: ${verdict.verdict} ${verdict.score}/${verdict.maxScore} — your rating?`,
					[...RATING_CHOICES],
					{ timeout: config.ratingTimeoutMs },
				);
				if (!choice || choice === "Skip (no record)") return;
				const over = choice === "Over (penalize)";
				appendRecord({
					at: new Date().toISOString(),
					project: ctx.cwd ?? process.cwd(),
					rubric: rubric.name,
					verdict: over ? "BLOCKED" : verdict.verdict,
					score: over ? Math.max(0, verdict.score - Math.round(verdict.maxScore * 0.25)) : verdict.score,
					maxScore: verdict.maxScore,
					failed: verdict.results.filter((r) => !r.ok).map((r) => r.id),
					instantFailures: verdict.failures.map((f) => f.id),
				});
			} catch {
				// Dialog unavailable/dismissed — gate verdict already persisted.
			}
		}),
	);

	// 6. Cleanup
	track(
		pi.on("session_shutdown", async (_event, ctx) => {
			while (unsubscribers.length > 0) {
				try {
					unsubscribers.pop()?.();
				} catch {
					// ignore
				}
			}
			sessionEvidence = "";
			try {
				if (ctx.hasUI) ctx.ui.setStatus("eval-harness", undefined);
			} catch {
				// session gone
			}
		}),
	);
}

function formatVerdict(v: GateVerdict): string {
	const lines: string[] = [];
	for (const r of v.results) {
		lines.push(`[${r.ok ? "PASS" : "FAIL"}] ${r.id} (${r.weight} pts) — ${r.reason.split("\n")[0]}`);
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

export { SESSION_FLAG };
