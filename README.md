# Videos

Aplicación web local para grabar cámara + micrófono o solo audio, con prioridad en grabación fluida y optimización posterior.

## Funciones

- Video 16:9 con objetivo Full HD 1920 × 1080 a 30 fps.
- Cámara + micrófono o modo solo audio.
- Pausar, continuar y finalizar grabaciones.
- Selección de cámara y micrófono.
- Indicador de resolución y FPS reales entregados por el dispositivo.
- Medidor de nivel del micrófono.
- Grabación en fragmentos guardados en IndexedDB para reducir presión sobre la RAM.
- Recuperación de la última grabación local si la pestaña se interrumpe.
- Optimización después de grabar mediante FFmpeg.wasm, sin comprimir durante la captura.
- Video optimizado en MP4 H.264/AAC a 1080p.
- Audio optimizado en M4A/AAC.
- Todo el procesamiento ocurre localmente en el navegador. No usa Firebase, nube ni servidor.

## Ejecutar

Requiere Node.js 18 o superior.

```bash
npm install
npm start
```

Luego abre la dirección local que muestra Vite, normalmente:

```text
http://localhost:5173
```

`npm install` copia automáticamente los archivos de FFmpeg desde `node_modules` a `public/ffmpeg`, de modo que la optimización funciona sin depender de un CDN durante el uso de la app.

## Navegador recomendado

Chrome o Edge de escritorio. La cámara y el micrófono funcionan en `localhost`; si se accede desde otro dispositivo mediante una IP de red, el navegador puede exigir HTTPS.

## Calidad y fluidez

La app solicita 1920 × 1080, 16:9 y 30 fps, pero muestra la resolución real que entrega la cámara. Para evitar retrasos, la grabación usa `MediaRecorder` y guarda fragmentos de forma incremental. La transcodificación pesada se ejecuta únicamente cuando el usuario pulsa **Optimizar** después de finalizar.
