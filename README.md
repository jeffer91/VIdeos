# Videos Studio

Aplicación de escritorio local con Electron + React + Vite para producir videos por escenas/diapositivas. La app separa contenido, grabación, corte, biblioteca, composición, video memes y control final para que cada etapa pueda modificarse sin rehacer las anteriores.

## Flujo actual

1. **Contenido**: importa la estructura `GANCHO + TÍTULO + CUERPO + CONTENIDO + LECTURA + VISUAL + CTA` y valida el formato.
2. **Grabación**: graba una diapositiva a la vez con cámara + micrófono o solo audio. `LECTURA` se usa únicamente como prompter.
3. **Corte**: conserva la toma original y genera una versión limpia. Permite recortar inicio/final y eliminar tramos internos.
4. **Biblioteca**: almacena videos reutilizables en una Biblioteca Global o en la Biblioteca del Proyecto: Intros, Transiciones, Endings, CTA y Video memes.
5. **Unión**: prepara cada escena con video limpio, datos y visual. Permite elegir tema, intro, ending, CTA y transiciones.
6. **Video memes**: programa un meme dentro de una escena. El video principal se pausa, queda desenfocado, se reproduce el meme y después continúa desde el mismo punto.
7. **Resultado**: audita grabaciones, cortes, escenas, CTA, memes y recursos antes del futuro render final.

## Política de clips

- **Intro**: clip independiente al inicio.
- **CTA**: clip de video preparado por el usuario; se inserta como un video normal, no como overlay.
- **Transición**: clip independiente reproducido completo entre una escena y la siguiente.
- **Ending**: clip independiente al final.
- **Video meme**: comportamiento especial dentro de una escena: pausa + desenfoque + meme + continuación.

## Biblioteca local

Durante el desarrollo, los archivos se copian dentro de:

```text
library/
  global/
    intros/
    transitions/
    endings/
    cta/
    memes/
  projects/
    <project-id>/
      intros/
      transitions/
      endings/
      cta/
      memes/
```

`library/` está ignorada por Git para evitar subir accidentalmente archivos de video al repositorio.

## Grabación

- Objetivo de video: 1920 × 1080, 16:9, 30 fps.
- Cámara + micrófono o modo solo audio.
- Pausa y reanudación.
- Selección de cámara y micrófono.
- Medidor de nivel de micrófono.
- Fragmentos de grabación almacenados en IndexedDB.
- Recuperación de una toma interrumpida cuando existen fragmentos recuperables.
- Las tomas aceptadas, versiones limpias y planes de producción permanecen asociados al proyecto local.

## Corte local

El corte se procesa con FFmpeg.wasm local. El original se mantiene y la app guarda `cleanedBlob` como salida de edición. Los cortes internos se concatenan nuevamente para producir una única versión limpia.

## Ejecutar

Requiere **Node.js 22.12.0 o superior**, porque Electron 44 exige esa versión mínima.

```bash
npm install
npm start
```

Para actualizar una copia ya instalada en desarrollo:

```bash
git pull origin main
npm start
```

## Auditoría automática

```bash
npm run audit
```

La auditoría comprueba, entre otras cosas:

- formato y parser de diapositivas;
- numeración consecutiva;
- tipos de VISUAL y CTA;
- orden de etapas;
- conexión entre preload e IPC de Electron;
- presencia de recuperación y corte;
- política de transición como clip después de una escena;
- protección de `library/` frente a Git;
- versión mínima de Node compatible con Electron.

GitHub Actions ejecuta la auditoría, revisa sintaxis de `electron/main.cjs` y `electron/preload.cjs`, y compila el renderer.

## Seguridad de Electron

La ventana mantiene `contextIsolation`, `nodeIntegration` desactivado, `sandbox` y `webSecurity`. Los handlers de Biblioteca validan que las rutas permanezcan dentro de la carpeta local de Biblioteca antes de abrir, revelar, eliminar o establecer recursos predeterminados.

## Pendiente

El motor que renderizará el MP4 final todavía no está implementado. La app actualmente prepara y valida el proyecto para esa fase; no debe considerarse terminado el flujo de exportación hasta que el renderer final genere la secuencia real de escenas, CTA, transiciones, memes, intro y ending.
