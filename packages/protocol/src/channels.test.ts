import { describe, expect, it } from 'vitest';
import * as protocol from './index.ts';
import {
  BUBBLE_INVOKE, BUBBLE_TO_MAIN, CHAT_INVOKE, CHAT_TO_MAIN, Channels, ERROR_HINTS,
  ErrorCodeSchema, InvokeChannels, InvokeRequest, InvokeResponse, KEY_INVOKE, KEY_TO_MAIN,
  MAIN_TO_BUBBLE, MAIN_TO_CHAT, MAIN_TO_KEY, MAIN_TO_PET, PET_INVOKE, PET_TO_MAIN,
  Schemas, parseEvent, parseInvokeRequest, parseInvokeResponse, type Channel,
} from './index.ts';

const CHANNEL_NAMES = new Set<string>(Object.values(Channels));

/** One well-formed and one malformed payload per Phase 2 send channel (contracts.md §2.3). */
const CASES: Array<[Channel, unknown, unknown]> = [
  [Channels.brainState, { state: 'thinking', turnId: 't1' }, { state: 'sleeping', turnId: 't1' }],
  [Channels.brainSentence,
    { turnId: 't1', seq: 0, text: '在呢。', emotion: 'happy' },
    { turnId: 't1', seq: 0, text: '在呢。', emotion: 'sleepy' }],
  [Channels.brainTurnDone,
    { turnId: 't1', usage: null, ttftMs: null, totalMs: 1200, complianceMiss: false, regenerated: false,
      lint: { violations: [], severity: 'none' } },
    { turnId: 't1', usage: null, ttftMs: null, complianceMiss: false, regenerated: false,
      lint: { violations: [], severity: 'none' } }],
  [Channels.brainError, { turnId: 't1', code: 'auth', message: '401' }, { turnId: 't1', code: 'teapot', message: '418' }],
  [Channels.hintShow,
    { text: '还没填 API Key', level: 'error', ttlMs: 6000 },
    { text: '还没填 API Key', level: 'error', ttlMs: 0 }],
  [Channels.avatarListening, { on: true }, { on: 'yes' }],
  [Channels.bubblePlace,
    { maxWidth: 460, maxHeight: 320, side: 'left', arrowOffset: 60 },
    { maxWidth: 0, maxHeight: 320, side: 'left', arrowOffset: 60 }],
  [Channels.chatOpened, { focusComposer: true }, { focusComposer: 'yes' }],
  [Channels.keyStatus,
    { present: true, source: 'store', lastTest: null },
    { present: true, source: 'keychain', lastTest: null }],
  [Channels.userCancel, {}, null],
  [Channels.playbackSentenceDone, { turnId: 't1', seq: 3 }, { turnId: 't1', seq: -1 }],
  [Channels.playbackTurnDone, { turnId: 't1' }, {}],
  [Channels.bubbleSize, { width: 320, height: 120 }, { width: 0, height: 120 }],
  [Channels.bubbleHover, { inside: false }, { inside: 1 }],
  [Channels.chatOpen, { source: 'bubble', focusComposer: true }, { source: 'menu', focusComposer: true }],
  [Channels.chatClose, {}, null],
  [Channels.chatComposing, { on: true }, {}],
  [Channels.chatResize, { rows: 6, historyOpen: true }, { rows: 7, historyOpen: true }],
  [Channels.speechMouth, { on: false }, {}],
  [Channels.speechComplete, {}, null],
];

describe('Phase 2 channel payloads', () => {
  it.each(CASES)('accepts a well-formed %s', (channel, good) => {
    expect(parseEvent(channel, good).ok).toBe(true);
  });

  it.each(CASES)('rejects a malformed %s', (channel, _good, bad) => {
    expect(parseEvent(channel, bad).ok).toBe(false);
  });
});

