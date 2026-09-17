const fs = require('fs');
let content = fs.readFileSync('assets/shared.js', 'utf8');

if (!content.includes('badges: row.badges')) {
  content = content.replace(
    /stats: row\.stats \|\| \{ cr: 0, totalAnswered: 0, totalCorrect: 0 \},/,
    `stats: row.stats || { cr: 0, totalAnswered: 0, totalCorrect: 0 },\n      badges: row.badges || [],\n      accessories: row.accessories || [],`
  );
  content = content.replace(
    /stats: p\.stats \|\| \{\},/,
    `stats: p.stats || {},\n      badges: p.badges || [],\n      accessories: p.accessories || [],`
  );
  fs.writeFileSync('assets/shared.js', content);
  console.log("Patched shared.js");
} else {
  console.log("Already patched");
}
