# DS Desktop App - Code Navigation & Reading Guide
## How to Find Things, Understand Relationships, and Learn the Codebase Effectively

---

## PART 1: HOW TO READ THE CODEBASE

### Start Here (Reading Order)

**If you have 30 minutes:**
1. `CODE_EXPLANATION.md` - Understand what happens at startup
2. `ARCHITECTURE_GUIDE.md` - See the big picture
3. This file - Know how to navigate

**If you have 2 hours:**
1. Read `CODE_EXPLANATION.md` (40 min)
2. Read `ARCHITECTURE_GUIDE.md` (20 min)
3. Read `MODULES_GUIDE.md` (30 min)
4. Skim `IMPLEMENTATION_RECIPES.md` (10 min)
5. Read this file (10 min)

**If you want to rebuild it:**
1. Read everything above (2 hours)
2. Follow `REBUILD_ROADMAP.md` (8 days of coding)
3. Reference `IMPLEMENTATION_RECIPES.md` constantly

### The "Why" Before the "What"

Every file exists for a reason. Before reading code, ask:

- **Why does this file exist?** What problem does it solve?
- **What is its one responsibility?** (Single Responsibility Principle)
- **Who uses it?** (Find callers in index.ts)
- **What does it depend on?** (Look at imports)

### The Import Trace Method

When you see an import, trace it:

```typescript
// In index.ts:
import { startCursorPolling, type CursorPolling } from './cursor';

// This tells you:
// 1. There's a function called startCursorPolling
// 2. It returns something of type CursorPolling
// 3. It's defined in cursor.ts

// Now open cursor.ts and see what it does
```

### The Reverse Trace Method

When you want to see what a file is used for:

**Q: "What does visibility-state.ts do?"**

1. Open `visibility-state.ts`
2. Note its exports (what it gives to others)
3. Search the repo for these exports
4. Find all files that import from visibility-state.ts
5. You now see everything that uses it

**In VS Code:**
```
Right-click symbol → Go to References
```

---

## PART 2: UNDERSTANDING FILE RELATIONSHIPS

### The Dependency Chain (How Code Flows)

```
index.ts (THE MAIN FILE)
  ↓ (calls)
window factories → windows are created
  ↓ (registers)
IPC listeners → messages are routed
  ↓ (starts)
services → polling/monitoring begins
  ↓ (owns)
brain service → AI conversation
  ↓ (stores in)
database → messages saved
```

### Finding the Call Site

**Q: "What calls startCursorPolling?"**

1. Grep for `startCursorPolling` in the repo
2. Find it's called in `index.ts` around line 306
3. See how it's used:
   ```typescript
   cursorPolling = startCursorPolling(petWin);
   ```
4. Find where it's stopped:
   ```typescript
   cursorPolling?.stop();  // in beforeQuit
   ```

### Understanding a Service Lifecycle

Using cursor polling as an example:

```typescript
// 1. Creation
const cursorPolling = startCursorPolling(petWin);
// Now the polling service exists and timer is running

// 2. Usage
cursorPolling?.setPaused(true);   // Hide pet, stop polling
cursorPolling?.recheck();         // Force immediate poll

// 3. Destruction
cursorPolling?.stop();            // Clear the timer
cursorPolling = null;             // Release reference
```

Every service follows this pattern:
1. Created in `app.whenReady()` inside index.ts
2. Methods called throughout the app lifecycle
3. Stopped/disposed in the `beforeQuit` handler

---

## PART 3: COMMON PATTERNS & WHERE TO FIND THEM

### Pattern 1: Window Creation

**Where:** `*-window.ts` files
- `pet-window.ts` - Avatar window
- `bubble-window.ts` - Speech bubble
- `chat-window.ts` - Chat composer
- `key-window.ts` - Settings

**What to look for:**
- `new BrowserWindow({ ... })` - Window configuration
- Event handlers (`onLoadFailure`, `onCrash`)
- Guard functions (prevent navigation, etc.)

