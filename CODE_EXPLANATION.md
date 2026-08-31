# Complete DS Desktop App Code Walkthrough
## Learn Every Line - Rebuild Everything

This guide explains how to build a desktop pet app with Live2D avatar and LLM brain from scratch, starting with the architecture and then walking through every single line of code.

---

## PART 1: ARCHITECTURE & FIRST STEPS

### Step 1: Understanding the Overall Architecture

**What you're building:**
- A desktop application (using Electron - which is basically a mini browser + Node.js runtime)
- A pet character sits in a corner of your screen all day
- She has 4 separate UI windows that can show/hide independently
- She talks to you through an AI brain (DeepSeek LLM)
- She remembers conversations in a local database

**The Four Windows:**

1. **Pet Window** - The avatar itself (Live2D model)
   - Always on top, transparent, click-through when hovering over empty space
   - Shows the character's appearance
   - Detects mouse interactions (hover, click, drag)

2. **Bubble Window** - Speech bubbles
   - Appears near the pet when she has something to say
   - Shows dialogue text
   - Hidden when pet is hidden (lock screen, fullscreen game, etc.)

3. **Chat Window** - Text input/output
   - User can type messages to the pet
   - Displays conversation history
   - Can be resized and moved

4. **Key Window** - Settings/First run
   - Let user input their DeepSeek API key
   - Shows status information

**Why separate windows?**
- Pet window can be click-through and always visible
- Bubble and chat windows can hide without hiding the pet
- Each window can be crashed/reloaded independently
- Better memory management and responsiveness

### Step 2: How the App Launches

The first line of code you write is:
```typescript
import { app, BrowserWindow, globalShortcut, powerMonitor, screen, type Tray } from 'electron';
```

This imports the core Electron APIs needed to:
- `app` - Control the application lifecycle (start, quit, ready)
- `BrowserWindow` - Create windows
- `globalShortcut` - Listen for keyboard shortcuts (Ctrl+Shift+Space)
- `powerMonitor` - Detect lock screen, sleep, wake
- `screen` - Manage multi-monitor setups
- `Tray` - Show icon in system tray

Then you import your own modules:
```typescript
import { Channels } from '@ds/protocol';
import { parseCharacterBundle, type CharacterBundle } from '@ds/brain';
import { HistoryStore, MemoryOpenError, RunningSummary, openDb } from '@ds/memory';
```

These are local packages that handle:
- `Channels` - Constants for IPC (Inter-Process Communication) message types
- `parseCharacterBundle` - Parse the Live2D model config JSON
- `HistoryStore`, `openDb` - Database access for conversations

---

## PART 2: THE MAIN INDEX.TS FILE - LINE BY LINE EXPLANATION

### Section 1: Initialization (Lines 1-50)

```typescript
// LINE 40: Set the userData folder to %APPDATA%\ds
app.setName('ds');
```
This tells Electron where to store app data. Instead of `%APPDATA%\@ds\desktop`, it uses `%APPDATA%\ds`, which is where the SQLite database `ds.sqlite` will live.

```typescript
// LINE 42: Register the custom app:// protocol
registerAppScheme(); // must happen before the app is ready
```
This sets up a custom protocol handler so the renderer can load pages with `app://` URLs instead of `file://`. This is a security best practice - it sandboxes the renderer.

```typescript
// LINES 45-52: Create global variables to hold window references
let pet: BrowserWindow | null = null;
let bubble: BrowserWindow | null = null;
let chat: BrowserWindow | null = null;
let keyWin: BrowserWindow | null = null;
let tray: Tray | null = null;
```

**Why hold these in variables?**
- Electron windows are garbage-collected if you don't keep a reference
- If a window is garbage-collected, its content disappears even though it's still showing
- These variables keep references alive throughout the app's lifetime

```typescript
// LINES 59-60: Create the "late-bound" chat request holder
const chatRequest = createLateBoundChatRequest();
```

