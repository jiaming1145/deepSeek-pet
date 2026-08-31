# DS Desktop App - Complete Module Guide
## Understanding ALL The Pieces (Not Just index.ts)

---

## PART 1: THE MAIN PROCESS MODULES (src/main/)

The main process has ~40 files organized into functional groups. Here's every group explained:

### GROUP 1: Window Factories (Create the 4 UI Windows)

#### `pet-window.ts` - The Avatar Window Factory

**What it does:**
- Creates the main avatar window that displays 24/7
- Handles window positioning and restoration
- Manages click-through mode (invisible to mouse when over empty space)
- Guards the renderer to prevent navigation hacks

**Key exports:**
```typescript
export function createPetWindow(options: PetWindowOptions): BrowserWindow

interface PetWindowOptions {
  onReadyToShow: () => void;  // Called when ready to paint
  onLoadFailure: (err: unknown) => void;  // Failed to load renderer
  onRendererReset?: () => void;  // Renderer crashed/reset
}
```

**Important settings:**
```typescript
{
  width: 420, height: 720,
  transparent: true,          // No background
  alwaysOnTop: true,         // Above all other windows
  focusable: false,          // Can't take keyboard focus
  frame: false,              // No title bar
  skipTaskbar: true,         // Doesn't appear in taskbar
  show: false,               // Never shows itself (visibility system decides)
  backgroundThrottling: false, // Keep animating even when offscreen
  visibleOnAllWorkspaces: true,
}
```

**Security features:**
- `contextIsolation: true` - Renderer can't access Node.js
- `nodeIntegration: false` - No direct Node access
- `sandbox: true` - Extra isolation
- Preload script is the only bridge
- Navigation to foreign URLs is blocked

#### `bubble-window.ts` - The Speech Bubble Window Factory

**What it does:**
- Creates the window that shows what the pet is saying
- Positioned near the pet avatar
- Can appear/disappear independently
- Auto-hides after a timeout

**Key features:**
```typescript
// Can be recreated after crashes
export interface BubbleWindowHooks {
  onLoadFailure(err: unknown): void;
  onCrash(): void;           // Renderer died
  onReloaded(): void;         // Recovered from crash
  onUnrecoverable(): void;    // Too many crashes
}
```

**Why it's separate from pet:**
- Pet window is always-on-top and click-through
- Bubble is frameless but needs independent positioning
- Bubble can hide while pet shows (shell verdict, or just nothing to say)
- Can crash and recover independently

#### `chat-window.ts` - The Chat Composer Window Factory

**What it does:**
- The text input/output window for the user to chat with the pet
- Can be hidden (kept running in background)
- Not transparent (needs to show text)
- Focusable (user types in it)

**Why separate:**
- Pet/bubble are always-on-top (stay above games)
- Chat must pop to top of stack (user focuses it)
- Pet/bubble are transparent, chat has solid background
- Chat needs IME (input method) support for Chinese typing

#### `key-window.ts` - The Settings/API Key Window Factory

**What it does:**
- First-run dialog to enter DeepSeek API key
- Settings and status display
- Only shows once or on error

**Key pattern:**
```typescript
let keyCrashed = false;

if (keyCrashed) {
  // Rebuild the window from scratch
  keyCrashed = false;
  destroy old window
  create fresh window
  update all service references
}
```

---

### GROUP 2: Communication & IPC

#### `ipc.ts` - The Message Highway

**What it does:**
- Sends messages TO renderers
- Receives messages FROM renderers
- Validates payloads against schemas
- Checks sender identity (security)

**Key functions:**

```typescript
// Send to pet renderer
export function sendToPet<C extends Channel>(
  win: SendTarget,
  channel: C,
  payload: Payload<C>
): void

// Listen to pet renderer
export function onFromPet<C extends Channel>(
  pet: BrowserWindow,
  channel: C,
  cb: (payload: Payload<C>, win: BrowserWindow) => void
): void

// Listen to ANY of multiple windows (bubble, chat, key)
export function onFromAny<C extends Channel>(
  windows: BrowserWindow[],
  channel: C,
  cb: (payload: Payload<C>, win: BrowserWindow) => void
): void
```

