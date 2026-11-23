// Script para publicar nova versão com 1 comando:
// 1. Incrementa a versão no package.json
// 2. Comita e cria tag git
// 3. Dá push para o GitHub (ativando o GitHub Actions para gerar o instalador e atualizar os clientes automaticamente)
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const pkgPath = path.resolve('package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

const currentVer = pkg.version;
const parts = currentVer.split('.').map(Number);
parts[2] = (parts[2] || 0) + 1; // Incrementa patch (ex: 1.0.0 -> 1.0.1)
const newVer = process.argv[2] || parts.join('.');

pkg.version = newVer;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');

console.log(`🚀 Preparando versão v${newVer} (anterior: v${currentVer})...`);

try {
  execSync('npm run check', { stdio: 'inherit' });
  execSync('git add package.json', { stdio: 'inherit' });
  execSync(`git commit -m "release: v${newVer}"`, { stdio: 'inherit' });
  execSync(`git tag v${newVer}`, { stdio: 'inherit' });
  console.log(`\n✅ Tag v${newVer} criada!`);
  console.log(`Para enviar ao GitHub e disparar a atualização automática em todos os computadores:`);
  console.log(`   git push origin main --tags\n`);
} catch (err) {
  console.error('Erro durante o processo de release:', err.message);
  process.exit(1);
}