**How windows are created:**
```typescript
export function createPetWindow(options): BrowserWindow {
  const win = new BrowserWindow({ ... });
  win.loadURL(...);
  win.on('event', handler);
  return win;
}
```

### Pattern 2: IPC Message Handlers

**Where:** Scattered throughout index.ts

**Common patterns:**
```typescript
// Receive from ONE window (pet)
onFromPet(petWin, Channels.avatarHover, ({ inside }) => {
  // Handle message
});

// Receive from MULTIPLE windows
onFromAny([bubbleWin, chatWin, keyWin], Channels.chatOpen, ({ source }) => {
  // Handle message
});

// Send TO a window
sendToPet(petWin, Channels.shellVisibility, verdict);
```

### Pattern 3: Service Creation & Wiring

**Pattern:**
```typescript
// 1. Create
let serviceInstance: ServiceType | null = null;

// 2. In app.whenReady():
serviceInstance = createService(dependencies);
serviceInstance.start();

// 3. Wire it to other systems
visibility.addEventListener('change', () => {
  serviceInstance?.doSomething();
});

// 4. In beforeQuit:
await serviceInstance?.dispose();
serviceInstance = null;
```

**Examples:**
- `visibility` - Controls show/hide logic
- `cursorPolling` - Polls cursor position
- `foreground` - Detects fullscreen apps
- `brain` - Handles AI responses

### Pattern 4: State Tracking

Look for these patterns:

```typescript
// Boolean flag
let isInitialized = false;

// Enum-based state
type State = 'idle' | 'loading' | 'speaking' | 'error';
let currentState: State = 'idle';

// Object tracking multiple related values
const verdict = { hidden: false, reason: 'none' };
```

---

## PART 4: THE MENTAL MODEL

### Think in Layers

```
┌─────────────────────────────────┐
│   USER (keyboard, mouse, OS)    │
└────────────────┬────────────────┘
                 │
┌────────────────▼────────────────┐
│   Renderer Processes (React)    │
│  (Pet, Bubble, Chat, Key UIs)   │
└────────────────┬────────────────┘
                 │ IPC
┌────────────────▼────────────────┐
│   Main Process Services          │
│   (Visibility, Cursor, Brain)    │
└────────────────┬────────────────┘
                 │
┌────────────────▼────────────────┐
│   System APIs & Database         │
│   (Windows, SQLite, OS)          │
└─────────────────────────────────┘
```

**Each layer:**
- Only talks to adjacent layers
- Through well-defined interfaces (IPC channels)
- Renderers never directly access filesystem or OS
- Main process talks to OS but isolates renderers

### Think in Time

```
APP STARTUP PHASE (0-2 seconds)
  ├─ Load database
  ├─ Load character config
  ├─ Create windows
  └─ Wire services

RUNNING PHASE (entire app lifetime)
  ├─ Cursor polling: every 33ms
  ├─ Foreground polling: every 500ms
  ├─ IPC message handling: event-driven
  └─ API calls: on-demand (when user chats)

SHUTDOWN PHASE (1-5 seconds)
  ├─ Stop all polling
  ├─ Drain pending operations
  ├─ Destroy windows
  └─ Close database
```

### Think in Isolation

Each module is independent:

