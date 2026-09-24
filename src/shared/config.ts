/**
 * Global config for pi-eval-harness: ~/.pi/agent/pi-eval-harness.json
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

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

const CONFIG_DIR = join(homedir(), ".pi", "agent");
const CONFIG_FILE = join(CONFIG_DIR, "pi-eval-harness.json");

export function loadConfig(): EvalHarnessConfig {
	try {
		if (existsSync(CONFIG_FILE)) {
			return { ...DEFAULT_CONFIG, ...JSON.parse(readFileSync(CONFIG_FILE, "utf8")) };
		}
	} catch {
		// fall through
	}
	return { ...DEFAULT_CONFIG };
}

export function saveConfig(cfg: EvalHarnessConfig): void {
	try {
		if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
		writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), "utf8");
	} catch {
		// best-effort
	}
}
