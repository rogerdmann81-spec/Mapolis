// Mapolis Privacy, Age-Gating & FTC COPPA (April 2026) Compliance Helpers
// Pure logic module shared by browser UI, sync guards, and Node unit tests.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.MapolisCompliance = api;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  const COPPA_AGE_THRESHOLD = 13;       // FTC COPPA: under 13 requires local-only default or Email Plus VPC
  const EXTERNAL_CONTENT_MIN_AGE = 14;  // External links & Notes to Dev Team disabled for guests & under-14
  const CONSENT_TOKEN_TTL_SEC = 72 * 60 * 60; // 72 hours for under-13 Email Plus approval links

  const RETENTION_POLICY = Object.freeze({
    unconfirmedConsentHours: 72,
    inactiveUnder13Months: 24,
    backupPurgeDays: 30,
    recoveryTokenMinutes: 15,
    optOutLinkDays: 90,
    summaryBullets: Object.freeze([
      'Unconfirmed under-13 consent requests: automatically expire after 72 hours (zero data is stored in our database before parent approval).',
      'Active under-13 cloud profiles: retained only while active and automatically deleted after 24 months of inactivity.',
      'Player or parent deletion requests: profile and gameplay records are deleted immediately from our live database and purged from automated backups within 30 days.',
      'Account recovery links expire after 15 minutes (single-use); parental opt-out links remain valid for 90 days.',
      'Persistent identifiers (random player IDs and local device storage) are used strictly for internal game state, sync, and abuse prevention—never for behavioral profiling, advertising, or contacting children.'
    ])
  });

  function computeProfileAge(birthYear, currentYear) {
    if (birthYear === null || birthYear === undefined || birthYear === '') return null;
    const yr = Number(birthYear);
    const nowYr = (typeof currentYear === 'number' && Number.isFinite(currentYear))
      ? currentYear
      : new Date().getFullYear();
    if (!Number.isInteger(yr) || yr < 1900 || yr > nowYr) return null;
    return nowYr - yr;
  }

  function isUnder13Profile(profile, currentYear) {
    if (!profile) return false;
    const by = profile.birthYear !== undefined ? profile.birthYear : profile.birth_year;
    const age = computeProfileAge(by, currentYear);
    return age !== null && age < COPPA_AGE_THRESHOLD;
  }

  // External links on s-solidarity: only clickable for logged-in profiles aged 14+.
  // Guests (logged out), unknown birth years, and profiles under 14 see informational cards only.
  function canAccessExternalLinks(profile, currentYear) {
    if (!profile) return false;
    const by = profile.birthYear !== undefined ? profile.birthYear : profile.birth_year;
    const age = computeProfileAge(by, currentYear);
    return age !== null && age >= EXTERNAL_CONTENT_MIN_AGE;
  }

  // Notes to Dev Team (showNotesModal): hidden & blocked for guests and profiles under 14.
  function canAccessDevNotes(profile, currentYear) {
    return canAccessExternalLinks(profile, currentYear);
  }

  // Determine COPPA cloud-sync status for a profile:
  //   'none'            -> no profile
  //   'allowed'         -> 13+, or under-13 with verified Email Plus parental consent
  //   'pending_consent' -> under-13 with parent email submitted, awaiting 72h Email Plus approval
  //   'local_only'      -> under-13 without parent email (stays 100% on-device in localStorage)
  function getCloudSyncStatus(profile, currentYear) {
    if (!profile) return 'none';
    const by = profile.birthYear !== undefined ? profile.birthYear : profile.birth_year;
    const age = computeProfileAge(by, currentYear);

    // 13+ accounts (or legacy profiles without birthYear that aren't explicitly localOnly)
    if (age === null) {
      return profile.localOnly === true ? 'local_only' : 'allowed';
    }
    if (age >= COPPA_AGE_THRESHOLD) {
      return 'allowed';
    }

    // Under-13 COPPA rules
    const consentStatus = profile.parentConsentStatus ||
      (profile.stats && profile.stats.parentConsentStatus) ||
      null;
    const hasParentEmail = Boolean((profile.parentEmail || profile.parent_email || '').trim());

    if (consentStatus === 'verified') {
      return 'allowed';
    }
    if (consentStatus === 'pending' && hasParentEmail) {
      return 'pending_consent';
    }
    if (profile.localOnly === true || !hasParentEmail) {
      return 'local_only';
    }
    // Pre-existing cloud-synced under-13 profiles loaded from Supabase prior to this rollout
    if (profile._syncedFromCloud === true && hasParentEmail) {
      return 'allowed';
    }
    return 'local_only';
  }

  function isCloudSyncAllowed(profile, currentYear) {
    return getCloudSyncStatus(profile, currentYear) === 'allowed';
  }

  function getConsentBadgeMeta(status) {
    if (status === 'pending_consent') {
      return {
        label: 'Awaiting Parent Approval',
        shortLabel: 'Pending Approval',
        color: '#fbbf24',
        borderColor: 'rgba(251, 191, 36, 0.45)',
        icon: '⏳',
        description: 'Playing locally on this device until your parent clicks the 72-hour approval link sent to their email.'
      };
    }
    if (status === 'local_only') {
      return {
        label: 'Local-Only Play (On This Device)',
        shortLabel: 'Local-Only',
        color: '#60a5fa',
        borderColor: 'rgba(96, 165, 250, 0.45)',
        icon: '📱',
        description: 'Zero data leaves this device. Ask a parent to link & verify their email anytime to unlock Cloud Sync, Friends, and Head-to-Head.'
      };
    }
    return {
      label: 'Cloud Sync Active',
      shortLabel: 'Cloud Active',
      color: '#4ade80',
      borderColor: 'rgba(74, 222, 128, 0.4)',
      icon: '🛡️',
      description: 'Your progress syncs safely across devices.'
    };
  }

  return {
    COPPA_AGE_THRESHOLD,
    EXTERNAL_CONTENT_MIN_AGE,
    CONSENT_TOKEN_TTL_SEC,
    RETENTION_POLICY,
    computeProfileAge,
    isUnder13Profile,
    canAccessExternalLinks,
    canAccessDevNotes,
    getCloudSyncStatus,
    isCloudSyncAllowed,
    getConsentBadgeMeta
  };
});
