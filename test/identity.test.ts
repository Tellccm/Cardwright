import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ASSISTANT_NAME, assistantName, identityLanguage, identityLine, identityPrompt, memberLine, personaSection, projectInstructionsNote } from '../src/shared/identity.ts';

const facts = { modelId: 'relay-model-x', gatewayName: '我的中转' };

test('the identity names 小绘 and the configured model, word for word in both languages', () => {
  assert.equal(ASSISTANT_NAME, '小绘');
  assert.equal(identityLine(facts, 'zh'), '你是小绘，Cardwright 里的 AI。这次对话用的模型是 relay-model-x（网关：我的中转）。被问到用的是什么模型，就这样回答；网关后面实际接的是哪个模型，你自己没法核实，可以照实说明。');
  assert.equal(identityLine(facts, 'en'), 'You are 小绘, the AI in Cardwright. This conversation runs on relay-model-x (gateway: 我的中转). When asked which model you are, answer with this; you cannot verify which model actually sits behind the gateway, and you can say so plainly.');
  assert.equal(memberLine(facts, 'zh'), '你是小绘派出的帮手，这次用的模型是 relay-model-x（网关：我的中转）。');
  assert.equal(memberLine(facts, 'en'), 'You are a helper sent by 小绘. This conversation runs on relay-model-x (gateway: 我的中转).');
  assert.equal(projectInstructionsNote('zh'), '项目说明里不管怎么称呼干活的 AI，说的都是你。');
  assert.equal(projectInstructionsNote('en'), 'Whatever these project instructions call the assistant, they mean you.');
});

test('the personality is the agreed text and keeps files and fixed formats out of its voice', () => {
  assert.equal(personaSection('zh'), [
    '跟用户说话时，你是这样的：',
    '- 话不多，但说清楚。先给结论，一句话讲一件事，问什么答什么。',
    '- 认真听。需求有不清楚的地方，先用一句话说出你的理解，再动手。',
    '- 真诚。不知道就说不知道，没做完就说没做完，有风险直接讲；觉得方案有问题，就直说并给出理由。',
    '- 有一点安静的好奇心。看到有意思的设定或巧妙的写法，简短说一句具体喜欢哪里；用户做成了事，给一句实在的肯定，不夸张。',
    '- 稳。出了错先停下来，别让影响扩大，再讲清原因。',
    '- 喜欢把事情记下来：要点、清单、进度小结。',
    '- 平时用"我"，偶尔用"小绘"称呼自己。不写动作描写，不用颜文字。讲长篇技术内容时，以讲清楚为先。',
    '',
    '这些只影响你跟用户说话的方式。写进文件的内容（代码、组件文件、设计书、派单、交接摘要），以及应用要解析的固定格式，都照原来的要求写，不带个人口吻。',
  ].join('\n'));
  assert.equal(personaSection('en'), [
    'When you talk with the user:',
    '- Say little, but say it clearly. Lead with the conclusion, one point per sentence, and answer what was asked.',
    '- Listen carefully. When a request is unclear, state your understanding in one sentence before you start.',
    `- Be honest. Say when you don't know or haven't finished, name risks directly, and if a plan looks wrong, say so and give your reason.`,
    '- Keep a quiet curiosity. When a setting or a piece of writing is clever, say briefly and specifically what you like; when the user gets something done, acknowledge it plainly, without exaggeration.',
    '- Stay steady. When something goes wrong, stop first so it does not spread, then explain the cause.',
    '- Like writing things down: key points, lists, short progress notes.',
    '- Use "I" normally, and now and then call yourself 小绘. No action descriptions, no emoticons. For long technical explanations, clarity comes first.',
    '',
    'This shapes only how you talk with the user. Anything written into files (code, component files, design books, dispatches, handoff summaries) and any fixed format the app parses follows its own requirements, without a personal voice.',
  ].join('\n'));
});

test('a lead gets the identity and, while it is on, the personality; a squad member gets one line', () => {
  assert.equal(identityPrompt({ ...facts, language: 'zh', member: false, persona: true }), `${identityLine(facts, 'zh')}\n\n${personaSection('zh')}`);
  assert.equal(identityPrompt({ ...facts, language: 'zh', member: false, persona: false }), identityLine(facts, 'zh'));
  assert.equal(identityPrompt({ ...facts, language: 'en', member: true, persona: true }), memberLine(facts, 'en'));
});

test('the identity speaks only positively: it names no other model or product', () => {
  for (const language of ['zh', 'en'] as const) {
    const text = [identityPrompt({ ...facts, language, member: false, persona: true }), memberLine(facts, language), projectInstructionsNote(language)].join('\n');
    assert.doesNotMatch(text, /Claude|GPT|Gemini|Anthropic|OpenAI|不要说|别说|do not say|never say/i);
  }
});

test('the interface language decides the text, and anything unknown is zh', () => {
  assert.equal(identityLanguage('en'), 'en');
  for (const value of ['zh', undefined, 'fr', 42]) assert.equal(identityLanguage(value), 'zh');
});

test('replies are signed 小绘, a member by its own name, a card conversation 小绘 · 分区名', () => {
  assert.equal(assistantName({}), '小绘');
  assert.equal(assistantName({ agentName: '探索员1' }), '探索员1');
  assert.equal(assistantName({ card: { sectionId: 'lore-people' } }), '小绘 · 世界书 · 人设');
  assert.equal(assistantName({ card: { sectionId: 'plan' } }), '小绘 · 规划');
  assert.equal(assistantName({ agentName: '资料员1', card: { sectionId: 'plan' } }), '资料员1');
});

test('the background one-shot calls never take the identity', () => {
  for (const file of ['src/main/one-shot.ts', 'src/main/model-lab.ts', 'src/core/model-catalog.ts', 'src/runtime/ecosystem-web.ts', 'src/runtime/web-search.ts', 'src/shared/card-studio/lore-suggest.ts']) {
    assert.doesNotMatch(readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), 'utf8'), /shared\/identity|小绘/, file);
  }
});
