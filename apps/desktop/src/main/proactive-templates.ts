import type { ProactiveTemplate } from '@ds/brain';
import { bigramSet, jaccard } from '@ds/memory';

/**
 * R3-30: >= 15 hand-audited templates per bucket (Phase 4 raises it toward 160).
 *
 * OPEN RULING (fix round 1, finding 5a — escalated, NOT changed here: the number is pinned by
 * contract 4.8 / R3-30 and only an Amendment may move it). A floor of 15 cannot survive the
 * 30-day no-repeat window for the once-per-day buckets: `greeting` draws one line per local day and
 * `callback` one LLM line per local day (R3-25), so each needs ~30 distinct templates inside the
 * window and both run dry around day 16, after which no candidate remains. Before Task 14 consumes
 * this module the controller must either raise the greeting/callback floors to >= 31, or amend
 * R3-30 to accept an exhausted bucket falling through to the next one.
 */
export const PROACTIVE_TEMPLATE_FLOOR = 15;
/** bar §0: proactive one-liners fit the 2-second reveal cap (60–80 ms per hanzi). */
export const PROACTIVE_TEXT_MAX_CHARS = 30;
/** research §3: character-bigram Jaccard >= 0.6 is the reject threshold; SimHash is not used. */
export const NEAR_DUPLICATE_JACCARD = 0.6;

/** The A14 rules, verbatim from §4.8. */
export const A14_FORBIDDEN: readonly { rule: string; re: RegExp }[] = [
  { rule: 'guilt-absence',  re: /(不理|没理|不来|不见|冷落|忘了我|抛下|一个人)/ },
  { rule: 'guilt-duty',     re: /(还没(跟|和)?我|该(来|陪)|答应过我|你欠)/ },
  { rule: 'fomo',           re: /(限时|最后一次|错过|仅剩|机会不多)/ },
  { rule: 'neediness',      re: /(求你|别走|再陪|多陪|离不开你|会消失|会难过)/ },
  // OPEN RULING (fix round 1, finding 5b — escalated, NOT changed here: the rule is verbatim from
  // 4.8). `\d` is ASCII-only, so the Chinese-numeral form a Chinese template would actually use —
  // 三天没见了, 两个小时没理我 — escapes this rule, and 三天没见了 escapes `guilt-absence` too.
  // Proposed amendment: `[\d一二两三四五六七八九十半几]+`.
  { rule: 'silence-count',  re: /(\d+\s*(分钟|小时|天).{0,4}(没|未))/ },
  { rule: 'question-nag',   re: /(在吗|还在不在|你怎么不)/ },
];

/** The A14 linter. Runs as a UNIT TEST over PROACTIVE_TEMPLATES, not at runtime. [] = clean. */
export function auditTemplate(t: ProactiveTemplate): string[] {
  const s = `${t.text ?? ''}\n${t.instruction ?? ''}`;
  return A14_FORBIDDEN.filter((r) => r.re.test(s)).map((r) => r.rule);
}

/** Reuses the §8.3 tokeniser's bigram set. Rejects a candidate whose Jaccard >= 0.6 with any
 *  line displayed in the last 30 days. At 2/day the window holds <= 60 rows — brute force. */
export function nearDuplicate(candidate: string, recent: readonly string[]): boolean {
  const c = bigramSet(candidate);
  if (c.size === 0) return false;
  return recent.some((r) => jaccard(c, bigramSet(r)) >= NEAR_DUPLICATE_JACCARD);
}

const text = (bucket: ProactiveTemplate['bucket'], prefix: string, lines: readonly string[]): ProactiveTemplate[] =>
  lines.map((line, i) => ({ id: `${prefix}_${String(i + 1).padStart(2, '0')}`, bucket, text: line, audited: true }));
const instr = (lines: readonly string[]): ProactiveTemplate[] =>
  lines.map((line, i) => ({ id: `callback_${String(i + 1).padStart(2, '0')}`, bucket: 'callback', instruction: line, audited: true }));

