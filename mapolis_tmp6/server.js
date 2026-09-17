const express = require('express');
const path = require('path');

const app = express();
const PORT = 3000;

// Serve static files from the root directory
app.use(express.static(__dirname));

// Redirect root to /play
app.get('/', (req, res) => {
  res.redirect('/play/');
});

// Expose environment variables to the client
app.get('/env.js', (req, res) => {
  res.type('application/javascript');
  res.send(`
    window.ENV = {
      SUPABASE_URL: ${JSON.stringify(process.env.SUPABASE_URL || '')},
      SUPABASE_ANON_KEY: ${JSON.stringify(process.env.SUPABASE_ANON_KEY || '')}
    };
  `);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://0.0.0.0:${PORT}`);
});
