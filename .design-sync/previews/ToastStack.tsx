import * as React from 'react';
import { ToastStack, Toast } from 'mindkraft-ds';
import { Viewport } from './_page';

/**
 * Three toasts stacked, newest first, pinned top-centre where the app puts
 * them. The stack is `position: fixed`, so this cell gives it a phone-sized
 * viewport to pin against.
 */
export const Stacked = () => (
  <Viewport height={300}>
    <ToastStack>
      <Toast message="Read 20 pages completed · +20 XP" color="green" />
      <Toast message="Streak saved — 1 shield used" color="blue" />
      <Toast message="Group deleted" color="olive" />
    </ToastStack>
  </Viewport>
);

/** A single toast in place — the common case. */
export const Single = () => (
  <Viewport height={220}>
    <ToastStack>
      <Toast message="Morning Walk completed · +15 XP" color="green" />
    </ToastStack>
  </Viewport>
);
