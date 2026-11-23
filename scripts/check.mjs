// Verificações rápidas: sintaxe de todos os arquivos JS e testes das funções puras.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? walk(p) : /\.(m?js|cjs)$/.test(d.name) ? [p] : [];
  });
}

for (const file of [...walk(path.join(root, 'src')), ...walk(path.join(root, 'scripts'))]) {
  const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (r.status !== 0) {
    failed++;
    console.error('ERRO de sintaxe:', path.relative(root, file), '\n', r.stderr);
  }
}

// Testes das funções que não dependem do Electron.
const keys = await import('../src/shared/keys.js');
assert.equal(keys.vkFromName('F1'), 0x70);
assert.equal(keys.vkFromName('a'), 0x41);
assert.equal(keys.vkFromName('Num3'), 0x63);
assert.equal(keys.vkFromName('Espaço'), 0x20);
assert.equal(keys.vkFromAccelerator('Ctrl+Shift+F12'), 0x7b);
assert.equal(keys.vkFromAccelerator('num7'), 0x67);
assert.equal(keys.isMirrorable(0x41), true);
assert.equal(keys.isMirrorable(0x63), false);

// game.js importa electron indiretamente; testamos as funções puras copiando o módulo sem dependências.
const gameSrc = fs.readFileSync(path.join(root, 'src/main/game.js'), 'utf8');
const pure = gameSrc
  .split('\n')
  .filter((l) => !l.startsWith('import ') && !l.includes('createLogger('))
  .join('\n')
  .replace(/class Game[\s\S]*$/, '');
const tmp = path.join(root, 'scripts', '.game-pure.tmp.mjs');
fs.writeFileSync(tmp, pure);
try {
  const g = await import('./.game-pure.tmp.mjs');
  assert.deepEqual(g.tokenize('a  "b c" d'), ['a', 'b c', 'd']);
  assert.deepEqual(g.tokenize('x ""'), ['x', '']);
  const ctx = { login: 'joao', password: 'p@ss', character: '', server: '', account: 'Main' };
  assert.deepEqual(g.buildArgs('', ctx), ['startbypatcher', 'user:joao', 'pwd:p@ss']);
  assert.deepEqual(g.buildArgs('startbypatcher game:cpw user:{login} pwd:{password} role:{character}', { ...ctx, character: 'Heroi' }), [
    'startbypatcher', 'game:cpw', 'user:joao', 'pwd:p@ss', 'role:Heroi',
  ]);
  assert.equal(g.formatTitle('{character} [{account}]', { name: 'Main', character: 'Heroi' }, null), 'Heroi [Main]');
  assert.equal(g.formatTitle('{character}', { name: 'Main', character: '' }, null), 'Main');
} finally {
  fs.unlinkSync(tmp);
}

if (failed) {
  console.error(`${failed} arquivo(s) com erro.`);
  process.exit(1);
}
console.log('OK: sintaxe de todos os arquivos e testes das funções puras.');