**Security checks:**
```typescript
// Every message is validated:
const r = parseEvent(channel, payload);
if (!r.ok) throw new Error(`refusing to send invalid ${channel}: ${r.error}`);

// Sender identity is verified:
function isFromWindow(event: SenderIdentity, win: PetIdentity): boolean {
  // Is it from the right window?
  // Is it from the main frame (not an iframe)?
  // Is the origin one we shipped?
  // Is the frame still alive?
}
```

**Why validation matters:**
- The renderer (Chromium) could be compromised by malicious websites
- A malicious renderer sending bad data could crash the main process
- Strict validation means bad messages are logged and dropped

---

### GROUP 3: Services (The Background Workers)

#### `cursor.ts` - Eye Gaze Polling Service

**What it does:**
- Polls the mouse cursor position every ~33ms (30 Hz)
- Converts global screen position to window-local CSS pixels
- Sends to pet renderer so character can look at cursor
- Pauses when window is hidden (save CPU)

**How it works:**
```typescript
export type CursorPolling = {
  stop: () => void;
  setPaused: (paused: boolean) => void;
  recheck: () => void;
};

export function startCursorPolling(win: BrowserWindow, hz = 30): CursorPolling {
  // Every 1000/30 = 33.3 ms:
  let last = { x: NaN, y: NaN };
  const sample = () => {
    // 1. Get global cursor position
    const p = screen.getCursorScreenPoint();
    
    // 2. Convert to window-local
    const [wx, wy] = win.getPosition();
    const local = { x: p.x - wx, y: p.y - wy };
    
    // 3. Deduplicate (only send if changed)
    if (local.x === last.x && local.y === last.y) return;
    
    // 4. Send to renderer
    sendToPet(win, Channels.gazeCursor, local);
  };
  
  // Run every 33ms
  setInterval(sample, 1000 / hz);
}
```

**Deduplication:**
- Doesn't send if cursor position hasn't changed
- Saves IPC overhead
- Renderer still receives on `recheck()` after visibility changes

#### `foreground.ts` - Fullscreen App Detection Service

**What it does:**
- Polls which window is in the foreground
- Detects if a fullscreen game/video is playing
- Tells visibility controller to hide pet
- Pet reappears when game closes

**How it detects fullscreen:**
```typescript
export function shouldHideForForeground(input: ForegroundInput): boolean {
  const { rect, displayBounds, workArea, isZoomed } = input;
  
  // Fullscreen = window covers entire display
  return rect.x <= displayBounds.x + TOLERANCE
    && rect.y <= displayBounds.y + TOLERANCE
    && rect.x + rect.width >= displayBounds.x + displayBounds.width - TOLERANCE
    && rect.y + rect.height >= displayBounds.y + displayBounds.height - TOLERANCE;
  
  // But: maximized window is NOT fullscreen
  // (Maximized = fills available space with taskbar excluded)
  // isZoomed tells us if window is maximized (but not fullscreen)
}
```

**Uses Win32 API via koffi:**
```typescript
// Loads user32.dll to call Windows functions directly
const GetForegroundWindow = koffi.load('user32.dll');
const GetWindowRect = koffi.load('user32.dll');
const IsZoomed = koffi.load('user32.dll');

// These give you the real answer about what's on screen
```

---

### GROUP 4: Visibility & State Management

#### `visibility-state.ts` - The Visibility Controller

**What it does:**
- Tracks 4 independent reasons pet should hide
- Combines them with OR logic
- Sends show/hide verdict to all windows
- Manages click-through state

**The 4 hide reasons:**
```typescript
type VisibilityFlag = 'fullscreen' | 'locked' | 'suspended' | 'user';

// Current verdict combines them:
get hidden(): boolean {
  return this.flags.fullscreen || 
         this.flags.locked || 
         this.flags.suspended || 
         this.flags.user;
}

// Single reason is reported (with precedence):
get reason(): VisibilityReason {
  if (this.flags.user) return 'user';          // Highest priority
  if (this.flags.locked) return 'locked';
  if (this.flags.suspended) return 'suspended';
  if (this.flags.fullscreen) return 'fullscreen';
  return 'none';
}
```

