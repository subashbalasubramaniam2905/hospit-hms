/** Read once at start-up from public/config.js. An empty apiUrl keeps the app in demo mode. */
const cfg = (globalThis as { HOSPITOS_CONFIG?: { apiUrl?: string } }).HOSPITOS_CONFIG;
export const API_URL = (cfg?.apiUrl ?? '').trim().replace(/\/+$/, '');
export const LIVE = API_URL.length > 0;
