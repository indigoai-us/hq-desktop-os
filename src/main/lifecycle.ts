/** How the main window behaves when the user closes it. */
export type CloseBehavior = 'hide-to-tray' | 'quit';

/** How the app behaves once every window is gone. */
export type WindowsClosedBehavior = 'keep-running' | 'quit';

/**
 * Close the window into the tray only when the user opted in and a tray exists.
 * Explicit Quit sets `quitting` so this never hides.
 */
export function closeBehavior(input: {
  quitting: boolean;
  trayAvailable: boolean;
  closeToTray: boolean;
}): CloseBehavior {
  if (input.quitting) return 'quit';
  if (input.trayAvailable && input.closeToTray) return 'hide-to-tray';
  return 'quit';
}

/**
 * Without a tray (or with close-to-tray off), Linux/Windows quit when the last
 * window closes so sync cannot continue invisibly. Darwin keeps the app alive
 * until Quit (standard menu-bar apps).
 */
export function windowsClosedBehavior(input: {
  platform: NodeJS.Platform;
  trayAvailable: boolean;
  closeToTray: boolean;
}): WindowsClosedBehavior {
  if (input.platform === 'darwin') return 'keep-running';
  if (input.trayAvailable && input.closeToTray) return 'keep-running';
  return 'quit';
}

/**
 * Linux without tray support retains an accessible window: background hide is
 * refused and lifecycle stays window-driven.
 */
export function backgroundLifecycleMode(input: {
  trayAvailable: boolean;
  closeToTray: boolean;
}): 'hide-to-tray' | 'window-required' | 'quit-on-close' {
  if (!input.trayAvailable) return 'window-required';
  if (input.closeToTray) return 'hide-to-tray';
  return 'quit-on-close';
}

/** Tray menu Quit and app Quit both stop owned runtimes via ShutdownGate. */
export function quitStopsOwnedRuntimes(): true {
  return true;
}
