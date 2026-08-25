/**
 * Abstraction over "fetch base->quote exchange rates" so FINANCE()'s
 * currency-conversion path isn't hard-wired to Frankfurter specifically.
 * `getFinanceRatesAction` (app/actions.ts) is the only caller — swapping
 * providers later means writing a new `FxRateProvider` implementation and
 * changing the one import there, without touching the caching/TTL/dedup
 * logic in that action or the formula-engine integration in
 * `finance-function.ts`/`WorkbookView.tsx`.
 *
 * Currency conversion only, matching current scope — see SPEC.md's "The
 * FINANCE() function". Not a general quote/ticker abstraction; extending to
 * stock/security quotes is a separate, not-yet-scoped task (needs a keyed
 * provider and the admin-secrets/Console-settings workflow this plugin has
 * avoided so far).
 */

export interface FxRateProviderResult {
  /** Provider's reference date for the rates, e.g. "2026-08-25". */
  date: string;
  rates: Record<string, number>;
}

export interface FxRateProvider {
  /** Stable identifier stored in `finance_rate_cache.source`. */
  readonly id: string;
  /** Fetches `base` -> each of `quotes` in one batched call. Returns `null` on any failure. */
  getRates(base: string, quotes: string[]): Promise<FxRateProviderResult | null>;
}
