import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (relative: string) => readFileSync(fileURLToPath(new URL(`../src/renderer/${relative}`, import.meta.url)), 'utf8');

test('头像与外观 has 小绘的性格: on unless switched off, with the plain explanation', () => {
  const appearance = read('AppearanceSettings.tsx');
  assert.match(appearance, /export function PersonaSettings\(\)/);
  assert.ok(appearance.includes('小绘的性格'));
  assert.ok(appearance.includes('关掉后仍叫小绘、仍如实说出所用模型，只是说话变成中性语气。'));
  assert.ok(appearance.includes('checked={prefs.persona !== false}'));
  assert.ok(appearance.includes('api.savePreferences({ persona: value })'));
  assert.ok(read('Settings.tsx').includes('<AvatarSettings /><PersonaSettings />'));
});

test('the global instructions in 头像与外观 are addressed to 小绘, the AI, not to the software', () => {
  const settings = read('Settings.tsx');
  assert.ok(settings.includes(`<div className="instructions-setting"><h3>{t('Instructions for 小绘', '给小绘的指令')}</h3>`));
  assert.ok(!settings.includes('Instructions for Cardwright'), 'the English heading no longer speaks to the software');
  assert.ok(!settings.includes('给 Cardwright 的指令'), 'the Chinese heading no longer speaks to the software');
});

test('the workbench pickers start on executor, and the squad names roles by their 界面名', () => {
  for (const file of ['Composer.tsx', 'TaskView.tsx', 'AgentSquad.tsx']) assert.doesNotMatch(read(file), /general-purpose|role === 'explore'|role === 'plan'/, file);
  assert.ok(read('Composer.tsx').includes("useState('executor')"));
  assert.ok(read('TaskView.tsx').includes("useState('executor')"));
  assert.ok(read('AgentSquad.tsx').includes("const role = member.role || 'executor';"));
});

test('replies are signed 小绘 in the workbench and 小绘 · 分区名 in the card studio; the avatar stays the mark', () => {
  const conversation = read('Conversation.tsx');
  assert.ok(conversation.includes('{assistantName(task)}'));
  assert.ok(!conversation.includes("|| 'Cardwright'"));
  const avatar = read('Avatar.tsx');
  assert.ok(avatar.includes('member || ASSISTANT_NAME'));
  assert.ok(avatar.includes('<Mark size='), 'the default AI avatar is still the Cardwright mark');
  assert.ok(read('AppearanceSettings.tsx').includes(': ASSISTANT_NAME}</small>'), 'AGENT / 小绘');
  const thread = read('card-studio/SectionThread.tsx');
  assert.ok(thread.includes('<b>{assistantName(task)}</b>'));
  assert.ok(!thread.includes('} AI`'));
});
