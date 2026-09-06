// A feeling arriving gives her a small physical jolt: a head snap and a kick through her hair springs. This
// checks that the jolt is small, and that it cannot come back from the dead.
//
//   cd D:\ds\apps\desktop
//   npx electron ../../spikes/side_rig/mood_impulse.test.cjs
//
// The jolt decays as exp(-6 * age), where age is measured against the rig's clock. `lab.begin()` restarts that
// clock. So a mood set before a `lab.begin()` left an impulse whose age was NEGATIVE, and a negative age turns
// that decay into growth: measured, it drove her head to -4291 radians - about 683 full rotations - which
// whipped the hair chains hanging off her head straight out to their limits and drew a spiky halo around her.
// Because it only bit when a mood happened to be set before a restart, it looked like the screenshot tool was
// randomly flaky rather than like a bug.
//
// This is the test that failed on that code and passes on the fix. `lab.start()` does not restart the clock, so
// it is the control: if it ever diverges from `lab.begin()`, something other than staleness is wrong.
const { app, BrowserWindow } = require('electron');
const path = require('node:path');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
const failures = [];
const check = (name, ok, detail) => {
  if (ok) { passed++; console.log('  ok   ' + name); }
  else { failures.push(name); console.log('  FAIL ' + name + ' -- ' + detail); }
};

app.commandLine.appendSwitch('allow-file-access-from-files');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ x: -3000, y: -3000, width: 640, height: 900, show: true, transparent: true,
    frame: false, skipTaskbar: true, webPreferences: { contextIsolation: true, sandbox: false, backgroundThrottling: false } });
  const rendererErrors = [];
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 2) rendererErrors.push(message); });
  await win.loadFile(path.join(__dirname, 'index.html'), { query: { rig: 'rig.json', front: 'rig_front.json' } });
  const js = (s) => win.webContents.executeJavaScript(s, true);
  await wait(1100);
  await js('lab.hud(false); lab.pause(true)');

  // Her head never legitimately leaves this range: the largest deliberate head angle in any action is about a
  // quarter of a radian, so a whole radian is already far outside anything the animation asks for.
  const HEAD_SANE = 1.0;
  const worstChain = () => js('(() => { const s = lab.snapshot().springs; let t = 0, n = null;'
    + ' for (const k of Object.keys(s)) if (Math.abs(s[k]) > t) { t = Math.abs(s[k]); n = k; } return { n, t }; })()');

  const scenario = async (name, script) => {
    await js("lab.begin('idle'); lab.step(2.0)");
    await js(script);
    let worstHead = 0, chain = { n: null, t: 0 };
    for (let i = 0; i < 90; i++) {                       // a second and a half, well past the 0.7 s decay
      await js('lab.step(1/60)');
      worstHead = Math.max(worstHead, Math.abs(await js('lab.bone("head").pose')));
      const c = await worstChain();                      // watched throughout: the halo is over in a few frames
      if (c.t > chain.t) chain = c;
    }
    check(name + ' - her head stays put', worstHead < HEAD_SANE, `head reached ${worstHead.toFixed(1)} rad`);
    check(name + ' - her hair is not flung out', chain.t < 0.9, `chain ${chain.n} reached ${chain.t.toFixed(3)}`);
  };

  // the ordering that used to break: a mood, then a restart of the clock underneath it
  await scenario('mood then lab.begin', "lab.emotion('cheerful'); lab.begin('land'); lab.step(0.05)");
  await scenario('mood then lab.begin, dancing', "lab.emotion('panic'); lab.begin('dance'); lab.step(0.05)");
  // the control: lab.start does not touch the clock, so this path was always fine and must stay that way
  await scenario('mood then lab.start', "lab.emotion('happy'); lab.start('land'); lab.step(0.05)");
  // and the ordinary way round
  await scenario('lab.begin then mood', "lab.begin('idle'); lab.emotion('surprised'); lab.step(0.05)");

  // The jolt must still exist - deleting it would pass everything above.
  await js("lab.begin('idle'); lab.step(2.0); lab.emotion('neutral'); lab.step(1.0)");
  await js("lab.emotion('panic')");
  let moved = 0;
  for (let i = 0; i < 30; i++) { await js('lab.step(1/60)'); moved = Math.max(moved, Math.abs(await js('lab.bone("head").pose'))); }
  check('a feeling still jolts her', moved > 0.01, `her head moved only ${moved.toFixed(4)} rad when her mood changed`);

  check('no renderer errors', rendererErrors.length === 0, rendererErrors.slice(0, 2).join(' | '));
  console.log(`\n${passed} passed, ${failures.length} failed`);
  app.exit(failures.length ? 1 : 0);
});
