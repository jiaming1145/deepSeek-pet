# DS Desktop App - Implementation Recipes
## Copy-Paste Starting Points for Building Similar Apps

---

## Recipe 1: Create a New Window Type

**Goal:** Add a new window (like a settings window)

### Step 1: Create the Window Factory

File: `src/main/settings-window.ts`

```typescript
import { BrowserWindow } from 'electron';
import { join } from 'node:path';

export type SettingsWindowHooks = {
  onLoadFailure: (err: unknown) => void;
  onCrash?: () => void;
};

export function createSettingsWindow(hooks: SettingsWindowHooks): BrowserWindow {
  const win = new BrowserWindow({
    width: 600,
    height: 500,
    show: false, // Hidden initially, shown by visibility system
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const handleLoadFailure = (err: unknown) => {
    hooks.onLoadFailure(err);
  };

  win.webContents.on('crashed', () => {
    hooks.onCrash?.();
  });

  win.webContents.on('failed-to-load', handleLoadFailure);
  win.webContents.on('render-process-gone', (event, details) => {
    if (details.exitCode !== 0) {
      handleLoadFailure(new Error(`Exit code: ${details.exitCode}`));
    }
  });

  // Load the settings page
  win.loadURL('app://settings');

  return win;
}
```

### Step 2: Update index.ts to Create It

```typescript
// Line 45, add:
let settings: BrowserWindow | null = null;

// In app.whenReady(), after creating chatWin:
const settingsWin = createSettingsWindow({
  onLoadFailure: onLoadFailure('settings'),
  onCrash: () => console.log('[settings] crashed'),
});
settings = settingsWin;

// Before quitting, destroy it:
for (const win of [bubble, chat, keyWin, settings]) 
  if (win && !win.isDestroyed()) win.destroy();
```

### Step 3: Add IPC Handler

```typescript
// In app.whenReady(), after chat handlers:
onFromAny([settingsWin], Channels.settingsSave, ({ key, value }) => {
  // Save setting to database
  console.log('[settings]', key, value);
});

// From settings window to main:
sendTo(settingsWin, Channels.settingsLoad, { theme: 'dark' });
```

---

## Recipe 2: Add a New Visibility Reason

**Goal:** Hide the pet when a specific condition occurs

### Step 1: Add the Reason to Visibility Controller

