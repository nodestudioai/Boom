// Prueba automática de punta a punta (solo con BOOM_SMOKE=1).
// Graba de verdad unos segundos con la cámara y el micrófono de prueba de Chromium.
const fs = require('fs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(api) {
  const reportPath = process.env.BOOM_SMOKE_REPORT;
  const report = { cases: {} };
  const end = (code) => {
    if (reportPath) fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    api.app.exit(code);
  };
  const log = [];
  report.log = log;
  const step = async (name, fn) => { const r = await fn(); log.push({ name, status: api.status() }); return r; };
  report.engineLog = [];
  api.wins.engine.webContents.on('console-message', (e) => { if (report.engineLog.length < 30) report.engineLog.push(String(e.message).slice(0, 300)); });
  const guard = setTimeout(() => { report.error = 'timeout'; end(2); }, 170000);
  try {
    await sleep(2500); // que carguen las ventanas
    api.applySettings({ mode: 'screen_cam', shape: 'circle', size: 'l', fps: 30, preset: 'max', systemAudio: true, micId: '' });
    await sleep(2500); // que la burbuja abra la cámara
    if (api.wins.bubble) report.bubble = { bounds: api.wins.bubble.getBounds(), visible: api.wins.bubble.isVisible() };

    const shot = async (win, name) => {
      if (!process.env.BOOM_SHOTS || !win || win.isDestroyed()) return;
      try {
        // La barra de control y el botón de esquina están excluidos de las capturas: se les quita esa protección un instante.
        const isControl = win === api.wins.control || win === api.wins.corner;
        if (isControl) { win.setContentProtection(false); await sleep(250); }
        let img = null;
        for (let i = 0; i < 6 && !img; i++) {
          try { img = await win.webContents.capturePage(); } catch (err) { if (i === 5) throw err; await sleep(500); }
        }
        if (isControl) win.setContentProtection(true);
        fs.writeFileSync(require('path').join(process.env.BOOM_SHOTS, name + '.png'), img.toPNG());
      } catch (err) { log.push({ name: 'captura ' + name, error: String(err) }); }
    };
    await shot(api.wins.panel, 'panel');

    // Opcional: se mata el servicio de cámaras del sistema para ver si la burbuja se reconecta sola.
    if (process.env.BOOM_SMOKE_KILLCAM) {
      const camOn = () => api.wins.bubble.webContents.executeJavaScript('!!(stream && stream.active)');
      const m = api.app.getAppMetrics().find((x) => /video.?capture/i.test(String(x.serviceName || '') + String(x.name || '')));
      report.killcam = { before: await camOn(), found: !!m, name: m ? (m.serviceName || m.name) : null };
      if (m) {
        process.kill(m.pid);
        const t = Date.now();
        await sleep(700);
        report.killcam.rightAfter = await camOn();
        for (let i = 0; i < 40 && !(await camOn()); i++) await sleep(500);
        report.killcam.recovered = await camOn();
        report.killcam.ms = Date.now() - t;
        // Diagnóstico: qué ve cada ventana después del corte.
        const probe = "(async () => { const d = await navigator.mediaDevices.enumerateDevices(); let g; try { const s = await navigator.mediaDevices.getUserMedia({ video: true }); g = 'ok ' + s.getVideoTracks()[0].label; s.getTracks().forEach((t) => t.stop()); } catch (e) { g = e.name + ': ' + e.message; } return { cams: d.filter((x) => x.kind === 'videoinput').length, mics: d.filter((x) => x.kind === 'audioinput').length, gum: g }; })()";
        report.killcam.bubbleSees = await api.wins.bubble.webContents.executeJavaScript(probe);
        report.killcam.panelSees = await api.wins.panel.webContents.executeJavaScript(probe);
        report.killcam.services = api.app.getAppMetrics().map((x) => x.serviceName || x.name || x.type);
        report.killcam.message = await api.wins.bubble.webContents.executeJavaScript("document.getElementById('msg').textContent");
        clearTimeout(guard);
        return end(0); // es solo un diagnóstico: sin cámara no tiene sentido seguir con los demás casos
      }
    }

    // Cámara: esquinas rectas y marcos.
    api.applySettings({ shape: 'square', rounded: false, frame: 'blue' });
    await sleep(700); await shot(api.wins.bubble, 'camara-cuadrada-recta-marco-azul');
    api.applySettings({ shape: 'rect', rounded: true, frame: 'cyan' });
    await sleep(700); await shot(api.wins.bubble, 'camara-rectangulo-redondo-marco-celeste');
    api.applySettings({ shape: 'circle', frame: 'white' });
    await sleep(700); await shot(api.wins.bubble, 'camara-circulo-marco-blanco');

    // Cámara completa: tiene que aparecer el botón de la esquina, y achicar tiene que volver a la forma anterior.
    api.applySettings({ shape: 'full' });
    for (let i = 0; i < 16 && !(api.wins.corner && !api.wins.corner.isDestroyed() && api.wins.corner.isVisible()); i++) await sleep(250);
    await sleep(500);
    const corner = api.wins.corner;
    let restoreMouse = async () => {};
    report.full = {
      cornerVisible: !!corner && !corner.isDestroyed() && corner.isVisible(),
      cornerBounds: corner && !corner.isDestroyed() ? corner.getBounds() : null,
      bubbleBounds: api.wins.bubble.getBounds(),
      panelOnTop: api.wins.panel.isAlwaysOnTop(),
    };
    await shot(corner, 'esquina-achicar');
    if (process.env.BOOM_SMOKE_MOUSE && report.full.cornerVisible) {
      // Mueve el mouse de verdad hasta la esquina y hace clic en el botón.
      const { execFile } = require('child_process');
      const b = corner.getBounds();
      const target = api.screen.dipToScreenPoint({ x: b.x + b.width - 80, y: b.y + 28 });
      // Sin bloquear la app: si se la bloquea, los clics le llegan tarde y la prueba miente.
      const ps = (cmd) => new Promise((resolve) => execFile('powershell', ['-NoProfile', '-Command', cmd], { windowsHide: true }, () => resolve()));
      const user32 = "$u = Add-Type -PassThru -Name U -Namespace W -MemberDefinition '[DllImport(\"user32.dll\")] public static extern bool SetProcessDPIAware(); [DllImport(\"user32.dll\")] public static extern bool SetCursorPos(int x, int y); [DllImport(\"user32.dll\")] public static extern void mouse_event(uint f, uint x, uint y, uint d, System.UIntPtr e);'; [void]$u::SetProcessDPIAware(); ";
      // El mouse arranca lejos de la esquina (y al final vuelve adonde estaba).
      const before = api.screen.dipToScreenPoint(api.screen.getCursorScreenPoint());
      const mid = api.screen.dipToScreenPoint({ x: Math.round(b.x / 2), y: b.y + 400 });
      await ps(user32 + `[void]$u::SetCursorPos(${Math.round(mid.x)}, ${Math.round(mid.y)})`);
      restoreMouse = () => ps(user32 + `[void]$u::SetCursorPos(${Math.round(before.x)}, ${Math.round(before.y)})`);
      // Como si el usuario hiciera clic en la cámara: Windows la sube por encima de todo.
      // El botón de la esquina tiene que seguir alcanzable igual.
      api.wins.bubble.focus();
      api.wins.bubble.moveTop();
      await sleep(3500); // que se esconda el aviso inicial: el botón tiene que aparecer solo por el mouse
      report.full.hiddenBeforeHover = await corner.webContents.executeJavaScript("getComputedStyle(document.getElementById('shrink')).opacity");
      // Llega a la esquina moviéndose de a poco, como una mano (un único salto no siempre cuenta como "pasar por encima").
      const tx = Math.round(target.x), ty = Math.round(target.y);
      await ps(user32 + `foreach ($d in 40, 30, 20, 12, 6, 3, 1, 0) { [void]$u::SetCursorPos(${tx} - $d, ${ty} + $d); Start-Sleep -Milliseconds 40 }`);
      report.full.cursor = api.screen.getCursorScreenPoint();
      const hoverNow = () => corner.webContents.executeJavaScript("document.body.matches(':hover') + '|' + getComputedStyle(document.getElementById('shrink')).opacity");
      for (let i = 0; i < 12; i++) {
        report.full.hover = await hoverNow();
        if (report.full.hover === 'true|1') break;
        await sleep(250);
      }
      await ps(user32 + `[void]$u::SetCursorPos(${Math.round(target.x)}, ${Math.round(target.y)}); Start-Sleep -Milliseconds 150; $u::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 80; $u::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)`);
      await sleep(900);
      report.full.shapeAfterClick = api.settings.get().shape;
      await restoreMouse();
    } else {
      await corner.webContents.executeJavaScript("document.getElementById('shrink').click()");
      await sleep(600);
      report.full.shapeAfterClick = api.settings.get().shape;
    }
    report.full.cornerVisibleAfter = !!api.wins.corner && !api.wins.corner.isDestroyed() && api.wins.corner.isVisible();
    report.full.bubbleAfter = api.wins.bubble.getBounds();

    // De acá en más: cámara cuadrada de esquinas rectas con marco azul y la marca de agua puesta.
    api.applySettings({ shape: 'square', rounded: false, frame: 'blue', watermark: true });
    await sleep(600);

    // A: 3 s, pausa, 2 s que se descartan con "retroceder", 2 s más. Esperado: ~5 s en 2 tramos.
    let s = await api.startRecording();
    report.cases.A = { start: s };
    if (!s.ok) throw new Error('A no arrancó: ' + s.error);
    const wm = api.wins.watermark;
    const disp = api.screen.getPrimaryDisplay();
    report.watermark = { visible: !!wm && !wm.isDestroyed() && wm.isVisible(), bounds: wm && !wm.isDestroyed() ? wm.getBounds() : null, scale: disp.scaleFactor, display: disp.bounds };
    await sleep(1500); await shot(api.wins.control, 'control-grabando'); await shot(wm, 'marca-de-agua'); await sleep(1500);
    await step('A pausa', api.pause);
    await sleep(300); await shot(api.wins.control, 'control-pausa');
    api.applySettings({ shape: 'rect' });
    await sleep(500); await step('A reanuda', api.resume);
    await sleep(2000); await step('A retrocede', api.rewind);
    await sleep(300); await shot(api.wins.control, 'control-retrocedido');
    api.applySettings({ shape: 'square' });
    await sleep(300); await step('A reanuda 2', api.resume);
    await sleep(2000);
    report.cases.A.expectedMs = api.status().totalMs; // lo que marca el contador justo antes de terminar
    report.cases.A.finish = await api.finish();
    report.watermarkAfter = !!api.wins.watermark && !api.wins.watermark.isDestroyed() && api.wins.watermark.isVisible();

    // B: grabar y descartar todo. Esperado: no se guarda nada.
    s = await api.startRecording();
    report.cases.B = { start: { ok: s.ok, error: s.error } };
    await sleep(1200); await api.rewind();
    report.cases.B.finish = await api.finish();

    // C: retroceder y arrepentirse con "deshacer". Esperado: ~3 s en 2 tramos.
    api.applySettings({ mode: 'cam' });
    await sleep(800);
    const tc = Date.now();
    s = await api.startRecording();
    report.cases.C = { start: s, startMs: Date.now() - tc };
    await sleep(1500); await api.pause();
    await api.resume(); await sleep(1500);
    await api.rewind(); await api.undo();
    report.cases.C.finish = await api.finish();

    // D: pausar casi enseguida (antes de que el codificador termine de arrancar).
    // Esperado: ese primer tramo cortito NO se pierde. ~0,4 s + 2 s en 2 tramos.
    api.applySettings({ mode: 'screen_cam', shape: 'circle', watermark: false });
    await sleep(800);
    s = await api.startRecording();
    report.cases.D = { start: { ok: s.ok, error: s.error } };
    report.watermarkOff = !!api.wins.watermark && !api.wins.watermark.isDestroyed() && api.wins.watermark.isVisible();
    await sleep(400); await api.pause();
    await api.resume(); await sleep(2000);
    report.cases.D.finish = await api.finish();

    await sleep(600); await shot(api.wins.panel, 'panel-videos');
    await api.wins.panel.webContents.executeJavaScript("showTab('compartir')");
    await sleep(300); await shot(api.wins.panel, 'panel-compartir');
    clearTimeout(guard);
    end(0);
  } catch (err) {
    clearTimeout(guard);
    report.error = err.stack || String(err);
    end(1);
  }
}

module.exports = { run };
