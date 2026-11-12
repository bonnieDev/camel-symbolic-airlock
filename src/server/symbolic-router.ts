import { z } from "zod";

/**
 * Layer 1: the stop-and-ask step.
 *
 * A request passes straight through only when it names exactly one known
 * action and, where the action needs one, a limit inside the allowed range.
 * Anything else halts, and the caller shows the candidates as buttons.
 *
 * The check is a fixed word list, not a model. It is crude on purpose: the
 * same prompt always gives the same answer, and anything it does not
 * recognize halts instead of running.
 */

export const AmbiguityHaltSchema = z.object({
  status: z.literal("HALT_AMBIGUOUS_SYMBOL"),
  /** The vague word found, or a short note on what was unclear. */
  detectedAmbiguity: z.string(),
  /** Action symbols the person can choose between. */
  requiredEnums: z.array(z.string()),
  /** What still has to be supplied before anything may run. */
  missing: z.array(z.enum(["ACTION", "LIMIT"])),
  requiresClampedSlider: z.boolean(),
  sliderBounds: z.object({ min: z.number(), max: z.number() }).optional(),
});

export const GroundedIntentSchema = z.object({
  status: z.literal("GROUNDED_READY"),
  actionSymbol: z.string(),
  limit: z.number().int().optional(),
});

export const RouterResultSchema = z.discriminatedUnion("status", [
  GroundedIntentSchema,
  AmbiguityHaltSchema,
]);

export type AmbiguityHalt = z.infer<typeof AmbiguityHaltSchema>;
export type GroundedIntent = z.infer<typeof GroundedIntentSchema>;
export type RouterResult = z.infer<typeof RouterResultSchema>;

export interface LimitBounds {
  min: number;
  max: number;
}

export interface ActionDefinition {
  /** The exact, unambiguous name of the action, e.g. "ARCHIVE_SOFT_DELETE". */
  symbol: string;
  /** Wordings that can only mean this action, e.g. ["archive"]. */
  phrases: string[];
  /** If set, the request must include one whole number in this range. */
  limit?: LimitBounds;
}

export interface SymbolicRouterConfig {
  actions: ActionDefinition[];
  /** Vague verbs and the action symbols each one could mean. */
  ambiguousVerbs: Record<string, string[]>;
}

