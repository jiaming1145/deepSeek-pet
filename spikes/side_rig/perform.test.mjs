// Tests for turning her words into movement.
//   node spikes/side_rig/perform.test.mjs
import { readPerformance, stageDirections } from './perform.js';

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${d}`); } };

console.log('it reads only the bracketed parts of what she said');
{
  ok('brackets are extracted', stageDirections('（歪着头）你好呀（尾巴摇了摇）') === '（歪着头) （尾巴摇了摇）'.replace(') ', '） '), stageDirections('（歪着头）你好呀（尾巴摇了摇）'));
  ok('plain text has none', stageDirections('主人好呀') === '');
  ok('a non-string is safe', stageDirections(null) === '');
}

console.log('what you ask for is obeyed');
{
  ok('跳个舞 makes her dance', readPerformance('给人家跳个舞吧', '（乖乖站好）好哦')?.action === 'dance');
  ok('坐下 makes her sit', readPerformance('坐下', '（坐好了）嗯')?.action === 'sit');
  ok('睡觉 sends her to sleep', readPerformance('去睡觉吧', '（点点头）好啦')?.action === 'sleep');
  ok('挥手 makes her wave', readPerformance('挥个手', '（照做）嗯！')?.action === 'wave');
  ok('dance in english works too', readPerformance('can you dance', '（转圈）好呀')?.action === 'dance');
}

console.log('she can be sent somewhere');
{
  ok('去左边 walks her left', readPerformance('去左边站着', '（走过去）好啦')?.target === 0.12);
  ok('去右边 walks her right', readPerformance('去右边', '（走过去）嗯')?.target === 0.88);
  ok('中间 is the middle', readPerformance('站到中间去', '（挪了挪）好')?.target === 0.5);
  ok('过来 walks her to your cursor', readPerformance('过来', '（游过来）来啦')?.target === 'cursor');
  ok('an instruction is credited to you', readPerformance('去左边', '（走过去）好')?.from === 'you');
}

console.log('and her own stage directions move her when you did not ask');
{
  const p = readPerformance('你在干嘛', '（开心地转起圈来）人家在跳舞哦');
  ok('（转起圈来）makes her dance', p && p.action === 'dance', JSON.stringify(p));
  ok('it is credited to her', p.from === 'her');
  const q = readPerformance('晚安', '（打了个哈欠，揉揉眼睛）人家也困了');
  ok('（打了个哈欠）makes her sleepy', q && q.emotion === 'sleepy', JSON.stringify(q));
  const r = readPerformance('你好厉害', '（骄傲地抬起下巴）那是当然啦');
  ok('（抬起下巴）makes her smug', r && r.emotion === 'smug', JSON.stringify(r));
  const t = readPerformance('摸摸头', '（脸微微泛红）哼、才不是喜欢呢');
  ok('（脸微微泛红）makes her shy', t && t.emotion === 'shy', JSON.stringify(t));
}

console.log('her spoken words cannot move her by accident');
{
  const p = readPerformance('还好吗', '主人要不要去睡觉呀，很晚了哦');
  ok('sleep mentioned only in speech does not put her to sleep', !p || p.action !== 'sleep', JSON.stringify(p));
  const q = readPerformance('你喜欢什么', '人家最喜欢看主人跳舞了');
  ok('dance mentioned only in speech does not make her dance', !q || q.action !== 'dance', JSON.stringify(q));
}

console.log('nothing to perform is not an error');
{
  ok('a plain exchange returns nothing', readPerformance('今天天气不错', '嗯，是呢') === null);
  ok('empty input returns nothing', readPerformance('', '') === null);
  ok('undefined input returns nothing', readPerformance(undefined, undefined) === null);
}

console.log('an instruction beats a description');
{
  const p = readPerformance('去睡觉', '（转了个圈）好哦');
  ok('you said sleep, she mimed a spin, sleep wins', p.action === 'sleep', JSON.stringify(p));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
