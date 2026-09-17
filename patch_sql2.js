const fs = require('fs');
let content = fs.readFileSync('docs/supabase_schema.sql', 'utf8');

if (!content.includes('badges JSONB')) {
  content = content.replace(
    /stats JSONB DEFAULT '\{"cr":0,"totalAnswered":0,"totalCorrect":0\}'::jsonb,/,
    `stats JSONB DEFAULT '{"cr":0,"totalAnswered":0,"totalCorrect":0}'::jsonb,\n    badges JSONB DEFAULT '[]'::jsonb,\n    accessories JSONB DEFAULT '[]'::jsonb,`
  );
  fs.writeFileSync('docs/supabase_schema.sql', content);
  console.log("Patched supabase_schema.sql");
} else {
  console.log("Already patched");
}
