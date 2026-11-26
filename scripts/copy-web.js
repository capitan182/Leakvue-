/* Copies the web app into www/ for the native (Capacitor) build.
   The web files stay where they are so GitHub Pages and opening index.html from disk keep working.
   sw.js is left out on purpose: the native app already ships every file inside itself. */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'www');
const ITEMS = ['index.html', 'css', 'js', 'icons', 'manifest.webmanifest'];

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out);
for (const item of ITEMS) {
  fs.cpSync(path.join(root, item), path.join(out, item), { recursive: true });
}
console.log('Copied ' + ITEMS.join(', ') + ' to www/');
