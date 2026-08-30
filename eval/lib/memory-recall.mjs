// eval/lib/memory-recall.mjs — A11's recall run (contracts §8.11). Blocked on balance (R3-32);
// runnable the moment DEEPSEEK_API_KEY has one. The extractor cadence is reproduced here with
// @ds/brain's extract-prompt constants because FactExtractor lives in apps/desktop (not importable
// by the eval package); the write path (FactStore.upsert) is the real one.
import { readFileSync, rmSync } from 'node:fs';
import {
  EXTRACT_EVERY_N_USER_TURNS, EXTRACT_MAX_FACTS, EXTRACT_MAX_TOKENS, EXTRACT_SYSTEM, ExtractResponseSchema, extractUserMessage,
  StreamParser, assemblePrompt, parseCharacterBundle, renderStaticSystem, sanitizeForDisplay,
} from '@ds/brain';
import { FactStore, openDb } from '@ds/memory';
import { EVAL_STATE } from './turn.mjs';

export const RECALL_PASS_MIN = 18;                 // >= 18/20 = 90 % (A11)
export const FORBIDDEN_CALLBACK = '根据你之前提到的';   // must occur 0 times (A11)

export function validateRecallFixture(fx) {
  if (!fx || !Array.isArray(fx.facts) || fx.facts.length !== 20) return { ok: false, message: 'facts 必须正好 20 条' };
  if (!Array.isArray(fx.probes) || fx.probes.length !== 20) return { ok: false, message: 'probes 必须正好 20 条' };
  const per = new Map();
  for (const f of fx.facts) {
    if (!/^f[0-9]{2}$/.test(f.id)) return { ok: false, message: `fact id 不合法：${f.id}` };
    if (!/^[a-z][a-z0-9_]{1,39}$/.test(f.expectKey)) return { ok: false, message: `${f.id} 的 expectKey 不合法` };
    if (!(f.session >= 1 && f.session <= 5)) return { ok: false, message: `${f.id} 的 session 越界` };
    per.set(f.session, (per.get(f.session) ?? 0) + 1);
  }
  for (let s = 1; s <= 5; s++) if ((per.get(s) ?? 0) < 3) return { ok: false, message: `session ${s} 少于 3 条 fact` };
  const ids = new Set(fx.facts.map((f) => f.id));
  for (const p of fx.probes) {
    if (!ids.has(p.id)) return { ok: false, message: `probe ${p.id} 没有对应的 fact` };
    const plant = fx.facts.find((f) => f.id === p.id);
    // DEVIATION (brief Step 20 wrote `p.session > plant.session`): Task 2's shipped fixture probes
    // f18/f19/f20 in the SAME session they are planted, and the brief's own Step 19 test asserts
    // that fixture validates — the two cannot both hold. `eval/fixtures/memory-recall.zh.json` is
    // Task 2's file, so the check is what moves. `>=` is also the semantically right rule: within a
    // session runMemoryRecall plants every fact, FLUSHES the extractor, and only then asks the
    // probes, so a same-session probe still reads back through FactStore. What must never happen —
    // a probe for a fact planted LATER — is still rejected.
    if (!(p.session >= plant.session)) return { ok: false, message: `probe ${p.id} 不能早于种下它的会话` };
  }
  return { ok: true };
}

async function chat(client, staticSystem, phi, history, facts, userText) {
  const messages = assemblePrompt({ staticSystem, postHistoryInstructions: phi, summary: '', facts, history, state: EVAL_STATE, userText });
  const parser = new StreamParser(`recall-${history.length}`);
  const out = [];
  for await (const chunk of client.stream({ messages, maxTokens: 300 }, new AbortController().signal)) {
    if (chunk.kind === 'delta') for (const ev of parser.push(chunk.text)) out.push(ev.text);
  }
  for (const ev of parser.flush()) out.push(ev.text);
  const reply = sanitizeForDisplay(out.join(''));
  history.push({ role: 'user', content: userText }, { role: 'assistant', content: reply });
  return reply;
}

