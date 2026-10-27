// Netlify Function: Send Welcome / Account Protection Notice (COPPA / FERPA Compliant)
const cleanSupabaseUrl = (url) => {
  if (!url) return 'https://tbibeuwpollcrlvowcpg.supabase.co';
  return url.trim().replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
};

const escapeHtml = (s) => {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      }
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const email = (body.email || '').trim().toLowerCase();
    const handle = (body.handle || 'Player').trim();
    const isUnder18 = body.isUnder18 === true || (body.birthYear && (new Date().getFullYear() - body.birthYear < 18));
    const origin = body.origin || 'https://play.mapolis.app';

    if (!email || !email.includes('@')) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: false, error: 'Invalid email address' })
      };
    }

    const resendApiKey = process.env.RESEND_API_KEY || process.env.Resendrecoveryapi;
    const privacyUrl = `${origin}/play/#compliance`;
    const deleteUrl = `${origin}/play/?action=parent-opt-out&handle=${encodeURIComponent(handle)}&email=${encodeURIComponent(email)}`;

    let subject = '';
    let htmlContent = '';

    if (isUnder18) {
      // ── COPPA / FERPA Parent Welcome Notice ──
      subject = `Important Notice: Your child's Mapolis account (${handle})`;
      htmlContent = `
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
        Your email was recently provided as the parent safety contact for a Mapolis player profile:
      </p>

      <div style="background:#f1f5f9;border-left:4px solid #3b82f6;border-radius:8px;padding:12px 16px;margin:16px 0;">
        <div style="font-size:13px;color:#64748b;">Username:</div>
        <div style="font-size:18px;font-weight:800;color:#0f172a;margin-top:2px;">${escapeHtml(handle)}</div>
      </div>

      <h3 style="font-size:14px;color:#0f172a;margin:24px 0 8px;text-transform:uppercase;letter-spacing:0.05em;">Our Student Privacy Commitments:</h3>
      <ul style="font-size:13px;line-height:1.6;color:#475569;padding-left:20px;margin:0 0 20px;">
        <li><strong>Strict Data Minimization:</strong> We only store an anonymous username, birth year (to select grade-appropriate map cards), country, and game scores.</li>
        <li><strong>Zero Sensitive PII:</strong> We never collect real names, phone numbers, street addresses, or precise GPS location.</li>
        <li><strong>No Open Messaging:</strong> Players cannot chat, send direct messages, or communicate with strangers.</li>
        <li><strong>No Ads or Tracking:</strong> Mapolis never shows third-party behavioral ads, sells student data, or trains AI models on gameplay.</li>
      </ul>

      <p style="font-size:13px;line-height:1.6;color:#475569;">
        <strong>Why your email is linked:</strong> This address acts purely as a safety net. If your child ever forgets their username or password, you can use our password reset tool to restore access to their stars and badges.
      </p>

      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:14px 16px;margin:24px 0;">
        <div style="font-size:12px;font-weight:700;color:#991b1b;margin-bottom:4px;">Parental Control & Opt-Out</div>
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
      subject = `Mapolis: Recovery email linked for ${handle}`;
      htmlContent = `
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
        We never send marketing emails, third-party ads, or share your address.
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

    // Send via Resend if API key is present
    if (resendApiKey) {
      try {
        const emailResp = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${resendApiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: 'Mapolis <safety@play.mapolis.app>',
            to: [email],
            subject: subject,
            html: htmlContent
          })
        });

        if (!emailResp.ok) {
          const errText = await emailResp.text();
          console.warn('[send-welcome-notice] Resend response not ok:', emailResp.status, errText);
        } else {
          console.log('[send-welcome-notice] Email sent successfully to:', email);
        }
      } catch (err) {
        console.warn('[send-welcome-notice] Resend dispatch exception:', err);
      }
    } else {
      console.log('[send-welcome-notice] No RESEND_API_KEY set; logged email dispatch for:', email);
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        ok: true,
        message: 'Welcome notice processed successfully',
        isUnder18: isUnder18
      })
    };
  } catch (err) {
    console.error('[send-welcome-notice] Uncaught error:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: 'Internal server error' })
    };
  }
};
