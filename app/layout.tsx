import type { ReactNode } from 'react';
import { registerPortabilityHandlers } from './_lib/portability';

export default async function SheetsLayout({ children }: { children: ReactNode }) {
  // In-process and reset on restart — the platform SDK requires
  // re-registering from a request-scoped plugin route, so this runs on
  // every request. Best-effort: a registration failure must not block the
  // plugin's own UI (matches Docs' layout.tsx).
  try {
    await registerPortabilityHandlers();
  } catch {
    // Portability is a best-effort platform integration.
  }

  return children;
}
