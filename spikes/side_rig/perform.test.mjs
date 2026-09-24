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

console.log('"stop" means stop, and only when it is not refused');
{
  const act = (asked, said = '（嗯）') => readPerformance(asked, said)?.action ?? null;
  ok('停 on its own stops her', act('停！') === 'idle');
  ok('停下 stops her', act('快停下') === 'idle');
  ok('别动 stops her', act('别动') === 'idle');
  ok('stop stops her', act('stop') === 'idle' && act('Stop dancing') === 'idle');
  ok('stay still stops her', act('stay still') === 'idle');
  ok('不要停，继续跳舞 keeps her dancing', act('不要停，继续跳舞') === 'dance', String(act('不要停，继续跳舞')));
  ok('跳个不停 is not a stop', act('跳个不停的舞吧', '（转起圈来）好耶') === 'dance', String(act('跳个不停的舞吧', '（转起圈来）好耶')));
  ok("don't stop dancing keeps her dancing", act("don't stop dancing") === 'dance', String(act("don't stop dancing")));
  ok('stay here and dance is a dance, not a freeze', act('stay here and dance for me') === 'dance', String(act('stay here and dance for me')));
}

console.log('a refusal covers its own clause and nothing more');
{
  const p = (asked, said = '（嗯）') => readPerformance(asked, said);
  ok('别跳舞了，去睡觉吧 sends her to sleep', p('别跳舞了，去睡觉吧')?.action === 'sleep', JSON.stringify(p('别跳舞了，去睡觉吧')));
  ok('别跳了，坐下 sits her down', p('别跳了，坐下')?.action === 'sit', JSON.stringify(p('别跳了，坐下')));
  ok('别去左边，去右边 walks her right', p('别去左边，去右边')?.target === 0.88, JSON.stringify(p('别去左边，去右边')));
  ok('去右边，别去左边 walks her right too', p('去右边，别去左边')?.target === 0.88, JSON.stringify(p('去右边，别去左边')));
  for (const refusal of ['不许睡觉', '不准睡觉', '我不想让你睡觉', '你不能睡觉', '别睡了']) {
    ok(`${refusal} does not put her to sleep`, p(refusal)?.action !== 'sleep', JSON.stringify(p(refusal)));
  }
  ok('no more dancing does not make her dance', p('no more dancing')?.action !== 'dance');
  ok('醒醒，去跳舞 is a dance', p('醒醒，去跳舞')?.action === 'dance', JSON.stringify(p('醒醒，去跳舞')));
  ok('醒醒 on its own wakes her', p('醒醒')?.action === 'wake', JSON.stringify(p('醒醒')));
  ok('wake up wakes her', p('wake up!')?.action === 'wake');
  ok('醒醒，别睡了 wakes her rather than doing nothing', p('醒醒，别睡了')?.action === 'wake', JSON.stringify(p('醒醒，别睡了')));
}

console.log('English keywords are whole words');
{
  const p = (asked, said = '(nods)') => readPerformance(asked, said);
  ok('alright is not a direction', p('alright, how was your day?') === null, JSON.stringify(p('alright, how was your day?')));
  ok('I left my phone is not a direction', p('I left my phone at home') === null, JSON.stringify(p('I left my phone at home')));
  ok('you are right is not a direction', p("you're right") === null, JSON.stringify(p("you're right")));
  ok('welcome is not come', p('welcome to my desktop')?.target !== 'cursor', JSON.stringify(p('welcome to my desktop')));
  ok('detail is not tail', p('tell me in detail') === null, JSON.stringify(p('tell me in detail')));
  ok('go left still walks her left', p('go left please')?.target === 0.12);
  ok('walk to the right still walks her right', p('can you walk over to the right')?.target === 0.88);
  ok('come here still calls her over', p('Come here!')?.target === 'cursor');
  ok('dancing counts as dance', p('I love dancing with you')?.action === 'dance');
  ok('NAP in capitals counts', p('NAP TIME')?.action === 'sleep');
  ok('an inflection like napping counts', p('go napping')?.action === 'sleep');
}

console.log('a word that merely contains a negator is not a refusal');
{
  const p = (asked, said = '') => readPerformance(asked, said);
  ok('你能不能跳个舞 is a request to dance', p('你能不能跳个舞')?.action === 'dance', JSON.stringify(p('你能不能跳个舞')));
  ok('能不能坐下 is a request to sit', p('能不能坐下')?.action === 'sit');
  ok('你能不能过来 calls her over', p('你能不能过来')?.target === 'cursor');
  ok('要不要跳个舞 is a request to dance', p('要不要跳个舞')?.action === 'dance');
  ok('我特别想看你跳舞 is not 别 (don\'t)', p('我特别想看你跳舞')?.action === 'dance');
  ok('whenever I dance does not contain never', p('whenever I dance')?.action === 'dance');
  ok('never dance again still refuses', p('never dance again')?.action !== 'dance');
  ok('（特别开心地转起圈来）is her dancing', p('', '（特别开心地转起圈来）')?.action === 'dance');
  ok('（别扭地挥了挥手）is her waving', p('', '（别扭地挥了挥手）')?.action === 'wave');
  ok('（别别扭扭地坐下）is her sitting', p('', '（别别扭扭地坐下）')?.action === 'sit');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