**Why 4 separate flags:**
- Windows lock → sleep → resume → unlock sequence
- If you merge lock+sleep into "system", resume would clear it
- Pet would appear behind still-locked screen
- With 4 flags: resume clears `suspended`, but `locked` stays true
- `hidden` stays true (OR of all flags)

**When apply() is called:**
```typescript
apply(): void {
  const v = verdict();
  
  if (v.hidden) {
    setClickThrough(true);  // Invisible to mouse
    win.hide();             // Actually hide
  } else {
    win.showInactive();     // Show without focus
  }
  
  send(v);                // Tell renderer
  setCursorPaused(v.hidden);  // Stop cursor polling
  recheckCursor();        // Fresh sample after show
}
```

#### `bubble-visibility.ts` - The Bubble's Visibility Tracker

**What it does:**
- Tracks when the bubble should show
- Different from shell visibility
- Only shows when: (shell allows) AND (brain has something to say)

**The logic:**
```typescript
type BubbleVisibility = {
  shellHidden: boolean;   // From visibility state
  brainWantsSpeak: boolean;  // Brain set this
};

bubbleVisible = !shellHidden && brainWantSpeak;
```

**Why separate:**
- Shell verdict affects 4 windows the same way (all hide together)
- Bubble has its own "should I speak?" state
- Brain decides to start speaking
- Index.ts decides when to show it
- Bubble can hide for 2 independent reasons

---

### GROUP 5: Brain Service (The AI Orchestrator)

#### `brain-service.ts` - The Central AI Controller

**What it does:**
- Receives chat messages from user
- Calls DeepSeek API
- Updates character mood/state
- Sends responses to bubble
- Manages conversation history
- Handles emoji reactions

**Major methods:**
```typescript
export class BrainService {
  constructor(deps: BrainServiceDeps) { }
  
  start(): void { }              // Start listening for messages
  
  handleChatMessage(text: string): Promise<void> { }  // User sent message
  
  bubbleCrashed(): void { }      // Bubble renderer crashed
  
  reposition(): void { }         // Pet moved, reposition bubble
  
  replaceBubble(win: BrowserWindow): void { }  // Recreate bubble after crash
  
  currentClient(): ChatClient | null { }  // Get current DeepSeek client
  
  dispose(): Promise<void> { }   // Cleanup for quit
}
```

**Flow of a chat message:**
```
1. User types in chat window
2. Sends: Channels.chatMessage { text: "你好" }
3. Main process receives in index.ts
4. Calls: brain.handleChatMessage("你好")
5. Brain:
   a. Adds to history store
   b. Calls DeepSeek API with context
   c. Gets response: "你好！很高兴见到你"
   d. Extracts emotion tags: `<|ACT joy|>`
   e. Updates character state
   f. Sends to bubble: Channels.speechText { text: "..." }
   g. Sends to pet: Channels.emotion { emotion: "joy" }
6. Bubble renderer shows the text
7. Pet renderer animates the emotion
```

**Key fields:**
```typescript
private client: ChatClient | null = null;    // DeepSeek API client
private runner: TurnRunner | null = null;    // Turn-by-turn handler
private lastTest: { ok: boolean } | null = null;  // Last key test result
```

---

### GROUP 6: Window & Input Management

#### `window-state.ts` - Position/Size Persistence

**What it does:**
- Saves window position to disk
- Restores position on startup
- Clamps position to visible displays (even if monitor unplugged)

```typescript
export function saveWindowState(file: string, win: BrowserWindow): void {
  const [x, y] = win.getPosition();
  const [w, h] = win.getSize();
  fs.writeFileSync(file, JSON.stringify({ x, y, w, h }));
}

export function loadWindowState(file: string): WindowState | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// On startup:
const saved = loadWindowState(stateFile());
const pos = clampToDisplays(saved, workAreas, PET_SIZE);
// If monitor was unplugged, clamps position back to visible area
```

