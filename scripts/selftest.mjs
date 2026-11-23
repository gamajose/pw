// Executor do autoteste de ponta a ponta.
import { spawn } from 'node:child_process';
import path from 'node:path';
import electron from 'electron';

const env = { ...process.env, PW_SELFTEST: '1' };
const proc = spawn(electron, ['.'], { env, stdio: 'inherit' });

proc.on('close', (code) => {
  process.exit(code ?? 0);
});
