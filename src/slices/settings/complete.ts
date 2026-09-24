/**
 * Lazy settings completions for /eval — follows the Lazy Parameter Completion
 * rule (a fully-typed non-terminal token ALREADY returns its children, because
 * the engine will not re-open the picker after a trailing-space Tab) and the
 * Current-Value State Annotation rule (✓ in label, " · ● AKTIVNÍ" in
 * description, never in value).
 */

import type { EvalHarnessConfig } from "../../shared/config.js";
import { findSetting, formatValue, SETTING_SPECS, type SettingSpec } from "./catalogue.js";

interface Suggestion {
	value: string;
	description: string;
	space?: boolean;
}

const SUBCOMMANDS: readonly Suggestion[] = [
	{ value: "run", description: "Run the deterministic grading gate now" },
	{ value: "card", description: "Show the last 10 gate records from the global ledger" },
	{ value: "rubric", description: "Show the active rubric as the agent sees it" },
	{ value: "config", description: "Get or set a setting (lazy key/value menu)", space: true },
	{ value: "rating", description: "Toggle human quick-rating on agent settle: on | off", space: true },
];

const CONFIG_ACTIONS: readonly Suggestion[] = [
	{ value: "get", description: "Print the current value of a setting", space: true },
	{ value: "set", description: "Save a new value for a setting", space: true },
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

/** Key menu with live values: "(nyní: <value>)" — works for booleans and numbers. */
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
	if (spec.kind !== "boolean") return null;
	const current = config[spec.key] as boolean;
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
	return rows.filter((r) => r.value.endsWith(prefix) || r.label.startsWith(prefix));
}

/**
 * Entry point. prefix = the entire argument string after "/eval ".
 * Level structure:
 *   /eval                      → SUBCOMMANDS
 *   /eval config               → get|set            (lazy: token fully typed)
 *   /eval config get           → keys + live values
 *   /eval config set <key>     → keys + live values
 *   /eval config set <key>     → true|false with ✓ marker
 *   /eval rating               → on|off             (lazy)
 */
export function completeEvalArguments(
	prefix: string,
	config: EvalHarnessConfig,
): Array<{ value: string; label: string; description: string }> | null {
	const trimmed = prefix.trimStart();

	if (!trimmed.includes(" ")) {
		return filter("", SUBCOMMANDS, trimmed);
	}

	const [sub] = trimmed.split(/\s+/);
	if (!sub) return null;

	const afterSub = trimmed.slice(sub.length).trimStart();

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
				return completeKeys("config set ", config, afterAction);
			}
			const [key] = afterAction.split(/\s+/);
			if (!key) return null;
			const spec = findSetting(key);
			if (!spec) return null;
			const afterKey = afterAction.slice(key.length).trimStart();
			return completeValues(`config set ${key} `, spec, config, afterKey);
		}
	}

	return null;
}
