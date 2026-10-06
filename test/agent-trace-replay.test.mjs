import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const context = { window: {} };
runInNewContext(await readFile(new URL('../agent-trace-replay.js', import.meta.url), 'utf8'), context, { filename: 'agent-trace-replay.js' });
const tool = context.window.SITE_TOOLS['agent-trace-replay'];
const plain = (value) => JSON.parse(JSON.stringify(value));
const sample = (id) => tool.parse(tool.SAMPLES.find((entry) => entry.id === id).jsonl).events;
const lines = (...events) => events.map((event) => JSON.stringify(event)).join('\n');

test('the three built-in traces parse cleanly and are distinct stories', () => {
  assert.deepEqual(plain(tool.SAMPLES.map((entry) => entry.id)), ['oom', 'denied', 'resumed']);
  for (const entry of tool.SAMPLES) {
    const parsed = tool.parse(entry.jsonl);
    assert.equal(parsed.error, undefined, `${entry.id}: ${parsed.error}`);
    assert.equal(parsed.events[0].type, 'session.started');
    assert.equal(parsed.events.at(-1).type, 'session.completed');
  }
});

test('summaries count what actually happened in each trace', () => {
  assert.deepEqual(plain(tool.summarize(sample('oom'))), {
    duration: 15.1, steps: 16, turns: 1, toolCalls: 4, toolFailures: 0, unfinished: 0,
    permissions: { requested: 0, approved: 0, denied: 0 }, checkpoints: 0, interruptions: 0, tokens: { input: 18420, output: 1260 },
  });
  assert.deepEqual(plain(tool.summarize(sample('denied'))), {
    duration: 46.1, steps: 22, turns: 1, toolCalls: 5, toolFailures: 0, unfinished: 0,
    permissions: { requested: 2, approved: 1, denied: 1 }, checkpoints: 0, interruptions: 0, tokens: { input: 21730, output: 1480 },
  });
  assert.deepEqual(plain(tool.summarize(sample('resumed'))), {
    duration: 1053.1, steps: 23, turns: 1, toolCalls: 6, toolFailures: 0, unfinished: 1,
    permissions: { requested: 0, approved: 0, denied: 0 }, checkpoints: 4, interruptions: 1, tokens: { input: 9850, output: 940 },
  });
});

test('a denied permission links the request, the decision and the call that never ran', () => {
  const steps = tool.timeline(sample('denied'));
  const decided = steps.filter((step) => step.type === 'permission.decided');
  assert.deepEqual(plain(decided.map((step) => [step.status, step.title, Object.fromEntries(step.fields)])), [
    ['denied', '被拒绝：bash', { 决定人: '用户', 等待: '26.6 秒' }],
    ['ok', '已批准：bash', { 决定人: '用户', 等待: '6.6 秒' }],
  ]);
  const skipped = steps.find((step) => step.type === 'tool.result' && step.raw.toolCallId === 'call-2');
  assert.deepEqual([skipped.status, skipped.title], ['denied', 'bash 没有执行']);
  const after = steps.slice(steps.indexOf(skipped) + 1).filter((step) => step.type === 'tool.call');
  assert(after.every((step) => !/--force/.test(step.text)), 'after the denial the agent takes a different path instead of retrying the force push');
});

test('an interruption names the call it cut off, and the resume points at a checkpoint saved before it', () => {
  const steps = tool.timeline(sample('resumed'));
  const cut = steps.find((step) => step.type === 'session.interrupted');
  assert.deepEqual([cut.status, Object.fromEntries(cut.fields)['被打断的调用']], ['interrupt', 'run_eval']);
  const resumed = steps.find((step) => step.type === 'session.resumed');
  assert.equal(resumed.title, '从 eval-400 恢复');
  const saved = steps.slice(0, steps.indexOf(cut)).filter((step) => step.type === 'checkpoint.saved').map((step) => step.raw.label);
  assert.deepEqual(plain(saved), ['eval-200', 'eval-400']);
  const twice = tool.timeline(tool.parse(lines(
    { t: 0, type: 'tool.call', id: 'a', name: 'train' },
    { t: 5, type: 'session.interrupted', reason: 'node lost' },
    { t: 9, type: 'session.resumed', from: 'ckpt-1' },
    { t: 10, type: 'tool.call', id: 'b', name: 'eval' },
    { t: 15, type: 'session.interrupted', reason: 'node lost again' },
  )).events).filter((step) => step.type === 'session.interrupted');
  assert.deepEqual(plain(twice.map((step) => Object.fromEntries(step.fields)['被打断的调用'])), ['train', 'eval'], 'a second interruption does not blame calls the first one already cut off');
  const correct = sample('resumed').filter((event) => event.type === 'tool.result').map((event) => Number(event.output.match(/正确 (\d+)/)[1]));
  assert.equal(correct.reduce((sum, value) => sum + value, 0), 754, 'the per-slice results add up to the 754 in the final answer');
});

