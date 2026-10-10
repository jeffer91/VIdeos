// Native FFmpeg session runner. Renderer never receives unrestricted file access.
const { ipcMain, app } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');

const sessions = new Map();
const MAX_SESSIONS = 4;
const MAX_FILE_BYTES = 1024 * 1024 * 1024;
const SAFE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,160}$/;
const ALLOWED_ARGS = new Set([
  '-i','-ss','-to','-t','-map','-c:v','-c:a','-codec:v','-codec:a',
  '-b:a','-b:v','-vf','-af','-filter_complex','-filter:v','-filter:a',
  '-preset','-crf','-pix_fmt','-movflags','-vn','-an','-ar','-ac',
  '-frames:v','-loop','-shortest','-f','-safe','-filter_threads',
  '-r','-s','-metadata','-fps_mode','-vsync','-avoid_negative_ts','-version',
  '-threads','-map_metadata','-disposition','-level','-profile:v',
  '-strict','-copyts','-copytb','-fflags','-ignore_unknown','-y','-n',
  '-loglevel','-hide_banner','-nostdin','-progress','-stats_period',
]);
let binaryCache = null;

function safeFilename(filename) {
  if (typeof filename !== 'string' || !SAFE_NAME.test(filename) || filename.includes('..')) {
    throw new Error('Nombre de archivo FFmpeg no permitido.');
  }
  return filename;
}
function validateArgs(args) {
  if (!Array.isArray(args) || args.length < 1 || args.length > 180) {
    throw new Error('Los parámetros de video no son válidos.');
  }
  for (const item of args) {
    if (typeof item !== 'string' || item.length > 20000 || /[\0\r\n]/.test(item)) {
      throw new Error('Parámetro FFmpeg no permitido.');
    }
    // Never accept network inputs, concat protocol or absolute paths from renderer.
    if (/https?:\/\/|(?:^|[=:\s])(?:file|http|https|tcp|udp|pipe):|(?:^|[=:\s])(?:[a-z]:\\|\\\\|\/(?:etc|proc|tmp|home|Users)\/)/i.test(item)
       || /(?:movie|amovie|zmq|azmq|sendcmd)\s*=/.test(item)) {
      throw new Error('Protocolo o ruta externa no autorizada.');
    }
    if (item.startsWith('-') && !ALLOWED_ARGS.has(item) && !/^-?\d+(?:\.\d+)?$/.test(item)) {
      // Values may start with minus (numeric expressions or -1).
      if (!/^-[\d.]/.test(item)) throw new Error('Parámetro FFmpeg no autorizado: ' + item.slice(0, 40));
    }
  }
  return args;
}
async function executable() {
  if (binaryCache) return binaryCache;
  const candidates = process.platform === 'win32'
    ? [
      path.join(process.resourcesPath, 'ffmpeg', 'ffmpeg.exe'),
      path.join(app.getAppPath(), 'node_modules', 'ffmpeg-static', 'ffmpeg.exe'),
    ]
    : [path.join(app.getAppPath(), 'node_modules', 'ffmpeg-static', 'ffmpeg')];
  try {
    const resolved = require('ffmpeg-static');
    if (resolved) candidates.push(resolved);
  } catch { /* Bundled executable or WASM will be used. */ }
  for (const candidate of candidates) {
    try { await fs.access(candidate); binaryCache = candidate; return candidate; }
    catch { /* Next installation location. */ }
  }
  return null;
}
function getOwnedSession(event, sessionId) {
  const session = sessions.get(sessionId);
  if (!session || session.owner !== event.sender.id) throw new Error('Sesión de procesamiento inexistente.');
  return session;
}
async function cleanup(session) {
  if (session.child) {
    session.cancelled = true;
    session.child.kill('SIGKILL');
  }
  sessions.delete(session.id);
  await fs.rm(session.dir, { recursive: true, force: true }).catch(() => {});
}
async function runNative(session, args, duration, send) {
  if (session.child) throw new Error('Ya se está procesando un video en esta sesión.');
  const program = await executable();
  if (!program) throw new Error('No está disponible FFmpeg nativo. Utiliza el motor WebAssembly.');
  validateArgs(args);
  let resolved = false;
  session.cancelled = false;
  const expected = Number(duration) || 0;
  const child = spawn(program, ['-nostdin','-y','-hide_banner','-loglevel','error','-progress','pipe:1',...args], {
    cwd: session.dir, windowsHide: true, stdio: ['ignore','pipe','pipe'], shell: false,
  });
  session.child = child;
  session.lastError = '';
  session.startedAt = Date.now();
  const sendProgress = (line) => {
    const match = line.match(/^out_time_(?:ms|us)=(\d+)$/);
    if (match) {
      const seconds = Number(match[1]) / 1e6;
      const percent = expected > 0 ? Math.min(.99, seconds / expected) : null;
      send({ phase: 'processing', seconds, progress: percent, elapsedMs: Date.now() - session.startedAt });
    }
  };
  let stdout = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString('utf8');
    let i;
    while ((i = stdout.indexOf('\n')) >= 0) {
      sendProgress(stdout.slice(0, i).trim());
      stdout = stdout.slice(i + 1);
    }
  });
  child.stderr.on('data', (chunk) => {
    session.lastError = (session.lastError + chunk.toString('utf8')).slice(-5000);
  });
  return await new Promise((resolve, reject) => {
    child.on('error', (error) => {
      if (resolved) return; resolved = true;
      session.child = null;
      reject(new Error('No pudo iniciarse FFmpeg nativo: ' + error.message));
    });
    child.on('close', (code) => {
      if (resolved) return; resolved = true;
      session.child = null;
      if (session.cancelled) reject(new Error('Procesamiento cancelado por el usuario.'));
      else if (code !== 0) reject(new Error('FFmpeg nativo falló: ' + (session.lastError || 'código ' + code).slice(-1500)));
      else {send({ phase: 'done', progress: 1, elapsedMs: Date.now() - session.startedAt });resolve(0);}
    });
  });
}
function registerNativeFFmpegIpc(assertTrustedIpc) {
  const auth = (event) => assertTrustedIpc(event);
  ipcMain.handle('native-ffmpeg:status', async (event) => {
    auth(event);
    const exe = await executable();
    return { available: Boolean(exe), engine: exe ? 'native' : 'wasm', reason: exe ? '' : 'No se encontró el ejecutable nativo.' };
  });
  ipcMain.handle('native-ffmpeg:open', async (event) => {
    auth(event);
    if (!(await executable())) throw new Error('FFmpeg nativo no está instalado. Prueba el motor WebAssembly.');
    if (sessions.size >= MAX_SESSIONS) throw new Error('Hay demasiados procesamientos simultáneos.');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'videos-studio-ffmpeg-'));
    const id = randomUUID();
    sessions.set(id, { id, dir, owner: event.sender.id, child: null, cancelled: false, lastError: '' });
    return id;
  });
  ipcMain.handle('native-ffmpeg:write', async (event, { id, name, data }) => {
    auth(event);
    const session = getOwnedSession(event, id);
    if (session.child) throw new Error('No se puede escribir mientras FFmpeg está trabajando.');
    safeFilename(name);
    const bytes = Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data || []);
    if (!bytes.length || bytes.length > MAX_FILE_BYTES) throw new Error('Archivo demasiado grande o vacío.');
    await fs.writeFile(path.join(session.dir, name), bytes, { flag: 'w' });
    return bytes.length;
  });
  ipcMain.handle('native-ffmpeg:read', async (event, { id, name }) => {
    auth(event);
    const session = getOwnedSession(event, id);
    if (session.child) throw new Error('Espera a que termine el procesamiento.');
    safeFilename(name);
    const stat = await fs.stat(path.join(session.dir, name));
    if (!stat.size || stat.size > MAX_FILE_BYTES) throw new Error('El archivo de salida no es válido.');
    return new Uint8Array(await fs.readFile(path.join(session.dir, name)));
  });
  ipcMain.handle('native-ffmpeg:delete', async (event, { id, name }) => {
    auth(event);
    const session = getOwnedSession(event, id);
    if (session.child) throw new Error('El procesamiento sigue activo.');
    safeFilename(name);
    await fs.rm(path.join(session.dir, name), { force: true });
    return true;
  });
  ipcMain.handle('native-ffmpeg:exec', async (event, { id, args, duration }) => {
    auth(event);
    const session = getOwnedSession(event, id);
    return runNative(session, args, duration, (details) => {
      if (!event.sender.isDestroyed()) event.sender.send('native-ffmpeg:progress', { id, ...details });
    });
  });
  ipcMain.handle('native-ffmpeg:cancel', async (event, id) => {
    auth(event);
    const session = getOwnedSession(event, id);
    session.cancelled = true;
    if (session.child) session.child.kill('SIGKILL');
    return true;
  });
  ipcMain.handle('native-ffmpeg:close', async (event, id) => {
    auth(event);
    await cleanup(getOwnedSession(event, id));
    return true;
  });
  app.on('before-quit', () => {
    for (const session of sessions.values()) void cleanup(session);
  });
  return { executable };
}
module.exports = { registerNativeFFmpegIpc };