#### `window-motion.ts` - Drag Handling

**What it does:**
- Tracks when user drags the pet
- Updates window position in real-time
- Clamps to display boundaries during drag
- Saves final position

#### `bubble-place.ts` - Bubble Positioning

**What it does:**
- Calculates where to place bubble near pet
- Avoids placing off-screen
- Prefers showing to the side of the pet
- Handles multi-monitor setups

```typescript
export function placeBubble(
  petRect: Rect,
  bubbleSize: Size,
  workAreas: Rect[]
): Placement {
  // 1. Try right side of pet
  // 2. If doesn't fit, try left
  // 3. If doesn't fit, try top/bottom
  // 4. Clamp to visible display
  // 5. Return final position
}
```

---

### GROUP 7: Request Gating & Lifecycle

#### `key-request.ts` - Gates Key Window Through Visibility

**What it does:**
- Key window is "focusable" - takes keyboard focus
- If fullscreen game is running, showing it would be annoying
- This gates key window shows through visibility verdict
- Queues requests until verdict allows

```typescript
export type KeyRequest = {
  request: (reason: KeyWindowReason) => void;
};

// Usage:
keyRequest.request('user');  // User clicked "Settings"

// Internally:
if (visibility.verdict.hidden) {
  // Queue it
  queued = true;
} else {
  // Show immediately
  showKeyWindow();
}

// When verdict changes:
visibility.addEventListener('change', () => {
  if (queued && !visibility.verdict.hidden) {
    showKeyWindow();
    queued = false;
  }
});
```

#### `chat-request.ts` - Late Binding for Chat Opens

**What it does:**
- When app launches a second time, user is asking for chat
- But chat window might not be created yet
- This captures the request and replays it once ready

```typescript
const chatRequest = createLateBoundChatRequest();

// If second launch happens before ready:
app.on('second-instance', () => {
  chatRequest.request('second-instance', true);  // Captured
});

// Later, when windows are ready:
chatRequest.bind(requestChat);  // Replay it
```

#### `quit.ts` - Graceful Shutdown Manager

**What it does:**
- 4-phase shutdown to prevent data loss
- Waits for in-flight LLM calls to finish
- Closes database properly
- Cleans up resources

```typescript
export type QuitPhases = {
  teardownSync: () => void;      // Phase 1: Stop listeners
  drain: () => Promise<void>;    // Phase 2: Wait for async
  teardownAfterDrain: () => void; // Phase 3: Destroy windows
  closeDb: () => void;           // Phase 4: Close DB
  quit: () => void;              // Phase 5: Actually quit
};
```

**Why 4 phases:**
```
User clicks quit
  ↓
Phase 1: Stop listening for new messages
  ↓
Phase 2: Wait for current LLM call to finish
  ↓
  (LLM returns, message is saved)
  ↓
Phase 3: Destroy windows (can't receive more messages)
  ↓
Phase 4: Close database
  ↓
Actually quit
```

If you quit during Phase 2 (waiting for LLM), the message IS saved.

---

### GROUP 8: Utilities & Helpers

#### `tray.ts` - System Tray Icon

**What it does:**
- Creates system tray icon (bottom right of screen)
- Shows context menu
- Toggle show/hide
- Open chat
- Settings
- Quit

#### `app-protocol.ts` - Custom URL Protocol Handler

**What it does:**
- Sets up `app://` protocol
- Serves renderer pages from disk (dev) or resources (packaged)
- Security checks on URLs
- Debug mode handling

```typescript
// Renderer can load:
win.loadURL('app://pet');     // The pet page
win.loadURL('app://bubble');  // The bubble page
win.loadURL('app://chat');    // The chat page

// app-protocol intercepts these and serves:
// dev: ./out/renderer/pet/index.html
// packaged: ./resources/renderer/pet/index.html
```

#### `key-store.ts` - API Key Storage

**What it does:**
- Saves API key to disk (encrypted later with better security)
- Loads on startup
- Provides fingerprinting (first 16 chars of sha256, not the key itself)

