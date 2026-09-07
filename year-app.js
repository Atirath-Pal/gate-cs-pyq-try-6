function router() {
  const parts = parseHashParts();

  if (parts.length === 0) {
    renderYearHomePage();
    return;
  }
  if (parts[0] === 'paper' && parts.length >= 2) {
    renderYearWorkspace(parts.slice(1).join('/'));
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

function renderYearWorkspace(folderName) {
  const questions = [];
  for (let i = 1; i <= 65; i++) {
    questions.push({
      paperFolder: folderName,
      filePath: `Previous Year Questions/${folderName}/questions/question${i}.json`
    });
  }
  startSession(questions, folderName, '#/');
}

window.addEventListener('hashchange', router);
window.addEventListener('DOMContentLoaded', () => {
  initTheme();
  router();
});
