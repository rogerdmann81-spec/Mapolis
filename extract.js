const fs = require('fs');
const html = fs.readFileSync('play/index.html', 'utf8');
const scripts = [];
const regex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
let match;
while ((match = regex.exec(html)) !== null) {
  scripts.push(match[1]);
}
fs.writeFileSync('extracted_play.js', scripts.join('\n'));
