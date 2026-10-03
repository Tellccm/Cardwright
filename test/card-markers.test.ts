import test from 'node:test';
import assert from 'node:assert/strict';
import { ACCEPT_ALL_MARKER, CONTINUE_MARKER, INCOMPLETE_MARKER, KICKOFF, REFUSE_MARKER, hidePartialMarker, isKickoff, segmentReply, stripMarkers } from '../src/shared/card-studio/markers.ts';

const fence = '```';

test('strips the accept-all marker and reports it', () => {
  const result = stripMarkers(`第 1 轮\n1. 采用范围？推荐：B\n\n${ACCEPT_ALL_MARKER}\n`);
  assert.equal(result.hasAcceptAll, true);
  assert.equal(result.refused, false);
  assert.equal(result.text, '第 1 轮\n1. 采用范围？推荐：B');
});

test('strips the refuse marker and reports it', () => {
  const result = stripMarkers(`缺少设计书，请先回规划。\n${REFUSE_MARKER}`);
  assert.equal(result.refused, true);
  assert.equal(result.hasAcceptAll, false);
  assert.equal(result.text, '缺少设计书，请先回规划。');
});

test('strips the incomplete marker and reports it', () => {
  const result = stripMarkers(`人物甲写好了，人物乙没补齐。\n${INCOMPLETE_MARKER}`);
  assert.deepEqual([result.incomplete, result.refused, result.hasAcceptAll], [true, false, false]);
  assert.equal(result.text, '人物甲写好了，人物乙没补齐。');
  assert.equal(stripMarkers(`示例：\n${fence}text\n${INCOMPLETE_MARKER}\n${fence}`).incomplete, false, 'quoted in a code block it is not the AI speaking');
});

test('strips the continue marker and reports it', () => {
  const result = stripMarkers(`写好了红孩儿。名单进度：已写 3 / 名单 8。\n\n${CONTINUE_MARKER}\n`);
  assert.equal(result.continues, true);
  assert.equal(result.hasAcceptAll, false);
  assert.equal(result.refused, false);
  assert.equal(result.text, '写好了红孩儿。名单进度：已写 3 / 名单 8。');
});

test('one line can carry two markers: both are reported and the line goes', () => {
  const result = stripMarkers(`还有一题：称呼用哪个？\n${ACCEPT_ALL_MARKER} ${CONTINUE_MARKER}`);
  assert.equal(result.hasAcceptAll, true);
  assert.equal(result.continues, true);
  assert.equal(result.text, '还有一题：称呼用哪个？');
});

test('a marker written twice on one line is hidden entirely', () => {
  const result = stripMarkers(`写好了第二个人物。\n${CONTINUE_MARKER}${CONTINUE_MARKER}`);
  assert.equal(result.continues, true);
  assert.equal(result.text, '写好了第二个人物。');
});

test('ignores a marker quoted inside a code block', () => {
  const text = `提示词示例：\n${fence}text\n${ACCEPT_ALL_MARKER}\n${REFUSE_MARKER}\n${CONTINUE_MARKER}\n${fence}`;
  const result = stripMarkers(text);
  assert.equal(result.hasAcceptAll, false);
  assert.equal(result.refused, false);
  assert.equal(result.continues, false);
  assert.equal(result.text, text);
});

// While a reply streams, its last line can stop half way through a marker; the half marker must not show for a moment.
test('a marker still being written at the end of a streaming reply is left off until it is whole', () => {
  assert.equal(hidePartialMarker('写好了红孩儿。\n<!-- cardwright:co'), '写好了红孩儿。');
  assert.equal(hidePartialMarker('写好了红孩儿。\n\n<!--'), '写好了红孩儿。');
  assert.equal(hidePartialMarker('写好了红孩儿。<!'), '写好了红孩儿。');
  for (const marker of [ACCEPT_ALL_MARKER, REFUSE_MARKER, INCOMPLETE_MARKER, CONTINUE_MARKER]) {
    assert.equal(hidePartialMarker(`好了。\n${marker.slice(0, -1)}`), '好了。', marker);
    assert.equal(hidePartialMarker(`好了。\n${marker}`), `好了。\n${marker}`, 'a whole marker is stripMarkers’ to hide');
  }
  assert.equal(hidePartialMarker('<!-- cardwri'), '', 'nothing but the start of a marker');
  for (const text of ['', '写好了。', '1 < 2', '<div>', '<!-- 一条注释 -->', '<!-- cardwright:else', '写好了。\n<', '<!-- cardwright:continue -->\n还有话']) assert.equal(hidePartialMarker(text), text, text);
  assert.equal(stripMarkers(hidePartialMarker(`好了。\n${CONTINUE_MARKER.slice(0, 14)}`)).text, '好了。');
});

test('recognizes the two planning kickoff instructions', () => {
  assert.equal(isKickoff(KICKOFF.scratch), 'scratch');
  assert.equal(isKickoff(`  ${KICKOFF.refine}\n`), 'refine');
  assert.equal(isKickoff('开始规划'), null);
});

test('splits a reply into markdown, dispatch and handoff segments in order', () => {
  const text = `设计书已写入。\n\n${fence}派单\n目标: 世界书/叙事规则\n标题: 写叙事规则\n前置: 设计书已确认\n---\n正文\n${fence}\n\n另外：\n\n${fence}交接摘要\n已定: A\n已写: B\n未完成: C\n第一步: D\n${fence}\n结束。`;
  const segments = segmentReply(text);
  assert.deepEqual(segments.map(segment => segment.type), ['markdown', 'dispatch', 'markdown', 'handoff', 'markdown']);
  assert.equal(segments[0].type === 'markdown' && segments[0].text, '设计书已写入。');
  assert.equal(segments[1].type === 'dispatch' && 'title' in segments[1].dispatch && segments[1].dispatch.title, '写叙事规则');
  assert.equal(segments[3].type === 'handoff' && segments[3].handoff?.first, 'D');
  assert.equal(segments[4].type === 'markdown' && segments[4].text, '结束。');
});

test('keeps a reply without special blocks as one markdown segment', () => {
  assert.deepEqual(segmentReply('只是一段话。'), [{ type: 'markdown', text: '只是一段话。' }]);
  assert.deepEqual(segmentReply(''), []);
});
