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

import { mkdirSync, appendFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { loadRubric, rubricToPrompt, type Rubric } from "./rubric.ts";
import { runGate, type GateVerdict } from "./gate.ts";

const SCORES_FILE = join(homedir(), ".pi", "agent", "eval-harness", "scores.json");
const SESSION_FLAG = "eval-harness-session-evidence";

export default function evalHarnessExtension(pi: ExtensionAPI): void {
	const unsubscribers: Array<() => void> = [];
	const track = (result: unknown): void => {
		if (typeof result === "function") unsubscribers.push(result as () => void);
	};

	/** Rolling transcript evidence for instant-failure scanning. */
	let sessionEvidence = "";

	function persistVerdict(cwd: string, rubricName: string, verdict: GateVerdict): void {
		try {
			mkdirSync(join(SCORES_FILE, ".."), { recursive: true });
			const record = {
				at: new Date().toISOString(),
				project: cwd,
				rubric: rubricName,
				verdict: verdict.verdict,
				score: verdict.score,
				maxScore: verdict.maxScore,
				failed: verdict.results.filter((r) => !r.ok).map((r) => r.id),
				instantFailures: verdict.failures.map((f) => f.id),
			};
			appendFileSync(SCORES_FILE, `${JSON.stringify(record)}\n`, "utf8");
		} catch {
			// Score persistence is best-effort; grading verdict still returned.
		}
	}

	function currentRubric(ctx: ExtensionContext): Rubric {
		return loadRubric(ctx.cwd ?? process.cwd());
	}

	// 1. Rubric injection: "How You're Graded" in the system prompt.
	track(
		pi.on("before_agent_start", (event, ctx) => {
			if (!event.systemPromptOptions?.promptGuidelines) return;
			const rubric = currentRubric(ctx);
			event.systemPromptOptions.promptGuidelines.push(rubricToPrompt(rubric));
			event.systemPromptOptions.promptGuidelines.push(
				"GRADING CONTRACT: your self-assessment is not accepted. Run /eval-gate (or ask the user to) before declaring any task done; " +
					"only an ACCEPTED verdict closes work. Instant-failure rules void the whole run.",
			);
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
			];
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

			// /eval run
			const verdict = runGate(rubric, { sessionText: sessionEvidence });
			persistVerdict(ctx.cwd ?? process.cwd(), rubric.name, verdict);
			if (ctx.hasUI) ctx.ui.notify(formatVerdict(verdict), verdict.verdict === "ACCEPTED" ? "info" : "warning");
		},
	});

	// 5. Cleanup
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
	});
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
	if (!existsSync(SCORES_FILE)) return "No evaluations recorded yet. Run /eval run first.";
	try {
		const lines = require("node:fs").readFileSync(SCORES_FILE, "utf8").trim().split("\n");
		const last = lines.slice(-10).map((l: string) => JSON.parse(l) as { at: string; project: string; score: number; maxScore: number; verdict: string });
		return last
			.map((r: { at: string; project: string; score: number; maxScore: number; verdict: string }) =>
				`${r.at.slice(0, 16)}  ${r.verdict.padEnd(8)}  ${r.score}/${r.maxScore}  ${r.project.split(/[\\/]/).pop()}`,
			)
			.join("\n");
	} catch {
		return "Score file unreadable.";
	}
}

export { SESSION_FLAG };
