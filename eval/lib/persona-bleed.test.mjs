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
