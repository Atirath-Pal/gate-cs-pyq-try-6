// --- STATE ---
const appDiv = document.getElementById('app');
let currentQuestionData = null;
let currentFolderName = '';
let currentQuestionNumber = 1;
const questionStatuses = {};
window.userState = window.userState || {
  bookmarks: new Set(),
  completed: new Set(),
  isLoaded: false
};

// Keep the state shape reliable if this script is loaded more than once.
window.userState.bookmarks = window.userState.bookmarks instanceof Set
  ? window.userState.bookmarks : new Set(window.userState.bookmarks || []);
window.userState.completed = window.userState.completed instanceof Set
  ? window.userState.completed : new Set(window.userState.completed || []);
window.userState.isLoaded = Boolean(window.userState.isLoaded);

const pendingSync = {
  bookmarks: new Map(),
  statuses: new Map()
};
let syncTimer = null;
let syncInFlight = false;
const API_BASE_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? 'http://localhost:3000'
  : '';
let currentSession = {
  questions: [],
  title: '',
  backHref: './index.html',
  headerExtraHTML: ''
};

function sessionLength() {
  return currentSession.questions.length;
}

// --- THEME ---
function initTheme() {
  const saved = localStorage.getItem('gate-pyq-theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('gate-pyq-theme', next);
  updateThemeToggleButtons();
}

function updateThemeToggleButtons() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  document.querySelectorAll('[data-theme-toggle]').forEach(btn => {
    btn.innerHTML = isDark
      ? '<i data-lucide="sun" class="theme-icon"></i> <span class="btn-label">Light</span>'
      : '<i data-lucide="moon" class="theme-icon"></i> <span class="btn-label">Dark</span>';
  });
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function refreshChrome() {
  if (typeof lucide !== 'undefined') lucide.createIcons();
  if (typeof renderClerkHeader === 'function') renderClerkHeader();
}

function getQuestionId(q) {
  return `GATE-CS-${q.year}-${q.set ? 'S' + q.set + '-' : ''}Q${q.id}`;
}

function formatQuestionHeading(q) {
  const setPart = q.set != null && q.set !== '' ? ` SET ${q.set}` : '';
  return `GATE CS ${q.year}${setPart} Q.${q.id}`;
}

function getClerkClient() {
  return window.clerk || window.Clerk;
}

function isClerkSignedIn() {
  const clerk = getClerkClient();
  return !!(clerk && clerk.user && clerk.session);
}

async function getClerkToken({ promptSignIn = true } = {}) {
  const clerk = getClerkClient();
  if (!isClerkSignedIn()) {
    if (promptSignIn && clerk && typeof clerk.openSignIn === 'function') clerk.openSignIn();
    return null;
  }
  return clerk.session.getToken();
}

function applyTrackingButtonState(btn, isActive, activeClass, activeLabel, idleLabel) {
  if (!btn) return;
  btn.classList.toggle('active', isActive);
  btn.classList.toggle(activeClass, isActive);
  btn.textContent = isActive ? activeLabel : idleLabel;
}

function refreshTrackingUI() {
  syncTrackingButtons();
  updateAllPaletteButtons();
}

let userDataRequestId = 0;

function clearUserProgress() {
  window.userState.bookmarks.clear();
  window.userState.completed.clear();
  window.userState.isLoaded = false;
  pendingSync.bookmarks.clear();
  pendingSync.statuses.clear();
  if (syncTimer) window.clearTimeout(syncTimer);
  syncTimer = null;
}

function applyPendingChangesToUserState() {
  pendingSync.bookmarks.forEach((bookmarked, questionId) => {
    if (bookmarked) window.userState.bookmarks.add(questionId);
    else window.userState.bookmarks.delete(questionId);
  });
  pendingSync.statuses.forEach((isDone, questionId) => {
    if (isDone) window.userState.completed.add(questionId);
    else window.userState.completed.delete(questionId);
  });
}

async function loadUserData() {
  const requestId = ++userDataRequestId;
  const clerk = getClerkClient();

  if (!(clerk && clerk.user)) {
    clearUserProgress();
    refreshTrackingUI();
    return;
  }

  try {
    const token = await clerk.session.getToken();
    if (requestId !== userDataRequestId) return;
    if (!token) {
      clearUserProgress();
      refreshTrackingUI();
      return;
    }

    const response = await fetch(`${API_BASE_URL}/api/user-data`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) {
      throw new Error(`Failed to load user data: ${response.status}`);
    }

    const data = await response.json();
    if (requestId !== userDataRequestId) return;

    window.userState.bookmarks = new Set(data.bookmarks || []);
    window.userState.completed = new Set(data.completed || []);
    // Do not let a slow user-data response overwrite an optimistic click.
    applyPendingChangesToUserState();
    window.userState.isLoaded = true;
    refreshTrackingUI();
  } catch (err) {
    if (requestId === userDataRequestId) console.error(err);
  }
}

function hasPendingSync() {
  return pendingSync.bookmarks.size > 0 || pendingSync.statuses.size > 0;
}

function debounceSync() {
  if (syncTimer) window.clearTimeout(syncTimer);
  syncTimer = window.setTimeout(() => {
    syncTimer = null;
    flushSyncQueue();
  }, 1500);
}

async function flushSyncQueue() {
  if (!hasPendingSync() || syncInFlight || !isClerkSignedIn()) return;

  const token = await getClerkToken({ promptSignIn: false });
  if (!token || syncInFlight) return;

  // Snapshot the queue. New clicks can continue to update the Maps while this
  // request is in flight, and are retained for the next batch.
  const bookmarks = new Map(pendingSync.bookmarks);
  const statuses = new Map(pendingSync.statuses);
  syncInFlight = true;

  try {
    const response = await fetch(`${API_BASE_URL}/api/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        bookmarks: Array.from(bookmarks, ([questionId, bookmarked]) => ({ questionId, bookmarked })),
        statuses: Array.from(statuses, ([questionId, isDone]) => ({ questionId, isDone }))
      }),
      // Allows the small final batch to continue during page unload where supported.
      keepalive: document.visibilityState === 'hidden'
    });

    if (!response.ok) throw new Error(`Sync failed: ${response.status}`);

    // Clear only unchanged entries, so a newer click is never lost.
    bookmarks.forEach((bookmarked, questionId) => {
      if (pendingSync.bookmarks.get(questionId) === bookmarked) {
        pendingSync.bookmarks.delete(questionId);
      }
    });
    statuses.forEach((isDone, questionId) => {
      if (pendingSync.statuses.get(questionId) === isDone) {
        pendingSync.statuses.delete(questionId);
      }
    });
  } catch (err) {
    // Retain the queue for a subsequent interaction or retry rather than
    // reverting an optimistic UI update that may still be saved.
    console.error('Could not sync tracking changes', err);
  } finally {
    syncInFlight = false;
    const hasChangesAfterSnapshot = Array.from(pendingSync.bookmarks)
      .some(([questionId, bookmarked]) => bookmarks.get(questionId) !== bookmarked)
      || Array.from(pendingSync.statuses)
        .some(([questionId, isDone]) => statuses.get(questionId) !== isDone);
    if (hasChangesAfterSnapshot) debounceSync();
  }
}

window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    flushSyncQueue();
  }
});

function syncTrackingButtons() {
  if (!currentQuestionData) return;
  const questionId = getQuestionId(currentQuestionData);
  applyTrackingButtonState(
    document.getElementById('bookmark-btn'),
    window.userState.bookmarks.has(questionId),
    'bookmarked',
    '★ Bookmarked',
    'Bookmark'
  );
  applyTrackingButtonState(
    document.getElementById('done-btn'),
    window.userState.completed.has(questionId),
    'done',
    '✓ Done',
    'Mark as Done'
  );
}

function toggleBookmark() {
  if (!currentQuestionData) return;
  if (!isClerkSignedIn()) {
    getClerkToken();
    return;
  }
  const questionId = getQuestionId(currentQuestionData);
  const bookmarked = !window.userState.bookmarks.has(questionId);

  if (bookmarked) window.userState.bookmarks.add(questionId);
  else window.userState.bookmarks.delete(questionId);
  pendingSync.bookmarks.set(questionId, bookmarked);
  refreshTrackingUI();
  debounceSync();
}

function toggleMarkDone() {
  if (!currentQuestionData) return;
  if (!isClerkSignedIn()) {
    getClerkToken();
    return;
  }
  const questionId = getQuestionId(currentQuestionData);
  const isDone = !window.userState.completed.has(questionId);

  if (isDone) window.userState.completed.add(questionId);
  else window.userState.completed.delete(questionId);
  pendingSync.statuses.set(questionId, isDone);
  refreshTrackingUI();
  debounceSync();
}

function themeToggleHTML() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const label = isDark ? 'Light' : 'Dark';
  const icon = isDark ? 'sun' : 'moon';
  return `<button type="button" class="btn btn-theme" data-theme-toggle onclick="toggleTheme()"><i data-lucide="${icon}"></i> <span class="btn-label">${label}</span></button>`;
}

function clerkAuthControlsHTML() {
  return `
    <div id="clerk-auth" class="clerk-auth">
      <div id="user-button" class="clerk-user-button" hidden></div>
      <button type="button" id="sign-in-btn" class="btn btn-primary" hidden>Sign In</button>
    </div>
  `;
}

// --- BASE PATH FIX ---
const BASE_URL = (() => {
  if (location.hostname.endsWith('github.io')) {
    const firstSegment = location.pathname.split('/').filter(Boolean)[0];
    return firstSegment ? `/${firstSegment}` : '';
  }
  return '';
})();

function fixAssetPaths(html) {
  if (!html) return html;
  return html.replace(/(src|href)="\//g, `$1="${BASE_URL}/`);
}

function parseHashParts() {
  const hash = window.location.hash || '#/';
  const path = hash.replace(/^#\/?/, '');
  return path.split('/').filter(Boolean).map(part => decodeURIComponent(part));
}

function listingHeaderHTML(backHref) {
  const homeLink = backHref
    ? `<a href="${backHref}" class="workspace-header__home">
         <i data-lucide="arrow-left"></i> <span class="btn-label">Home</span>
       </a>
       <span class="workspace-header__divider"></span>`
    : '';

  return `
    <header class="home-header glass">
      <div class="home-header__brand">
        ${homeLink}
        <h1 class="home-header__title">GATECS.IO</h1>
        <span class="badge badge-live">
          <span class="badge-live-dot"></span>
          LIVE DATABASE ACTIVE
        </span>
      </div>
      <div class="home-header__actions">
        ${themeToggleHTML()}
        ${clerkAuthControlsHTML()}
      </div>
    </header>
  `;
}

function yearCardHTML(title, count, href, tag) {
  return `
    <article class="year-card">
      <span class="year-card__tag">${tag}</span>
      <h3 class="year-card__title">${title}</h3>
      <p class="year-card__count">${count} Questions</p>
      <a href="${href}" class="year-card__link">
        Launch <i data-lucide="arrow-right"></i>
      </a>
    </article>
  `;
}

function startSession(questions, title, backHref, headerExtraHTML) {
  currentSession = {
    questions,
    title,
    backHref,
    headerExtraHTML: headerExtraHTML || ''
  };
  currentQuestionNumber = 1;
  Object.keys(questionStatuses).forEach(k => delete questionStatuses[k]);
  renderWorkspacePage();
}

// --- PALETTE STATUS ---
function updatePaletteButton(qNumber) {
  const btn = document.getElementById(`p-btn-${qNumber}`);
  if (!btn) return;

  btn.classList.remove(
    'palette-btn--active',
    'palette-btn--answered',
    'palette-btn--correct',
    'palette-btn--incorrect',
    'palette-btn--warning',
    'palette-btn--done'
  );

  const entry = currentSession.questions[qNumber - 1];
  const questionId = entry && entry.questionId;
  const isDone = Boolean(questionId && window.userState.completed.has(questionId));
  const isBookmarked = Boolean(questionId && window.userState.bookmarks.has(questionId));
  btn.classList.toggle('palette-btn--done', isDone);
  btn.classList.toggle('is-done', isDone);
  btn.classList.toggle('is-bookmarked', isBookmarked);

  const status = questionStatuses[qNumber];
  if (qNumber === currentQuestionNumber) {
    btn.classList.add('palette-btn--active');
  }
  if (status === 'correct') btn.classList.add('palette-btn--correct');
  else if (status === 'incorrect') btn.classList.add('palette-btn--incorrect');
  else if (status === 'warning') btn.classList.add('palette-btn--warning');
  else if (status === 'answered') btn.classList.add('palette-btn--answered');
}

function updateAllPaletteButtons() {
  const n = sessionLength();
  for (let i = 1; i <= n; i++) updatePaletteButton(i);
}

function setQuestionStatus(qNumber, status) {
  questionStatuses[qNumber] = status;
  updatePaletteButton(qNumber);
}

// --- NAVIGATION ---
function navigateQuestion(delta) {
  const newNum = currentQuestionNumber + delta;
  const n = sessionLength();
  if (newNum >= 1 && newNum <= n) {
    loadQuestion(newNum);
  }
}

function updateNavButtons() {
  const prevBtn = document.getElementById('prev-btn');
  const nextBtn = document.getElementById('next-btn');
  const n = sessionLength();
  if (prevBtn) prevBtn.disabled = currentQuestionNumber <= 1;
  if (nextBtn) nextBtn.disabled = currentQuestionNumber >= n;
}

function toggleQuestionPanel() {
  const panel = document.getElementById('question-panel');
  if (!panel) return;
  const expanded = panel.classList.toggle('is-expanded');
  const toggle = document.getElementById('panel-toggle');
  if (toggle) toggle.setAttribute('aria-expanded', String(expanded));
}

const MOBILE_BREAKPOINT = 768;

function isMobileViewport() {
  return window.innerWidth < MOBILE_BREAKPOINT;
}

document.addEventListener('click', (event) => {
  if (!isMobileViewport()) return;

  const panel = document.getElementById('question-panel');
  if (!panel || !panel.classList.contains('is-expanded')) return;

  const toggle = document.getElementById('panel-toggle');
  const clickedInsidePanel = panel.contains(event.target);
  const clickedToggle = toggle && toggle.contains(event.target);

  if (!clickedInsidePanel && !clickedToggle) {
    toggleQuestionPanel();
  }
});

// --- WORKSPACE PAGE VIEW (4-Tier Stack) ---
function renderWorkspacePage() {
  const n = sessionLength();
  const folderName = currentSession.questions[0] ? currentSession.questions[0].paperFolder : '';
  currentFolderName = folderName;

  let paletteHTML = '';
  for (let i = 1; i <= n; i++) {
    paletteHTML += `
      <button type="button" id="p-btn-${i}" onclick="loadQuestion(${i})" class="palette-btn">
        ${i}
      </button>`;
  }

  appDiv.innerHTML = `
    <div class="workspace">
      <!-- Tier 1: Sticky Top Header -->
      <header class="workspace-header glass">
        <div class="workspace-header__left">
          <a href="${currentSession.backHref}" class="workspace-header__home">
            <i data-lucide="arrow-left"></i> <span class="btn-label">Home</span>
          </a>
          <span class="workspace-header__divider"></span>
          <h1 class="workspace-header__paper">${currentSession.title}</h1>
          ${currentSession.headerExtraHTML || ''}
        </div>
        <div class="workspace-header__right">
          ${themeToggleHTML()}
          ${clerkAuthControlsHTML()}
        </div>
      </header>

      <!-- Tier 2: Navigation Bar -->
      <nav class="workspace-nav glass" aria-label="Question navigation">
        <button type="button" id="prev-btn" class="btn btn-nav" onclick="navigateQuestion(-1)" disabled>
          <i data-lucide="chevron-left"></i> Previous
        </button>
        <button type="button" id="next-btn" class="btn btn-nav" onclick="navigateQuestion(1)">
          Next <i data-lucide="chevron-right"></i>
        </button>
      </nav>

      <div class="workspace-body">
        <!-- Tier 3: Collapsible Question Panel -->
        <div id="question-panel" class="question-panel">
          <button type="button" id="panel-toggle" class="panel-toggle" onclick="toggleQuestionPanel()" aria-expanded="false" aria-controls="question-grid">
            <span>Question Palette (1–${n})</span>
            <i data-lucide="chevron-down" class="panel-toggle__icon"></i>
          </button>
          <div id="question-grid">
            ${paletteHTML}
          </div>
        </div>

        <!-- Tier 4: Main Question Workspace -->
        <main class="workspace-main">
          <article class="question-card card">
            <div id="question-header">
              <h2 id="q-number">Select a Question</h2>
              <div id="q-meta"></div>
            </div>

            <div id="question-stage">
              Click any question number in the palette to load.
            </div>

            <div id="action-footer" class="hidden">
              <div class="action-footer__tracking">
                <button type="button" id="bookmark-btn" class="btn" onclick="toggleBookmark()">Bookmark</button>
                <button type="button" id="done-btn" class="btn" onclick="toggleMarkDone()">Mark as Done</button>
              </div>
              <button type="button" id="check-btn" class="btn btn-primary" onclick="checkAnswer()" disabled>
                Check Answer
              </button>
            </div>
          </article>
        </main>
      </div>
    </div>
  `;

  refreshChrome();
  loadQuestion(1);
}

// --- QUESTION FETCHER ---
async function loadQuestion(qNumber) {
  const entry = currentSession.questions[qNumber - 1];
  if (!entry) return;

  const folderName = entry.paperFolder;
  currentFolderName = folderName;
  currentQuestionNumber = qNumber;

  const stage = document.getElementById('question-stage');
  const qNumHeading = document.getElementById('q-number');
  const qMeta = document.getElementById('q-meta');
  const actionFooter = document.getElementById('action-footer');
  const checkBtn = document.getElementById('check-btn');

  updateAllPaletteButtons();
  updateNavButtons();

  qNumHeading.innerText = `Question ${qNumber}`;
  stage.innerHTML = `<span class="question-loading">Loading question content...</span>`;
  checkBtn.disabled = true;
  actionFooter.classList.add('hidden');

  try {
    const filePath = `./${entry.filePath}`;
    const response = await fetch(filePath);
    if (!response.ok) throw new Error("Question JSON file not found");

    currentQuestionData = await response.json();
    const qData = currentQuestionData;
    // Cache the exact ID generated from question metadata for palette refreshes.
    // This intentionally reuses getQuestionId rather than deriving IDs from paths.
    entry.questionId = getQuestionId(qData);
    qNumHeading.innerText = formatQuestionHeading(qData);
    refreshTrackingUI();

    const correctMarks = qData["correct marks"] || qData.marks || 1;
    const negativeMarks = qData["negative marks"] !== undefined ? qData["negative marks"] : 0;
    const topicsList = Array.isArray(qData.topics) ? qData.topics.join(', ') : 'General';

    qMeta.innerHTML = `
      <span class="badge badge-type">${qData.type}</span>
      <span class="badge badge-positive">+${correctMarks} Marks</span>
      <span class="badge badge-negative">-${negativeMarks} Marks</span>
      <span class="badge badge-topics">Topics: ${topicsList}</span>
    `;

    let assetImgHtml = '';
    if (qData.assetImage) {
      const imagePath = `./Previous Year Questions/${folderName}/assets/${qData.assetImage}`;
      assetImgHtml = `<div class="question-asset"><img src="${imagePath}" alt="Question Diagram"></div>`;
    }

    let codeHtml = qData.codeBlock
      ? `<pre class="code-block"><code>${qData.codeBlock}</code></pre>`
      : '';

    let optionsHtml = '';
    if (qData.type === 'MCQ' || qData.type === 'MSQ') {
      optionsHtml = `<div class="options-grid">`;
      qData.options.forEach((opt, index) => {
        const key = String.fromCharCode(65 + index);
        let optContent = opt;

        if (typeof opt === 'string' && opt.startsWith('[IMG:') && opt.endsWith(']')) {
          const imgFile = opt.slice(5, -1).trim();
          const imgPath = `./Previous Year Questions/${folderName}/assets/${imgFile}`;
          optContent = `<img src="${imgPath}" alt="Option ${key}" class="option-image">`;
        }

        const inputType = qData.type === 'MCQ' ? 'radio' : 'checkbox';
        optionsHtml += `
          <label id="opt-container-${key}" class="option-label">
            <input type="${inputType}" name="q_option" value="${key}" onchange="handleInputChange()">
            <div>
              <span class="option-label__key">(${key})</span>
              <span class="opt-text option-label__text">${optContent}</span>
              <div id="feedback-${key}" class="option-label__feedback hidden"></div>
            </div>
          </label>
        `;
      });
      optionsHtml += `</div>`;
    } else if (qData.type === 'NAT') {
      optionsHtml = `
        <div class="nat-field">
          <label class="nat-field__label" for="nat-input">Enter Numerical Answer:</label>
          <input type="number" step="any" id="nat-input" oninput="handleInputChange()" placeholder="e.g. 42 or 3.14">
          <div id="nat-feedback" class="hidden"></div>
        </div>
      `;
    }

    stage.innerHTML = `
      <div id="q-text"></div>
      ${assetImgHtml}
      ${codeHtml}
      ${optionsHtml}
      <div id="solution-box" class="hidden">
        <h4>Explanation</h4>
        <div id="explanation-text"></div>
        <div id="video-box"></div>
      </div>
    `;

    const textTarget = document.getElementById('q-text');
    textTarget.innerHTML = fixAssetPaths(qData.questionText);

    renderMathInElement(textTarget, {
      delimiters: [
        {left: '$$', right: '$$', display: true},
        {left: '$', right: '$', display: false}
      ],
      throwOnError: false
    });

    document.querySelectorAll('.opt-text').forEach(el => {
      renderMathInElement(el, {
        delimiters: [{left: '$', right: '$', display: false}],
        throwOnError: false
      });
    });

    actionFooter.classList.remove('hidden');

  } catch (error) {
    stage.innerHTML = `<div class="question-error">Error loading question: ${error.message}</div>`;
  }
}

function handleInputChange() {
  const checkBtn = document.getElementById('check-btn');
  const type = currentQuestionData.type;

  if (type === 'MCQ' || type === 'MSQ') {
    const checked = document.querySelectorAll('input[name="q_option"]:checked');
    checkBtn.disabled = checked.length === 0;
  } else if (type === 'NAT') {
    const natVal = document.getElementById('nat-input').value.trim();
    checkBtn.disabled = natVal === '';
  }
}

function checkAnswer() {
  const qData = currentQuestionData;
  const checkBtn = document.getElementById('check-btn');
  checkBtn.disabled = true;

  let overallStatus = 'answered';

  if (qData.type === 'MCQ' || qData.type === 'MSQ') {
    const inputs = document.querySelectorAll('input[name="q_option"]');
    const correctAnswers = qData.answer || [];

    let hasWrong = false;
    let hasMissed = false;
    let hasCorrect = false;

    inputs.forEach(input => {
      input.disabled = true;
      const key = input.value;
      const isSelected = input.checked;
      const isCorrect = correctAnswers.includes(key);

      const container = document.getElementById(`opt-container-${key}`);
      const feedback = document.getElementById(`feedback-${key}`);

      feedback.classList.remove('hidden');

      if (isSelected && isCorrect) {
        container.className = "option-label option-label--correct";
        feedback.className = "option-label__feedback";
        feedback.innerText = "✓ You selected correct option";
        hasCorrect = true;
      } else if (isSelected && !isCorrect) {
        container.className = "option-label option-label--incorrect";
        feedback.className = "option-label__feedback";
        feedback.innerText = "✕ You selected wrong option";
        hasWrong = true;
      } else if (!isSelected && isCorrect) {
        container.className = "option-label option-label--missed";
        feedback.className = "option-label__feedback";
        feedback.innerText = "⚠ You missed this answer";
        hasMissed = true;
      }
    });

    if (hasWrong) overallStatus = 'incorrect';
    else if (hasMissed) overallStatus = 'warning';
    else if (hasCorrect) overallStatus = 'correct';

  } else if (qData.type === 'NAT') {
    const natInput = document.getElementById('nat-input');
    natInput.disabled = true;
    const userVal = parseFloat(natInput.value);
    const feedback = document.getElementById('nat-feedback');
    feedback.classList.remove('hidden');

    let min, max;
    if (typeof qData.answer === 'object' && !Array.isArray(qData.answer)) {
      min = qData.answer.min;
      max = qData.answer.max;
    } else if (Array.isArray(qData.answer)) {
      min = parseFloat(qData.answer[0]);
      max = qData.answer.length > 1 ? parseFloat(qData.answer[1]) : min;
    } else {
      min = parseFloat(qData.answer);
      max = min;
    }

    const isCorrect = !isNaN(userVal) && userVal >= min && userVal <= max;
    const rangeText = min === max ? `${min}` : `${min} to ${max}`;

    if (isCorrect) {
      natInput.className = "nat--correct";
      feedback.className = "feedback--correct";
      feedback.innerText = `✓ You answered correctly! Answer Range: [${rangeText}]`;
      overallStatus = 'correct';
    } else {
      natInput.className = "nat--incorrect";
      feedback.className = "feedback--incorrect";
      feedback.innerText = `✕ You answered wrong. Correct Answer Range: [${rangeText}]`;
      overallStatus = 'incorrect';
    }
  }

  setQuestionStatus(currentQuestionNumber, overallStatus);

  if (qData.explanation || qData.videoUrl) {
    const solutionBox = document.getElementById('solution-box');
    const expText = document.getElementById('explanation-text');
    const videoBox = document.getElementById('video-box');

    solutionBox.classList.remove('hidden');

    if (qData.explanation) {
      expText.innerHTML = fixAssetPaths(qData.explanation);
      renderMathInElement(expText, {
        delimiters: [
          {left: '$$', right: '$$', display: true},
          {left: '$', right: '$', display: false}
        ],
        throwOnError: false
      });
    }

    if (qData.videoUrl) {
      videoBox.innerHTML = `
        <a href="${qData.videoUrl}" target="_blank" class="video-link">
          <i data-lucide="video"></i> Watch Video Solution
        </a>
      `;
      lucide.createIcons();
    }
  }
}
