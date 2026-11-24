// Netlify Function: FTC COPPA (April 2026) "Email Plus" Parental Consent Flow
// Handles three actions via POST /api/parent-consent:
//   1. action: "request" -> Sends Email #1 (Direct Notice + 72-hour HMAC-signed approval link).
//                           Zero unconsented child data is written to Supabase.
//   2. action: "confirm" -> Verifies 72-hour signed token + explicit parent checkbox, creates/updates
//                           the consented profile in Supabase, and sends Email #2 (Confirmatory "Plus"
//                           email with a 90-day one-click Revoke & Delete link).
//   3. action: "status"  -> Cross-device check returning { ok: true, approved: boolean } when both
//                           playerId and parent email match a verified profile (no PII disclosed).

const crypto = require('crypto');
const { buildOptOutToken } = require('./send-welcome-notice');
const compliance = require('../../assets/compliance-helpers');

const CONSENT_TOKEN_TTL_SEC = compliance.CONSENT_TOKEN_TTL_SEC; // 72 hours
const MAX_CONSENT_TTL_SEC = CONSENT_TOKEN_TTL_SEC + 300;        // +5m clock skew buffer
const REQUEST_COOLDOWN_MS = 60 * 1000;
const CANONICAL_PLAY_ORIGIN = 'https://play.mapolis.app';

const recentConsentRequests = new Map();
const recentConfirmEmails = new Map();

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

function sanitizeHeaderText(s) {
  return String(s || '').replace(/[\r\n\t]+/g, ' ').trim();
}

function isValidEmail(email) {
  return typeof email === 'string' && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidPlayerId(pid) {
  return typeof pid === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pid);
}

function safeEqualString(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

function getSigningSecret() {
  return process.env.CONSENT_SIGNING_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
}

function buildConsentToken(secret, payload, nowMs = Date.now()) {
  if (!secret) throw new Error('Missing signing secret');
  const expSec = Math.floor(nowMs / 1000) + CONSENT_TOKEN_TTL_SEC;
  const body = {
    v: 1,
    pid: String(payload.playerId || '').trim(),
    h: String(payload.handle || '').trim().slice(0, 32),
    e: String(payload.email || '').trim().toLowerCase(),
    by: Number.isInteger(Number(payload.birthYear)) ? Number(payload.birthYear) : null,
    co: String(payload.country || '').trim().slice(0, 80),
    exp: expSec,
    n: crypto.randomBytes(8).toString('hex')
  };
  const payloadB64 = Buffer.from(JSON.stringify(body), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', secret)
    .update(`coppa-consent-v1:${payloadB64}`)
    .digest('base64url');
  return `${payloadB64}.${sig}`;
}

function verifyConsentToken(token, secret, nowMs = Date.now()) {
  if (typeof token !== 'string' || !secret) {
    return { valid: false, reason: 'invalid' };
  }
  const parts = token.trim().split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { valid: false, reason: 'invalid' };
  }
  const [payloadB64, providedSig] = parts;
  if (!/^[A-Za-z0-9_-]+$/.test(payloadB64) || !/^[A-Za-z0-9_-]+$/.test(providedSig)) {
    return { valid: false, reason: 'invalid' };
  }

  const expectedSig = crypto.createHmac('sha256', secret)
    .update(`coppa-consent-v1:${payloadB64}`)
    .digest('base64url');

  if (!safeEqualString(providedSig, expectedSig)) {
    return { valid: false, reason: 'invalid' };
  }

  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch (_) {
    return { valid: false, reason: 'invalid' };
  }

  if (!parsed || parsed.v !== 1 || !isValidPlayerId(parsed.pid) || !isValidEmail(parsed.e) || !parsed.h) {
    return { valid: false, reason: 'invalid' };
  }

  const nowSec = Math.floor(nowMs / 1000);
  const expSec = Number(parsed.exp);
  if (!Number.isFinite(expSec) || expSec <= nowSec) {
    return { valid: false, reason: 'expired', payload: parsed };
  }
  if (expSec > nowSec + MAX_CONSENT_TTL_SEC) {
    return { valid: false, reason: 'invalid' };
  }

  return {
    valid: true,
    payload: {
      playerId: parsed.pid,
      handle: parsed.h,
      email: parsed.e,
      birthYear: parsed.by,
      country: parsed.co || '',
      exp: expSec
    }
  };
}

function buildRetentionHtmlList() {
  return compliance.RETENTION_POLICY.summaryBullets
    .map(b => `<li>${escapeHtml(b)}</li>`)
    .join('\n        ');
}

function buildRetentionPlainList() {
  return compliance.RETENTION_POLICY.summaryBullets
    .map(b => `• ${b}`)
    .join('\n');
}

async function sendResendEmail(resendApiKey, { to, subject, html, text }) {
  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
      'User-Agent': 'Mapolis/1.0'
    },
    body: JSON.stringify({
      from: 'Mapolis Support <support@mapolis.app>',
      to: [to],
      bcc: ['support@mapolis.app'],
      subject,
      html,
      text
    })
  });
  if (!resendRes.ok) {
    const errText = await resendRes.text();
    throw new Error(`Resend HTTP ${resendRes.status}: ${errText}`);
  }
  return await resendRes.json();
}