**What's "late-bound"?**
- If the user launches the app a second time before the first launch finishes, they're asking for the chat to open
- But the chat window might not be created yet
- This holder captures that request and replays it once everything is ready
- This is why it's called "late-bound" - the binding happens later

### Section 2: Visibility Controller (Lines 62-90)

```typescript
// LINE 62-73: Create the visibility system
const visibility = createVisibilityController({
  window: () => pet,
  send: (verdict) => {
    if (pet) sendToPet(pet, Channels.shellVisibility, verdict);
    if (bubble && !bubble.isDestroyed()) {
      sendTo(bubble, Channels.shellVisibility, verdict);
      bubbleVis.apply();
    }
    if (verdict.hidden && chat) closeChat(chat);
    keyRequest?.onVerdict();
  },
```

**What does the visibility controller do?**

The pet should hide in these situations:
1. Lock screen is on
2. System is suspended (sleeping)
3. Fullscreen app is running (game, video)
4. User clicked to hide her

The visibility system tracks ALL FOUR of these reasons separately. Why?

Because the sequence on Windows is:
```
User locks screen (lock=true, others=false) -> System sleeps (suspend=true) -> User wakes -> Lock screen still showing -> User unlocks
```

If you merged `lock` and `suspend` into one flag, waking from sleep would immediately show the pet behind the still-locked screen!

When visibility changes, it:
- Tells the pet window to hide/show (through IPC channel `Channels.shellVisibility`)
- Tells the bubble to hide (the bubble should never show while pet is hidden)
- Closes the chat if it was hidden
- Tells the key request handler to show any waiting key prompts

### Section 3: Bubble Visibility (Lines 115-120)

```typescript
// LINE 115: The bubble has its own visibility tracker
const bubbleVis = createBubbleVisibility({
  window: () => bubble,
  shellHidden: () => visibility.verdict.hidden,
```

**Why does the bubble need its own visibility tracker?**

