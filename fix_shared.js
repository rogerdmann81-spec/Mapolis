const fs = require('fs');
let content = fs.readFileSync('assets/shared.js', 'utf8');

content = content.replace(
  /handle: p\.handle \|\| null,/,
  `auth_uid: p.auth_uid || (typeof _getSession === 'function' && _getSession() ? _getSession().user?.id : null),\n      handle: p.handle || null,`
);

fs.writeFileSync('assets/shared.js', content);
