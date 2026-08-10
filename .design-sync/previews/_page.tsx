import * as React from 'react';

/**
 * Preview scaffolding — NOT part of the design system.
 *
 * The preview-card harness paints its own `body{background:#fff}`, which wins
 * over style.css's `body` rule. Mindkraft is dark-first and many of its
 * surfaces are translucent (`--surface-card-muted`, `--recessed-bg`, the
 * `gc-done` states), so on a white body they composite into pale grey and the
 * card lies about how the component looks.
 *
 * `Page` restores the app's real canvas: `--color-bg-primary` plus the three
 * radial glows the `body` rule in style.css draws, copied verbatim from it.
 * In a design actually built with this DS none of this is needed — the page
 * gets it from `body`.
 */
export const Page = ({
  children,
  pad = 14,
}: {
  children?: React.ReactNode;
  pad?: number;
}): React.ReactElement => (
  <div
    style={{
      backgroundColor: 'var(--color-bg-primary)',
      backgroundImage: [
        'radial-gradient(ellipse 100% 55% at var(--glow-a-x) var(--glow-a-y), var(--color-bg-glow-a) 0%, transparent 60%)',
        'radial-gradient(ellipse 60% 50% at 50% 50%, var(--color-bg-glow-m) 0%, transparent 65%)',
        'radial-gradient(ellipse 70% 60% at var(--glow-b-x) var(--glow-b-y), var(--color-bg-glow-b) 0%, transparent 60%)',
      ].join(','),
      color: 'var(--color-text-primary)',
      padding: pad,
      borderRadius: 10,
      minHeight: 40,
    }}
  >
    {children}
  </div>
);

// No light-mode helper on purpose: `data-theme-mode` lives on the document
// element, so a light cell would flip every other cell on the same card. Light
// mode is documented in the conventions header instead.

/**
 * Preview scaffolding for the `position: fixed` components (`Modal`,
 * `ToastStack`).
 *
 * The card harness puts `transform: translateZ(0)` on the cell, which makes it
 * the containing block for fixed descendants — and the cell's own box has no
 * height, so a centred overlay lands on a zero-height line and gets cropped.
 * This wrapper takes the containing block back with a real height, which is
 * what a phone viewport gives the overlay in the app.
 */
export const Viewport = ({
  children,
  height = 560,
}: {
  children?: React.ReactNode;
  height?: number;
}): React.ReactElement => (
  <div
    style={{
      position: 'relative',
      transform: 'translateZ(0)',
      height,
      borderRadius: 10,
      overflow: 'hidden',
      backgroundColor: 'var(--color-bg-primary)',
    }}
  >
    {children}
  </div>
);
