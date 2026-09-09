(function () {
  'use strict';

  const TOKEN_KEY = 'auth_token';
  const USER_KEY = 'auth_user';
  const API_BASE_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:3000' : '';

  function redirectToHome() {
    window.location.replace('./index.html');
  }

  function renderMessage(message, actionLabel) {
    const app = document.getElementById('app');
    app.innerHTML = `<main class="workspace-main"><article class="question-card card"><h1>Bookmarked Questions</h1><p class="profile-email">${message}</p>${actionLabel ? `<a class="btn btn-primary" href="./user.html">${actionLabel}</a>` : ''}</article></main>`;
    if (typeof refreshChrome === 'function') refreshChrome();
  }

  function canonicalQuestionId(question) {
    if (typeof getCanonicalQuestionId === 'function') return getCanonicalQuestionId(question);
    const exam = String(question.exam || 'GATE-CS').trim().replace(/[\s_]+/g, '-');
    const set = question.set == null || question.set === '' ? '' : `S${String(question.set).replace(/^S/i, '')}-`;
    return `${exam}-${question.year}-${set}Q${question.number ?? question.id}`;
  }

  async function getBookmarkedQuestionEntries(bookmarkIds) {
    const response = await fetch('./topic_wise_manifest.json');
    if (!response.ok) throw new Error('Question catalog could not be loaded');
    const catalog = await response.json();
    const catalogById = new Map(catalog.map((entry) => [canonicalQuestionId(entry), entry]));
    const entries = bookmarkIds.map((id) => catalogById.get(id)).filter(Boolean);

    // Preload the full JSON records once for this dedicated review workspace.
    // `workspace-core.js` recognises questionData and renders it directly.
    return Promise.all(entries.map(async (entry) => {
      const questionResponse = await fetch(`./${entry.filePath}`);
      if (!questionResponse.ok) throw new Error(`Question file could not be loaded: ${entry.filePath}`);
      const questionData = await questionResponse.json();
      return { ...entry, questionData: { ...entry, ...questionData } };
    }));
  }

  async function initialiseBookmarksWorkspace() {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return redirectToHome();

    try {
      const statsResponse = await fetch(`${API_BASE_URL}/api/user/profile-stats`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (statsResponse.status === 401) {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        return redirectToHome();
      }
      const stats = await statsResponse.json();
      if (!statsResponse.ok) throw new Error(stats.error || 'Your bookmarks could not be loaded');

      const bookmarkIds = Array.isArray(stats.bookmarks) ? stats.bookmarks : [];
      if (!bookmarkIds.length) {
        renderMessage("You haven't bookmarked any questions yet.", 'Back to Profile');
        return;
      }

      const questions = await getBookmarkedQuestionEntries(bookmarkIds);
      if (!questions.length) {
        renderMessage('Your saved questions are no longer available in this question bank.', 'Back to Profile');
        return;
      }

      // Populate shared state before the palette is drawn, so bookmarked and
      // completed indicators are accurate on the first render.
      if (typeof loadUserData === 'function') await loadUserData();
      startSession(questions, 'Bookmarked Questions', './user.html', '', 'Back to Profile');
    } catch (error) {
      renderMessage(error.message || 'Unable to load bookmarked questions.', 'Back to Profile');
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (typeof initTheme === 'function') initTheme();
    initialiseBookmarksWorkspace();
  });
}());
