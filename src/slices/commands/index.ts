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
		description: "Evaluation harness (/eval [run|card|rubric|status|rating <on|off>|<setting> <val>])",
		getArgumentCompletions: (prefix) => completeEvalArguments(prefix, state.config),
		handler: async (args, ctx) => {
			const tokens = args.trim().split(/\s+/).filter(Boolean);
			const isGlobal = tokens.some((t) => t.toLowerCase() === "--global");
			const cleanTokens = tokens.filter((t) => t.toLowerCase() !== "--global");

			const sub = (cleanTokens[0] ?? "").toLowerCase() || "run";
			const rest = cleanTokens.slice(1);
			const rawValue = rest.join(" ").trim();
			const rubric = loadRubric(ctx.cwd ?? process.cwd());

			if (sub === "rubric") {
				if (ctx.hasUI) ctx.ui.notify(rubricToPrompt(rubric), "info");
				return;
			}

			if (sub === "card") {
				if (ctx.hasUI) ctx.ui.notify(readScoreSummary(), "info");
				return;
			}

			if (sub === "status") {
				const lines = [
					"⚙️ [pi-eval-harness — Stav konfigurace]:",
					`- humanRating: ${state.config.humanRating ? "true (ZAPNUTO)" : "false (VYPNUTO)"}`,
					`- autoGate: ${state.config.autoGate ? "true (ZAPNUTO)" : "false (VYPNUTO)"}`,
					`- ratingOnlyWhenBlocked: ${state.config.ratingOnlyWhenBlocked ? "true (ZAPNUTO)" : "false (VYPNUTO)"}`,
					`- ratingTimeoutMs: ${state.config.ratingTimeoutMs} ms`,
					"",
					"Tip: Použijte `/eval <nastavení> <hodnota>` pro změnu v projektu, nebo přidejte `--global` pro trvalé uložení.",
				];
				if (ctx.hasUI) ctx.ui.notify(lines.join("\n"), "info");
				return;
			}

			if (sub === "help" || sub === "-h" || sub === "--help") {
				const help = [
					"# /eval — Evaluation harness",
					"",
					"Příkazy:",
					"  /eval run                         — Spustit deterministický eval gate",
					"  /eval card                        — Posledních 10 záznamů hodnocení",
					"  /eval rubric                      — Zobrazit aktivní rubriku projektu",
					"  /eval status                      — Zobrazit konfiguraci a hodnoty",
					"  /eval rating [on|off]             — Přepnout rychlé hodnocení uživatelem",
					"  /eval <nastavení> [hodnota]       — Přímé zobrazení nebo nastavení volby",
					"  /eval --global <nastavení> <hodn> — Uložit nastavení globálně (~/.pi/agent/)",
					"",
					"Nastavení: autoGate, ratingOnlyWhenBlocked, humanRating, ratingTimeoutMs",
				].join("\n");
				if (ctx.hasUI) ctx.ui.notify(help, "info");
				return;
			}

			// Shortcut: /eval rating [on|off]
			if (sub === "rating") {
				if (rawValue === "on" || rawValue === "true") {
					state.config.humanRating = true;
					saveConfig(state.config, isGlobal, ctx.cwd);
					if (ctx.hasUI) ctx.ui.notify(`Human rating: ON (${isGlobal ? "globálně" : "projekt"})`, "info");
					return;
				}
				if (rawValue === "off" || rawValue === "false") {
					state.config.humanRating = false;
					saveConfig(state.config, isGlobal, ctx.cwd);
					if (ctx.hasUI) ctx.ui.notify(`Human rating: OFF (${isGlobal ? "globálně" : "projekt"})`, "info");
					return;
				}
				if (ctx.hasUI) {
					ctx.ui.notify(`Human rating: ${state.config.humanRating ? "ON" : "OFF"}. Použij: /eval rating on|off`, "info");
				}
				return;
			}

			// Direct setting access: /eval <setting> [value]
			const directSpec = findSetting(sub);
			if (directSpec) {
				if (!rawValue) {
					if (ctx.hasUI) {
						ctx.ui.notify(`${directSpec.key} = ${formatValue(state.config[directSpec.key])} (${directSpec.description})`, "info");
					}
					return;
				}

				const parsed = parseValue(directSpec, rawValue);
				if (!parsed.ok) {
					if (ctx.hasUI) ctx.ui.notify(parsed.error ?? "Neplatná hodnota.", "error");
					return;
				}

				Object.assign(state.config, { [directSpec.key]: parsed.value });
				saveConfig(state.config, isGlobal, ctx.cwd);
				if (ctx.hasUI) {
					ctx.ui.notify(`Uloženo (${isGlobal ? "globálně" : "projekt"}): ${directSpec.key} = ${formatValue(parsed.value)}`, "info");
				}
				return;
			}

			// Legacy compatibility: /eval config get|set
			if (sub === "config") {
				await handleConfig(state, cleanTokens.slice(1), isGlobal, ctx);
				return;
			}

			// Default: /eval run
			const verdict = runGate(rubric, {
				sessionText: state.sessionEvidence,
				signals: state.signalCounts,
			});
			persistVerdict(ctx.cwd ?? process.cwd(), rubric.name, verdict);
			if (ctx.hasUI) ctx.ui.notify(formatVerdict(verdict), verdict.verdict === "ACCEPTED" ? "info" : "warning");
		},
	});
}

/** Legacy /eval config get|set — kept for backward compatibility. */
async function handleConfig(
	state: EvalHarnessState,
	parts: string[],
	isGlobal: boolean,
	ctx: ExtensionCommandContext,
): Promise<void> {
	const action = parts[0]?.toLowerCase();

	if (!action || !["get", "set"].includes(action)) {
		if (ctx.hasUI) ctx.ui.notify("Použití: /eval <nastavení> <hodnota> (nebo zastaralé /eval config get|set)", "info");
		return;
	}

	const key = parts[1];
	if (!key) {
		if (ctx.hasUI) ctx.ui.notify("Chybí klíč nastavení. Zkuste: /eval status", "warning");
		return;
	}

	const spec = findSetting(key);
	if (!spec) {
		if (ctx.hasUI) ctx.ui.notify(`Neznámé nastavení '${key}'.`, "warning");
		return;
	}

	if (action === "get") {
		if (ctx.hasUI) ctx.ui.notify(`${key} = ${formatValue(state.config[spec.key])} (${spec.description})`, "info");
		return;
	}

	const raw = parts.slice(2).join(" ");
	if (!raw) {
		if (ctx.hasUI) ctx.ui.notify(`Chybí hodnota: /eval ${key} <hodnota>`, "warning");
		return;
	}

	const parsed = parseValue(spec, raw);
	if (!parsed.ok) {
		if (ctx.hasUI) ctx.ui.notify(parsed.error ?? "Neplatná hodnota.", "error");
		return;
	}

	Object.assign(state.config, { [spec.key]: parsed.value });
	saveConfig(state.config, isGlobal, ctx.cwd);
	if (ctx.hasUI) ctx.ui.notify(`Uloženo (${isGlobal ? "globálně" : "projekt"}): ${key} = ${formatValue(parsed.value)}`, "info");
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