import { FUNCTION_SIGNATURES, POPULAR_FUNCTIONS, type FunctionSignature } from './function-signatures';

/**
 * Pure text helpers behind the formula editing experience: "point mode"
 * (click or arrow to a cell while typing a formula and its reference is
 * inserted), function-name autocomplete, and the argument hint for the
 * function the caret is inside. All operate on a draft string plus a caret
 * position and know nothing about React or the DOM.
 */

/** A draft is a formula when it starts with `=`. */
export function isFormulaDraft(text: string): boolean {
  return text.startsWith('=');
}

/** Characters after which a cell reference is grammatically welcome. */
const REFERENCE_PRECEDER_RE = /[=(,+\-*/^&<>:;]\s*$/;

/** The span of the draft that a pointed reference currently occupies, so a further click/arrow replaces it instead of appending. */
export interface ReferenceSpan {
  start: number;
  end: number;
}

/**
 * Where a pointed reference would go, or `null` when the draft can't take
 * one at the caret (not a formula, or the caret follows text that isn't an
 * operator/opening paren/separator). An active `span` — the reference the
 * last point inserted — is always replaceable while the caret still sits
 * right after it.
 */
export function referenceInsertionRange(
  text: string,
  caret: number,
  span: ReferenceSpan | null,
): ReferenceSpan | null {
  if (!isFormulaDraft(text)) return null;
  if (span && span.end === caret && span.start <= caret) return span;
  const before = text.slice(0, caret);
  if (REFERENCE_PRECEDER_RE.test(before)) return { start: caret, end: caret };
  return null;
}

/** Replaces `[start, end)` with `reference`; returns the new text, the new caret, and the span the reference now occupies. */
export function insertReference(
  text: string,
  range: ReferenceSpan,
  reference: string,
): { text: string; caret: number; span: ReferenceSpan } {
  const next = text.slice(0, range.start) + reference + text.slice(range.end);
  const end = range.start + reference.length;
  return { text: next, caret: end, span: { start: range.start, end } };
}

const IDENTIFIER_TAIL_RE = /([A-Za-z][A-Za-z0-9.]*)$/;
const IDENTIFIER_PRECEDER_RE = /(^|[=(,+\-*/^&<>:;\s])$/;

export interface FunctionQuery {
  /** What the user has typed so far (original case). */
  query: string;
  start: number;
  end: number;
}

/**
 * The partial function name under the caret, when the caret is inside a
 * formula and sits right after an identifier that isn't a cell reference
 * (`SU` in `=SU|`, `av` in `=A1+av|`). `null` otherwise.
 */
export function functionQueryAt(text: string, caret: number): FunctionQuery | null {
  if (!isFormulaDraft(text)) return null;
  const before = text.slice(0, caret);
  const match = IDENTIFIER_TAIL_RE.exec(before);
  if (!match || match.index === undefined) return null;
  const query = match[1] ?? '';
  if (!query) return null;
  if (/^[A-Za-z]{1,3}\d+$/.test(query)) return null; // a cell reference like A1
  if (!IDENTIFIER_PRECEDER_RE.test(before.slice(0, match.index))) return null;
  if (text[caret] && /[A-Za-z0-9.(]/.test(text[caret] ?? '')) return null; // caret mid-word
  return { query, start: match.index, end: caret };
}

export interface FunctionSuggestion {
  name: string;
  signature: FunctionSignature | undefined;
}

/** Matching function names, curated/popular ones first, then alphabetical. */
export function suggestFunctions(
  query: string,
  registeredNames: readonly string[],
  limit = 8,
): FunctionSuggestion[] {
  const q = query.toUpperCase();
  if (!q) return [];
  const rank = (name: string): number => {
    const popular = POPULAR_FUNCTIONS.indexOf(name);
    if (popular >= 0) return popular;
    return name in FUNCTION_SIGNATURES ? 100 : 200;
  };
  const matches = registeredNames
    .filter((name) => name.startsWith(q))
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  return matches.slice(0, limit).map((name) => ({ name, signature: FUNCTION_SIGNATURES[name] }));
}

/** Replaces the partial name with `NAME(` and puts the caret inside the parentheses. */
export function acceptFunctionSuggestion(
  text: string,
  query: FunctionQuery,
  name: string,
): { text: string; caret: number } {
  const alreadyOpen = text[query.end] === '(';
  const insert = alreadyOpen ? name : `${name}(`;
  const next = text.slice(0, query.start) + insert + text.slice(query.end);
  return { text: next, caret: query.start + insert.length + (alreadyOpen ? 1 : 0) };
}

export interface FunctionContext {
  name: string;
  /** 0-based index of the argument the caret is in. */
  argIndex: number;
  signature: FunctionSignature | undefined;
}

/**
 * The innermost function call the caret is inside, and which argument the
 * caret is on — `SUM`, argument 1 for `=SUM(A1, |`. String literals are
 * skipped so a comma inside quotes doesn't count. `null` when the caret is
 * not inside any call.
 */
export function functionContextAt(text: string, caret: number): FunctionContext | null {
  if (!isFormulaDraft(text)) return null;
  const stack: { name: string; argIndex: number }[] = [];
  let inString = false;
  let i = 0;
  while (i < caret && i < text.length) {
    const ch = text[i] ?? '';
    if (inString) {
      if (ch === '"') {
        if (text[i + 1] === '"') i += 1;
        else inString = false;
      }
      i += 1;
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '(') {
      const match = IDENTIFIER_TAIL_RE.exec(text.slice(0, i));
      stack.push({ name: (match?.[1] ?? '').toUpperCase(), argIndex: 0 });
    } else if (ch === ')') {
      stack.pop();
    } else if (ch === ',' || ch === ';') {
      const top = stack[stack.length - 1];
      if (top) top.argIndex += 1;
    }
    i += 1;
  }
  const top = stack[stack.length - 1];
  if (!top || !top.name) return null;
  return { name: top.name, argIndex: top.argIndex, signature: FUNCTION_SIGNATURES[top.name] };
}

/** The parameter list split into display pieces, with the one the caret is on flagged (a trailing `…` parameter absorbs everything past it). */
export function describeSignature(
  context: FunctionContext,
): { name: string; params: { label: string; active: boolean }[]; description: string | undefined } {
  const signature = context.signature;
  if (!signature) return { name: context.name, params: [{ label: '…', active: true }], description: undefined };
  const pieces = signature.params ? signature.params.split(',').map((p) => p.trim()) : [];
  const lastIsRest = pieces[pieces.length - 1] === '…';
  const params = pieces.map((label, index) => ({
    label,
    active:
      index === context.argIndex ||
      (lastIsRest && index === pieces.length - 1 && context.argIndex >= pieces.length - 1),
  }));
  return { name: context.name, params, description: signature.description };
}
