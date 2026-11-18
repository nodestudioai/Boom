<p align="center">
  <img src="build/icon.png" alt="Boom" width="180">
</p>

<h1 align="center">Boom</h1>

<p align="center">
  <b>Como Loom, pero open source.</b><br>
  Grabá tu pantalla y tu cámara, y compartí el video con un link. Sin suscripciones,
  sin límites de tiempo y con tus videos guardados en <b>tu propia</b> cuenta.
</p>

<p align="center">
  <a href="https://github.com/nodestudioai/Boom/releases/latest"><b>Descargar</b></a> ·
  <a href="#instalación-paso-a-paso">Instalación</a> ·
  <a href="cloud/README.md">Configurar los links</a> ·
  <a href="#desde-el-código">Desde el código</a>
</p>

> **English:** Boom is an open-source Loom alternative for Windows, macOS and Linux. Record your
> screen and camera, then share a link. Videos are stored in **your own** Cloudflare account
> (free tier), with automatic captions. The app is in Spanish.

---

## Qué hace

- **Grabá** pantalla + cámara, solo pantalla o solo cámara, en la mayor calidad que dé tu equipo
  (resolución nativa, 30 o 60 fps).
- **Cámara** en círculo, cuadrado, rectángulo o pantalla completa; tres tamaños; se arrastra con el
  mouse y se cambia mientras grabás. Marco de color opcional.
- **Pausá y retrocedé**: *retroceder* borra lo grabado desde la última pausa (y se puede deshacer).
  La barra de control no sale en el video.
- **Juntá videos**: si grabaste en varias tomas, elegilas en orden y Boom arma un solo video, como
  si fuera una sola toma.
- **Compartí con un link**: un clic sube el video y te copia el link. Quien lo abre lo mira en el
  navegador, sin cuenta, con velocidades de 0.5× a 2× y botón de descarga.
- **Subtítulos automáticos**: Boom transcribe el video con IA y quien mira los prende o apaga con un
  botón, como en Loom.
- **Tu logo** chiquito en una esquina del video (opcional).
- Si cambiás el nombre del video en Boom, cambia también en el link.

## Tus videos son tuyos

Boom no tiene servidores propios. Los videos quedan en tu computadora (carpeta `Videos/Boom`) y, si
querés compartirlos, se suben a **tu** cuenta de Cloudflare: el link, el espacio y los subtítulos
corren ahí. Nadie más tiene acceso a tus videos ni a tus claves.

El plan gratis de Cloudflare alcanza para la mayoría: 10 GB guardados (unas 8 horas de video en
calidad máxima), reproducciones sin cargo y unas 3 horas de subtítulos por día.

## Instalación paso a paso

### 1. Descargá Boom

