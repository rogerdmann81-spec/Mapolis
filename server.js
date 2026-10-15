const express = require('express');
const path = require('path');
const { handleRecovery } = require('./netlify/functions/request-recovery');

const app = express();
const PORT = 3000;

app.use(express.json());

// Specific app routes
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'play', 'admin', 'index.html'));
});
app.get('/admin/', (req, res) => {
  res.sendFile(path.join(__dirname, 'play', 'admin', 'index.html'));
});
app.get('/play', (req, res) => {
  res.sendFile(path.join(__dirname, 'play', 'index.html'));
});
app.get('/', (req, res) => {
  res.redirect('/play/');
});

// Automated Password Recovery Endpoint
const recoveryRoute = async (req, res) => {
  try {
    const origin = req.headers.origin || `${req.protocol}://${req.get('host')}`;
    const result = await handleRecovery(req.body, origin);
    res.status(result.status).json(result.data);
  } catch (err) {
    console.error('[server] Recovery route error:', err);
    res.status(200).json({ ok: true, message: 'Recovery link sent' });
  }
};

app.post('/api/request-recovery', recoveryRoute);
app.post('/.netlify/functions/request-recovery', recoveryRoute);

app.use(express.static(__dirname));

// Expose environment variables to the client
function cleanSupabaseUrl(url) {
  if (!url) return '';
  return url.trim().replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
}

const envHandler = (req, res) => {
  res.type('application/javascript');
  const rawUrl = process.env.SUPABASE_URL || 'https://tbibeuwpollcrlvowcpg.supabase.co';
  const cleanUrl = cleanSupabaseUrl(rawUrl);
  res.send(`
    window.ENV = {
      SUPABASE_URL: ${JSON.stringify(cleanUrl)},
      SUPABASE_ANON_KEY: ${JSON.stringify(process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRiaWJldXdwb2xsY3Jsdm93Y3BnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYxODg5MTUsImV4cCI6MjA5MTc2NDkxNX0.2fIzL1Fn0aKLwCfOjOMXXQV-3WtvbwY4YoanJJ-Vys8')}
    };
  `);
};

app.get('/env.js', envHandler);
app.get('/play/env.js', envHandler);
app.get('/admin/env.js', envHandler);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://0.0.0.0:${PORT}`);
});
