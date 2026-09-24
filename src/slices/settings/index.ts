/**
 * Settings slice — catalogue + lazy menu completions for /eval. Barrel module.
 */

export {
	SETTING_SPECS,
	findSetting,
	formatValue,
	parseValue,
	type SettingSpec,
	type SettingKind,
} from "./catalogue.js";
export { completeEvalArguments } from "./complete.js";
