# How to Rebuild This App From Scratch - Complete Roadmap

## Executive Summary

You now have learned a **desktop pet application** built with:
- **Electron** (desktop app framework)
- **React** (UI framework)
- **TypeScript** (type-safe JavaScript)
- **SQLite** (local database)
- **DeepSeek API** (AI brain)
- **Live2D** (3D avatar model)

The app has **~1000 lines of logic** spread across ~40 files, but they all follow **7 core design patterns**.

---

## Starting from Absolute Zero: The Build Plan

If you're rebuilding this from scratch, follow this sequence:

### Phase 0: Project Setup (Day 1)

```bash
# Create project structure
npm create vite@latest ds-pet -- --template react-ts
cd ds-pet

# Install core dependencies
npm install
npm install -D electron electron-vite
npm install @ds/brain @ds/memory @ds/protocol @ds/stage

# Create folders
mkdir -p src/main src/renderer src/preload
mkdir -p src/renderer/pet src/renderer/bubble src/renderer/chat src/renderer/key
```

**What you're doing**: Setting up TypeScript, Electron, and React with proper bundling.

---

### Phase 1: Create Windows (Day 2-3)

**Start with**: `src/main/index.ts`

**Step 1.1**: Create empty windows

```typescript
import { app, BrowserWindow } from 'electron';

app.setName('ds');

let pet: BrowserWindow | null = null;
let bubble: BrowserWindow | null = null;

app.whenReady().then(() => {
  pet = new BrowserWindow({
    width: 300,
    height: 400,
    show: false,
  });
  bubble = new BrowserWindow({
    width: 250,
    height: 100,
    show: false,
  });

  // For now, just load empty files
  pet.loadURL('app://pet');
  bubble.loadURL('app://bubble');
});

app.on('window-all-closed', () => {
  // Keep running in tray
});
```

**What you've learned**: Electron's window creation API, the `show: false` pattern.

**Step 1.2**: Add the two remaining windows (chat, key)

Follow the same pattern for `chat` and `keyWin`.

**Step 1.3**: Add window factory functions

Extract the window creation into separate files:
- `src/main/pet-window.ts` - `createPetWindow(hooks)`
- `src/main/bubble-window.ts` - `createBubbleWindow(hooks)`
- etc.

This makes windows testable and reusable.

---

### Phase 2: Setup IPC Communication (Day 3-4)

**Start with**: `packages/protocol/src/index.ts`

**Step 2.1**: Define all message types

```typescript
export enum Channels {
  shellVisibility = 'shell:visibility',
  avatarHover = 'avatar:hover',
  avatarDrag = 'avatar:drag',
  avatarTap = 'avatar:tap',
  stageReady = 'stage:ready',
  bubbleVisible = 'bubble:visible',
  chatOpen = 'chat:open',
  // ... etc
}
```

**Step 2.2**: Create IPC helper functions

`src/main/ipc.ts`:
```typescript
export function sendToPet(win: BrowserWindow, channel: string, data: any) {
  win.webContents.send(channel, data);
}

export function onFromPet(win: BrowserWindow, channel: string, handler: (data: any, win: BrowserWindow) => void) {
  win.webContents.on('ipc-message', (event, ch, data) => {
    if (ch === channel) handler(data, win);
  });
}
```

**Step 2.3**: Setup preload script

`src/preload/index.ts`:
```typescript
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  send: (channel: string, data: any) => ipcRenderer.send(channel, data),
  on: (channel: string, handler: Function) => ipcRenderer.on(channel, (_, data) => handler(data)),
  off: (channel: string, handler: Function) => ipcRenderer.off(channel, handler as any),
});
```

**What you've learned**: IPC is message-based, not function-call based. Main and renderer can't directly call each other.

---

### Phase 3: Add Core Services (Day 4-5)

**Step 3.1**: Create Visibility Controller

`src/main/visibility-state.ts`:

