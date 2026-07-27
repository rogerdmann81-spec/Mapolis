const fs = require('fs');
const path = require('path');

const envContent = `
  window.ENV = {
    SUPABASE_URL: ${JSON.stringify(process.env.SUPABASE_URL || 'https://tbibeuwpollcrlvowcpg.supabase.co')},
    SUPABASE_ANON_KEY: ${JSON.stringify(process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRiaWJldXdwb2xsY3Jsdm93Y3BnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYxODg5MTUsImV4cCI6MjA5MTc2NDkxNX0.2fIzL1Fn0aKLwCfOjOMXXQV-3WtvbwY4YoanJJ-Vys8')}
  };
`;

// Write env.js to both root and play folder
fs.writeFileSync(path.join(__dirname, 'env.js'), envContent);
fs.writeFileSync(path.join(__dirname, 'play', 'env.js'), envContent);
console.log('Generated env.js for static deployment.');