describe('channel table', () => {
  it('gives every channel a payload schema', () => {
    expect(Object.values(Channels).filter((c) => !(c in Schemas))).toEqual([]);
  });

  it('gives every invoke channel a request and a response schema', () => {
    expect(Object.values(InvokeChannels).filter((c) => !(c in InvokeRequest) || !(c in InvokeResponse))).toEqual([]);
  });

  it('keeps every allow-list inside the channel table', () => {
    const lists = [
      PET_TO_MAIN, MAIN_TO_PET, BUBBLE_TO_MAIN, MAIN_TO_BUBBLE,
      CHAT_TO_MAIN, MAIN_TO_CHAT, KEY_TO_MAIN, MAIN_TO_KEY,
    ];
    expect(lists.flatMap((l) => l.filter((c) => !CHANNEL_NAMES.has(c)))).toEqual([]);
  });

  it('pins every allow-list to contracts.md §2.5 (Phase 2 rows, then Phase 3 rows appended in place)', () => {
    expect(PET_TO_MAIN).toEqual([
      'avatar:hover', 'avatar:tap', 'avatar:drag', 'avatar:dragEnd',
      'stage:ready', 'stage:error', 'chat:open',
      'arb:grab', 'arb:release', 'arb:touch', 'arb:passthrough', 'arb:trace',
    ]);
    expect(MAIN_TO_PET).toEqual([
      'gaze:cursor', 'shell:visibility', 'stage:setFps',
      'debug:expression', 'debug:motion', 'debug:toggle',
      'brain:state', 'brain:sentence', 'brain:turnDone',
      'avatar:listening', 'speech:mouth',
      'sim:state', 'sim:event', 'sim:windowMotion', 'sim:landing', 'mode:changed',
    ]);
    expect(BUBBLE_TO_MAIN).toEqual([
      'playback:sentenceDone', 'playback:turnDone',
      'speech:mouth', 'bubble:size', 'bubble:hover', 'chat:open',
    ]);
    expect(MAIN_TO_BUBBLE).toEqual([
      'brain:state', 'brain:sentence', 'brain:turnDone', 'brain:error',
      'hint:show', 'bubble:place', 'shell:visibility', 'speech:complete',
      'sim:state', 'proactive:turn', 'mode:changed',
    ]);
    expect(CHAT_TO_MAIN).toEqual([
      'user:cancel', 'chat:close', 'chat:composing', 'chat:resize', 'speech:complete',
    ]);
    expect(MAIN_TO_CHAT).toEqual([
      'brain:state', 'brain:turnDone', 'brain:error', 'chat:opened', 'key:status',
      'proactive:turn', 'proactive:gate', 'mode:changed',
    ]);
    expect(KEY_TO_MAIN).toEqual(['chat:open']);
    expect(MAIN_TO_KEY).toEqual(['key:status']);
    expect(CHAT_INVOKE).toEqual(['user:text', 'history:list', 'history:delete']);
    expect(KEY_INVOKE).toEqual(['key:set', 'key:test', 'key:clear']);
    // D14 / §2.5: the pet and bubble windows never gain an invoke channel in Phase 3.
    expect(PET_INVOKE).toEqual([]);
    expect(BUBBLE_INVOKE).toEqual([]);
  });

  it('never lets one window reach another window\'s channels (D14, §1.5: proactive:* is main→chat only)', () => {
    expect(PET_TO_MAIN.filter((c) => /^(user|key|history|proactive):/.test(c))).toEqual([]);
    expect(PET_TO_MAIN).not.toContain(Channels.chatResize);
    expect(BUBBLE_TO_MAIN.filter((c) => /^(user|key|history|proactive):/.test(c))).toEqual([]);
    expect(KEY_TO_MAIN.filter((c) => /^(user|history|proactive):/.test(c))).toEqual([]);
    expect(CHAT_TO_MAIN.filter((c) => /^proactive:/.test(c))).toEqual([]);
    expect(CHAT_INVOKE).not.toContain(InvokeChannels.keySet);
    expect(KEY_INVOKE).not.toContain(InvokeChannels.userText);
  });

  it('has dropped the Phase 1 global allow-lists', () => {
    expect('RENDERER_TO_MAIN' in protocol).toBe(false);
    expect('MAIN_TO_RENDERER' in protocol).toBe(false);
  });
});

