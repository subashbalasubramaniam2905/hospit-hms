/* HospitOS runtime settings. Edit this file on the server after deploying; no rebuild needed.
   apiUrl empty  -> demo mode: fictional data kept in this browser only.
   apiUrl set    -> live mode: real sign-in, data stored on the HospitOS server.
   Example: window.HOSPITOS_CONFIG = { apiUrl: 'https://api.your-hospital.in' }; */
window.HOSPITOS_CONFIG = { apiUrl: '' };

/* Local live mode: `npm run start:live` serves on port 4201 and talks to the API on this computer. */
if (location.hostname === 'localhost' && location.port === '4201') window.HOSPITOS_CONFIG.apiUrl = 'http://localhost:8080';
