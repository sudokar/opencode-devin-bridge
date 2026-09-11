import { expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { isDirectExecution } from '../../src/cli.js';

test('recognizes direct execution through a relative path and symlink', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devin-cli-entrypoint-test-'));
  const target = path.join(dir, 'cli.js');
  const link = path.join(dir, 'bridge');
  fs.writeFileSync(target, '');
  fs.symlinkSync(target, link);
  try {
    expect(isDirectExecution(path.relative(process.cwd(), link), pathToFileURL(target).href)).toBe(true);
    expect(isDirectExecution(undefined, pathToFileURL(target).href)).toBe(false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
