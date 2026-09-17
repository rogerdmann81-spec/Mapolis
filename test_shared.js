const fs = require('fs');
eval(fs.readFileSync('assets/shared.js', 'utf8'));
const profile = { id: 1, handle: 'test' };
console.log(syncStore._buildProfileRow(profile));
