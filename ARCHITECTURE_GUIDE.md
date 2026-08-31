# DS Desktop App - Architecture & File Relationships

## Visual Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         MAIN PROCESS                             │
│                    (Electron + Node.js)                          │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ index.ts - THE ORCHESTRATOR                              │  │
│  │ ─────────────────────────────────────────────────────────│  │
│  │ • Creates all 4 windows                                   │  │
│  │ • Wires all services together                             │  │
│  │ • Handles app lifecycle                                   │  │
│  │ • Routes IPC messages                                     │  │
│  └──────────────────────────────────────────────────────────┘  │
│                              │                                   │
│        ┌─────────────┬───────┼──────────┬─────────────┐         │
│        │             │        │          │             │         │
│        ▼             ▼        ▼          ▼             ▼         │
│  ┌──────────┐ ┌──────────┐  ┌────────┐ ┌──────────┐ ┌──────┐   │
│  │ Brain    │ │Visibility│  │Cursor  │ │Foreground│ │ Tray │   │
│  │Service   │ │Controller│  │Polling │ │  Watch   │ └──────┘   │
│  └──────────┘ └──────────┘  └────────┘ └──────────┘            │
│        │
│        └──────────────────┐ (sends IPC messages)
│                           │
└───────────────────────────┼───────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
        ▼                   ▼                   ▼
    ┌────────┐          ┌────────┐         ┌────────┐
    │Pet      │          │Bubble  │         │ Chat   │
    │Window   │          │Window  │         │ Window │
    │────────┐           │────────┘         │────────┤
    │IPC:    │           │                   │        │
    │-Hover  │           │                   │        │
    │-Drag   │           │                   │        │
    │-Tap    │           │                   │        │
    └────────┘           └────────┘         └────────┘

    ┌────────┐
    │  Key   │
    │ Window │
    │────────┤
    │Settings│
    └────────┘


┌─────────────────────────────────────────────────────────────────┐
│                      DATA LAYER                                  │
│                                                                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────────────┐  │
│  │ Database │  │KeyStore  │  │History   │  │Character Bundle│  │
│  │ (SQLite) │  │(API Key) │  │Store     │  │(Live2D Config) │  │
│  │          │  │          │  │          │  │                │  │
│  │ds.sqlite │  │key.bin   │  │Messages  │  │character.json  │  │
│  └──────────┘  └──────────┘  └──────────┘  └─────────────────┘  │
│        ▲             ▲             ▲               ▲              │
│        │             │             │               │              │
│        └─────────────┼─────────────┼───────────────┘              │
│                      │(used by)    │                              │
│                    Brain Service                                  │
└─────────────────────────────────────────────────────────────────┘
```

## File Structure & What Each File Does

### Main Process Files (in `src/main/`)

**Core Orchestration:**
- `index.ts` - **THE FILE YOU READ** - Main entry point, creates all windows and services
- `app-protocol.ts` - Sets up the custom `app://` protocol for loading renderer pages
- `ipc.ts` - IPC helper functions (`sendTo`, `onFromPet`, etc.)

**Window Factories:**
- `pet-window.ts` - Creates the avatar window
- `bubble-window.ts` - Creates the speech bubble window  
- `chat-window.ts` - Creates the chat composer window
- `key-window.ts` - Creates the settings/API key window
- `tray.ts` - Creates the system tray icon and menu

**Core Services:**
- `brain-service.ts` - The AI orchestrator
  - Takes chat messages
  - Calls DeepSeek API
  - Updates character state
  - Manages speech bubbles
  - Stores messages

- `visibility-state.ts` - Tracks the 4 visibility reasons
  - `locked` - Screen is locked
  - `suspended` - System is asleep
  - `fullscreen` - Fullscreen app is running
  - `user` - User manually hid her
  - Combines them with OR logic

- `bubble-visibility.ts` - Tracks if bubble should show
  - Shell verdict (from visibility)
  - Brain wants to speak
  - Only shows if BOTH are true

- `cursor.ts` - Cursor polling service
  - Polls mouse position every ~50ms
  - Sends to pet renderer
  - Renderer updates eye gaze

- `foreground.ts` - Detects fullscreen apps
  - Polls active window
  - If fullscreen game detected, hide pet
  - If game closed, show pet again

**Helper Utilities:**
- `key-request.ts` - Gates key window shows through visibility verdict
- `chat-request.ts` - Handles chat open requests (deferred and late-bound)
- `key-store.ts` - Loads/saves API key
- `summarizer.ts` - Uses LLM to summarize old conversations
- `quit.ts` - Manages graceful shutdown with drain phase

**Error Handling:**
- `fatal.ts` - Shows fatal error dialog and quits
- `pet-window.ts` contains `handleLoadFailure` - Cleans up on renderer crash

---

### Renderer Files (in `src/renderer/`)

The renderer is the React app that actually draws the UI. Main process sends messages to it, it sends back user interactions.

There are 3 separate React apps:
1. **Pet Renderer** - Loads the Live2D model
2. **Bubble Renderer** - Shows speech text
3. **Chat Renderer** - Shows conversation history + input

Each one is a completely separate React component tree with its own HTML file.

---

### Preload Files (in `src/preload/`)

Preload scripts run in a special context between the main process and renderer. They're the secure gateway for IPC. Instead of renderers accessing Node.js directly, they use methods exposed through preload.

---

### Packages (shared code in `packages/`)

