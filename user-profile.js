(function () {
  'use strict';

  const TOKEN_KEY = 'auth_token';
  const USER_KEY = 'auth_user';
  const API_BASE_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:3000'
    : '';

  function readUser() {
    try {
      return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
    } catch (_) {
      return null;
    }
  }

  function redirectToHome() {
    window.location.replace('./index.html');
  }

  function initials(user) {
    const parts = String(user.name || user.email || 'GATE Aspirant').trim().split(/\s+/).filter(Boolean);
    return (parts.slice(0, 2).map((part) => part[0]).join('') || 'GA').toUpperCase();
  }

  function renderAvatar(target, user) {
    target.replaceChildren();
    const fallback = initials(user);
    if (user.picture) {
      const image = document.createElement('img');
      image.src = user.picture;
      image.alt = '';
      image.addEventListener('error', () => target.replaceChildren(document.createTextNode(fallback)), { once: true });
      target.appendChild(image);
    } else {
      target.textContent = fallback;
    }
  }

  function renderProfile(user) {
    renderAvatar(document.getElementById('profile-avatar'), user);
    document.getElementById('profile-name').textContent = user.name || 'GATE Aspirant';
    document.getElementById('profile-email').textContent = user.email || '';
    document.getElementById('account-tag').textContent = user.isGoogleAccount ? 'Google Account' : 'Verified Email Account';
    document.getElementById('change-password-btn').hidden = Boolean(user.isGoogleAccount);
  }

  async function getSubjectTotals() {
    const response = await fetch('./topic_wise_manifest.json');
    if (!response.ok) throw new Error('Question catalog could not be loaded');
    const questions = await response.json();
    return questions.reduce((totals, question) => {
      const subject = Array.isArray(question.topics) && question.topics[0] ? String(question.topics[0]).trim() : 'Uncategorized';
      totals.set(subject || 'Uncategorized', (totals.get(subject || 'Uncategorized') || 0) + 1);
      return totals;
    }, new Map());
  }

  function renderProgress(progress, totals) {
    const list = document.getElementById('subject-progress-list');
    list.replaceChildren();
    const solvedBySubject = new Map(progress.map((item) => [item.subject, Number(item.solved) || 0]));
    const subjects = new Set([...totals.keys(), ...solvedBySubject.keys()]);
    [...subjects].sort((a, b) => a.localeCompare(b)).forEach((subject) => {
      const solved = solvedBySubject.get(subject) || 0;
      const total = totals.get(subject) || solved;
      const percent = total ? Math.min(100, Math.round((solved / total) * 100)) : 0;
      const row = document.createElement('div');
      row.className = 'subject-progress-row';
      const label = document.createElement('div');
      label.className = 'subject-progress-row__label';
      const name = document.createElement('span');
      name.textContent = subject;
      const count = document.createElement('span');
      count.textContent = `${solved} / ${total} solved`;
      label.append(name, count);
      const track = document.createElement('div');
      track.className = 'subject-progress-track';
      track.setAttribute('role', 'progressbar');
      track.setAttribute('aria-label', `${subject} progress`);
      track.setAttribute('aria-valuemin', '0');
      track.setAttribute('aria-valuemax', String(total));
      track.setAttribute('aria-valuenow', String(solved));
      const bar = document.createElement('span');
      bar.className = 'subject-progress-track__bar';
      bar.style.width = `${percent}%`;
      track.appendChild(bar);
      row.append(label, track);
      list.appendChild(row);
    });
  }

  async function loadProfile() {
    const token = localStorage.getItem(TOKEN_KEY);
    let user = readUser();
    if (!token || !user) return redirectToHome();
    renderProfile(user);

    try {
      const [statsResponse, totals] = await Promise.all([
        fetch(`${API_BASE_URL}/api/user/profile-stats`, { headers: { Authorization: `Bearer ${token}` } }),
        getSubjectTotals().catch(() => new Map())
      ]);
      if (statsResponse.status === 401) {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        return redirectToHome();
      }
      const stats = await statsResponse.json();
      if (!statsResponse.ok) throw new Error(stats.error || 'Profile stats could not be loaded');
      if (stats.user) {
        user = { ...user, ...stats.user };
        localStorage.setItem(USER_KEY, JSON.stringify(user));
        renderProfile(user);
        if (typeof window.updateHeaderUI === 'function') window.updateHeaderUI(user);
      }
      document.getElementById('total-solved').textContent = stats.totalSolved;
      document.getElementById('total-bookmarked').textContent = stats.totalBookmarked;
      renderProgress(stats.subjectProgress || [], totals);
      document.getElementById('progress-status').textContent = 'Up to date';
    } catch (error) {
      document.getElementById('progress-status').textContent = 'Unable to load progress';
      document.getElementById('subject-progress-list').textContent = error.message;
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (!localStorage.getItem(TOKEN_KEY) || !readUser()) return redirectToHome();
    if (typeof window.initTheme === 'function') window.initTheme();
    if (typeof window.updateThemeToggleButtons === 'function') window.updateThemeToggleButtons();
    document.getElementById('profile-sign-out-btn').addEventListener('click', () => {
      if (typeof window.logout === 'function') window.logout();
      else {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        redirectToHome();
      }
    });
    document.getElementById('change-password-btn').addEventListener('click', () => {
      const user = readUser();
      if (user && typeof window.openPasswordResetModal === 'function') window.openPasswordResetModal(user.email);
    });
    loadProfile();
  });
}());