#### `summarizer.ts` - Conversation Trimming

**What it does:**
- When conversation gets long, asks LLM: "what's important to remember?"
- Uses that summary instead of full history
- Keeps context window manageable

```typescript
async function summarizeConversation(oldSummary, dropped) {
  // Call DeepSeek:
  // "These old messages were dropped. Summarize what matters."
  
  // DeepSeek returns:
  // "User likes coffee. Mentioned work deadline tomorrow."
  
  // Store that instead of full old messages
}
```

---

## PART 2: THE RENDERER PROCESS MODULES (src/renderer/)

The renderer is React + Live2D. There are 4 separate React apps:

### `renderer/pet/` - The Avatar Renderer

**What it does:**
- Loads the Live2D model (3D character)
- Draws it on canvas
- Responds to cursor position (eye gaze)
- Handles hover/drag/tap events
- Shows animations

**Key components:**
- Live2D model loader
- Animation controller
- Hit testing (is cursor over the avatar or empty space?)
- Gesture handlers

**IPC messages it sends:**
```typescript
// When you hover on avatar:
window.api.send(Channels.avatarHover, { inside: true });

// When you hover on empty space:
window.api.send(Channels.avatarHover, { inside: false });

// When you drag:
window.api.send(Channels.avatarDrag, { dx: 10, dy: 20 });

// When you release:
window.api.send(Channels.avatarDragEnd, {});

// When you tap:
window.api.send(Channels.avatarTap, { hitArea: 'face' });
```

**IPC messages it receives:**
```typescript
// Shell telling it to hide/show:
Channels.shellVisibility { hidden: true, reason: 'locked' }

// New cursor position:
Channels.gazeCursor { x: 150, y: 200 }

// Brain sending emotion:
Channels.emotion { emotion: 'joy', intensity: 0.8 }

// Brain sending action (wave hand, blink, etc):
Channels.action { action: 'wave' }
```

### `renderer/bubble/` - The Speech Bubble Renderer

**What it does:**
- Shows text bubbles
- Animates text reveal (Chinese characters appear one by one)
- Handles hover (reveal timing)
- Animates in/out

**Key components:**
- Text animator
- Bubble styling
- Position sync with main

**IPC messages it receives:**
```typescript
// New speech to display:
Channels.speechText { text: "你好！", tts?: "audio.mp3" }

// Shell verdict changed:
Channels.shellVisibility { hidden: false }

// Brain says stop speaking:
Channels.speechEnd { reason: 'done' }
```

### `renderer/chat/` - The Chat Composer Renderer

**What it does:**
- Shows conversation history
- Text input (with IME support for Chinese)
- Send button
- Message timestamps
- Scroll to latest

**Key components:**
- Message list
- Input field
- IME handler

**IPC messages it sends:**
```typescript
// User typed and hit send:
Channels.chatMessage { text: "你在做什么？" }

// User resized window:
Channels.chatResize { width: 600, height: 800 }

// User closed window:
Channels.chatClose {}
```

### `renderer/key/` - The Settings Renderer

**What it does:**
- Input field for API key
- Test key button (calls DeepSeek to verify)
- Status display
- Error messages

**IPC messages it sends:**
```typescript
// User entered and submitted key:
Channels.keySet { key: "sk-..." }

// User clicked test:
Channels.keyTest { key: "sk-..." }
```

---

## PART 3: THE SHARED PACKAGES (packages/)

### `@ds/protocol` - IPC Contract

**What it does:**
- Defines all IPC channel names
- Defines payload types for each channel
- Runtime validation schemas (Zod)
- Error codes and hints

**Key file: `packages/protocol/src/index.ts`**

```typescript
export enum Channels {
  shellVisibility = 'shell:visibility',
  avatarHover = 'avatar:hover',
  avatarDrag = 'avatar:drag',
  chatMessage = 'chat:message',
  // ... ~50 more channels
}

// Each channel has a type:
export type Payload<C extends Channel> = C extends Channels.shellVisibility
  ? VisibilityVerdict
  : C extends Channels.avatarHover
  ? { inside: boolean }
  : // ... etc
```

