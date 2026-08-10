/**
 * Shared vocabulary for the Mindkraft design system.
 *
 * These values are copied from the app's own constants (`DIM_HEX_MAP` and
 * `DIM_COLOR_ORDER` in app.js) so a component styled by dimension resolves to
 * the same hex the product uses.
 */

/** The ten dimension colours an activity can belong to. */
export type DimensionColor =
  | 'blue'
  | 'red'
  | 'green'
  | 'olive'
  | 'purple'
  | 'teal'
  | 'amber'
  | 'rose'
  | 'indigo'
  | 'sage';

/** Dimension colour → hex, verbatim from app.js `DIM_HEX_MAP`. */
export const DIMENSION_HEX: Record<DimensionColor, string> = {
  blue: '#4a7c9e',
  red: '#8e3b5f',
  green: '#6b7c3f',
  olive: '#7a7b4d',
  purple: '#7a5d9e',
  teal: '#3f8a87',
  amber: '#b88242',
  rose: '#c26a7a',
  indigo: '#5a6ba8',
  sage: '#6b8b6f',
};

/** Canonical picker order, verbatim from app.js `DIM_COLOR_ORDER`. */
export const DIMENSION_ORDER: DimensionColor[] = [
  'blue',
  'green',
  'olive',
  'red',
  'teal',
  'sage',
  'purple',
  'indigo',
  'rose',
  'amber',
];

/** "R,G,B" for a hex, mirroring app.js `_dimRgb`. */
export function dimensionRgb(hex: string): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '#4a7c9e');
  if (!m) return '74,124,158';
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)].join(',');
}

/** Inline custom-property pair every dimension-tinted surface sets. */
export function dimensionStyle(color?: DimensionColor): Record<string, string> {
  if (!color) return {};
  const hex = DIMENSION_HEX[color];
  return { '--dim-color': hex, '--dim-rgba': `rgba(${dimensionRgb(hex)},0.36)` };
}

/** Join class names, dropping falsy entries. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