```typescript
export type VisibilityVerdict = {
  hidden: boolean;
  reason: 'locked' | 'suspended' | 'fullscreen' | 'user' | 'none';
};

export function createVisibilityController(deps: any) {
  let reasons = { locked: false, suspended: false, fullscreen: false, user: false };

  return {
    verdict: { hidden: false, reason: 'none' as const },
    set: (reason: keyof typeof reasons, value: boolean) => {
      reasons[reason] = value;
    },
    apply: () => {
      const hidden = Object.values(reasons).some(v => v);
      // Send verdict to all windows
    },
  };
}
```

**Step 3.2**: Create Bubble Visibility Tracker

`src/main/bubble-visibility.ts`:

Similar pattern but tracks TWO things:
- Is shell visible?
- Does brain have something to say?

**Step 3.3**: Create Cursor Polling

`src/main/cursor.ts`:

```typescript
export function startCursorPolling(petWindow: BrowserWindow) {
  const interval = setInterval(() => {
    const pos = require('robot-js').getMousePos(); // or use Windows API
    sendToPet(petWindow, Channels.cursorPosition, pos);
  }, 50);

  return {
    stop: () => clearInterval(interval),
    recheck: () => {
      // Poll once immediately
    },
  };
}
```

**What you've learned**: Services are objects with:
- Lifecycle hooks (start, stop, dispose)
- Callbacks to notify main when things change
- They coordinate with the visibility system

---

### Phase 4: Create React Renderers (Day 5-6)

**Step 4.1**: Pet Renderer

`src/renderer/pet/App.tsx`:

```typescript
import { useEffect, useState } from 'react';

export function App() {
  const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    window.api.on(Channels.cursorPosition, (pos) => {
      setCursorPos(pos);
      // Update eye gaze animation
    });
  }, []);

  return (
    <canvas id="live2d" width={300} height={400} />
  );
}
```

**Step 4.2**: Load the Live2D model

```typescript
import { PixiLive2dDisplay } from 'pixi-live2d-display/pixi-v8.js';

const app = new PIXI.Application({...});
const model = await PixiLive2dDisplay.for(app.stage).load('model.moc3');
app.stage.addChild(model);
```

**Step 4.3**: Handle hover events

```typescript
canvas.addEventListener('mousemove', (e) => {
  const bounds = canvas.getBoundingClientRect();
  const x = e.clientX - bounds.left;
  const y = e.clientY - bounds.top;
  const inside = isInsideAvatar(x, y); // Check if over Live2D model
  window.api.send(Channels.avatarHover, { inside });
});
```

**Step 4.4**: Bubble Renderer

`src/renderer/bubble/App.tsx`:

```typescript
export function App() {
  const [messages, setMessages] = useState<string[]>([]);

  useEffect(() => {
    window.api.on(Channels.bubbleText, ({ text }) => {
      setMessages(msgs => [...msgs, text]);
    });
  }, []);

  return <div className="bubble">{messages[messages.length - 1]}</div>;
}
```

**Step 4.5**: Chat Renderer

Similar pattern - listen for messages, show input, send on submit.

**What you've learned**: React components are just listeners + UI. They send/receive data through IPC.

---

### Phase 5: Wire Services Together (Day 6)

Back in `src/main/index.ts`, after creating all windows:

```typescript
const visibility = createVisibilityController({ /* ... */ });
const bubbleVis = createBubbleVisibility({ /* ... */ });
const cursorPolling = startCursorPolling(petWindow);
const foreground = startForegroundWatch(petWindow, (hide) => {
  visibility.set('fullscreen', hide);
  visibility.apply();
});

// Wire IPC
onFromPet(petWin, Channels.avatarHover, ({ inside }) => {
  setClickThrough(petWin, !inside);
});

// Power monitor
powerMonitor.on('lock-screen', () => {
  visibility.set('locked', true);
  visibility.apply();
});
```

**What you've learned**: The main process is like a conductor - it creates all services and wires them together.

---

