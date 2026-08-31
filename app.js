function renderIndexPage() {
  appDiv.innerHTML = `
    ${listingHeaderHTML(null)}
    <main class="home-main">
      <section class="home-hero">
        <h2 class="home-hero__title">Crack the GATE CS Gateway</h2>
        <p class="home-hero__subtitle">Interactive testing environment with real-time answer verification and step-by-step logic sheets.</p>
      </section>
      <div class="choice-grid">
        <a href="./year.html" class="choice-card">
          <span class="year-card__tag">Practice</span>
          <h3 class="choice-card__title">Year wise PYQ</h3>
          <p class="choice-card__text">Full GATE papers organised by year and set.</p>
          <span class="year-card__link">Open <i data-lucide="arrow-right"></i></span>
        </a>
        <a href="./subject.html" class="choice-card">
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

function redirectLegacyHash() {
  const parts = parseHashParts();
  if (parts.length === 0) return false;

  if (parts[0] === 'year') {
    location.replace('./year.html');
    return true;
  }
  if (parts[0] === 'paper') {
    location.replace('./year.html' + (window.location.hash || ''));
    return true;
  }
  if (parts[0] === 'subject' && parts.length === 1) {
    location.replace('./subject.html');
    return true;
  }
  if (parts[0] === 'subject' && parts.length >= 2) {
    location.replace(`./subject.html#/topic/${encodeURIComponent(parts[1])}`);
    return true;
  }
  if (parts[0] === 'topic') {
    location.replace('./subject.html' + (window.location.hash || ''));
    return true;
  }
  return false;
}

window.addEventListener('DOMContentLoaded', () => {
  initTheme();
  if (redirectLegacyHash()) return;
  renderIndexPage();
});
