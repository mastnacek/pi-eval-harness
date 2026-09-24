/**
 * EvalHarnessState — session-scoped kernel shared by the composition root and
 * the slices. Owns the mutable session state (rolling evidence, signal counts)
 * plus lifecycle plumbing.
 */

import { loadConfig, type EvalHarnessConfig } from "./config.js";
import { signalPenaltyCatalog, type SignalPenalty } from "../slices/evalgate/index.js";

export interface EvalHarnessState {
	// --- lifecycle plumbing ---
	unsubscribers: Array<() => void>;
	/** Retain a `pi.on()` return value; older engine typings declare it void. */
	track(result: unknown): void;

	// --- config ---
	config: EvalHarnessConfig;

	// --- live session state ---
	/** Rolling transcript evidence for instant-failure scanning. */
	sessionEvidence: string;
	/** Penalty hits captured from other plugins' hook output during the session. */
	signalCounts: SignalPenalty[];

	// --- helpers ---
	recordSignal(id: string): void;
	resetSession(): void;
}

export function createEvalHarnessState(): EvalHarnessState {
	const unsubscribers: Array<() => void> = [];
	const track = (result: unknown): void => {
		if (typeof result === "function") unsubscribers.push(result as () => void);
	};

	const signalCounts: SignalPenalty[] = signalPenaltyCatalog().map((s) => ({ ...s, count: 0 }));

	return {
		unsubscribers,
		track,
		config: loadConfig(),
		sessionEvidence: "",
		signalCounts,
		recordSignal(id: string): void {
			const entry = signalCounts.find((s) => s.id === id);
			if (entry) entry.count += 1;
		},
		resetSession(): void {
			unsubscribers.length = 0;
			signalCounts.forEach((s) => (s.count = 0));
		},
	};
}
