import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { PNG } from './inbox-fixtures.js';

test('追加 CLI 斷線後保留 id，重試用同封包；狀態區分已追加與原書已刪除', () => {
  const root = mkdtempSync(join(tmpdir(), 'autobook-inbox-cli-'));
  try {
    for (const dir of ['tools', 'js', '.inbox']) mkdirSync(join(root, dir));
    cpSync(new URL('../tools/inbox-upload.mjs', import.meta.url), join(root, 'tools/inbox-upload.mjs'));
    cpSync(new URL('../js/inbox-format.js', import.meta.url), join(root, 'js/inbox-format.js'));
    writeFileSync(join(root, 'package.json'), '{"type":"module"}');
    writeFileSync(join(root, '.inbox/config.json'), JSON.stringify({ url: 'https://autobook-inbox.test.workers.dev',
      readToken: 'r'.repeat(43), writeToken: 'w'.repeat(43) }));
    writeFileSync(join(root, 'append.json'), JSON.stringify({ targetId: 'story_001' }));
    writeFileSync(join(root, 'image.png'), PNG);
    writeFileSync(join(root, 'fake-fetch.mjs'), `
      import assert from 'node:assert/strict';
      globalThis.fetch = async (url, options) => {
        assert.equal(options.headers.Authorization, 'Bearer ' + 'w'.repeat(43));
        if (process.env.FAKE_FAIL) throw new Error('offline');
        if (options.method === 'POST') {
          assert.ok(url.endsWith('/v1/illustrations'));
          const update = JSON.parse(options.body.get('update'));
          assert.equal(update.id, process.env.EXPECTED_ID);
          assert.equal(update.targetId, 'story_001');
          assert.equal(update.kind, 'illustrations');
          assert.equal(options.body.getAll('images').length, 1);
          return Response.json({ id: update.id, uploaded: true, duplicate: true });
        }
        assert.ok(url.includes('/v1/illustrations/' + process.env.EXPECTED_ID + '/receipts'));
        return Response.json({ receipts: [{ deviceId: 'ipad_001', outcome: process.env.FAKE_OUTCOME || 'applied' }], cursor: null });
      };
    `);
    const run = (args, extra = {}) => spawnSync(process.execPath, ['--import', join(root, 'fake-fetch.mjs'),
      join(root, 'tools/inbox-upload.mjs'), ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, ...extra } });
    const failed = run(['append', 'append.json', 'image.png'], { FAKE_FAIL: '1' });
    assert.equal(failed.status, 1);
    const saved = JSON.parse(readFileSync(join(root, 'append.json'), 'utf8'));
    assert.ok(saved.id);
    assert.equal(saved.targetId, 'story_001');
    const success = run(['append', 'append.json', 'image.png'], { EXPECTED_ID: saved.id });
    assert.equal(success.status, 0, success.stderr);
    assert.equal(JSON.parse(success.stdout).targetId, saved.targetId);
    assert.deepEqual(JSON.parse(readFileSync(join(root, 'append.json'), 'utf8')), saved);
    const applied = run(['append-status', saved.id], { EXPECTED_ID: saved.id });
    assert.equal(applied.status, 0, applied.stderr);
    assert.match(JSON.parse(applied.stdout).status, /已追加/);
    const deleted = run(['append-status', saved.id], { EXPECTED_ID: saved.id, FAKE_OUTCOME: 'skipped_deleted' });
    assert.equal(deleted.status, 0, deleted.stderr);
    assert.match(JSON.parse(deleted.stdout).status, /已刪除.*略過/);
    assert.ok(!success.stdout.includes('w'.repeat(43)));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
