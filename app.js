// --- STATE & ROUTER ---
const appDiv = document.getElementById('app');
let currentQuestionData = null;
let currentFolderName = '';
let currentQuestionNumber = 1;
const questionStatuses = {};
let topicTreeCache = null;
let currentSession = {
  questions: [],
  title: '',
  backHash: '#/'
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

function themeToggleHTML() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const label = isDark ? 'Light' : 'Dark';
  const icon = isDark ? 'sun' : 'moon';
  return `<button type="button" class="btn btn-theme" data-theme-toggle onclick="toggleTheme()"><i data-lucide="${icon}"></i> <span class="btn-label">${label}</span></button>`;
}

// --- BASE PATH FIX ---
// Some question/explanation HTML has hardcoded absolute image paths
// (e.g. src="/Previous Year Questions/.../img.png"). These work locally
// (served from root) but break on GitHub Pages project sites, which are
// served from a subpath like /repo-name/. This rewrites them at render time.
const BASE_URL = (() => {
  if (location.hostname.endsWith('github.io')) {
    const firstSegment = location.pathname.split('/').filter(Boolean)[0];
    return firstSegment ? `/${firstSegment}` : '';
  }
  return ''; // local dev — unchanged behavior
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

function router() {
  const parts = parseHashParts();

  if (parts.length === 0) {
    renderIndexPage();
    return;
  }
  if (parts[0] === 'year' && parts.length === 1) {
    renderYearHomePage();
    return;
  }
  if (parts[0] === 'subject' && parts.length === 1) {
    renderSubjectHomePage();
    return;
  }
  if (parts[0] === 'subject' && parts.length === 2) {
    renderSubtopicHomePage(parts[1]);
    return;
  }
  if (parts[0] === 'paper' && parts.length >= 2) {
    renderYearWorkspace(parts.slice(1).join('/'));
    return;
  }
  if (parts[0] === 'topic' && parts.length >= 3) {
    renderTopicWorkspace(parts[1], parts.slice(2).join('/'));
    return;
  }

  renderIndexPage();
}

function listingHeaderHTML(showHome) {
  const homeLink = showHome
    ? `<a href="#/" class="workspace-header__home">
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
      </div>
    </header>
  `;
}

async function getTopicTree() {
  if (topicTreeCache) return topicTreeCache;

  const response = await fetch('./topic_wise_manifest.json');
  if (!response.ok) throw new Error('topic_wise_manifest.json not found');
  const entries = await response.json();

  const tree = new Map();
  for (const q of entries) {
    const main = (q.topics && q.topics[0] && String(q.topics[0]).trim()) || 'Uncategorized';
    const sub = (q.topics && q.topics[1] && String(q.topics[1]).trim()) || 'General';
    if (!tree.has(main)) tree.set(main, new Map());
    const subs = tree.get(main);
    if (!subs.has(sub)) subs.set(sub, []);
    subs.get(sub).push(q);
  }

  topicTreeCache = tree;
  return tree;
}

function countQuestions(subMap) {
  let total = 0;
  subMap.forEach(list => { total += list.length; });
  return total;
}

window.addEventListener('hashchange', router);
window.addEventListener('DOMContentLoaded', () => {
  initTheme();
  router();
});

// --- PALETTE STATUS ---
function updatePaletteButton(qNumber) {
  const btn = document.getElementById(`p-btn-${qNumber}`);
  if (!btn) return;

  btn.classList.remove(
    'palette-btn--active',
    'palette-btn--answered',
    'palette-btn--correct',
    'palette-btn--incorrect',
    'palette-btn--warning'
  );

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

// --- MOBILE: CLICK-OUTSIDE TO DISMISS PALETTE ---
// Matches the `@media (min-width: 768px)` breakpoint used in styles.css —
// below that width, the palette behaves as a mobile overlay/drawer that
// should auto-collapse when the user taps outside it.
const MOBILE_BREAKPOINT = 768;

function isMobileViewport() {
  return window.innerWidth < MOBILE_BREAKPOINT;
}

document.addEventListener('click', (event) => {
  if (!isMobileViewport()) return; // desktop: never auto-collapse

  const panel = document.getElementById('question-panel');
  if (!panel || !panel.classList.contains('is-expanded')) return;

  const toggle = document.getElementById('panel-toggle');
  const clickedInsidePanel = panel.contains(event.target);
  const clickedToggle = toggle && toggle.contains(event.target);

  if (!clickedInsidePanel && !clickedToggle) {
    toggleQuestionPanel();
  }
});

// --- INDEX PAGE ---
function renderIndexPage() {
  appDiv.innerHTML = `
    ${listingHeaderHTML(false)}
    <main class="home-main">
      <section class="home-hero">
        <h2 class="home-hero__title">Crack the GATE CS Gateway</h2>
        <p class="home-hero__subtitle">Interactive testing environment with real-time answer verification and step-by-step logic sheets.</p>
      </section>
      <div class="choice-grid">
        <a href="#/year" class="choice-card">
          <span class="year-card__tag">Practice</span>
          <h3 class="choice-card__title">Year wise PYQ</h3>
          <p class="choice-card__text">Full GATE papers organised by year and set.</p>
          <span class="year-card__link">Open <i data-lucide="arrow-right"></i></span>
        </a>
        <a href="#/subject" class="choice-card">
          <span class="year-card__tag">Practice</span>
          <h3 class="choice-card__title">Subject wise PYQ</h3>
          <p class="choice-card__text">Questions grouped by subject and sub-topic.</p>
          <span class="year-card__link">Open <i data-lucide="arrow-right"></i></span>
        </a>
      </div>
    </main>
  `;
  lucide.createIcons();
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

// --- YEAR WISE HOME ---
async function renderYearHomePage() {
  appDiv.innerHTML = `<div class="loading-state">Loading PYQ Hub...</div>`;

  try {
    const response = await fetch('./Previous Year Questions/manifest.json');
    const papers = await response.json();

    let cardsHTML = '';
    papers.forEach(paper => {
      const routeUrl = `#/paper/${encodeURIComponent(paper.folderName)}`;
      cardsHTML += yearCardHTML(paper.title, paper.questionCount || 65, routeUrl, 'Simulator');
    });

    appDiv.innerHTML = `
      ${listingHeaderHTML(true)}
      <main class="home-main">
        <section class="home-hero">
          <h2 class="home-hero__title">Year wise PYQ Practice</h2>
          <p class="home-hero__subtitle">Interactive testing environment with real-time answer verification and step-by-step logic sheets.</p>
        </section>
        <div class="year-grid">
          ${cardsHTML}
        </div>
      </main>
    `;

    lucide.createIcons();
  } catch (err) {
    appDiv.innerHTML = `<div class="error-state">Error loading manifest: ${err.message}</div>`;
  }
}

// --- SUBJECT WISE HOME ---
async function renderSubjectHomePage() {
  appDiv.innerHTML = `<div class="loading-state">Loading PYQ Hub...</div>`;

  try {
    const tree = await getTopicTree();
    const subjects = [...tree.keys()].sort((a, b) => a.localeCompare(b));

    let cardsHTML = '';
    subjects.forEach(subject => {
      const count = countQuestions(tree.get(subject));
      const routeUrl = `#/subject/${encodeURIComponent(subject)}`;
      cardsHTML += yearCardHTML(subject, count, routeUrl, 'Subject');
    });

    appDiv.innerHTML = `
      ${listingHeaderHTML(true)}
      <main class="home-main">
        <section class="home-hero">
          <h2 class="home-hero__title">Subject wise PYQ Practice</h2>
          <p class="home-hero__subtitle">Interactive testing environment with real-time answer verification and step-by-step logic sheets.</p>
        </section>
        <div class="year-grid">
          ${cardsHTML}
        </div>
      </main>
    `;

    lucide.createIcons();
  } catch (err) {
    appDiv.innerHTML = `<div class="error-state">Error loading topic manifest: ${err.message}</div>`;
  }
}

async function renderSubtopicHomePage(subject) {
  appDiv.innerHTML = `<div class="loading-state">Loading PYQ Hub...</div>`;

  try {
    const tree = await getTopicTree();
    const subs = tree.get(subject);
    if (!subs) throw new Error(`No topics found for "${subject}"`);

    const subNames = [...subs.keys()].sort((a, b) => a.localeCompare(b));
    let cardsHTML = '';
    subNames.forEach(sub => {
      const count = subs.get(sub).length;
      const routeUrl = `#/topic/${encodeURIComponent(subject)}/${encodeURIComponent(sub)}`;
      cardsHTML += yearCardHTML(sub, count, routeUrl, 'Topic');
    });

    appDiv.innerHTML = `
      ${listingHeaderHTML(true)}
      <main class="home-main">
        <section class="home-hero">
          <h2 class="home-hero__title">${subject}</h2>
          <p class="home-hero__subtitle">Interactive testing environment with real-time answer verification and step-by-step logic sheets.</p>
        </section>
        <div class="year-grid">
          ${cardsHTML}
        </div>
      </main>
    `;

    lucide.createIcons();
  } catch (err) {
    appDiv.innerHTML = `<div class="error-state">Error loading topics: ${err.message}</div>`;
  }
}

function startSession(questions, title, backHash) {
  currentSession = { questions, title, backHash };
  currentQuestionNumber = 1;
  Object.keys(questionStatuses).forEach(k => delete questionStatuses[k]);
  renderWorkspacePage();
}

function renderYearWorkspace(folderName) {
  const questions = [];
  for (let i = 1; i <= 65; i++) {
    questions.push({
      paperFolder: folderName,
      filePath: `Previous Year Questions/${folderName}/questions/question${i}.json`
    });
  }
  startSession(questions, folderName, '#/year');
}

async function renderTopicWorkspace(subject, subtopic) {
  appDiv.innerHTML = `<div class="loading-state">Loading questions...</div>`;
  try {
    const tree = await getTopicTree();
    const questions = tree.get(subject) && tree.get(subject).get(subtopic);
    if (!questions || !questions.length) {
      throw new Error(`No questions for ${subject} / ${subtopic}`);
    }
    startSession(
      questions,
      `${subject} — ${subtopic}`,
      `#/subject/${encodeURIComponent(subject)}`
    );
  } catch (err) {
    appDiv.innerHTML = `<div class="error-state">${err.message}</div>`;
  }
}

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
          <a href="${currentSession.backHash}" class="workspace-header__home">
            <i data-lucide="arrow-left"></i> <span class="btn-label">Home</span>
          </a>
          <span class="workspace-header__divider"></span>
          <h1 class="workspace-header__paper">${currentSession.title}</h1>
        </div>
        <div class="workspace-header__right">
          ${themeToggleHTML()}
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
              <button type="button" id="check-btn" class="btn btn-primary" onclick="checkAnswer()" disabled>
                Check Answer
              </button>
            </div>
          </article>
        </main>
      </div>
    </div>
  `;

  lucide.createIcons();
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

    // 1. Render Meta Badges (Type, Marks, Negative Marks, Topics)
    const correctMarks = qData["correct marks"] || qData.marks || 1;
    const negativeMarks = qData["negative marks"] !== undefined ? qData["negative marks"] : 0;
    const topicsList = Array.isArray(qData.topics) ? qData.topics.join(', ') : 'General';

    qMeta.innerHTML = `
      <span class="badge badge-type">${qData.type}</span>
      <span class="badge badge-positive">+${correctMarks} Marks</span>
      <span class="badge badge-negative">-${negativeMarks} Marks</span>
      <span class="badge badge-topics">Topics: ${topicsList}</span>
    `;

    // 2. Asset Image
    let assetImgHtml = '';
    if (qData.assetImage) {
      const imagePath = `./Previous Year Questions/${folderName}/assets/${qData.assetImage}`;
      assetImgHtml = `<div class="question-asset"><img src="${imagePath}" alt="Question Diagram"></div>`;
    }

    // 3. Code Block
    let codeHtml = qData.codeBlock
      ? `<pre class="code-block"><code>${qData.codeBlock}</code></pre>`
      : '';

    // 4. Options Input Setup
    let optionsHtml = '';
    if (qData.type === 'MCQ' || qData.type === 'MSQ') {
      optionsHtml = `<div class="options-grid">`;
      qData.options.forEach((opt, index) => {
        const key = String.fromCharCode(65 + index);
        let optContent = opt;

        // Custom Image Syntax parsing
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

    // Inject Main Question HTML
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

    // Render Math text
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

// --- INPUT EVENT HANDLER ---
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

// --- CHECK ANSWER & GRADING ENGINE ---
function checkAnswer() {
  const qData = currentQuestionData;
  const checkBtn = document.getElementById('check-btn');
  checkBtn.disabled = true; // Freeze button

  let overallStatus = 'answered';

  if (qData.type === 'MCQ' || qData.type === 'MSQ') {
    const inputs = document.querySelectorAll('input[name="q_option"]');
    const correctAnswers = qData.answer || [];

    let hasWrong = false;
    let hasMissed = false;
    let hasCorrect = false;

    inputs.forEach(input => {
      input.disabled = true; // Freeze input controls
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

    // Parse target range
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

  // Render Explanation Box
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