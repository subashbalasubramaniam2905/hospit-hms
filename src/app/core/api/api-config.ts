/** Read once at start-up from public/config.js. An empty apiUrl keeps the app in demo mode. */
const cfg = (globalThis as { HOSPITOS_CONFIG?: { apiUrl?: string; onlineDemo?: boolean } }).HOSPITOS_CONFIG;
export const API_URL = (cfg?.apiUrl ?? '').trim().replace(/\/+$/, '');
export const LIVE = API_URL.length > 0;
/** The hosted demo: a live server on a free plan that sleeps when idle, with one sign-in per role. */
export const ONLINE_DEMO = LIVE && cfg?.onlineDemo === true;