test('tool results report their duration from the matching call and fail loudly when not ok', () => {
  const steps = tool.timeline(sample('oom'));
  const first = steps.find((step) => step.type === 'tool.result');
  assert.deepEqual([first.status, first.title, Object.fromEntries(first.fields)['耗时']], ['ok', 'eden-cli 返回', '2.6 秒']);
  const failing = tool.timeline(tool.parse(lines(
    { t: 0, type: 'tool.call', id: 'a', name: 'bash', input: { command: 'make test' } },
    { t: 3, type: 'tool.result', toolCallId: 'a', ok: false, output: '2 tests failed' },
  )).events);
  assert.deepEqual([failing[1].status, failing[1].title], ['error', 'bash 失败']);
  assert.equal(tool.summarize(tool.parse(lines(
    { t: 0, type: 'tool.call', id: 'a', name: 'bash' },
    { t: 3, type: 'tool.result', toolCallId: 'a', ok: false, output: 'boom' },
  )).events).toolFailures, 1);
});

test('unknown event types are shown as they are, and turn failures are errors', () => {
  const steps = tool.timeline(tool.parse(lines(
    { t: 0, type: 'memory.write', key: 'owner', value: 'loren' },
    { t: 1, type: 'turn.failed', turn: 2, error: 'context window exceeded' },
  )).events);
  assert.deepEqual(plain([steps[0].status, steps[0].title, steps[0].text]), ['info', 'memory.write', 'key=owner value=loren']);
  assert.deepEqual(plain([steps[1].status, steps[1].title, steps[1].text]), ['error', '第 2 轮失败', 'context window exceeded']);
});

test('tool inputs read as a command, a path or key=value pairs', () => {
  const textOfCall = (input) => tool.timeline([{ t: 0, type: 'tool.call', id: 'a', name: 'x', input }])[0].text;
  assert.equal(textOfCall({ args: ['job', 'runs', 'get', 'r-1'] }), 'job runs get r-1');
  assert.equal(textOfCall({ command: 'git status' }), 'git status');
  assert.equal(textOfCall({ path: 'configs/a.yaml' }), 'configs/a.yaml');
  assert.equal(textOfCall({ suite: 'math-1000', range: [400, 600], dryRun: true }), 'suite=math-1000 range=[400,600] dryRun=true');
  assert.equal(textOfCall({ path: 'a.yaml', replace: { a: 'b' } }), '{"path":"a.yaml","replace":{"a":"b"}}', 'nested objects fall back to JSON');
  assert.equal(textOfCall({ text: 'x'.repeat(200) }).length, 90, 'long inputs are cut to 90 characters');
});

test('text that looks like HTML stays text', () => {
  const payload = '<img src=x onerror="alert(1)"> & </script>';
  const [step] = tool.timeline(tool.parse(lines({ t: 0, type: 'message', role: 'assistant', text: payload })).events);
  assert.equal(step.text, payload);
});

test('bad input says which line, what was expected and how to fix it', () => {
  const error = (text) => tool.parse(text).error;
  assert.match(error(''), /没有读到内容.*t（秒）和 type/);
  assert.match(error('\n  \n'), /没有读到内容/);
  assert.match(error('{"t":0,"type":"a"}\n\n{"t": 1, type: "b"}'), /^第 3 行不是合法的 JSON：.*每行应当是一个完整的 JSON 对象/);
  assert.match(error('[1, 2]'), /第 1 行应当是一个 JSON 对象，现在是数组/);
  assert.match(error('"hello"'), /第 1 行应当是一个 JSON 对象，现在是 "hello"/);
  assert.match(error('{"t": 0}'), /第 1 行缺少字符串字段 type，现在是 undefined.*"type": "tool\.call"/);
  assert.match(error('{"t": -1, "type": "a"}'), /第 1 行的 t 应当是不小于 0 的秒数，现在是 -1/);
  assert.match(error('{"t": "3", "type": "a"}'), /第 1 行的 t 应当是不小于 0 的秒数，现在是 "3"/);
  assert.match(error('{"t": 5, "type": "a"}\n{"t": 4, "type": "b"}'), /第 2 行的 t=4 早于上一条的 t=5。事件要按时间顺序排列/);
  assert.match(error('x'.repeat(2_000_001)), /超过上限 2,000,000/);
  assert.match(error(Array.from({ length: 5001 }, (_, t) => JSON.stringify({ t, type: 'tick' })).join('\n')), /事件超过 5000 条（到第 5001 行为止）/);
  assert.equal(tool.parse('{"t":0,"type":"a"}\r\n\r\n{"t":0,"type":"b"}\r\n').events.length, 2, 'blank lines and CRLF are fine; equal times are fine');
});

test('clock formats offsets and spoken durations', () => {
  assert.deepEqual([tool.clock(0), tool.clock(75.4), tool.clock(3723)], ['+0:00', '+1:15', '+1:02:03']);
  assert.deepEqual([tool.clock(26.6, true), tool.clock(125, true), tool.clock(120, true), tool.clock(1053.1, true)], ['26.6 秒', '2 分 5 秒', '2 分', '17 分 33 秒']);
});
