import { initSite, $, api } from '../shared/common.js';
import { eventCard, emptyState } from '../shared/ui.js';
await initSite();
document.getElementById('yr').textContent = new Date().getFullYear();
let timer;
async function load() {
  const p = new URLSearchParams({ q: $('#q').value.trim(), when: $('#when').value });
  try {
    const { events } = await api('GET', '/api/events?' + p);
    $('#ev-list').replaceChildren(...(events.length ? events.map(eventCard) : [emptyState('Tidak ada event yang cocok.')]));
  } catch (e) { $('#ev-list').replaceChildren(emptyState(e.message)); }
}
$('#q').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 300); });
$('#when').addEventListener('change', load);
$('#ev-search').addEventListener('submit', (e) => { e.preventDefault(); load(); });
load();