describe('invoke schemas', () => {
  it('defaults history:list limit to 50', () => {
    const r = parseInvokeRequest(InvokeChannels.historyList, {});
    expect(r.ok && r.data.limit).toBe(50);
  });

  it('rejects a user:text response that is missing the turnId', () => {
    expect(parseInvokeResponse(InvokeChannels.userText, { ok: true }).ok).toBe(false);
  });

  it('reports an unknown invoke channel instead of throwing', () => {
    const r = parseInvokeRequest('nope:nope' as never, {});
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain('unknown invoke channel');
  });

  it('bounds the key:set request at 8 and 200 characters', () => {
    expect(parseInvokeRequest(InvokeChannels.keySet, { apiKey: 'a'.repeat(8) }).ok).toBe(true);
    expect(parseInvokeRequest(InvokeChannels.keySet, { apiKey: 'a'.repeat(7) }).ok).toBe(false);
    expect(parseInvokeRequest(InvokeChannels.keySet, { apiKey: 'a'.repeat(201) }).ok).toBe(false);
  });
});

describe('ERROR_HINTS', () => {
  it('maps every error code to hint copy', () => {
    expect(Object.keys(ERROR_HINTS).sort()).toEqual([...ErrorCodeSchema.options].sort());
    expect(ERROR_HINTS.auth.text).toBe('API Key 无效，重新填一下');
    expect(ERROR_HINTS.auth.opensKeyWindow).toBe(true);
    expect(ERROR_HINTS.empty.text).toBe('');
    // A-38: a failed history append travels as brain:error{code:'storage'}; it never opens the key window.
    expect(ERROR_HINTS.storage).toEqual({ text: '刚才那句没记住，硬盘好像写不进去', level: 'warn', opensKeyWindow: false });
  });

  it('names no 设置 window anywhere in Phase 2 copy (C-10)', () => {
    expect(JSON.stringify(ERROR_HINTS)).not.toContain('设置');
  });
});