### Phase 6: Add Persistence (Day 7)

**Step 6.1**: Setup SQLite

```typescript
import { openDb, HistoryStore } from '@ds/memory';

const db = openDb(path.join(app.getPath('userData'), 'ds.sqlite'));
const store = new HistoryStore({ db });

// When app closes:
beforeQuit = createBeforeQuit({
  teardownSync: () => { /* ... */ },
  drain: async () => {
    await store?.dispose();
  },
  closeDb: () => {
    db?.close();
  },
  quit: () => app.quit(),
});
```

**Step 6.2**: Save window position

```typescript
window.on('move', () => {
  const [x, y] = window.getPosition();
  fs.writeFileSync(configPath, JSON.stringify({ x, y }));
});

// On startup:
const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'));
window.setPosition(saved.x, saved.y);
```

**What you've learned**: Electron apps typically store data in `%APPDATA%\yourapp\`. Use SQLite for structured data, JSON files for simple configs.

---

### Phase 7: Add AI Brain (Day 8)

**Step 7.1**: Create Brain Service

`src/main/brain-service.ts`:

```typescript
export class BrainService {
  constructor(deps: any) { /* store deps */ }

  start() { /* listen for chat:message events */ }

  async handleMessage(text: string) {
    // Call DeepSeek API
    const response = await fetch('https://api.deepseek.com/...', {
      body: JSON.stringify({ message: text, key: this.keyStore.get() }),
    });
    
    // Parse response
    const result = await response.json();
    
    // Send to bubble
    sendTo(this.bubble, Channels.bubbleText, { text: result.text });
    
    // Save to history
    this.store.add({ role: 'assistant', text: result.text });
  }
}
```

**Step 7.2**: Wire in index.ts

```typescript
const brain = new BrainService({ db, store, bubble, chat, petWin });
brain.start();

// Listen for messages from chat
onFromAny([chatWin], Channels.chatMessage, ({ text }) => {
  brain.handleMessage(text);
});
```

**What you've learned**: The brain is just another service. It listens for messages and sends responses back.

---

## The 7 Core Patterns You Need to Master

### Pattern 1: Window Lifecycle
- Create early, show=false
- Visibility system decides when to show
- Crash recovery rebuilds the window
- Proper cleanup on app quit

### Pattern 2: Visibility Gating
- Track multiple independent hide reasons
- Combine with OR logic
- Send verdict to all windows
- Each window respects the verdict

### Pattern 3: IPC Messaging
- Define channels as enum
- Create send/receive helper functions
- One message = one logical event
- Preload script is the security gate

### Pattern 4: Service Architecture
- Service = stateful component that manages a subsystem
- Has start() and dispose() lifecycle
- Passes callbacks to receive updates
- Main process wires services together

### Pattern 5: React Listeners
- useEffect + window.api.on
- Update state when messages arrive
- Send events back via window.api.send
- No direct DOM manipulation for IPC-driven updates

### Pattern 6: Graceful Shutdown
- Phase 1 (sync): Stop all listeners
- Phase 2 (drain): Wait for async operations
- Phase 3 (afterDrain): Destroy windows
- Phase 4 (final): Close DB and quit

### Pattern 7: Data Persistence
- App data in %APPDATA%\appname
- SQLite for conversations (queryable, indexable)
- JSON for simple configs (positions, settings)
- Always close DB handles properly

---

## Exact Build Sequence (Most Efficient)

1. **Day 1**: Project setup + empty windows
2. **Day 2**: IPC channels + helper functions
3. **Day 3**: Visibility controller + basic pet window IPC
4. **Day 4**: Cursor polling + React pet renderer
5. **Day 5**: Bubble renderer + chat renderer
6. **Day 6**: Brain service + API integration
7. **Day 7**: Database + persistence
8. **Day 8**: Error recovery + polish + test

**Total: ~8 days for a single developer**

---

## Common Pitfalls & How to Avoid Them

