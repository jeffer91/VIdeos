# Videos

Aplicación de escritorio local con Electron + React + Vite para grabar cámara + micrófono o solo audio, con prioridad en grabación fluida y optimización posterior.

## Funciones

- Video 16:9 con objetivo Full HD 1920 × 1080 a 30 fps.
- Cámara + micrófono o modo solo audio.
- Pausar, continuar y finalizar grabaciones.
- Selección de cámara y micrófono.
- Indicador de resolución y FPS reales entregados por el dispositivo.
- Medidor de nivel del micrófono.
- Grabación en fragmentos guardados en IndexedDB para reducir presión sobre la RAM.
- Recuperación de la última grabación local si la aplicación se interrumpe.
- Optimización después de grabar mediante FFmpeg.wasm, sin comprimir durante la captura.
- Video optimizado en MP4 H.264/AAC a 1080p.
- Audio optimizado en M4A/AAC.
- Todo el procesamiento ocurre localmente en el equipo. No usa Firebase, nube ni servidor externo.

## Ejecutar en modo Electron

Requiere Node.js 18 o superior.

```bash
npm install
npm start
```

`npm start` abre directamente una ventana de Electron. Vite se inicia internamente solo como servidor local del renderer durante el desarrollo; no necesitas abrir `localhost` manualmente.

Si quieres ejecutar únicamente la versión web para diagnóstico:

```bash
npm run start:web
```

`npm install` copia automáticamente los archivos de FFmpeg desde `node_modules` a `public/ffmpeg`, de modo que la optimización funciona sin depender de un CDN durante el uso de la app.

## Calidad y fluidez

La app solicita 1920 × 1080, 16:9 y 30 fps, pero muestra la resolución real que entrega la cámara. Para evitar retrasos, la grabación usa `MediaRecorder` y guarda fragmentos de forma incremental. La transcodificación pesada se ejecuta únicamente cuando el usuario pulsa **Optimizar** después de finalizar.

## Seguridad de Electron

La ventana usa `contextIsolation`, mantiene `nodeIntegration` desactivado, conserva `webSecurity` y solo autoriza permisos de medios para el renderer local de la propia aplicación.
