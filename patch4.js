const fs = require('fs');
let content = fs.readFileSync('play/index.html', 'utf8');

content = content.replace(
  /var currUid = sess && sess\.user \? sess\.user\.id : rowData\.auth_uid;/g,
  `if (!rowData) { showToast('Profile data missing'); return; }
          var currUid = sess && sess.user ? sess.user.id : rowData.auth_uid;`
);

content = content.replace(
  /var currUidEmail = sessEmail && sessEmail\.user \? sessEmail\.user\.id : rowData\.auth_uid;/g,
  `if (!rowData) { showToast('Profile data missing'); return; }
          var currUidEmail = sessEmail && sessEmail.user ? sessEmail.user.id : rowData.auth_uid;`
);

fs.writeFileSync('play/index.html', content);
