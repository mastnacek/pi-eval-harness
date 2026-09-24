/**
 * Lazy settings completions for /eval — follows:
 *   - Trailing Space Contract (non-terminal rows end with space, terminal rows do not)
 *   - Current-Value State Annotation (✓ in label, " · ● AKTIVNÍ" in description, never in value)
 *   - Full Prefix Replacement rule (item.value replaces entire argument string)
 *   - Full `--global` prefix support (/eval --global <setting> <value>)
 */

import type { EvalHarnessConfig } from "../../shared/config.js";
import { findSetting, formatValue, SETTING_SPECS, type SettingSpec } from "./catalogue.js";

interface Suggestion {
	value: string;
	description: string;
	space?: boolean;
}

const BASE_SUBCOMMANDS: readonly Suggestion[] = [
	{ value: "run", description: "Run the deterministic grading gate now" },
	{ value: "card", description: "Show the last 10 gate records from the global ledger" },
	{ value: "rubric", description: "Show the active rubric as the agent sees it" },
	{ value: "status", description: "Show current configuration and gate status" },
	{ value: "rating", description: "Toggle human quick-rating on agent settle (on | off)", space: true },
	{ value: "autoGate", description: "Run shell commands in gate (true | false)", space: true },
	{ value: "ratingOnlyWhenBlocked", description: "Show rating dialog only when BLOCKED (true | false)", space: true },
	{ value: "ratingTimeoutMs", description: "Rating dialog timeout in ms", space: true },
	{ value: "humanRating", description: "Human quick-rating on agent settle (true | false)", space: true },
	{ value: "config", description: "Legacy get/set config menu", space: true },
];

const TOP_LEVEL_SUBCOMMANDS: readonly Suggestion[] = [
	{ value: "--global", description: "Save following setting globally (~/.pi/agent/)", space: true },
	...BASE_SUBCOMMANDS,
];

const CONFIG_ACTIONS: readonly Suggestion[] = [
	{ value: "get", description: "Print current value of a setting", space: true },
	{ value: "set", description: "Save a new value for a setting", space: true },
];

const GLOBAL_FLAG: readonly Suggestion[] = [
	{ value: "--global", description: "Use global config (~/.pi/agent/pi-eval-harness.json)", space: true },
];

const TOGGLE_VALUES: readonly Suggestion[] = [
	{ value: "on", description: "Zapnout" },
	{ value: "off", description: "Vypnout" },
];

function filter(
	base: string,
	suggestions: readonly Suggestion[],
	prefix: string,
): Array<{ value: string; label: string; description: string }> | null {
	const items = suggestions
		.filter((s) => s.value.startsWith(prefix))
		.map((s) => ({
			value: `${base}${s.value}${s.space ? " " : ""}`,
			label: s.value,
			description: s.description,
		}));
	return items.length > 0 ? items : null;
}

/** Key menu with live values: "(nyní: <value>)" */
function completeKeys(
	base: string,
	config: EvalHarnessConfig,
	prefix: string,
): Array<{ value: string; label: string; description: string }> | null {
	const items = SETTING_SPECS.filter((spec) => spec.key.startsWith(prefix)).map((spec) => ({
		value: `${base}${spec.key} `,
		label: spec.key,
		description: `${spec.description} (nyní: ${formatValue(config[spec.key])})`,
	}));
	return items.length > 0 ? items : null;
}

/** Value menu for one key: booleans show the active row with ✓ and ● AKTIVNÍ. */
function completeValues(
	base: string,
	spec: SettingSpec,
	config: EvalHarnessConfig,
	prefix: string,
): Array<{ value: string; label: string; description: string }> | null {
	if (spec.kind === "boolean") {
		const current = Boolean(config[spec.key]);
		const rows: Array<{ value: string; label: string; description: string }> = [
			{
				value: `${base}true`,
				label: current ? "true ✓" : "true",
				description: `${spec.valueHelp?.true ?? "Povolit"}${current ? " · ● AKTIVNÍ" : ""}`,
			},
			{
				value: `${base}false`,
				label: current ? "false" : "false ✓",
				description: `${spec.valueHelp?.false ?? "Zakázat"}${current ? "" : " · ● AKTIVNÍ"}`,
			},
		];
		const filtered = rows.filter((r) => r.value.endsWith(prefix) || r.label.startsWith(prefix));
		return filtered.length > 0 ? filtered : rows;
	}

	if (spec.kind === "number") {
		const current = config[spec.key];
		const defaults = ["5000", "10000", "15000", "30000"].map((n) => ({
			value: `${base}${n}`,
			label: n === String(current) ? `${n} ✓` : n,
			description: `${n} ms${n === String(current) ? " · ● AKTIVNÍ" : ""}`,
		}));
		const filtered = defaults.filter((r) => r.value.endsWith(prefix) || r.label.startsWith(prefix));
		return filtered.length > 0 ? filtered : defaults;
	}

	return null;
}

