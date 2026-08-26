import { customAlphabet } from 'nanoid';

// Lowercase digits + letters only — same convention as the Docs plugin's own
// `_lib/ids.ts`. A workbook id shows up in a URL a person reads/types/shares,
// where mixed case reads as noisier and is easy to mistype. Same length (21)
// as default nanoid — a 36-symbol alphabet at 21 characters is still a
// 36^21 (~3.5 * 10^32) space, nowhere near a real collision risk for a
// self-hosted sheets app.
const generate = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 21);

/** New entity id — url-safe, all-lowercase, generated app-side (ids are text columns). */
export function newId(): string {
  return generate();
}
