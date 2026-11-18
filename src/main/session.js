// Archivos de una grabación en curso: un archivo por tramo, escrito mientras se graba.
const fs = require('fs');
const path = require('path');

function createSessionFiles(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const streams = new Map();
  const pathOf = (id) => path.join(dir, `tramo-${String(id).padStart(4, '0')}.mkv`);

  return {
    dir,
    pathOf,
    open(id) {
      if (!streams.has(id)) streams.set(id, fs.createWriteStream(pathOf(id)));
    },
    write(id, buf) {
      const s = streams.get(id);
      if (s && !s.writableEnded) s.write(buf);
    },
    close(id) {
      const s = streams.get(id);
      if (!s) return Promise.resolve();
      streams.delete(id);
      return new Promise((resolve) => s.end(resolve));
    },
    remove(id) {
      try { fs.rmSync(pathOf(id), { force: true }); } catch { /* ya no está */ }
    },
    size(id) {
      try { return fs.statSync(pathOf(id)).size; } catch { return 0; }
    },
    async closeAll() {
      await Promise.all([...streams.keys()].map((id) => this.close(id)));
    },
    destroy() {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* nada */ }
    },
  };
}

module.exports = { createSessionFiles };
