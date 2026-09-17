const fs = require('fs');
let content = fs.readFileSync('play/index.html', 'utf8');

if (!content.includes('localStorage.clear()')) {
  content = content.replace('<script>', `<script>
  if (window.location.search.includes('clear_cache=1')) {
    localStorage.clear();
    sessionStorage.clear();
    window.location.href = window.location.pathname;
  }
`);
  fs.writeFileSync('play/index.html', content);
}
