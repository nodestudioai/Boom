// Índice de grabaciones hechas (un JSON al lado de las preferencias).
const fs = require('fs');
const path = require('path');

function createLibrary(file) {
  let items = [];
  try { items = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* vacío */ }
  if (!Array.isArray(items)) items = [];
  const save = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(items, null, 2));
  };
  return {
    list: () => items.map(i => ({ ...i, missing: !fs.existsSync(i.file) })),
    get: (id) => items.find(i => i.id === id) || null,
    add(item) { items.unshift(item); save(); return item; },
    update(id, patch) {
      const it = items.find(i => i.id === id);
      if (it) { Object.assign(it, patch); save(); }
      return it || null;
    },
    remove(id) { items = items.filter(i => i.id !== id); save(); },
  };
}

module.exports = { createLibrary };
