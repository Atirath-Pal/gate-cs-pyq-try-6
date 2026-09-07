function router() {
  const parts = parseHashParts();

  if (parts.length === 0) {
    renderYearHomePage();
    return;
  }
  if (parts[0] === 'paper' && parts.length >= 2) {
    const renderPaper = () => renderYearWorkspace(parts.slice(1).join('/'));
    if (typeof checkAuthAndProceed === 'function') checkAuthAndProceed(renderPaper);
    else renderPaper();
    return;
  }

  renderYearHomePage();
}

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
      ${listingHeaderHTML('./index.html')}
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

    refreshChrome();
  } catch (err) {
    appDiv.innerHTML = `<div class="error-state">Error loading manifest: ${err.message}</div>`;
  }
}

let questionCatalogPromise = null;

function getQuestionCatalog() {
  if (!questionCatalogPromise) {
    questionCatalogPromise = fetch('./topic_wise_manifest.json')
      .then((response) => {
        if (!response.ok) throw new Error('Question catalog not found');
        return response.json();
      });
  }
  return questionCatalogPromise;
}

async function renderYearWorkspace(folderName) {
  appDiv.innerHTML = `<div class="loading-state">Loading questions...</div>`;

  try {
    // The catalog carries year, set, and number for every question. Using it
    // here lets startSession eagerly create the same canonical IDs used by the
    // Subject and Topic views before rendering any palette button.
    const catalog = await getQuestionCatalog();
    const questions = catalog
      .filter((question) => question.paperFolder === folderName)
      .sort((a, b) => Number(a.id) - Number(b.id));

    if (!questions.length) throw new Error(`No questions found for ${folderName}`);
    startSession(questions, folderName, '#/');
  } catch (err) {
    appDiv.innerHTML = `<div class="error-state">Error loading paper: ${err.message}</div>`;
  }
}

window.addEventListener('hashchange', router);
window.addEventListener('DOMContentLoaded', () => {
  initTheme();
  router();
});