- `cursor.ts` works alone (doesn't need brain service)
- `brain-service.ts` works alone (doesn't need cursor polling)
- `bubble-window.ts` works alone (doesn't need main services)
- `visibility-state.ts` is pure (no side effects)

**Why this matters:** You can test and understand each module separately. Start with the simplest ones.

---

## PART 5: TOOLS FOR UNDERSTANDING

### VS Code Shortcuts

```
Ctrl+F                  Find in file
Ctrl+H                  Find & replace
Ctrl+Shift+F            Find in all files
Ctrl+G                  Go to line
F12                     Go to definition
Shift+F12               Find all references
Ctrl+Shift+O            Go to symbol in file
Ctrl+T                  Go to symbol in workspace
Ctrl+/                  Toggle comment
```

### Search Techniques

**Q: "Find all messages sent from main to pet renderer"**
```
Search: sendToPet(
Result: Every IPC message sent to pet
```

**Q: "Find all message handlers from chat window"**
```
Search: onFromAny.*chat
Result: Every IPC listener that includes chatWin
```

**Q: "Find what happens when screen is locked"**
```
Search: lock-screen
Result: All lock-related code
```

### Debugging Techniques

**Add console.log:**
```typescript
console.log('[component-name]', 'message', variable);
// Output format: [component-name] message value
```

**Example logs you'll see:**
```
[shell] show reason=none fullscreen=false locked=false suspended=false user=false
[pet] stage ready
[brain] message received: 你好
[chat] request source=hotkey decision=open
```

The prefix tells you which module logged it. This is how you track execution flow.

---

## PART 6: HOW TO EXTEND THE APP

### Adding a New Window? Follow Pet-Window Pattern

1. Copy `pet-window.ts` → `new-window.ts`
2. Change window options (size, properties)
3. Point to different renderer URL
4. In index.ts: create it, wire its IPC handlers
5. Add to cleanup in beforeQuit

### Adding New IPC Channel? Follow These Steps

1. Add to `@ds/protocol` Channels enum
2. Define Payload type
3. Add Zod validation schema
4. In renderer: `window.api.send(newChannel, payload)`
5. In main: `onFromPet(win, newChannel, handler)`

### Adding New Service? Follow This Pattern

1. Create `my-service.ts` with:
   ```typescript
   export type MyService = {
     start(): void;
     stop(): void;
     dispose(): Promise<void>;
   };
   
   export function createMyService(): MyService { }
   ```

2. In index.ts:
   ```typescript
   let myService: MyService | null = null;
   // In app.whenReady():
   myService = createMyService();
   myService.start();
   // In beforeQuit.drain:
   await myService?.dispose();
   ```

3. Wire it to visibility/other systems as needed

---

## PART 7: THE FILES YOU NEED TO READ (In Order)

### Must Read (Foundation)
- [x] CODE_EXPLANATION.md - Lines 1-50 (imports)
- [x] CODE_EXPLANATION.md - Lines 51-150 (first setup)
- [x] ARCHITECTURE_GUIDE.md - Visual diagram section
- [x] MODULES_GUIDE.md - GROUP 1 (Window Factories)
- [x] MODULES_GUIDE.md - GROUP 2 (Communication)

### Should Read (Core Logic)
- [ ] `visibility-state.ts` - ~100 lines, understand the 4-flag system
- [ ] `bubble-visibility.ts` - ~80 lines, understand dual gates
- [ ] `cursor.ts` - ~50 lines, understand polling pattern
- [ ] `foreground.ts` - Read the `shouldHideForForeground` function
- [ ] `brain-service.ts` - First 50 lines to understand structure

### Can Read Later (Specialized)
- [ ] `window-state.ts` - Persistence pattern
- [ ] `window-motion.ts` - Drag handling
- [ ] `bubble-place.ts` - Position calculation
- [ ] `quit.ts` - Shutdown lifecycle

### Reference Only (Helpers)
- [ ] `ipc.ts` - The send/receive infrastructure
- [ ] `tray.ts` - System tray setup
- [ ] Individual `.test.ts` files - See usage examples

---

## PART 8: COMMON QUESTIONS & ANSWERS

### "How does the pet know to hide when I lock my screen?"

1. Electron's `powerMonitor` fires `lock-screen` event
2. Event handler in index.ts catches it (line 311)
3. Calls `visibility.set('locked', true)`
4. Calls `visibility.apply()`
5. visibility sends `shell:visibility` IPC with `hidden: true`
6. Pet renderer receives it and stops drawing

**Find it:** Search for `lock-screen` in index.ts

### "How does the bubble position itself?"

1. `bubble-place.ts` has `placeBubble()` function
2. Takes pet window rect, bubble size, display bounds
3. Tries to place bubble to the right of pet
4. If doesn't fit, tries left
5. If doesn't fit, tries top/bottom
6. Returns final position

**Find it:** Look at `brain-service.ts` where it calls `placeBubble()`

### "How does dragging the pet work?"

1. Pet renderer detects mouse drag
2. Sends `avatarDrag` IPC with `{ dx, dy }`
3. index.ts receives it (line 350)
4. Calls `moveBy(win, dx, dy)` - moves window
5. Calls `service.reposition()` - moves bubble too
6. On drag end, saves position to disk

**Find it:** Search for `avatarDrag` in index.ts

### "Why are there 4 windows instead of 1?"

1. Pet: needs to be transparent, always-on-top, click-through
2. Bubble: frameless, positioned near pet, can hide independently
3. Chat: focusable (user types), solid background
4. Key: focusable, only shows once

**Each has different requirements that can't be met by a single window.**

### "What happens when I send a message?"

1. User types in chat window
2. React component sends `chatMessage` IPC
3. index.ts receives it
4. Calls `brain.handleMessage(text)`
5. Brain calls DeepSeek API (async)
6. Brain gets response and emotion
7. Brain sends `speechText` to bubble
8. Brain sends `emotion` to pet
9. Renderers update (speech + animation)
10. Message saved to database

**Find it:** Search for `Channels.chatMessage` in index.ts

### "Where is the API key stored?"

- File: `%APPDATA%\ds\key.bin`
- Managed by: `key-store.ts` and brain-service.ts
- Retrieved at startup, never logged, only fingerprinted

**Find it:** Look at `key-store.ts` constructor

---

## PART 9: TYPES ARE YOUR FRIEND

### Read Type Definitions First

When you see a function:
```typescript
export function someFunction(options: SomeOptions): SomeResult { }
```

Always look at the types:
```typescript
interface SomeOptions {
  required: string;       // What is required?
  optional?: boolean;     // What is optional?
}

type SomeResult = {
  success: boolean;
  data?: any;
};
```

Types tell you:
- What the function needs
- What the function returns
- What fields are required vs optional

### Generic Types Show Relationships

When you see:
```typescript
export function sendToPet<C extends Channel>(
  win: SendTarget,
  channel: C,
  payload: Payload<C>
): void
```

The `<C extends Channel>` means:
- `C` is a specific channel (like `Channels.shellVisibility`)
- `Payload<C>` is the specific payload type for that channel
- The function works with ANY channel, not just one

This is how TypeScript ensures you can't send the wrong payload type.

---

## PART 10: QUICK REFERENCE CARD

**File locations & purposes:**

```
src/main/
├── index.ts                    Main orchestrator
├── *-window.ts                 Window factories
├── ipc.ts                      Message routing
├── visibility-state.ts         Show/hide logic
├── bubble-visibility.ts        Bubble show/hide
├── cursor.ts                   Eye gaze polling
├── foreground.ts               Fullscreen detection
├── brain-service.ts            AI brain
├── quit.ts                     Shutdown sequence
└── *.test.ts                   Tests

src/renderer/
├── pet/                        Avatar UI
├── bubble/                     Speech bubble UI
├── chat/                       Chat composer UI
└── key/                        Settings UI

packages/
├── protocol/                   IPC definitions
├── brain/                      AI & character logic
├── memory/                     Database & storage
├── stage/                      Live2D loading
├── behaviors/                  Animations
└── sim/                        Character state
```

**Key concepts:**

| Concept | File | Purpose |
|---------|------|---------|
| Visibility | visibility-state.ts | Track 4 hide reasons |
| Windows | *-window.ts | Create UI windows |
| IPC | ipc.ts | Main ↔ Renderer messaging |
| Polling | cursor.ts, foreground.ts | Periodic checks |
| AI | brain-service.ts | LLM orchestration |
| Database | @ds/memory | Conversation storage |
| Lifecycle | quit.ts | Proper shutdown |

---

Now you have a complete navigation guide. Start with the files marked as "Must Read" and work your way up. Use this document as a reference when you get lost.

Happy exploring! 🚀