The bubble can hide for TWO reasons:
1. The shell told it to hide (lock screen, fullscreen, etc.)
2. The brain has nothing to say (the pet isn't speaking)

The bubble should only SHOW if BOTH conditions are false:
- Shell says it's OK to show
- AND the brain has something to say

So `bubbleVis` tracks the "brain wants to say something" state separately from the shell's visibility verdict.

### Section 4: Single Instance Check (Lines 122-124)

```typescript
// LINE 122-124: Make sure only one instance of the app runs
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
```

**Why?**

If you launch the app twice, you'd have two copies:
- Two databases trying to access the same file (corruption)
- Two tray icons
- Two sets of windows

So Electron's `requestSingleInstanceLock()` ensures only one instance can run. The second instance is rejected and the first one gets a `second-instance` event (handled later).

### Section 5: App Ready (Lines 125-170)

```typescript
// LINE 127: Wait for Electron to be ready
app.whenReady().then(() => {
  // LINE 128: Start serving the renderer
  serveRenderer(join(__dirname, '../renderer'));
```

The renderer files (HTML, CSS, JS for the React UIs) need to be served. This starts a small web server that serves them at `app://` URLs.

```typescript
  // LINE 132: Try to open the database
  const dbPath = join(app.getPath('userData'), 'ds.sqlite');
  try {
    db = openDb(dbPath);
  } catch (err) {
    fatal(err instanceof MemoryOpenError ? err.message : `无法打开数据库：${dbPath}\n${String(err)}`);
    return;
  }
```

**What's happening here?**
- Get the path to the database file
- Try to open it
- If it fails, call `fatal()` which shows a dialog with the Chinese error message and quits
- **Why not continue in a degraded mode?** The spec says "a companion that silently forgets everything is worse than one that says why it will not start"

```typescript
  // LINE 144: Load the character bundle (Live2D model config)
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
```

**What's `app.isPackaged`?**
- When running in development: `false` - read from `characters/haru/` in the repo
- When packaged as a Windows .exe: `true` - read from the resources folder inside the exe

This loads the character's configuration (name, appearance, personality traits, etc.) which will be used by the AI and renderer.

### Section 6: Startup Cleanup Manager (Lines 152-170)

```typescript
  // LINE 152: Define cleanup functions for when startup fails
  const startupCleanup: StartupCleanup = {
    destroyWindow: () => {
      for (const win of [pet, bubble, chat, keyWin]) 
        if (win && !win.isDestroyed()) win.destroy();
      pet = null;
      bubble = null;
      chat = null;
      keyWin = null;
    },
    stopCursor: () => cursorPolling?.stop(),
    stopForeground: () => foreground?.stop(),
    destroyTray: () => {
      tray?.destroy();
      tray = null;
    },
    quit: () => app.quit(),
  };
```

**Why is this needed?**

If any window fails to load (web server is down, bad build, broken URL), you need to clean up everything and quit. Otherwise, you'd have:
- A working tray icon
- But a half-dead app behind it
- User can't recover

This object holds all the cleanup steps that will be called if any renderer document fails to load.

### Section 7: Pet Window Creation (Lines 172-180)

```typescript
  const onLoadFailure = (surface: string) => (err: unknown): void => {
    console.error('[%s] renderer document failed to load', surface);
    handleLoadFailure(err, startupCleanup);
  };

  const petWin = createPetWindow({
    onReadyToShow: () => visibility.apply(),
    onLoadFailure: onLoadFailure('pet'),
  });
  pet = petWin;
```

**What's `onReadyToShow`?**

When the window is first created, it's invisible. Once the renderer page loads and is ready to paint, it fires `ready-to-show`. At this point:
- The visibility controller should decide if she should appear
- Call `visibility.apply()` to enforce the current verdict (locked? fullscreen? hidden by user?)

The pet window is NOT shown with `show()` - it's shown through the visibility system so that a lock screen during startup is respected.

```typescript
  /** The `chat:open` allow-list — pet, bubble, key — kept current across recreations (CX-6/7). */
  const chatOpenSenders: BrowserWindow[] = [petWin];
```

This tracks which windows are allowed to trigger the chat. It starts with just the pet window, but bubble and key will be added once they're created.

### Section 8: Bubble Window Creation (Lines 186-210)

```typescript
  const bubbleHooks: BubbleWindowHooks = {
    onLoadFailure: onLoadFailure('bubble'),
    onCrash: () => brain?.bubbleCrashed(),
    onReloaded: () => {
      brain?.reposition(true);
      visibility.resend();
    },
    onUnrecoverable: () => setImmediate(recreateBubble),
  };
```

**What are these hooks?**

- `onCrash`: The bubble renderer crashed, tell the brain to cancel whatever it was saying
- `onReloaded`: After a crash, it auto-reloads. Once reloaded, reposition the bubble and resend visibility status
- `onUnrecoverable`: Two crashes is too many, create a completely new window

```typescript
  const recreateBubble = (): void => {
    const old = bubble;
    bubble = null;
    if (old && !old.isDestroyed()) old.destroy();
    if (!brain) return; // quitting
    const fresh = createBubbleWindow(bubbleHooks);
    bubble = fresh;
    brain.replaceBubble(fresh);
    if (old) chatOpenSenders.splice(chatOpenSenders.indexOf(old), 1);
    chatOpenSenders.push(fresh);
    bubbleVis.apply();
  };
```

**What's happening?**
1. Destroy the old bubble window
2. Create a new bubble window
3. Tell the brain service to use the new window
4. Update the chat-open senders list (remove old, add new)
5. Apply visibility rules to the fresh window

```typescript
  const bubbleWin = createBubbleWindow(bubbleHooks);
  bubble = bubbleWin;
  chatOpenSenders.push(bubbleWin);
  bubbleVis.apply();
```

Create the initial bubble window and tell it to apply visibility rules (it will be hidden initially).

### Section 9: Chat and Key Window Creation (Lines 212-235)

```typescript
  const chatWin = createChatWindow({
    onLoadFailure: onLoadFailure('chat'),
    onUnrecoverable: () => fatal('聊天窗口崩溃了，重启后也没能恢复。请重新打开小春。'),
  });
  chat = chatWin;
```

Chat window is created early and hidden. A double-crash is fatal (error message says "chat window crashed and recovery failed").

```typescript
  let keyCrashed = false;
  const keyHooks = {
    onLoadFailure: onLoadFailure('key'),
    onCrash: () => {
      keyCrashed = true;
    },
  };
  keyWin = createKeyWindow(keyHooks);
  chatOpenSenders.push(keyWin);
  
  holdWindowOpen(chatWin);
  holdWindowOpen(keyWin);
```

**What does `holdWindowOpen` do?**

By default, when a user clicks the X button, Electron closes the window. But this app wants close to mean "hide". So `holdWindowOpen` converts `close` events to `hide` events. This is reverted during quit with `markQuitting()`.

### Section 10: Data Stores (Lines 237-260)

```typescript
  const keyStore = new KeyStore();
  const summary = new RunningSummary(database);
  const store = new HistoryStore({
    db: database,
    summary,
    summarize: async (oldSummary, dropped) => {
      const client = brain?.currentClient();
      if (!client) throw new Error('[summary] no brain client; skipping this trim');
      return makeSummarizer(client, bundle.card.name)(oldSummary, dropped);
    },
  });
  history = store;
```

**What are these?**

- `KeyStore` - Stores the DeepSeek API key
- `RunningSummary` - Maintains a summary of the conversation
- `HistoryStore` - Stores all messages and can trim old conversations using summarize()

The `summarize` function is special: when the conversation gets too long, it sends the old messages to the brain (the LLM) and asks "what's the most important part to remember?" This keeps the context window manageable.

### Section 11: Key Window Display (Lines 262-290)

```typescript
  const showKeyWindow = (reason: KeyWindowReason): void => {
    if (keyCrashed) {
      keyCrashed = false;
      const old = keyWin;
      keyWin = null;
      if (old && !old.isDestroyed()) old.destroy();
      const fresh = createKeyWindow(keyHooks);
      holdWindowOpen(fresh);
      fresh.once('ready-to-show', () => brain?.refreshKeyStatus());
      keyWin = fresh;
      brain?.replaceKey(fresh);
      if (old) chatOpenSenders.splice(chatOpenSenders.indexOf(old), 1);
      chatOpenSenders.push(fresh);
    }
    if (!keyWin) return;
    openKeyWindow(keyWin, reason);
    brain?.refreshKeyStatus();
  };
```

**What's this function for?**

When the key window needs to be shown:
1. If it crashed, rebuild it (same pattern as bubble)
2. Open the key window
3. Tell the brain to refresh the status it shows (key set? balance? etc.)

### Section 12: Key Request Gate (Lines 292-297)

```typescript
  const keyGate = createKeyRequest({
    visibility: { hidden: () => visibility.verdict.hidden, get: visibility.get },
    show: showKeyWindow,
  });
  keyRequest = keyGate;
```

The key window is a "focusable" window (has text input, can be in the foreground). If the user is in fullscreen gaming or the screen is locked, showing a key window would:
- Break into the game
- Or show behind the lock screen (invisible to user)

So `keyRequest` gates all key window shows through the visibility verdict:
- Hidden? Queue the show request
- Visible? Show immediately
- Verdict changes? Replay any queued requests

### Section 13: Brain Service (Lines 299-304)

```typescript
  const service = new BrainService({
    pet: petWin,
    bubble: bubbleWin,
    chat: chatWin,
    key: keyWin,
    db: database,
    store,
    keyStore,
    bundle,
    setBubbleVisible: (on) => bubbleVis.set(on),
    openKeyWindow: (reason) => keyGate.request(reason),
  });
  brain = service;
  service.start();
```

The brain service orchestrates:
- Taking messages from the chat input
- Calling the DeepSeek API
- Updating character mood/emotion
- Showing speech bubbles
- Storing conversation history

It's passed all the windows and services it needs to operate.

### Section 14: Cursor & Foreground Polling (Lines 306-308)

```typescript
  cursorPolling = startCursorPolling(petWin);
  foreground = startForegroundWatch(petWin, (hide) => {
    visibility.set('fullscreen', hide);
    visibility.apply();
  });
```

**What does cursor polling do?**

Every 50ms (or so), it:
1. Gets the current mouse position
2. Tells the pet renderer about it
3. The renderer updates the character's eye gaze to look at the cursor

**What does foreground watch do?**

It polls which window is in the foreground. If a fullscreen game is running:
1. Set visibility reason `fullscreen` to `true`
2. Apply visibility (hide the pet)

When the game closes:
1. Set `fullscreen` to `false`
2. Apply visibility (show the pet again if other reasons don't hide her)

### Section 15: Power State Monitoring (Lines 310-339)

```typescript
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
    foreground?.recheck();
  });
  powerMonitor.on('resume', () => {
    console.log('[power] resume');
    visibility.set('suspended', false);
    visibility.apply();
    foreground?.recheck();
  });
```

**What's happening?**

The operating system sends these events. When they fire:
1. Update the visibility reason
2. Apply visibility (show/hide the pet)
3. After unlock or resume, also recheck the foreground (a fullscreen game might have closed while locked)

The console.log calls are for debugging - you'll see these in the dev console.

### Section 16: Pet Window Events (Lines 341-362)

```typescript
  onFromPet(petWin, Channels.avatarHover, ({ inside }, win) => setClickThrough(win, !inside));
```

**What's click-through?**

Normally, if you click on the pet window, the window gets focus and eats the click. But the pet should be "invisible" for mouse purposes. So:
- When hovering OVER the avatar: `click-through = false` (window eats clicks)
- When hovering over EMPTY SPACE: `click-through = true` (clicks pass through to apps behind)

This is set via the Windows API through the `setClickThrough` function.

```typescript
  onFromPet(petWin, Channels.avatarDrag, ({ dx, dy }, win) => {
    moveBy(win, dx, dy);
    service.reposition(); // bubble follows
  });
  onFromPet(petWin, Channels.avatarDragEnd, (_payload, win) => {
    savePetPosition(win);
    service.reposition();
  });
```

When the user drags the pet:
1. Move the window by (dx, dy) pixels
2. Reposition the bubble (it should follow her)
3. On drag end, save the position to disk so she's in the same spot next launch

```typescript
  onFromPet(petWin, Channels.avatarTap, ({ hitArea }) => console.log('[pet] tap', hitArea));
```

A tap (single click) is logged but not used for anything yet (Phase 1). Phase 2 will add reaction animations.

```typescript
  onFromPet(petWin, Channels.stageReady, (info) => {
    console.log('[pet] stage ready', info);
    visibility.resend();
    cursorPolling?.recheck();
  });
```

`stage` is the Electron Vite / React term for "the renderer is ready". When this fires:
1. Log that the stage (pet renderer) is ready
2. Resend the visibility verdict (the renderer was waiting for this before rendering)
3. Recheck the cursor position immediately (don't wait for the next poll)

```typescript
  onFromPet(petWin, Channels.stageError, ({ message }) => console.error('[pet] stage error', message));
```

If the Live2D model fails to load, log it.

### Section 17: Chat Request Handler (Lines 364-383)

```typescript
  const requestChat = (source: ChatRequestSource, focusComposer: boolean): void => {
    const decision = decideChatRequest({ hidden: visibility.verdict.hidden, get: visibility.get });
    console.log('[chat] request source=%s decision=%s', source, decision);
    if (decision === 'refuse') {
      console.log('[chat] refused: hidden reason=%s', visibility.verdict.reason);
      return;
    }
    if (decision === 'reveal') {
      visibility.set('user', false);
      visibility.apply();
    }
    if (source === 'key' && keyWin && !keyWin.isDestroyed()) keyWin.hide();
    openChat(chatWin, petWin, focusComposer);
  };
  chatRequest.bind(requestChat);
```

**This is the core of the chat flow:**

`decideChatRequest` returns:
- `'refuse'`: Screen is locked or fullscreen app is running - don't open chat, just return
- `'reveal'`: User hid the pet with tray toggle, but is asking for chat - show her first
- `'open'`: Safe to open chat immediately

Then:
1. If source is the key window, hide it (replacing it with chat)
2. Open the chat window
3. `focusComposer` tells whether to auto-focus the text input

```typescript
  chatRequest.bind(requestChat);
```

This binds the late-bound chat request we created earlier. If a second-instance request arrived before this point, it's replayed now.

### Section 18: Chat Open Listeners (Lines 385-388)

```typescript
  onFromAny(chatOpenSenders, Channels.chatOpen, ({ source, focusComposer }) => {
    requestChat(source, focusComposer);
  });
```

Any of the windows in `chatOpenSenders` (pet, bubble, key) can send a `chatOpen` message. This listener applies the same logic - it goes through the visibility gate.

### Section 19: Tray Menu (Lines 390-403)

```typescript
  tray = createTray({
    toggleVisible: () => {
      visibility.set('user', !visibility.get('user'));
      visibility.apply();
    },
    toggleDebug: () => {
      console.log('[tray] debug:toggle');
      sendToPet(petWin, Channels.debugToggle, {});
    },
    openChat: () => requestChat('tray', true),
    openKey: () => keyGate.request('user'),
    quit: () => app.quit(),
  });
```

The tray icon menu has these items:
- **Toggle Visible**: Click tray icon to show/hide the pet
- **Debug**: Shows a debug panel on the pet
- **Open Chat**: Opens the chat composer
- **Settings**: Opens the key window (settings)
- **Quit**: Exits the app

### Section 20: Hotkey Registration (Lines 405-407)

```typescript
  if (!globalShortcut.register('Control+Shift+Space', () => requestChat('hotkey', true))) {
    console.error('[hotkey] Ctrl+Shift+Space is already taken by another app');
  }
```

Register the global hotkey `Ctrl+Shift+Space` to open chat. If another app already has it, log a warning.

### Section 21: Display Monitoring (Lines 409-421)

```typescript
  const onDisplaysChanged = (): void => {
    if (pet && reconcileDisplays(pet)) console.log('[pet] moved back onto a live display');
    brain?.reposition();
  };
  screen.on('display-removed', onDisplaysChanged);
  screen.on('display-metrics-changed', onDisplaysChanged);
```

If a monitor is unplugged:
1. The pet might be on that monitor (now off-screen)
2. Call `reconcileDisplays` to move her back into view if needed
3. Reposition the bubble

The reason this is inside `app.whenReady()` is that `electron.screen` can't be used before the app is ready. Early Electron versions had this at module scope, which caused a crash on every app launch!

### Section 22: First Run (Lines 424-426)

```typescript
  if (!useFakeBrain(app.isPackaged, process.env) && keyStore.get() === null) {
    keyGate.request('first-run');
  }
```

If this is the first run (no API key stored), show the key window with 'first-run' reason so the user can enter their key.

### Section 23: Error Handling (Lines 427-432)

```typescript
}).catch((err: unknown) => {
  console.error('[main] startup failed', err);
  app.quit();
});
```

If anything in `app.whenReady()` throws, log it and quit. Otherwise, the app would sit there half-wired with a working tray icon but a broken app behind it.

### Section 24: Prevent App Close (Lines 434-436)

```typescript
  app.on('window-all-closed', () => {
    /* keep running in the tray */
  });
```

Normally, when you close all windows, Electron quits. This app should keep running in the tray instead. So this handler does nothing, allowing the app to continue.

### Section 25: Before Quit Handler (Lines 438-471)

```typescript
  const beforeQuit = createBeforeQuit({
    teardownSync: () => {
      screen.removeListener('display-removed', onDisplaysChanged);
      screen.removeListener('display-metrics-changed', onDisplaysChanged);
      markQuitting();
      if (pet) savePetPosition(pet);
      globalShortcut.unregisterAll();
      cursorPolling?.stop();
      foreground?.stop();
      tray?.destroy();
      tray = null;
    },
    drain: async () => {
      const service = brain;
      brain = null;
      await service?.dispose();
    },
    teardownAfterDrain: () => {
      for (const win of [bubble, chat, keyWin]) 
        if (win && !win.isDestroyed()) win.destroy();
      bubble = null;
      chat = null;
      keyWin = null;
    },
    closeDb: () => {
      history?.close();
      history = null;
      db?.close();
      db = null;
    },
    quit: () => app.quit(),
  });
  app.on('before-quit', beforeQuit.handler);
```

**Why is quit so complex?**

When the user quits:
1. `teardownSync` - Stop listening for events, remove hotkey, stop polling
2. `drain` - Wait for the brain to finish any in-flight turns (this is important - if a LLM call is in progress, finish it and save the message)
3. `teardownAfterDrain` - Destroy windows
4. `closeDb` - Close the database handle
5. `quit()` - Finally quit

The reason for these phases is that if you quit immediately during an LLM call, you lose the message. The `drain` step ensures conversations are saved.

---

## PART 3: HOW TO RECREATE THIS FROM SCRATCH

### Phase 0: Setup
```bash
# Create an Electron + TypeScript project
npm create vite@latest my-pet -- --template react-ts
cd my-pet
npm install
npm install -D electron electron-vite
npm install @ds/brain @ds/memory @ds/protocol
```

### Phase 1: Create Windows
1. Create `main/index.ts` with Electron app setup
2. Create window factory functions (`createPetWindow`, `createBubbleWindow`, etc.)
3. Create each window, hold references, set up basic window properties

### Phase 2: Add IPC Communication
1. Define `Channels` enum for message types
2. Create `ipc.ts` with `sendTo`, `onFromPet`, `onFromAny` helpers
3. Wire up renderer→main messages (pet sends drag, tap, stage-ready events)
4. Wire up main→renderer messages (visibility verdicts, cursor position)

### Phase 3: Add Core Services
1. Implement visibility controller
2. Implement cursor polling
3. Implement foreground detection
4. Implement brain service

### Phase 4: Wire Events
1. Power monitor events (lock, suspend, resume)
2. Screen events (display removed, metrics changed)
3. Global hotkey
4. Tray menu
5. Chat request flow

### Phase 5: Data Persistence
1. SQLite database setup
2. History storage
3. Key storage
4. Position persistence

### Phase 6: Error Handling
1. Startup cleanup
2. Window crash recovery
3. Before-quit drain phase

---

## KEY DESIGN PATTERNS YOU'LL SEE EVERYWHERE

### 1. **Visibility Controller Pattern**
- Track multiple independent boolean reasons for hiding
- Combine them with OR logic
- Send verdict to all windows
- Easy to add new hide reasons

### 2. **Late Binding Pattern**
- Capture a request before the target is ready
- Replay it once ready
- Used for: second-instance chat requests

### 3. **Window Lifecycle Pattern**
- Create windows early
- Hide them initially (not show)
- Visibility controller decides when to show
- Crash recovery: recreate window, update references in all lists/services

### 4. **IPC Gating Pattern**
- Create a request holder that accepts requests but gates them
- Only passes through if conditions are met
- Queues requests if gated
- Replays when conditions change

### 5: **Event Listener Cleanup**
- Every `on` has a corresponding `removeListener` in cleanup
- Every cursor poll has a `stop()`
- Every service has a `dispose()`
- Before quitting: stop everything, wait for drains, close handles, quit

---

## YOU NOW UNDERSTAND:

✅ How Electron creates and manages windows
✅ Why there are multiple windows instead of one
✅ How visibility is controlled with multiple reasons
✅ How IPC (Inter-Process Communication) works
✅ How the app persists state (database, position)
✅ How to handle crashes and recovery
✅ How to properly quit without data loss
✅ How to add features (just add a new visibility reason, a new window type, a new IPC channel)

Every feature added to this app follows the same patterns. Want to add a settings window? Create it like you created the key window. Want a new hide reason? Add it to the visibility controller.
