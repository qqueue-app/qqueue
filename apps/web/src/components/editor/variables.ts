import type { TemplateVariable } from "@/lib/api";

// Mirrors the `{{name}}` substitution in @qqueue/shared (applyVariables /
// extractVariables / resolveVariableData). Kept local so the web app stays
// self-contained — the same way api.ts mirrors the shared contract types.
// Detection/substitution here MUST stay in lock-step with the server so the
// live preview matches what recipients receive.
const VARIABLE_TOKEN = /\{\{\s*([\w.-]+)\s*\}\}/g;

/** Distinct variable names referenced as `{{name}}`, in first-seen order. */
export function extractVariables(
  ...sources: Array<string | null | undefined>
): string[] {
  const seen = new Set<string>();
  for (const source of sources) {
    if (!source) continue;
    for (const match of source.matchAll(VARIABLE_TOKEN)) {
      seen.add(match[1]);
    }
  }
  return [...seen];
}

/** Replace `{{name}}` tokens with values from `data` (unknown → empty string). */
export function applyVariables(
  value: string | null | undefined,
  data: Record<string, unknown> | undefined
): string {
  if (!value) return "";
  if (!data) return value;
  return value.replace(VARIABLE_TOKEN, (_match, key: string) => {
    const variable = data[key];
    return variable === undefined || variable === null ? "" : String(variable);
  });
}

/** Declared defaults first, then non-empty caller overrides. */
export function resolveVariableData(
  variables: TemplateVariable[] | null | undefined,
  data: Record<string, string> | undefined
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const variable of variables ?? []) {
    if (variable.defaultValue != null && variable.defaultValue !== "") {
      resolved[variable.name] = variable.defaultValue;
    }
  }
  for (const [key, val] of Object.entries(data ?? {})) {
    if (val !== "" && val != null) resolved[key] = val;
  }
  return resolved;
}
