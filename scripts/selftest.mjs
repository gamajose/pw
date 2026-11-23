// Executor do autoteste de ponta a ponta.
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import electron from 'electron';

const testDataDir = path.join(os.tmpdir(), 'pw-selftest-userdata-' + Date.now());
const env = { ...process.env, PW_SELFTEST: '1', PW_MANAGER_DATA: testDataDir };
const proc = spawn(electron, ['.'], { env, stdio: 'inherit' });

proc.on('close', (code) => {
  process.exit(code ?? 0);
});
