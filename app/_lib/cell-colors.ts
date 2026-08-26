import type { ColorPickerSwatch } from '@sovereignfs/ui';

/**
 * Curated font/background color suggestions — plugin *data*, not design
 * tokens (the design system is deliberately monochrome; see
 * `plugins/sovereign-plugin-kanban.local/app/_lib/palette.ts` for the same
 * pattern applied to board colors). Shared by both the font-color and
 * fill-color pickers (`SheetGrid.tsx`) — `@sovereignfs/ui`'s `ColorPicker`
 * still offers a native custom-color trigger alongside these for anything
 * outside the curated set.
 *
 * Deliberately excludes black/white/gray-scale extremes: a cell's font sits
 * directly on `--sv-color-surface`, which flips between light and dark mode,
 * so there is no single "black" that reads correctly in both — "no color"
 * (the picker's `allowNone`) is how a user returns to the theme-correct
 * default instead.
 *
 * Saturated and mid-to-dark, not pastel: an earlier, more muted revision
 * (report: "font color and background color is less visible") read as
 * washed out once actually typed as text on a white cell — yellow in
 * particular is the hardest hue to keep legible as text at any real
 * lightness, so it's pulled toward amber/gold here rather than a paler
 * yellow. Every swatch is still chosen to stay legible as *either* text or
 * a fill in both themes, the same tradeoff every spreadsheet tool's
 * user-chosen accent colors makes — not pixel-verified WCAG contrast for
 * every combination.
 */
export const CELL_COLOR_SWATCHES: ColorPickerSwatch[] = [
  { label: 'Red', value: '#dc2626' },
  { label: 'Orange', value: '#ea580c' },
  { label: 'Amber', value: '#b45309' },
  { label: 'Green', value: '#15803d' },
  { label: 'Teal', value: '#0d9488' },
  { label: 'Blue', value: '#2563eb' },
  { label: 'Purple', value: '#7c3aed' },
  { label: 'Pink', value: '#db2777' },
  { label: 'Gray', value: '#4b5563' },
];