File: `src/main/visibility-state.ts` (you'd need to read this file, but the pattern is):

```typescript
// Inside visibility controller state:
let reasons = {
  locked: false,
  suspended: false,
  fullscreen: false,
  user: false,
  paused: false,  // NEW REASON
};

// Getter to set it:
controller.set('paused', true);  // Pet is paused
controller.set('paused', false); // Unpause

// The verdict is auto-computed:
hidden = reasons.locked || reasons.suspended || reasons.fullscreen || 
         reasons.user || reasons.paused;
```

### Step 2: Wire It to Your Trigger

```typescript
// Example: Hide pet when app loses focus

const window = app.getCurrentWindow(); // or pass one in

window.on('blur', () => {
  visibility.set('paused', true);
  visibility.apply();
});

window.on('focus', () => {
  visibility.set('paused', false);
  visibility.apply();
});
```

That's it! Now the pet automatically hides when the app loses focus, just like she hides for lock screens.

---

## Recipe 3: Add a New IPC Message Type

**Goal:** Let the renderer communicate a new piece of data to main

### Step 1: Define the Channel

File: `packages/protocol/src/index.ts` (or wherever Channels is):

```typescript
export enum Channels {
  // ... existing channels ...
  
  // New channel:
  customEvent = 'custom:event',
  customResponse = 'custom:response',
}
```

### Step 2: Create Types for the Message

```typescript
// If you want structured data:
export type CustomEventPayload = {
  action: 'play' | 'stop';
  volume: number;
};

export type CustomResponsePayload = {
  status: 'success' | 'error';
  message: string;
};
```

### Step 3: Send from Renderer

In your React component (`src/renderer/*/App.tsx`):

```typescript
import { Channels } from '@ds/protocol';

function MyComponent() {
  const handleClick = () => {
    // Assuming you have access to ipcRenderer:
    window.api.send(Channels.customEvent, {
      action: 'play',
      volume: 0.8,
    });
  };

  return <button onClick={handleClick}>Play</button>;
}
```

### Step 4: Handle in Main Process

In `src/main/index.ts`:

```typescript
onFromPet(petWin, Channels.customEvent, ({ action, volume }) => {
  console.log('[custom]', action, volume);
  
  if (action === 'play') {
    // Do something
  }
});

// Send response back:
sendToPet(petWin, Channels.customResponse, {
  status: 'success',
  message: 'Done',
});
```

---

## Recipe 4: Create a Service Like Brain

**Goal:** Build a service that runs continuously and manages a subsystem

### Step 1: Create the Service Class

File: `src/main/my-service.ts`

```typescript
import { BrowserWindow } from 'electron';
import type { DatabaseSync } from 'node:sqlite';

export class MyService {
  private window: BrowserWindow;
  private db: DatabaseSync;
  private running = false;
  private pollInterval: NodeJS.Timeout | null = null;

  constructor(window: BrowserWindow, db: DatabaseSync) {
    this.window = window;
    this.db = db;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    console.log('[my-service] started');
    
    // Poll every 5 seconds
    this.pollInterval = setInterval(() => this.poll(), 5000);
    
    // Also run immediately
    this.poll();
  }

  private poll(): void {
    const data = this.db.prepare('SELECT * FROM my_table').all();
    console.log('[my-service] poll:', data);
    
    // Send to renderer:
    if (!this.window.isDestroyed()) {
      this.window.webContents.send('my:data', data);
    }
  }

  async dispose(): Promise<void> {
    this.running = false;
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    console.log('[my-service] disposed');
  }
}
```

### Step 2: Wire It in index.ts

```typescript
let myService: MyService | null = null;

// In app.whenReady():
myService = new MyService(petWin, database);
myService.start();

// In beforeQuit drain:
drain: async () => {
  const service = myService;
  myService = null;
  await service?.dispose();
},
```

---

## Recipe 5: Add a Global Hotkey

**Goal:** Let user press a keyboard combo to trigger an action

### Already in the code!

```typescript
// Line 405-407
if (!globalShortcut.register('Control+Shift+Space', () => requestChat('hotkey', true))) {
  console.error('[hotkey] Ctrl+Shift+Space is already taken by another app');
}

// To add another hotkey:
globalShortcut.register('Alt+D', () => {
  console.log('[hotkey] Alt+D pressed');
  tray?.popUpContextMenu();
});

// Unregister in teardown:
globalShortcut.unregisterAll();
```

---

## Recipe 6: Create a Lifecycle Manager Like `quit.ts`

**Goal:** Handle a complex multi-phase shutdown

### The Pattern

```typescript
// src/main/my-lifecycle.ts

export type MyLifecycleCallbacks = {
  sync: () => void;           // Fast, synchronous cleanup
  drain: async () => void;    // Await long-running tasks
  afterDrain: () => void;     // Fast, after drain finishes
  final: () => void;          // Last thing before returning
};

export function createMyLifecycle(callbacks: MyLifecycleCallbacks) {
  let drainInProgress = false;
  let isDone = false;

  return {
    handler: async (canPrevent: { preventDefault: () => void }) => {
      if (isDone) return;
      isDone = true;
      
      // Prevent the default close behavior while we clean up
      canPrevent.preventDefault();

      try {
        console.log('[lifecycle] sync phase');
        callbacks.sync();

        console.log('[lifecycle] drain phase');
        drainInProgress = true;
        await Promise.race([
          callbacks.drain(),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('drain timeout')), 10000)
          ),
        ]);
        drainInProgress = false;

        console.log('[lifecycle] after-drain phase');
        callbacks.afterDrain();
      } catch (err) {
        console.error('[lifecycle] error during cleanup:', err);
      }

      console.log('[lifecycle] final phase');
      callbacks.final();
    },
  };
}
```

### Usage

```typescript
// In index.ts:
const lifecycle = createMyLifecycle({
  sync: () => {
    console.log('Fast cleanup');
  },
  drain: async () => {
    console.log('Waiting for pending operations...');
    // Wait for any background operations
    await new Promise(r => setTimeout(r, 1000));
  },
  afterDrain: () => {
    console.log('Now safe to destroy windows');
  },
  final: () => {
    app.quit();
  },
});

app.on('before-quit', lifecycle.handler);
```

---

## Recipe 7: Implement Window State Persistence

**Goal:** Remember where the window was positioned when the app closes

### Step 1: When User Moves Window

```typescript
// src/main/index.ts, around line 350:

onFromPet(petWin, Channels.avatarDragEnd, (_payload, win) => {
  savePetPosition(win);  // This function does the saving
  service.reposition();
});
```

### Step 2: The Saver Function

```typescript
// src/main/window-state.ts

import { BrowserWindow } from 'electron';
import { join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';

type WindowState = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function getStatePath(): string {
  return join(process.env.APPDATA || '', 'ds', 'window-state.json');
}

export function savePetPosition(win: BrowserWindow): void {
  const [x, y] = win.getPosition();
  const [width, height] = win.getSize();
  
  const state: WindowState = { x, y, width, height };
  writeFileSync(getStatePath(), JSON.stringify(state));
  console.log('[window] saved position', state);
}

export function loadPetPosition(): WindowState | null {
  try {
    const data = readFileSync(getStatePath(), 'utf8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}
```

### Step 3: Apply on Startup

```typescript
// In src/main/pet-window.ts, in createPetWindow:

const savedState = loadPetPosition();
const petWin = new BrowserWindow({
  x: savedState?.x ?? 100,
  y: savedState?.y ?? 100,
  width: savedState?.width ?? 200,
  height: savedState?.height ?? 200,
  // ... other options
});
```

---

## Recipe 8: Implement Error Recovery (Window Crashes)

**Goal:** If a window crashes, try to recover it

### The Pattern

```typescript
let windowCrashCount = 0;

const recreateWindow = (old: BrowserWindow | null) => {
  windowCrashCount++;
  
  if (windowCrashCount >= 3) {
    console.error('[recovery] Too many crashes, giving up');
    fatal('Window keeps crashing. Please restart the app.');
    return;
  }

  const newWin = createWindow(); // your factory function
  
  // Don't show immediately:
  newWin.hide();
  
  // Wait a bit for the OS to settle:
  setTimeout(() => {
    newWin.show();
    windowCrashCount = 0; // Reset counter if recovery succeeds
  }, 1000);
  
  return newWin;
};

// Listen for crashes:
window.webContents.on('crashed', () => {
  console.log('[window] crashed');
  const newWin = recreateWindow(window);
  if (newWin) {
    window = newWin;
    // Tell services about the new window...
  }
});
```

See the actual `bubble-window.ts` in the repo for the full pattern.

---

## Recipe 9: Communicate Between Main and Renderer

### Main → Renderer (Send)

```typescript
// In main process:
sendToPet(petWindow, Channels.shellVisibility, { hidden: false });
```

### Renderer → Main (Listen)

```typescript
// In React component:
useEffect(() => {
  const handler = (event, payload) => {
    console.log('Received:', payload);
    // Update state based on payload
  };
  
  window.api.on(Channels.shellVisibility, handler);
  
  return () => window.api.off(Channels.shellVisibility, handler);
}, []);
```

### Renderer → Main (Send)

```typescript
// In React component:
const handleClick = () => {
  window.api.send(Channels.avatarTap, { hitArea: 'face' });
};
```

### Main ← Renderer (Listen)

```typescript
// In main process:
onFromPet(petWin, Channels.avatarTap, ({ hitArea }) => {
  console.log('Pet was tapped:', hitArea);
});
```

---

## Recipe 10: Test Your App's Logic

**Goal:** Verify your code works before shipping

### Example Test

File: `src/main/my-service.test.ts`

```typescript
import { describe, it, expect, vi } from 'vitest';
import { MyService } from './my-service';

describe('MyService', () => {
  it('should poll every 5 seconds', async () => {
    const mockDb = {
      prepare: (sql) => ({
        all: () => [{ data: 1 }],
      }),
    };

    const mockWindow = {
      isDestroyed: () => false,
      webContents: {
        send: vi.fn(),
      },
    };

    const service = new MyService(mockWindow as any, mockDb as any);
    service.start();

    // Wait for first poll:
    await new Promise(r => setTimeout(r, 100));

    expect(mockWindow.webContents.send).toHaveBeenCalledWith(
      'my:data',
      [{ data: 1 }]
    );

    await service.dispose();
  });
});
```

### Run Tests

```bash
npm run test          # Run all tests
npm run test -- --ui  # Interactive UI
npm run test -- --watch  # Watch mode
```

---

## Complete Example: Adding a Timer Feature

Let's add a simple pomodoro timer to the pet:

### 1. Define the IPC Channel

```typescript
// packages/protocol/src/index.ts
export enum Channels {
  timerStart = 'timer:start',
  timerTick = 'timer:tick',
  timerDone = 'timer:done',
}
```

### 2. Create the Timer Service

```typescript
// src/main/timer-service.ts
export class TimerService {
  private timeRemaining = 0;
  private interval: NodeJS.Timeout | null = null;
  private onTick: (remaining: number) => void = () => {};
  private onDone: () => void = () => {};

  start(durationSeconds: number): void {
    this.timeRemaining = durationSeconds;
    
    if (this.interval) clearInterval(this.interval);
    
    this.interval = setInterval(() => {
      this.timeRemaining--;
      this.onTick(this.timeRemaining);
      
      if (this.timeRemaining <= 0) {
        this.stop();
        this.onDone();
      }
    }, 1000);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  setOnTick(cb: (remaining: number) => void): void {
    this.onTick = cb;
  }

  setOnDone(cb: () => void): void {
    this.onDone = cb;
  }
}
```

### 3. Wire It in Main

```typescript
// src/main/index.ts
let timer: TimerService | null = null;

// In app.whenReady():
timer = new TimerService();
timer.setOnTick((remaining) => {
  sendToPet(petWin, Channels.timerTick, { remaining });
});
timer.setOnDone(() => {
  sendToPet(petWin, Channels.timerDone, {});
});

// Handle start requests:
onFromPet(petWin, Channels.timerStart, ({ duration }) => {
  timer?.start(duration);
});
```

### 4. Use in React

```typescript
// src/renderer/pet/App.tsx
import { useEffect, useState } from 'react';

export function App() {
  const [timeRemaining, setTimeRemaining] = useState(0);

  useEffect(() => {
    const handleTick = (_, { remaining }) => {
      setTimeRemaining(remaining);
    };

    window.api.on(Channels.timerTick, handleTick);
    return () => window.api.off(Channels.timerTick, handleTick);
  }, []);

  const handleStartTimer = () => {
    window.api.send(Channels.timerStart, { duration: 25 * 60 }); // 25 min
  };

  return (
    <div>
      <p>Time: {timeRemaining}s</p>
      <button onClick={handleStartTimer}>Start Timer</button>
    </div>
  );
}
```

---

## Key Patterns to Remember

1. **All windows are created early** and kept hidden
2. **Visibility controller gates all shows**
3. **Services are created in index.ts** and passed all dependencies
4. **IPC is the bridge** between main and renderer
5. **Crash recovery** recreates windows and updates service references
6. **Graceful shutdown** has three phases: sync, drain (async), afterDrain
7. **Tests catch bugs early** before they become hard to find

You now have the playbook. Any feature you want to add follows one of these recipes!
