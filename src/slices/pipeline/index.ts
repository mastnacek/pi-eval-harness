/**
 * Pipeline — translates Pi lifecycle events into slice operations:
 * prompt injection (rubric + monitor summary), evidence capture, signal
 * recording from other plugins' hook output, and the settle-time gate +
 * human quick-rating dialog.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { EvalHarnessState } from "../../shared/state.js";
import { loadRubric, rubricToPrompt, runGate } from "../evalgate/index.js";
import { summarize } from "../summary/index.js";
import { appendRecord } from "../evalgate/ledger.js";
import type { GateVerdict } from "../evalgate/gate.js";

/** Human quick-rating choices; pre-filled with the gate score. */
export const RATING_CHOICES = ["Keep (accept)", "Over (penalize)", "Skip (no record)"] as const;

export function registerPipeline(pi: ExtensionAPI, state: EvalHarnessState): void {
	// 1. Rubric injection: compact "How You're Graded" + monitor summary.
	// Notebook (Indie Dev Dan): grading section stays short bullet points;
	// context economy: the model sees ~6 lines, never the ledger or rubric JSON.
	state.track(
		pi.on("before_agent_start", (event, ctx) => {
			if (!event.systemPromptOptions?.promptGuidelines) return;
			const rubric = loadRubric(ctx.cwd ?? process.cwd());
			const descriptions: Record<string, string> = {};
			for (const c of rubric.criteria) descriptions[c.id] = c.description;
			for (const f of rubric.instantFailures) descriptions[f.id] = f.description;
			event.systemPromptOptions.promptGuidelines.push(summarize(descriptions));
			event.systemPromptOptions.promptGuidelines.push(rubricToPrompt(rubric));
			// Scope convention (Dan: instant failure if deliverables leave the working dir):
			// stay on the files/folders the user named; no curiosity wanderings.
			event.systemPromptOptions.promptGuidelines.push(
				"SCOPE CONVENTION: work only on the files and folders the user named or that the task directly requires. " +
					"Do not explore, refactor or fix anything else out of curiosity. " +
					"Temp files are fine. If you cause an error, stop and report it immediately.",
			);
		}),
	);

	// 2. Session evidence capture + hook-signal recording.
	state.track(
		pi.on("tool_result", (event) => {
			if (!event.content || state.sessionEvidence.length > 400_000) return;
			for (const part of event.content) {
				if (part.type === "text" && part.text) {
					state.sessionEvidence += `\n${part.text}`;
					captureHookSignals(state, part.text);
				}
			}
		}),
	);

	// 3. Human quick-rating + optional auto-gate when the agent settles.
	// Notebook take: Dan's loop is unattended (out-of-loop) and the DoD closes
	// work; the human rating here is the in-loop signal layer — pre-filled,
	// 1 keystroke, auto-dismissing — so it motivates without babysitting.
	state.track(
		pi.on("agent_settled", async (_event, ctx) => {
			if (!ctx.hasUI || ctx.mode !== "tui") return;
			const rubric = loadRubric(ctx.cwd ?? process.cwd());
			const verdict = runGate(rubric, {
				sessionText: state.sessionEvidence,
				skipCommands: !state.config.autoGate,
				signals: state.signalCounts,
			});
			persistVerdict(ctx, rubric.name, verdict);

			if (!state.config.humanRating) return;
			if (state.config.ratingOnlyWhenBlocked && verdict.verdict !== "BLOCKED") return;

			try {
				const choice = await ctx.ui.select(
					`Gate: ${verdict.verdict} ${verdict.score}/${verdict.maxScore} — your rating?`,
					[...RATING_CHOICES],
					{ timeout: state.config.ratingTimeoutMs },
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
}

function persistVerdict(ctx: ExtensionContext, rubricName: string, verdict: GateVerdict): void {
	appendRecord({
		at: new Date().toISOString(),
		project: ctx.cwd ?? process.cwd(),
		rubric: rubricName,
		verdict: verdict.verdict,
		score: verdict.score,
		maxScore: verdict.maxScore,
		failed: verdict.results.filter((r) => !r.ok).map((r) => r.id),
		instantFailures: verdict.failures.map((f) => f.id),
	});
}

/**
 * Record penalty signals from other plugins' hook output (LSP diagnostics,
 * line-limit warnings) seen in tool results. Counts feed the gate at settle.
 */
function captureHookSignals(state: EvalHarnessState, text: string): void {
	if (/\[Line limit exceeded\]|Line limit exceeded/.test(text)) {
		state.recordSignal("file-length-violation");
	}
	if (/error\[ts\]|error TS\d+|\[ Semgrep\] \(error|severity.*"error"/i.test(text)) {
		state.recordSignal("lsp-syntax-error");
	} else if (/warning\[ast-grep\]|warning\[ts\]|\[ Semgrep\] \(warning/i.test(text)) {
		state.recordSignal("lsp-warning");
	}
}