export interface SymbolicRouter {
  /** Checks a plain-language request. Never runs anything. */
  route(prompt: string): RouterResult;
  /** Validates a person's button choice so it can be signed. */
  resolve(choice: { actionSymbol: string; limit?: number }): GroundedIntent;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Common endings of a verb: clean, cleans, cleaned, cleaning, cleanup. */
function wordForms(base: string): string[] {
  const forms = new Set([base, `${base}s`, `${base}ed`, `${base}ing`, `${base}up`]);
  if (base.endsWith("e")) {
    forms.add(`${base}d`);
    forms.add(`${base.slice(0, -1)}ing`);
  }
  if (base.endsWith("y")) {
    forms.add(`${base.slice(0, -1)}ies`);
    forms.add(`${base.slice(0, -1)}ied`);
  }
  return [...forms];
}

function phrasePattern(phrase: string): RegExp {
  const words = phrase.trim().toLowerCase().split(/\s+/);
  const body =
    words.length === 1
      ? `(?:${wordForms(words[0] ?? "").map(escapeRegExp).join("|")})`
      : words.map(escapeRegExp).join("\\s+");
  return new RegExp(`\\b${body}\\b`, "i");
}

function tightestBounds(actions: ActionDefinition[]): LimitBounds | undefined {
  const limits = actions.flatMap((action) => (action.limit ? [action.limit] : []));
  if (limits.length === 0) return undefined;
  const min = Math.max(...limits.map((limit) => limit.min));
  const max = Math.min(...limits.map((limit) => limit.max));
  return min <= max ? { min, max } : undefined;
}

export function createSymbolicRouter(config: SymbolicRouterConfig): SymbolicRouter {
  const bySymbol = new Map(config.actions.map((action) => [action.symbol, action]));
  if (bySymbol.size !== config.actions.length) {
    throw new Error("Every action symbol must be unique.");
  }

  for (const [verb, symbols] of Object.entries(config.ambiguousVerbs)) {
    for (const symbol of symbols) {
      if (!bySymbol.has(symbol)) {
        throw new Error(
          `Vague verb "${verb}" points at "${symbol}", which is not a defined action.`
        );
      }
    }
  }

  const actionMatchers = config.actions.map((action) => ({
    action,
    patterns: action.phrases.map(phrasePattern),
  }));
  const verbMatchers = Object.keys(config.ambiguousVerbs).map((verb) => ({
    verb,
    pattern: phrasePattern(verb),
  }));

  function halt(
    detectedAmbiguity: string,
    candidates: ActionDefinition[],
    missing: Array<"ACTION" | "LIMIT">
  ): AmbiguityHalt {
    const bounds = tightestBounds(candidates);
    return {
      status: "HALT_AMBIGUOUS_SYMBOL",
      detectedAmbiguity,
      requiredEnums: candidates.map((action) => action.symbol),
      missing,
      requiresClampedSlider: bounds !== undefined,
      ...(bounds ? { sliderBounds: bounds } : {}),
    };
  }

  function route(prompt: string): RouterResult {
    const named = actionMatchers
      .filter(({ patterns }) => patterns.some((pattern) => pattern.test(prompt)))
      .map(({ action }) => action);
    const vague = verbMatchers
      .filter(({ pattern }) => pattern.test(prompt))
      .map(({ verb }) => verb);
    const numbers = (prompt.match(/\b\d+\b/g) ?? []).map(Number);

    // Exactly one action named in plain terms: only the limit can be missing.
    if (named.length === 1) {
      const action = named[0] as ActionDefinition;
      if (!action.limit) {
        return { status: "GROUNDED_READY", actionSymbol: action.symbol };
      }
      const { min, max } = action.limit;
      if (numbers.length === 0) {
        return halt(`no limit given (allowed: ${min} to ${max})`, [action], ["LIMIT"]);
      }
      if (numbers.length > 1) {
        return halt(
          `several numbers given (${numbers.join(", ")}), unclear which is the limit`,
          [action],
          ["LIMIT"]
        );
      }
      const limit = numbers[0] as number;
      if (limit < min || limit > max) {
        return halt(`limit ${limit} is outside ${min} to ${max}`, [action], ["LIMIT"]);
      }
      return { status: "GROUNDED_READY", actionSymbol: action.symbol, limit };
    }

    // More than one action named: the person has to pick.
    if (named.length > 1) {
      return halt(
        `several actions named: ${named.map((action) => action.symbol).join(", ")}`,
        named,
        named.some((action) => action.limit) ? ["ACTION", "LIMIT"] : ["ACTION"]
      );
    }

    // A vague verb and nothing more exact: offer what it could mean.
    if (vague.length > 0) {
      const symbols = new Set(
        vague.flatMap((verb) => config.ambiguousVerbs[verb] ?? [])
      );
      const candidates = config.actions.filter((action) => symbols.has(action.symbol));
      return halt(
        vague.join(", "),
        candidates,
        candidates.some((action) => action.limit) ? ["ACTION", "LIMIT"] : ["ACTION"]
      );
    }

    // Nothing recognized. Halt and offer every action; never guess.
    return halt(
      "no recognized action",
      config.actions,
      config.actions.some((action) => action.limit) ? ["ACTION", "LIMIT"] : ["ACTION"]
    );
  }

  function resolve(choice: { actionSymbol: string; limit?: number }): GroundedIntent {
    const action = bySymbol.get(choice.actionSymbol);
    if (!action) {
      throw new Error(`"${choice.actionSymbol}" is not a defined action.`);
    }
    if (!action.limit) {
      return { status: "GROUNDED_READY", actionSymbol: action.symbol };
    }
    const { min, max } = action.limit;
    const limit = choice.limit;
    if (limit === undefined || !Number.isInteger(limit) || limit < min || limit > max) {
      throw new Error(
        `${action.symbol} needs a whole-number limit from ${min} to ${max}.`
      );
    }
    return { status: "GROUNDED_READY", actionSymbol: action.symbol, limit };
  }

  return { route, resolve };
}
