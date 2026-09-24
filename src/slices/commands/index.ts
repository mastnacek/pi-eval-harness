/**
 * /eval command + eval_gate tool — user- and agent-facing entry points into
 * the evalgate and settings slices. Completions are delegated to the settings
 * slice (lazy menus with live-value markers).
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { EvalHarnessState } from "../../shared/state.js";
import { loadRubric, rubricToPrompt, runGate } from "../evalgate/index.js";
import { appendRecord, readRecords, type ScoreRecord } from "../evalgate/ledger.js";
import { saveConfig } from "../../shared/config.js";
import { findSetting, formatValue, parseValue, completeEvalArguments } from "../settings/index.js";
import type { GateVerdict } from "../evalgate/gate.js";

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
			persistVerdict(ctx.cwd ?? process.cwd(), rubric.name, verdict);
			return {
				content: [{ type: "text", text: formatVerdict(verdict) }],
				details: { verdict: verdict.verdict, score: verdict.score },
			};
		},
	});
}

export function registerEvalCommand(pi: ExtensionAPI, state: EvalHarnessState): void {
	pi.registerCommand("eval", {
		description: "Evaluation harness (/eval [run|card|rubric|config <get|set>|rating <on|off>])",
		getArgumentCompletions: (prefix) => completeEvalArguments(prefix, state.config),
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

			if (sub.startsWith("config")) {
				await handleConfig(state, sub, ctx);
				return;
			}

			if (sub.startsWith("rating")) {
				const mode = sub.slice(6).trim();
				if (mode === "on" || mode === "off") {
					state.config.humanRating = mode === "on";
					saveConfig(state.config);
				}
				if (ctx.hasUI) ctx.ui.notify(`Human rating: ${state.config.humanRating ? "ON" : "OFF"}`, "info");
				return;
			}

			// /eval run
			const verdict = runGate(rubric, {
				sessionText: state.sessionEvidence,
				signals: state.signalCounts,
			});
			persistVerdict(ctx.cwd ?? process.cwd(), rubric.name, verdict);
			if (ctx.hasUI) ctx.ui.notify(formatVerdict(verdict), verdict.verdict === "ACCEPTED" ? "info" : "warning");
		},
	});
}

/** /eval config get|set — driven by the settings catalogue (single source of truth). */
async function handleConfig(
	state: EvalHarnessState,
	sub: string,
	ctx: ExtensionCommandContext,
): Promise<void> {
	const parts = sub.split(/\s+/).filter(Boolean);
	const action = parts[1]?.toLowerCase();

	if (!action || action === "status" || !["get", "set"].includes(action)) {
		if (ctx.hasUI) ctx.ui.notify("Usage: /eval config get <key> | /eval config set <key> <value>", "info");
		return;
	}

	const key = parts[2];
	if (!key) {
		if (ctx.hasUI) ctx.ui.notify("Missing setting key. Try /eval config get <key>.", "warning");
		return;
	}

	const spec = findSetting(key);
	if (!spec) {
		if (ctx.hasUI) ctx.ui.notify(`Unknown setting '${key}'.`, "warning");
		return;
	}

	if (action === "get") {
		if (ctx.hasUI) ctx.ui.notify(`${key} = ${formatValue(state.config[spec.key])} (${spec.description})`, "info");
		return;
	}

	const raw = parts.slice(3).join(" ");
	if (!raw) {
		if (ctx.hasUI) ctx.ui.notify(`Missing value. /eval config set ${key} <value>`, "warning");
		return;
	}

	const parsed = parseValue(spec, raw);
	if (!parsed.ok) {
		if (ctx.hasUI) ctx.ui.notify(parsed.error ?? "Invalid value.", "error");
		return;
	}

	Object.assign(state.config, { [spec.key]: parsed.value });
	saveConfig(state.config);
	if (ctx.hasUI) ctx.ui.notify(`Saved: ${key} = ${formatValue(parsed.value)}`, "info");
}

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
