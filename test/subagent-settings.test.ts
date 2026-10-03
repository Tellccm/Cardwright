import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CUSTOM_ROLE_ID } from '../src/shared/agents.ts';

const renderer = join(process.cwd(), 'src', 'renderer');

test('the subagent settings say what is off, what the file’s model does, and show the 说明', () => {
  const page = readFileSync(join(renderer, 'EcosystemSettings.tsx'), 'utf8');
  assert.match(page, /项目里带的子代理默认关闭，确认内容可信再打开。/);
  assert.match(page, /文件里的 model（\$\{role\.model\}）不起作用/);
  assert.match(page, /在这个项目里，它会顶替同名的/);
  assert.match(page, /<p>\{roleDescription\(role\)\}<\/p>/, 'a row shows the 说明, or the first line of the instructions');
  assert.match(page, /label=\{t\('Description', '说明'\)\}/);
  assert.match(page, /description: value\.description\?\.trim\(\) \|\| undefined/);
  assert.doesNotMatch(page, /<span className="badge">\{role\.model\}<\/span>/, 'the file’s model is no longer shown as if it were used');
  const css = readFileSync(join(renderer, 'styles.css'), 'utf8');
  assert.match(css, /\.ecosystem-config-list small\.agent-note\s*\{[^}]*var\(--muted\)/);
  assert.match(css, /\.ecosystem-config-list small\.agent-warning\s*\{[^}]*var\(--warning\)/);
});

test('a member that only reads says so where it shows', () => {
  assert.match(readFileSync(join(renderer, 'AgentSquad.tsx'), 'utf8'), /member\.readOnly && !member\.sharedReadOnly/);
  assert.match(readFileSync(join(renderer, 'Composer.tsx'), 'utf8'), /task\?\.readOnly/);
});

test('the squad size setting is called 成员额度 and says what it limits', () => {
  const page = readFileSync(join(renderer, 'StudioSettings.tsx'), 'utf8');
  assert.match(page, /<Row title=\{t\('Member quota', '成员额度'\)\}/, 'the row has the name the README, the lead and the refusals use');
  assert.match(page, /aria-label=\{t\('Member quota', '成员额度'\)\}/, 'and so does the field');
  assert.doesNotMatch(page, /默认小队人数|Default squad size/, 'the old title is gone');
  assert.match(page, /成员额度：主代理同一时间最多有这么多位成员在做或排队，成员返回后空出名额。/);
  assert.doesNotMatch(page, /主代理按任务需要分配独立工作。/, 'it no longer reads as a hint about when the lead splits work');
});

test('the Role ID field’s pattern is one a browser accepts, and says what saveAgentRole enforces', () => {
  const page = readFileSync(join(renderer, 'EcosystemSettings.tsx'), 'utf8');
  const pattern = /'Role ID', '角色 ID'[\s\S]*?\bpattern="([^"]*)"/.exec(page)?.[1];
  assert.ok(pattern, 'the Role ID input has a pattern');
  // A browser compiles `pattern` as ^(?:pattern)$ with the v flag, where a bare "-" in a character class is a syntax error:
  // the browser logged an error each time the editor opened and then ignored the pattern altogether.
  const compiled = new RegExp(`^(?:${pattern})$`, 'v');
  const ids = ['reviewer', 'my-reviewer', 'my_reviewer', 'Reviewer', 'a', 'A1_b-2', 'trailing-', '1st', 'x'.repeat(64), 'x'.repeat(65), '', '-lead', '_lead', 'has space', '审查员', 'a/b', 'a:b', 'agent:user:x'];
  for (const id of ids) assert.equal(compiled.test(id), CUSTOM_ROLE_ID.test(id), `the field and the main process disagree about ${JSON.stringify(id)}`);
  assert.deepEqual(ids.filter(id => compiled.test(id)), ['reviewer', 'my-reviewer', 'my_reviewer', 'Reviewer', 'a', 'A1_b-2', 'trailing-', '1st', 'x'.repeat(64)]);
});

test('explorer and planner read as read-only in the settings and the composer, even when a file of the same name replaces them', () => {
  const page = readFileSync(join(renderer, 'EcosystemSettings.tsx'), 'utf8');
  // The badge follows what the app enforces (shared/agents readsOnly), not only the file's own tools line.
  assert.match(page, /\{readsOnly\(role\) && <span className="badge">\{t\('Read only', '只读'\)\}<\/span>\}/);
  assert.doesNotMatch(page, /\{role\.readOnly && <span className="badge">/, 'a file named like explorer would show as writable');
  // A file that is on in their place says why it still only reads.
  assert.match(page, /\{replacesReadOnlyBuiltIn\(role\) && <small className="agent-note">/);
  assert.match(page, /同名文件只换说明和指令，探索员／规划师始终只读/);
  const composer = readFileSync(join(renderer, 'Composer.tsx'), 'utf8');
  assert.match(composer, /readsOnly\(taskRole\)/, 'a new task asked as one of them also says read-only');
  // The two subagent menus mark them the same way.
  assert.match(composer, /\{item\.name\}\{readsOnly\(item\) \?/);
  assert.match(readFileSync(join(renderer, 'TaskView.tsx'), 'utf8'), /\{role\.name\}\{readsOnly\(role\) \?/);
  for (const name of ['Composer.tsx', 'TaskView.tsx']) assert.doesNotMatch(readFileSync(join(renderer, name), 'utf8'), /\.readOnly \? t\(' · read only'/, `${name} marks a menu entry read-only by the file's own flag`);
});
