/**
 * MAPOLIS EDUCATOR & CLASSROOM PANEL ARCHIVE
 * 
 * Extracted from play/index.html on pre-beta5 branch.
 * Preserved for the dedicated Educator Web Portal release following App Store submission.
 * 
 * Contains:
 * - Educator Dashboard & Navigation (s-edu-dash, s-edu-students, etc.)
 * - Classroom Groups & Student Rosters
 * - Educator Competitions Engine & CSV Export
 * - Educator Tests, Fixed Decks & Grading Scale Engine
 * - Custom Cards Builder & Difficulty Tier Overrides
 * - Educator Direct Messaging & Search
 */

const EDU_LINKS_KEY = 'nsg_edu_links';
const EDU_GRADES_KEY = 'nsg_edu_grades';
const EDU_GROUPS_KEY = 'nsg_edu_groups';
const EDU_ACTIVE_GRP_KEY = 'nsg_edu_agrp';
const EDU_LINK_CODE_LEN = 6;

function getEduGrades() {
  if (!activeProfile) return {};
  try {
    const raw = localStorage.getItem(EDU_GRADES_KEY + '_' + activeProfile.id);
    return raw ? JSON.parse(raw) : {};
  } catch (e) { return {}; }
}

function saveEduGrades(grades) {
  if (!activeProfile) return;
  try {
    localStorage.setItem(EDU_GRADES_KEY + '_' + activeProfile.id, JSON.stringify(grades));
  } catch (e) { console.warn('[educator] Grade save failed:', e); }
}

function getStudentAssignedGrade(studentId) {
  return getEduGrades()[studentId] || null;
}

function setStudentAssignedGrade(studentId, grade) {
  const grades = getEduGrades();
  grades[studentId] = grade;
  saveEduGrades(grades);
}

function getCohortCoefficient(student) {
  const assigned = getStudentAssignedGrade(student.player_id);
  if (!assigned || assigned <= 0) return null;
  const performance = student.tier_avg || 0;
  if (performance <= 0) return null;
  return performance / assigned;
}

function formatCoefficient(coeff) {
  if (coeff === null) return '—';
  const val = coeff.toFixed(2);
  if (coeff >= 1.1) return '↑' + val;
  if (coeff <= 0.9) return '↓' + val;
  return '≈' + val;
}

function coefficientColor(coeff) {
  if (coeff === null) return 'var(--dim)';
  if (coeff >= 1.1) return '#4caf50';
  if (coeff <= 0.9) return 'var(--wrong)';
  return '#ffb74d';
}

function getEduGroups() {
  if (!activeProfile) return [];
  try {
    const raw = localStorage.getItem(EDU_GROUPS_KEY + '_' + activeProfile.id);
    return raw ? JSON.parse(raw) : [];
  } catch (e) { return []; }
}

function saveEduGroups(groups) {
  if (!activeProfile) return;
  try {
    localStorage.setItem(EDU_GROUPS_KEY + '_' + activeProfile.id, JSON.stringify(groups));
  } catch (e) { console.warn('[educator] Groups save failed:', e); }
}

function getActiveGroupId() {
  if (!activeProfile) return null;
  return localStorage.getItem(EDU_ACTIVE_GRP_KEY + '_' + activeProfile.id) || null;
}

function setActiveGroupId(groupId) {
  if (!activeProfile) return;
  if (groupId) {
    localStorage.setItem(EDU_ACTIVE_GRP_KEY + '_' + activeProfile.id, groupId);
  } else {
    localStorage.removeItem(EDU_ACTIVE_GRP_KEY + '_' + activeProfile.id);
  }
}

function getActiveGroup() {
  const gid = getActiveGroupId();
  if (!gid) return null;
  return getEduGroups().find(g => g.id === gid) || null;
}

function filterStudentsByGroup(allStudents) {
  const group = getActiveGroup();
  if (!group) return allStudents;
  return allStudents.filter(s => (group.studentIds || []).includes(s.player_id));
}

function createEduGroup(name) {
  const groups = getEduGroups();
  const id = 'grp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  groups.push({ id, name, studentIds: [] });
  saveEduGroups(groups);
  if (typeof syncStore !== 'undefined') {
    syncStore.syncClassroom({ id: id, owner_id: activeProfile.id, name: name });
  }
  return id;
}

function deleteEduGroup(groupId) {
  const groups = getEduGroups().filter(g => g.id !== groupId);
  saveEduGroups(groups);
  if (getActiveGroupId() === groupId) setActiveGroupId(null);
}

function addStudentToGroup(groupId, studentId) {
  const groups = getEduGroups();
  const g = groups.find(gr => gr.id === groupId);
  if (g && !g.studentIds.includes(studentId)) {
    g.studentIds.push(studentId);
    saveEduGroups(groups);
    if (typeof syncStore !== 'undefined') {
      syncStore.syncClassroomMember({ classroom_id: groupId, profile_id: studentId });
    }
  }
}

function removeStudentFromGroup(groupId, studentId) {
  const groups = getEduGroups();
  const g = groups.find(gr => gr.id === groupId);
  if (g) {
    g.studentIds = g.studentIds.filter(id => id !== studentId);
    saveEduGroups(groups);
  }
}

function generateLinkCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < EDU_LINK_CODE_LEN; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function regenerateLinkCode() {
  if (!activeProfile || !activeProfile.isEducator) return;

  activeProfile.linkCode = generateLinkCode();
  saveProfiles();

  if (typeof syncStore !== 'undefined') {
    const entry = syncStore._buildProfileRow(activeProfile);
    entry.is_educator = true;
    entry.link_code = activeProfile.linkCode;
    syncStore._enqueue({ table: 'profiles', payload: entry });
    syncStore.processQueue();
  }

  showToast('New link code generated!');
  renderEduDashboard();
}

function getLinkedStudents() {
  if (!activeProfile) return [];
  try {
    const raw = localStorage.getItem(EDU_LINKS_KEY + '_' + activeProfile.id);
    return raw ? JSON.parse(raw) : [];
  } catch (e) { return []; }
}

function saveLinkedStudents(students) {
  if (!activeProfile) return;
  try {
    localStorage.setItem(EDU_LINKS_KEY + '_' + activeProfile.id, JSON.stringify(students));
  } catch (e) { console.warn('[educator] Link save failed:', e); }
}

async function fetchLinkedStudents() {
  if (!activeProfile) return [];

  if (!isSupabaseConfigured()) {
    var code = activeProfile.linkCode;
    if (!code) return getLinkedStudents();
    var localStudents = [];
    var allP = window.allProfiles || [];
    for (var i = 0; i < allP.length; i++) {
      var p = allP[i];
      if (p.id !== activeProfile.id && p.linkedEducators && p.linkedEducators.includes(code)) {
        localStudents.push(_buildStudentSummary(p));
      }
    }
    if (localStudents.length > 0 || getLinkedStudents().length > 0) {
      saveLinkedStudents(localStudents);
    }
    return localStudents;
  }

  try {
    const linksUrl = SUPABASE_URL + '/rest/v1/educator_links?educator_id=eq.' +
      encodeURIComponent(activeProfile.id) + '&select=student_id';
    const linksResp = await fetch(linksUrl, { headers: authedHeaders() });

    if (!linksResp.ok) throw new Error('Links fetch failed');

    const links = await linksResp.json();
    if (!links.length) {
      saveLinkedStudents([]);
      return [];
    }

    const studentIds = links.map(l => l.student_id);
    const idsParam = '(' + studentIds.map(id => '"' + id + '"').join(',') + ')';
    const profilesUrl = SUPABASE_URL + '/rest/v1/profiles?player_id=in.' + idsParam +
      '&select=player_id,handle,avatar_svg,stats';
    const profilesResp = await fetch(profilesUrl, { headers: authedHeaders() });

    if (!profilesResp.ok) throw new Error('Student profiles fetch failed');
    
    const rows = await profilesResp.json();
    const students = rows.map(r => {
      const s = r.stats || {};
      const totalAnswered = (s.totalCorrect || 0) + (s.totalMistakes || 0);
      return {
        player_id: r.player_id,
        handle: r.handle || 'Unknown',
        avatar_svg: r.avatar_svg || null,
        cr: s.cr || 0,
        accuracy: totalAnswered > 0 ? (s.totalCorrect || 0) / totalAnswered : 0,
        total_correct: s.totalCorrect || 0,
        total_mistakes: s.totalMistakes || 0,
        mistakes_corrected: s.mistakesCorrected || 0,
        best_streak: s.bestStreak || 0,
        day_streak: s.currentDayStreak || 0,
        tier_avg: s.tierAvg || 0,
        games_played: s.gamesPlayed || 0,
        last_played: s.lastPlayed || null
      };
    });
    
    saveLinkedStudents(students);
    return students;
  } catch (e) {
    console.warn('[educator] Fetch linked students failed, using cache:', e);
    return getLinkedStudents();
  }
}

function _buildStudentSummary(profile) {
  var s = profile.stats || {};
  var totalAnswered = (s.totalCorrect || 0) + (s.totalMistakes || 0);
  return {
    player_id: profile.id,
    handle: profile.handle || 'Unknown',
    avatar_svg: profile.avatar && profile.avatar.svg || null,
    cr: s.cr || 0,
    accuracy: totalAnswered > 0 ? (s.totalCorrect || 0) / totalAnswered : 0,
    total_correct: s.totalCorrect || 0,
    total_mistakes: s.totalMistakes || 0,
    mistakes_corrected: s.mistakesCorrected || 0,
    best_streak: s.bestStreak || 0,
    day_streak: s.currentDayStreak || 0,
    tier_avg: s.tierAvg || 0,
    games_played: s.gamesPlayed || 0,
    last_played: s.lastPlayed || null
  };
}

async function joinClass(code) {
  if (!activeProfile || !code) return;

  code = code.trim().toUpperCase();
  if (code.length !== EDU_LINK_CODE_LEN) {
    showToast('Invalid code — must be ' + EDU_LINK_CODE_LEN + ' characters');
    return;
  }

  if (!isSupabaseConfigured()) {
    if (!activeProfile.linkedEducators) activeProfile.linkedEducators = [];

    if (activeProfile.linkedEducators.includes(code)) {
      showToast('Already linked to this class!');
      return;
    }

    var eduProfile = (window.allProfiles || []).find(function(p) {
      return p.isEducator && p.linkCode && p.linkCode === code;
    });

    if (!eduProfile) {
      showToast('No educator found with that code on this device');
      return;
    }

    activeProfile.linkedEducators.push(code);
    saveProfiles();

    var eduStudents = [];
    try {
      var raw = localStorage.getItem(EDU_LINKS_KEY + '_' + eduProfile.id);
      if (raw) eduStudents = JSON.parse(raw);
    } catch (e) {}

    if (!eduStudents.find(function(s) { return s.player_id === activeProfile.id; })) {
      eduStudents.push(_buildStudentSummary(activeProfile));
      try {
        localStorage.setItem(EDU_LINKS_KEY + '_' + eduProfile.id, JSON.stringify(eduStudents));
      } catch (e) {}
    }

    showToast('Joined ' + eduProfile.handle + '\'s class! 🎉');
    renderProfile();
    return;
  }

  try {
    const findUrl = SUPABASE_URL + '/rest/v1/profiles?link_code=eq.' +
      encodeURIComponent(code) + '&is_educator=eq.true&select=player_id,handle&limit=1';
    const findResp = await fetch(findUrl, { headers: authedHeaders() });

    if (!findResp.ok) throw new Error('Search failed');

    const results = await findResp.json();
    if (!results.length) {
      showToast('No educator found with that code');
      return;
    }

    const educator = results[0];

    const linkUrl = SUPABASE_URL + '/rest/v1/educator_links';
    const linkResp = await fetch(linkUrl, {
      method: 'POST',
      headers: authedHeaders(),
      body: JSON.stringify({
        educator_id: educator.player_id,
        student_id: activeProfile.id
      })
    });

    if (linkResp.status === 409 || linkResp.status === 400) {
      showToast('Already linked to ' + educator.handle + '!');
      return;
    }

    if (!linkResp.ok) throw new Error('Link failed');

    if (!activeProfile.linkedEducators) activeProfile.linkedEducators = [];
    if (!activeProfile.linkedEducators.includes(code)) {
      activeProfile.linkedEducators.push(code);
    }
    saveProfiles();

    showToast('Joined ' + educator.handle + '\'s class! 🎉');
    renderProfile();

  } catch (e) {
    console.warn('[educator] Join class failed:', e);
    showToast('Failed to join — try again later');
  }
}

async function leaveClass(code) {
  if (!activeProfile) return;

  var eduProfile = (window.allProfiles || []).find(function(p) {
    return p.isEducator && p.linkCode && p.linkCode === code;
  });
  if (eduProfile) {
    try {
      var raw = localStorage.getItem(EDU_LINKS_KEY + '_' + eduProfile.id);
      if (raw) {
        var eduStudents = JSON.parse(raw).filter(function(s) { return s.player_id !== activeProfile.id; });
        localStorage.setItem(EDU_LINKS_KEY + '_' + eduProfile.id, JSON.stringify(eduStudents));
      }
    } catch (e) {}
  }

  activeProfile.linkedEducators = (activeProfile.linkedEducators || []).filter(c => c !== code);
  saveProfiles();
  showToast('Left class');
  renderProfile();
}

async function unlinkStudent(studentId) {
  if (!activeProfile) return;

  var students = getLinkedStudents().filter(s => s.player_id !== studentId);
  saveLinkedStudents(students);

  var studentProfile = (window.allProfiles || []).find(function(p) { return p.id === studentId; });
  if (studentProfile && activeProfile.linkCode) {
    studentProfile.linkedEducators = (studentProfile.linkedEducators || []).filter(function(c) {
      return c !== activeProfile.linkCode;
    });
    saveProfiles();
  }

  if (isSupabaseConfigured()) {
    try {
      var url = SUPABASE_URL + '/rest/v1/educator_links?educator_id=eq.' +
        encodeURIComponent(activeProfile.id) + '&student_id=eq.' + encodeURIComponent(studentId);
      await fetch(url, { method: 'DELETE', headers: authedHeaders() });
    } catch (e) {
      console.warn('[educator] Supabase unlink failed:', e);
    }
  }

  showToast('Student unlinked');
  renderEduStudents();
}

