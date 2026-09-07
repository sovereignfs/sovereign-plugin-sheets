/**
 * Frankfurter (api.frankfurter.dev) — free, no API key required, ECB daily
 * reference rates. See SPEC.md's "The FINANCE() function" for why this
 * provider was chosen. Implements `FxRateProvider` (`fx-rate-provider.ts`)
 * — the currently-active provider, swapped in at `app/actions.ts`'s single
 * `FX_PROVIDER` binding.
 */

import { FX_FETCH_TIMEOUT_MS } from './config';
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
    // Bounded: a hung upstream must never hold a server action (and the
    // formula cells waiting on it) open indefinitely.
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(FX_FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    const body = (await res.json()) as Partial<FrankfurterResponse>;
    if (!body || typeof body.date !== 'string' || !body.rates || typeof body.rates !== 'object') {
      return null;
    }
    const rates: Record<string, number> = {};
    for (const [code, rate] of Object.entries(body.rates)) {
      if (typeof rate === 'number' && Number.isFinite(rate)) rates[code] = rate;
    }
    return { amount: 1, base, date: body.date, rates };
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
