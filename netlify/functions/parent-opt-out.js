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

function safeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

async function handleParentOptOut(body) {
  const email = (body && body.email ? String(body.email) : '').trim().toLowerCase();
  const playerId = (body && body.playerId ? String(body.playerId) : '').trim();
  const token = (body && body.token ? String(body.token) : '').trim();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !playerId || !token) {
    return { status: 400, data: { ok: false, error: 'Missing required verification parameters', deletedCount: 0 } };
  }

  const supabaseUrl = cleanSupabaseUrl(process.env.SUPABASE_URL);
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const resendApiKey = process.env.RESEND_API_KEY || process.env.Resendrecoveryapi;

  if (!serviceKey) {
    console.error('[parent-opt-out] SUPABASE_SERVICE_ROLE_KEY is not configured');
    return { status: 500, data: { ok: false, error: 'Server configuration error', deletedCount: 0 } };
  }

  // 1. Locate exact profile by player_id in Supabase
  let targetProfile = null;
  try {
    const queryUrl = `${supabaseUrl}/rest/v1/profiles?player_id=eq.${encodeURIComponent(playerId)}&select=player_id,handle,parent_email`;
    const queryRes = await fetch(queryUrl, {
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`
      }
    });

    if (!queryRes.ok) {
      console.error('[parent-opt-out] Supabase lookup failed:', queryRes.status);
      return { status: 502, data: { ok: false, error: 'Failed to verify profile record', deletedCount: 0 } };
    }

    const rows = await queryRes.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      return { status: 404, data: { ok: false, error: 'Profile not found', deletedCount: 0 } };
    }

    targetProfile = rows[0];
  } catch (e) {
    console.error('[parent-opt-out] Error querying profiles:', e);
    return { status: 502, data: { ok: false, error: 'Failed to verify profile record', deletedCount: 0 } };
  }

  // 2. Enforce BOTH exact parent_email match AND valid HMAC token
  const dbEmail = (targetProfile.parent_email || '').toLowerCase().trim();
  const dbHandle = (targetProfile.handle || '').trim();
  const expected = crypto.createHmac('sha256', serviceKey)
    .update(`${email}:${dbHandle}:${targetProfile.player_id}`)
    .digest('hex')
    .slice(0, 24);
  const tokenValid = safeEqualHex(token, expected);

  if (!tokenValid || !dbEmail || dbEmail !== email || targetProfile.player_id !== playerId) {
    return { status: 403, data: { ok: false, error: 'Invalid or expired verification token', deletedCount: 0 } };
  }

  // 3. Perform deletion for the verified profile
  let deletedCount = 0;
  try {
    const rpcRes = await fetch(`${supabaseUrl}/rest/v1/rpc/delete_profile`, {
      method: 'POST',
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ p_player_id: targetProfile.player_id })
    });

    const delRes = await fetch(`${supabaseUrl}/rest/v1/profiles?player_id=eq.${encodeURIComponent(targetProfile.player_id)}`, {
      method: 'DELETE',
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Prefer': 'return=representation'
      }
    });

    if (!rpcRes.ok && !delRes.ok) {
      console.error(`[parent-opt-out] Both RPC (${rpcRes.status}) and DELETE (${delRes.status}) failed`);
      return { status: 502, data: { ok: false, error: 'Failed to delete profile record', deletedCount: 0 } };
    }

    let directDeleted = false;
    if (delRes.ok) {
      const deletedRows = await delRes.json().catch(() => []);
      directDeleted = Array.isArray(deletedRows) && deletedRows.length > 0;
    }

    if (!rpcRes.ok && !directDeleted) {
      return { status: 404, data: { ok: false, error: 'Profile not found or already deleted', deletedCount: 0 } };
    }

    deletedCount = 1;
    console.log(`[parent-opt-out] Successfully deleted profile ${dbHandle} (${targetProfile.player_id})`);
  } catch (err) {
    console.error(`[parent-opt-out] Failed deleting profile ${targetProfile.player_id}:`, err);
    return { status: 502, data: { ok: false, error: 'Failed to delete profile record', deletedCount: 0 } };
  }

  // 4. Send confirmation email to verified parent ONLY after confirmed deletion
  const displayHandle = dbHandle || 'Player';
  const safeSubjectHandle = displayHandle.replace(/[\r\n\t]+/g, ' ').trim() || 'Player';
  if (resendApiKey && email && deletedCount > 0) {
    try {
      const subject = `Mapolis: Profile '${safeSubjectHandle}' has been deleted`;
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
        As requested, the Mapolis player profile <strong>${escapeHtml(displayHandle)}</strong> and all associated gameplay history have been permanently deleted from our database.
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
      const text = `MAPOLIS ACCOUNT DELETION CONFIRMATION\n\nDear Parent or Guardian,\n\nAs requested, the Mapolis player profile '${displayHandle}' and all associated gameplay history have been permanently deleted from our database.\n\nYour email address (${email}) has also been purged from this account record.\n\nWarm regards,\nThe Mapolis Team - mapolis.app`;

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

  const result = await handleParentOptOut(body);

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
