import { app, BrowserWindow, globalShortcut, powerMonitor, screen, type Tray } from 'electron';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { Channels } from '@ds/protocol';
import { parseCharacterBundle, type CharacterBundle } from '@ds/brain';
import { HistoryStore, MemoryOpenError, RunningSummary, openDb } from '@ds/memory';
import { registerAppScheme, serveRenderer } from './app-protocol';
import { BrainService } from './brain-service';
import { createBubbleWindow, hideBubble, showBubble } from './bubble-window';
import { closeChat, createChatWindow, openChat } from './chat-window';
import { startCursorPolling, type CursorPolling } from './cursor';
import { fatal } from './fatal';
import { startForegroundWatch, type ForegroundWatch } from './foreground';
import { useFakeBrain } from './fake-client';
import { onFromAny, onFromPet, sendTo, sendToPet } from './ipc';
import { KeyStore } from './key-store';
import {
  createKeyWindow, holdWindowOpen, markQuitting, openKeyWindow, type KeyWindowReason,
} from './key-window';
import {
  createPetWindow, handleLoadFailure, moveBy, reconcileDisplays, savePetPosition, setClickThrough,
} from './pet-window';
import { makeSummarizer } from './summarizer';
import { createTray } from './tray';
import { createVisibilityController } from './visibility-state';

// userData must be %APPDATA%\ds, not %APPDATA%\@ds\desktop (the package name). This is also what
// puts ds.sqlite and key.bin in %APPDATA%\ds.
app.setName('ds');
registerAppScheme(); // must happen before the app is ready

let pet: BrowserWindow | null = null;
let bubble: BrowserWindow | null = null;
let chat: BrowserWindow | null = null;
let keyWin: BrowserWindow | null = null;
let tray: Tray | null = null; // held so the icon is not garbage-collected
let cursorPolling: CursorPolling | null = null;
let foreground: ForegroundWatch | null = null;
let brain: BrainService | null = null;
let db: DatabaseSync | null = null;

/**
 * The single owner of the pet window's visibility. Four independent reasons she can be off screen,
 * OR-ed together; `locked` and `suspended` are tracked separately (not merged into one "system"
 * flag) because real Windows lock+sleep is lock-screen -> suspend -> resume -> (lock screen still
 * showing) -> unlock-screen, and a merged flag would clear at `resume` and reveal her behind the
 * still-locked screen.
 *
 * Everything that shows or hides her routes through `visibility.apply()` — including the window's
 * own `ready-to-show`, which is why `createPetWindow` does not show itself.
 *
 * R3 / contracts.md §5.4 rule 5: the bubble and chat windows follow the same verdict. They are only
 * ever *hidden* from here — the bubble reappears when she has something to say, never because a
 * screen unlocked. `apply()` and `resend()` both route through `send`, and both arms below are
 * idempotent, so a renderer resync can never reveal a surface the shell has hidden.
 */
const visibility = createVisibilityController({
  window: () => pet,
  send: (verdict) => {
    if (pet) sendToPet(pet, Channels.shellVisibility, verdict);
    if (bubble && !bubble.isDestroyed()) {
      sendTo(bubble, Channels.shellVisibility, verdict);
      // Both edges: hide on hidden, and re-show on the hidden→shown edge when the brain still wants
      // her speaking. Without the second half a first message that landed while the verdict was
      // hidden painted into a window that never became visible (found by T7 on a cold profile).
      applyBubbleVisibility();
    }
    if (verdict.hidden && chat) closeChat(chat);
  },
  setCursorPaused: (paused) => cursorPolling?.setPaused(paused),
  // Both of these are Phase 1 options and both are load-bearing. `setClickThrough` forces the pet
  // window's native click-through on every hide — the regression `visibility-state.ts` documents
  // in prose ("a window hidden while interactive would otherwise come back with transparent pixels
  // eating clicks") — and `recheckCursor` re-reads the pointer the moment she is shown again
  // instead of waiting out the poll interval. They are OPTIONAL in `VisibilityDeps`, so leaving
  // them out typechecks cleanly and no test fails; that is exactly why they must be checked by
  // name here. `setClickThrough` is imported for this and for the `avatar:hover` handler below.
  setClickThrough: (ignore) => { if (pet) setClickThrough(pet, ignore); },
  recheckCursor: () => cursorPolling?.recheck(),
});