/**
 * Entry point. prefix = entire argument string after "/eval ".
 */
export function completeEvalArguments(
	prefix: string,
	config: EvalHarnessConfig,
): Array<{ value: string; label: string; description: string }> | null {
	const trimmed = prefix.trimStart();

	// 1. Check if prefix starts with "--global"
	if (trimmed.startsWith("--global")) {
		const afterGlobal = trimmed.slice(8).trimStart();
		const hasTrailingSpace = trimmed.length > 8 || /\s$/.test(prefix);

		if (!hasTrailingSpace && afterGlobal === "") {
			return filter("", TOP_LEVEL_SUBCOMMANDS, trimmed);
		}

		// Recurse on the clean remainder and prepend "--global "
		const subCompletions = completeEvalArgumentsClean(afterGlobal, config);
		if (!subCompletions) return null;

		return subCompletions.map((item) => ({
			value: `--global ${item.value}`,
			label: item.label,
			description: item.description,
		}));
	}

	return completeEvalArgumentsClean(trimmed, config);
}

function completeEvalArgumentsClean(
	trimmed: string,
	config: EvalHarnessConfig,
): Array<{ value: string; label: string; description: string }> | null {
	if (!trimmed.includes(" ")) {
		return filter("", TOP_LEVEL_SUBCOMMANDS, trimmed);
	}

	const [sub] = trimmed.split(/\s+/);
	if (!sub) return null;

	const afterSub = trimmed.slice(sub.length).trimStart();

	// /eval rating [on|off]
	if (sub === "rating") {
		const current = config.humanRating;
		const items = TOGGLE_VALUES.map((t) => {
			const isOn = t.value === "on";
			const active = isOn === current;
			return {
				value: `rating ${t.value}`,
				label: active ? `${t.value} ✓` : t.value,
				description: `${t.description}${active ? " · ● AKTIVNÍ" : ""}`,
			};
		});
		const filtered = items.filter((i) => i.value.startsWith(`rating ${afterSub}`) || i.label.startsWith(afterSub));
		return filtered.length > 0 ? filtered : items;
	}

	// Direct setting access: /eval <setting> [value]
	const spec = findSetting(sub);
	if (spec) {
		return completeValues(`${spec.key} `, spec, config, afterSub);
	}

	// Legacy: /eval config [get|set]
	if (sub === "config") {
		if (!afterSub.includes(" ")) {
			return filter("config ", CONFIG_ACTIONS, afterSub);
		}

		const [action] = afterSub.split(/\s+/);
		if (!action) return null;

		const afterAction = afterSub.slice(action.length).trimStart();

		if (action === "get") {
			return completeKeys("config get ", config, afterAction);
		}

		if (action === "set") {
			if (!afterAction.includes(" ")) {
				const items = [
					...GLOBAL_FLAG.map((s) => ({
						value: `config set ${s.value} `,
						label: s.value,
						description: s.description,
					})),
					...SETTING_SPECS.filter((specItem) => specItem.key.startsWith(afterAction)).map((specItem) => ({
						value: `config set ${specItem.key} `,
						label: specItem.key,
						description: `${specItem.description} (nyní: ${formatValue(config[specItem.key])})`,
					})),
				];
				return items.length > 0 ? items : null;
			}
			const [first] = afterAction.split(/\s+/);
			if (!first) return null;

			if (first === "--global") {
				const afterGlobal = afterAction.slice(first.length).trimStart();
				if (!afterGlobal.includes(" ")) {
					return completeKeys("config set --global ", config, afterGlobal);
				}
				const [key] = afterGlobal.split(/\s+/);
				if (!key) return null;
				const targetSpec = findSetting(key);
				if (!targetSpec) return null;
				const afterKey = afterGlobal.slice(key.length).trimStart();
				return completeValues(`config set --global ${key} `, targetSpec, config, afterKey);
			}

			const targetSpec = findSetting(first);
			if (!targetSpec) return null;
			const afterKey = afterAction.slice(first.length).trimStart();
			return completeValues(`config set ${first} `, targetSpec, config, afterKey);
		}
	}

	return null;
}
