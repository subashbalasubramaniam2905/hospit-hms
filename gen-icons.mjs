// Regenerates src/app/core/icons.ts from scripts-icons.txt plus any icon names used in templates.
import fs from 'fs'; import path from 'path';
const pascal = s => s.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join('');
const set = new Set(fs.readFileSync('scripts-icons.txt', 'utf8').split(/\s+/).filter(Boolean));
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
for (const f of walk('src/app').filter(f => /\.(ts|html)$/.test(f))) { const t = fs.readFileSync(f, 'utf8'); for (const m of t.matchAll(/(?:name|icon)="([a-z0-9-]+)"/g)) set.add(m[1]); for (const m of t.matchAll(/icon: '([a-z0-9-]+)'/g)) set.add(m[1]); }
const lucide = fs.readFileSync('node_modules/lucide-angular/fesm2020/lucide-angular-src-icons.mjs', 'utf8');
const names = [...set].sort().filter(n => { const ok = new RegExp(`const ${pascal(n)} = `).test(lucide); if (!ok) console.warn('MISSING icon', n); return ok; });
fs.writeFileSync('scripts-icons.txt', names.join(' ') + '\n');
const ids = names.map(pascal).sort();
fs.writeFileSync('src/app/core/icons.ts', `/* Lucide icons used by the prototype (named imports keep the bundle small). */\nimport {\n  ${ids.join(', ')}\n} from 'lucide-angular';\n\nexport const APP_ICONS = {\n  ${ids.join(', ')}\n};\n`);
console.log(ids.length, 'icons');
