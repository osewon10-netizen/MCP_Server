import fs from "node:fs/promises";
import { FAILURE_CLASSES_PATH } from "./paths.js";
import type { FailureClasses } from "../types.js";

let cachedClasses: string[] | null = null;

async function loadClasses(): Promise<string[]> {
  if (cachedClasses) return cachedClasses;
  const raw = await fs.readFile(FAILURE_CLASSES_PATH, "utf-8");
  const parsed: FailureClasses = JSON.parse(raw);
  cachedClasses = parsed.classes;
  return cachedClasses;
}

/**
 * Validate a failure_class string.
 * Returns { valid, suggestions? } where suggestions are fuzzy matches if invalid.
 */
export async function validateFailureClass(
  fc: string
): Promise<{ valid: boolean; suggestions?: string[] }> {
  const classes = await loadClasses();

  if (classes.includes(fc)) return { valid: true };

  // Fuzzy match: find classes containing the input as a substring
  const suggestions = classes.filter(
    (c) => c.includes(fc) || fc.includes(c)
  );

  return { valid: false, suggestions: suggestions.length > 0 ? suggestions : undefined };
}

/**
 * Validate an assigned_to string against the agent naming convention.
 * Format: {side}.{service}.{model}
 *   side:    dev | mini
 *   service: any word chars (matches service registry names)
 *   model:   opus | sonnet | codex
 * Shorthands: bare "mini" is valid. "dev.minimart" (no model) is a soft warning.
 *
 * Returns { valid, warning?, suggestion? }
 */
export function validateAssignedTo(
  value: string
): { valid: boolean; warning?: string; suggestion?: string; error?: string } {
  // Strict format
  const strict = /^(dev\.\w+\.(opus|sonnet|codex)|mini(\.\w+\.(opus|sonnet))?)$/;
  if (strict.test(value)) return { valid: true };

  // Bare "mini" shorthand
  if (value === "mini") return { valid: true };

  // Soft case: dev.{service} with no model — accept with warning
  const devNoModel = /^dev\.(\w+)$/.exec(value);
  if (devNoModel) {
    const suggestion = `${value}.sonnet`;
    return {
      valid: true,
      warning: `assigned_to "${value}" is missing model tier. Did you mean "${suggestion}"?`,
      suggestion,
    };
  }

  return {
    valid: false,
    error: `Invalid assigned_to "${value}". Expected format: dev.<service>.<model> or mini[.<service>.<model>]. Valid models: opus, sonnet, codex. Examples: dev.minimart.sonnet, mini, mini.minimart.sonnet`,
  };
}