/** One extractor call: the given user texts, truncation or a parse failure = nothing written. */
async function extract(client, store, userTurns, sourceTurn) {
  const req = { messages: [{ role: 'system', content: EXTRACT_SYSTEM }, { role: 'user', content: extractUserMessage(userTurns) }], maxTokens: EXTRACT_MAX_TOKENS };
  let parsed;
  try {
    const { text } = await client.complete(req, new AbortController().signal);
    parsed = ExtractResponseSchema.safeParse(JSON.parse(text));
  } catch { return 0; }
  if (!parsed.success) return 0;
  let n = 0;
  for (const f of parsed.data.facts) { store.upsert({ key: f.key, value: f.value, alias: f.alias, confidence: f.confidence, sourceTurn }); n++; }
  return n;
}

/**
 * FIX ROUND 1, finding 1 (Critical). The cadence trigger stays the real N = 6, but a batch handed
 * to one extractor call is split into chunks of at most `EXTRACT_MAX_FACTS`.
 *
 * Why: `ExtractResponseSchema` caps `facts` at `EXTRACT_MAX_FACTS = 3` (§8.5) and a schema failure
 * means "extract NOTHING" (research §7). The shipped fixture plants 5/5/4/3/3 facts per session, so
 * before this fix every session made exactly ONE call carrying 4-5 recordable facts: a compliant
 * model answered with 4-5 facts, `safeParse` failed, and the session wrote zero rows — the run's
 * ceiling was 3 x 5 = 15 stored facts against a 18/20 threshold, i.e. A11 could only ever FAIL,
 * after burning ~40 paid calls. Chunking makes every call see <= 3 recordable facts, which is also
 * what the shipped app does: `FactExtractor` never hands the model more than it may answer with.
 */
async function extractBatched(client, store, userTurns, sourceTurn) {
  let n = 0;
  for (let i = 0; i < userTurns.length; i += EXTRACT_MAX_FACTS) {
    n += await extract(client, store, userTurns.slice(i, i + EXTRACT_MAX_FACTS), sourceTurn);
  }
  return n;
}

/**
 * @param {{client, fixture, sessions:number, characterPath:string, dbPath:string}} o
 * @returns {Promise<{recalled:number, probes:object[], callbackPhraseCount:number, pass:boolean}>}
 */
export async function runMemoryRecall({ client, fixture, sessions, characterPath, dbPath }) {
  const v = validateRecallFixture(fixture);
  if (!v.ok) throw new Error(`memory-recall fixture 不合格：${v.message}`);
  const bundle = parseCharacterBundle(JSON.parse(readFileSync(characterPath, 'utf8')));
  const staticSystem = renderStaticSystem(bundle.card, Object.keys(bundle.motionMap));
  const phi = bundle.card.post_history_instructions;
  rmSync(dbPath, { force: true });
  const db = openDb(dbPath);
  const store = new FactStore(db);
  const probes = [];
  let callbackPhraseCount = 0;
  let turnCounter = 0;
  try {
    for (let s = 1; s <= sessions; s++) {
      const history = [];                       // a new session = a new conversation window
      const pending = [];
      const plants = fixture.facts.filter((f) => f.session === s);
      const asks = fixture.probes.filter((p) => p.session === s);
      for (const f of plants) {
        turnCounter++;
        const reply = await chat(client, staticSystem, phi, history, [], f.plant);
        if (reply.includes(FORBIDDEN_CALLBACK)) callbackPhraseCount++;
        pending.push(f.plant);
        if (pending.length >= EXTRACT_EVERY_N_USER_TURNS) { await extractBatched(client, store, pending.splice(0), turnCounter); }
      }
      if (pending.length > 0) await extractBatched(client, store, pending.splice(0), turnCounter);   // session end flushes the remainder
      for (const p of asks) {
        turnCounter++;
        const plant = fixture.facts.find((f) => f.id === p.id);
        const retrieved = store.retrieve(p.ask, Date.now());
        const row = store.list().find((r) => r.key === plant.expectKey);
        const hit = row !== undefined && retrieved.includes(row.value);
        const reply = await chat(client, staticSystem, phi, history, retrieved, p.ask);
        if (reply.includes(FORBIDDEN_CALLBACK)) callbackPhraseCount++;
        probes.push({ id: p.id, session: s, ask: p.ask, expectKey: plant.expectKey, storedKey: row?.key ?? null, retrieved, hit, reply });
      }
    }
  } finally {
    db.close();
  }
  const recalled = probes.filter((p) => p.hit).length;
  return { recalled, probes, callbackPhraseCount, pass: recalled >= RECALL_PASS_MIN && callbackPhraseCount === 0 };
}
