/**
 * pi-eval-harness — evaluation, motivation, and grading harness for the Pi
 * coding agent.
 *
 * Layout (VSA — Vertical Slice Architecture):
 * - index.ts                      composition root — Pi adapter only, no domain logic
 * - src/shared/                   kernel: state.ts, config.ts (no slice imports)
 * - src/slices/evalgate/          rubric, deterministic gate, global ledger
 * - src/slices/summary/           compact "You Are Monitored" prompt block
 * - src/slices/pipeline/          event translation + human rating dialog
 * - src/slices/commands/          /eval command + eval_gate tool
 * - src/slices/settings/          catalogue + lazy menu completions for /eval
 *
 * Rule: slices never import each other. They depend on src/shared only;
 * index.ts wires them. NodeNext: src/** imports use explicit .js extensions.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createEvalHarnessState } from "./src/shared/state.js";
import { loadConfig } from "./src/shared/config.js";
import { registerPipeline } from "./src/slices/pipeline/index.js";
import { registerEvalGateTool, registerEvalCommand } from "./src/slices/commands/index.js";

export default function evalHarnessExtension(pi: ExtensionAPI): void {
	const state = createEvalHarnessState();

	// Session initialization: reload cascading config (defaults <- global <- project)
	state.track(
		pi.on("session_start", async (_event, ctx: ExtensionContext) => {
			state.config = loadConfig(ctx.cwd);
		}),
	);

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
