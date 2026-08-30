import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CharacterCardSchema, cardTokens, CARD_TOKEN_BUDGET } from '@ds/brain';
import { ATTRIBUTION_PASS_MIN, PERSONA_IDS, buildAttributionSystem, buildAttributionUser, parseAttribution, personaPath } from './persona-bleed.mjs';

test('the three cards parse and fit the 700-token budget; the fixture has 20 pbNN prompts (§9.6)', () => {
  for (const id of PERSONA_IDS) {
    const card = CharacterCardSchema.parse(JSON.parse(readFileSync(personaPath(id), 'utf8')));
    assert.ok(cardTokens(card) <= CARD_TOKEN_BUDGET, id);
  }
  const fx = JSON.parse(readFileSync(fileURLToPath(new URL('../fixtures/persona-bleed.zh.json', import.meta.url)), 'utf8'));
  assert.equal(fx.prompts.length, 20);
  for (const p of fx.prompts) assert.match(p.id, /^pb[0-9]{2}$/);
  assert.equal(ATTRIBUTION_PASS_MIN, 0.85);
});

test('the attribution prompt is blind: labels 甲/乙/丙, no card names, and the answer parses', () => {
  const cards = PERSONA_IDS.map((id) => CharacterCardSchema.parse(JSON.parse(readFileSync(personaPath(id), 'utf8'))));
  const sys = buildAttributionSystem(cards);
  for (const c of cards) assert.ok(!sys.includes(c.name), c.name);
  assert.match(sys, /甲[\s\S]*乙[\s\S]*丙/);
  const user = buildAttributionUser('今天天气不错。', '嗯。');
  assert.match(user, /只输出 JSON/);
  assert.equal(parseAttribution('{"persona":"乙"}'), 1);
  assert.equal(parseAttribution('废话 {"persona":"丙"} 更多'), 2);
  assert.equal(parseAttribution('{"persona":"丁"}'), null);
});

// FIX ROUND 1, finding 4 (Minor). §9.6 requires eval/personas/haru.json to be a copy of the SHIPPED
// card, but the only drift check was a manual re-run of the generator script. Task 12 (T3-B) edits
// characters/haru/character.json in batch 4, and the card's own creator_notes says the P5/E-1
// persona tuning is still pending — either would silently leave this copy stale and measure a
// future A8 number against a persona that is no longer shipped. This assertion is now the check.
test('eval/personas/haru.json is the shipped card, not a stale copy (§9.6)', () => {
  const CHARACTER = fileURLToPath(new URL('../../characters/haru/character.json', import.meta.url));
  assert.deepEqual(
    JSON.parse(readFileSync(personaPath('haru'), 'utf8')),
    JSON.parse(readFileSync(CHARACTER, 'utf8')).card,
    '再跑一次生成脚本，把 eval/personas/haru.json 同步成 characters/haru/character.json 的 card',
  );
});
