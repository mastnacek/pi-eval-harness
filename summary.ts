/**
 * Compact monitor-summary builder for pi-eval-harness.
 *
 * The model never sees the ledger or rubric JSON — only a few short lines
 * derived from the global ledger: average, trend, and the criteria it is most
 * often penalized/praised for. English only, hard-capped length.
 */

import { readRecords, type ScoreRecord } from "./ledger.ts";
import type { GateVerdict } from "./gate.ts";

export type { ScoreRecord };

export function readLedger(): ScoreRecord[] {
	return readRecords();
}

export function summarize(rubricDescriptions: Record<string, string>): string {
	const records = readLedger();
	if (records.length === 0) {
		return [
			"[eval-harness · You Are Monitored]",
			"Work is graded by a deterministic gate (0-100). The gate, not you, decides when work is done.",
			"No record yet. Verified work, KISS solutions and short why-comments score high; errors and overengineering score low.",
		].join("\n");
	}

	const recent = records.slice(-10);
	const avg = Math.round(recent.reduce((s, r) => s + (r.score / Math.max(1, r.maxScore)) * 100, 0) / recent.length);
	const trend = computeTrend(records);

	const penaltyCount = new Map<string, number>();
	for (const r of recent) {
		for (const id of [...r.failed, ...r.instantFailures]) {
			penaltyCount.set(id, (penaltyCount.get(id) ?? 0) + 1);
		}
	}
	const topPenalties = [...penaltyCount.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, 2)
		.map(([id]) => rubricDescriptions[id] ?? id);
	const praised = topPenalties.length === 0 ? ["verified work, KISS, concise why-comments"] : undefined;

	const lines = [
		"[eval-harness · You Are Monitored]",
		`Work is graded by a deterministic gate (0-100). The gate, not you, decides when work is done.`,
		`Record: ${avg}/100 avg, trend ${trend}.`,
	];
	if (praised) {
		lines.push(`Praised for: ${praised[0]}.`);
	} else {
		lines.push(`Penalized for: ${topPenalties.join("; ")}.`);
	}
	return lines.slice(0, 5).join("\n");
}

function computeTrend(records: ScoreRecord[]): "up" | "flat" | "down" {
	if (records.length < 4) return "flat";
	const pct = (r: ScoreRecord) => (r.score / Math.max(1, r.maxScore)) * 100;
	const recent = records.slice(-3).reduce((s, r) => s + pct(r), 0) / 3;
	const prior = records.slice(-6, -3).reduce((s, r) => s + pct(r), 0) / Math.max(1, records.slice(-6, -3).length);
	if (recent > prior + 5) return "up";
	if (recent < prior - 5) return "down";
	return "flat";
}

/** Build the injected summary from a finished verdict for next-session display. */
export function summaryFromVerdict(v: GateVerdict, rubricDescriptions: Record<string, string>): string {
	const failedIds = v.results.filter((r) => !r.ok).map((r) => r.id);
	const map: Record<string, string> = { ...rubricDescriptions };
	for (const r of v.results) map[r.id] = rubricDescriptions[r.id] ?? r.id;
	const penalties = [...failedIds, ...v.failures.map((f) => f.id)]
		.slice(0, 2)
		.map((id) => map[id] ?? id);
	const lines = [
		"[eval-harness]",
		`Last grade: ${v.score}/${v.maxScore} — ${v.verdict}.`,
	];
	if (penalties.length > 0) lines.push(`Penalized for: ${penalties.join("; ")}.`);
	else lines.push("Praised for: verified work, KISS, concise why-comments.");
	return lines.join("\n");
}