function renderEduDashboard() {
  const root = document.getElementById('edu-dash-root');
  if (!root || !activeProfile) return;

  const code = activeProfile.linkCode || '------';
  const allStudents = getLinkedStudents();
  const groups = getEduGroups();
  const activeGrp = getActiveGroup();
  const students = filterStudentsByGroup(allStudents);
  const groupLabel = activeGrp ? activeGrp.name : 'All Students';

  let html = '';

  html += `<div class="edu-topbar">
    <div class="edu-back" id="edu-dash-back">←</div>
    <div class="edu-logo"><span class="edu-logo-text">MG</span></div>
    <div class="edu-brand">
      <div class="edu-brand-sub">EDU</div>
    </div>
    <div style="flex:1;"></div>
    <div style="text-align:right;">
      <div style="font-size:11px;font-weight:700;color:#fff;">${escHtml(activeProfile.handle)}</div>
      <div style="font-size:9px;color:var(--dim);">Educator</div>
    </div>
  </div>`;

  html += '<div class="setup-hero" style="margin:12px 16px 0;border-radius:18px;padding:22px 16px 18px;">';
  html += '<div class="bg-star" style="width:2px;height:2px;top:14%;left:12%;--d:3s;--delay:.1s;--op:.9"></div>';
  html += '<div class="bg-star" style="width:1px;height:1px;top:22%;left:82%;--d:2.6s;--delay:.5s;--op:.7"></div>';
  html += '<div class="bg-star" style="width:2px;height:2px;top:8%;left:45%;--d:4s;--delay:.8s;--op:.8"></div>';
  html += '<div class="bg-star" style="width:1px;height:1px;top:38%;left:90%;--d:3.3s;--delay:1.1s;--op:.5"></div>';
  html += '<div class="bg-star" style="width:1px;height:1px;top:42%;left:8%;--d:3.8s;--delay:.3s;--op:.6"></div>';
  html += '<div class="bg-star" style="width:2px;height:2px;top:18%;left:68%;--d:2.9s;--delay:.7s;--op:.7"></div>';
  html += '<div class="bg-star" style="width:1px;height:1px;top:32%;left:28%;--d:4.2s;--delay:1.4s;--op:.5"></div>';
  html += '<div class="bg-star" style="width:2px;height:2px;top:48%;left:55%;--d:3.5s;--delay:.2s;--op:.6"></div>';
  html += '<div class="hero-blob-l"></div>';
  html += '<div class="hero-blob-r"></div>';
  html += '<div class="setup-hero-content">';
  html += '<div class="setup-hero-ava" id="edu-dash-hero-ava" style="width:80px;height:80px;font-size:42px;margin-bottom:8px;">🧑</div>';
  html += '<div class="setup-hero-brand">';
  html += '<span class="setup-hero-star">⭐</span>';
  html += '<span class="setup-hero-label">Mapolis</span>';
  html += '</div>';
  const _eduProfile = window.activeProfile;
  const _eduTitle = (_eduProfile ? getProfileTitle(_eduProfile) : null) || 'Explorer';
  const _eduTitleColor = (_eduProfile ? getProfileTitleColor(_eduProfile) : null) || '#8899bb';
  html += `<div class="setup-hero-rank" style="color:${_eduTitleColor};border-color:${_eduTitleColor}33">${_eduTitle}</div>`;
  html += '</div>';
  html += '</div>';

  html += `<div class="edu-content">`;

  html += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
    <select id="edu-group-select" style="flex:1;padding:10px;border-radius:10px;background:var(--edu-bg-panel);color:#fff;border:1px solid var(--edu-border);font-size:13px;font-weight:700;">
      <option value="" ${!activeGrp && groups.length > 0 ? 'selected' : ''}>All Students (${allStudents.length})</option>
      ${groups.map(g => `<option value="${escHtml(g.id)}" ${activeGrp && activeGrp.id === g.id ? 'selected' : ''}>${escHtml(g.name)} (${g.studentIds.length})</option>`).join('')}
      <option value="__new__" ${groups.length === 0 ? 'selected' : ''}>${groups.length === 0 ? '+ Create your first group…' : '+ New group…'}</option>
    </select>
    <button class="edu-btn" id="btn-manage-groups" title="Manage groups" style="flex-shrink:0;padding:10px 14px;font-size:12px;font-weight:700;">Manage</button>
  </div>`;

  html += `<div class="edu-card">
    <h3>Your Class Link Code</h3>
    <div class="edu-link-code" id="edu-code-display">${escHtml(code)}</div>
    <div style="text-align:center;margin-top:8px;">
      <button class="edu-btn" id="btn-copy-code" style="margin-right:8px;font-size:11px;padding:8px 14px;">📋 Copy</button>
      <button class="edu-btn" id="btn-regen-code" style="background:var(--edu-bg-panel);border:1px solid var(--edu-border);font-size:11px;padding:8px 14px;">🔄 New Code</button>
    </div>
    <div style="font-size:10px;color:var(--dim);text-align:center;margin-top:8px;">Students enter this code on their profile to join your class.</div>
  </div>`;

  const avgAcc = students.length ? Math.round(students.reduce((a, s) => a + (s.accuracy || 0), 0) / students.length * 100) + '%' : '—';
  const avgTier = students.length ? (students.reduce((a, s) => a + (s.tier_avg || 0), 0) / students.length).toFixed(1) : '—';
  html += `<div class="edu-stats-row">
    <div class="edu-stat-card">
      <div class="edu-stat-val">${students.length}</div>
      <div class="edu-stat-lbl">${activeGrp ? 'In Group' : 'Students'}</div>
    </div>
    <div class="edu-stat-card">
      <div class="edu-stat-val">${avgAcc}</div>
      <div class="edu-stat-lbl">Avg Accuracy</div>
    </div>
    <div class="edu-stat-card">
      <div class="edu-stat-val">T${avgTier}</div>
      <div class="edu-stat-lbl">Avg Tier</div>
    </div>
  </div>`;

  html += `<div class="edu-nav-card" id="nav-edu-students">
    <div class="edu-nav-icon">👥</div>
    <div class="edu-nav-text">
      <div class="edu-nav-title">Linked Profiles</div>
      <div class="edu-nav-desc">${students.length} student${students.length !== 1 ? 's' : ''} · ${groupLabel}</div>
    </div>
    <div style="color:var(--dim);">›</div>
  </div>`;

  html += `<div class="edu-nav-card" id="nav-edu-competitions">
    <div class="edu-nav-icon">🏆</div>
    <div class="edu-nav-text">
      <div class="edu-nav-title">Competitions</div>
      <div class="edu-nav-desc">Create competitive events</div>
    </div>
    <div style="color:var(--dim);">›</div>
  </div>`;

  html += `<div class="edu-nav-card" id="nav-edu-tests">
    <div class="edu-nav-icon">📝</div>
    <div class="edu-nav-text">
      <div class="edu-nav-title">Tests & Grading</div>
      <div class="edu-nav-desc">Formal assessments</div>
    </div>
    <div style="color:var(--dim);">›</div>
  </div>`;

  html += `<div class="edu-nav-card" id="nav-edu-cards">
    <div class="edu-nav-icon">🃏</div>
    <div class="edu-nav-text">
      <div class="edu-nav-title">Custom Cards</div>
      <div class="edu-nav-desc">Author supplemental content</div>
    </div>
    <div style="color:var(--dim);">›</div>
  </div>`;

  const _msgUnread = getUnreadCountForProfile(activeProfile.id);
  html += `<div class="edu-nav-card" id="nav-edu-messages">
    <div class="edu-nav-icon">💬</div>
    <div class="edu-nav-text">
      <div class="edu-nav-title">Messages${_msgUnread > 0 ? ' <span style="display:inline-block;background:var(--wrong);color:#fff;font-size:9px;font-weight:800;padding:1px 6px;border-radius:8px;margin-left:4px;">' + _msgUnread + '</span>' : ''}</div>
      <div class="edu-nav-desc">Message linked profiles</div>
    </div>
    <div style="color:var(--dim);">›</div>
  </div>`;

  html += `<div class="edu-nav-card" id="nav-edu-search">
    <div class="edu-nav-icon">🔍</div>
    <div class="edu-nav-text">
      <div class="edu-nav-title">Educator Search</div>
      <div class="edu-nav-desc">Find other educators</div>
    </div>
    <div style="color:var(--dim);">›</div>
  </div>`;

  {
    const grades = getEduGrades();
    html += `<div class="edu-card" style="margin-top:10px;">
      <h3>Set Initial Grade Level</h3>
      <div style="display:flex;gap:8px;margin-bottom:10px;align-items:center;">
        <select id="edu-grade-select" style="flex:1;padding:10px;border-radius:10px;background:var(--edu-bg-panel);color:#fff;border:1px solid var(--edu-border);font-size:13px;">
          ${[1,2,3,4,5,6,7,8,9,10,11,12,13].map(g => `<option value="${g}">Grade ${g}</option>`).join('')}
        </select>
        <button class="edu-btn" id="btn-grade-all" style="white-space:nowrap;">Apply to ${activeGrp ? 'Group' : 'All'}</button>
      </div>
      <div id="edu-grade-list" style="max-height:200px;overflow-y:auto;">`;
    if (students.length === 0) {
      html += `<div style="text-align:center;padding:12px 0;font-size:11px;color:var(--dim);">No linked profiles yet. Students will appear here once they join with your class code.</div>`;
    }
    for (const s of students) {
      const assigned = grades[s.player_id] || '';
      const coeff = getCohortCoefficient(s);
      const coeffStr = formatCoefficient(coeff);
      const coeffCol = coefficientColor(coeff);
      html += `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid rgba(91,143,255,.06);">
        <span style="flex:1;font-size:12px;color:#fff;font-weight:600;">${escHtml(s.handle || 'Unknown')}</span>
        <span style="font-size:11px;color:${coeffCol};font-weight:700;font-family:'Space Mono',monospace;min-width:44px;text-align:center;">${coeffStr}</span>
        <select class="edu-grade-sel" data-sid="${escHtml(s.player_id)}" style="width:70px;padding:5px;border-radius:8px;background:var(--edu-bg-panel);color:#fff;border:1px solid var(--edu-border);font-size:11px;">
          <option value="">—</option>
          ${[1,2,3,4,5,6,7,8,9,10,11,12,13].map(g => `<option value="${g}" ${assigned == g ? 'selected' : ''}>G${g}</option>`).join('')}
        </select>
      </div>`;
    }
    html += `</div></div>`;
  }

  html += `</div>`;

  root.innerHTML = html;
  updateAvatarBars();

  document.getElementById('edu-dash-hero-ava')?.addEventListener('click', () => go('s-profile'));

  document.getElementById('edu-dash-back')?.addEventListener('click', function() { go('s-profile'); });

  document.getElementById('edu-group-select')?.addEventListener('change', function() {
    if (this.value === '__new__') {
      renderGroupManager();
      return;
    }
    setActiveGroupId(this.value || null);
    renderEduDashboard();
  });

  document.getElementById('btn-manage-groups')?.addEventListener('click', function() {
    renderGroupManager();
  });

  document.getElementById('btn-copy-code')?.addEventListener('click', function() {
    try {
      navigator.clipboard.writeText(code);
      showToast('Code copied!');
    } catch (e) {
      showToast(code);
    }
  });

  document.getElementById('btn-regen-code')?.addEventListener('click', function() {
      regenerateLinkCode();
  });

  document.getElementById('nav-edu-students')?.addEventListener('click', function() { go('s-edu-students'); });
  document.getElementById('nav-edu-competitions')?.addEventListener('click', function() { go('s-edu-competitions'); });
  document.getElementById('nav-edu-tests')?.addEventListener('click', function() { go('s-edu-tests'); });
  document.getElementById('nav-edu-cards')?.addEventListener('click', function() { go('s-edu-cards'); });
  document.getElementById('nav-edu-messages')?.addEventListener('click', function() { go('s-edu-messages'); });
  document.getElementById('nav-edu-search')?.addEventListener('click', function() { go('s-edu-search'); });

  document.getElementById('btn-grade-all')?.addEventListener('click', function() {
    const grade = parseInt(document.getElementById('edu-grade-select')?.value);
    if (!grade) return;
    const grades = getEduGrades();
    for (const s of students) {
      grades[s.player_id] = grade;
    }
    saveEduGrades(grades);
    showToast('Grade ' + grade + ' applied to ' + (activeGrp ? activeGrp.name : 'all students'));
    renderEduDashboard();
  });

  root.querySelectorAll('.edu-grade-sel').forEach(function(sel) {
    sel.addEventListener('change', function() {
      const sid = this.getAttribute('data-sid');
      const val = parseInt(this.value);
      if (sid && val) {
        setStudentAssignedGrade(sid, val);
        renderEduDashboard();
      } else if (sid && !this.value) {
        const grades = getEduGrades();
        delete grades[sid];
        saveEduGrades(grades);
        renderEduDashboard();
      }
    });
  });

  fetchLinkedStudents().then(function(freshStudents) {
    if (freshStudents.length !== allStudents.length) {
      renderEduDashboard();
    }
  });
}

function renderGroupManager() {
  const root = document.getElementById('edu-dash-root');
  if (!root || !activeProfile) return;

  const allStudents = getLinkedStudents();
  const groups = getEduGroups();

  let html = '';

  html += `<div class="edu-topbar">
    <div class="edu-back" id="grp-mgr-back">←</div>
    <div class="edu-logo"><span class="edu-logo-text">MG</span></div>
    <div class="edu-brand">
      <div class="edu-brand-name">Manage Groups</div>
      <div class="edu-brand-sub">EDU</div>
    </div>
  </div>`;

  html += `<div class="edu-content">`;

  html += `<div class="edu-card">
    <h3>Create Group</h3>
    <div style="display:flex;gap:8px;">
      <input type="text" id="grp-new-name" placeholder="e.g. Period 3, Grade 5 Honors..." maxlength="40" style="flex:1;padding:10px;border-radius:10px;background:var(--edu-bg-panel);color:#fff;border:1px solid var(--edu-border);font-size:13px;">
      <button class="edu-btn" id="btn-grp-create" style="flex-shrink:0;">+ Create</button>
    </div>
  </div>`;

  if (groups.length === 0) {
    html += `<div class="edu-empty">
      <div style="font-size:28px;margin-bottom:8px;">📁</div>
      <div>No groups yet.</div>
      <div style="margin-top:4px;font-size:11px;">Create a group to organize students by class period, grade level, etc.</div>
    </div>`;
  } else {
    for (const g of groups) {
      const memberCount = g.studentIds.length;
      html += `<div class="edu-card" style="margin-top:8px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
          <h3 style="margin:0;">${escHtml(g.name)} <span style="font-size:11px;color:var(--dim);font-weight:400;">(${memberCount})</span></h3>
          <button class="btn-grp-delete" data-gid="${escHtml(g.id)}" style="background:none;color:var(--wrong);font-size:10px;font-weight:700;padding:4px 8px;">Delete</button>
        </div>`;

      for (const s of allStudents) {
        const inGroup = g.studentIds.includes(s.player_id);
        html += `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid rgba(91,143,255,.06);">
          <label style="display:flex;align-items:center;gap:8px;flex:1;cursor:pointer;">
            <input type="checkbox" class="grp-toggle" data-gid="${escHtml(g.id)}" data-sid="${escHtml(s.player_id)}" ${inGroup ? 'checked' : ''} style="width:16px;height:16px;accent-color:var(--edu-accent);">
            <span style="font-size:12px;color:#fff;">${escHtml(s.handle || 'Unknown')}</span>
          </label>
        </div>`;
      }
      html += `</div>`;
    }
  }

  html += `</div>`;
  root.innerHTML = html;

  document.getElementById('grp-mgr-back')?.addEventListener('click', function() { renderEduDashboard(); });

  document.getElementById('btn-grp-create')?.addEventListener('click', function() {
    const name = document.getElementById('grp-new-name')?.value.trim();
    if (!name) { showToast('Enter a group name'); return; }
    if (name.length < 2) { showToast('Name must be at least 2 characters'); return; }
    createEduGroup(name);
    showToast('Group "' + name + '" created');
    renderGroupManager();
  });

  root.querySelectorAll('.btn-grp-delete').forEach(function(btn) {
    btn.addEventListener('click', function() {
      const gid = this.getAttribute('data-gid');
      if (gid) {
        deleteEduGroup(gid);
        showToast('Group deleted');
        renderGroupManager();
      }
    });
  });

  root.querySelectorAll('.grp-toggle').forEach(function(cb) {
    cb.addEventListener('change', function() {
      const gid = this.getAttribute('data-gid');
      const sid = this.getAttribute('data-sid');
      if (this.checked) {
        addStudentToGroup(gid, sid);
      } else {
        removeStudentFromGroup(gid, sid);
      }
    });
  });
}

function renderEduStudents() {
  const root = document.getElementById('edu-students-root');
  if (!root || !activeProfile) return;

  const allStudents = getLinkedStudents();
  const students = filterStudentsByGroup(allStudents);
  const activeGrp = getActiveGroup();
  const groupLabel = activeGrp ? activeGrp.name : 'All Students';

  let html = '';

  html += `<div class="edu-topbar">
    <div class="edu-back" id="edu-students-back">←</div>
    <div class="edu-logo"><span class="edu-logo-text">MG</span></div>
    <div class="edu-brand">
      <div class="edu-brand-name">Linked Profiles</div>
      <div class="edu-brand-sub">EDU · ${escHtml(groupLabel)}</div>
    </div>
  </div>`;

  html += `<div class="edu-content">`;

  if (!students.length) {
    html += `<div class="edu-empty">
      <div style="font-size:36px;margin-bottom:10px;">👥</div>
      <div>No students linked yet.</div>
      <div style="margin-top:6px;font-size:11px;">Share your class code to get started.</div>
    </div>`;
  } else {
    html += `<div class="edu-card"><h3>Students (${students.length})</h3>`;
    for (const s of students) {
      const ava = s.avatar_svg
        ? '<img src="' + s.avatar_svg + '">'
        : '🧑';
      const acc = s.accuracy ? Math.round(s.accuracy * 100) + '%' : '—';
      const corrRate = (s.total_mistakes || 0) > 0 ? Math.round((s.mistakes_corrected || 0) / s.total_mistakes * 100) + '%' : '—';
      const dayStrk = s.day_streak || 0;
      const coeff = getCohortCoefficient(s);
      const coeffStr = formatCoefficient(coeff);
      const coeffCol = coefficientColor(coeff);
      const lastPlay = s.last_played ? new Date(s.last_played).toLocaleDateString() : 'Never';

      html += `<div class="edu-student-row" data-sid="${escHtml(s.player_id)}">
        <div class="edu-student-ava">${ava}</div>
        <div class="edu-student-info">
          <div class="edu-student-handle">${escHtml(s.handle || 'Unknown')}</div>
          <div class="edu-student-meta">${acc} correct · ${corrRate} corrected · ${dayStrk}d streak</div>
          <div class="edu-student-meta" style="margin-top:2px;">Cohort: <span style="color:${coeffCol};font-weight:700;">${coeffStr}</span> · Last: ${lastPlay}</div>
        </div>
        <div class="edu-student-cr">${(s.cr || 0).toLocaleString()}</div>
      </div>`;
    }
    html += `</div>`;
  }

  html += `</div>`;

  root.innerHTML = html;

  document.getElementById('edu-students-back')?.addEventListener('click', function() { go('s-edu-dash'); });

  root.querySelectorAll('.edu-student-row').forEach(function(row) {
    row.addEventListener('click', function() {
      var sid = this.getAttribute('data-sid');
      renderStudentDetail(sid);
    });
  });

  fetchLinkedStudents().then(function(fresh) {
    if (JSON.stringify(fresh) !== JSON.stringify(allStudents)) {
      renderEduStudents();
    }
  });
}

function renderStudentDetail(studentId) {
  var root = document.getElementById('edu-students-root');
  if (!root) return;

  var students = getLinkedStudents();
  var s = students.find(function(st) { return st.player_id === studentId; });
  if (!s) return;

  var ava = s.avatar_svg
    ? '<img src="' + s.avatar_svg + '" style="width:64px;height:64px;border-radius:50%;border:2px solid var(--edu-accent);">'
    : '<div style="width:64px;height:64px;border-radius:50%;background:var(--edu-bg-panel);display:flex;align-items:center;justify-content:center;font-size:28px;border:2px solid var(--edu-accent);">🧑</div>';
  var acc = s.accuracy ? Math.round(s.accuracy * 100) + '%' : '—';
  var corrRate = (s.total_mistakes || 0) > 0 ? Math.round((s.mistakes_corrected || 0) / s.total_mistakes * 100) + '%' : '—';
  var dayStrk = s.day_streak || 0;
  var coeff = getCohortCoefficient(s);
  var coeffStr = formatCoefficient(coeff);
  var coeffCol = coefficientColor(coeff);
  var assignedGrade = getStudentAssignedGrade(s.player_id);
  var stuTierAvg = s.tier_avg ? 'T' + Math.round(s.tier_avg) : '';

  var html = '';

  html += '<div class="edu-topbar">';
  html += '<div class="edu-back" id="edu-detail-back">←</div>';
  html += '<div class="edu-brand"><div class="edu-brand-name">Student Detail</div><div class="edu-brand-sub">EDU</div></div>';
  html += '</div>';

  html += '<div class="edu-content">';

  html += '<div style="text-align:center;margin-bottom:14px;">';
  html += '<div style="display:inline-block;">' + ava + '</div>';
  html += '<h2 style="font-family:\'Fredoka One\',sans-serif;font-size:20px;color:#fff;margin-top:8px;">' + escHtml(s.handle || 'Unknown') + '</h2>';
  html += '<div style="font-size:12px;color:' + STAR_COLOR + ';font-weight:700;margin-top:4px;">⭐ ' + (s.cr || 0).toLocaleString() + ' Stars' + (stuTierAvg ? ' · ' + stuTierAvg : '') + '</div>';
  html += '</div>';

  html += '<div class="edu-card" style="text-align:center;">';
  html += '<div class="edu-stat-lbl">Star Bank</div>';
  html += '<div style="font-family:\'Space Mono\',monospace;font-size:32px;font-weight:700;color:' + STAR_COLOR + ';">' + (s.cr || 0).toLocaleString() + '</div>';
  html += '</div>';

  html += '<div class="edu-stats-row">';
  html += '<div class="edu-stat-card"><div class="edu-stat-val">' + acc + '</div><div class="edu-stat-lbl">% Correct</div></div>';
  html += '<div class="edu-stat-card"><div class="edu-stat-val">' + corrRate + '</div><div class="edu-stat-lbl">Corrected</div></div>';
  html += '<div class="edu-stat-card"><div class="edu-stat-val">' + dayStrk + '🔥</div><div class="edu-stat-lbl">Day Streak</div></div>';
  html += '</div>';

  html += '<div class="edu-card" style="text-align:center;">';
  html += '<div class="edu-stat-lbl">Cohort Coefficient</div>';
  html += '<div style="font-family:\'Space Mono\',monospace;font-size:28px;font-weight:700;color:' + coeffCol + ';">' + coeffStr + '</div>';
  html += '<div style="font-size:10px;color:var(--dim);margin-top:4px;">' + (assignedGrade ? 'Assigned Grade ' + assignedGrade + ' · Avg Tier ' + (s.tier_avg ? Number(s.tier_avg).toFixed(1) : '—') : 'No grade assigned — set on dashboard') + '</div>';
  html += '</div>';

  html += '<div class="edu-stats-row">';
  html += '<div class="edu-stat-card"><div class="edu-stat-val">' + (s.games_played || 0) + '</div><div class="edu-stat-lbl">Games</div></div>';
  html += '<div class="edu-stat-card"><div class="edu-stat-val">' + (s.total_correct || 0).toLocaleString() + '</div><div class="edu-stat-lbl">Correct</div></div>';
  html += '</div>';

  html += '<div class="edu-stats-row">';
  html += '<div class="edu-stat-card"><div class="edu-stat-val">' + (s.best_streak || 0) + '</div><div class="edu-stat-lbl">Best Streak</div></div>';
  html += '<div class="edu-stat-card"><div class="edu-stat-val">' + (s.last_played ? new Date(s.last_played).toLocaleDateString() : 'Never') + '</div><div class="edu-stat-lbl">Last Played</div></div>';
  html += '</div>';

  html += '<div style="text-align:center;margin-top:14px;padding-bottom:20px;display:flex;gap:10px;justify-content:center;">';
  html += '<button class="edu-btn" id="btn-msg-student" style="font-size:11px;padding:8px 16px;">💬 Message</button>';
  html += '<button class="edu-btn" id="btn-unlink-student" style="background:var(--wrong);font-size:11px;padding:8px 16px;">Unlink Student</button>';
  html += '</div>';

  html += '</div>';

  root.innerHTML = html;

  document.getElementById('edu-detail-back')?.addEventListener('click', function() { renderEduStudents(); });
  document.getElementById('btn-msg-student')?.addEventListener('click', function() {
    go('s-edu-messages');
    setTimeout(function() { renderEduConversation(studentId); }, 50);
  });
  document.getElementById('btn-unlink-student')?.addEventListener('click', function() {
      unlinkStudent(studentId);
  });
}

function renderEduSearch() {
  var root = document.getElementById('edu-search-root');
  if (!root) return;

  var html = '';

  html += '<div class="edu-topbar">';
  html += '<div class="edu-back" id="edu-search-back">←</div>';
  html += '<div class="edu-logo"><span class="edu-logo-text">MG</span></div>';
  html += '<div class="edu-brand"><div class="edu-brand-name">Educator Search</div><div class="edu-brand-sub">EDU</div></div>';
  html += '</div>';

  html += '<div class="edu-content">';

  html += '<div class="edu-card">';
  html += '<h3>Find Educators</h3>';
  html += '<div style="display:flex;gap:8px;">';
  html += '<input type="text" class="edu-search-input" id="edu-search-q" placeholder="Search by handle or link code..." maxlength="40">';
  html += '<button class="edu-btn" id="edu-search-go" style="flex-shrink:0;">Search</button>';
  html += '</div>';
  html += '</div>';

  html += '<div id="edu-search-results"></div>';

  html += '</div>';

  root.innerHTML = html;

  document.getElementById('edu-search-back')?.addEventListener('click', function() { go('s-edu-dash'); });

  var searchBtn = document.getElementById('edu-search-go');
  var searchInput = document.getElementById('edu-search-q');

  function doSearch() {
    var q = (searchInput.value || '').trim();
    if (q.length < 2) {
      showToast('Enter at least 2 characters');
      return;
    }
    performEducatorSearch(q);
  }

  searchBtn?.addEventListener('click', doSearch);
  searchInput?.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') doSearch();
  });
}

async function performEducatorSearch(query) {
  var resultsDiv = document.getElementById('edu-search-results');
  if (!resultsDiv) return;

  resultsDiv.innerHTML = '<div class="edu-empty">Searching...</div>';

  if (!isSupabaseConfigured()) {
    resultsDiv.innerHTML = '<div class="edu-empty">Search requires an internet connection.</div>';
    return;
  }

  try {
    var url = SUPABASE_URL + '/rest/v1/profiles?is_educator=eq.true&or=(handle.ilike.*' +
      encodeURIComponent(query) + '*,link_code.eq.' + encodeURIComponent(query.toUpperCase()) +
      ')&select=player_id,handle,avatar_svg,link_code,cr,games_played&limit=20';
    var resp = await fetch(url, { headers: authedHeaders() });

    if (!resp.ok) throw new Error('Search failed');

    var results = await resp.json();

    if (!results.length) {
      resultsDiv.innerHTML = '<div class="edu-empty">No educators found.</div>';
      return;
    }

    var html = '<div class="edu-card"><h3>Results (' + results.length + ')</h3>';
    for (var r of results) {
      var ava = r.avatar_svg
        ? '<img src="' + r.avatar_svg + '">'
        : '🎓';
      html += '<div class="edu-student-row">';
      html += '<div class="edu-student-ava">' + ava + '</div>';
      html += '<div class="edu-student-info">';
      html += '<div class="edu-student-handle">' + escHtml(r.handle || 'Unknown') + ' <span class="edu-badge">EDU</span></div>';
      html += '<div class="edu-student-meta">Code: ' + escHtml(r.link_code || '—') + ' · ' + (r.games_played || 0) + ' games</div>';
      html += '</div>';
      html += '<div class="edu-student-cr">' + (r.cr || 0).toLocaleString() + '</div>';
      html += '</div>';
    }
    html += '</div>';

    resultsDiv.innerHTML = html;

  } catch (e) {
    console.warn('[educator] Search failed:', e);
    resultsDiv.innerHTML = '<div class="edu-empty">Search failed — try again later.</div>';
  }
}

const MSG_KEY = 'nsg_messages';

function getMessages() {
  try {
    var raw = localStorage.getItem(MSG_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) { return []; }
}

function saveMessages(msgs) {
  try { localStorage.setItem(MSG_KEY, JSON.stringify(msgs)); } catch (e) {}
}

function sendMessage(fromId, fromHandle, toId, toHandle, text, opts) {
  if (!text || !text.trim()) return null;
  opts = opts || {};
  var msg = {
    id: crypto.randomUUID ? crypto.randomUUID() : 'msg-' + Date.now() + '-' + Math.random().toString(36).slice(2,8),
    fromId: fromId,
    fromHandle: fromHandle,
    toId: toId,
    toHandle: toHandle,
    text: text.trim(),
    sentAt: new Date().toISOString(),
    read: false,
    type: 'educator_msg',
    templateId: opts.templateId || null
  };
  var msgs = getMessages();
  msgs.push(msg);
  saveMessages(msgs);
  if (typeof sbSendMessage === 'function') {
    sbSendMessage(msg).catch(function() {});
  }
  return msg;
}

function sendBroadcast(fromId, fromHandle, recipientIds, recipientHandles, text) {
  var sent = [];
  for (var i = 0; i < recipientIds.length; i++) {
    var m = sendMessage(fromId, fromHandle, recipientIds[i], recipientHandles[i], text);
    if (m) sent.push(m);
  }
  return sent;
}

function getConversationsForProfile(profileId) {
  var msgs = getMessages();
  var relevant = msgs.filter(function(m) { return m.fromId === profileId || m.toId === profileId; });
  var convos = {};
  for (var i = 0; i < relevant.length; i++) {
    var m = relevant[i];
    var otherId = m.fromId === profileId ? m.toId : m.fromId;
    var otherHandle = m.fromId === profileId ? m.toHandle : m.fromHandle;
    if (!convos[otherId]) {
      convos[otherId] = { profileId: otherId, handle: otherHandle, messages: [], unread: 0, lastMsg: null };
    }
    convos[otherId].messages.push(m);
    if (!m.read && m.toId === profileId) convos[otherId].unread++;
    if (!convos[otherId].lastMsg || new Date(m.sentAt) > new Date(convos[otherId].lastMsg.sentAt)) {
      convos[otherId].lastMsg = m;
    }
  }
  var arr = Object.values(convos);
  arr.sort(function(a, b) { return new Date(b.lastMsg.sentAt) - new Date(a.lastMsg.sentAt); });
  return arr;
}

function getUnreadCountForProfile(profileId) {
  var msgs = getMessages();
  return msgs.filter(function(m) { return m.toId === profileId && !m.read; }).length;
}

function markConversationRead(myId, otherId) {
  var msgs = getMessages();
  var changed = false;
  for (var i = 0; i < msgs.length; i++) {
    if (msgs[i].toId === myId && msgs[i].fromId === otherId && !msgs[i].read) {
      msgs[i].read = true;
      changed = true;
    }
  }
  if (changed) saveMessages(msgs);
}

function _msgTimeLabel(iso) {
  var d = new Date(iso);
  var now = new Date();
  var diff = now - d;
  if (diff < 60000) return 'now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h';
  if (diff < 604800000) return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()];
  return (d.getMonth()+1) + '/' + d.getDate();
}

function _msgDateSep(iso) {
  var d = new Date(iso);
  var now = new Date();
  var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  var msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  var diff = today - msgDay;
  if (diff === 0) return 'Today';
  if (diff <= 86400000) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday:'short', month:'short', day:'numeric' });
}

function _msgGetAvatar(profileId) {
  var p = (window.allProfiles || []).find(function(pr) { return pr.id === profileId; });
  if (p && p.avatar && p.avatar.svg) return '<img src="' + p.avatar.svg + '">';
  var students = typeof getLinkedStudents === 'function' ? getLinkedStudents() : [];
  var s = students.find(function(st) { return st.player_id === profileId; });
  if (s && s.avatar_svg) return '<img src="' + s.avatar_svg + '">';
  return '💬';
}

function _msgIsEducator(profileId) {
  var p = (window.allProfiles || []).find(function(pr) { return pr.id === profileId; });
  return p && p.isEducator;
}

function renderEduMessages() {
  var root = document.getElementById('edu-messages-root');
  if (!root || !activeProfile) return;

  var convos = getConversationsForProfile(activeProfile.id);
  var totalUnread = convos.reduce(function(a, c) { return a + c.unread; }, 0);

  var html = '';

  html += '<div class="edu-topbar">';
  html += '<div class="edu-back" id="edu-messages-back">←</div>';
  html += '<div class="edu-logo"><span class="edu-logo-text">MG</span></div>';
  html += '<div class="edu-brand">';
  html += '<div class="edu-brand-name">Messages</div>';
  html += '<div class="edu-brand-sub">EDU' + (totalUnread > 0 ? ' · ' + totalUnread + ' unread' : '') + '</div>';
  html += '</div>';
  html += '<div style="flex:1;"></div>';
  html += '<button class="edu-btn" id="btn-compose-new" style="padding:8px 14px;font-size:12px;">✏️ New</button>';
  html += '</div>';

  html += '<div class="edu-content">';

  if (convos.length === 0) {
    html += '<div class="edu-empty">';
    html += '<div style="font-size:48px;margin-bottom:12px;">💬</div>';
    html += '<div style="font-size:15px;color:#fff;font-weight:700;">No messages yet</div>';
    html += '<div style="margin-top:6px;">Send a message to a linked profile to get started.</div>';
    html += '</div>';
  } else {
    html += '<div class="edu-card"><h3>Conversations</h3>';
    for (var i = 0; i < convos.length; i++) {
      var c = convos[i];
      var ava = _msgGetAvatar(c.profileId);
      var preview = c.lastMsg ? (c.lastMsg.fromId === activeProfile.id ? 'You: ' : '') + c.lastMsg.text : '';
      if (preview.length > 50) preview = preview.slice(0, 47) + '...';
      var isEdu = _msgIsEducator(c.profileId);

      html += '<div class="msg-convo-row" data-convo-id="' + escHtml(c.profileId) + '">';
      html += '<div class="msg-convo-ava">' + ava + (c.unread > 0 ? '<div class="msg-unread-dot"></div>' : '') + '</div>';
      html += '<div class="msg-convo-info">';
      html += '<div class="msg-convo-name">' + escHtml(c.handle) + (isEdu ? ' <span class="edu-badge">EDU</span>' : '') + '</div>';
      html += '<div class="msg-convo-preview">' + escHtml(preview) + '</div>';
      html += '</div>';
      html += '<div class="msg-convo-time">' + _msgTimeLabel(c.lastMsg.sentAt) + '</div>';
      html += '</div>';
    }
    html += '</div>';
  }

  html += '</div>';

  root.innerHTML = html;

  document.getElementById('edu-messages-back')?.addEventListener('click', function() { go('s-edu-dash'); });
  document.getElementById('btn-compose-new')?.addEventListener('click', function() { renderEduComposeMessage(); });

  root.querySelectorAll('.msg-convo-row').forEach(function(row) {
    row.addEventListener('click', function() {
      var cid = this.getAttribute('data-convo-id');
      renderEduConversation(cid);
    });
  });
}

function renderEduConversation(otherProfileId) {
  var root = document.getElementById('edu-messages-root');
  if (!root || !activeProfile) return;

  markConversationRead(activeProfile.id, otherProfileId);

  var msgs = getMessages().filter(function(m) {
    return (m.fromId === activeProfile.id && m.toId === otherProfileId) ||
           (m.fromId === otherProfileId && m.toId === activeProfile.id);
  });
  msgs.sort(function(a, b) { return new Date(a.sentAt) - new Date(b.sentAt); });

  var otherHandle = msgs.length > 0 ? (msgs[0].fromId === otherProfileId ? msgs[0].fromHandle : msgs[0].toHandle) : 'Unknown';
  var isEdu = _msgIsEducator(otherProfileId);

  var html = '';

  html += '<div class="edu-topbar">';
  html += '<div class="edu-back" id="edu-convo-back">←</div>';
  html += '<div class="msg-convo-ava" style="width:32px;height:32px;font-size:16px;">' + _msgGetAvatar(otherProfileId) + '</div>';
  html += '<div class="edu-brand">';
  html += '<div class="edu-brand-name">' + escHtml(otherHandle) + (isEdu ? ' <span class="edu-badge">EDU</span>' : '') + '</div>';
  html += '<div class="edu-brand-sub">Conversation</div>';
  html += '</div>';
  html += '</div>';

  html += '<div class="edu-content" id="edu-convo-scroll" style="padding-bottom:70px;">';

  if (msgs.length === 0) {
    html += '<div class="edu-empty" style="padding:30px;">';
    html += '<div style="font-size:11px;">No messages yet. Send one below.</div>';
    html += '</div>';
  } else {
    var lastDate = '';
    for (var i = 0; i < msgs.length; i++) {
      var m = msgs[i];
      var dateLabel = _msgDateSep(m.sentAt);
      if (dateLabel !== lastDate) {
        html += '<div class="msg-date-sep">' + dateLabel + '</div>';
        lastDate = dateLabel;
      }
      var isMine = m.fromId === activeProfile.id;
      var time = new Date(m.sentAt).toLocaleTimeString(undefined, { hour:'numeric', minute:'2-digit' });
      html += '<div style="display:flex;flex-direction:column;align-items:' + (isMine ? 'flex-end' : 'flex-start') + ';">';
      html += '<div class="msg-bubble ' + (isMine ? 'msg-bubble-sent' : 'msg-bubble-recv') + '">' + escHtml(m.text) + '</div>';
      html += '<div class="msg-bubble-time" style="text-align:' + (isMine ? 'right' : 'left') + ';">' + time + (isMine && m.read ? ' ✓' : '') + '</div>';
      html += '</div>';
    }
  }

  html += '</div>';

  var _senderIsStudent = !_msgIsEducator(activeProfile.id);

  html += '<div class="msg-compose-bar">';
  if (_senderIsStudent) {
    html += '<div class="msg-template-picker">';
    var _tpls = getEffectiveTemplatesForStudent(activeProfile.id);
    for (var _ti = 0; _ti < _tpls.length; _ti++) {
      var _t = _tpls[_ti];
      html += '<button class="msg-template-btn" data-tid="' + escHtml(_t.id) + '" data-ttext="' + escHtml(_t.text) + '">' + escHtml(_t.text) + '</button>';
    }
    html += '</div>';
  } else {
    html += '<textarea class="msg-compose-input" id="edu-msg-input" placeholder="Type a message..." rows="1" maxlength="500"></textarea>';
    html += '<button class="msg-send-btn" id="edu-msg-send">▶</button>';
  }
  html += '</div>';

  root.innerHTML = html;

  var scrollEl = document.getElementById('edu-convo-scroll');
  if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;

  if (_senderIsStudent) {
    root.querySelectorAll('.msg-template-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var tid = this.getAttribute('data-tid');
        var txt = this.getAttribute('data-ttext');
        sendMessage(activeProfile.id, activeProfile.handle, otherProfileId, otherHandle, txt, { templateId: tid });
        renderEduConversation(otherProfileId);
      });
    });
  } else {
    var textarea = document.getElementById('edu-msg-input');
    if (textarea) {
      textarea.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = Math.min(this.scrollHeight, 80) + 'px';
      });
      textarea.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          document.getElementById('edu-msg-send')?.click();
        }
      });
    }
  }

  document.getElementById('edu-convo-back')?.addEventListener('click', function() { renderEduMessages(); });
  document.getElementById('edu-msg-send')?.addEventListener('click', function() {
    var input = document.getElementById('edu-msg-input');
    if (!input || !input.value.trim()) return;
    sendMessage(activeProfile.id, activeProfile.handle, otherProfileId, otherHandle, input.value);
    renderEduConversation(otherProfileId);
  });
}

function renderEduComposeMessage() {
  var root = document.getElementById('edu-messages-root');
  if (!root || !activeProfile) return;

  var recipients = [];
  var seen = {};

  var students = typeof getLinkedStudents === 'function' ? getLinkedStudents() : [];
  for (var i = 0; i < students.length; i++) {
    var s = students[i];
    if (s.player_id && !seen[s.player_id]) {
      recipients.push({ id: s.player_id, handle: s.handle || 'Unknown', isEdu: false, avatar: s.avatar_svg });
      seen[s.player_id] = true;
    }
  }

  var allP = window.allProfiles || [];
  for (var j = 0; j < allP.length; j++) {
    var p = allP[j];
    if (p.id !== activeProfile.id && p.isEducator && !seen[p.id]) {
      recipients.push({ id: p.id, handle: p.handle, isEdu: true, avatar: p.avatar && p.avatar.svg });
      seen[p.id] = true;
    }
  }

  var groups = typeof getEduGroups === 'function' ? getEduGroups() : [];

  var html = '';

  html += '<div class="edu-topbar">';
  html += '<div class="edu-back" id="edu-compose-back">←</div>';
  html += '<div class="edu-brand"><div class="edu-brand-name">New Message</div><div class="edu-brand-sub">EDU</div></div>';
  html += '</div>';

  html += '<div class="edu-content">';

  if (groups.length > 0 || students.length > 0) {
    html += '<div class="edu-card">';
    html += '<h3>Quick Broadcast</h3>';
    html += '<div style="font-size:10px;color:var(--dim);margin-bottom:10px;">Send one message to an entire group.</div>';
    html += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;">';
    if (students.length > 0) {
      html += '<div class="msg-recipient-chip" data-broadcast="all" style="cursor:pointer;">📢 All Students (' + students.length + ')</div>';
    }
    for (var g = 0; g < groups.length; g++) {
      html += '<div class="msg-recipient-chip" data-broadcast="' + escHtml(groups[g].id) + '" style="cursor:pointer;">📢 ' + escHtml(groups[g].name) + ' (' + groups[g].studentIds.length + ')</div>';
    }
    html += '</div>';
    html += '<textarea class="msg-compose-input" id="broadcast-text" placeholder="Type your broadcast message..." rows="3" maxlength="500" style="width:100%;margin-bottom:8px;border-radius:10px;"></textarea>';
    html += '<button class="edu-btn" id="btn-send-broadcast" style="width:100%;font-size:13px;">Send Broadcast</button>';
    html += '</div>';
  }

  html += '<div class="edu-card">';
  html += '<h3>Send to Individual</h3>';

  if (recipients.length === 0) {
    html += '<div style="text-align:center;padding:12px 0;font-size:11px;color:var(--dim);">No linked profiles found. Students must join your class first.</div>';
  } else {
    for (var k = 0; k < recipients.length; k++) {
      var r = recipients[k];
      var ava = r.avatar ? '<img src="' + r.avatar + '" style="width:28px;height:28px;border-radius:50%;object-fit:cover;">' : '💬';
      html += '<div class="msg-convo-row" data-recipient-id="' + escHtml(r.id) + '" data-recipient-handle="' + escHtml(r.handle) + '" style="padding:8px 0;">';
      html += '<div class="msg-convo-ava" style="width:28px;height:28px;font-size:14px;">' + ava + '</div>';
      html += '<div class="msg-convo-info">';
      html += '<div class="msg-convo-name" style="font-size:12px;">' + escHtml(r.handle) + (r.isEdu ? ' <span class="edu-badge">EDU</span>' : '') + '</div>';
      html += '</div>';
      html += '<div style="color:var(--edu-accent);font-size:13px;cursor:pointer;">💬</div>';
      html += '</div>';
    }
  }

  html += '</div>';
  html += '</div>';

  root.innerHTML = html;

  document.getElementById('edu-compose-back')?.addEventListener('click', function() { renderEduMessages(); });

  root.querySelectorAll('[data-recipient-id]').forEach(function(row) {
    row.addEventListener('click', function() {
      var rid = this.getAttribute('data-recipient-id');
      renderEduConversation(rid);
    });
  });

  var selectedBroadcast = null;
  root.querySelectorAll('[data-broadcast]').forEach(function(chip) {
    chip.addEventListener('click', function() {
      root.querySelectorAll('[data-broadcast]').forEach(function(c) { c.classList.remove('selected'); });
      this.classList.add('selected');
      selectedBroadcast = this.getAttribute('data-broadcast');
    });
  });

  document.getElementById('btn-send-broadcast')?.addEventListener('click', function() {
    var text = document.getElementById('broadcast-text')?.value;
    if (!text || !text.trim()) { showToast('Enter a message'); return; }
    if (!selectedBroadcast) { showToast('Select a group first'); return; }

    var targets = [];
    var targetHandles = [];
    if (selectedBroadcast === 'all') {
      for (var i = 0; i < students.length; i++) {
        targets.push(students[i].player_id);
        targetHandles.push(students[i].handle || 'Unknown');
      }
    } else {
      var grp = groups.find(function(g) { return g.id === selectedBroadcast; });
      if (grp) {
        for (var j = 0; j < students.length; j++) {
          if (grp.studentIds.includes(students[j].player_id)) {
            targets.push(students[j].player_id);
            targetHandles.push(students[j].handle || 'Unknown');
          }
        }
      }
    }

    if (targets.length === 0) { showToast('No recipients in selection'); return; }

    sendBroadcast(activeProfile.id, activeProfile.handle, targets, targetHandles, text);
    showToast('Sent to ' + targets.length + ' profile' + (targets.length !== 1 ? 's' : '') + '!');
    renderEduMessages();
  });
}

function showStudentInbox() {
  var profile = window.activeProfile;
  if (!profile) return;

  var convos = getConversationsForProfile(profile.id);

  var overlay = document.createElement('div');
  overlay.className = 'msg-inbox-overlay';
  overlay.id = 'student-inbox-overlay';

  var html = '';
  html += '<div class="msg-inbox-topbar">';
  html += '<div class="msg-inbox-back" id="inbox-overlay-back">←</div>';
  html += '<div style="flex:1;"><div style="font-weight:800;font-size:16px;color:#fff;">Messages</div>';
  html += '<div style="font-size:10px;color:var(--dim);">' + convos.length + ' conversation' + (convos.length !== 1 ? 's' : '') + '</div></div>';
  html += '</div>';

  html += '<div class="msg-inbox-body" id="inbox-body">';

  if (convos.length === 0) {
    html += '<div style="text-align:center;padding:40px 20px;color:var(--dim);font-size:13px;">';
    html += '<div style="font-size:48px;margin-bottom:12px;">💬</div>';
    html += '<div style="font-size:15px;color:#fff;font-weight:700;">No messages</div>';
    html += '<div style="margin-top:6px;">Messages from your linked educators will appear here.</div>';
    html += '</div>';
  } else {
    for (var i = 0; i < convos.length; i++) {
      var c = convos[i];
      var ava = _msgGetAvatar(c.profileId);
      var preview = c.lastMsg ? (c.lastMsg.fromId === profile.id ? 'You: ' : '') + c.lastMsg.text : '';
      if (preview.length > 50) preview = preview.slice(0, 47) + '...';
      var isEdu = _msgIsEducator(c.profileId);

      html += '<div class="msg-convo-row" data-sinbox-id="' + escHtml(c.profileId) + '" style="border-bottom:1px solid var(--border);cursor:pointer;">';
      html += '<div class="msg-convo-ava">' + ava + (c.unread > 0 ? '<div class="msg-unread-dot"></div>' : '') + '</div>';
      html += '<div class="msg-convo-info">';
      html += '<div class="msg-convo-name">' + escHtml(c.handle) + (isEdu ? ' <span style="display:inline-block;background:var(--blue);color:#fff;font-size:8px;font-weight:800;padding:2px 6px;border-radius:4px;margin-left:4px;">EDU</span>' : '') + '</div>';
      html += '<div class="msg-convo-preview">' + escHtml(preview) + '</div>';
      html += '</div>';
      html += '<div class="msg-convo-time">' + _msgTimeLabel(c.lastMsg.sentAt) + '</div>';
      html += '</div>';
    }
  }

  html += '</div>';
  overlay.innerHTML = html;
  document.body.appendChild(overlay);

  document.getElementById('inbox-overlay-back')?.addEventListener('click', function() {
    overlay.remove();
  });

  overlay.querySelectorAll('[data-sinbox-id]').forEach(function(row) {
    row.addEventListener('click', function() {
      var otherId = this.getAttribute('data-sinbox-id');
      _showStudentConversation(overlay, otherId);
    });
  });
}

function _showStudentConversation(overlay, otherProfileId) {
  var profile = window.activeProfile;
  if (!profile) return;

  markConversationRead(profile.id, otherProfileId);

  var msgs = getMessages().filter(function(m) {
    return (m.fromId === profile.id && m.toId === otherProfileId) ||
           (m.fromId === otherProfileId && m.toId === profile.id);
  });
  msgs.sort(function(a, b) { return new Date(a.sentAt) - new Date(b.sentAt); });

  var otherHandle = msgs.length > 0 ? (msgs[0].fromId === otherProfileId ? msgs[0].fromHandle : msgs[0].toHandle) : 'Unknown';
  var isEdu = _msgIsEducator(otherProfileId);

  var html = '';
  html += '<div class="msg-inbox-topbar">';
  html += '<div class="msg-inbox-back" id="sinbox-convo-back">←</div>';
  html += '<div style="display:flex;align-items:center;gap:8px;flex:1;">';
  html += '<div class="msg-convo-ava" style="width:28px;height:28px;font-size:14px;">' + _msgGetAvatar(otherProfileId) + '</div>';
  html += '<div><div style="font-weight:700;font-size:14px;color:#fff;">' + escHtml(otherHandle) + (isEdu ? ' <span style="display:inline-block;background:var(--blue);color:#fff;font-size:8px;font-weight:800;padding:2px 5px;border-radius:4px;margin-left:4px;">EDU</span>' : '') + '</div></div>';
  html += '</div>';
  html += '</div>';

  html += '<div class="msg-inbox-body" id="sinbox-scroll" style="padding-bottom:70px;">';

  if (msgs.length === 0) {
    html += '<div style="text-align:center;padding:30px;color:var(--dim);font-size:11px;">No messages yet.</div>';
  } else {
    var lastDate = '';
    for (var i = 0; i < msgs.length; i++) {
      var m = msgs[i];
      var dateLabel = _msgDateSep(m.sentAt);
      if (dateLabel !== lastDate) {
        html += '<div class="msg-date-sep">' + dateLabel + '</div>';
        lastDate = dateLabel;
      }
      var isMine = m.fromId === profile.id;
      var time = new Date(m.sentAt).toLocaleTimeString(undefined, { hour:'numeric', minute:'2-digit' });
      html += '<div style="display:flex;flex-direction:column;align-items:' + (isMine ? 'flex-end' : 'flex-start') + ';">';
      html += '<div class="msg-bubble ' + (isMine ? 'msg-bubble-sent' : 'msg-bubble-recv') + '">' + escHtml(m.text) + '</div>';
      html += '<div class="msg-bubble-time" style="text-align:' + (isMine ? 'right' : 'left') + ';">' + time + '</div>';
      html += '</div>';
    }
  }

  html += '</div>';

  var _senderIsStudent = !_msgIsEducator(profile.id);

  html += '<div class="msg-compose-bar" style="position:fixed;bottom:0;left:0;right:0;z-index:10000;">';
  if (_senderIsStudent) {
    html += '<div class="msg-template-picker">';
    var _tpls = getEffectiveTemplatesForStudent(profile.id);
    for (var _ti = 0; _ti < _tpls.length; _ti++) {
      var _t = _tpls[_ti];
      html += '<button class="msg-template-btn" data-tid="' + escHtml(_t.id) + '" data-ttext="' + escHtml(_t.text) + '">' + escHtml(_t.text) + '</button>';
    }
    html += '</div>';
  } else {
    html += '<textarea class="msg-compose-input" id="sinbox-msg-input" placeholder="Type a message..." rows="1" maxlength="500" style="background:var(--bg-panel);border:1px solid var(--border);"></textarea>';
    html += '<button class="msg-send-btn" id="sinbox-msg-send" style="background:var(--blue);">▶</button>';
  }
  html += '</div>';

  overlay.innerHTML = html;

  var scrollEl = document.getElementById('sinbox-scroll');
  if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;

  if (_senderIsStudent) {
    overlay.querySelectorAll('.msg-template-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var tid = this.getAttribute('data-tid');
        var txt = this.getAttribute('data-ttext');
        sendMessage(profile.id, profile.handle, otherProfileId, otherHandle, txt, { templateId: tid });
        _showStudentConversation(overlay, otherProfileId);
      });
    });
  } else {
    var textarea = document.getElementById('sinbox-msg-input');
    if (textarea) {
      textarea.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = Math.min(this.scrollHeight, 80) + 'px';
      });
      textarea.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          document.getElementById('sinbox-msg-send')?.click();
        }
      });
    }
  }

  document.getElementById('sinbox-convo-back')?.addEventListener('click', function() {
    overlay.remove();
    showStudentInbox();
  });

  document.getElementById('sinbox-msg-send')?.addEventListener('click', function() {
    var input = document.getElementById('sinbox-msg-input');
    if (!input || !input.value.trim()) return;
    sendMessage(profile.id, profile.handle, otherProfileId, otherHandle, input.value);
    _showStudentConversation(overlay, otherProfileId);
  });
}

function renderEduPlaceholder(rootId, title, icon) {
  var root = document.getElementById(rootId);
  if (!root) return;

  var html = '';
  html += '<div class="edu-topbar">';
  html += '<div class="edu-back" id="' + rootId + '-back">←</div>';
  html += '<div class="edu-logo"><span class="edu-logo-text">MG</span></div>';
  html += '<div class="edu-brand"><div class="edu-brand-name">' + title + '</div><div class="edu-brand-sub">EDU</div></div>';
  html += '</div>';
  html += '<div class="edu-content">';
  html += '<div class="edu-empty">';
  html += '<div style="font-size:48px;margin-bottom:12px;">' + icon + '</div>';
  html += '<div style="font-size:15px;color:#fff;font-weight:700;">' + title + '</div>';
  html += '<div style="margin-top:6px;">Coming soon in a future update.</div>';
  html += '</div>';
  html += '</div>';

  root.innerHTML = html;

  document.getElementById(rootId + '-back')?.addEventListener('click', function() { go('s-edu-dash'); });
}

(function wireEducatorRouter() {
  var _eduGo = go;
  go = function(id) {
    _eduGo(id);
    if (id === 's-edu-dash') renderEduDashboard();
    if (id === 's-edu-students') renderEduStudents();
    if (id === 's-edu-search') renderEduSearch();
    if (id === 's-edu-competitions') renderEduCompetitions();
    if (id === 's-edu-tests') renderEduTests();
    if (id === 's-edu-cards') renderEduCards();
    if (id === 's-edu-messages') renderEduMessages();
  };
})();


const COMP_KEY_PREFIX = 'nsg_competitions_';

const COMP_CONTINENTS = [
  { key: 'globe', label: 'Globe' },
  { key: 'europe', label: 'Europe' },
  { key: 'africa', label: 'Africa' },
  { key: 'asia', label: 'Asia' },
  { key: 'north-america', label: 'N. America' },
  { key: 'south-america', label: 'S. America' },
  { key: 'oceania', label: 'Oceania' },
];

function getCompetitions() {
  if (!activeProfile) return [];
  try {
    var raw = localStorage.getItem(COMP_KEY_PREFIX + activeProfile.id);
    return raw ? JSON.parse(raw) : [];
  } catch (e) { return []; }
}

function saveCompetitions(list) {
  if (!activeProfile) return;
  try {
    localStorage.setItem(COMP_KEY_PREFIX + activeProfile.id, JSON.stringify(list));
  } catch (e) { console.warn('[competitions] Save failed:', e); }
}

function getCompetitionResults(compId) {
  try {
    var raw = localStorage.getItem('nsg_comp_results_' + compId);
    return raw ? JSON.parse(raw) : [];
  } catch (e) { return []; }
}

function saveCompetitionResult(compId, result) {
  var results = getCompetitionResults(compId);
  var idx = results.findIndex(function(r) { return r.playerId === result.playerId; });
  if (idx >= 0) {
    if (result.score > results[idx].score) results[idx] = result;
  } else {
    results.push(result);
  }
  results.sort(function(a, b) { return b.score - a.score; });
  try {
    localStorage.setItem('nsg_comp_results_' + compId, JSON.stringify(results));
  } catch (e) { console.warn('[competitions] Result save failed:', e); }

  if (isSupabaseConfigured()) {
    syncStore._enqueue({
      table: 'competition_results',
      payload: {
        competition_id: compId,
        player_id: result.playerId,
        handle: result.handle,
        avatar_svg: result.avatarSvg || '',
        score: result.score,
        correct: result.correct,
        wrong: result.wrong,
        accuracy: result.accuracy,
        best_streak: result.streak,
        elapsed: result.elapsed,
        played_at: new Date().toISOString()
      }
    });
    syncStore.processQueue();
  }
}

function getCompStatus(comp) {
  var now = Date.now();
  var start = new Date(comp.startTime).getTime();
  var end = new Date(comp.endTime).getTime();
  if (now < start) return 'upcoming';
  if (now >= start && now <= end) return 'active';
  return 'ended';
}

function fmtCompDate(iso) {
  if (!iso) return '—';
  var d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    + ' ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function createCompetition(data) {
  var comp = {
    id: 'comp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    educatorId: activeProfile.id,
    name: data.name,
    continent: data.continent,
    categories: data.categories,
    tierCeiling: data.tierCeiling,
    mode: data.mode,
    duration: data.duration,
    startTime: data.startTime,
    endTime: data.endTime,
    createdAt: new Date().toISOString()
  };

  var list = getCompetitions();
  list.unshift(comp);
  saveCompetitions(list);

  if (isSupabaseConfigured()) {
    syncStore._enqueue({
      table: 'competitions',
      payload: {
        id: comp.id,
        educator_id: comp.educatorId,
        name: comp.name,
        continent: comp.continent,
        categories: comp.categories,
        tier_ceiling: comp.tierCeiling,
        mode: comp.mode,
        duration: comp.duration,
        start_time: comp.startTime,
        end_time: comp.endTime,
        created_at: comp.createdAt
      }
    });
    syncStore.processQueue();
  }

  showToast('Competition created! 🏆');
  return comp;
}

function deleteCompetition(compId) {
  var list = getCompetitions().filter(function(t) { return t.id !== compId; });
  saveCompetitions(list);
  try { localStorage.removeItem('nsg_comp_results_' + compId); } catch (e) {}
  showToast('Competition deleted');
}

function getActiveCompetitionsForStudent() {
  if (!activeProfile || !activeProfile.linkedEducators) return [];
  var active = [];
  activeProfile.linkedEducators.forEach(function(code) {
    for (var i = 0; i < localStorage.length; i++) {
      var key = localStorage.key(i);
      if (key && key.startsWith(COMP_KEY_PREFIX)) {
        try {
          var comps = JSON.parse(localStorage.getItem(key));
          comps.forEach(function(t) {
            if (getCompStatus(t) === 'active') {
              active.push(t);
            }
          });
        } catch (e) {}
      }
    }
  });
  var seen = {};
  return active.filter(function(t) {
    if (seen[t.id]) return false;
    seen[t.id] = true;
    return true;
  });
}

function renderEduCompetitions() {
  var root = document.getElementById('edu-competitions-root');
  if (!root || !activeProfile) return;

  var competitions = getCompetitions();
  var html = '';

  html += '<div class="edu-topbar">';
  html += '<div class="edu-back" id="edu-comp-back">←</div>';
  html += '<div class="edu-logo"><span class="edu-logo-text">MG</span></div>';
  html += '<div class="edu-brand"><div class="edu-brand-name">Competitions</div><div class="edu-brand-sub">EDU</div></div>';
  html += '<div style="flex:1;"></div>';
  html += '<button class="edu-btn" id="btn-create-comp" style="font-size:11px;padding:8px 14px;">+ New</button>';
  html += '</div>';

  html += '<div class="edu-content">';

  if (!competitions.length) {
    html += '<div class="edu-empty">';
    html += '<div style="font-size:48px;margin-bottom:12px;">🏆</div>';
    html += '<div style="font-size:15px;color:#fff;font-weight:700;">No Competitions Yet</div>';
    html += '<div style="margin-top:6px;">Create a competition for your students.</div>';
    html += '</div>';
  } else {
    var groups = { active: [], upcoming: [], ended: [] };
    competitions.forEach(function(t) { groups[getCompStatus(t)].push(t); });

    if (groups.active.length) {
      html += '<div class="edu-card"><h3 style="color:var(--correct);">🟢 Active</h3>';
      groups.active.forEach(function(t) { html += renderCompItem(t); });
      html += '</div>';
    }
    if (groups.upcoming.length) {
      html += '<div class="edu-card"><h3 style="color:var(--yellow);">⏳ Upcoming</h3>';
      groups.upcoming.forEach(function(t) { html += renderCompItem(t); });
      html += '</div>';
    }
    if (groups.ended.length) {
      html += '<div class="edu-card"><h3>📋 Past</h3>';
      groups.ended.forEach(function(t) { html += renderCompItem(t); });
      html += '</div>';
    }
  }

  html += '</div>';
  root.innerHTML = html;

  document.getElementById('edu-comp-back')?.addEventListener('click', function() { go('s-edu-dash'); });
  document.getElementById('btn-create-comp')?.addEventListener('click', function() { renderCompCreate(); });

  root.querySelectorAll('.comp-item').forEach(function(el) {
    el.addEventListener('click', function() {
      var tid = this.getAttribute('data-tid');
      renderCompDetail(tid);
    });
  });
}

function renderCompItem(t) {
  var status = getCompStatus(t);
  var statusLabel = status === 'active' ? 'LIVE' : status === 'upcoming' ? 'UPCOMING' : 'ENDED';
  var results = getCompetitionResults(t.id);
  var contLabel = COMP_CONTINENTS.find(function(c) { return c.key === t.continent; });
  contLabel = contLabel ? contLabel.label : t.continent;

  var html = '<div class="comp-item" data-tid="' + t.id + '">';
  html += '<div style="display:flex;justify-content:space-between;align-items:center;">';
  html += '<div class="comp-name">' + escHtml(t.name) + '</div>';
  html += '<span class="comp-status ' + status + '">' + statusLabel + '</span>';
  html += '</div>';
  html += '<div class="comp-meta">' + contLabel + ' · ' + (t.mode === 'timed' ? 'Timed' : 'All Cards') + ' · ' + results.length + ' result' + (results.length !== 1 ? 's' : '') + '</div>';
  html += '<div class="comp-meta">' + fmtCompDate(t.startTime) + ' → ' + fmtCompDate(t.endTime) + '</div>';
  html += '</div>';
  return html;
}

function renderCompCreate() {
  var root = document.getElementById('edu-competitions-root');
  if (!root) return;

  var now = new Date();
  var tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  var startStr = now.toISOString().slice(0, 16);
  var endStr = tomorrow.toISOString().slice(0, 16);

  var html = '';

  html += '<div class="edu-topbar">';
  html += '<div class="edu-back" id="comp-create-back">←</div>';
  html += '<div class="edu-brand"><div class="edu-brand-name">New Competition</div><div class="edu-brand-sub">EDU</div></div>';
  html += '</div>';

  html += '<div class="edu-content">';
  html += '<div class="edu-card">';

  html += '<div class="comp-form-group">';
  html += '<label>Competition Name</label>';
  html += '<input type="text" class="comp-input" id="comp-name" placeholder="e.g. Friday Geography Challenge" maxlength="60">';
  html += '</div>';

  html += '<div class="comp-form-group">';
  html += '<label>Start Time</label>';
  html += '<input type="datetime-local" class="comp-input" id="comp-start" value="' + startStr + '">';
  html += '</div>';
  html += '<div class="comp-form-group">';
  html += '<label>End Time</label>';
  html += '<input type="datetime-local" class="comp-input" id="comp-end" value="' + endStr + '">';
  html += '</div>';

  html += '<div class="comp-form-group">';
  html += '<label>Continent</label>';
  html += '<div class="comp-row" id="comp-cont-row">';
  COMP_CONTINENTS.forEach(function(c, i) {
    html += '<div class="comp-chip' + (i === 0 ? ' on' : '') + '" data-cont="' + c.key + '">' + c.label + '</div>';
  });
  html += '</div></div>';

  html += '<div class="comp-form-group">';
  html += '<label>Categories</label>';
  html += '<div class="comp-row" id="comp-cat-row">';
  CATEGORIES.forEach(function(cat) {
    var defaultOn = cat.key === 'countries' || cat.key === 'capitals' || cat.key === 'flags';
    html += '<div class="comp-chip' + (defaultOn ? ' on' : '') + '" data-cat="' + cat.key + '">' + cat.icon + ' ' + cat.label + '</div>';
  });
  html += '</div></div>';

  html += '<div class="comp-form-group">';
  html += '<label>Tier Ceiling</label>';
  html += '<div style="display:flex;align-items:center;gap:10px;">';
  html += '<input type="range" id="comp-tier" min="1" max="13" value="7" style="flex:1;accent-color:var(--edu-accent);">';
  html += '<span id="comp-tier-lbl" style="font-family:\'Space Mono\',monospace;font-size:13px;font-weight:700;color:var(--edu-accent);min-width:90px;text-align:right;">T7 · Voyager</span>';
  html += '</div></div>';

  html += '<div class="comp-form-group">';
  html += '<label>Mode</label>';
  html += '<div class="comp-row" id="comp-mode-row">';
  html += '<div class="comp-chip on" data-mode="timed">⏱ Timed</div>';
  html += '<div class="comp-chip" data-mode="all">📋 All Cards</div>';
  html += '</div></div>';

  html += '<div class="comp-form-group" id="comp-dur-wrap">';
  html += '<label>Duration</label>';
  html += '<div class="comp-row" id="comp-dur-row">';
  [60, 180, 300].forEach(function(sec) {
    var lbl = sec < 60 ? sec + 's' : (sec / 60) + ' min';
    html += '<div class="comp-chip' + (sec === 180 ? ' on' : '') + '" data-dur="' + sec + '">' + lbl + '</div>';
  });
  html += '</div></div>';

  html += '<button class="edu-btn" id="btn-comp-submit" style="width:100%;margin-top:10px;padding:14px;font-size:14px;">🏆 Create Competition</button>';

  html += '</div>';
  html += '</div>';

  root.innerHTML = html;

  var formState = { continent: 'globe', categories: { countries: true, capitals: true, flags: true }, tier: 7, mode: 'timed', duration: 180 };

  document.getElementById('comp-create-back')?.addEventListener('click', function() { renderEduCompetitions(); });

  document.getElementById('comp-cont-row')?.querySelectorAll('.comp-chip').forEach(function(chip) {
    chip.addEventListener('click', function() {
      document.getElementById('comp-cont-row').querySelectorAll('.comp-chip').forEach(function(c) { c.classList.remove('on'); });
      this.classList.add('on');
      formState.continent = this.getAttribute('data-cont');
    });
  });

  document.getElementById('comp-cat-row')?.querySelectorAll('.comp-chip').forEach(function(chip) {
    chip.addEventListener('click', function() {
      this.classList.toggle('on');
      var key = this.getAttribute('data-cat');
      formState.categories[key] = this.classList.contains('on');
    });
  });

  var tierSlider = document.getElementById('comp-tier');
  var tierLbl = document.getElementById('comp-tier-lbl');
  if (tierSlider) {
    tierSlider.addEventListener('input', function() {
      formState.tier = parseInt(this.value);
      tierLbl.textContent = 'T' + formState.tier + ' · ' + (TIER_LABELS[formState.tier - 1] || '');
    });
  }

  document.getElementById('comp-mode-row')?.querySelectorAll('.comp-chip').forEach(function(chip) {
    chip.addEventListener('click', function() {
      document.getElementById('comp-mode-row').querySelectorAll('.comp-chip').forEach(function(c) { c.classList.remove('on'); });
      this.classList.add('on');
      formState.mode = this.getAttribute('data-mode');
      document.getElementById('comp-dur-wrap').style.display = formState.mode === 'timed' ? '' : 'none';
    });
  });

  document.getElementById('comp-dur-row')?.querySelectorAll('.comp-chip').forEach(function(chip) {
    chip.addEventListener('click', function() {
      document.getElementById('comp-dur-row').querySelectorAll('.comp-chip').forEach(function(c) { c.classList.remove('on'); });
      this.classList.add('on');
      formState.duration = parseInt(this.getAttribute('data-dur'));
    });
  });

  document.getElementById('btn-comp-submit')?.addEventListener('click', function() {
    var name = (document.getElementById('comp-name').value || '').trim();
    if (!name) { showToast('Enter a competition name'); return; }

    var startVal = document.getElementById('comp-start').value;
    var endVal = document.getElementById('comp-end').value;
    if (!startVal || !endVal) { showToast('Set start and end times'); return; }

    var startTime = new Date(startVal).toISOString();
    var endTime = new Date(endVal).toISOString();
    if (new Date(endVal) <= new Date(startVal)) { showToast('End time must be after start'); return; }

    var anyCat = Object.values(formState.categories).some(function(v) { return v; });
    if (!anyCat) { showToast('Select at least one category'); return; }

    createCompetition({
      name: name,
      continent: formState.continent,
      categories: formState.categories,
      tierCeiling: formState.tier,
      mode: formState.mode,
      duration: formState.duration,
      startTime: startTime,
      endTime: endTime
    });

    renderEduCompetitions();
  });
}

function renderCompDetail(compId) {
  var root = document.getElementById('edu-competitions-root');
  if (!root) return;

  var competitions = getCompetitions();
  var comp = competitions.find(function(t) { return t.id === compId; });
  if (!comp) { renderEduCompetitions(); return; }

  var results = getCompetitionResults(compId);
  var status = getCompStatus(comp);
  var statusLabel = status === 'active' ? 'LIVE' : status === 'upcoming' ? 'UPCOMING' : 'ENDED';
  var contLabel = COMP_CONTINENTS.find(function(c) { return c.key === comp.continent; });
  contLabel = contLabel ? contLabel.label : comp.continent;
  var catList = Object.keys(comp.categories || {}).filter(function(k) { return comp.categories[k]; });

  var html = '';

  html += '<div class="edu-topbar">';
  html += '<div class="edu-back" id="comp-detail-back">←</div>';
  html += '<div class="edu-brand"><div class="edu-brand-name">' + escHtml(comp.name) + '</div><div class="edu-brand-sub">EDU</div></div>';
  html += '</div>';

  html += '<div class="edu-content">';

  html += '<div class="edu-card">';
  html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">';
  html += '<h3 style="margin:0;">Competition Info</h3>';
  html += '<span class="comp-status ' + status + '">' + statusLabel + '</span>';
  html += '</div>';

  html += '<div style="font-size:12px;color:var(--text);line-height:1.7;">';
  html += '<strong>Region:</strong> ' + contLabel + '<br>';
  html += '<strong>Categories:</strong> ' + (catList.length ? catList.join(', ') : 'None') + '<br>';
  html += '<strong>Tier:</strong> T' + (comp.tierCeiling || '?') + ' · ' + (TIER_LABELS[(comp.tierCeiling || 1) - 1] || '') + '<br>';
  html += '<strong>Mode:</strong> ' + (comp.mode === 'timed' ? 'Timed (' + (comp.duration >= 60 ? (comp.duration / 60) + ' min' : comp.duration + 's') + ')' : 'All Cards') + '<br>';
  html += '<strong>Window:</strong> ' + fmtCompDate(comp.startTime) + ' → ' + fmtCompDate(comp.endTime);
  html += '</div>';
  html += '</div>';

  if (results.length) {
    var avgScore = Math.round(results.reduce(function(a, r) { return a + r.score; }, 0) / results.length);
    var avgAcc = Math.round(results.reduce(function(a, r) { return a + (r.accuracy || 0); }, 0) / results.length * 100);
    var topScore = results[0].score;

    html += '<div class="edu-stats-row">';
    html += '<div class="edu-stat-card"><div class="edu-stat-val">' + results.length + '</div><div class="edu-stat-lbl">Players</div></div>';
    html += '<div class="edu-stat-card"><div class="edu-stat-val">' + avgScore.toLocaleString() + '</div><div class="edu-stat-lbl">Avg Score</div></div>';
    html += '<div class="edu-stat-card"><div class="edu-stat-val">' + avgAcc + '%</div><div class="edu-stat-lbl">Avg Accuracy</div></div>';
    html += '</div>';
  }

  html += '<div class="edu-card">';
  html += '<h3>🏆 Leaderboard (' + results.length + ')</h3>';

  if (!results.length) {
    html += '<div class="edu-empty" style="padding:20px;">No results yet.</div>';
  } else {
    results.forEach(function(r, i) {
      var acc = r.accuracy ? Math.round(r.accuracy * 100) + '%' : '—';
      var medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '';

      html += '<div class="comp-lb-row">';
      html += '<div class="comp-lb-rank">' + (medal || (i + 1)) + '</div>';
      html += '<div class="comp-lb-info">';
      html += '<div class="comp-lb-name">' + escHtml(r.handle || 'Unknown') + '</div>';
      html += '<div class="comp-lb-stats">' + acc + ' · ' + (r.correct || 0) + '/' + ((r.correct || 0) + (r.wrong || 0)) + ' · streak ' + (r.streak || 0) + '</div>';
      html += '</div>';
      html += '<div class="comp-lb-score">' + (r.score || 0).toLocaleString() + '</div>';
      html += '</div>';
    });
  }
  html += '</div>';

  if (status === 'active') {
    html += '<button class="edu-btn" id="btn-play-comp" style="width:100%;padding:14px;font-size:14px;background:var(--correct);">▶ Play Competition</button>';
  }
  html += '<button class="edu-btn" id="btn-delete-comp" style="width:100%;margin-top:8px;padding:12px;font-size:12px;background:var(--wrong);margin-bottom:20px;">Delete Competition</button>';

  html += '</div>';
  root.innerHTML = html;

  document.getElementById('comp-detail-back')?.addEventListener('click', function() { renderEduCompetitions(); });

  document.getElementById('btn-play-comp')?.addEventListener('click', function() {
    launchCompetitionGame(comp);
  });

  document.getElementById('btn-delete-comp')?.addEventListener('click', function() {
    if (confirm('Delete "' + comp.name + '"? This cannot be undone.')) {
      deleteCompetition(compId);
      renderEduCompetitions();
    }
  });
}

function launchCompetitionGame(comp) {
  var cats = {};
  CATEGORIES.forEach(function(c) {
    cats[c.key] = !!(comp.categories && comp.categories[c.key]);
  });

  var diff = 'medium';
  if (comp.tierCeiling <= 4) diff = 'easy';
  else if (comp.tierCeiling >= 10) diff = 'extreme';
  else if (comp.tierCeiling >= 7) diff = 'hard';

  window._gameConfig = {
    continent: comp.continent,
    categories: cats,
    difficulty: diff,
    tierCeiling: comp.tierCeiling,
    mode: comp.mode,
    duration: comp.duration || 180,
    hideBorders: false,
    _competition: {
      id: comp.id,
      name: comp.name
    }
  };

  go('s-game');
}

(function patchEndGameForCompetitions() {
  var _origEndGame = endGame;
  endGame = function() {
    var compInfo = null;
    if (_game && _game.config && _game.config._competition) {
      compInfo = {
        id: _game.config._competition.id,
        name: _game.config._competition.name,
        score: _game.score,
        correct: _game.correct,
        wrong: _game.wrong,
        streak: _game.bestStreak,
        elapsed: _game.elapsed,
        cardsAnswered: _game.cardsAnswered,
        answerTimes: _game.answerTimes ? [..._game.answerTimes] : []
      };
    }

    _origEndGame();

    if (compInfo && activeProfile) {
      var total = compInfo.correct + compInfo.wrong;
      var accuracy = total > 0 ? compInfo.correct / total : 0;

      saveCompetitionResult(compInfo.id, {
        playerId: activeProfile.id,
        handle: activeProfile.handle || 'Unknown',
        avatarSvg: activeProfile.avatarSvg || '',
        score: compInfo.score,
        correct: compInfo.correct,
        wrong: compInfo.wrong,
        accuracy: accuracy,
        streak: compInfo.streak,
        elapsed: compInfo.elapsed
      });

    }
  };
})();

function getActiveCompetitionsAll() {
  var active = [];
  for (var i = 0; i < localStorage.length; i++) {
    var key = localStorage.key(i);
    if (key && key.startsWith(COMP_KEY_PREFIX)) {
      try {
        var comps = JSON.parse(localStorage.getItem(key));
        comps.forEach(function(t) {
          if (getCompStatus(t) === 'active') active.push(t);
        });
      } catch (e) {}
    }
  }
  var seen = {};
  return active.filter(function(t) { if (seen[t.id]) return false; seen[t.id] = true; return true; });
}

function injectCompetitionBanners(container) {
  if (!container) return;
  var active = getActiveCompetitionsAll();
  if (!active.length) return;

  active.forEach(function(t) {
    var contLabel = COMP_CONTINENTS.find(function(c) { return c.key === t.continent; });
    contLabel = contLabel ? contLabel.label : t.continent;
    var endTime = new Date(t.endTime);
    var remaining = endTime.getTime() - Date.now();
    var remStr = remaining > 3600000
      ? Math.floor(remaining / 3600000) + 'h ' + Math.floor((remaining % 3600000) / 60000) + 'm left'
      : Math.floor(remaining / 60000) + 'm left';

    var banner = document.createElement('div');
    banner.className = 'comp-banner';
    banner.innerHTML = '<div class="comp-banner-title">🏆 ' + escHtml(t.name) + '</div>' +
      '<div class="comp-banner-sub">' + contLabel + ' · ' + remStr + ' · Tap to play</div>';
    banner.addEventListener('click', function() {
      launchCompetitionGame(t);
    });
    container.insertBefore(banner, container.firstChild);
  });
}

(function patchSetupForCompBanners() {
  var _origRenderSetup = renderSetupSubPage;
  renderSetupSubPage = function(viewKey) {
    _origRenderSetup(viewKey);
    var controls = document.getElementById('setup-controls');
    if (controls) {
      var panel = controls.querySelector('.setup-panel');
      if (panel) {
        injectCompetitionBanners(panel);
      }
    }
  };
})();


const TEST_KEY_PREFIX = 'nsg_tests_';

const DEFAULT_GRADING_SCALE = { A: 90, B: 80, C: 70, D: 60 };

const TEST_CONTINENTS = COMP_CONTINENTS;

function getTests() {
  if (!activeProfile) return [];
  try {
    var raw = localStorage.getItem(TEST_KEY_PREFIX + activeProfile.id);
    return raw ? JSON.parse(raw) : [];
  } catch (e) { return []; }
}

function saveTests(list) {
  if (!activeProfile) return;
  try {
    localStorage.setItem(TEST_KEY_PREFIX + activeProfile.id, JSON.stringify(list));
  } catch (e) { console.warn('[tests] Save failed:', e); }
}

function getTestResults(testId) {
  try {
    var raw = localStorage.getItem('nsg_test_results_' + testId);
    return raw ? JSON.parse(raw) : [];
  } catch (e) { return []; }
}

function saveTestResult(testId, result) {
  var results = getTestResults(testId);
  var idx = results.findIndex(function(r) { return r.playerId === result.playerId; });
  if (idx >= 0) {
    results[idx] = result;
  } else {
    results.push(result);
  }
  results.sort(function(a, b) { return b.score - a.score; });
  try {
    localStorage.setItem('nsg_test_results_' + testId, JSON.stringify(results));
  } catch (e) { console.warn('[tests] Result save failed:', e); }

  if (isSupabaseConfigured()) {
    syncStore._enqueue({
      table: 'test_results',
      payload: {
        test_id: testId,
        player_id: result.playerId,
        handle: result.handle,
        avatar_svg: result.avatarSvg || '',
        answers: result.answers,
        score: result.score,
        accuracy: result.accuracy,
        grade: result.grade,
        completed_at: new Date().toISOString()
      }
    });
    syncStore.processQueue();
  }
}

function generateFixedDeck(config, questionCount) {
  var cd = getCombinedContinentData(config.continent);
  if (!cd) return [];
  var pool = buildPool(config, cd);
  if (pool.length === 0) return [];

  var seed = config._seed || Date.now();
  function seededRandom() {
    seed = (seed * 16807 + 0) % 2147483647;
    return (seed - 1) / 2147483646;
  }

  var shuffled = pool.slice();
  for (var i = shuffled.length - 1; i > 0; i--) {
    var j = Math.floor(seededRandom() * (i + 1));
    var tmp = shuffled[i];
    shuffled[i] = shuffled[j];
    shuffled[j] = tmp;
  }

  var n = Math.min(questionCount, shuffled.length);
  return shuffled.slice(0, n);
}

function computeGrade(accuracyPct, scale) {
  if (!scale) scale = DEFAULT_GRADING_SCALE;
  if (accuracyPct >= scale.A) return 'A';
  if (accuracyPct >= scale.B) return 'B';
  if (accuracyPct >= scale.C) return 'C';
  if (accuracyPct >= scale.D) return 'D';
  return 'F';
}

function createTest(data) {
  var seed = Date.now();
  var deck = generateFixedDeck({
    continent: data.continent,
    categories: data.categories,
    tierCeiling: data.tierCeiling,
    _seed: seed
  }, data.questionCount);

  if (deck.length === 0) {
    showToast('No questions match — adjust settings');
    return null;
  }

  var test = {
    id: 'test_' + seed + '_' + Math.random().toString(36).slice(2, 7),
    educatorId: activeProfile.id,
    name: data.name,
    continent: data.continent,
    categories: data.categories,
    tierCeiling: data.tierCeiling,
    questionCount: deck.length,
    timeLimit: data.timeLimit,
    gradingScale: data.gradingScale || DEFAULT_GRADING_SCALE,
    cardDeck: deck,
    seed: seed,
    active: true,
    createdAt: new Date().toISOString()
  };

  var list = getTests();
  list.unshift(test);
  saveTests(list);

  if (isSupabaseConfigured()) {
    syncStore._enqueue({
      table: 'tests',
      payload: {
        id: test.id,
        educator_id: test.educatorId,
        name: test.name,
        continent: test.continent,
        categories: test.categories,
        tier: test.tierCeiling,
        question_count: test.questionCount,
        time_limit_seconds: test.timeLimit,
        card_deck: test.cardDeck,
        grading_scale: test.gradingScale,
        created_at: test.createdAt
      }
    });
    syncStore.processQueue();
  }

  showToast('Test created! 📝 (' + deck.length + ' questions)');
  return test;
}

function toggleTestActive(testId) {
  var list = getTests();
  var test = list.find(function(t) { return t.id === testId; });
  if (test) {
    test.active = !test.active;
    saveTests(list);
    showToast(test.active ? 'Test reopened' : 'Test closed');
  }
}

function deleteTest(testId) {
  var list = getTests().filter(function(t) { return t.id !== testId; });
  saveTests(list);
  try { localStorage.removeItem('nsg_test_results_' + testId); } catch (e) {}
  showToast('Test deleted');
}

function renderEduTests() {
  var root = document.getElementById('edu-tests-root');
  if (!root || !activeProfile) return;

  var tests = getTests();
  var html = '';

  html += '<div class="edu-topbar">';
  html += '<div class="edu-back" id="edu-tests-back">←</div>';
  html += '<div class="edu-logo"><span class="edu-logo-text">MG</span></div>';
  html += '<div class="edu-brand"><div class="edu-brand-name">Tests & Grading</div><div class="edu-brand-sub">EDU</div></div>';
  html += '<div style="flex:1;"></div>';
  html += '<button class="edu-btn" id="btn-create-test" style="font-size:11px;padding:8px 14px;">+ New</button>';
  html += '</div>';

  html += '<div class="edu-content">';

  if (!tests.length) {
    html += '<div class="edu-empty">';
    html += '<div style="font-size:48px;margin-bottom:12px;">📝</div>';
    html += '<div style="font-size:15px;color:#fff;font-weight:700;">No Tests Yet</div>';
    html += '<div style="margin-top:6px;">Create a test for your students.</div>';
    html += '</div>';
  } else {
    var activeTests = tests.filter(function(t) { return t.active; });
    var closedTests = tests.filter(function(t) { return !t.active; });

    if (activeTests.length) {
      html += '<div class="edu-card"><h3 style="color:var(--correct);">🟢 Active</h3>';
      activeTests.forEach(function(t) { html += renderTestItem(t); });
      html += '</div>';
    }
    if (closedTests.length) {
      html += '<div class="edu-card"><h3>📋 Closed</h3>';
      closedTests.forEach(function(t) { html += renderTestItem(t); });
      html += '</div>';
    }
  }

  html += '</div>';
  root.innerHTML = html;

  document.getElementById('edu-tests-back')?.addEventListener('click', function() { go('s-edu-dash'); });
  document.getElementById('btn-create-test')?.addEventListener('click', function() { renderTestCreate(); });

  root.querySelectorAll('.test-item').forEach(function(el) {
    el.addEventListener('click', function() {
      var tid = this.getAttribute('data-tid');
      renderTestDetail(tid);
    });
  });
}

function renderTestItem(t) {
  var results = getTestResults(t.id);
  var contLabel = TEST_CONTINENTS.find(function(c) { return c.key === t.continent; });
  contLabel = contLabel ? contLabel.label : t.continent;
  var catList = Object.keys(t.categories || {}).filter(function(k) { return t.categories[k]; });
  var statusLabel = t.active ? 'ACTIVE' : 'CLOSED';
  var statusClass = t.active ? 'active' : 'ended';

  var html = '<div class="test-item comp-item" data-tid="' + t.id + '">';
  html += '<div style="display:flex;justify-content:space-between;align-items:center;">';
  html += '<div class="comp-name">' + escHtml(t.name) + '</div>';
  html += '<span class="comp-status ' + statusClass + '">' + statusLabel + '</span>';
  html += '</div>';
  html += '<div class="comp-meta">' + contLabel + ' · ' + t.questionCount + ' questions · T' + t.tierCeiling + '</div>';
  html += '<div class="comp-meta">' + results.length + ' submission' + (results.length !== 1 ? 's' : '') + ' · ' + (t.timeLimit ? (t.timeLimit >= 60 ? (t.timeLimit / 60) + ' min' : t.timeLimit + 's') + ' limit' : 'Untimed') + '</div>';
  html += '</div>';
  return html;
}

function renderTestCreate() {
  var root = document.getElementById('edu-tests-root');
  if (!root) return;

  var html = '';

  html += '<div class="edu-topbar">';
  html += '<div class="edu-back" id="test-create-back">←</div>';
  html += '<div class="edu-brand"><div class="edu-brand-name">New Test</div><div class="edu-brand-sub">EDU</div></div>';
  html += '</div>';

  html += '<div class="edu-content">';
  html += '<div class="edu-card">';

  html += '<div class="comp-form-group">';
  html += '<label>Test Name</label>';
  html += '<input type="text" class="comp-input" id="test-name" placeholder="e.g. Unit 3 — Europe Capitals" maxlength="60">';
  html += '</div>';

  html += '<div class="comp-form-group">';
  html += '<label>Continent</label>';
  html += '<div class="comp-row" id="test-cont-row">';
  TEST_CONTINENTS.forEach(function(c, i) {
    html += '<div class="comp-chip' + (i === 0 ? ' on' : '') + '" data-cont="' + c.key + '">' + c.label + '</div>';
  });
  html += '</div></div>';

  html += '<div class="comp-form-group">';
  html += '<label>Categories</label>';
  html += '<div class="comp-row" id="test-cat-row">';
  CATEGORIES.forEach(function(cat) {
    var defaultOn = cat.key === 'countries' || cat.key === 'capitals';
    html += '<div class="comp-chip' + (defaultOn ? ' on' : '') + '" data-cat="' + cat.key + '">' + cat.icon + ' ' + cat.label + '</div>';
  });
  html += '</div></div>';

  html += '<div class="comp-form-group">';
  html += '<label>Tier Ceiling</label>';
  html += '<div style="display:flex;align-items:center;gap:10px;">';
  html += '<input type="range" id="test-tier" min="1" max="13" value="7" style="flex:1;accent-color:var(--edu-accent);">';
  html += '<span id="test-tier-lbl" style="font-family:\'Space Mono\',monospace;font-size:13px;font-weight:700;color:var(--edu-accent);min-width:90px;text-align:right;">T7 · Voyager</span>';
  html += '</div></div>';

  html += '<div class="comp-form-group">';
  html += '<label>Number of Questions</label>';
  html += '<div style="display:flex;align-items:center;gap:10px;">';
  html += '<input type="range" id="test-qcount" min="5" max="50" value="20" step="5" style="flex:1;accent-color:var(--edu-accent);">';
  html += '<span id="test-qcount-lbl" style="font-family:\'Space Mono\',monospace;font-size:13px;font-weight:700;color:var(--edu-accent);min-width:30px;text-align:right;">20</span>';
  html += '</div></div>';

  html += '<div class="comp-form-group">';
  html += '<label>Time Limit</label>';
  html += '<div class="comp-row" id="test-time-row">';
  html += '<div class="comp-chip on" data-time="0">None</div>';
  html += '<div class="comp-chip" data-time="300">5 min</div>';
  html += '<div class="comp-chip" data-time="600">10 min</div>';
  html += '<div class="comp-chip" data-time="900">15 min</div>';
  html += '</div></div>';

  html += '<div class="comp-form-group">';
  html += '<label>Grading Scale (minimum % for each grade)</label>';
  html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px;">';
  ['A', 'B', 'C', 'D'].forEach(function(g) {
    var val = DEFAULT_GRADING_SCALE[g];
    html += '<div style="text-align:center;">';
    html += '<div style="font-size:14px;font-weight:800;color:var(--edu-accent);margin-bottom:4px;">' + g + '</div>';
    html += '<input type="number" class="comp-input test-grade-input" id="test-grade-' + g + '" value="' + val + '" min="0" max="100" style="text-align:center;width:100%;padding:8px 4px;">';
    html += '</div>';
  });
  html += '</div></div>';

  html += '<div id="test-pool-preview" style="font-size:12px;color:var(--dim);margin-top:4px;text-align:center;"></div>';

  html += '<button class="edu-btn" id="btn-test-submit" style="width:100%;margin-top:10px;padding:14px;font-size:14px;">📝 Create Test</button>';

  html += '</div>';
  html += '</div>';

  root.innerHTML = html;

  var formState = {
    continent: 'globe',
    categories: { countries: true, capitals: true },
    tier: 7,
    questionCount: 20,
    timeLimit: 0,
    gradingScale: { ...DEFAULT_GRADING_SCALE }
  };

  function updatePoolPreview() {
    var cd = getCombinedContinentData(formState.continent);
    if (!cd) { document.getElementById('test-pool-preview').textContent = ''; return; }
    var pool = buildPool({ continent: formState.continent, categories: formState.categories, tierCeiling: formState.tier }, cd);
    var el = document.getElementById('test-pool-preview');
    if (el) el.textContent = pool.length + ' questions available in pool';
  }

  document.getElementById('test-create-back')?.addEventListener('click', function() { renderEduTests(); });

  document.getElementById('test-cont-row')?.querySelectorAll('.comp-chip').forEach(function(chip) {
    chip.addEventListener('click', function() {
      document.getElementById('test-cont-row').querySelectorAll('.comp-chip').forEach(function(c) { c.classList.remove('on'); });
      this.classList.add('on');
      formState.continent = this.getAttribute('data-cont');
      updatePoolPreview();
    });
  });

  document.getElementById('test-cat-row')?.querySelectorAll('.comp-chip').forEach(function(chip) {
    chip.addEventListener('click', function() {
      this.classList.toggle('on');
      var key = this.getAttribute('data-cat');
      formState.categories[key] = this.classList.contains('on');
      updatePoolPreview();
    });
  });

  var tierSlider = document.getElementById('test-tier');
  var tierLbl = document.getElementById('test-tier-lbl');
  if (tierSlider) {
    tierSlider.addEventListener('input', function() {
      formState.tier = parseInt(this.value);
      tierLbl.textContent = 'T' + formState.tier + ' · ' + (TIER_LABELS[formState.tier - 1] || '');
      updatePoolPreview();
    });
  }

  var qSlider = document.getElementById('test-qcount');
  var qLbl = document.getElementById('test-qcount-lbl');
  if (qSlider) {
    qSlider.addEventListener('input', function() {
      formState.questionCount = parseInt(this.value);
      qLbl.textContent = formState.questionCount;
    });
  }

  document.getElementById('test-time-row')?.querySelectorAll('.comp-chip').forEach(function(chip) {
    chip.addEventListener('click', function() {
      document.getElementById('test-time-row').querySelectorAll('.comp-chip').forEach(function(c) { c.classList.remove('on'); });
      this.classList.add('on');
      formState.timeLimit = parseInt(this.getAttribute('data-time'));
    });
  });

  document.getElementById('btn-test-submit')?.addEventListener('click', function() {
    var name = (document.getElementById('test-name').value || '').trim();
    if (!name) { showToast('Enter a test name'); return; }

    var anyCat = Object.values(formState.categories).some(function(v) { return v; });
    if (!anyCat) { showToast('Select at least one category'); return; }

    ['A', 'B', 'C', 'D'].forEach(function(g) {
      var inp = document.getElementById('test-grade-' + g);
      if (inp) formState.gradingScale[g] = parseInt(inp.value) || 0;
    });

    var result = createTest({
      name: name,
      continent: formState.continent,
      categories: formState.categories,
      tierCeiling: formState.tier,
      questionCount: formState.questionCount,
      timeLimit: formState.timeLimit || null,
      gradingScale: formState.gradingScale
    });

    if (result) renderEduTests();
  });

  updatePoolPreview();
}

function renderTestDetail(testId) {
  var root = document.getElementById('edu-tests-root');
  if (!root) return;

  var tests = getTests();
  var test = tests.find(function(t) { return t.id === testId; });
  if (!test) { renderEduTests(); return; }

  var results = getTestResults(testId);
  var contLabel = TEST_CONTINENTS.find(function(c) { return c.key === test.continent; });
  contLabel = contLabel ? contLabel.label : test.continent;
  var catList = Object.keys(test.categories || {}).filter(function(k) { return test.categories[k]; });

  var html = '';

  html += '<div class="edu-topbar">';
  html += '<div class="edu-back" id="test-detail-back">←</div>';
  html += '<div class="edu-brand"><div class="edu-brand-name">' + escHtml(test.name) + '</div><div class="edu-brand-sub">EDU</div></div>';
  html += '</div>';

  html += '<div class="edu-content">';

  html += '<div class="edu-card">';
  html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">';
  html += '<h3 style="margin:0;">Test Info</h3>';
  html += '<span class="comp-status ' + (test.active ? 'active' : 'ended') + '">' + (test.active ? 'ACTIVE' : 'CLOSED') + '</span>';
  html += '</div>';

  html += '<div style="font-size:12px;color:var(--text);line-height:1.7;">';
  html += '<strong>Region:</strong> ' + contLabel + '<br>';
  html += '<strong>Categories:</strong> ' + (catList.length ? catList.join(', ') : 'None') + '<br>';
  html += '<strong>Tier:</strong> T' + (test.tierCeiling || '?') + ' · ' + (TIER_LABELS[(test.tierCeiling || 1) - 1] || '') + '<br>';
  html += '<strong>Questions:</strong> ' + test.questionCount + '<br>';
  html += '<strong>Time Limit:</strong> ' + (test.timeLimit ? (test.timeLimit >= 60 ? (test.timeLimit / 60) + ' min' : test.timeLimit + 's') : 'None') + '<br>';
  html += '<strong>Grading:</strong> A≥' + test.gradingScale.A + '% B≥' + test.gradingScale.B + '% C≥' + test.gradingScale.C + '% D≥' + test.gradingScale.D + '%';
  html += '</div>';
  html += '</div>';

  if (results.length) {
    var avgScore = Math.round(results.reduce(function(a, r) { return a + (r.score || 0); }, 0) / results.length);
    var avgAcc = Math.round(results.reduce(function(a, r) { return a + (r.accuracy || 0); }, 0) / results.length * 100);
    var gradeCount = { A: 0, B: 0, C: 0, D: 0, F: 0 };
    results.forEach(function(r) { gradeCount[r.grade || 'F'] = (gradeCount[r.grade || 'F'] || 0) + 1; });

    html += '<div class="edu-stats-row">';
    html += '<div class="edu-stat-card"><div class="edu-stat-val">' + results.length + '</div><div class="edu-stat-lbl">Submitted</div></div>';
    html += '<div class="edu-stat-card"><div class="edu-stat-val">' + avgAcc + '%</div><div class="edu-stat-lbl">Avg Accuracy</div></div>';
    html += '<div class="edu-stat-card"><div class="edu-stat-val">' + avgScore.toLocaleString() + '</div><div class="edu-stat-lbl">Avg Score</div></div>';
    html += '</div>';

    html += '<div class="edu-card">';
    html += '<h3>Grade Distribution</h3>';
    html += '<div style="display:flex;gap:6px;justify-content:center;">';
    ['A', 'B', 'C', 'D', 'F'].forEach(function(g) {
      var pct = Math.round((gradeCount[g] / results.length) * 100);
      var color = g === 'A' ? 'var(--correct)' : g === 'B' ? '#5b8fff' : g === 'C' ? 'var(--yellow)' : g === 'D' ? '#ff8c42' : 'var(--wrong)';
      html += '<div style="text-align:center;flex:1;">';
      html += '<div style="font-size:20px;font-weight:800;color:' + color + ';">' + gradeCount[g] + '</div>';
      html += '<div style="font-size:11px;color:var(--dim);">' + g + ' (' + pct + '%)</div>';
      html += '</div>';
    });
    html += '</div>';
    html += '</div>';

    if (results.length > 0 && results[0].answers) {
      html += '<div class="edu-card">';
      html += '<h3>Per-Question Accuracy</h3>';
      var qStats = {};
      results.forEach(function(r) {
        if (!r.answers) return;
        r.answers.forEach(function(ans, qi) {
          if (!qStats[qi]) qStats[qi] = { correct: 0, total: 0, cardId: ans.cardId, avgTime: 0 };
          qStats[qi].total++;
          if (ans.correct) qStats[qi].correct++;
          qStats[qi].avgTime += (ans.timeMs || 0);
        });
      });

      var qKeys = Object.keys(qStats).sort(function(a, b) { return parseInt(a) - parseInt(b); });
      qKeys.forEach(function(qi) {
        var qs = qStats[qi];
        var acc = Math.round((qs.correct / qs.total) * 100);
        var avgT = qs.total > 0 ? (qs.avgTime / qs.total / 1000).toFixed(1) : '—';
        var barColor = acc >= 80 ? 'var(--correct)' : acc >= 60 ? 'var(--yellow)' : 'var(--wrong)';

        var deckCard = test.cardDeck[parseInt(qi)];
        var qLabel = deckCard ? (deckCard.label || deckCard.id) : 'Q' + (parseInt(qi) + 1);
        if (qLabel.length > 25) qLabel = qLabel.substring(0, 22) + '…';

        html += '<div style="margin-bottom:8px;">';
        html += '<div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:2px;">';
        html += '<span style="color:var(--text);">Q' + (parseInt(qi) + 1) + ': ' + escHtml(qLabel) + '</span>';
        html += '<span style="color:var(--dim);">' + acc + '% · ' + avgT + 's avg</span>';
        html += '</div>';
        html += '<div style="height:6px;background:var(--edu-bg-panel);border-radius:3px;overflow:hidden;">';
        html += '<div style="height:100%;width:' + acc + '%;background:' + barColor + ';border-radius:3px;transition:width .3s;"></div>';
        html += '</div>';
        html += '</div>';
      });
      html += '</div>';
    }
  }

  html += '<div class="edu-card">';
  html += '<h3>📋 Results (' + results.length + ')</h3>';

  if (!results.length) {
    html += '<div class="edu-empty" style="padding:20px;">No submissions yet.</div>';
  } else {
    results.forEach(function(r, i) {
      var acc = r.accuracy ? Math.round(r.accuracy * 100) + '%' : '—';
      var gradeColor = r.grade === 'A' ? 'var(--correct)' : r.grade === 'B' ? '#5b8fff' : r.grade === 'C' ? 'var(--yellow)' : r.grade === 'D' ? '#ff8c42' : 'var(--wrong)';

      html += '<div class="comp-lb-row">';
      html += '<div class="comp-lb-rank" style="font-size:20px;font-weight:900;color:' + gradeColor + ';">' + (r.grade || '—') + '</div>';
      html += '<div class="comp-lb-info">';
      html += '<div class="comp-lb-name">' + escHtml(r.handle || 'Unknown') + '</div>';
      html += '<div class="comp-lb-stats">' + acc + ' · ' + (r.correct || 0) + '/' + ((r.correct || 0) + (r.wrong || 0)) + '</div>';
      html += '</div>';
      html += '<div class="comp-lb-score">' + (r.score || 0).toLocaleString() + '</div>';
      html += '</div>';
    });
  }
  html += '</div>';

  html += '<div style="display:flex;gap:8px;margin-bottom:20px;">';

  if (test.active) {
    html += '<button class="edu-btn" id="btn-play-test" style="flex:1;padding:14px;font-size:14px;background:var(--correct);">▶ Take Test</button>';
  }

  html += '<button class="edu-btn" id="btn-toggle-test" style="flex:1;padding:12px;font-size:12px;background:var(--edu-accent);">' + (test.active ? '⏹ Close Test' : '🔓 Reopen Test') + '</button>';
  html += '</div>';

  if (results.length) {
    html += '<button class="edu-btn" id="btn-export-test" style="width:100%;padding:12px;font-size:12px;background:var(--edu-bg-panel);border:1px solid var(--edu-border);margin-bottom:8px;">📤 Export Results (CSV)</button>';
  }

  html += '<button class="edu-btn" id="btn-delete-test" style="width:100%;padding:12px;font-size:12px;background:var(--wrong);margin-bottom:20px;">Delete Test</button>';

  html += '</div>';
  root.innerHTML = html;

  document.getElementById('test-detail-back')?.addEventListener('click', function() { renderEduTests(); });

  document.getElementById('btn-play-test')?.addEventListener('click', function() {
    launchTestGame(test);
  });

  document.getElementById('btn-toggle-test')?.addEventListener('click', function() {
    toggleTestActive(testId);
    renderTestDetail(testId);
  });

  document.getElementById('btn-export-test')?.addEventListener('click', function() {
    exportTestResults(test, results);
  });

  document.getElementById('btn-delete-test')?.addEventListener('click', function() {
    if (confirm('Delete "' + test.name + '"? This cannot be undone.')) {
      deleteTest(testId);
      renderEduTests();
    }
  });
}

function exportTestResults(test, results) {
  if (!results.length) { showToast('No results to export'); return; }

  var rows = [];
  var header = ['Student', 'Score', 'Accuracy', 'Grade', 'Correct', 'Wrong'];
  for (var q = 0; q < test.questionCount; q++) {
    var deckCard = test.cardDeck[q];
    var lbl = deckCard ? (deckCard.label || 'Q' + (q + 1)) : 'Q' + (q + 1);
    header.push('Q' + (q + 1) + ': ' + lbl.replace(/,/g, ';'));
  }
  rows.push(header.join(','));

  results.forEach(function(r) {
    var row = [
      '"' + (r.handle || 'Unknown').replace(/"/g, '""') + '"',
      r.score || 0,
      r.accuracy ? Math.round(r.accuracy * 100) + '%' : '0%',
      r.grade || 'F',
      r.correct || 0,
      r.wrong || 0,
    ];
    for (var q = 0; q < test.questionCount; q++) {
      if (r.answers && r.answers[q]) {
        row.push(r.answers[q].correct ? '✓' : '✗');
      } else {
        row.push('—');
      }
    }
    rows.push(row.join(','));
  });

  var csv = rows.join('\n');
  var blob = new Blob([csv], { type: 'text/csv' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = (test.name || 'test').replace(/[^a-zA-Z0-9]/g, '_') + '_results.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('CSV downloaded');
}

function launchTestGame(test) {
  var cats = {};
  CATEGORIES.forEach(function(c) {
    cats[c.key] = !!(test.categories && test.categories[c.key]);
  });

  window._gameConfig = {
    continent: test.continent,
    categories: cats,
    difficulty: 'medium',
    tierCeiling: test.tierCeiling,
    mode: 'all',
    duration: test.timeLimit || 0,
    hideBorders: false,
    _test: {
      id: test.id,
      name: test.name,
      cardDeck: test.cardDeck,
      gradingScale: test.gradingScale,
      timeLimit: test.timeLimit
    }
  };

  go('s-game');
}

(function patchInitGameForTests() {
  var _origInitGame = initGameScreen;
  initGameScreen = function() {
    var config = window._gameConfig;

    if (config && config._test && config._test.cardDeck) {
      var testInfo = config._test;
      var cd = getCombinedContinentData(config.continent);
      if (!cd) {
        showToast('Missing continent data', 2000);
        go('s-setup');
        return;
      }

      var fixedCards = testInfo.cardDeck.slice();
      var firstCard = fixedCards.shift();

      if (!firstCard) {
        showToast('Test has no questions', 2000);
        go('s-edu-tests');
        return;
      }

      _game = {
        config: config,
        cd: cd,
        pool: testInfo.cardDeck.slice(),
        deck: { mode: 'all', remaining: fixedCards },
        currentQ: firstCard,
        score: 0,
        correct: 0,
        wrong: 0,
        streak: 0,
        bestStreak: 0,
        cardsAnswered: 0,
        totalCards: testInfo.cardDeck.length,
        elapsed: 0,
        timeRemaining: testInfo.timeLimit || 0,
        done: false,
        locked: false,
        mapInstance: null,
        timerId: null,
        mistakes: {},
        answerTimes: [],
        _qStart: Date.now(),
        _testAnswers: [],
      };

      var mapContainer = document.getElementById('game-map-container');
      var viewKey = config.continent === 'globe' ? 'globe' : config.continent;
      _game.mapInstance = renderMap(mapContainer, viewKey, {
        enableZoom: true,
        hideBorders: config.hideBorders,
        onClick: handleGameClick,
        continent: config.continent,
        showHints: true,
        activeRivers: new Set((_game.pool || []).filter(function(c){ return c.type === 'river'; }).map(function(c){ return c.targetId; })),
        activeCities: new Set((_game.pool || []).filter(function(c){ return c.type === 'city'; }).map(function(c){ return c.targetId; })),
        activeHeritage: new Set((_game.pool || []).filter(function(c){ return c.type === 'heritage'; }).map(function(c){ return c.targetId; })),
        activeMountains: new Set((_game.pool || []).filter(function(c){ return c.type === 'mountain'; }).map(function(c){ return c.targetId; }))
      });

      updateGameUI();
      showQuestion();
      hideFeedback();

      if (testInfo.timeLimit && testInfo.timeLimit > 0) {
        _game.config.mode = 'timed';
        _game.timeRemaining = testInfo.timeLimit;
      }

      _game.timerId = setInterval(gameTick, 1000);

      return;
    }

    _origInitGame();
  };
})();

(function patchDrawCardForTests() {
  var _origDrawCard = drawCard;
  drawCard = function(deck) {
    if (_game && _game.config && _game.config._test) {
      if (deck.remaining.length === 0) return { card: null, deck: deck };
      var card = deck.remaining[0];
      var rest = deck.remaining.slice(1);
      return { card: card, deck: { mode: 'all', remaining: rest } };
    }
    return _origDrawCard(deck);
  };
})();

(function patchEndGameForTests() {
  var _origEndGame = endGame;
  endGame = function() {
    var testInfo = null;
    if (_game && _game.config && _game.config._test) {
      var answers = _game._testAnswers || [];

      testInfo = {
        id: _game.config._test.id,
        name: _game.config._test.name,
        gradingScale: _game.config._test.gradingScale,
        score: _game.score,
        correct: _game.correct,
        wrong: _game.wrong,
        streak: _game.bestStreak,
        elapsed: _game.elapsed,
        answers: answers
      };
    }

    _origEndGame();

    if (testInfo && activeProfile) {
      var total = testInfo.correct + testInfo.wrong;
      var accuracy = total > 0 ? testInfo.correct / total : 0;
      var accPct = Math.round(accuracy * 100);
      var grade = computeGrade(accPct, testInfo.gradingScale);

      saveTestResult(testInfo.id, {
        playerId: activeProfile.id,
        handle: activeProfile.handle || 'Unknown',
        avatarSvg: activeProfile.avatarSvg || '',
        score: testInfo.score,
        correct: testInfo.correct,
        wrong: testInfo.wrong,
        accuracy: accuracy,
        grade: grade,
        answers: testInfo.answers
      });

    }
  };
})();

(function patchHandleGameClickForTests() {
  var _origHandleGameClick = handleGameClick;
  handleGameClick = function(lon, lat, event) {
    var preCorrect = _game ? _game.correct : 0;
    var qStart = _game ? _game._qStart : Date.now();
    var currentCard = _game ? _game.currentQ : null;

    _origHandleGameClick(lon, lat, event);

    if (_game && _game.config && _game.config._test && currentCard && _game._testAnswers) {
      var wasCorrect = _game.correct > preCorrect;
      var timeMs = Date.now() - qStart;
      _game._testAnswers.push({
        cardId: currentCard.id,
        correct: wasCorrect,
        timeMs: timeMs
      });
    }
  };
})();

function getActiveTestsAll() {
  var active = [];
  for (var i = 0; i < localStorage.length; i++) {
    var key = localStorage.key(i);
    if (key && key.startsWith(TEST_KEY_PREFIX)) {
      try {
        var tests = JSON.parse(localStorage.getItem(key));
        tests.forEach(function(t) {
          if (t.active) active.push(t);
        });
      } catch (e) {}
    }
  }
  var seen = {};
  return active.filter(function(t) { if (seen[t.id]) return false; seen[t.id] = true; return true; });
}

function injectTestBanners(container) {
  if (!container) return;
  var active = getActiveTestsAll();
  if (!active.length) return;

  active.forEach(function(t) {
    var results = getTestResults(t.id);
    var alreadyDone = activeProfile && results.some(function(r) { return r.playerId === activeProfile.id; });

    var banner = document.createElement('div');
    banner.className = 'comp-banner';
    banner.style.borderColor = '#5b8fff';
    banner.innerHTML = '<div class="comp-banner-title">📝 ' + escHtml(t.name) + (alreadyDone ? ' ✓' : '') + '</div>' +
      '<div class="comp-banner-sub">' + t.questionCount + ' questions' +
      (t.timeLimit ? ' · ' + (t.timeLimit >= 60 ? (t.timeLimit / 60) + ' min' : t.timeLimit + 's') : ' · Untimed') +
      (alreadyDone ? ' · Completed' : ' · Tap to start') + '</div>';
    if (!alreadyDone) {
      banner.addEventListener('click', function() {
        launchTestGame(t);
      });
    } else {
      banner.style.opacity = '0.6';
    }
    container.insertBefore(banner, container.firstChild);
  });
}

(function patchSetupForTestBanners() {
  var _origRenderSetup = renderSetupSubPage;
  renderSetupSubPage = function(viewKey) {
    _origRenderSetup(viewKey);
    var controls = document.getElementById('setup-controls');
    if (controls) {
      var panel = controls.querySelector('.setup-panel');
      if (panel) {
        injectTestBanners(panel);
      }
    }
  };
})();


const CUSTOM_CARD_KEY_PREFIX = 'nsg_custom_cards_';
const EDU_TIER_OVERRIDE_KEY = 'nsg_tier_overrides_';

function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).catch(function() { _fallbackCopy(text); });
  } else {
    _fallbackCopy(text);
  }
}
function _fallbackCopy(text) {
  var ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;left:-9999px;';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch(e) {}
  document.body.removeChild(ta);
}

const CARD_TYPES = [
  { key: 'country',  cat: 'countries',  label: 'Country ID',     icon: '🗺️', desc: 'Click the correct country', target: 'country' },
  { key: 'capital',  cat: 'capitals',   label: 'Capital',        icon: '🏛️', desc: 'Find the country of this capital', target: 'country' },
  { key: 'flag',     cat: 'flags',      label: 'Flag',           icon: '🏳️', desc: 'Identify a country by its flag', target: 'country' },
  { key: 'mountain',   cat: 'landforms', sub: 'mountains',    label: 'Mountain',      icon: '⛰️', desc: 'Identify a mountain range', target: 'coords' },
  { key: 'peninsula',  cat: 'landforms', sub: 'peninsulas',   label: 'Peninsula',     icon: '🏔️', desc: 'Identify a peninsula', target: 'coords' },
  { key: 'island',     cat: 'landforms', sub: 'islands',      label: 'Island',        icon: '🏝️', desc: 'Identify an island', target: 'coords' },
  { key: 'archipelago', cat: 'landforms', sub: 'archipelagos', label: 'Archipelago',   icon: '🗾', desc: 'Identify an archipelago', target: 'coords' },
  { key: 'river',    cat: 'water', sub: 'rivers',  label: 'River',      icon: '🏞️', desc: 'Identify a river', target: 'coords' },
  { key: 'lake',     cat: 'water', sub: 'lakes',   label: 'Lake',       icon: '💧', desc: 'Identify a lake', target: 'coords' },
  { key: 'sea',      cat: 'water', sub: 'seas',    label: 'Sea',        icon: '🌊', desc: 'Identify a sea', target: 'coords' },
  { key: 'ocean',    cat: 'water', sub: 'oceans',  label: 'Ocean',      icon: '🌏', desc: 'Identify an ocean', target: 'coords' },
  { key: 'gulf',     cat: 'water', sub: 'gulfs',   label: 'Gulf/Bay',   icon: '🫗', desc: 'Identify a gulf or bay', target: 'coords' },
  { key: 'strait',   cat: 'water', sub: 'straits', label: 'Strait',     icon: '🔀', desc: 'Identify a strait or channel', target: 'coords' },
  { key: 'city',     cat: 'cities', sub: 'cities',    label: 'City',       icon: '🏙️', desc: 'Identify a city', target: 'coords' },
  { key: 'heritage', cat: 'cities', sub: 'heritage',  label: 'Heritage Site', icon: '🏛️', desc: 'Identify a heritage site', target: 'coords' },
  { key: 'language', cat: 'culture', sub: 'languages', label: 'Language',   icon: '🗣️', desc: 'Language or dialect question', target: 'country' },
  { key: 'trivia',   cat: 'culture', sub: 'trivia',    label: 'Trivia',     icon: '🧠', desc: 'General geography trivia', target: 'country' },
  { key: 'polygon',  cat: 'custom',  sub: 'polygon',   label: 'Custom Region', icon: '📐', desc: 'Custom drawn polygon region', target: 'polygon' },
];

const CARD_CAT_GROUPS = [
  { cat: 'countries', label: 'Countries',         icon: '🗺️', types: ['country'] },
  { cat: 'capitals',  label: 'Capitals',          icon: '🏛️', types: ['capital'] },
  { cat: 'flags',     label: 'Flags',             icon: '🏳️', types: ['flag'] },
  { cat: 'landforms', label: 'Landforms',         icon: '⛰️', types: ['mountain','peninsula','island','archipelago'] },
  { cat: 'water',     label: 'Water Bodies',      icon: '🌊', types: ['river','lake','sea','ocean','gulf','strait'] },
  { cat: 'cities',    label: 'Cities & Landmarks', icon: '🏙️', types: ['city','heritage'] },
  { cat: 'culture',   label: 'Culture & Trivia',  icon: '🎭', types: ['language','trivia'] },
  { cat: 'custom',    label: 'Custom Region',     icon: '📐', types: ['polygon'] },
];

function getCustomCards(educatorId) {
  var eid = educatorId || (activeProfile ? activeProfile.id : '');
  if (!eid) return [];
  try {
    var raw = localStorage.getItem(CUSTOM_CARD_KEY_PREFIX + eid);
    return raw ? JSON.parse(raw) : [];
  } catch (e) { return []; }
}

function saveCustomCards(cards, educatorId) {
  var eid = educatorId || (activeProfile ? activeProfile.id : '');
  if (!eid) return;
  try {
    localStorage.setItem(CUSTOM_CARD_KEY_PREFIX + eid, JSON.stringify(cards));
  } catch (e) { console.warn('[custom-cards] Save failed:', e); }
}

function createCustomCard(data) {
  var card = {
    id: 'cc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    educatorId: activeProfile.id,
    cardType: data.cardType,
    question: data.question,
    targetId: data.targetId || null,
    targetCoords: data.targetCoords || null,
    customPolygon: data.customPolygon || null,
    answer: data.answer,
    tier: data.tier || 1,
    continent: data.continent || 'globe',
    groups: data.groups || [],
    createdAt: new Date().toISOString()
  };

  var cards = getCustomCards();
  cards.unshift(card);
  saveCustomCards(cards);
  showToast('Card created! 🃏');
  return card;
}

function deleteCustomCard(cardId) {
  var cards = getCustomCards().filter(function(c) { return c.id !== cardId; });
  saveCustomCards(cards);
  showToast('Card deleted');
}

function getCountryOptions() {
  var opts = [];
  Object.keys(COUNTRY_DATA).forEach(function(numId) {
    var c = COUNTRY_DATA[numId];
    opts.push({ id: c.id, name: c.name, flag: c.flag, continent: c.continent, numId: numId });
  });
  opts.sort(function(a, b) { return a.name.localeCompare(b.name); });
  return opts;
}

function getTierOverrides() {
  if (!activeProfile) return {};
  try {
    var raw = localStorage.getItem(EDU_TIER_OVERRIDE_KEY + activeProfile.id);
    return raw ? JSON.parse(raw) : {};
  } catch (e) { return {}; }
}
function saveTierOverrides(overrides) {
  if (!activeProfile) return;
  try {
    localStorage.setItem(EDU_TIER_OVERRIDE_KEY + activeProfile.id, JSON.stringify(overrides));
  } catch (e) {}
}
function resetAllTierOverrides() {
  saveTierOverrides({});
  showToast('All tiers reset to default');
}

function sortCards(cards) {
  var catOrder = {};
  CARD_CAT_GROUPS.forEach(function(g, i) { catOrder[g.cat] = i; });
  return cards.slice().sort(function(a, b) {
    if (a.tier !== b.tier) return a.tier - b.tier;
    var typeA = CARD_TYPES.find(function(t) { return t.key === a.cardType; }) || {};
    var typeB = CARD_TYPES.find(function(t) { return t.key === b.cardType; }) || {};
    var catA = catOrder[typeA.cat] || 99;
    var catB = catOrder[typeB.cat] || 99;
    if (catA !== catB) return catA - catB;
    return (typeA.sub || '').localeCompare(typeB.sub || '');
  });
}

function renderEduCards() {
  var root = document.getElementById('edu-cards-root');
  if (!root || !activeProfile) return;

  var allCards = getCustomCards();
  var groups = getEduGroups();
  var activeGrp = getActiveGroup();

  var cards;
  if (activeGrp) {
    cards = allCards.filter(function(c) {
      return c.groups && c.groups.indexOf(activeGrp.id) >= 0;
    });
  } else {
    cards = allCards;
  }
  cards = sortCards(cards);

  var html = '';

  html += '<div class="edu-topbar">';
  html += '<div class="edu-back" id="edu-cards-back">←</div>';
  html += '<div class="edu-logo"><span class="edu-logo-text">MG</span></div>';
  html += '<div class="edu-brand"><div class="edu-brand-name">Custom Cards</div><div class="edu-brand-sub">EDU</div></div>';
  html += '<div style="flex:1;"></div>';
  html += '<button class="edu-btn" id="btn-create-card" style="font-size:11px;padding:8px 14px;">+ New</button>';
  html += '<button class="edu-btn" id="btn-import-card" style="font-size:11px;padding:8px 14px;background:transparent;border:1px solid var(--edu-accent);color:var(--edu-accent);margin-left:6px;">📥</button>';
  html += '</div>';

  html += '<div class="edu-content">';

  html += '<div style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap;">';
  html += '<div class="comp-chip' + (!activeGrp ? ' on' : '') + '" data-grpfilter="" style="font-size:11px;padding:5px 10px;">All (' + allCards.length + ')</div>';
  groups.forEach(function(g) {
    var cnt = allCards.filter(function(c) { return c.groups && c.groups.indexOf(g.id) >= 0; }).length;
    var on = activeGrp && activeGrp.id === g.id;
    html += '<div class="comp-chip' + (on ? ' on' : '') + '" data-grpfilter="' + escHtml(g.id) + '" style="font-size:11px;padding:5px 10px;">' + escHtml(g.name) + ' (' + cnt + ')</div>';
  });
  html += '</div>';

  html += '<div style="display:flex;gap:0;margin-bottom:12px;border:1px solid var(--edu-border);border-radius:10px;overflow:hidden;">';
  html += '<div class="cc-tab on" data-tab="cards" style="flex:1;text-align:center;padding:10px;font-size:12px;font-weight:700;color:#fff;background:var(--edu-accent);cursor:pointer;">Custom Cards</div>';
  html += '<div class="cc-tab" data-tab="overrides" style="flex:1;text-align:center;padding:10px;font-size:12px;font-weight:700;color:var(--dim);cursor:pointer;">Tier Overrides</div>';
  html += '</div>';

  html += '<div id="cc-tab-cards">';

  if (!cards.length) {
    html += '<div class="edu-empty">';
    html += '<div style="font-size:48px;margin-bottom:12px;">🃏</div>';
    html += '<div style="font-size:15px;color:#fff;font-weight:700;">No Custom Cards' + (activeGrp ? ' in ' + escHtml(activeGrp.name) : '') + '</div>';
    html += '<div style="margin-top:6px;">Create cards to supplement the curriculum.</div>';
    html += '</div>';
  } else {
    html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">';
    html += '<button id="cc-select-all" style="background:none;border:none;color:var(--edu-accent);font-size:12px;font-weight:700;cursor:pointer;padding:4px 0;">Select All</button>';
    html += '<span style="color:var(--dim);font-size:11px;">·</span>';
    html += '<button id="cc-select-none" style="background:none;border:none;color:var(--dim);font-size:12px;font-weight:700;cursor:pointer;padding:4px 0;">None</span>';
    html += '<span style="flex:1;"></span>';
    html += '<span id="cc-sel-count" style="font-size:11px;color:var(--dim);"></span>';
    html += '</div>';

    var currentTier = -1;
    html += '<div class="edu-card" id="cc-card-list">';
    cards.forEach(function(c) {
      if (c.tier !== currentTier) {
        if (currentTier !== -1) html += '<div style="height:6px;"></div>';
        currentTier = c.tier;
        html += '<div style="font-size:9px;color:var(--dim);text-transform:uppercase;letter-spacing:.12em;padding:4px 0;border-bottom:1px solid rgba(91,143,255,.08);margin-bottom:4px;">Tier ' + c.tier + ' · ' + (TIER_LABELS[c.tier - 1] || '') + '</div>';
      }
      var typeInfo = CARD_TYPES.find(function(t) { return t.key === c.cardType; }) || CARD_TYPES[0];
      var grpBadges = '';
      if (c.groups && c.groups.length) {
        c.groups.forEach(function(gid) {
          var g = groups.find(function(gr) { return gr.id === gid; });
          if (g) grpBadges += '<span style="font-size:8px;background:rgba(91,143,255,.15);color:var(--edu-accent);padding:1px 5px;border-radius:4px;margin-left:4px;">' + escHtml(g.name) + '</span>';
        });
      }
      html += '<div class="cc-item" data-ccid="' + c.id + '" style="cursor:pointer;">';
      html += '<div style="display:flex;align-items:center;gap:10px;">';
      html += '<div class="cc-check" data-ccid="' + c.id + '" style="width:22px;height:22px;border-radius:6px;border:2px solid var(--border);display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .15s;font-size:13px;"></div>';
      html += '<div style="font-size:20px;">' + typeInfo.icon + '</div>';
      html += '<div style="flex:1;min-width:0;">';
      html += '<div style="font-size:13px;font-weight:700;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escHtml(c.question) + grpBadges + '</div>';
      html += '<div style="font-size:11px;color:var(--dim);">' + typeInfo.label + ' · T' + c.tier + ' · ' + escHtml(c.answer) + '</div>';
      html += '</div>';
      html += '<div class="cc-del" data-ccid="' + c.id + '" style="color:var(--wrong);cursor:pointer;font-size:18px;padding:4px 8px;">✕</div>';
      html += '</div>';
      html += '</div>';
    });
    html += '</div>';

    html += '<div id="cc-action-bar" style="display:none;position:sticky;bottom:0;background:var(--bg-panel);border:1px solid var(--edu-accent);border-radius:14px;padding:10px 14px;margin-top:12px;gap:8px;align-items:center;">';
    html += '<span id="cc-action-count" style="font-size:13px;font-weight:700;color:#fff;flex:1;"></span>';
    html += '<button id="btn-share-selected" class="edu-btn" style="font-size:11px;padding:8px 14px;">📤 Share</button>';
    html += '<button id="btn-del-selected" class="edu-btn" style="font-size:11px;padding:8px 14px;background:var(--wrong);">🗑 Delete</button>';
    html += '</div>';
  }
  html += '</div>';

  html += '<div id="cc-tab-overrides" style="display:none;">';
  html += renderTierOverridesHTML();
  html += '</div>';

  html += '</div>';
  root.innerHTML = html;

  root.querySelectorAll('.cc-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      root.querySelectorAll('.cc-tab').forEach(function(t) { t.classList.remove('on'); t.style.background = 'transparent'; t.style.color = 'var(--dim)'; });
      this.classList.add('on'); this.style.background = 'var(--edu-accent)'; this.style.color = '#fff';
      var which = this.getAttribute('data-tab');
      document.getElementById('cc-tab-cards').style.display = which === 'cards' ? '' : 'none';
      document.getElementById('cc-tab-overrides').style.display = which === 'overrides' ? '' : 'none';
    });
  });

  root.querySelectorAll('[data-grpfilter]').forEach(function(chip) {
    chip.addEventListener('click', function() {
      setActiveGroupId(this.getAttribute('data-grpfilter') || null);
      renderEduCards();
    });
  });

  var selected = {};
  function updateSelectionUI() {
    var count = Object.keys(selected).filter(function(k) { return selected[k]; }).length;
    var countEl = document.getElementById('cc-sel-count');
    var actionBar = document.getElementById('cc-action-bar');
    var actionCount = document.getElementById('cc-action-count');
    if (countEl) countEl.textContent = count > 0 ? count + ' selected' : '';
    if (actionBar) actionBar.style.display = count > 0 ? 'flex' : 'none';
    if (actionCount) actionCount.textContent = count + ' card' + (count !== 1 ? 's' : '') + ' selected';
    root.querySelectorAll('.cc-check').forEach(function(el) {
      var ccid = el.getAttribute('data-ccid');
      var on = !!selected[ccid];
      el.style.borderColor = on ? 'var(--edu-accent)' : 'var(--border)';
      el.style.background = on ? 'var(--edu-accent)' : 'transparent';
      el.innerHTML = on ? '✓' : '';
      el.style.color = on ? '#fff' : '';
    });
  }
  function toggleCard(ccid) { selected[ccid] = !selected[ccid]; updateSelectionUI(); }

  document.getElementById('edu-cards-back')?.addEventListener('click', function() { go('s-edu-dash'); });
  document.getElementById('btn-create-card')?.addEventListener('click', function() { renderCardCreate(); });

  document.getElementById('cc-select-all')?.addEventListener('click', function() {
    cards.forEach(function(c) { selected[c.id] = true; }); updateSelectionUI();
  });
  document.getElementById('cc-select-none')?.addEventListener('click', function() {
    selected = {}; updateSelectionUI();
  });

  root.querySelectorAll('.cc-item').forEach(function(el) {
    el.addEventListener('click', function(e) {
      if (e.target.closest('.cc-del')) return;
      toggleCard(this.getAttribute('data-ccid'));
    });
  });

  document.getElementById('btn-share-selected')?.addEventListener('click', function() {
    var ids = Object.keys(selected).filter(function(k) { return selected[k]; });
    if (!ids.length) return;
    var toExport = allCards.filter(function(c) { return ids.indexOf(c.id) >= 0; });
    var exportData = toExport.map(function(c) {
      return { cardType:c.cardType, question:c.question, answer:c.answer, targetId:c.targetId, targetCoords:c.targetCoords, customPolygon:c.customPolygon, tier:c.tier, continent:c.continent };
    });
    copyToClipboard(btoa(JSON.stringify(exportData)));
    showToast('Share code copied! (' + toExport.length + ' card' + (toExport.length !== 1 ? 's' : '') + ')');
  });

  document.getElementById('btn-del-selected')?.addEventListener('click', function() {
    var ids = Object.keys(selected).filter(function(k) { return selected[k]; });
    if (!ids.length) return;
    if (!confirm('Delete ' + ids.length + ' card' + (ids.length !== 1 ? 's' : '') + '?')) return;
    ids.forEach(function(ccid) { deleteCustomCard(ccid); });
    renderEduCards();
  });

  document.getElementById('btn-import-card')?.addEventListener('click', function() {
    var code = prompt('Paste a share code from another educator:');
    if (!code) return;
    try {
      var decoded = JSON.parse(atob(code.trim()));
      var imported = Array.isArray(decoded) ? decoded : [decoded];
      var count = 0;
      imported.forEach(function(c) {
        if (c.question && c.answer && c.cardType) {
          createCustomCard(c); count++;
        }
      });
      showToast('Imported ' + count + ' card' + (count !== 1 ? 's' : '') + '!');
      renderEduCards();
    } catch (e) { showToast('Invalid share code'); }
  });

  root.querySelectorAll('.cc-del').forEach(function(el) {
    el.addEventListener('click', function(e) {
      e.stopPropagation();
      if (confirm('Delete this card?')) { deleteCustomCard(this.getAttribute('data-ccid')); renderEduCards(); }
    });
  });

  wireTierOverrideEvents(root);
}

function renderTierOverridesHTML() {
  var overrides = getTierOverrides();
  var overrideKeys = Object.keys(overrides);
  var overrideCount = overrideKeys.length;
  var groups = getEduGroups();
  var html = '';

  html += '<div class="edu-card" style="margin-bottom:10px;">';
  html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">';
  html += '<h3 style="margin:0;">Changed Items (' + overrideCount + ')</h3>';
  if (overrideCount > 0) {
    html += '<div style="display:flex;gap:4px;">';
    html += '<button id="btn-ov-select-all" style="background:none;border:none;color:var(--edu-accent);font-size:11px;font-weight:700;cursor:pointer;">All</button>';
    html += '<span style="color:var(--dim);font-size:11px;">·</span>';
    html += '<button id="btn-ov-select-none" style="background:none;border:none;color:var(--dim);font-size:11px;font-weight:700;cursor:pointer;">None</button>';
    html += '<span style="color:var(--dim);font-size:11px;margin:0 4px;">·</span>';
    html += '<button id="btn-tier-reset-all" class="edu-btn" style="font-size:10px;padding:4px 10px;background:var(--wrong);">Reset All</button>';
    html += '</div>';
  }
  html += '</div>';

  if (overrideCount === 0) {
    html += '<div style="text-align:center;padding:16px;color:var(--dim);font-size:11px;">No tier changes yet. Use the search below to find and adjust items.</div>';
  } else {
    html += '<div id="ov-changed-list" style="max-height:220px;overflow-y:auto;">';
    var changedItems = [];
    overrideKeys.forEach(function(key) {
      var parts = key.split('_');
      var type = parts[0];
      var id = parts.slice(1).join('_');
      var name = key;
      var defaultTier = 5;
      var icon = '📄';

      var cdEntry = Object.values(COUNTRY_DATA).find(function(c) { return c.id === id; });
      if (cdEntry) {
        defaultTier = cdEntry.tier;
        if (type === 'country') { name = cdEntry.flag + ' ' + cdEntry.name; icon = '🗺️'; }
        else if (type === 'capital') { name = '🏛️ ' + cdEntry.capital + ' (' + cdEntry.name + ')'; icon = ''; }
        else if (type === 'flag') { name = cdEntry.flag + ' Flag of ' + cdEntry.name; icon = ''; }
      } else {
        var cd = getCombinedContinentData('globe');
        if (cd) {
          var found = null;
          var searchArrays = [
            { arr: cd.mountains, t: '⛰️' }, { arr: cd.peninsulas, t: '🏔️' },
            { arr: cd.islands, t: '🏝️' }, { arr: cd.archipelagos, t: '🗾' },
            { arr: cd.rivers, t: '🏞️' }, { arr: cd.waterBodies, t: '🌊' },
            { arr: cd.cities, t: '🏙️' }, { arr: cd.heritageSites, t: '🏛️' },
            { arr: cd.triviaQuestions, t: '🧠' }, { arr: cd.languageQuestions, t: '🗣️' }
          ];
          for (var si = 0; si < searchArrays.length; si++) {
            var item = (searchArrays[si].arr || []).find(function(x) { return x.id === id; });
            if (item) { found = item; icon = searchArrays[si].t; break; }
          }
          if (found) {
            name = icon + ' ' + (found.name || found.label || id);
            defaultTier = found.tier || 5;
            icon = '';
          }
        }
      }
      changedItems.push({ key: key, name: (icon ? icon + ' ' : '') + name, defaultTier: defaultTier, newTier: overrides[key] });
    });

    changedItems.sort(function(a, b) {
      if (a.newTier !== b.newTier) return a.newTier - b.newTier;
      return a.name.localeCompare(b.name);
    });

    changedItems.forEach(function(item) {
      var dir = item.newTier > item.defaultTier ? '↑' : '↓';
      var dirCol = item.newTier > item.defaultTier ? 'var(--wrong)' : '#4caf50';
      html += '<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid rgba(91,143,255,.06);">';
      html += '<input type="checkbox" class="ov-cb" data-ovkey="' + escHtml(item.key) + '" style="width:16px;height:16px;accent-color:var(--edu-accent);flex-shrink:0;">';
      html += '<span style="flex:1;font-size:11px;color:#fff;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + item.name + '</span>';
      html += '<span style="font-size:10px;color:var(--dim);font-family:\'Space Mono\',monospace;">T' + item.defaultTier + '</span>';
      html += '<span style="font-size:10px;color:' + dirCol + ';font-weight:700;">' + dir + '</span>';
      html += '<span style="font-size:10px;color:var(--edu-accent);font-weight:700;font-family:\'Space Mono\',monospace;">T' + item.newTier + '</span>';
      html += '<button class="ov-reset-one" data-ovkey="' + escHtml(item.key) + '" style="background:none;color:var(--wrong);font-size:9px;font-weight:700;border:none;cursor:pointer;padding:2px 4px;">↩</button>';
      html += '</div>';
    });
    html += '</div>';

    html += '<div style="margin-top:12px;padding-top:10px;border-top:1px solid rgba(91,143,255,.1);">';
    html += '<div style="font-size:10px;color:var(--dim);text-transform:uppercase;letter-spacing:.1em;margin-bottom:6px;">Apply selected overrides to</div>';
    if (groups.length > 0) {
      html += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;">';
      groups.forEach(function(g) {
        html += '<label style="display:flex;align-items:center;gap:6px;padding:6px 10px;background:var(--edu-bg-panel);border:1px solid var(--edu-border);border-radius:8px;cursor:pointer;font-size:12px;color:#fff;">';
        html += '<input type="checkbox" class="ov-grp-cb" data-gid="' + escHtml(g.id) + '" checked style="width:14px;height:14px;accent-color:var(--edu-accent);">';
        html += escHtml(g.name);
        html += '</label>';
      });
      html += '</div>';
    } else {
      html += '<div style="font-size:11px;color:var(--dim);margin-bottom:10px;">No groups created yet. Overrides apply to all linked profiles by default.</div>';
    }
    html += '<button id="btn-ov-finished" class="edu-btn" style="width:100%;padding:14px;font-size:14px;background:var(--edu-accent);">Apply Selected Overrides</button>';
    html += '</div>';
  }
  html += '</div>';

  html += '<div class="edu-card">';
  html += '<h3>Find & Adjust Tiers</h3>';
  html += '<div style="font-size:10px;color:var(--dim);margin-bottom:10px;">Search all game content to change difficulty tiers.</div>';
  html += '<input type="text" id="tier-search" class="comp-input" placeholder="Search by name..." maxlength="60" style="margin-bottom:10px;">';
  html += '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:10px;">';
  html += '<div class="comp-chip on" data-tiercat="all" style="font-size:10px;padding:4px 8px;">All</div>';
  var tierCats = ['countries','capitals','flags','landforms','water','cities','culture'];
  tierCats.forEach(function(cat) {
    var g = CARD_CAT_GROUPS.find(function(cg) { return cg.cat === cat; });
    if (g) html += '<div class="comp-chip" data-tiercat="' + cat + '" style="font-size:10px;padding:4px 8px;">' + g.icon + '</div>';
  });
  html += '</div>';
  html += '<div id="tier-results" style="max-height:400px;overflow-y:auto;"></div>';
  html += '</div>';

  return html;
}

function wireTierOverrideEvents(root) {
  var searchEl = document.getElementById('tier-search');
  var resultsEl = document.getElementById('tier-results');
  var activeCat = 'all';

  document.getElementById('btn-ov-select-all')?.addEventListener('click', function() {
    root.querySelectorAll('.ov-cb').forEach(function(cb) { cb.checked = true; });
  });
  document.getElementById('btn-ov-select-none')?.addEventListener('click', function() {
    root.querySelectorAll('.ov-cb').forEach(function(cb) { cb.checked = false; });
  });

  document.getElementById('btn-tier-reset-all')?.addEventListener('click', function() {
    if (confirm('Reset ALL tier overrides to default?')) {
      resetAllTierOverrides();
      renderEduCards();
    }
  });

  root.querySelectorAll('.ov-reset-one').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var key = this.getAttribute('data-ovkey');
      var ov = getTierOverrides();
      delete ov[key];
      saveTierOverrides(ov);
      renderEduCards();
      setTimeout(function() {
        var tab = document.querySelector('[data-tab="overrides"]');
        if (tab) tab.click();
      }, 50);
    });
  });

  document.getElementById('btn-ov-finished')?.addEventListener('click', function() {
    var selectedKeys = [];
    root.querySelectorAll('.ov-cb:checked').forEach(function(cb) {
      selectedKeys.push(cb.getAttribute('data-ovkey'));
    });

    if (selectedKeys.length === 0) {
      showToast('Select at least one changed item');
      return;
    }

    var selectedGroups = [];
    root.querySelectorAll('.ov-grp-cb:checked').forEach(function(cb) {
      selectedGroups.push(cb.getAttribute('data-gid'));
    });

    var overrides = getTierOverrides();
    var appliedOverrides = {};
    selectedKeys.forEach(function(key) {
      if (overrides[key] !== undefined) appliedOverrides[key] = overrides[key];
    });

    var groups = getEduGroups();
    selectedGroups.forEach(function(gid) {
      var g = groups.find(function(gr) { return gr.id === gid; });
      if (g) {
        if (!g.tierOverrides) g.tierOverrides = {};
        Object.assign(g.tierOverrides, appliedOverrides);
      }
    });
    saveEduGroups(groups);

    var groupNames = selectedGroups.map(function(gid) {
      var g = groups.find(function(gr) { return gr.id === gid; });
      return g ? g.name : gid;
    });

    var msg = selectedKeys.length + ' override' + (selectedKeys.length !== 1 ? 's' : '') + ' applied';
    if (groupNames.length > 0) {
      msg += ' to ' + groupNames.join(', ');
    } else {
      msg += ' (all profiles)';
    }
    showToast(msg);
  });

  function doSearch() {
    if (!resultsEl) return;
    var q = (searchEl ? searchEl.value : '').trim().toLowerCase();
    if (q.length < 2 && activeCat === 'all') {
      resultsEl.innerHTML = '<div style="text-align:center;padding:16px;color:var(--dim);font-size:11px;">Type at least 2 characters to search, or pick a category.</div>';
      return;
    }

    var overrides = getTierOverrides();
    var results = [];

    function matchQ(name, id) {
      if (q.length < 2) return true;
      return (name || '').toLowerCase().indexOf(q) >= 0 || (id || '').toLowerCase().indexOf(q) >= 0;
    }

    if (activeCat === 'all' || activeCat === 'countries' || activeCat === 'capitals' || activeCat === 'flags') {
      Object.keys(COUNTRY_DATA).forEach(function(numId) {
        var c = COUNTRY_DATA[numId];
        if (!matchQ(c.name, c.id)) return;
        if (activeCat === 'all' || activeCat === 'countries') {
          results.push({ itemId: 'country_' + c.id, name: c.flag + ' ' + c.name, cat: 'countries', defaultTier: c.tier, currentTier: overrides['country_' + c.id] || c.tier });
        }
        if (activeCat === 'all' || activeCat === 'capitals') {
          results.push({ itemId: 'capital_' + c.id, name: '🏛️ ' + c.capital + ' (' + c.name + ')', cat: 'capitals', defaultTier: c.tier, currentTier: overrides['capital_' + c.id] || c.tier });
        }
        if (activeCat === 'all' || activeCat === 'flags') {
          results.push({ itemId: 'flag_' + c.id, name: c.flag + ' Flag of ' + c.name, cat: 'flags', defaultTier: c.tier, currentTier: overrides['flag_' + c.id] || c.tier });
        }
      });
    }

    var cd = getCombinedContinentData('globe');
    if (cd) {
      if (activeCat === 'all' || activeCat === 'landforms') {
        (cd.mountains || []).forEach(function(m) {
          if (!matchQ(m.name, m.id)) return;
          results.push({ itemId: 'mountain_' + m.id, name: '⛰️ ' + m.name, cat: 'landforms', defaultTier: m.tier || 5, currentTier: overrides['mountain_' + m.id] || m.tier || 5 });
        });
        (cd.peninsulas || []).forEach(function(p) {
          if (!matchQ(p.name, p.id)) return;
          results.push({ itemId: 'peninsula_' + p.id, name: '🏔️ ' + p.name, cat: 'landforms', defaultTier: p.tier || 5, currentTier: overrides['peninsula_' + p.id] || p.tier || 5 });
        });
        (cd.islands || []).forEach(function(i) {
          if (!matchQ(i.name, i.id)) return;
          results.push({ itemId: 'island_' + i.id, name: '🏝️ ' + i.name, cat: 'landforms', defaultTier: i.tier || 5, currentTier: overrides['island_' + i.id] || i.tier || 5 });
        });
        (cd.archipelagos || []).forEach(function(a) {
          if (!matchQ(a.name, a.id)) return;
          results.push({ itemId: 'archipelago_' + a.id, name: '🗾 ' + a.name, cat: 'landforms', defaultTier: a.tier || 5, currentTier: overrides['archipelago_' + a.id] || a.tier || 5 });
        });
      }
      if (activeCat === 'all' || activeCat === 'water') {
        (cd.rivers || []).forEach(function(r) {
          if (!matchQ(r.name, r.id)) return;
          results.push({ itemId: 'river_' + r.id, name: '🏞️ ' + r.name, cat: 'water', defaultTier: r.tier || 5, currentTier: overrides['river_' + r.id] || r.tier || 5 });
        });
        (cd.waterBodies || []).forEach(function(w) {
          if (!matchQ(w.name, w.id)) return;
          var icon = '🌊';
          var n = (w.name || '').toLowerCase();
          if (n.indexOf('lake') >= 0) icon = '💧';
          else if (n.indexOf('gulf') >= 0 || n.indexOf('bay') >= 0) icon = '🫗';
          else if (n.indexOf('strait') >= 0 || n.indexOf('channel') >= 0) icon = '🔀';
          else if (n.indexOf('ocean') >= 0) icon = '🌏';
          results.push({ itemId: 'water_' + w.id, name: icon + ' ' + w.name, cat: 'water', defaultTier: w.tier || 5, currentTier: overrides['water_' + w.id] || w.tier || 5 });
        });
      }
      if (activeCat === 'all' || activeCat === 'cities') {
        (cd.cities || []).forEach(function(c) {
          if (!matchQ(c.name, c.id)) return;
          results.push({ itemId: 'city_' + c.id, name: '🏙️ ' + c.name + (c.country ? ' (' + c.country + ')' : ''), cat: 'cities', defaultTier: c.tier || 5, currentTier: overrides['city_' + c.id] || c.tier || 5 });
        });
        (cd.heritageSites || []).forEach(function(h) {
          if (!matchQ(h.name, h.id)) return;
          results.push({ itemId: 'heritage_' + h.id, name: '🏛️ ' + h.name, cat: 'cities', defaultTier: h.tier || 5, currentTier: overrides['heritage_' + h.id] || h.tier || 5 });
        });
      }
      if (activeCat === 'all' || activeCat === 'culture') {
        (cd.triviaQuestions || []).forEach(function(t) {
          if (!matchQ(t.label, t.id)) return;
          results.push({ itemId: 'trivia_' + t.id, name: '🧠 ' + (t.label || '').slice(0, 60), cat: 'culture', defaultTier: t.tier || 5, currentTier: overrides['trivia_' + t.id] || t.tier || 5 });
        });
        (cd.languageQuestions || []).forEach(function(l) {
          if (!matchQ(l.label, l.id)) return;
          results.push({ itemId: 'language_' + l.id, name: '🗣️ ' + (l.label || '').slice(0, 60), cat: 'culture', defaultTier: l.tier || 5, currentTier: overrides['language_' + l.id] || l.tier || 5 });
        });
      }
    }

    results.sort(function(a, b) {
      if (a.defaultTier !== b.defaultTier) return a.defaultTier - b.defaultTier;
      return a.name.localeCompare(b.name);
    });
    if (results.length > 150) results = results.slice(0, 150);

    if (!results.length) {
      resultsEl.innerHTML = '<div style="text-align:center;padding:16px;color:var(--dim);font-size:11px;">No results found.</div>';
      return;
    }

    var h = '<div style="font-size:10px;color:var(--dim);margin-bottom:6px;">' + results.length + ' items' + (results.length >= 150 ? ' (showing first 150)' : '') + '</div>';
    results.forEach(function(r) {
      var isOverridden = r.currentTier !== r.defaultTier;
      h += '<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid rgba(91,143,255,.06);">';
      h += '<span style="flex:1;font-size:11px;color:#fff;' + (isOverridden ? 'font-weight:700;' : '') + '">' + r.name + '</span>';
      if (isOverridden) {
        h += '<button class="tier-reset-one" data-itemid="' + r.itemId + '" style="background:none;color:var(--wrong);font-size:9px;font-weight:700;border:none;cursor:pointer;padding:2px 4px;">↩</button>';
      }
      h += '<select class="tier-sel" data-itemid="' + r.itemId + '" data-default="' + r.defaultTier + '" style="width:62px;padding:4px;border-radius:6px;background:' + (isOverridden ? 'rgba(91,143,255,.2)' : 'var(--edu-bg-panel)') + ';color:#fff;border:1px solid ' + (isOverridden ? 'var(--edu-accent)' : 'var(--edu-border)') + ';font-size:11px;">';
      for (var t = 1; t <= 13; t++) {
        h += '<option value="' + t + '"' + (r.currentTier === t ? ' selected' : '') + '>T' + t + '</option>';
      }
      h += '</select>';
      h += '</div>';
    });
    resultsEl.innerHTML = h;

    resultsEl.querySelectorAll('.tier-sel').forEach(function(sel) {
      sel.addEventListener('change', function() {
        var itemId = this.getAttribute('data-itemid');
        var defTier = parseInt(this.getAttribute('data-default'));
        var newTier = parseInt(this.value);
        var ov = getTierOverrides();
        if (newTier === defTier) { delete ov[itemId]; } else { ov[itemId] = newTier; }
        saveTierOverrides(ov);
        renderEduCards();
        setTimeout(function() {
          var tab = document.querySelector('[data-tab="overrides"]');
          if (tab) tab.click();
        }, 50);
      });
    });
    resultsEl.querySelectorAll('.tier-reset-one').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var itemId = this.getAttribute('data-itemid');
        var ov = getTierOverrides();
        delete ov[itemId];
        saveTierOverrides(ov);
        renderEduCards();
        setTimeout(function() {
          var tab = document.querySelector('[data-tab="overrides"]');
          if (tab) tab.click();
        }, 50);
      });
    });
  }

  if (searchEl) searchEl.addEventListener('input', doSearch);

  root.querySelectorAll('[data-tiercat]').forEach(function(chip) {
    chip.addEventListener('click', function() {
      root.querySelectorAll('[data-tiercat]').forEach(function(c) { c.classList.remove('on'); });
      this.classList.add('on');
      activeCat = this.getAttribute('data-tiercat');
      doSearch();
    });
  });

  doSearch();
}

function renderCardCreate(editCard) {
  var root = document.getElementById('edu-cards-root');
  if (!root) return;

  var isEdit = !!editCard;
  var countryOpts = getCountryOptions();
  var groups = getEduGroups();

  var html = '';

  html += '<div class="edu-topbar">';
  html += '<div class="edu-back" id="cc-create-back">←</div>';
  html += '<div class="edu-brand"><div class="edu-brand-name">' + (isEdit ? 'Edit Card' : 'New Card') + '</div><div class="edu-brand-sub">EDU</div></div>';
  html += '</div>';

  html += '<div class="edu-content">';
  html += '<div class="edu-card">';

  html += '<div class="comp-form-group">';
  html += '<label>Category</label>';
  html += '<div class="comp-row" id="cc-cat-row" style="flex-wrap:wrap;">';
  var editCatGroup = editCard ? CARD_TYPES.find(function(t) { return t.key === editCard.cardType; }) : null;
  var editCatKey = editCatGroup ? editCatGroup.cat : 'countries';
  CARD_CAT_GROUPS.forEach(function(g) {
    var sel = editCard ? editCatKey === g.cat : g.cat === 'countries';
    html += '<div class="comp-chip' + (sel ? ' on' : '') + '" data-catgrp="' + g.cat + '" style="font-size:12px;padding:6px 10px;">' + g.icon + ' ' + g.label + '</div>';
  });
  html += '</div></div>';

  html += '<div class="comp-form-group" id="cc-sub-wrap" style="display:none;">';
  html += '<label>Subcategory</label>';
  html += '<div class="comp-row" id="cc-sub-row" style="flex-wrap:wrap;"></div>';
  html += '</div>';

  html += '<div class="comp-form-group">';
  html += '<label>Question</label>';
  html += '<input type="text" class="comp-input" id="cc-question" placeholder="e.g. Find the country that produces the most coffee" maxlength="120" value="' + (editCard ? escHtml(editCard.question) : '') + '">';
  html += '</div>';

  html += '<div class="comp-form-group" id="cc-country-wrap">';
  html += '<label>Target Country</label>';
  html += '<select class="comp-input" id="cc-target-country" style="appearance:auto;">';
  html += '<option value="">Select a country…</option>';
  countryOpts.forEach(function(c) {
    var sel = editCard && editCard.targetId === c.id ? ' selected' : '';
    html += '<option value="' + c.id + '"' + sel + '>' + c.flag + ' ' + c.name + '</option>';
  });
  html += '</select>';
  html += '</div>';

  html += '<div class="comp-form-group" id="cc-coords-wrap" style="display:none;">';
  html += '<label>Coordinates (lon, lat)</label>';
  html += '<div style="display:flex;gap:8px;">';
  html += '<input type="number" class="comp-input" id="cc-lon" placeholder="Longitude" step="0.01" value="' + (editCard && editCard.targetCoords ? editCard.targetCoords[0] : '') + '" style="flex:1;">';
  html += '<input type="number" class="comp-input" id="cc-lat" placeholder="Latitude" step="0.01" value="' + (editCard && editCard.targetCoords ? editCard.targetCoords[1] : '') + '" style="flex:1;">';
  html += '</div>';
  html += '</div>';

  html += '<div class="comp-form-group" id="cc-polygon-wrap" style="display:none;">';
  html += '<label>Region Polygon</label>';
  html += '<div style="display:flex;gap:8px;margin-bottom:8px;">';
  html += '<select class="comp-input" id="cc-poly-country" style="flex:1;appearance:auto;">';
  html += '<option value="">Use country border…</option>';
  countryOpts.forEach(function(c) {
    html += '<option value="' + c.id + '">' + c.flag + ' ' + c.name + '</option>';
  });
  html += '</select>';
  html += '<button class="edu-btn" id="btn-draw-polygon" style="flex-shrink:0;font-size:11px;padding:8px 14px;">📐 Draw</button>';
  html += '</div>';
  html += '<div id="cc-poly-preview" style="font-size:10px;color:var(--dim);"></div>';
  html += '</div>';

  html += '<div class="comp-form-group">';
  html += '<label>Answer (shown in feedback)</label>';
  html += '<input type="text" class="comp-input" id="cc-answer" placeholder="e.g. Brazil" maxlength="80" value="' + (editCard ? escHtml(editCard.answer) : '') + '">';
  html += '</div>';

  html += '<div class="comp-form-group">';
  html += '<label>Continent</label>';
  html += '<div class="comp-row" id="cc-cont-row">';
  TEST_CONTINENTS.forEach(function(c) {
    var sel = editCard ? editCard.continent === c.key : c.key === 'globe';
    html += '<div class="comp-chip' + (sel ? ' on' : '') + '" data-cont="' + c.key + '">' + c.label + '</div>';
  });
  html += '</div></div>';

  html += '<div class="comp-form-group">';
  html += '<label>Tier</label>';
  html += '<div style="display:flex;align-items:center;gap:10px;">';
  html += '<input type="range" id="cc-tier" min="1" max="13" value="' + (editCard ? editCard.tier : 1) + '" style="flex:1;accent-color:var(--edu-accent);">';
  html += '<span id="cc-tier-lbl" style="font-family:\'Space Mono\',monospace;font-size:13px;font-weight:700;color:var(--edu-accent);min-width:90px;text-align:right;">T' + (editCard ? editCard.tier : 1) + ' · ' + TIER_LABELS[(editCard ? editCard.tier : 1) - 1] + '</span>';
  html += '</div></div>';

  if (groups.length > 0) {
    html += '<div class="comp-form-group">';
    html += '<label>Assign to Groups</label>';
    html += '<div style="display:flex;flex-wrap:wrap;gap:6px;">';
    groups.forEach(function(g) {
      var checked = editCard && editCard.groups && editCard.groups.indexOf(g.id) >= 0;
      html += '<label style="display:flex;align-items:center;gap:6px;padding:6px 10px;background:var(--edu-bg-panel);border:1px solid var(--edu-border);border-radius:8px;cursor:pointer;font-size:12px;color:#fff;">';
      html += '<input type="checkbox" class="cc-grp-cb" data-gid="' + escHtml(g.id) + '" ' + (checked ? 'checked' : '') + ' style="width:14px;height:14px;accent-color:var(--edu-accent);">';
      html += escHtml(g.name);
      html += '</label>';
    });
    html += '</div></div>';
  }

  html += '<button class="edu-btn" id="btn-cc-submit" style="width:100%;margin-top:10px;padding:14px;font-size:14px;">🃏 ' + (isEdit ? 'Save Changes' : 'Create Card') + '</button>';

  html += '</div></div>';
  root.innerHTML = html;

  var initType = editCard ? editCard.cardType : 'country';
  var initTypeInfo = CARD_TYPES.find(function(t) { return t.key === initType; }) || CARD_TYPES[0];
  var formState = {
    catGroup: editCard ? initTypeInfo.cat : 'countries',
    cardType: initType,
    continent: editCard ? editCard.continent : 'globe',
    tier: editCard ? editCard.tier : 1,
    customPolygon: editCard ? editCard.customPolygon : null
  };

  function renderSubcategories() {
    var group = CARD_CAT_GROUPS.find(function(g) { return g.cat === formState.catGroup; });
    var subWrap = document.getElementById('cc-sub-wrap');
    var subRow = document.getElementById('cc-sub-row');
    if (!group || group.types.length <= 1) {
      subWrap.style.display = 'none';
      if (group && group.types.length === 1) formState.cardType = group.types[0];
      return;
    }
    subWrap.style.display = '';
    var h = '';
    group.types.forEach(function(typeKey) {
      var t = CARD_TYPES.find(function(ct) { return ct.key === typeKey; });
      if (!t) return;
      var sel = formState.cardType === typeKey;
      h += '<div class="comp-chip' + (sel ? ' on' : '') + '" data-subtype="' + typeKey + '" style="font-size:11px;padding:5px 9px;">' + t.icon + ' ' + t.label + '</div>';
    });
    subRow.innerHTML = h;
    subRow.querySelectorAll('.comp-chip').forEach(function(chip) {
      chip.addEventListener('click', function() {
        subRow.querySelectorAll('.comp-chip').forEach(function(c) { c.classList.remove('on'); });
        this.classList.add('on');
        formState.cardType = this.getAttribute('data-subtype');
        updateTargetVisibility();
      });
    });
  }

  function updateTargetVisibility() {
    var typeInfo = CARD_TYPES.find(function(t) { return t.key === formState.cardType; }) || CARD_TYPES[0];
    var isPoly = typeInfo.target === 'polygon';
    var isCoords = typeInfo.target === 'coords';
    document.getElementById('cc-country-wrap').style.display = (!isCoords && !isPoly) ? '' : 'none';
    document.getElementById('cc-coords-wrap').style.display = isCoords ? '' : 'none';
    document.getElementById('cc-polygon-wrap').style.display = isPoly ? '' : 'none';
  }

  renderSubcategories();
  updateTargetVisibility();

  if (formState.customPolygon) {
    var prev = document.getElementById('cc-poly-preview');
    if (prev) prev.textContent = 'Custom polygon: ' + formState.customPolygon.length + ' vertices';
  }

  document.getElementById('cc-create-back')?.addEventListener('click', function() { renderEduCards(); });

  document.getElementById('cc-cat-row')?.querySelectorAll('.comp-chip').forEach(function(chip) {
    chip.addEventListener('click', function() {
      document.getElementById('cc-cat-row').querySelectorAll('.comp-chip').forEach(function(c) { c.classList.remove('on'); });
      this.classList.add('on');
      formState.catGroup = this.getAttribute('data-catgrp');
      var group = CARD_CAT_GROUPS.find(function(g) { return g.cat === formState.catGroup; });
      if (group) formState.cardType = group.types[0];
      renderSubcategories();
      updateTargetVisibility();
    });
  });

  document.getElementById('cc-cont-row')?.querySelectorAll('.comp-chip').forEach(function(chip) {
    chip.addEventListener('click', function() {
      document.getElementById('cc-cont-row').querySelectorAll('.comp-chip').forEach(function(c) { c.classList.remove('on'); });
      this.classList.add('on');
      formState.continent = this.getAttribute('data-cont');
    });
  });

  var tierSlider = document.getElementById('cc-tier');
  var tierLbl = document.getElementById('cc-tier-lbl');
  if (tierSlider) {
    tierSlider.addEventListener('input', function() {
      formState.tier = parseInt(this.value);
      tierLbl.textContent = 'T' + formState.tier + ' · ' + (TIER_LABELS[formState.tier - 1] || '');
    });
  }

  document.getElementById('btn-draw-polygon')?.addEventListener('click', function() {
    renderPolygonDraw(function(polygon) {
      formState.customPolygon = polygon;
      var prev = document.getElementById('cc-poly-preview');
      if (prev) prev.textContent = 'Custom polygon: ' + polygon.length + ' vertices';
      renderCardCreate(editCard);
      setTimeout(function() {
        var catChip = document.querySelector('[data-catgrp="custom"]');
        if (catChip) catChip.click();
      }, 50);
    });
  });

  document.getElementById('cc-poly-country')?.addEventListener('change', function() {
    var countryId = this.value;
    if (!countryId) { formState.customPolygon = null; return; }
    var numId = Object.keys(COUNTRY_DATA).find(function(k) { return COUNTRY_DATA[k].id === countryId; });
    if (numId) {
      formState.cardType = 'country';
      var entry = COUNTRY_DATA[numId];
      document.getElementById('cc-answer').value = entry.name;
      var prev = document.getElementById('cc-poly-preview');
      if (prev) prev.textContent = 'Using ' + entry.name + ' country polygon';
    }
  });

  document.getElementById('btn-cc-submit')?.addEventListener('click', function() {
    var question = (document.getElementById('cc-question').value || '').trim();
    if (!question) { showToast('Enter a question'); return; }
    var answer = (document.getElementById('cc-answer').value || '').trim();
    if (!answer) { showToast('Enter an answer'); return; }

    var typeInfo = CARD_TYPES.find(function(t) { return t.key === formState.cardType; }) || CARD_TYPES[0];
    var targetId = null;
    var targetCoords = null;
    var customPolygon = null;

    if (typeInfo.target === 'polygon') {
      var polyCountry = document.getElementById('cc-poly-country')?.value;
      if (polyCountry) {
        targetId = polyCountry;
      } else if (formState.customPolygon && formState.customPolygon.length >= 3) {
        customPolygon = formState.customPolygon;
      } else {
        showToast('Select a country or draw a polygon'); return;
      }
    } else if (typeInfo.target === 'coords') {
      var lon = parseFloat(document.getElementById('cc-lon').value);
      var lat = parseFloat(document.getElementById('cc-lat').value);
      if (isNaN(lon) || isNaN(lat)) { showToast('Enter valid coordinates'); return; }
      targetCoords = [lon, lat];
    } else {
      targetId = document.getElementById('cc-target-country').value;
      if (!targetId) { showToast('Select a target country'); return; }
    }

    var selectedGroups = [];
    root.querySelectorAll('.cc-grp-cb:checked').forEach(function(cb) {
      selectedGroups.push(cb.getAttribute('data-gid'));
    });

    if (isEdit) {
      var cards = getCustomCards();
      var idx = cards.findIndex(function(c) { return c.id === editCard.id; });
      if (idx >= 0) {
        cards[idx].cardType = formState.cardType;
        cards[idx].question = question;
        cards[idx].targetId = targetId;
        cards[idx].targetCoords = targetCoords;
        cards[idx].customPolygon = customPolygon;
        cards[idx].answer = answer;
        cards[idx].tier = formState.tier;
        cards[idx].continent = formState.continent;
        cards[idx].groups = selectedGroups;
        saveCustomCards(cards);
        showToast('Card updated!');
      }
    } else {
      createCustomCard({
        cardType: formState.cardType, question: question, targetId: targetId,
        targetCoords: targetCoords, customPolygon: customPolygon, answer: answer,
        tier: formState.tier, continent: formState.continent, groups: selectedGroups
      });
    }
    renderEduCards();
  });
}

function renderPolygonDraw(onComplete) {
  var root = document.getElementById('edu-cards-root');
  if (!root) return;

  var html = '';
  html += '<div class="edu-topbar">';
  html += '<div class="edu-back" id="poly-draw-back">←</div>';
  html += '<div class="edu-brand"><div class="edu-brand-name">Draw Polygon</div><div class="edu-brand-sub">EDU</div></div>';
  html += '<div style="flex:1;"></div>';
  html += '<button class="edu-btn" id="btn-poly-undo" style="font-size:11px;padding:6px 12px;">↩ Undo</button>';
  html += '<button class="edu-btn" id="btn-poly-clear" style="font-size:11px;padding:6px 12px;background:transparent;border:1px solid var(--edu-accent);color:var(--edu-accent);margin-left:4px;">Clear</button>';
  html += '</div>';

  html += '<div class="edu-content">';
  html += '<div style="font-size:10px;color:var(--dim);margin-bottom:8px;text-align:center;">Click on the map to add vertices. Minimum 3 points.</div>';
  html += '<div id="poly-map-container" style="width:100%;height:300px;border-radius:12px;overflow:hidden;border:1px solid var(--edu-border);background:#0a1628;position:relative;cursor:crosshair;"></div>';
  html += '<div id="poly-status" style="text-align:center;margin-top:8px;font-size:12px;color:var(--dim);">0 vertices</div>';
  html += '<button class="edu-btn" id="btn-poly-done" style="width:100%;margin-top:10px;padding:14px;font-size:14px;" disabled>Done (need 3+ vertices)</button>';
  html += '</div>';

  root.innerHTML = html;

  var vertices = [];
  var container = document.getElementById('poly-map-container');
  var statusEl = document.getElementById('poly-status');
  var doneBtn = document.getElementById('btn-poly-done');
  var w = container.clientWidth || 380;
  var h = 300;

  var svg = d3.select(container).append('svg')
    .attr('width', w).attr('height', h)
    .style('background', '#0a1628');

  var projection = d3.geoEquirectangular()
    .fitSize([w, h], { type: 'Sphere' });
  var pathGen = d3.geoPath().projection(projection);

  if (typeof WORLD_TOPO !== 'undefined' && WORLD_TOPO) {
    var features = topojson.feature(WORLD_TOPO, WORLD_TOPO.objects.countries).features;
    svg.selectAll('path.land')
      .data(features)
      .join('path')
      .attr('class', 'land')
      .attr('d', pathGen)
      .attr('fill', '#1a2744')
      .attr('stroke', '#2a3f66')
      .attr('stroke-width', 0.5);
  }

  var polyGroup = svg.append('g');
  var pointsGroup = svg.append('g');

  function updateDraw() {
    polyGroup.selectAll('*').remove();
    pointsGroup.selectAll('*').remove();

    if (vertices.length >= 2) {
      var pixPts = vertices.map(function(v) { return projection(v); });
      var closedPts = pixPts.concat([pixPts[0]]);
      polyGroup.append('polygon')
        .attr('points', closedPts.map(function(p) { return p[0]+','+p[1]; }).join(' '))
        .attr('fill', 'rgba(91,143,255,0.2)')
        .attr('stroke', '#5b8fff')
        .attr('stroke-width', 2);
    } else if (vertices.length === 1) {
      var p = projection(vertices[0]);
      pointsGroup.append('line')
        .attr('x1', p[0]).attr('y1', p[1]).attr('x2', p[0]).attr('y2', p[1])
        .attr('stroke', '#5b8fff').attr('stroke-width', 2);
    }

    vertices.forEach(function(v, i) {
      var p = projection(v);
      pointsGroup.append('circle')
        .attr('cx', p[0]).attr('cy', p[1]).attr('r', 4)
        .attr('fill', i === 0 ? '#ffe135' : '#5b8fff')
        .attr('stroke', '#fff').attr('stroke-width', 1);
    });

    statusEl.textContent = vertices.length + ' vertices';
    if (vertices.length >= 3) {
      doneBtn.disabled = false;
      doneBtn.textContent = 'Done (' + vertices.length + ' vertices)';
    } else {
      doneBtn.disabled = true;
      doneBtn.textContent = 'Done (need 3+ vertices)';
    }
  }

  svg.on('click', function(event) {
    var coords = d3.pointer(event);
    var geo = projection.invert(coords);
    if (geo && !isNaN(geo[0]) && !isNaN(geo[1])) {
      vertices.push([Math.round(geo[0] * 100) / 100, Math.round(geo[1] * 100) / 100]);
      updateDraw();
    }
  });

  document.getElementById('btn-poly-undo')?.addEventListener('click', function() {
    vertices.pop();
    updateDraw();
  });

  document.getElementById('btn-poly-clear')?.addEventListener('click', function() {
    vertices = [];
    updateDraw();
  });

  document.getElementById('poly-draw-back')?.addEventListener('click', function() {
    renderCardCreate();
  });

  doneBtn.addEventListener('click', function() {
    if (vertices.length >= 3 && onComplete) {
      onComplete(vertices);
    }
  });
}

var _customCardsEnabled = false;

function getCustomCardsForPool(continent, tierCeiling) {
  var all = [];
  for (var i = 0; i < localStorage.length; i++) {
    var key = localStorage.key(i);
    if (key && key.startsWith(CUSTOM_CARD_KEY_PREFIX)) {
      try {
        var cards = JSON.parse(localStorage.getItem(key));
        cards.forEach(function(c) { all.push(c); });
      } catch (e) {}
    }
  }
  return all.filter(function(c) {
    if (c.tier > tierCeiling) return false;
    if (continent !== 'globe' && c.continent !== 'globe' && c.continent !== continent) return false;
    return true;
  });
}

function customCardsToPool(cards) {
  return cards.map(function(c) {
    var typeInfo = CARD_TYPES.find(function(t) { return t.key === c.cardType; }) || CARD_TYPES[0];
    var poolCard = {
      id: c.id,
      label: c.question,
      hint: c.answer,
      cat: typeInfo.cat,
      continent: c.continent,
      _custom: true
    };

    if (typeInfo.target === 'coords' && c.targetCoords) {
      poolCard.type = 'heritage';
      poolCard.targetId = c.id;
      poolCard.targetCoords = c.targetCoords;
    } else if (typeInfo.target === 'polygon') {
      poolCard.type = 'country';
      poolCard.targetId = c.targetId || c.id;
      if (c.customPolygon) poolCard._customPolygon = c.customPolygon;
    } else {
      poolCard.type = 'country';
      poolCard.targetId = c.targetId;
    }

    return poolCard;
  });
}

(function patchBuildPoolForCustomCards() {
  var _origBuildPool = buildPool;
  buildPool = function(config, cd) {
    var ov = {};
    var hasOverrides = false;

    if (activeProfile && activeProfile.isEducator) {
      ov = getTierOverrides();
      hasOverrides = Object.keys(ov).length > 0;
    }

    var actualCeiling = config.tierCeiling || 13;
    var buildConfig = config;
    if (hasOverrides) {
      buildConfig = Object.assign({}, config, { tierCeiling: 13 });
    }

    var pool = _origBuildPool(buildConfig, cd);

    if (hasOverrides) {
      pool = pool.filter(function(item) {
        var oKey = (item.type || '') + '_' + (item.targetId || item.id);
        var overrideTier = ov[oKey];
        var effectiveTier = (overrideTier !== undefined) ? overrideTier : (item.tier || 1);
        return effectiveTier <= actualCeiling;
      });
    }

    if (_customCardsEnabled) {
      var customs = getCustomCardsForPool(config.continent, actualCeiling);
      if (customs.length) {
        var customPool = customCardsToPool(customs);
        pool = pool.concat(customPool);
      }
    }

    return pool;
  };
})();

(function patchSetupForCustomCardsToggle() {
  var _origRenderSetup = renderSetupSubPage;
  renderSetupSubPage = function(viewKey) {
    _origRenderSetup(viewKey);

    var anyCustom = false;
    for (var i = 0; i < localStorage.length; i++) {
      var key = localStorage.key(i);
      if (key && key.startsWith(CUSTOM_CARD_KEY_PREFIX)) {
        try {
          var cards = JSON.parse(localStorage.getItem(key));
          if (cards.length > 0) { anyCustom = true; break; }
        } catch (e) {}
      }
    }

    if (!anyCustom) return;

    var startBtn = document.getElementById('btn-start');
    if (!startBtn) return;

    var wrap = document.createElement('div');
    wrap.className = 'opt-toggle';
    wrap.id = 'toggle-custom-cards';
    wrap.innerHTML = '<span class="opt-lbl">🃏 Include Custom Cards</span>' +
      '<span class="mini-sw' + (_customCardsEnabled ? ' on' : '') + '"></span>';
    wrap.style.cssText = 'margin-bottom:12px;';

    startBtn.parentNode.insertBefore(wrap, startBtn);

    wrap.addEventListener('click', function() {
      _customCardsEnabled = !_customCardsEnabled;
      var sw = this.querySelector('.mini-sw');
      if (sw) sw.classList.toggle('on', _customCardsEnabled);
    });
  };
})();


