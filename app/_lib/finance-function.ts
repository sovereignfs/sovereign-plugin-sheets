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
 * (`=FINANCE(A1, B1)`) and named ranges — a regex over formula text (the
 * earlier approach) could only see string literals, leaving everything else
 * stuck on `#N/A` forever.
 */

export interface CachedRate {
  rate: number;
  /** Unix seconds — the provider's reference date for the rate. */
  asOf: number;
}

const rateStore = new Map<string, CachedRate>();
const pendingPairs = new Map<string, { base: string; quote: string }>();

const CURRENCY_CODE_RE = /^[A-Z]{3}$/;

export function pairKey(base: string, quote: string): string {
  return `${base.trim().toUpperCase()}/${quote.trim().toUpperCase()}`;
}

export function isCurrencyCode(value: string): boolean {
  return CURRENCY_CODE_RE.test(value.trim().toUpperCase());
}

export function setCachedRate(base: string, quote: string, rate: number, asOf: number): void {
  rateStore.set(pairKey(base, quote), { rate, asOf });
  pendingPairs.delete(pairKey(base, quote));
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

/** Distinct (base, quote) string-literal pairs in a raw formula — used to prefetch before the first render. */
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

// HyperFormula doesn't export ProcedureAst/InterpreterState from its package root.
class FinanceFunctionPlugin extends FunctionPlugin {
  static override implementedFunctions = {
    FINANCE: {
      method: 'finance',
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
        return new CellError(ErrorType.VALUE, 'Use a 3-letter currency code, e.g. "USD"');
      }
      if (b === q) return 1;
      const cached = rateStore.get(pairKey(b, q));
      if (cached) return cached.rate;
      pendingPairs.set(pairKey(b, q), { base: b, quote: q });
      return new CellError(ErrorType.NA, 'Loading rate…');
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
