const fs = require('fs');
let content = fs.readFileSync('assets/shared.js', 'utf8');

content = content.replace(
  /auth_uid: p\.auth_uid \|\| \(typeof _getSession === 'function' && _getSession\(\) \? _getSession\(\)\.user\?\.id : null\),/,
  `auth_uid: p.auth_uid || (typeof _getSession === 'function' && _getSession() && _getSession().user ? _getSession().user.id : null),`
);

fs.writeFileSync('assets/shared.js', content);
