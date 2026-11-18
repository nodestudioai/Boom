// Barra de control durante la grabación.
const B = window.boom;
const $ = (id) => document.getElementById(id);
const SIZES = ['s', 'm', 'l'];
let settings = { shape: 'circle', size: 'm', mode: 'screen_cam' };
let confirmCancel = null;

const fmt = (ms) => {
  const t = Math.floor(ms / 1000);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
};

B.on('boom:status', (st) => {
  $('time').textContent = fmt(st.totalMs);
  const paused = st.state === 'paused';
  document.body.classList.toggle('paused', paused);
  document.body.classList.toggle('canundo', !!st.canUndo);
  $('state').textContent = paused ? 'en pausa' : 'grabando';
  $('pauseIcon').setAttribute('d', paused ? 'M8 5v14l11-7z' : 'M7 5h4v14H7zM13 5h4v14h-4z');
  $('rewind').disabled = !st.canRewind;
});

B.on('boom:settings', (s) => {
  settings = s;
  document.body.classList.toggle('nocam', s.mode === 'screen');
  document.querySelectorAll('.shape').forEach((b) => b.classList.toggle('on', b.dataset.shape === s.shape));
  $('size').textContent = s.size.toUpperCase();
  $('size').disabled = s.shape === 'full';
});

$('stop').onclick = () => B.invoke('boom:finish');
$('pause').onclick = () => B.invoke('boom:togglePause');
$('rewind').onclick = () => B.invoke('boom:rewind');
$('undo').onclick = () => B.invoke('boom:undo');
document.querySelectorAll('.shape').forEach((b) => { b.onclick = () => B.invoke('boom:setSettings', { shape: b.dataset.shape }); });
$('size').onclick = () => B.invoke('boom:setSettings', { size: SIZES[(SIZES.indexOf(settings.size) + 1) % SIZES.length] });

// Descartar pide un segundo clic, para no perder la grabación por error.
$('cancel').onclick = () => {
  if (confirmCancel) { clearTimeout(confirmCancel); confirmCancel = null; B.invoke('boom:cancel'); return; }
  $('cancel').classList.add('on');
  $('cancel').title = 'Clic otra vez para descartar todo';
  confirmCancel = setTimeout(() => { confirmCancel = null; $('cancel').classList.remove('on'); $('cancel').title = 'Descartar toda la grabación'; }, 2500);
};
