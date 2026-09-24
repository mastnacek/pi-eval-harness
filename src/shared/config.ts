/**
 * Config for pi-eval-harness:
 * - Global: ~/.pi/agent/pi-eval-harness.json
 * - Project: <cwd>/.pi/pi-eval-harness.json
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface EvalHarnessConfig {
	/** Ask the user for a quick human rating when the agent settles (TUI only). */
	humanRating: boolean;
	/** Rating dialog timeout in ms; auto-dismiss keeps the "over"-choice. */
	ratingTimeoutMs: number;
	/** Auto-run the deterministic gate when the agent settles. */
	autoGate: boolean;
	/** Only ask for human rating when the gate verdict is BLOCKED. */
	ratingOnlyWhenBlocked: boolean;
}

export const DEFAULT_CONFIG: EvalHarnessConfig = {
	humanRating: true,
	ratingTimeoutMs: 15000,
	autoGate: false,
	ratingOnlyWhenBlocked: false,
};

export const GLOBAL_CONFIG_FILE = join(homedir(), ".pi", "agent", "pi-eval-harness.json");

export function projectConfigPath(cwd: string): string {
	return join(cwd, ".pi", "pi-eval-harness.json");
}

export function loadConfig(cwd?: string): EvalHarnessConfig {
	let merged: EvalHarnessConfig = { ...DEFAULT_CONFIG };

	// 1. Global config (~/.pi/agent/pi-eval-harness.json)
	try {
		if (existsSync(GLOBAL_CONFIG_FILE)) {
			merged = { ...merged, ...JSON.parse(readFileSync(GLOBAL_CONFIG_FILE, "utf8")) };
		}
	} catch {
		// fall through
	}

	// 2. Project config (<cwd>/.pi/pi-eval-harness.json)
	if (cwd) {
		try {
			const projFile = projectConfigPath(cwd);
			if (existsSync(projFile)) {
				merged = { ...merged, ...JSON.parse(readFileSync(projFile, "utf8")) };
			}
		} catch {
			// fall through
		}
	}

	return merged;
}

export function saveConfig(cfg: EvalHarnessConfig, isGlobal = false, cwd?: string): void {
	if (isGlobal) {
		try {
			mkdirSync(dirname(GLOBAL_CONFIG_FILE), { recursive: true });
			writeFileSync(GLOBAL_CONFIG_FILE, JSON.stringify(cfg, null, 2), "utf8");
		} catch {
			// best-effort
		}
	} else if (cwd) {
		try {
			const projFile = projectConfigPath(cwd);
			mkdirSync(dirname(projFile), { recursive: true });
			writeFileSync(projFile, JSON.stringify(cfg, null, 2), "utf8");
		} catch {
			// best-effort
		}
	} else {
		try {
			mkdirSync(dirname(GLOBAL_CONFIG_FILE), { recursive: true });
			writeFileSync(GLOBAL_CONFIG_FILE, JSON.stringify(cfg, null, 2), "utf8");
		} catch {
			// best-effort
		}
	}
}
