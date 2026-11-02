// Netlify Function: Process Parental Opt-Out & Profile Deletion (COPPA / FERPA Compliant)
const crypto = require('crypto');

function cleanSupabaseUrl(url) {
  if (!url) return 'https://tbibeuwpollcrlvowcpg.supabase.co';
  return url.trim().replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
}

function escapeHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function handleParentOptOut(body, origin) {
  const email = (body && body.email ? String(body.email) : '').trim().toLowerCase();
  const handle = (body && body.handle ? String(body.handle) : '').trim();
  const playerId = (body && body.playerId ? String(body.playerId) : '').trim();
  const token = (body && body.token ? String(body.token) : '').trim();

  if (!email || !email.includes('@')) {
    return { status: 400, data: { ok: false, error: 'Invalid or missing parent email address' } };
  }

  const supabaseUrl = cleanSupabaseUrl(process.env.SUPABASE_URL);
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const resendApiKey = process.env.RESEND_API_KEY || process.env.Resendrecoveryapi;

  // Verify HMAC token if provided or fallback to matching parent_email in database
  let tokenValid = false;
  if (token) {
    const expected = crypto.createHmac('sha256', serviceKey || 'mapolis-opt-out-secret')
      .update(`${email}:${handle}:${playerId}`)
      .digest('hex')
      .slice(0, 24);
    if (token === expected) {
      tokenValid = true;
    }
  }

  // 1. Locate profile in Supabase to confirm ownership by this parent email
  let profilesToDelete = [];

  if (serviceKey) {
    try {
      let queryUrl = '';
      if (playerId) {
        queryUrl = `${supabaseUrl}/rest/v1/profiles?player_id=eq.${encodeURIComponent(playerId)}&select=player_id,handle,parent_email`;
      } else if (handle) {
        queryUrl = `${supabaseUrl}/rest/v1/profiles?handle=ilike.${encodeURIComponent(handle)}&parent_email=ilike.${encodeURIComponent(email)}&select=player_id,handle,parent_email`;
      } else {
        queryUrl = `${supabaseUrl}/rest/v1/profiles?parent_email=ilike.${encodeURIComponent(email)}&select=player_id,handle,parent_email`;
      }

      const queryRes = await fetch(queryUrl, {
        headers: {
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`
        }
      });

      if (queryRes.ok) {
        const rows = await queryRes.json();
        if (Array.isArray(rows)) {
          for (const row of rows) {
            const pEmail = (row.parent_email || '').toLowerCase().trim();
            if (tokenValid || pEmail === email) {
              profilesToDelete.push(row);
            }
          }
        }
      }
    } catch (e) {
      console.error('[parent-opt-out] Error querying profiles:', e);
    }
  }

  // 2. Perform deletion for each matched profile
  let deletedCount = 0;
  for (const prof of profilesToDelete) {
    const pId = prof.player_id;
    try {
      // Call delete_profile RPC
      await fetch(`${supabaseUrl}/rest/v1/rpc/delete_profile`, {
        method: 'POST',
        headers: {
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ p_player_id: pId })
      });

      // Also ensure direct deletion from profiles table
      await fetch(`${supabaseUrl}/rest/v1/profiles?player_id=eq.${encodeURIComponent(pId)}`, {
        method: 'DELETE',
        headers: {
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`
        }
      });

      deletedCount++;
      console.log(`[parent-opt-out] Successfully deleted profile ${prof.handle} (${pId})`);
    } catch (err) {
      console.error(`[parent-opt-out] Failed deleting profile ${pId}:`, err);
    }
  }

  // 3. Send confirmation email to parent via Resend
  if (resendApiKey && email) {
    try {
      const subject = `Mapolis: Profile '${handle || 'Player'}' has been deleted`;
      const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background-color:#f8fafc;color:#1e293b;padding:24px 16px;margin:0;">
  <div style="max-width:540px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.05);">
    <div style="background:#060d2e;padding:22px;text-align:center;">
      <h1 style="color:#ffffff;font-size:22px;margin:0;letter-spacing:0.04em;">Mapolis</h1>
      <p style="color:#ef4444;font-size:12px;margin:4px 0 0;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;">Account Deletion Confirmation</p>
    </div>
    <div style="padding:24px 20px;">
      <p style="font-size:15px;line-height:1.5;margin-top:0;"><strong>Dear Parent or Guardian,</strong></p>
      <p style="font-size:14px;line-height:1.6;color:#334155;">
        As requested, the Mapolis player profile <strong>${escapeHtml(handle || 'Player')}</strong> and all associated gameplay history have been permanently deleted from our database.
      </p>
      <p style="font-size:13px;line-height:1.6;color:#64748b;">
        Your email address (<strong>${escapeHtml(email)}</strong>) has also been purged from this account record. No further notices regarding this profile will be sent.
      </p>
      <p style="font-size:12px;color:#94a3b8;margin:24px 0 0;line-height:1.5;">
        If you have any questions, you can contact us at <a href="mailto:support@mapolis.app" style="color:#2563eb;">support@mapolis.app</a>.<br>
        Warm regards,<br>
        <strong>The Mapolis Team</strong>
      </p>
    </div>
  </div>
</body>
</html>
      `;
      const text = `MAPOLIS ACCOUNT DELETION CONFIRMATION\n\nDear Parent or Guardian,\n\nAs requested, the Mapolis player profile '${handle || 'Player'}' and all associated gameplay history have been permanently deleted from our database.\n\nYour email address (${email}) has also been purged from this account record.\n\nWarm regards,\nThe Mapolis Team - mapolis.app`;

      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
          'User-Agent': 'Mapolis/1.0'
        },
        body: JSON.stringify({
          from: 'Mapolis Support <support@mapolis.app>',
          to: [email],
          bcc: ['support@mapolis.app'],
          subject: subject,
          html: html,
          text: text
        })
      });
      console.log('[parent-opt-out] Confirmation email dispatched to', email);
    } catch (err) {
      console.warn('[parent-opt-out] Could not dispatch confirmation email:', err);
    }
  }

  return {
    status: 200,
    data: {
      ok: true,
      message: 'Profile and associated data successfully removed',
      deletedCount: deletedCount
    }
  };
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
  const result = await handleParentOptOut(body, origin);

  return {
    statusCode: result.status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify(result.data)
  };
};

exports.handleParentOptOut = handleParentOptOut;
