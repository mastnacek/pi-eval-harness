/**
 * pi-eval-harness — evaluation, motivation, and grading harness for the Pi
 * coding agent.
 *
 * Composition root ONLY: creates the EvalHarnessState kernel and wires slices
 * onto Pi events. No business logic lives here:
 * - rubric + gate + ledger        → src/slices/evalgate
 * - monitor summary (prompt block) → src/slices/summary
 * - event translation, rating dlg → src/slices/pipeline
 * - /eval command, eval_gate tool → src/slices/commands
 * - session state + config        → src/shared
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createEvalHarnessState } from "./src/shared/state.js";
import { registerPipeline } from "./src/slices/pipeline/index.js";
import { registerEvalGateTool, registerEvalCommand } from "./src/slices/commands/index.js";

export default function evalHarnessExtension(pi: ExtensionAPI): void {
	const state = createEvalHarnessState();

	registerPipeline(pi, state);
	registerEvalGateTool(pi, state);
	registerEvalCommand(pi, state);

	// Cleanup: drain listeners, clear session evidence and signal counts.
	pi.on("session_shutdown", async (_event, ctx) => {
		while (state.unsubscribers.length > 0) {
			try {
				state.unsubscribers.pop()?.();
			} catch {
				// ignore
			}
		}
		state.sessionEvidence = "";
		state.signalCounts.forEach((s) => (s.count = 0));
		try {
			if (ctx.hasUI) ctx.ui.setStatus("eval-harness", undefined);
		} catch {
			// session gone
		}
	});
}
