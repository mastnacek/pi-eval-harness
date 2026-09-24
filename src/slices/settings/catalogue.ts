/**
 * Setting catalogue — single source of truth for every configurable key.
 * Each spec drives: lazy completions (keys + values), status rendering, and
 * the config set handler, so adding a setting touches ONE file only.
 */

import type { EvalHarnessConfig } from "../../shared/config.js";

export type SettingKind = "boolean" | "number";

export interface SettingSpec {
	key: keyof EvalHarnessConfig;
	kind: SettingKind;
	description: string;
	valueHelp?: Readonly<Record<string, string>>;
}

export const SETTING_SPECS: readonly SettingSpec[] = [
	{
		key: "humanRating",
		kind: "boolean",
		description: "Ask for a quick human rating when the agent settles (TUI only)",
		valueHelp: {
			true: "Zapnuto — po dokončení agenta se zeptá na hodnocení (Keep/Over/Skip)",
			false: "Vypnuto — ukládá se pouze automatický gate verdikt",
		},
	},
	{
		key: "autoGate",
		kind: "boolean",
		description: "Run shell-command criteria in the settle-time gate (slower, full verification)",
		valueHelp: {
			true: "Zapnuto — gate spouští i testovací příkazy (plné ověření)",
			false: "Vypnuto — gate kontroluje jen session evidence (rychlé)",
		},
	},
	{
		key: "ratingOnlyWhenBlocked",
		kind: "boolean",
		description: "Show the rating dialog only when the gate verdict is BLOCKED",
		valueHelp: {
			true: "Zapnuto — dialog jen při BLOCKED verdiktu",
			false: "Vypnuto — dialog po každém dokončení agenta",
		},
	},
	{
		key: "ratingTimeoutMs",
		kind: "number",
		description: "Rating dialog timeout in milliseconds (TUI only)",
	},
];

export function findSetting(key: string): SettingSpec | undefined {
	return SETTING_SPECS.find((s) => s.key === key);
}

export function formatValue(value: unknown): string {
	return typeof value === "boolean" ? (value ? "true" : "false") : String(value);
}

export function parseValue(spec: SettingSpec, raw: string): { ok: boolean; value?: unknown; error?: string } {
	if (spec.kind === "boolean") {
		const v = raw.toLowerCase();
		if (v === "true" || v === "on") return { ok: true, value: true };
		if (v === "false" || v === "off") return { ok: true, value: false };
		return { ok: false, error: `Expected true|false for '${spec.key}'` };
	}
	const num = Number(raw);
	if (Number.isNaN(num)) return { ok: false, error: `Expected number for '${spec.key}'` };
	return { ok: true, value: num };
}
