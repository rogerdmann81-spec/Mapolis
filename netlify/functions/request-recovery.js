const crypto = require('crypto');

function cleanSupabaseUrl(url) {
  if (!url) return 'https://tbibeuwpollcrlvowcpg.supabase.co';
  return url.trim().replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
}

function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function handleRecovery(body, origin) {
  const email = (body && body.email ? String(body.email) : '').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    return { status: 400, data: { ok: false, error: 'Invalid email address' } };
  }

  const supabaseUrl = cleanSupabaseUrl(process.env.SUPABASE_URL);
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const resendApiKey = process.env.RESEND_API_KEY || process.env.Resendrecoveryapi;

  // 1. Query matching profiles by lower(parent_email)
  const queryUrl = `${supabaseUrl}/rest/v1/profiles?parent_email=ilike.${encodeURIComponent(email)}&select=player_id,handle,birth_year,country`;
  let profRes;
  try {
    profRes = await fetch(queryUrl, {
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`
      }
    });
  } catch (err) {
    console.error('[request-recovery] Fetch profiles failed:', err);
    return { status: 200, data: { ok: true, message: 'Recovery link sent' } };
  }

  if (!profRes.ok) {
    console.error('[request-recovery] Supabase query failed:', await profRes.text());
    return { status: 200, data: { ok: true, message: 'Recovery link sent' } };
  }

  const profiles = await profRes.json();
  if (!Array.isArray(profiles) || profiles.length === 0) {
    return { status: 200, data: { ok: true, message: 'Recovery link sent' } };
  }

  let baseUrl = origin || 'https://play.mapolis.app';
  if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);
  if (!baseUrl.endsWith('/play')) {
    baseUrl += '/play';
  }

  // 2. Generate token for each profile and save to recovery_tokens table
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const accountCards = [];

  for (const prof of profiles) {
    const token = crypto.randomBytes(24).toString('hex');
    
    try {
      const insertRes = await fetch(`${supabaseUrl}/rest/v1/recovery_tokens`, {
        method: 'POST',
        headers: {
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({
          token: token,
          player_id: prof.player_id,
          email: email,
          expires_at: expiresAt,
          used: false
        })
      });

      if (!insertRes.ok) {
        console.error('[request-recovery] Token insert failed for', prof.handle, await insertRes.text());
        continue;
      }

      const resetUrl = `${baseUrl}/#recover?token=${token}`;
      accountCards.push({
        handle: prof.handle,
        resetUrl: resetUrl
      });
    } catch (err) {
      console.error('[request-recovery] Token insert exception:', err);
    }
  }

  if (accountCards.length === 0) {
    return { status: 200, data: { ok: true, message: 'Recovery link sent' } };
  }

  // 3. Format email with clear account distinction
  const accountRowsHtml = accountCards.map(acc => `
    <div style="background:#f1f5f9;border:1px solid #cbd5e1;border-radius:12px;padding:16px 20px;margin-bottom:14px;text-align:left;">
      <div style="font-size:16px;font-weight:700;color:#0f172a;margin-bottom:8px;">
        👤 Username: <span style="color:#2563eb;">${escapeHtml(acc.handle)}</span>
      </div>
      <div style="margin-top:10px;">
        <a href="${acc.resetUrl}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:10px 18px;border-radius:8px;">
          Set New Password for ${escapeHtml(acc.handle)} →
        </a>
      </div>
    </div>
  `).join('');

  const accountRowsText = accountCards.map(acc => `• Username: ${acc.handle}\n  Reset Link: ${acc.resetUrl}`).join('\n\n');

  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;margin:0;padding:24px;background:#f8fafc;color:#1e293b;">
      <div style="max-width:540px;margin:0 auto;background:#ffffff;border-radius:16px;border:1px solid #e2e8f0;padding:32px;box-shadow:0 4px 12px rgba(0,0,0,0.05);">
        <div style="text-align:center;margin-bottom:24px;">
          <h1 style="font-size:24px;color:#1e3a8a;margin:0 0 6px 0;letter-spacing:-0.5px;">Mapolis Account Recovery</h1>
          <p style="font-size:13px;color:#64748b;margin:0;">Credentials and password reset for your account(s)</p>
        </div>
        <p style="font-size:14px;line-height:1.5;color:#334155;">
          We received a request to recover login credentials for Mapolis. The following account${accountCards.length > 1 ? 's are' : ' is'} associated with this recovery email:
        </p>
        
        ${accountRowsHtml}

        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:12px 16px;margin:20px 0;font-size:12px;color:#1e40af;line-height:1.5;">
          ℹ️ <strong>Forgot your username?</strong> You can see your username listed above. If you already know your password, no reset is needed — just return to the app and sign in!<br><br>
          ⏱️ <strong>Security note:</strong> Reset links are single-use and expire in <strong>15 minutes</strong>. If you did not request this, you can safely ignore this email.
        </div>
        
        <div style="font-size:11px;color:#94a3b8;text-align:center;border-top:1px solid #e2e8f0;padding-top:16px;margin-top:24px;">
          Mapolis • Fast, fun geography mastery • <a href="https://mapolis.app" style="color:#64748b;">mapolis.app</a>
        </div>
      </div>
    </body>
    </html>
  `;

  const text = `MAPOLIS ACCOUNT RECOVERY\n\nWe received a request to recover login credentials for Mapolis.\nThe following account${accountCards.length > 1 ? 's are' : ' is'} linked to this recovery email:\n\n${accountRowsText}\n\nSecurity: Reset links expire in 15 minutes.\nIf you only needed to recall your username, no password reset is required!\n\nMapolis - mapolis.app`;

  try {
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Mapolis Support <support@mapolis.app>',
        to: [email],
        bcc: ['support@mapolis.app'],
        subject: `Mapolis Account Recovery (${accountCards.length} account${accountCards.length > 1 ? 's' : ''})`,
        html: html,
        text: text
      })
    });
    if (!resendRes.ok) {
      console.error('[request-recovery] Resend error:', await resendRes.text());
    } else {
      console.log('[request-recovery] Email dispatched successfully to', email);
    }
  } catch (err) {
    console.error('[request-recovery] Error sending via Resend:', err);
  }

  return { status: 200, data: { ok: true, message: 'Recovery link sent' } };
}

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: ''
    };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    body = {};
  }
  const headers = event.headers || {};
  const origin = headers.origin || (headers.host ? `https://${headers.host}` : 'https://play.mapolis.app');
  const result = await handleRecovery(body, origin);
  return {
    statusCode: result.status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify(result.data)
  };
};

exports.handleRecovery = handleRecovery;
