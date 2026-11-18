// Máquina de tramos: cada tramo es lo grabado entre dos pausas.
// Es lógica pura: no toca archivos ni grabadores, solo decide qué hacer.
function createTakes() {
  let state = 'idle';
  let nextId = 1;
  let current = null;        // tramo que se está grabando
  const kept = [];           // tramos que entran al video final, en orden
  let discarded = [];        // pila de tramos descartados (se pueden recuperar)

  const close = (now) => {
    const t = current;
    current = null;
    t.endedAt = now;
    t.ms = Math.max(0, now - t.startedAt);
    return t;
  };
  const open = (now) => {
    current = { id: nextId++, startedAt: now, endedAt: null, ms: 0 };
    state = 'recording';
    return current.id;
  };
  const purge = () => {
    const ids = discarded.map(t => t.id);
    discarded = [];
    return ids;
  };
  const totalMs = (now) =>
    kept.reduce((s, t) => s + t.ms, 0) + (current ? Math.max(0, now - current.startedAt) : 0);

  return {
    get state() { return state; },
    start(now) {
      if (state !== 'idle') return { opened: null };
      return { opened: open(now) };
    },
    pause(now) {
      if (state !== 'recording') return { closed: null };
      const t = close(now);
      kept.push(t);
      state = 'paused';
      return { closed: t.id };
    },
    resume(now) {
      if (state !== 'paused') return { opened: null, purged: [] };
      const purged = purge();
      return { opened: open(now), purged };
    },
    rewind(now) {
      if (state === 'recording') {
        const t = close(now);
        discarded.push(t);
        state = 'paused';
        return { discarded: t.id, stopCurrent: true };
      }
      if (state === 'paused' && kept.length) {
        const t = kept.pop();
        discarded.push(t);
        return { discarded: t.id, stopCurrent: false };
      }
      return { discarded: null, stopCurrent: false };
    },
    undo() {
      if (state !== 'paused' || !discarded.length) return { restored: null };
      const t = discarded.pop();
      kept.push(t);
      return { restored: t.id };
    },
    finish(now) {
      if (state !== 'recording' && state !== 'paused') return { closed: null, purged: [] };
      let closed = null;
      if (state === 'recording') {
        const t = close(now);
        kept.push(t);
        closed = t.id;
      }
      state = 'finished';
      return { closed, purged: purge() };
    },
    kept: () => kept.map(t => ({ ...t })),
    totalMs,
    canUndo: () => state === 'paused' && discarded.length > 0,
    snapshot(now) {
      return {
        state,
        totalMs: totalMs(now),
        takes: kept.length + (current ? 1 : 0),
        canUndo: state === 'paused' && discarded.length > 0,
        canRewind: state === 'recording' || (state === 'paused' && kept.length > 0),
      };
    },
  };
}

module.exports = { createTakes };