- `@ds/protocol` - Defines `Channels` enum (all IPC message types)
- `@ds/brain` - Handles character parsing, action vocabulary
- `@ds/memory` - Database access, history storage, SQLite bindings
- `@ds/stage` - Live2D model loading and animation control
- `@ds/behaviors` - Character animation and reaction system
- `@ds/sim` - Character state simulation (mood, energy, affection)

These are all used by `src/main/index.ts` and its services.

---

## The Message Flow (How Things Talk to Each Other)

### User drags the pet avatar:

```
1. Renderer (pet) detects mouse drag
2. Sends: Channels.avatarDrag { dx: 10, dy: 20 } via IPC
3. Main process receives it (line 350)
4. Calls: moveBy(window, 10, 20)
5. Calls: service.reposition()
   - Brain recalculates bubble position
   - Brain repositions bubble window
6. On drag end:
   - Saves position to disk
   - Saves in %APPDATA%\ds directory
```

### System lock screen:

```
1. OS locks screen
2. PowerMonitor fires 'lock-screen' event (line 311)
3. Main process receives it
4. Sets visibility.set('locked', true)
5. Calls visibility.apply()
6. visibility.apply() sends Channels.shellVisibility to:
   - Pet window → renderer hides
   - Bubble window → renderer hides
   - Chat window → closes if open
7. Sets click-through on pet window (it's hidden, no need to eat clicks)
```

### User tries to open chat while fullscreen game is running:

```
1. User clicks tray menu "Chat" or presses Ctrl+Shift+Space
2. Calls requestChat('tray', true) or requestChat('hotkey', true)
3. Calls decideChatRequest()
   - Checks visibility.verdict.hidden
   - If fullscreen game → hidden = true → returns 'refuse'
4. Decision is 'refuse', so just returns (no chat shown)
5. But if user double-clicks pet AFTER exiting game:
   - visibility.verdict.hidden = false
   - Returns 'open'
   - Opens chat window
```

### User enters an API key:

```
1. User types key in key window (React component)
2. Sends message to main process
3. Main process:
   - Saves to KeyStore
   - Tells brain service "key changed"
   - Brain rebuilds its client (the DeepSeek API client)
   - Hides key window
4. Brain is now ready to accept chat messages
```

### User sends a chat message:

```
1. User types message in chat window
2. Sends to main process via IPC
3. Brain service receives it:
   - Adds to history
   - Calls DeepSeek API
   - DeepSeek returns response + emotion tags
   - Updates character state (emotion, expression)
   - Saves response to history
   - Sends response to bubble window via IPC
4. Bubble window renderer shows speech bubble
5. Pet window renderer shows emotion/expression change
6. On message done:
   - Bubble hides after timeout
   - Pet returns to idle animation
```

---

## Why The Architecture Is Built This Way

### Why multiple windows?

- **Pet window**: Must be always-on-top, transparent, click-through
- **Bubble window**: Pops up near pet, can be invisible, independent lifetime
- **Chat window**: Focusable, can't be transparent, needs text input
- **Key window**: Only shows on first run or if key is invalid

Each has different requirements. A single window can't be both "invisible except on hover" and "accepts text input".

### Why IPC instead of direct function calls?

Electron runs:
- **Main process** - Node.js, has window control, file I/O, database
- **Renderer processes** - Chromium, has DOM/React, is sandboxed

They can't directly call each other's code. IPC (message passing) is the safe bridge.

### Why the visibility controller?

Initial approach: Just send `hidden: true/false` based on lock state.

Problem: Screen lock → sleep → wake → lock screen still showing → user unlocks. At the wake event, if you just set `hidden = false`, pet appears behind the lock screen (invisible).

Solution: Track FOUR independent reasons for hiding, combine with OR:
```
hidden = locked || suspended || fullscreen || userHidden
```

Now at wake:
- `suspended` becomes false
- But `locked` is still true
- `hidden` stays true
- Pet stays hidden ✓

### Why the bubble has its own visibility?

Bubble has TWO reasons to hide:
1. Shell verdict says it's hidden (lock/fullscreen)
2. Brain has nothing to say

Combining these:
```
bubbleVisible = (shellVisible) && (brainWantsToSpeak)
```

This ensures:
- If fullscreen game runs, bubble hides even if brain is mid-sentence
- If brain finishes, bubble hides even if still visible
- If both are true, bubble shows

### Why cursor polling instead of just mouse events?

Problem: Renderer (React) fires events on hover. But what if you hover over empty space?

- Web event fires: hover-off
- Cursor is still over empty space
- Next message sends: brain has something to say
- Bubble appears under cursor
- But renderer thinks cursor is still off the avatar
- Hover state is stale

Solution: Every 50ms, poll the actual cursor position and send it to renderer. Renderer computes avatar rect and compares. Always up-to-date.

---

## Key Takeaways

1. **index.ts is the conductor** - It creates everything and wires it together
2. **Windows are autonomous** - Each can crash/reload independently
3. **Visibility is the gate** - Every show decision goes through it
4. **IPC is the messenger** - Main ↔ Renderer communication
5. **Services are the domain logic** - Brain, visibility, cursor, foreground
6. **Cleanup matters** - Every service/listener has a stop/destroy
7. **Graceful shutdown** - The drain phase ensures no data loss

You now have a complete mental model. Pick any feature request and you know how to add it:
- New window type? Copy the pet window factory
- New visibility reason? Add to visibility controller
- New message type? Add to Channels enum and create a handler
- New periodic check? Make a polling service like cursor or foreground