**Why this matters:**
- Main and renderer agree on message format
- Typos are caught at compile time
- Wrong payload type is a type error
- Runtime validation catches sneaky bugs

### `@ds/brain` - AI & Character Logic

**What it does:**
- DeepSeek API client
- Turn-by-turn handler
- Character bundling (config)
- System prompt building
- Speech generation (emotion + action tags)

**Key exports:**
```typescript
export class DeepSeekClient { }
export class TurnRunner { }
export function parseCharacterBundle(json): CharacterBundle { }
export function renderStaticSystem(bundle, history): string { }
```

**What a CharacterBundle contains:**
```typescript
type CharacterBundle = {
  card: {
    name: string;         // "小春"
    age_vibe: string;    // "young adult"
    personality: string; // JSON of traits
    voice: string;       // Future voice config
  };
  // ... Live2D model config
};
```

### `@ds/memory` - Database & History

**What it does:**
- SQLite database wrapper
- Conversation history storage
- Turn storage (a "turn" = user message + AI response)
- Key-value store (settings, summaries)
- Summarization integration

**Key exports:**
```typescript
export function openDb(path: string): DatabaseSync { }
export class HistoryStore { }
export class RunningSummary { }
export class KeyStore { }
```

**Database schema:**
```sql
-- Turns: each AI response is a turn
CREATE TABLE turns (
  id INTEGER PRIMARY KEY,
  user_text TEXT,
  ai_text TEXT,
  emotion TEXT,
  created_at TIMESTAMP
);

-- Messages: raw chat history
CREATE TABLE messages (
  id INTEGER PRIMARY KEY,
  role TEXT,  -- 'user' or 'assistant'
  text TEXT,
  turn_id INTEGER
);

-- KV: settings, summaries, app state
CREATE TABLE kv (
  key TEXT PRIMARY KEY,
  value TEXT
);
```

### `@ds/stage` - Live2D Model Management

**What it does:**
- Loads `.moc3` model files
- Creates Pixi display instance
- Manages animations
- Hit testing (which body part was clicked)

**Key exports:**
```typescript
export class PixiLive2dDisplay { }
export async function loadModel(url: string): Promise<Live2DModel> { }
```

### `@ds/behaviors` - Animation Library

**What it does:**
- Idle animations (breathing, blinking, swaying)
- Reaction animations (joy, sad, shock)
- Interaction animations (wave, nod, look around)

**Example:**
```typescript
model.startAnimation('idle');
model.startAnimation('react_joy', 3000); // 3 second duration
model.lookAt(x, y);  // Eyes follow cursor
```

### `@ds/sim` - Character State Simulation

**What it does:**
- Mood system (happy, neutral, sad)
- Energy level
- Affection tracking
- State changes from events

**How it works:**
```typescript
const sim = new CharacterSim();

sim.onMessage('chat');  // User chatted -> increase affection
sim.onTime('idle');     // Time passed -> decrease energy
sim.onEmotion('joy');   // Just expressed joy -> increase mood

const mood = sim.getMood();  // Current mood number
```

---

## PART 4: HOW EVERYTHING TALKS TO EACH OTHER

### Message Flow Diagram

```
USER ACTION
     ↓
RENDERER (React)
     │
     ├─→ (IPC) Channels.avatarHover
     │
MAIN PROCESS
     │
     ├─→ visibility.set('user', false)
     ├─→ visibility.apply()
     │
     ├─→ brain.handleMessage(text)
     │
     └─→ (IPC) Channels.shellVisibility
     
     ↓
RENDERER (React)
     │
     ├─→ Update state
     ├─→ Play animation
     └─→ Show/hide UI
```

### Startup Sequence

```
1. Electron starts → index.ts
2. Open database
3. Load character bundle
4. Create 4 windows (all hidden)
5. Wire IPC listeners
6. Start services (cursor, foreground, visibility)
7. Load renderer pages (async)
8. Renderers send: stage:ready
9. Visibility sends first verdict
10. Windows become visible (if conditions allow)
11. Services start polling
12. App is live
```

