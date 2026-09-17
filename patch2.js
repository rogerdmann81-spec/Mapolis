const fs = require('fs');
let content = fs.readFileSync('play/index.html', 'utf8');

// Fix existingIdx in restore_profile_by_email
content = content.replace(
  /const data = await resp\.json\(\);\s*if \(data\) \{\s*var sessEmail/g,
  `const data = await resp.json();
        if (data) {
          var rowData = Array.isArray(data) ? data[0] : data;
          if (typeof rowData === 'string') {
            try { rowData = JSON.parse(rowData); } catch(e) {}
          }
          var sessEmail`
);

content = content.replace(
  /var currUidEmail = sessEmail && sessEmail\.user \? sessEmail\.user\.id : data\.auth_uid;\s*match = syncStore\._mapRowToProfile\(data, currUidEmail\);\s*if \(existingIdx >= 0\)/g,
  `var currUidEmail = sessEmail && sessEmail.user ? sessEmail.user.id : rowData.auth_uid;
          match = syncStore._mapRowToProfile(rowData, currUidEmail);
          var existingIdx = allProfiles.findIndex(p => p.id === match.id);
          if (existingIdx >= 0)`
);

fs.writeFileSync('play/index.html', content);
