// Netlify Function: Send Welcome / Account Protection Notice (COPPA / FERPA Compliant)
// Uses the exact same Resend dispatch flow and verified sender as request-recovery.js

const crypto = require('crypto');

function cleanSupabaseUrl(url) {
  if (!url) return 'https://tbibeuwpollcrlvowcpg.supabase.co';
  return url.trim().replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
}

const escapeHtml = (s) => {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
};

const recentWelcomeNotices = new Map();
const WELCOME_COOLDOWN_MS = 60 * 1000;

function sanitizeHeaderText(s) {
  return String(s || '').replace(/[\r\n\t]+/g, ' ').trim();
}

async function handleWelcomeNotice(body) {
  const email = (body && body.email ? String(body.email) : '').trim().toLowerCase();
  const playerId = (body && body.playerId ? String(body.playerId) : '').trim();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { status: 400, data: { ok: false, error: 'Invalid email address' } };
  }
  if (!playerId) {
    return { status: 400, data: { ok: false, error: 'Missing player ID' } };
  }

  const supabaseUrl = cleanSupabaseUrl(process.env.SUPABASE_URL);
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const resendApiKey = process.env.RESEND_API_KEY || process.env.Resendrecoveryapi;

  if (!serviceKey) {
    console.error('[send-welcome-notice] SUPABASE_SERVICE_ROLE_KEY is not configured');
    return { status: 500, data: { ok: false, error: 'Server configuration error' } };
  }

  // Verify against Supabase that this player_id exists and belongs to this exact email
  let profileRow = null;
  try {
    const queryUrl = `${supabaseUrl}/rest/v1/profiles?player_id=eq.${encodeURIComponent(playerId)}&select=player_id,handle,parent_email,birth_year`;
    const queryRes = await fetch(queryUrl, {
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`
      }
    });
    if (!queryRes.ok) {
      console.error('[send-welcome-notice] Supabase lookup failed:', queryRes.status);
      return { status: 502, data: { ok: false, error: 'Failed to verify profile record' } };
    }
    const rows = await queryRes.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      return { status: 404, data: { ok: false, error: 'Profile not found' } };
    }
    profileRow = rows[0];
  } catch (err) {
    console.error('[send-welcome-notice] Error querying profiles:', err);
    return { status: 502, data: { ok: false, error: 'Failed to verify profile record' } };
  }

  const dbEmail = (profileRow.parent_email || '').toLowerCase().trim();
  if (!dbEmail || dbEmail !== email) {
    return { status: 403, data: { ok: false, error: 'Email does not match profile record' } };
  }

  if (!resendApiKey) {
    console.error('[send-welcome-notice] RESEND_API_KEY is not configured');
    return { status: 500, data: { ok: false, sent: false, error: 'Email service not configured' } };
  }

  const handle = (profileRow.handle || 'Player').trim();
  const safeSubjectHandle = sanitizeHeaderText(handle) || 'Player';
  const cooldownKey = `${profileRow.player_id}:${email}`;
  const lastSentAt = recentWelcomeNotices.get(cooldownKey) || 0;
  if (Date.now() - lastSentAt < WELCOME_COOLDOWN_MS) {
    return { status: 200, data: { ok: true, sent: false, throttled: true } };
  }

  const birthYear = profileRow.birth_year || (body && body.birthYear) || null;
  const isUnder18 = birthYear
    ? (new Date().getFullYear() - Number(birthYear) < 18)
    : Boolean(body && body.isUnder18 === true);

  const siteOrigin = 'https://play.mapolis.app';
  const token = crypto.createHmac('sha256', serviceKey)
    .update(`${email}:${handle}:${profileRow.player_id}`)
    .digest('hex')
    .slice(0, 24);
  const privacyUrl = `${siteOrigin}/play/#compliance`;
  const deleteUrl = `${siteOrigin}/play/?action=parent-opt-out&handle=${encodeURIComponent(handle)}&email=${encodeURIComponent(email)}&pid=${encodeURIComponent(profileRow.player_id)}&token=${token}`;

  let subject = '';
  let html = '';
  let text = '';

  if (isUnder18) {
    // ── COPPA / FERPA Parent Welcome Notice ──
    subject = `Important Notice: Your child's Mapolis account (${safeSubjectHandle})`;
    text = `MAPOLIS PLAYER PRIVACY & PARENT NOTICE\n\n` +
      `Dear Parent or Guardian,\n\n` +
      `Your email was recently provided as the parent email for a Mapolis player profile:\n` +
      `• Username: ${handle}\n\n` +
      `OUR PRIVACY COMMITMENTS:\n` +
      `• Strict Data Minimization: We only store an anonymous username, birth year (for grade-appropriate map questions), country, and game scores.\n` +
      `• Zero Sensitive PII: We never collect real names, phone numbers, street addresses, or player location.\n` +
      `• No Open Messaging: Players cannot chat, send direct messages, or communicate with strangers.\n` +
      `• No Data Sharing: Mapolis never collects or shares behavioral data, never sells any user data including email addresses, or trains AI on gameplay data.\n\n` +
      `WHY YOUR EMAIL IS LINKED:\n` +
      `This address acts as a safety net, if your child ever forgets their username or password you can recover their account using this email address.\n\n` +
      `PARENTAL CONTROL & OPT-OUT:\n` +
      `If you did not authorize this account or would like this profile removed, you can request immediate account deletion here:\n` +
      `${deleteUrl}\n\n` +
      `Review our full Privacy & Safety Policy: ${privacyUrl}\n\n` +
      `Warm regards,\nThe Mapolis Team - mapolis.app`;

    html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background-color:#f8fafc;color:#1e293b;padding:24px 16px;margin:0;">
  <div style="max-width:580px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.05);">
    <div style="background:#060d2e;padding:24px;text-align:center;">
      <h1 style="color:#ffffff;font-size:24px;margin:0;letter-spacing:0.04em;">Mapolis</h1>
      <p style="color:#ffd700;font-size:12px;margin:4px 0 0;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;">Educational Geography Game</p>
    </div>
    
    <div style="padding:28px 24px;">
      <p style="font-size:16px;line-height:1.5;margin-top:0;"><strong>Dear Parent or Guardian,</strong></p>
      
      <p style="font-size:14px;line-height:1.6;color:#334155;">
        Your email was recently provided as the parent email for a Mapolis player profile:
      </p>

      <div style="background:#f1f5f9;border-left:4px solid #3b82f6;border-radius:8px;padding:12px 16px;margin:16px 0;">
        <div style="font-size:13px;color:#64748b;">Username:</div>
        <div style="font-size:18px;font-weight:800;color:#0f172a;margin-top:2px;">${escapeHtml(handle)}</div>
      </div>

      <h3 style="font-size:14px;color:#0f172a;margin:24px 0 8px;text-transform:uppercase;letter-spacing:0.05em;">Our Privacy Commitments:</h3>
      <ul style="font-size:13px;line-height:1.6;color:#475569;padding-left:20px;margin:0 0 20px;">
        <li><strong>Strict Data Minimization:</strong> We only store an anonymous username, birth year (to select grade-appropriate map cards), country, and game scores.</li>
        <li><strong>Zero Sensitive PII:</strong> We never collect real names, phone numbers, street addresses, or player location.</li>
        <li><strong>No Open Messaging:</strong> Players cannot chat, send direct messages, or communicate with strangers.</li>
        <li><strong>No Data Sharing:</strong> Mapolis never collects or shares behavioral data, never sells any user data including email addresses, or trains AI on gameplay data.</li>
      </ul>

      <p style="font-size:13px;line-height:1.6;color:#475569;">
        <strong>Why your email is linked:</strong> This address acts as a safety net, if your child ever forgets their username or password you can recover their account using this email address.
      </p>

      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:14px 16px;margin:24px 0;">
        <div style="font-size:12px;font-weight:700;color:#991b1b;margin-bottom:4px;">Parental Control &amp; Opt-Out</div>
        <div style="font-size:12px;color:#7f1d1d;line-height:1.5;">
          If you did not authorize this account or would like this profile removed, you can request immediate account deletion at any time:
        </div>
        <div style="margin-top:10px;">
          <a href="${deleteUrl}" style="display:inline-block;background:#dc2626;color:#ffffff;text-decoration:none;font-weight:700;font-size:12px;padding:8px 14px;border-radius:6px;">
            Delete Profile &amp; Data
          </a>
        </div>
      </div>

      <p style="font-size:12px;color:#94a3b8;margin:24px 0 0;line-height:1.5;">
        You can review our full <a href="${privacyUrl}" style="color:#2563eb;text-decoration:none;">Privacy &amp; Safety Policy</a> at any time.<br>
        Warm regards,<br>
        <strong>The Mapolis Team</strong>
      </p>
    </div>
  </div>
</body>
</html>
    `;
  } else {
    // ── Adult Recovery Email Confirmation ──
    subject = `Mapolis: Recovery email linked for ${safeSubjectHandle}`;
    text = `MAPOLIS ACCOUNT SECURITY\n\n` +
      `Hi ${handle},\n\n` +
      `You have successfully linked ${email} as the recovery email for your Mapolis account (${handle}).\n\n` +
      `YOUR SAFETY NET:\n` +
      `You do not need this email to play or sync on new devices—your username and password are all that's required. However, if you ever forget your password, you can now use this email address to regain access to your career rating, stars, and badges.\n\n` +
      `We never send marketing spam, never sell your contact info, and only use this email for account recovery.\n\n` +
      `Review our Privacy Policy: ${privacyUrl}\n\n` +
      `Happy exploring,\nThe Mapolis Team - mapolis.app`;

    html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background-color:#f8fafc;color:#1e293b;padding:24px 16px;margin:0;">
  <div style="max-width:580px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.05);">
    <div style="background:#060d2e;padding:24px;text-align:center;">
      <h1 style="color:#ffffff;font-size:24px;margin:0;letter-spacing:0.04em;">Mapolis</h1>
      <p style="color:#60a5fa;font-size:12px;margin:4px 0 0;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;">Account Security</p>
    </div>
    
    <div style="padding:28px 24px;">
      <p style="font-size:16px;line-height:1.5;margin-top:0;"><strong>Hi ${escapeHtml(handle)},</strong></p>
      
      <p style="font-size:14px;line-height:1.6;color:#334155;">
        You have successfully linked <strong>${escapeHtml(email)}</strong> as the recovery email for your Mapolis account:
      </p>

      <div style="background:#f1f5f9;border-left:4px solid #10b981;border-radius:8px;padding:12px 16px;margin:16px 0;">
        <div style="font-size:13px;color:#64748b;">Protected Profile:</div>
        <div style="font-size:18px;font-weight:800;color:#0f172a;margin-top:2px;">${escapeHtml(handle)}</div>
      </div>

      <p style="font-size:13px;line-height:1.6;color:#475569;">
        <strong>Your Safety Net:</strong> You do not need this email to play or sync on new devices—your username and password are all that's required. However, if you ever forget your password, you can now use this email address to regain access to your career rating, stars, and badges.
      </p>

      <p style="font-size:13px;line-height:1.6;color:#475569;">
        We never send marketing spam, never sell your contact info, and only use this email for account recovery.
      </p>

      <p style="font-size:12px;color:#94a3b8;margin:24px 0 0;line-height:1.5;">
        Review our <a href="${privacyUrl}" style="color:#2563eb;text-decoration:none;">Privacy Policy</a>.<br>
        Happy exploring,<br>
        <strong>The Mapolis Team</strong>
      </p>
    </div>
  </div>
</body>
</html>
    `;
  }

  try {
    const resendRes = await fetch('https://api.resend.com/emails', {
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

    if (!resendRes.ok) {
      const errText = await resendRes.text();
      console.error('[send-welcome-notice] Resend error:', errText);
      return { status: 200, data: { ok: true, sent: false, error: errText } };
    }

    const data = await resendRes.json();
    recentWelcomeNotices.set(cooldownKey, Date.now());
    console.log('[send-welcome-notice] Email dispatched successfully to', email, 'ID:', data.id);
    return { status: 200, data: { ok: true, sent: true, id: data.id } };
  } catch (err) {
    console.error('[send-welcome-notice] Exception sending via Resend:', err);
    return { status: 200, data: { ok: true, sent: false, error: err.message } };
  }
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

  const result = await handleWelcomeNotice(body);

  return {
    statusCode: result.status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify(result.data)
  };
};

exports.handleWelcomeNotice = handleWelcomeNotice;
exports._resetWelcomeCooldownForTest = () => recentWelcomeNotices.clear();
