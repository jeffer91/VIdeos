import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(__filename), '..');
const requiredModules = ['electron-updater'];

const missing = requiredModules.filter((name) => {
  try {
    require.resolve(name, { paths: [root] });
    return false;
  } catch {
    return true;
  }
});

if (!missing.length) process.exit(0);

console.log(`Videos Studio detectó dependencias nuevas sin instalar: ${missing.join(', ')}.`);
console.log('Intentando completar la instalación automáticamente...');

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const result = spawnSync(npmCommand, ['install', '--no-audit', '--no-fund'], {
  cwd: root,
  stdio: 'inherit',
  shell: false,
});

if (result.status === 0) {
  console.log('Dependencias de Videos Studio actualizadas correctamente.');
  process.exit(0);
}

console.warn('No se pudieron instalar las dependencias automáticamente. Videos Studio intentará abrir igualmente; las actualizaciones automáticas pueden no estar disponibles en esta ejecución.');
process.exit(0);
