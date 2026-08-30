import type { PersonaModeIpc } from '@ds/protocol';

/** R3-12: NFKC, trim, fullwidth <-> ASCII bracket equivalence, collapse internal whitespace. */
export function normalizeCommand(raw: string): string {
  return raw
    .normalize('NFKC')
    .replace(/[【]/g, '[').replace(/[】]/g, ']')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Recognised ONLY as the WHOLE message. A message that merely CONTAINS the token is ordinary
 *  text — a quoted discussion of the command must never flip the mode (R3-12). */
export const TIMEOUT_SIGNAL_RE = /^[\[]?\s*TIMEOUT_SIGNAL\s*[\]]?$/;

/** Persona mode: the message STARTS with the marker; the rest of the message is ignored. */
export const PERSONA_LOAD_PREFIX = '[PERSONA_LOAD]';

export type ModeCommand = { mode: PersonaModeIpc } | null;

/** The one classifier. Returns null for every ordinary message. */
export function matchModeCommand(raw: string): ModeCommand {
  const s = normalizeCommand(raw);
  if (TIMEOUT_SIGNAL_RE.test(s)) return { mode: 'plain' };
  if (s.startsWith(PERSONA_LOAD_PREFIX)) return { mode: 'character' };
  return null;
}

// §8.9: the memory commands are intercepted in main BEFORE the text reaches the brain, exactly
// like TIMEOUT_SIGNAL above. Whole-message only; anchored.
export const MEMORY_COMMANDS = {
  remember: /^(记住这个|记住这句|记一下)[。．.!！]?$/,
  forget:   /^(忘掉这个|忘了这个|别记这个)[。．.!！]?$/,
} as const;

export function matchMemoryCommand(text: string): 'remember' | 'forget' | null {
  const s = normalizeCommand(text);
  if (MEMORY_COMMANDS.remember.test(s)) return 'remember';
  if (MEMORY_COMMANDS.forget.test(s)) return 'forget';
  return null;
}
