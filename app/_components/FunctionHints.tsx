'use client';

import type { FunctionContext, FunctionSuggestion } from '../_lib/formula-editing';
import { describeSignature } from '../_lib/formula-editing';
import styles from './FunctionHints.module.css';

/**
 * The strip under the formula bar while a formula is being typed: either
 * a list of function names matching the partial name under the caret
 * (Up/Down to choose, Tab or Enter to accept, or click), or — once inside
 * a call — that function's parameters with the current one highlighted.
 * Rendered by `SheetGrid`, which owns the draft and the keyboard handling;
 * this component is presentation only.
 */
export function FunctionSuggestions({
  suggestions,
  selectedIndex,
  onPick,
}: {
  suggestions: FunctionSuggestion[];
  selectedIndex: number;
  onPick: (name: string) => void;
}) {
  if (suggestions.length === 0) return null;
  return (
    <ul className={styles.list} role="listbox" aria-label="Function suggestions">
      {suggestions.map((suggestion, index) => (
        <li
          key={suggestion.name}
          role="option"
          aria-selected={index === selectedIndex}
          className={[styles.item, index === selectedIndex && styles.itemSelected].filter(Boolean).join(' ')}
          // mousedown, not click — the editing input must keep focus.
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(suggestion.name);
          }}
        >
          <span className={styles.name}>
            {suggestion.name}
            <span className={styles.params}>({suggestion.signature?.params ?? '…'})</span>
          </span>
          {suggestion.signature?.description ? (
            <span className={styles.description}>{suggestion.signature.description}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function ArgumentHint({ context }: { context: FunctionContext }) {
  const { name, params, description } = describeSignature(context);
  return (
    <span className={styles.argumentHint}>
      <span className={styles.name}>{name}</span>(
      {params.map((param, index) => (
        <span key={`${param.label}-${String(index)}`}>
          {index > 0 ? ', ' : ''}
          <span className={param.active ? styles.paramActive : styles.param}>{param.label}</span>
        </span>
      ))}
      ){description ? <span className={styles.description}> — {description}</span> : null}
    </span>
  );
}