describe('Phase 3 channels (contracts §2.2, §2.3, §2.9)', () => {
  it('names the twelve §2.2 channels with their exact wire strings', () => {
    expect(Channels.simState).toBe('sim:state');
    expect(Channels.simEvent).toBe('sim:event');
    expect(Channels.simWindowMotion).toBe('sim:windowMotion');
    expect(Channels.simLanding).toBe('sim:landing');
    expect(Channels.proactiveTurn).toBe('proactive:turn');
    expect(Channels.proactiveGate).toBe('proactive:gate');
    expect(Channels.modeChanged).toBe('mode:changed');
    expect(Channels.arbGrab).toBe('arb:grab');
    expect(Channels.arbRelease).toBe('arb:release');
    expect(Channels.arbTouch).toBe('arb:touch');
    expect(Channels.arbPassthrough).toBe('arb:passthrough');
    expect(Channels.arbTrace).toBe('arb:trace');
  });

  it('keeps the retired avatar:drag / avatar:dragEnd rows in PET_TO_MAIN and Schemas (§2.9)', () => {
    // R3-5 removes the SENDERS; the channel, its schema and its allow-list row stay (Phase 2 §5.6 precedent).
    expect(PET_TO_MAIN).toContain(Channels.avatarDrag);
    expect(PET_TO_MAIN).toContain(Channels.avatarDragEnd);
    expect(PET_TO_MAIN).toContain(Channels.avatarTap);
    expect(parseEvent(Channels.avatarDrag, { dx: 1, dy: 1 }).ok).toBe(true);
    expect(parseEvent(Channels.avatarDragEnd, {}).ok).toBe(true);
  });

  it('adds no invoke channel in Phase 3 (§2.3 "No new invoke channels")', () => {
    expect(Object.values(InvokeChannels)).toEqual([
      'user:text', 'key:set', 'key:test', 'key:clear', 'history:list', 'history:delete',
    ]);
  });

  const P3_CASES: Array<[Channel, unknown, unknown]> = [
    [Channels.simState,
      { tsMain: 1000, presence: 'active', presentationMode: 'awake', phase: 'day', valence: 0.2, arousal: 0.5,
        energy: 80, affection: 12, liveliness: 0.3, userIdleS: 4, probableTyping: false, cursorNear: true,
        onFloor: true, nearEdge: false, dnd: false, battery: { charging: true, level: 0.9 }, mode: 'character',
        uiWorkMode: false, uiSfxMuted: false, localDate: '2026-08-30' },
      { tsMain: 1000, presence: 'asleep', presentationMode: 'awake', phase: 'day', valence: 0.2, arousal: 0.5,
        energy: 80, affection: 12, liveliness: 0.3, userIdleS: 4, probableTyping: false, cursorNear: true,
        onFloor: true, nearEdge: false, dnd: false, battery: { charging: true, level: 0.9 }, mode: 'character',
        uiWorkMode: false, uiSfxMuted: false, localDate: '2026-08-30' }],
    [Channels.simEvent, { kind: 'returned', tsMain: 5, awayMs: 400_000 }, { kind: 'returned', tsMain: 5, awayMs: 604_800_001 }],
    [Channels.simWindowMotion,
      { generation: 3, tsMain: 10, phase: 'drag', vx: 12.5, vy: -3, lagX: 4, lagY: 0, contact: { x: 0.1, y: -0.2 } },
      { generation: 3, tsMain: 10, phase: 'hover', vx: 12.5, vy: -3, lagX: 4, lagY: 0, contact: null }],
    [Channels.simLanding, { generation: 3, tsMain: 10, impulse: 900, edge: 'floor' }, { generation: 3, tsMain: 10, impulse: 900, edge: 'wall' }],
    [Channels.proactiveTurn,
      { turnId: 't1', reservationId: 'r1', templateId: 'greeting.morning.01', bucket: 'greeting' },
      { turnId: 't1', reservationId: 'r1', templateId: 'greeting.morning.01', bucket: 'random' }],
    [Channels.proactiveGate,
      { verdict: 'eligible', reason: '', displayedToday: 0, unansweredToday: 0, nextEligibleAt: null, mutedUntil: null },
      { verdict: 'eligible', reason: '', displayedToday: -1, unansweredToday: 0, nextEligibleAt: null, mutedUntil: null }],
    [Channels.modeChanged, { mode: 'plain', reason: 'command' }, { mode: 'plain', reason: 'hotkey' }],
    [Channels.arbGrab,
      { pressId: 1, part: 'head', modelX: 0.2, modelY: -0.4, screenX: 1200, screenY: 640 },
      { pressId: 1, part: 'head', modelX: 1.2, modelY: -0.4, screenX: 1200, screenY: 640 }],
    [Channels.arbRelease, { pressId: 1, wasTap: false }, { pressId: 1 }],
    [Channels.arbTouch,
      { pressId: 2, part: 'ticklish', alpha: 255, burst: 1, annoyed: false },
      { pressId: 2, part: 'ticklish', alpha: 256, burst: 1, annoyed: false }],
    [Channels.arbPassthrough, { faded: true }, { faded: 'yes' }],
    [Channels.arbTrace,
      { tsRenderer: 12.5, kind: 'blink', lane: null, source: null, generation: null, id: '', result: null, value: null, flag: true },
      { tsRenderer: 12.5, kind: 'dragVisual', lane: null, source: null, generation: null, id: '', result: null, value: null }],
  ];

  it.each(P3_CASES)('accepts a well-formed %s', (channel, good) => {
    expect(parseEvent(channel, good).ok).toBe(true);
  });

  it.each(P3_CASES)('rejects a malformed %s', (channel, _good, bad) => {
    expect(parseEvent(channel, bad).ok).toBe(false);
  });
});
