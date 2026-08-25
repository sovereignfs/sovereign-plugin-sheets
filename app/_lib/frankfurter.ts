/**
 * Frankfurter (api.frankfurter.dev) — free, no API key required, ECB daily
 * reference rates. See SPEC.md's "The FINANCE() function" for why this
 * provider was chosen. Implements `FxRateProvider` (`fx-rate-provider.ts`)
 * — the currently-active provider, swapped in at `app/actions.ts`'s single
 * `FX_PROVIDER` binding.
 */

import type { FxRateProvider, FxRateProviderResult } from './fx-rate-provider';

interface FrankfurterResponse {
  amount: number;
  base: string;
  date: string;
  rates: Record<string, number>;
}

async function fetchFrankfurterRates(base: string, quotes: string[]): Promise<FrankfurterResponse | null> {
  if (quotes.length === 0) return null;
  try {
    const url = `https://api.frankfurter.dev/v1/latest?base=${encodeURIComponent(base)}&symbols=${encodeURIComponent(quotes.join(','))}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as FrankfurterResponse;
  } catch {
    return null;
  }
}

export const frankfurterProvider: FxRateProvider = {
  id: 'frankfurter',
  async getRates(base, quotes): Promise<FxRateProviderResult | null> {
    const fetched = await fetchFrankfurterRates(base, quotes);
    return fetched ? { date: fetched.date, rates: fetched.rates } : null;
  },
};
