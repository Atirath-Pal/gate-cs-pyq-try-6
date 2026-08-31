let topicTreeCache = null;

async function getTopicTree() {
  if (topicTreeCache) return topicTreeCache;

  const response = await fetch('./topic_wise_manifest.json');
  if (!response.ok) throw new Error('topic_wise_manifest.json not found');
  const entries = await response.json();

  const tree = new Map();
  for (const q of entries) {
    const main = (q.topics && q.topics[0] && String(q.topics[0]).trim()) || 'Uncategorized';
    const sub = (q.topics && q.topics[1] && String(q.topics[1]).trim()) || 'General';
    if (!tree.has(main)) tree.set(main, { all: [], subs: new Map() });
    const node = tree.get(main);
    node.all.push(q);
    if (!node.subs.has(sub)) node.subs.set(sub, []);
    node.subs.get(sub).push(q);
  }

  topicTreeCache = tree;
  return tree;
}

function router() {
  const parts = parseHashParts();

  if (parts.length === 0) {
    renderSubjectHomePage();
    return;
  }
  if (parts[0] === 'topic' && parts.length >= 2) {
    const subject = parts[1];
    const subtopic = parts.length >= 3 ? parts.slice(2).join('/') : '';
    renderTopicWorkspace(subject, subtopic);
    return;
  }

  renderSubjectHomePage();
}

async function renderSubjectHomePage() {
  appDiv.innerHTML = `<div class="loading-state">Loading PYQ Hub...</div>`;

  try {
    const tree = await getTopicTree();
    const subjects = [...tree.keys()].sort((a, b) => a.localeCompare(b));

    let cardsHTML = '';
    subjects.forEach(subject => {
      const count = tree.get(subject).all.length;
      const routeUrl = `#/topic/${encodeURIComponent(subject)}`;
      cardsHTML += yearCardHTML(subject, count, routeUrl, 'Subject');
    });

    appDiv.innerHTML = `
      ${listingHeaderHTML('./index.html')}
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

function subtopicSelectHTML(subject, subs, selectedSub) {
  const options = [`<option value="">All</option>`];
  const subNames = [...subs.keys()].sort((a, b) => a.localeCompare(b));
  subNames.forEach(sub => {
    const selected = sub === selectedSub ? ' selected' : '';
    options.push(`<option value="${escapeAttr(sub)}"${selected}>${escapeHTML(sub)}</option>`);
  });

  return `
    <label class="workspace-header__filter">
      <span class="workspace-header__filter-label">Sub-topic</span>
      <select class="workspace-header__select" aria-label="Filter by sub-topic" onchange="onSubtopicChange(this.value)">
        ${options.join('')}
      </select>
    </label>
  `;
}

function escapeHTML(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(value) {
  return escapeHTML(value);
}

function onSubtopicChange(value) {
  const parts = parseHashParts();
  const subject = parts[1];
  if (!subject) return;
  const encodedSubject = encodeURIComponent(subject);
  if (!value) {
    location.hash = `#/topic/${encodedSubject}`;
  } else {
    location.hash = `#/topic/${encodedSubject}/${encodeURIComponent(value)}`;
  }
}

async function renderTopicWorkspace(subject, subtopic) {
  appDiv.innerHTML = `<div class="loading-state">Loading questions...</div>`;
  try {
    const tree = await getTopicTree();
    const node = tree.get(subject);
    if (!node || !node.all.length) {
      throw new Error(`No questions for ${subject}`);
    }

    const questions = subtopic ? node.subs.get(subtopic) : node.all;
    if (!questions || !questions.length) {
      throw new Error(`No questions for ${subject}${subtopic ? ' / ' + subtopic : ''}`);
    }

    const title = subtopic ? `${subject} — ${subtopic}` : subject;
    startSession(
      questions,
      title,
      '#/',
      subtopicSelectHTML(subject, node.subs, subtopic)
    );
  } catch (err) {
    appDiv.innerHTML = `<div class="error-state">${err.message}</div>`;
  }
}

window.addEventListener('hashchange', router);
window.addEventListener('DOMContentLoaded', () => {
  initTheme();
  router();
});
