import type { CharacterBundle } from '@ds/brain';

/** The one accessor. Phase 3 strings interpolate this, never a literal (R3-19). */
export function personaName(bundle: CharacterBundle): string { return bundle.card.name; }