Entrá a [Releases](https://github.com/nodestudioai/Boom/releases/latest) y bajá el archivo de tu
sistema:

| Sistema | Archivo |
|---|---|
| Windows 10/11 | `Boom-Setup-<versión>.exe` |
| Mac (Apple Silicon: M1 o más nuevo) | `Boom-<versión>-mac-arm64.dmg` |
| Linux (64 bits) | `Boom-<versión>-linux-x86_64.AppImage` o `Boom-<versión>-linux-amd64.deb` |

¿Mac con Intel? Por ahora hay que armarlo [desde el código](#desde-el-código).

### 2. Instalalo

Boom todavía no tiene firma digital (cuesta plata y es un proyecto gratis), así que el sistema te
va a avisar la primera vez:

- **Windows**: abrí el `.exe`. Si aparece *“Windows protegió tu PC”*, tocá **Más información →
  Ejecutar de todas formas**.
- **Mac**: abrí el `.dmg` y arrastrá Boom a *Aplicaciones*. La primera vez, hacé **clic derecho
  sobre Boom → Abrir → Abrir**. Si dice que “está dañado”, abrí la Terminal y corré
  `xattr -cr /Applications/Boom.app`.
- **Linux**: con el `.deb`, `sudo apt install ./Boom-*.deb`. Con el AppImage,
  `chmod +x Boom-*.AppImage` y abrilo.

### 3. Dale permisos (solo la primera vez)

- **Mac**: aceptá cámara y micrófono cuando los pida. Para la pantalla, la primera vez que grabes
  Boom te abre *Configuración del Sistema → Privacidad y seguridad → Grabación de pantalla*:
  activá Boom y volvé a abrirlo.
- **Windows y Linux**: el sistema pide cámara y micrófono la primera vez. En Linux con Wayland vas a
  elegir la pantalla en una ventana del sistema.

### 4. Grabá

Elegí qué grabar, la cámara y el micrófono, y tocá **Empezar a grabar**. Al terminar, el video
aparece en **Mis videos**.

### 5. Configurá los links (una sola vez, ~10 minutos)

Para tener el botón **Copiar link** hace falta conectar Boom con tu Cloudflare. Seguí el
[**paso a paso de los links**](cloud/README.md). Ahí también está cómo usar tu propio dominio
(por ejemplo `videos.tuempresa.com`).

## Atajos

| | Windows y Linux | Mac |
|---|---|---|
| Grabar / terminar | `Ctrl+Shift+B` | `⌘⇧B` |
| Pausar / seguir | `Alt+Shift+P` | `⌥⇧P` |
| Retroceder a la última pausa | `Alt+Shift+Z` | `⌥⇧Z` |

## Diferencias entre sistemas

| | Windows | Mac | Linux |
|---|---|---|---|
| Pantalla, cámara y micrófono | Sí | Sí | Sí |
| Audio de la PC (lo que suena en la compu) | Sí | No | No |
| La barra de control no sale en el video | Sí | Sí | No: en Linux puede aparecer |

Boom se desarrolla y prueba en Windows. Mac y Linux se arman automáticamente con cada versión y
corren las pruebas automáticas, pero tienen menos uso real: si algo falla,
[abrí un issue](https://github.com/nodestudioai/Boom/issues).

## Desde el código

Necesitás [Node.js](https://nodejs.org) 20 o más nuevo.

```bash
git clone https://github.com/nodestudioai/Boom.git
cd Boom
npm install
npm start
```

| Comando | Qué hace |
|---|---|
| `npm start` | Abre Boom |
| `npm test` | Pruebas de la lógica (tramos, calidad, cámara, ffmpeg, juntar videos, subtítulos) |
| `npm run dist` | Arma el instalador para tu sistema en `dist/` |
| `npm run smoke` | Prueba completa: abre Boom con cámara y micrófono de prueba y **graba tu pantalla real** unos segundos (después borra todo) |

Para publicar una versión nueva, subí un tag `vX.Y.Z`: GitHub Actions arma los instaladores de
Windows, Mac y Linux y los deja en un borrador de Release.

### Cómo está armado

| Carpeta | Qué hay |
|---|---|
| `src/core` | Lógica pura y probada: tramos, calidad, geometría de la cámara, ffmpeg, juntar videos, subtítulos |
| `src/main` | Proceso principal de Electron: ventanas, grabación por tramos, exportación, biblioteca, subida |
| `src/renderer` | Panel, cámara, barra de control, marca de agua y motor de grabación |
| `cloud` | Worker de Cloudflare: guarda los videos en R2, sirve la página del link y transcribe con Workers AI |
| `build` | Íconos |

Graba con `MediaRecorder` (H.264 cuando el equipo lo permite) en tramos que se unen con
[ffmpeg](https://ffmpeg.org) sin recodificar. Los subtítulos usan Whisper
(`@cf/openai/whisper-large-v3-turbo`) en Workers AI.

## Licencia

[MIT](LICENSE). Hecho por [NodeStudio](https://github.com/nodestudioai). Boom no está afiliado a
Loom.
