const fs = require('fs');
let content = fs.readFileSync('play/index.html', 'utf8');

content = content.replace(
  /const data = await resp\.json\(\);\s*if \(data\) \{\s*var sess =/g,
  `const data = await resp.json();
        if (data) {
          var rowData = Array.isArray(data) ? data[0] : data;
          if (typeof rowData === 'string') {
            try { rowData = JSON.parse(rowData); } catch(e) {}
          }
          var sess =`
);

content = content.replace(
  /var currUid = sess && sess\.user \? sess\.user\.id : data\.auth_uid;\s*match = syncStore\._mapRowToProfile\(data, currUid\);/g,
  `var currUid = sess && sess.user ? sess.user.id : rowData.auth_uid;
          match = syncStore._mapRowToProfile(rowData, currUid);`
);

fs.writeFileSync('play/index.html', content);