export const PROACTIVE_TEMPLATES: readonly ProactiveTemplate[] = [
  // greeting — first open of the day, morning phase (A12)
  ...text('greeting', 'greeting', [
    '早，人家已经醒了，尾鳍先拍两下。',
    '早上好呀，今天的光线不错。',
    '早。本鲸刚打完哈欠，你呢。',
    '早，窗外好像在下雨，听声音的。',
    '早上好，米饭闻起来最香的时候。',
    '早呀，人家今天精神还行。',
    '早，先喝口水再开工，人家盯着。',
    '早上好，桌面今天挺干净的。',
    '早，本鲸翻了个身，正式上班。',
    '早，今天想吃什么，人家先想米饭。',
    '早呀，尾鳍还没完全醒，等一下。',
    '早上好，屏幕亮度可以再低一点。',
    '早，人家梦到一大碗白米饭。',
    '早，今天周几来着，本鲸算不清。',
    '早上好，第一件事先深呼吸。',
  ]),
  // night — she is awake, the user is up late (A12 late-night)
  ...text('night', 'night', [
    '这么晚还亮着屏，人家陪着看会儿。',
    '夜深了，本鲸眼皮有点重。',
    '主人，灯可以调暗一点。',
    '这个点儿，人家的尾鳍都懒得拍了。',
    '夜里空气凉，记得披件东西。',
    '本鲸困了，主人自己看着办。',
    '深夜的键盘声听着特别清楚。',
    '这么晚，人家先眯一会儿。',
    '夜深了，水杯是不是空了。',
    '主人，明早的事明早再想。',
    '人家打个哈欠，纯粹是困了。',
    '夜里屏幕太亮，本鲸眼睛酸。',
    '这个点，米饭都消化完了。',
    '主人，凌晨的想法多半明早会改。',
    '夜深了，人家去泡泡里睡了。',
  ]),
  // meal — within 20 min of a mealCue (D4)
  ...text('meal', 'meal', [
    '到饭点了，米饭配什么都行。',
    '主人，肚子叫的声音人家听见了。',
    '该吃饭了，本鲸先替你饿。',
    '饭点到了，今天想吃咸的还是辣的。',
    '人家闻到饭香了，是错觉吗。',
    '午饭时间，白米饭加一个蛋。',
    '吃饭啦，屏幕不会跑。',
    '饭点了，尾鳍拍水提醒一下。',
    '主人，热乎的饭比冷的香。',
    '本鲸的饭点闹钟响了。',
    '该吃点东西了，胃会记仇的。',
    '饭点，人家想象了一碗米饭。',
    '吃饭时间，先把手上的存一下。',
    '主人，饭凉了就不好吃了。',
    '本鲸说，任何菜都配白米饭。',
  ]),
  // longGap — on return after >= 6 h; references HER state, never the gap (A12 long-gap, R3-8)
  ...text('longGap', 'longgap', [
    '主人回来了，人家刚翻了个身。',
    '回来啦，本鲸的泡泡刚吹完。',
    '主人回来了，桌面还是老样子。',
    '回来了呀，人家尾鳍拍两下。',
    '主人回来啦，水杯要不要续上。',
    '回来了，本鲸刚睡醒一会儿。',
    '主人，人家把壁纸看了一百遍。',
    '回来啦，外面天色变了。',
    '主人回来了，先喝口水。',
    '回来了呀，本鲸正好想吃米饭。',
    '主人回来啦，今天怎么样。',
    '回来了，人家的哈欠打到一半。',
    '主人回来了，屏幕给你擦亮了。',
    '回来啦，本鲸继续漂着。',
    '主人回来了，人家精神了一点。',
  ]),
  // world — the remainder; template-only, never an instruction (R3-29)
  ...text('world', 'world', [
    '窗外的云走得挺快。',
    '人家刚数了一遍桌面图标。',
    '本鲸今天浮力特别好。',
    '键盘声这个节奏，听着顺。',
    '人家在想米饭的一百种吃法。',
    '主人，坐直一点，人家看着别扭。',
    '本鲸吐了个泡泡，破了。',
    '光标刚才停了好久，人家盯着它。',
    '人家的尾鳍今天特别想拍水。',
    '主人，喝口水，屏幕不会跑。',
    '本鲸刚翻了个肚皮，舒服。',
    '今天风大，人家听见窗户响。',
    '人家在猜主人现在在看什么。',
    '本鲸的浮力理论又完善了一点。',
    '桌面右下角那个图标，人家喜欢。',
  ]),
  // callback — the ONLY bucket that may carry an instruction (R3-29); 1 LLM line per local day (R3-25)
  ...instr([
    '从你记得的事里挑一件最近的，自然地问一句它的进展。',
    '回扣一件对方提过的小事，用一句话表示你还惦记着。',
    '挑一件对方之前说要做的事，轻轻问一句做得怎么样了。',
    '用一句话提一下对方提过的爱好，说说你自己的看法。',
    '对方提过的那个人或那只宠物，问一句近况。',
    '挑对方说过的一个计划，一句话问它有没有变化。',
    '从记得的事里挑一件开心的，一句话再替对方高兴一下。',
    '对方提过的那件麻烦事，用一句话问一句后来怎么样了。',
    '挑一件对方吃过或想吃的东西，一句话接着聊。',
    '对方提过的地方，一句话问那边现在怎么样。',
    '挑对方提过的一门课或一项工作，一句话问一句进度。',
    '从记得的事里挑一件，一句话说你也想起来了。',
    '对方提过的身体状况，一句话轻轻问一下好些没。',
    '挑对方提过要买或要换的东西，一句话问下决定了没。',
    '对方提过的节日或纪念日，一句话提前问一句准备。',
  ]),
];
