import { test } from "node:test";
import assert from "node:assert/strict";
import { completeEvalArguments } from "../src/slices/settings/complete.js";
import { DEFAULT_CONFIG } from "../src/shared/config.js";

test("completeEvalArguments: top-level offers direct settings and --global", () => {
	const res = completeEvalArguments("", DEFAULT_CONFIG);
	assert.ok(res && res.length > 0);
	const values = res.map((r) => r.value);
	assert.ok(values.includes("--global "));
	assert.ok(values.includes("autoGate "));
	assert.ok(values.includes("rating "));
	assert.ok(values.includes("status"));
	assert.ok(values.includes("run"));
});

test("completeEvalArguments: --global prefix preserves child completions", () => {
	const res = completeEvalArguments("--global ", DEFAULT_CONFIG);
	assert.ok(res && res.length > 0);
	const values = res.map((r) => r.value);
	assert.ok(values.includes("--global autoGate "));
	assert.ok(values.includes("--global rating "));
	assert.ok(values.includes("--global status"));
});

test("completeEvalArguments: --global prefix deep completion for boolean setting", () => {
	const res = completeEvalArguments("--global autoGate ", DEFAULT_CONFIG);
	assert.ok(res && res.length > 0);
	const values = res.map((r) => r.value);
	assert.ok(values.includes("--global autoGate true"));
	assert.ok(values.includes("--global autoGate false"));
});

test("completeEvalArguments: direct setting completion without --global", () => {
	const res = completeEvalArguments("autoGate ", DEFAULT_CONFIG);
	assert.ok(res && res.length > 0);
	const values = res.map((r) => r.value);
	assert.ok(values.includes("autoGate true"));
	assert.ok(values.includes("autoGate false"));
});

test("completeEvalArguments: rating shortcut completion", () => {
	const res = completeEvalArguments("rating ", DEFAULT_CONFIG);
	assert.ok(res && res.length > 0);
	const values = res.map((r) => r.value);
	assert.ok(values.includes("rating on"));
	assert.ok(values.includes("rating off"));
});
