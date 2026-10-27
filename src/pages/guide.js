import { initSite } from '../shared/common.js';
await initSite();
document.getElementById('yr').textContent = new Date().getFullYear();
