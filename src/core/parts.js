// Parte un archivo en trozos para subirlo de a partes.
const DEFAULT_PART = 10 * 1024 * 1024;

function planParts(size, partSize = DEFAULT_PART) {
  if (!Number.isFinite(size) || size <= 0) return [];
  const parts = [];
  for (let start = 0, n = 1; start < size; start += partSize, n++) {
    parts.push({ n, start, end: Math.min(size, start + partSize) });
  }
  return parts;
}

module.exports = { DEFAULT_PART, planParts };
