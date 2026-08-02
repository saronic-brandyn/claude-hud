import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { parseTranscript } from '../dist/transcript.js';

/** Create a temp JSONL file from an array of objects (or raw strings). */
function tmpJsonl(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-transcript-'));
  const file = path.join(dir, 'test.jsonl');
  const text = lines
    .map((l) => (typeof l === 'string' ? l : JSON.stringify(l)))
    .join('\n');
  fs.writeFileSync(file, text, 'utf8');
  return { file, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

/** Helper: a tool_use content block. */
function toolUse(id, name, input = {}) {
  return { type: 'tool_use', id, name, input };
}

/** Helper: a tool_result content block. */
function toolResult(toolUseId, { is_error = false } = {}) {
  return { type: 'tool_result', tool_use_id: toolUseId, is_error };
}

/** Wrap content blocks in a transcript JSONL entry. */
function entry(blocks, ts = '2025-01-15T10:00:00Z') {
  return { timestamp: ts, message: { content: blocks } };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('parseTranscript', () => {
  let cleanup;

  afterEach(() => {
    if (cleanup) {
      cleanup();
      cleanup = null;
    }
  });

  // 1. Returns empty result for missing file path ('')
  test('returns empty result for empty string path', async () => {
    const result = await parseTranscript('');
    assert.deepEqual(result.tools, []);
    assert.deepEqual(result.agents, []);
    assert.deepEqual(result.todos, []);
    assert.equal(result.sessionStart, undefined);
    assert.equal(result.sessionName, undefined);
  });

  // 2. Returns empty result for nonexistent file path
  test('returns empty result for nonexistent file', async () => {
    const result = await parseTranscript('/tmp/does-not-exist-xyz-999.jsonl');
    assert.deepEqual(result.tools, []);
    assert.deepEqual(result.agents, []);
    assert.deepEqual(result.todos, []);
  });

  // 3. Returns empty result for empty file
  test('returns empty result for empty file', async () => {
    const { file, cleanup: c } = tmpJsonl([]);
    cleanup = c;
    const result = await parseTranscript(file);
    assert.deepEqual(result.tools, []);
    assert.deepEqual(result.agents, []);
    assert.deepEqual(result.todos, []);
  });

  // 4. Captures sessionStart from first timestamped entry
  test('captures sessionStart from first timestamped entry', async () => {
    const { file, cleanup: c } = tmpJsonl([
      entry([toolUse('t1', 'Read', { file_path: '/a.txt' })], '2025-06-01T08:30:00Z'),
      entry([toolResult('t1')], '2025-06-01T08:31:00Z'),
    ]);
    cleanup = c;
    const result = await parseTranscript(file);
    assert.ok(result.sessionStart instanceof Date);
    assert.equal(result.sessionStart.toISOString(), '2025-06-01T08:30:00.000Z');
  });

  // 5. Parses tool_use + tool_result pair -> status 'completed', with target from file_path
  test('tool_use + tool_result pair yields completed status with target', async () => {
    const { file, cleanup: c } = tmpJsonl([
      entry([toolUse('t1', 'Read', { file_path: '/src/main.ts' })]),
      entry([toolResult('t1')]),
    ]);
    cleanup = c;
    const result = await parseTranscript(file);
    assert.equal(result.tools.length, 1);
    assert.equal(result.tools[0].name, 'Read');
    assert.equal(result.tools[0].status, 'completed');
    assert.equal(result.tools[0].target, '/src/main.ts');
    assert.ok(result.tools[0].endTime instanceof Date);
  });

  // 6. tool_use without matching tool_result -> status 'running'
  test('tool_use without tool_result stays running', async () => {
    const { file, cleanup: c } = tmpJsonl([
      entry([toolUse('t1', 'Bash', { command: 'npm test' })]),
    ]);
    cleanup = c;
    const result = await parseTranscript(file);
    assert.equal(result.tools.length, 1);
    assert.equal(result.tools[0].status, 'running');
    assert.equal(result.tools[0].endTime, undefined);
  });

  // 7. tool_result with is_error -> status 'error'
  test('tool_result with is_error sets error status', async () => {
    const { file, cleanup: c } = tmpJsonl([
      entry([toolUse('t1', 'Bash', { command: 'exit 1' })]),
      entry([toolResult('t1', { is_error: true })]),
    ]);
    cleanup = c;
    const result = await parseTranscript(file);
    assert.equal(result.tools.length, 1);
    assert.equal(result.tools[0].status, 'error');
  });

  // 8. Keeps only last 20 tools
  test('keeps only last 20 tools when more are present', async () => {
    const lines = [];
    for (let i = 0; i < 25; i++) {
      lines.push(
        entry([toolUse(`t${i}`, 'Read', { file_path: `/file${i}.ts` })]),
        entry([toolResult(`t${i}`)]),
      );
    }
    const { file, cleanup: c } = tmpJsonl(lines);
    cleanup = c;
    const result = await parseTranscript(file);
    assert.equal(result.tools.length, 20);
    // Should keep the last 20 (indices 5-24)
    assert.equal(result.tools[0].id, 't5');
    assert.equal(result.tools[19].id, 't24');
  });

  // 9. Task tool_use creates agent entry (not tool entry)
  test('Task tool_use creates agent entry with type/model/description', async () => {
    const { file, cleanup: c } = tmpJsonl([
      entry([
        toolUse('a1', 'Task', {
          subagent_type: 'general-purpose',
          model: 'sonnet',
          description: 'Research auth patterns',
        }),
      ]),
    ]);
    cleanup = c;
    const result = await parseTranscript(file);
    assert.equal(result.tools.length, 0, 'Task should not appear in tools');
    assert.equal(result.agents.length, 1);
    assert.equal(result.agents[0].id, 'a1');
    assert.equal(result.agents[0].type, 'general-purpose');
    assert.equal(result.agents[0].model, 'sonnet');
    assert.equal(result.agents[0].description, 'Research auth patterns');
    assert.equal(result.agents[0].status, 'running');
  });

  // 10. Agent tool_result marks agent 'completed'
  test('agent tool_result marks agent completed', async () => {
    const { file, cleanup: c } = tmpJsonl([
      entry([toolUse('a1', 'Task', { subagent_type: 'worker' })], '2025-01-15T10:00:00Z'),
      entry([toolResult('a1')], '2025-01-15T10:05:00Z'),
    ]);
    cleanup = c;
    const result = await parseTranscript(file);
    assert.equal(result.agents.length, 1);
    assert.equal(result.agents[0].status, 'completed');
    assert.ok(result.agents[0].endTime instanceof Date);
  });

  // 11. Keeps only last 10 agents
  test('keeps only last 10 agents when more are present', async () => {
    const lines = [];
    for (let i = 0; i < 15; i++) {
      lines.push(
        entry([toolUse(`a${i}`, 'Task', { subagent_type: `type-${i}` })]),
        entry([toolResult(`a${i}`)]),
      );
    }
    const { file, cleanup: c } = tmpJsonl(lines);
    cleanup = c;
    const result = await parseTranscript(file);
    assert.equal(result.agents.length, 10);
    assert.equal(result.agents[0].id, 'a5');
    assert.equal(result.agents[9].id, 'a14');
  });

  // 12. TodoWrite replaces entire todo list
  test('TodoWrite replaces entire todo list', async () => {
    const { file, cleanup: c } = tmpJsonl([
      entry([
        toolUse('tw1', 'TodoWrite', {
          todos: [
            { content: 'First task', status: 'pending' },
            { content: 'Second task', status: 'in_progress' },
          ],
        }),
      ]),
      entry([
        toolUse('tw2', 'TodoWrite', {
          todos: [{ content: 'Replacement task', status: 'completed' }],
        }),
      ]),
    ]);
    cleanup = c;
    const result = await parseTranscript(file);
    assert.equal(result.todos.length, 1);
    assert.equal(result.todos[0].content, 'Replacement task');
    assert.equal(result.todos[0].status, 'completed');
  });

  // 13. TaskCreate adds to todo list with subject
  test('TaskCreate adds to todo list with subject', async () => {
    const { file, cleanup: c } = tmpJsonl([
      entry([
        toolUse('tw1', 'TodoWrite', {
          todos: [{ content: 'Existing task', status: 'pending' }],
        }),
      ]),
      entry([
        toolUse('tc1', 'TaskCreate', {
          taskId: 'task-abc',
          subject: 'New task from TaskCreate',
          status: 'pending',
        }),
      ]),
    ]);
    cleanup = c;
    const result = await parseTranscript(file);
    assert.equal(result.todos.length, 2);
    assert.equal(result.todos[0].content, 'Existing task');
    assert.equal(result.todos[1].content, 'New task from TaskCreate');
    assert.equal(result.todos[1].status, 'pending');
  });

  // 14. TaskUpdate modifies existing todo by taskId
  test('TaskUpdate modifies existing todo by taskId', async () => {
    const { file, cleanup: c } = tmpJsonl([
      entry([
        toolUse('tc1', 'TaskCreate', {
          taskId: 'task-1',
          subject: 'Do something',
          status: 'pending',
        }),
      ]),
      entry([
        toolUse('tu1', 'TaskUpdate', {
          taskId: 'task-1',
          status: 'completed',
          subject: 'Did it',
        }),
      ]),
    ]);
    cleanup = c;
    const result = await parseTranscript(file);
    assert.equal(result.todos.length, 1);
    assert.equal(result.todos[0].content, 'Did it');
    assert.equal(result.todos[0].status, 'completed');
  });

  // 15. TaskUpdate normalizes status aliases
  test('TaskUpdate normalizes status aliases', async () => {
    const { file, cleanup: c } = tmpJsonl([
      entry([
        toolUse('tw1', 'TodoWrite', {
          todos: [
            { content: 'A', status: 'pending' },
            { content: 'B', status: 'pending' },
            { content: 'C', status: 'pending' },
          ],
        }),
      ]),
      // 'done' -> 'completed'
      entry([toolUse('tu1', 'TaskUpdate', { taskId: '1', status: 'done' })]),
      // 'running' -> 'in_progress'
      entry([toolUse('tu2', 'TaskUpdate', { taskId: '2', status: 'running' })]),
      // 'not_started' -> 'pending'
      entry([toolUse('tu3', 'TaskUpdate', { taskId: '3', status: 'not_started' })]),
    ]);
    cleanup = c;
    const result = await parseTranscript(file);
    assert.equal(result.todos[0].status, 'completed');
    assert.equal(result.todos[1].status, 'in_progress');
    assert.equal(result.todos[2].status, 'pending');
  });

  // 16. Skips malformed JSONL lines gracefully
  test('skips malformed JSONL lines gracefully', async () => {
    const { file, cleanup: c } = tmpJsonl([
      'this is not json',
      JSON.stringify(entry([toolUse('t1', 'Read', { file_path: '/ok.ts' })])),
      '{ broken json',
      JSON.stringify(entry([toolResult('t1')])),
    ]);
    cleanup = c;
    const result = await parseTranscript(file);
    assert.equal(result.tools.length, 1);
    assert.equal(result.tools[0].name, 'Read');
    assert.equal(result.tools[0].status, 'completed');
  });

  // 17. Captures custom-title as sessionName
  test('captures custom-title as sessionName', async () => {
    const { file, cleanup: c } = tmpJsonl([
      { type: 'custom-title', customTitle: 'My Cool Session' },
      entry([toolUse('t1', 'Read', { file_path: '/a.ts' })]),
    ]);
    cleanup = c;
    const result = await parseTranscript(file);
    assert.equal(result.sessionName, 'My Cool Session');
  });

  // 18. Captures slug as sessionName (when no custom-title)
  test('captures slug as sessionName when no custom-title', async () => {
    const { file, cleanup: c } = tmpJsonl([
      { slug: 'fix-auth-bug', timestamp: '2025-01-15T10:00:00Z' },
      entry([toolUse('t1', 'Read', { file_path: '/a.ts' })]),
    ]);
    cleanup = c;
    const result = await parseTranscript(file);
    assert.equal(result.sessionName, 'fix-auth-bug');
  });

  // 19. custom-title takes precedence over slug
  test('custom-title takes precedence over slug', async () => {
    const { file, cleanup: c } = tmpJsonl([
      { slug: 'slug-name', timestamp: '2025-01-15T10:00:00Z' },
      { type: 'custom-title', customTitle: 'Custom Title Wins' },
      entry([toolUse('t1', 'Read', { file_path: '/a.ts' })]),
    ]);
    cleanup = c;
    const result = await parseTranscript(file);
    assert.equal(result.sessionName, 'Custom Title Wins');
  });

  // 20. handles large transcript within 200ms (performance regression test)
  test('handles large transcript within 200ms', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-transcript-'));
    const file = path.join(dir, 'large.jsonl');
    const lines = [];
    for (let i = 0; i < 5000; i++) {
      lines.push(JSON.stringify({
        timestamp: '2026-01-01T00:00:00Z',
        message: { content: [{ type: 'tool_use', id: `t${i}`, name: 'Read', input: { file_path: `/file${i}.ts` } }] },
      }));
      lines.push(JSON.stringify({
        timestamp: '2026-01-01T00:00:00Z',
        message: { content: [{ type: 'tool_result', tool_use_id: `t${i}` }] },
      }));
    }
    fs.writeFileSync(file, lines.join('\n'), 'utf8');
    try {
      const start = Date.now();
      const result = await parseTranscript(file);
      const elapsed = Date.now() - start;
      assert.ok(elapsed < 200, `took ${elapsed}ms, expected <200ms`);
      assert.strictEqual(result.tools.length, 20);
      assert.ok(result.sessionStart instanceof Date);
    } finally {
      fs.rmSync(dir, { recursive: true });
    }
  });

  // 21. extractTarget returns pattern for Glob/Grep, truncated command for Bash
  test('extractTarget: Glob/Grep return pattern, Bash truncates command', async () => {
    const longCmd = 'npm run build -- --verbose --watch --all-targets-in-scope';
    const { file, cleanup: c } = tmpJsonl([
      entry([toolUse('t1', 'Glob', { pattern: '**/*.ts' })]),
      entry([toolResult('t1')]),
      entry([toolUse('t2', 'Grep', { pattern: 'import.*from' })]),
      entry([toolResult('t2')]),
      entry([toolUse('t3', 'Bash', { command: longCmd })]),
      entry([toolResult('t3')]),
      entry([toolUse('t4', 'Edit', { file_path: '/src/index.ts' })]),
      entry([toolResult('t4')]),
    ]);
    cleanup = c;
    const result = await parseTranscript(file);
    assert.equal(result.tools.length, 4);

    // Glob: pattern
    const glob = result.tools.find((t) => t.name === 'Glob');
    assert.equal(glob.target, '**/*.ts');

    // Grep: pattern
    const grep = result.tools.find((t) => t.name === 'Grep');
    assert.equal(grep.target, 'import.*from');

    // Bash: truncated to 30 chars + '...'
    const bash = result.tools.find((t) => t.name === 'Bash');
    assert.equal(bash.target, longCmd.slice(0, 30) + '...');
    assert.equal(bash.target.length, 33); // 30 + 3 for '...'

    // Edit: file_path
    const edit = result.tools.find((t) => t.name === 'Edit');
    assert.equal(edit.target, '/src/index.ts');
  });
});
