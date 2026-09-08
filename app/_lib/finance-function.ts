import {
  CellError,
  ErrorType,
  FunctionArgumentType,
  FunctionPlugin,
  HyperFormula,
  type FunctionPluginDefinition,
} from 'hyperformula';

/**
 * FINANCE(base, quote) — the GOOGLEFINANCE-alternative (currency conversion
 * only; see SPEC.md's "The FINANCE() function"). HyperFormula custom
 * functions are synchronous, so the actual Frankfurter fetch happens outside
 * the engine (a server action) and this plugin just reads from a
 * module-level cache populated ahead of time.
 *
 * Which pairs need fetching is discovered by the function *itself*: every
 * call that finds no cached rate records its pair in `pendingPairs`, and
 * `WorkbookView` drains that set after each recalculation, fetches, and
 * recalculates again. That covers arguments that come from cell references
 * (`=FINANCE(A1, B1)`) and named ranges — a regex over formula text could
 * only see string literals.
 *
 * The function is declared *volatile*, so once a rate lands the engine
 * re-evaluates every FINANCE cell on the next evaluation pass
 * (`suspendEvaluation`/`resumeEvaluation`) — no `rebuildAndRecalculate`,
 * which would wipe the undo history.
 */

export interface CachedRate {
  rate: number;
  /** Unix seconds — the provider's reference date for the rate. */
  asOf: number;
}

const rateStore = new Map<string, CachedRate>();
const pendingPairs = new Map<string, { base: string; quote: string }>();
/** Pairs the provider told us it doesn't offer — the function reports that instead of "loading" forever. */
const unavailablePairs = new Map<string, string>();

const CURRENCY_CODE_RE = /^[A-Z]{3}$/;

export function pairKey(base: string, quote: string): string {
  return `${base.trim().toUpperCase()}/${quote.trim().toUpperCase()}`;
}

export function isCurrencyCode(value: string): boolean {
  return CURRENCY_CODE_RE.test(value.trim().toUpperCase());
}

export function setCachedRate(base: string, quote: string, rate: number, asOf: number): void {
  const key = pairKey(base, quote);
  rateStore.set(key, { rate, asOf });
  pendingPairs.delete(key);
  unavailablePairs.delete(key);
}

export function markPairUnavailable(base: string, quote: string, reason: string): void {
  const key = pairKey(base, quote);
  unavailablePairs.set(key, reason);
  pendingPairs.delete(key);
}

export function getCachedRate(base: string, quote: string): CachedRate | undefined {
  return rateStore.get(pairKey(base, quote));
}

/** Pairs FINANCE() has asked for since the last drain that had no cached rate. Each pair is reported once per drain cycle. */
export function drainPendingFinancePairs(): { base: string; quote: string }[] {
  const pairs = [...pendingPairs.values()];
  pendingPairs.clear();
  return pairs;
}

/** Distinct (base, quote) string-literal pairs in a raw formula — used for the formula bar's rate-date hint. */
export function extractFinancePairs(formula: string): { base: string; quote: string }[] {
  const pairs: { base: string; quote: string }[] = [];
  const re = /FINANCE\(\s*"([A-Za-z]{3})"\s*,\s*"([A-Za-z]{3})"\s*\)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(formula)) !== null) {
    const base = match[1];
    const quote = match[2];
    if (base && quote) pairs.push({ base: base.toUpperCase(), quote: quote.toUpperCase() });
  }
  return pairs;
}

export const FINANCE_LOADING_MESSAGE = 'Fetching the exchange rate…';

// HyperFormula doesn't export ProcedureAst/InterpreterState from its package root.
class FinanceFunctionPlugin extends FunctionPlugin {
  static override implementedFunctions = {
    FINANCE: {
      method: 'finance',
      isVolatile: true,
      parameters: [
        { argumentType: FunctionArgumentType.STRING },
        { argumentType: FunctionArgumentType.STRING },
      ],
    },
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see class comment
  finance(ast: any, state: any) {
    return this.runFunction(ast.args, state, this.metadata('FINANCE'), (base: string, quote: string) => {
      const b = base.trim().toUpperCase();
      const q = quote.trim().toUpperCase();
      if (!isCurrencyCode(b) || !isCurrencyCode(q)) {
        return new CellError(ErrorType.VALUE, 'Use 3-letter currency codes, for example FINANCE("USD","EUR").');
      }
      if (b === q) return 1;
      const key = pairKey(b, q);
      const cached = rateStore.get(key);
      if (cached) return cached.rate;
      const unavailable = unavailablePairs.get(key);
      if (unavailable) return new CellError(ErrorType.NA, unavailable);
      pendingPairs.set(key, { base: b, quote: q });
      return new CellError(ErrorType.NA, FINANCE_LOADING_MESSAGE);
    });
  }
}

let registered = false;

/** Registers the FINANCE() function once, globally, ahead of building any engine instance. */
export function ensureFinanceFunctionRegistered(): void {
  if (registered) return;
  HyperFormula.registerFunctionPlugin(FinanceFunctionPlugin as unknown as FunctionPluginDefinition, {
    // Config default language (see Config.d.ts) — custom functions need an
    // explicit translation entry even for their own canonical name, or the
    // parser won't resolve them and every call reports #NAME?.
    enGB: { FINANCE: 'FINANCE' },
  });
  registered = true;
}