### Pitfall 1: Windows garbage collected
❌ Don't: `function createWindow() { const w = new BrowserWindow(...); return w; }`
✅ Do: Keep a global reference `let window: BrowserWindow | null = null;`

### Pitfall 2: IPC deadlock
❌ Don't: Call main from renderer synchronously
✅ Do: Use async IPC, wait for responses

### Pitfall 3: Lost messages during startup
❌ Don't: Send visibility verdict before renderer is ready
✅ Do: Wait for `stage:ready` IPC message first

### Pitfall 4: Crash loops
❌ Don't: Recreate window immediately after crash
✅ Do: Wait 1 second, count crashes, give up after 3

### Pitfall 5: Data loss on quit
❌ Don't: Just destroy windows and exit
✅ Do: Use the 4-phase shutdown (sync, drain, afterDrain, final)

### Pitfall 6: Click-through logic backwards
❌ Don't: Hide pet when hovering on avatar
✅ Do: Hide (set click-through) when hovering over EMPTY SPACE

### Pitfall 7: Visibility verdict stale
❌ Don't: Render with old visibility state
✅ Do: Resend verdict on every window `ready-to-show`

---

## Testing Strategy

**Unit tests** (each file independent):
```bash
npm run test  # Vitest
```

**E2E tests** (full app flow):
```bash
npm run test:e2e:electron  # Playwright + Electron
```

**Manual testing**:
- Change size of window → pet follows
- Lock screen → pet hides
- Fullscreen app → pet hides
- Restart → pet in same position
- Crash pet window → auto-recovery
- Send message → AI responds → message saved

---

## Performance Targets

- **First launch**: < 2 seconds to show pet
- **Cursor response**: < 50ms from move to eye update
- **Chat message**: < 500ms from send to bubble appears
- **Memory usage**: < 300MB (Chromium + Live2D + React)
- **CPU at idle**: < 5% (cursor poll + visibility checks)

---

## What Each Layer Does

```
┌─────────────────────────────────────────┐
│         React Components                 │
│    (UI rendering + user interaction)    │
└──────────────┬──────────────────────────┘
               │ (IPC)
┌──────────────▼──────────────────────────┐
│       Main Process Services              │
│  (Brain, Visibility, Cursor, Foreground) │
└──────────────┬──────────────────────────┘
               │ (System events, APIs)
┌──────────────▼──────────────────────────┐
│       Electron + OS                      │
│  (Window management, hotkeys, DB)        │
└─────────────────────────────────────────┘
```

Each layer talks to the one above/below through well-defined interfaces (IPC channels, event handlers).

---

## You Are Ready To:

✅ Explain why the app has 4 windows instead of 1
✅ Add a new window type (follow the pet-window pattern)
✅ Add a new hide reason (add to visibility controller)
✅ Add a new message type (add Channel + handlers)
✅ Create a new service (follow brain-service pattern)
✅ Handle crashes and recover gracefully
✅ Save and load data properly
✅ Test your changes

**The entire app is built from these patterns. Master one, and you can build anything in this architecture.**

---

## Next Steps

1. **Read the 3 documents** created for you:
   - `CODE_EXPLANATION.md` - Every line of index.ts explained
   - `ARCHITECTURE_GUIDE.md` - Overall structure and relationships
   - `IMPLEMENTATION_RECIPES.md` - Copy-paste patterns for features

2. **Pick one feature** from the recipes and implement it in a test project

3. **Read one core file** completely:
   - `brain-service.ts` - Handles AI
   - `visibility-state.ts` - Handles show/hide logic
   - `bubble-visibility.ts` - Handles bubble show/hide logic

4. **Run the tests**:
   ```bash
   npm run test
   npm run test:e2e:electron
   ```

5. **Modify something**:
   - Change the hide duration for fullscreen detection
   - Add a new hotkey
   - Change the visibility colors
   - Add a debug overlay

You now understand the **entire architecture** and can **recreate it from scratch**. Good luck! 🎉
