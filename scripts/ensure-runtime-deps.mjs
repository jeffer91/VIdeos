import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 12)) {
  console.error(`Videos Studio necesita Node 22.12 o superior. Versión actual: ${process.version}.`);
  process.exit(1);
}

async function checkRuntime() {
  try {
    require('electron-updater');
    require.resolve('electron');
    const rollupPackage = require('rollup/package.json');
    if (rollupPackage.name !== '@rollup/wasm-node') throw new Error('Actualiza Rollup a la variante WASM del proyecto.');
    require('rollup');
    await import('vite');
    return true;
  } catch (error) {
    console.error(`Dependencias de arranque: ${error.message}`);
    return false;
  }
}

if (await checkRuntime()) process.exit(0);
console.log('Completando las dependencias de Videos Studio...');
const result = spawnSync('npm', ['install', '--include=optional', '--no-audit', '--no-fund'], {
  cwd: root, stdio: 'inherit', shell: process.platform === 'win32',
});
// Validate in a fresh process so repaired modules do not use a cached failed import.
if (result.status === 0) {
  const check = spawnSync(process.execPath, ['--input-type=module', '-e',
    "import {createRequire} from 'node:module'; const r=createRequire(import.meta.url); r('electron-updater'); r.resolve('electron'); if(r('rollup/package.json').name!=='@rollup/wasm-node') throw Error('Rollup debe usar WASM'); r('rollup'); await import('vite');"],
  { cwd: root, stdio: 'inherit' });
  if (check.status === 0) process.exit(0);
}
console.error('No se pudo preparar el arranque. Ejecuta npm ci --include=optional y vuelve a intentar.');
process.exit(1);
