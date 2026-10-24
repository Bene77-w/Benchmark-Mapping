import type { ResolvedOpencodeOptions } from "./opencode";
import { type PreflightRequest, runPreflight } from "./preflight";

export async function opencodePreflight(_request: PreflightRequest, _options: ResolvedOpencodeOptions) {
  return runPreflight([], () => null);
}
