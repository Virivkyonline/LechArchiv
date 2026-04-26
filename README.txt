LechPlay - prehrávač cez Worker

Zmeny:
- klik na film/seriál už neotvára externé okno
- index.html otvorí fullscreen prehrávač v aplikácii
- worker.js má endpoint /api/play
- worker sa pokúsi prihlásiť cez údaje z index.html a vytiahnuť iframe/video
- ak nenájde priamy iframe/video, zobrazí stránku cez /proxy v iframe

V index.html vyplň:
const SOSAC_EMAIL = "tvoj_login";
const SOSAC_PASSWORD = "tvoje_heslo";

Potom nahraj worker.js na Cloudflare Worker a index.html na GitHub Pages.
