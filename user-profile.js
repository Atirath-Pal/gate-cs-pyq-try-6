(function () {
  'use strict';

  const TOKEN_KEY = 'auth_token';
  const USER_KEY = 'auth_user';
  const API_BASE_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:3000' : '';
  const GAUGE_CIRCUMFERENCE = 2 * Math.PI * 68;

  function readUser() {
    try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch (_) { return null; }
  }
  function redirectToHome() { window.location.replace('./index.html'); }
  function initials(user) {
    const parts = String(user.name || user.email || 'GATE Aspirant').trim().split(/\s+/).filter(Boolean);
    return (parts.slice(0, 2).map((part) => part[0]).join('') || 'GA').toUpperCase();
  }
  function renderAvatar(target, user) {
    target.replaceChildren();
    const fallback = initials(user);
    if (!user.picture) { target.textContent = fallback; return; }
    const image = document.createElement('img');
    image.src = user.picture; image.alt = '';
    image.addEventListener('error', () => target.replaceChildren(document.createTextNode(fallback)), { once: true });
    target.appendChild(image);
  }
  function renderProfile(user) {
    renderAvatar(document.getElementById('profile-avatar'), user);
    document.getElementById('profile-name').textContent = user.name || 'GATE Aspirant';
    document.getElementById('profile-email').textContent = user.email || '';
    document.getElementById('account-tag').textContent = user.isGoogleAccount ? 'Google Account' : 'Verified Email Account';
    document.getElementById('change-password-btn').hidden = Boolean(user.isGoogleAccount);
  }
  function canonicalQuestionId(question) {
    const exam = String(question.exam || 'GATE-CS').trim().replace(/[\s_]+/g, '-');
    const set = question.set == null || question.set === '' ? '' : `S${String(question.set).replace(/^S/i, '')}-`;
    return `${exam}-${question.year}-${set}Q${question.number ?? question.id}`;
  }
  // Canonical IDs look like GATE-CS-2026-S1-Q1. The profile uses this ID
  // directly to derive paper year/set, independent of the currently open page.
  function parseQuestionId(questionId) {
    const match = /(?:GATE[-_ ]?CS[-_ ]?)?(\d{4})(?:[-_ ]?(?:S|SET)[-_ ]?(\d+))?[-_ ]?Q(?:UESTION)?[-_ ]?(\d+)/i.exec(String(questionId || ''));
    return match ? { year: Number(match[1]), set: match[2] ? Number(match[2]) : null } : null;
  }
  async function getCatalog() {
    const [paperResponse, topicResponse] = await Promise.all([
      fetch('./Previous%20Year%20Questions/manifest.json'), fetch('./topic_wise_manifest.json')
    ]);
    if (!paperResponse.ok || !topicResponse.ok) throw new Error('Question catalog could not be loaded');
    const [papers, questions] = await Promise.all([paperResponse.json(), topicResponse.json()]);
    const subjectsById = new Map(), subjectTotals = new Map(), paperTotals = new Map();
    questions.forEach((question) => {
      const subject = Array.isArray(question.topics) && question.topics[0]
        ? String(question.topics[0]).trim() || 'Uncategorized' : 'Uncategorized';
      subjectsById.set(canonicalQuestionId(question), subject);
      subjectTotals.set(subject, (subjectTotals.get(subject) || 0) + 1);
    });
    papers.forEach((paper) => {
      const match = /GATE\s+CS\s+(\d{4})(?:\s+SET\s+(\d+))?/i.exec(String(paper.folderName || paper.title || ''));
      if (!match) return;
      const key = `${match[1]}-${match[2] || 'all'}`;
      paperTotals.set(key, { year: Number(match[1]), set: match[2] ? Number(match[2]) : null, total: Number(paper.questionCount) || 0 });
    });
    return { totalQuestions: papers.reduce((sum, paper) => sum + (Number(paper.questionCount) || 0), 0), subjectsById, subjectTotals, paperTotals };
  }
  function makeProgressRow(labelText, solved, total) {
    const percent = total ? Math.min(100, Math.round((solved / total) * 100)) : 0;
    const row = document.createElement('div'); row.className = 'subject-progress-row';
    const label = document.createElement('div'); label.className = 'subject-progress-row__label';
    const name = document.createElement('span'); name.textContent = labelText;
    const count = document.createElement('span'); count.textContent = `${solved} / ${total} solved`;
    label.append(name, count);
    const track = document.createElement('div'); track.className = 'subject-progress-track';
    track.setAttribute('role', 'progressbar'); track.setAttribute('aria-label', `${labelText} progress`);
    track.setAttribute('aria-valuemin', '0'); track.setAttribute('aria-valuemax', String(total)); track.setAttribute('aria-valuenow', String(solved));
    const bar = document.createElement('span'); bar.className = 'subject-progress-track__bar'; bar.style.width = `${percent}%`;
    track.appendChild(bar); row.append(label, track); return row;
  }
  function renderSubjectProgress(solvedQuestions, catalog) {
    const list = document.getElementById('subject-progress-list'); list.replaceChildren();
    const solvedBySubject = new Map();
    solvedQuestions.forEach(({ questionId }) => {
      const subject = catalog.subjectsById.get(questionId) || 'Uncategorized';
      solvedBySubject.set(subject, (solvedBySubject.get(subject) || 0) + 1);
    });
    const subjects = new Set([...catalog.subjectTotals.keys(), ...solvedBySubject.keys()]);
    [...subjects].sort((a, b) => a.localeCompare(b)).forEach((subject) => {
      list.appendChild(makeProgressRow(subject, solvedBySubject.get(subject) || 0, catalog.subjectTotals.get(subject) || solvedBySubject.get(subject) || 0));
    });
  }
  function renderYearProgress(solvedQuestions, catalog) {
    const list = document.getElementById('year-progress-list'); list.replaceChildren();
    const solvedByPaper = new Map();
    solvedQuestions.forEach(({ questionId }) => {
      const parsed = parseQuestionId(questionId);
      if (!parsed) return;
      const key = `${parsed.year}-${parsed.set || 'all'}`;
      solvedByPaper.set(key, (solvedByPaper.get(key) || 0) + 1);
    });
    const papers = new Map(catalog.paperTotals);
    solvedByPaper.forEach((solved, key) => {
      if (papers.has(key)) return;
      const [year, set] = key.split('-');
      papers.set(key, { year: Number(year), set: set === 'all' ? null : Number(set), total: solved });
    });
    [...papers.entries()].sort(([, a], [, b]) => b.year - a.year || (a.set || 0) - (b.set || 0)).forEach(([key, paper]) => {
      list.appendChild(makeProgressRow(`GATE CS ${paper.year}${paper.set ? ` · Set ${paper.set}` : ''}`, solvedByPaper.get(key) || 0, paper.total));
    });
  }
  function toDateKey(value) {
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
  function renderActivity(solvedQuestions) {
    const counts = new Map();
    solvedQuestions.forEach(({ updatedAt }) => {
      const key = toDateKey(updatedAt);
      if (key) counts.set(key, (counts.get(key) || 0) + 1);
    });
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const start = new Date(today); start.setDate(start.getDate() - 364 - start.getDay());
    const grid = document.getElementById('activity-heatmap'); grid.replaceChildren();
    let highest = 0;
    for (let date = new Date(start); date <= today; date.setDate(date.getDate() + 1)) highest = Math.max(highest, counts.get(toDateKey(date)) || 0);
    for (let date = new Date(start); date <= today; date.setDate(date.getDate() + 1)) {
      const key = toDateKey(date), count = counts.get(key) || 0;
      const cell = document.createElement('span');
      cell.className = `activity-cell activity-cell--${count ? Math.min(4, Math.ceil((count / highest) * 4)) : 0}`;
      cell.title = `${count} question${count === 1 ? '' : 's'} solved on ${date.toLocaleDateString()}`;
      cell.setAttribute('aria-label', cell.title); grid.appendChild(cell);
    }
    const activeDates = [...counts.keys()].sort();
    let currentStreak = 0, cursor = new Date(today);
    while (counts.has(toDateKey(cursor))) { currentStreak += 1; cursor.setDate(cursor.getDate() - 1); }
    let maxStreak = 0, streak = 0, previous = null;
    activeDates.forEach((key) => {
      const date = new Date(`${key}T00:00:00`);
      streak = previous && date - previous === 86400000 ? streak + 1 : 1;
      maxStreak = Math.max(maxStreak, streak); previous = date;
    });
    document.getElementById('active-days').textContent = activeDates.length;
    document.getElementById('current-streak').textContent = currentStreak;
    document.getElementById('max-streak').textContent = maxStreak;
  }
  function renderMainProgress(totalSolved, totalQuestions) {
    const percent = totalQuestions ? Math.min(100, totalSolved / totalQuestions * 100) : 0;
    const ring = document.getElementById('progress-gauge-ring');
    ring.style.strokeDasharray = String(GAUGE_CIRCUMFERENCE);
    ring.style.strokeDashoffset = String(GAUGE_CIRCUMFERENCE * (1 - percent / 100));
    document.getElementById('gauge-value').textContent = `${totalSolved} / ${totalQuestions}`;
    document.getElementById('progress-summary').textContent = `${Math.round(percent)}% of the complete PYQ question bank solved.`;
  }
  function setupBreakdownToggle(buttonId, sectionId) {
    const button = document.getElementById(buttonId), section = document.getElementById(sectionId);
    button.addEventListener('click', () => {
      const showing = section.classList.contains('is-visible');
      button.classList.toggle('is-active', !showing); button.setAttribute('aria-expanded', String(!showing));
      if (showing) {
        section.classList.remove('is-visible');
        window.setTimeout(() => { section.hidden = true; }, 220);
      } else {
        section.hidden = false;
        window.requestAnimationFrame(() => section.classList.add('is-visible'));
      }
    });
  }
  async function loadProfile() {
    const token = localStorage.getItem(TOKEN_KEY);
    let user = readUser();
    if (!token || !user) return redirectToHome();
    renderProfile(user);
    try {
      const [statsResponse, catalog] = await Promise.all([
        fetch(`${API_BASE_URL}/api/user/profile-stats`, { headers: { Authorization: `Bearer ${token}` } }), getCatalog()
      ]);
      if (statsResponse.status === 401) { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); return redirectToHome(); }
      const stats = await statsResponse.json();
      if (!statsResponse.ok) throw new Error(stats.error || 'Profile stats could not be loaded');
      if (stats.user) {
        user = { ...user, ...stats.user }; localStorage.setItem(USER_KEY, JSON.stringify(user)); renderProfile(user);
        if (typeof window.updateHeaderUI === 'function') window.updateHeaderUI(user);
      }
      const solvedQuestions = Array.isArray(stats.solvedQuestions) ? stats.solvedQuestions : [];
      document.getElementById('total-solved').textContent = solvedQuestions.length;
      document.getElementById('total-bookmarked').textContent = Array.isArray(stats.bookmarks) ? stats.bookmarks.length : Number(stats.totalBookmarked) || 0;
      renderMainProgress(solvedQuestions.length, catalog.totalQuestions);
      renderSubjectProgress(solvedQuestions, catalog); renderYearProgress(solvedQuestions, catalog); renderActivity(solvedQuestions);
      document.getElementById('progress-status').textContent = 'Up to date';
    } catch (error) {
      document.getElementById('progress-status').textContent = 'Unable to load progress';
      document.getElementById('progress-summary').textContent = error.message;
    }
  }
  document.addEventListener('DOMContentLoaded', () => {
    if (!localStorage.getItem(TOKEN_KEY) || !readUser()) return redirectToHome();
    if (typeof window.initTheme === 'function') window.initTheme();
    if (typeof window.updateThemeToggleButtons === 'function') window.updateThemeToggleButtons();
    setupBreakdownToggle('year-progress-toggle', 'year-progress-section');
    setupBreakdownToggle('subject-progress-toggle', 'subject-progress-section');
    document.getElementById('profile-sign-out-btn').addEventListener('click', () => {
      if (typeof window.logout === 'function') window.logout();
      else { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); redirectToHome(); }
    });
    document.getElementById('change-password-btn').addEventListener('click', () => {
      const user = readUser();
      if (user && typeof window.openPasswordResetModal === 'function') window.openPasswordResetModal(user.email);
    });
    loadProfile();
  });
}());