async function handleRequestParentConsent(body) {
  const email = (body && body.email ? String(body.email) : '').trim().toLowerCase();
  const playerId = (body && body.playerId ? String(body.playerId) : '').trim();
  const handle = (body && body.handle ? String(body.handle) : '').trim().slice(0, 32);
  const country = (body && body.country ? String(body.country) : '').trim().slice(0, 80);
  const birthYear = body && body.birthYear !== undefined ? Number(body.birthYear) : null;

  if (!isValidEmail(email)) {
    return { status: 400, data: { ok: false, error: 'Please enter a valid parent email address' } };
  }
  if (!isValidPlayerId(playerId) || !handle || handle.length < 2) {
    return { status: 400, data: { ok: false, error: 'Missing required profile details' } };
  }
  const currentYear = new Date().getFullYear();
  if (!Number.isInteger(birthYear) || birthYear < 1900 || birthYear > currentYear) {
    return { status: 400, data: { ok: false, error: 'Invalid birth year' } };
  }

  const secret = getSigningSecret();
  const resendApiKey = process.env.RESEND_API_KEY || process.env.Resendrecoveryapi;
  if (!secret) {
    console.error('[parent-consent] Signing secret is not configured');
    return { status: 500, data: { ok: false, error: 'Server configuration error' } };
  }
  if (!resendApiKey) {
    console.error('[parent-consent] RESEND_API_KEY is not configured');
    return { status: 500, data: { ok: false, sent: false, error: 'Email service not configured' } };
  }

  const cooldownKey = `${playerId}:${email}`;
  const lastSent = recentConsentRequests.get(cooldownKey) || 0;
  if (Date.now() - lastSent < REQUEST_COOLDOWN_MS) {
    return { status: 200, data: { ok: true, sent: false, throttled: true, expiresInHours: 72 } };
  }

  const token = buildConsentToken(secret, { playerId, handle, email, birthYear, country });
  const approveUrl = `${CANONICAL_PLAY_ORIGIN}/play/?action=parent-consent&token=${encodeURIComponent(token)}`;
  const privacyUrl = `${CANONICAL_PLAY_ORIGIN}/play/#compliance`;
  const safeSubjectHandle = sanitizeHeaderText(handle) || 'Player';

  const subject = `Action Required: Approve Mapolis cloud sync for ${safeSubjectHandle} (expires in 72 hours)`;
  const text =
    `MAPOLIS PARENTAL CONSENT REQUEST (FTC COPPA NOTICE)\n\n` +
    `Dear Parent or Guardian,\n\n` +
    `A child using Mapolis created a profile ("${handle}") and entered your email address to enable optional Cloud Sync, cross-device account recovery, Friends, and Head-to-Head play.\n\n` +
    `NO DATA HAS BEEN STORED IN OUR CLOUD DATABASE YET.\n` +
    `Until you approve below, the profile stays strictly local on your child's device. If you do not approve within 72 hours, this request automatically expires and no record is kept.\n\n` +
    `WHAT WE STORE IF YOU APPROVE:\n` +
    `• Anonymous username (${handle}), birth year (for grade-appropriate geography questions), home country, gameplay scores/badges, and your parent email for recovery & parental control.\n` +
    `• Zero real names, zero photos, zero GPS/location tracking, zero open chat or messaging, zero behavioral advertising, and zero third-party data sharing.\n` +
    `• External links and developer feedback forms are disabled for all profiles under 14.\n\n` +
    `WRITTEN DATA RETENTION & DELETION SCHEDULE:\n` +
    `${buildRetentionPlainList()}\n\n` +
    `APPROVE CLOUD SYNC (valid for 72 hours):\n` +
    `${approveUrl}\n\n` +
    `After you approve, we will send a second confirmation email with a one-click link allowing you to revoke consent and permanently delete the profile at any time.\n\n` +
    `Review our full Privacy & Safety Policy: ${privacyUrl}\n\n` +
    `Warm regards,\nThe Mapolis Team - mapolis.app`;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background-color:#f8fafc;color:#1e293b;padding:24px 16px;margin:0;">
  <div style="max-width:580px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.05);">
    <div style="background:#060d2e;padding:24px;text-align:center;">
      <h1 style="color:#ffffff;font-size:24px;margin:0;letter-spacing:0.04em;">Mapolis</h1>
      <p style="color:#ffd700;font-size:12px;margin:4px 0 0;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;">Parental Consent Request</p>
    </div>

    <div style="padding:28px 24px;">
      <p style="font-size:16px;line-height:1.5;margin-top:0;"><strong>Dear Parent or Guardian,</strong></p>
      <p style="font-size:14px;line-height:1.6;color:#334155;">
        Your email address was entered to enable optional <strong>Cloud Sync, account recovery, and Head-to-Head play</strong> for a child's Mapolis profile:
      </p>

      <div style="background:#f1f5f9;border-left:4px solid #3b82f6;border-radius:8px;padding:12px 16px;margin:16px 0;">
        <div style="font-size:12px;color:#64748b;">Requested Profile Username:</div>
        <div style="font-size:18px;font-weight:800;color:#0f172a;margin-top:2px;">${escapeHtml(handle)}</div>
      </div>

      <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:12px 16px;margin:16px 0;font-size:13px;color:#1e40af;line-height:1.55;">
        <strong>No child data is stored on our servers yet.</strong> Until you click Approve below, this profile remains strictly local on the device. If you do nothing, this link expires in <strong>72 hours</strong> and nothing is saved.
      </div>

      <div style="text-align:center;margin:22px 0;">
        <a href="${approveUrl}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:800;font-size:15px;padding:13px 24px;border-radius:10px;">
          Review &amp; Approve Cloud Sync →
        </a>
        <div style="font-size:11px;color:#64748b;margin-top:8px;">Link expires in 72 hours. You will receive a follow-up confirmation email with a one-click deletion button.</div>
      </div>

      <h3 style="font-size:13px;color:#0f172a;margin:22px 0 8px;text-transform:uppercase;letter-spacing:0.05em;">What Mapolis Stores (If Approved):</h3>
      <ul style="font-size:13px;line-height:1.6;color:#475569;padding-left:20px;margin:0 0 18px;">
        <li><strong>Minimal Data Only:</strong> Anonymous username, birth year (for grade-appropriate questions), home country, gameplay stats/badges, and your parent email for recovery &amp; parental control.</li>
        <li><strong>Zero Sensitive PII or Chat:</strong> No real names, photos, location tracking, open chat, direct messaging, or behavioral ads. External links &amp; dev notes are disabled for all players under 14.</li>
        <li><strong>Zero Third-Party Sharing:</strong> We never sell or share children's data with third parties and never train AI on gameplay data.</li>
      </ul>

      <h3 style="font-size:13px;color:#0f172a;margin:20px 0 8px;text-transform:uppercase;letter-spacing:0.05em;">Data Retention &amp; Deletion Schedule:</h3>
      <ul style="font-size:12.5px;line-height:1.6;color:#475569;padding-left:20px;margin:0 0 18px;">
        ${buildRetentionHtmlList()}
      </ul>

      <p style="font-size:12px;color:#94a3b8;margin:22px 0 0;line-height:1.5;">
        Didn't expect this email? You can safely ignore it — no cloud account will be created.<br>
        Review our full <a href="${privacyUrl}" style="color:#2563eb;text-decoration:none;">Privacy &amp; Safety Policy</a> at any time.<br>
        Warm regards,<br>
        <strong>The Mapolis Team</strong>
      </p>
    </div>
  </div>
</body>
</html>
  `;

  try {
    const sent = await sendResendEmail(resendApiKey, { to: email, subject, html, text });
    recentConsentRequests.set(cooldownKey, Date.now());
    console.log('[parent-consent] Consent request email sent to', email, 'ID:', sent.id);
    return { status: 200, data: { ok: true, sent: true, id: sent.id, expiresInHours: 72 } };
  } catch (err) {
    console.error('[parent-consent] Failed to send consent email:', err);
    return { status: 502, data: { ok: false, sent: false, error: 'Failed to dispatch parental consent email' } };
  }
}

async function handleConfirmParentConsent(body) {
  const token = (body && body.token ? String(body.token) : '').trim();
  const confirmed = Boolean(body && body.confirmed === true);

  if (!token) {
    return { status: 400, data: { ok: false, error: 'Missing consent verification token' } };
  }
  if (!confirmed) {
    return { status: 400, data: { ok: false, error: 'Please confirm that you are the parent or legal guardian' } };
  }

  const secret = getSigningSecret();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = cleanSupabaseUrl(process.env.SUPABASE_URL);
  const resendApiKey = process.env.RESEND_API_KEY || process.env.Resendrecoveryapi;

  if (!secret || !serviceKey) {
    return { status: 500, data: { ok: false, error: 'Server configuration error' } };
  }

  const verification = verifyConsentToken(token, secret);
  if (!verification.valid) {
    const errMsg = verification.reason === 'expired'
      ? 'This 72-hour parental approval link has expired. No cloud data was stored — your child can request a fresh link from their Profile.'
      : 'This parental approval link is invalid.';
    return { status: 403, data: { ok: false, reason: verification.reason, error: errMsg } };
  }

  const { playerId, handle, email, birthYear, country } = verification.payload;
  const verifiedAt = new Date().toISOString();

  // Inspect existing profile row if any (for idempotency and ownership safety)
  let existingRow = null;
  try {
    const qUrl = `${supabaseUrl}/rest/v1/profiles?player_id=eq.${encodeURIComponent(playerId)}&select=player_id,handle,parent_email,stats`;
    const qRes = await fetch(qUrl, {
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`
      }
    });
    if (qRes.ok) {
      const rows = await qRes.json();
      if (Array.isArray(rows) && rows.length > 0) existingRow = rows[0];
    }
  } catch (err) {
    console.error('[parent-consent] Profile lookup error:', err);
    return { status: 502, data: { ok: false, error: 'Unable to verify cloud record right now' } };
  }

  const alreadyVerified = Boolean(
    existingRow &&
    (existingRow.parent_email || '').trim().toLowerCase() === email &&
    existingRow.stats &&
    existingRow.stats.parentConsentStatus === 'verified'
  );

  // Create or update consented profile in Supabase
  try {
    const mergedStats = Object.assign({}, (existingRow && existingRow.stats) || {}, {
      parentConsentStatus: 'verified',
      parentConsentMethod: 'email_plus',
      parentConsentVerifiedAt: (existingRow && existingRow.stats && existingRow.stats.parentConsentVerifiedAt) || verifiedAt
    });

    if (existingRow) {
      const patchRes = await fetch(`${supabaseUrl}/rest/v1/profiles?player_id=eq.${encodeURIComponent(playerId)}`, {
        method: 'PATCH',
        headers: {
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({
          parent_email: email,
          stats: mergedStats,
          updated_at: verifiedAt
        })
      });
      if (!patchRes.ok) {
        const errText = await patchRes.text();
        console.error('[parent-consent] Profile PATCH failed:', patchRes.status, errText);
        return { status: 502, data: { ok: false, error: 'Failed to activate cloud sync' } };
      }
    } else {
      const insertRes = await fetch(`${supabaseUrl}/rest/v1/profiles`, {
        method: 'POST',
        headers: {
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({
          player_id: playerId,
          handle: handle,
          birth_year: birthYear,
          country: country || null,
          parent_email: email,
          stats: mergedStats,
          cr: 0,
          badges: [],
          accessories: [],
          created_at: verifiedAt,
          updated_at: verifiedAt
        })
      });
      if (!insertRes.ok) {
        const errText = await insertRes.text();
        console.error('[parent-consent] Profile INSERT failed:', insertRes.status, errText);
        return { status: 502, data: { ok: false, error: 'Failed to activate cloud sync for this profile' } };
      }
    }
  } catch (err) {
    console.error('[parent-consent] Profile persist exception:', err);
    return { status: 502, data: { ok: false, error: 'Failed to activate cloud sync' } };
  }

  // FTC "Email Plus" Step 2: Send confirmatory follow-up email with one-click Revoke & Delete link
  const confirmKey = `${playerId}:${email}`;
  const lastConfirm = recentConfirmEmails.get(confirmKey) || 0;
  let confirmationSent = false;

  if (resendApiKey && !alreadyVerified && (Date.now() - lastConfirm >= REQUEST_COOLDOWN_MS)) {
    const optOutToken = buildOptOutToken(serviceKey, email, handle, playerId);
    const deleteUrl = `${CANONICAL_PLAY_ORIGIN}/play/?action=parent-opt-out&handle=${encodeURIComponent(handle)}&email=${encodeURIComponent(email)}&pid=${encodeURIComponent(playerId)}&token=${encodeURIComponent(optOutToken)}`;
    const privacyUrl = `${CANONICAL_PLAY_ORIGIN}/play/#compliance`;
    const safeSubjectHandle = sanitizeHeaderText(handle) || 'Player';

    const subject = `Confirmed: Parental consent active for ${safeSubjectHandle} on Mapolis`;
    const text =
      `MAPOLIS PARENTAL CONSENT CONFIRMATION (EMAIL PLUS)\n\n` +
      `Dear Parent or Guardian,\n\n` +
      `This confirmatory notice verifies that parental consent was approved for the Mapolis profile "${handle}", activating Cloud Sync and account recovery.\n\n` +
      `DATA RETENTION & DELETION SCHEDULE:\n` +
      `${buildRetentionPlainList()}\n\n` +
      `REVOKE CONSENT & DELETE PROFILE AT ANY TIME:\n` +
      `If you did not authorize this approval or ever wish to revoke consent and immediately delete all cloud data for "${handle}", click here:\n` +
      `${deleteUrl}\n\n` +
      `Privacy & Safety Policy: ${privacyUrl}\n\n` +
      `Warm regards,\nThe Mapolis Team - mapolis.app`;

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background-color:#f8fafc;color:#1e293b;padding:24px 16px;margin:0;">
  <div style="max-width:580px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.05);">
    <div style="background:#060d2e;padding:24px;text-align:center;">
      <h1 style="color:#ffffff;font-size:24px;margin:0;letter-spacing:0.04em;">Mapolis</h1>
      <p style="color:#4ade80;font-size:12px;margin:4px 0 0;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;">Parental Consent Confirmed</p>
    </div>

    <div style="padding:28px 24px;">
      <p style="font-size:16px;line-height:1.5;margin-top:0;"><strong>Dear Parent or Guardian,</strong></p>
      <p style="font-size:14px;line-height:1.6;color:#334155;">
        This follow-up notice confirms that parental consent is now active for the Mapolis profile <strong>${escapeHtml(handle)}</strong>. Cloud Sync, cross-device recovery, Friends, and Head-to-Head play are now enabled.
      </p>

      <h3 style="font-size:13px;color:#0f172a;margin:20px 0 8px;text-transform:uppercase;letter-spacing:0.05em;">Data Retention &amp; Deletion Schedule:</h3>
      <ul style="font-size:12.5px;line-height:1.6;color:#475569;padding-left:20px;margin:0 0 20px;">
        ${buildRetentionHtmlList()}
      </ul>

      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:14px 16px;margin:22px 0;">
        <div style="font-size:12px;font-weight:700;color:#991b1b;margin-bottom:4px;">Revoke Consent &amp; Delete Profile</div>
        <div style="font-size:12px;color:#7f1d1d;line-height:1.5;">
          If you did not approve this request—or if you ever want to revoke consent and permanently erase this profile—click below at any time:
        </div>
        <div style="margin-top:10px;">
          <a href="${deleteUrl}" style="display:inline-block;background:#dc2626;color:#ffffff;text-decoration:none;font-weight:700;font-size:12px;padding:8px 14px;border-radius:6px;">
            Revoke Consent &amp; Delete Data
          </a>
        </div>
      </div>

      <p style="font-size:12px;color:#94a3b8;margin:22px 0 0;line-height:1.5;">
        Review our <a href="${privacyUrl}" style="color:#2563eb;text-decoration:none;">Privacy &amp; Safety Policy</a> · Questions? Contact <a href="mailto:support@mapolis.app" style="color:#2563eb;text-decoration:none;">support@mapolis.app</a>.<br>
        Warm regards,<br>
        <strong>The Mapolis Team</strong>
      </p>
    </div>
  </div>
</body>
</html>
    `;

    try {
      await sendResendEmail(resendApiKey, { to: email, subject, html, text });
      recentConfirmEmails.set(confirmKey, Date.now());
      confirmationSent = true;
    } catch (err) {
      console.warn('[parent-consent] Confirmatory Email Plus dispatch failed:', err);
    }
  }

  return {
    status: 200,
    data: {
      ok: true,
      approved: true,
      playerId,
      handle,
      email,
      verifiedAt,
      confirmationSent
    }
  };
}

async function handleCheckConsentStatus(body) {
  const playerId = (body && body.playerId ? String(body.playerId) : '').trim();
  const email = (body && body.email ? String(body.email) : '').trim().toLowerCase();

  if (!isValidPlayerId(playerId) || !isValidEmail(email)) {
    return { status: 400, data: { ok: false, approved: false, error: 'Invalid status check parameters' } };
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = cleanSupabaseUrl(process.env.SUPABASE_URL);
  if (!serviceKey) {
    return { status: 500, data: { ok: false, approved: false, error: 'Server configuration error' } };
  }

  try {
    const qUrl = `${supabaseUrl}/rest/v1/profiles?player_id=eq.${encodeURIComponent(playerId)}&select=player_id,parent_email,stats`;
    const qRes = await fetch(qUrl, {
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`
      }
    });
    if (!qRes.ok) {
      return { status: 502, data: { ok: false, approved: false, error: 'Status lookup failed' } };
    }
    const rows = await qRes.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      return { status: 200, data: { ok: true, approved: false } };
    }
    const row = rows[0];
    const dbEmail = (row.parent_email || '').trim().toLowerCase();
    const isVerified = Boolean(
      dbEmail === email &&
      row.stats &&
      row.stats.parentConsentStatus === 'verified'
    );
    return {
      status: 200,
      data: {
        ok: true,
        approved: isVerified,
        verifiedAt: isVerified ? (row.stats.parentConsentVerifiedAt || null) : null
      }
    };
  } catch (err) {
    console.error('[parent-consent] Status check exception:', err);
    return { status: 502, data: { ok: false, approved: false, error: 'Status lookup failed' } };
  }
}

async function handleParentConsent(body) {
  const action = body && body.action ? String(body.action).trim().toLowerCase() : 'request';
  if (action === 'request') return handleRequestParentConsent(body);
  if (action === 'confirm') return handleConfirmParentConsent(body);
  if (action === 'status') return handleCheckConsentStatus(body);
  return { status: 400, data: { ok: false, error: 'Unsupported action' } };
}

exports.handler = async (event) => {
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
  } catch (_) {
    body = {};
  }
  const result = await handleParentConsent(body);
  return {
    statusCode: result.status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify(result.data)
  };
};

exports.handleParentConsent = handleParentConsent;
exports.handleRequestParentConsent = handleRequestParentConsent;
exports.handleConfirmParentConsent = handleConfirmParentConsent;
exports.handleCheckConsentStatus = handleCheckConsentStatus;
exports.buildConsentToken = buildConsentToken;
exports.verifyConsentToken = verifyConsentToken;
exports.CONSENT_TOKEN_TTL_SEC = CONSENT_TOKEN_TTL_SEC;
exports._resetConsentCooldownForTest = () => {
  recentConsentRequests.clear();
  recentConfirmEmails.clear();
};