### Chat Message Flow (Detailed)

```
User types in chat window:
  ↓
React component calls:
  window.api.send(Channels.chatMessage, { text: "你好" })
  ↓
Electron IPC routes to main process
  ↓
index.ts listener:
  onFromAny([chatWin], Channels.chatMessage, ({ text }) => {
    brain.handleMessage(text);
  })
  ↓
BrainService.handleMessage():
  a. Add to history: { role: 'user', text: '你好' }
  b. Build system prompt with character traits
  c. Call DeepSeek API
  d. Receive: { text: '你好！今天心情怎样？', emotion: 'joy' }
  e. Add to history: { role: 'assistant', text: '...' }
  f. Send to bubble:
       sendTo(bubble, Channels.speechText, { text: '...' })
  g. Send to pet:
       sendToPet(pet, Channels.emotion, { emotion: 'joy' })
  ↓
Bubble renderer:
  Receives Channels.speechText
  Animates text appearing (character by character)
  ↓
Pet renderer:
  Receives Channels.emotion
  Changes facial expression
  Plays joy animation
  ↓
User sees the pet speaking with emotion
```

---

## PART 5: DEPENDENCY GRAPH

```
index.ts (THE ORCHESTRATOR)
├── createPetWindow() ← pet-window.ts
├── createBubbleWindow() ← bubble-window.ts
├── createChatWindow() ← chat-window.ts
├── createKeyWindow() ← key-window.ts
│
├── createVisibilityController() ← visibility-state.ts
├── createBubbleVisibility() ← bubble-visibility.ts
├── startCursorPolling() ← cursor.ts
├── startForegroundWatch() ← foreground.ts
│
├── BrainService ← brain-service.ts
│   └── @ds/brain
│       ├── DeepSeekClient
│       ├── TurnRunner
│       └── CharacterBundle parser
│
├── HistoryStore ← @ds/memory
│   └── SQLite database
│
├── KeyStore ← key-store.ts
├── createTray() ← tray.ts
│
└── createBeforeQuit() ← quit.ts
    └── Drain phase waits for brain.dispose()

Renderers (independent)
├── renderer/pet/App.tsx
│   └── @ds/stage (Live2D loading)
│   └── @ds/behaviors (animations)
├── renderer/bubble/App.tsx
├── renderer/chat/App.tsx
└── renderer/key/App.tsx

All renderers use:
└── @ds/protocol (IPC channel definitions)
```

---

## PART 6: File Organization Quick Reference

**Window Creation:**
- `pet-window.ts`, `bubble-window.ts`, `chat-window.ts`, `key-window.ts`

**Communication:**
- `ipc.ts` (send/receive)
- `app-protocol.ts` (URL scheme)
- `invoke.ts` (request-response pattern)

**Services:**
- `cursor.ts` (eye gaze polling)
- `foreground.ts` (fullscreen detection)
- `visibility-state.ts` (show/hide logic)
- `bubble-visibility.ts` (bubble show/hide)
- `brain-service.ts` (AI brain)

**State Management:**
- `window-state.ts` (position)
- `window-motion.ts` (dragging)
- `bubble-place.ts` (positioning)
- `key-store.ts` (API key)

**Lifecycle:**
- `quit.ts` (graceful shutdown)
- `key-request.ts` (visibility gating)
- `chat-request.ts` (late binding)
- `fatal.ts` (fatal error handling)

**Utilities:**
- `tray.ts` (system tray)
- `summarizer.ts` (conversation trimming)
- `humanize.ts` (readable time formats)
- `redact.ts` (hide secrets in logs)
- `trace.ts` (debugging helpers)

**Tests:**
- Every file has a `.test.ts` companion

---

You now understand the **complete module structure**. Each piece is simple (under 200 lines usually) but they compose into a sophisticated system.

The key insight: **One responsibility per file**. Window creation, IPC, visibility, cursor polling, foreground detection, brain service, persistence — each is independent and can be tested alone.
