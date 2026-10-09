import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

const corePath = new URL('../public/ffmpeg/ffmpeg-core.js', import.meta.url);
const wasmPath = new URL('../public/ffmpeg/ffmpeg-core.wasm', import.meta.url);
assert.ok(readFileSync(corePath).length > 1000, 'El motor FFmpeg JS debe estar copiado en /public.');
assert.equal(readFileSync(wasmPath).subarray(0, 4).toString('hex'), '0061736d', 'El núcleo debe ser un WebAssembly válido.');

let server;
try {
  server = await createServer({
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, strictPort: false },
  });
  await server.listen();
  const address = server.httpServer.address();
  assert.ok(address?.port, 'Vite debe abrir un puerto de pruebas.');
  const base = `http://127.0.0.1:${address.port}`;
  const responseJs = await fetch(`${base}/ffmpeg/ffmpeg-core.js`);
  assert.equal(responseJs.status, 200, 'Vite debe servir el motor JS sin overlay de errores.');
  const script = await responseJs.text();
  assert.ok(script.includes('createFFmpegCore') || script.includes('Module') || script.includes('instantiateWasm'), 'No debe devolver HTML en lugar de FFmpeg JS.');
  assert.ok(!script.includes('<!doctype html>'), 'No debe devolver la SPA en lugar del motor.');

  const responseWasm = await fetch(`${base}/ffmpeg/ffmpeg-core.wasm`);
  assert.equal(responseWasm.status, 200, 'Vite debe servir el WASM.');
  const reader = responseWasm.body.getReader();
  const first = await reader.read();
  assert.equal(Buffer.from(first.value || []).subarray(0, 4).toString('hex'), '0061736d', 'La respuesta debe comenzar con el encabezado WASM.');
  await reader.cancel();
  const moduleResponse = await fetch(`${base}/src/ffmpeg.js`);
  assert.equal(moduleResponse.status, 200, 'Vite debe transformar el módulo del editor.');
  const transformed = await moduleResponse.text();
  assert.ok(!transformed.includes('vite-error-overlay'), 'El editor no debe fallar por importar directamente un asset de /public.');
  console.log('Vite dev: FFmpeg JS/WASM y editor entregados correctamente.');
} finally {
  if (server) await server.close();
}
