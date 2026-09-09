import { access, copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const destination = path.join(root, 'public', 'ffmpeg');

const candidates = [
  path.join(root, 'node_modules', '@ffmpeg', 'core', 'dist', 'esm'),
  path.join(root, 'node_modules', '@ffmpeg', 'core', 'dist', 'umd'),
];

let source = null;
for (const candidate of candidates) {
  try {
    await access(path.join(candidate, 'ffmpeg-core.js'));
    await access(path.join(candidate, 'ffmpeg-core.wasm'));
    source = candidate;
    break;
  } catch {
    // Try next package layout.
  }
}

if (!source) {
  console.error('No se encontraron los archivos de @ffmpeg/core. Ejecuta npm install de nuevo.');
  process.exit(1);
}

await mkdir(destination, { recursive: true });
await Promise.all([
  copyFile(path.join(source, 'ffmpeg-core.js'), path.join(destination, 'ffmpeg-core.js')),
  copyFile(path.join(source, 'ffmpeg-core.wasm'), path.join(destination, 'ffmpeg-core.wasm')),
]);

console.log('FFmpeg local listo en public/ffmpeg.');
