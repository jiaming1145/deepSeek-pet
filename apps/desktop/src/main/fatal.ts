import { app, dialog } from 'electron';

export const FATAL_TITLE = '小春打不开了';

/**
 * spec §8 / contracts.md §4.1: she never runs without persistence. A companion that silently
 * forgets everything is worse than one that says why it will not start, so this is a *blocking*
 * dialog (`showErrorBox`, not a Promise-returning `showMessageBox`) followed by a quit.
 */
export function fatal(message: string): void {
  dialog.showErrorBox(FATAL_TITLE, message);
  app.quit();
}