/**
 * The bubble window's only show path (contracts.md §6.6's `setBubbleVisible`). It loses to
 * VisibilityState by construction: nothing she has to say outranks a locked screen or a fullscreen
 * game, so a `true` while hidden is a no-op rather than a show.
 */
let bubbleWanted = false;
function setBubbleVisible(on: boolean): void {
  // Remember the brain's wish even when it cannot be honoured right now (window not created yet,
  // or the shell verdict hidden); applyBubbleVisibility() replays it on every edge that matters.
  bubbleWanted = on;
  applyBubbleVisibility();
}

/** Idempotent: derives the bubble window's visibility from (brain wants it) AND (shell allows it). */
function applyBubbleVisibility(): void {
  if (!bubble || bubble.isDestroyed()) return;
  if (bubbleWanted && !visibility.verdict.hidden) showBubble(bubble);
  else hideBubble(bubble);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    visibility.set('user', false);
    visibility.apply();
  });

  app.whenReady().then(() => {
    serveRenderer(join(__dirname, '../renderer'));

    // spec §8 / contracts.md §4.1: she never runs without persistence. A companion that silently
    // forgets everything is worse than one that says why it will not start, so an open failure is
    // a blocking dialog and a quit, not a degraded mode.
    const dbPath = join(app.getPath('userData'), 'ds.sqlite');
    try {
      db = openDb(dbPath);
    } catch (err) {
      fatal(err instanceof MemoryOpenError ? err.message : `无法打开数据库：${dbPath}\n${String(err)}`);
      return;
    }
    const database = db;

    // A36: dev reads the repo copy, a packaged build reads the one in resources. The renderer keeps
    // using its own public/characters copy for the model assets; the two diverge after T3 and that
    // is correct — the renderer never reads `card`.
    const bundlePath = app.isPackaged
      ? join(process.resourcesPath, 'characters', 'haru', 'character.json')
      : join(__dirname, '../../../../characters/haru/character.json');
    let bundle: CharacterBundle;
    try {
      bundle = parseCharacterBundle(JSON.parse(readFileSync(bundlePath, 'utf8')));
    } catch (err) {
      fatal(`角色卡读不了：${bundlePath}\n${String(err)}`);
      return;
    }

    const petWin = createPetWindow({
      // Not `showInactive()`: the first paint asks the visibility owner whether she may appear, so
      // a hide that landed during renderer startup is honoured instead of being overridden.
      onReadyToShow: () => visibility.apply(),
      onLoadFailure: (err) =>
        handleLoadFailure(err, {
          destroyWindow: () => {
            pet?.destroy();
            pet = null;
          },
          stopCursor: () => cursorPolling?.stop(),
          stopForeground: () => foreground?.stop(),
          destroyTray: () => {
            tray?.destroy();
            tray = null;
          },
          quit: () => app.quit(),
        }),
    });
    pet = petWin;

    // All three are created eagerly and kept hidden: that is what makes C8's "opens <= 250 ms"
    // reachable, and C2's zero-white-frame bar depends on backgroundColor '#00000000' + show:false
    // being present on every one of them.
    const bubbleWin = createBubbleWindow();
    bubble = bubbleWin;
    // A first message can be requested before the window exists (brain service starts on db open).
    applyBubbleVisibility();
    const chatWin = createChatWindow();
    chat = chatWin;
    const keyWindow = createKeyWindow();
    keyWin = keyWindow;
    // The key renderer closes itself with window.close(), and the focusable chat window can catch a
    // stray Alt+F4. Both are converted to hide() until before-quit calls markQuitting().
    holdWindowOpen(chatWin);
    holdWindowOpen(keyWindow);

    const keyStore = new KeyStore();
    const summary = new RunningSummary(database);
    const store = new HistoryStore({
      db: database,
      summary,
      // The client is rebuilt on every key change, so the summarizer reads it live rather than
      // capturing one. §4.3: a throwing `summarize` is logged and the turn proceeds untrimmed.
      summarize: async (oldSummary, dropped) => {
        const client = brain?.currentClient();
        if (!client) throw new Error('[summary] no brain client; skipping this trim');
        return makeSummarizer(client, bundle.card.name)(oldSummary, dropped);
      },
    });

    // §6.5: `key:status` is pushed once whenever the key window is opened, not only on its one
    // `ready-to-show`, because a hidden-then-reshown window fires no second ready-to-show.
    const showKeyWindow = (reason: KeyWindowReason): void => {
      openKeyWindow(keyWindow, reason);
      brain?.refreshKeyStatus();
    };

    const service = new BrainService({
      pet: petWin,
      bubble: bubbleWin,
      chat: chatWin,
      key: keyWindow,
      db: database,
      store,
      keyStore,
      bundle,
      setBubbleVisible,
      openKeyWindow: showKeyWindow,
    });
    brain = service;
    service.start();
    keyWindow.once('ready-to-show', () => service.refreshKeyStatus());

    cursorPolling = startCursorPolling(petWin);
    foreground = startForegroundWatch(petWin, (hide) => {
      visibility.set('fullscreen', hide);
      visibility.apply();
    });

    // The screen lock and sleep both leave the window on a surface nobody can see while the
    // renderer keeps drawing; stopping it is the whole point of forwarding these.
    powerMonitor.on('lock-screen', () => {
      console.log('[power] lock-screen');
      visibility.set('locked', true);
      visibility.apply();
    });
    powerMonitor.on('suspend', () => {
      console.log('[power] suspend');
      visibility.set('suspended', true);
      visibility.apply();
    });
    powerMonitor.on('unlock-screen', () => {
      console.log('[power] unlock-screen');
      visibility.set('locked', false);
      visibility.apply();
      // The foreground state can have changed entirely while the lock screen was up; do not wait
      // out the poll interval to find out.
      foreground?.recheck();
    });
    powerMonitor.on('resume', () => {
      console.log('[power] resume');
      visibility.set('suspended', false);
      visibility.apply();
      foreground?.recheck();
    });

    onFromPet(petWin, Channels.avatarHover, ({ inside }, win) => setClickThrough(win, !inside));
    onFromPet(petWin, Channels.avatarDrag, ({ dx, dy }, win) => {
      moveBy(win, dx, dy);
      service.reposition(); // §5.4 rule 3: the bubble follows her across the screen
    });
    onFromPet(petWin, Channels.avatarDragEnd, (_payload, win) => {
      savePetPosition(win);
      service.reposition();
    });
    // C-12: a single tap stays a reaction. Opening the chat is the double-click, the bubble click,
    // the tray item and the hotkey.
    onFromPet(petWin, Channels.avatarTap, ({ hitArea }) => console.log('[pet] tap', hitArea));
    onFromPet(petWin, Channels.stageReady, (info) => {
      console.log('[pet] stage ready', info);
      // `shell:visibility` is a one-shot notification and the renderer only installs its listener
      // after the Live2D model finishes loading, so any verdict issued during those ~1000 ms landed
      // on nobody. `stage:ready` is the sync point: replay the verdict (and the cursor position,
      // which a fresh renderer also knows nothing about). Also covers a reload.
      visibility.resend();
      cursorPolling?.recheck();
    });
    onFromPet(petWin, Channels.stageError, ({ message }) => console.error('[pet] stage error', message));

    // Three windows may legitimately send this one (contracts.md §2.7), so it gets one listener.
    onFromAny([petWin, bubbleWin, keyWindow], Channels.chatOpen, ({ source, focusComposer }) => {
      console.log('[chat] open source=%s', source);
      if (source === 'key' && !keyWindow.isDestroyed()) keyWindow.hide();
      openChat(chatWin, petWin, focusComposer);
    });

    tray = createTray({
      toggleVisible: () => {
        visibility.set('user', !visibility.get('user'));
        visibility.apply();
      },
      toggleDebug: () => {
        console.log('[tray] debug:toggle');
        sendToPet(petWin, Channels.debugToggle, {});
      },
      openChat: () => openChat(chatWin, petWin, true),
      openKey: () => showKeyWindow('user'),
      quit: () => app.quit(),
    });

    if (!globalShortcut.register('Control+Shift+Space', () => openChat(chatWin, petWin, true))) {
      console.error('[hotkey] Ctrl+Shift+Space is already taken by another app');
    }

    // Registered here, not at module scope: `electron.screen` throws
    // "The 'screen' module can't be used before the app 'ready' event" the moment it is *accessed*,
    // and Electron 43 evaluates the main entry through the ESM loader before `ready`. Phase 1 put
    // these two lines at module scope, which made the built app die during load with that error on
    // every invocation form (`electron .` and `electron out/main/index.cjs` both reproduce it on
    // ccd5355, before any T6 change). `onDisplaysChanged` and the `before-quit` removals stay
    // exactly where Phase 1 put them, so the capability and its teardown are unchanged.
    screen.on('display-removed', onDisplaysChanged);
    screen.on('display-metrics-changed', onDisplaysChanged);

    // First run with no key at all: the key window is the only door, and Phase 2 has no settings
    // window to send anyone to (C-10). The fake brain needs no key, so it skips this.
    if (!useFakeBrain(app.isPackaged, process.env) && keyStore.get() === null) {
      showKeyWindow('first-run');
    }
  }).catch((err: unknown) => {
    // Without this, a throw in startup only surfaces as an unhandled rejection warning and the
    // app sits there half-wired.
    console.error('[main] startup failed', err);
    app.quit();
  });

  app.on('window-all-closed', () => {
    /* keep running in the tray */
  });

  // Phase 1's block, kept verbatim in its Phase 1 position, plus exactly one added line. A monitor
  // unplugged (or rescaled) under her: clampDrag only runs on the next drag event and
  // clampToDisplays only at startup, so without this she can stay stranded on a display that is
  // gone — where no drag can reach her and the tray's show does nothing. `display-removed` is the
  // event that actually fires on an unplug, so registering only `display-metrics-changed` silently
  // deletes the capability. The added line is the bubble's: the same work-area change moves the
  // ground under both surfaces (§5.4 rule 3).
  const onDisplaysChanged = (): void => {
    if (pet && reconcileDisplays(pet)) console.log('[pet] moved back onto a live display');
    brain?.reposition();
  };
  // The two `screen.on` registrations live inside `app.whenReady()` above — see the comment there.

  app.on('before-quit', () => {
    screen.removeListener('display-removed', onDisplaysChanged);
    screen.removeListener('display-metrics-changed', onDisplaysChanged);
    // Release the close→hide hold first, or destroy() below fights holdWindowOpen.
    markQuitting();
    // Safety net: a drag whose mouseup lands outside the window can lose its avatar:dragEnd.
    if (pet) savePetPosition(pet);
    globalShortcut.unregisterAll();
    brain?.dispose();
    brain = null;
    cursorPolling?.stop();
    foreground?.stop();
    tray?.destroy();
    tray = null;
    for (const win of [bubble, chat, keyWin]) win?.destroy();
    bubble = null;
    chat = null;
    keyWin = null;
    db?.close();
    db = null;
  });
}
