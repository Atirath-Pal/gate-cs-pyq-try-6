const CLERK_PUBLISHABLE_KEY = 'pk_test_Z2VuZXJvdXMtaGFsaWJ1dC01NDYzLmNsZXJrLmFjY291bnRzLmRldiQ';

let pendingAuthAction = null;

function getAuthModalElements() {
  return {
    modal: document.getElementById('auth-modal'),
    container: document.getElementById('clerk-signin-container'),
    closeButton: document.getElementById('close-auth-modal')
  };
}

function getSignInAppearance() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const variables = isDark
    ? {
        colorPrimary: '#0d9488',
        colorBackground: '#18181b',
        colorForeground: '#f3f4f6',
        colorMutedForeground: '#a1a1aa',
        colorInput: '#27272a',
        colorInputForeground: '#ffffff',
        colorNeutral: '#3f3f46',
        borderRadius: '8px'
      }
    : {
        colorPrimary: '#0f766e',
        colorBackground: '#ffffff',
        colorForeground: '#09090b',
        colorMutedForeground: '#71717a',
        colorInput: '#f4f4f5',
        colorInputForeground: '#09090b',
        colorNeutral: '#d4d4d8',
        borderRadius: '8px'
      };

  return {
    variables,
    elements: {
      card: 'auth-clerk-card',
      rootBox: 'auth-clerk-root',
      headerTitle: 'hidden',
      headerSubtitle: 'hidden',
      footer: 'auth-clerk-footer',
      footerAction: 'auth-clerk-footer-action'
    }
  };
}

function mountAuthSignIn() {
  const clerk = window.clerk;
  const { container } = getAuthModalElements();
  if (!clerk || !container || typeof clerk.mountSignIn !== 'function') return;

  // Clerk removes its own tree when unmounted. Always clear a possible stale
  // instance before mounting, including when the modal is reopened.
  if (typeof clerk.unmountSignIn === 'function') {
    try {
      clerk.unmountSignIn(container);
    } catch (err) {
      // There may be no existing instance during the first open.
    }
  }
  container.replaceChildren();

  clerk.mountSignIn(container, {
    appearance: getSignInAppearance()
  });
}

function openAuthModal(redirectAction) {
  if (typeof redirectAction === 'function') pendingAuthAction = redirectAction;

  const { modal, closeButton } = getAuthModalElements();
  if (!modal) {
    if (window.clerk && typeof window.clerk.openSignIn === 'function') window.clerk.openSignIn();
    return;
  }

  modal.hidden = false;
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('auth-modal-open');
  document.body.style.overflow = 'hidden';
  mountAuthSignIn();
  if (closeButton) closeButton.focus();
}

function closeAuthModal() {
  const clerk = window.clerk;
  const { modal, container } = getAuthModalElements();

  if (clerk && container && typeof clerk.unmountSignIn === 'function') {
    try {
      clerk.unmountSignIn(container);
    } catch (err) {
      // The container can already be empty after a cancelled Clerk flow.
    }
  }
  if (container) container.replaceChildren();

  if (modal) {
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
  }
  document.body.classList.remove('auth-modal-open');
  document.body.style.overflow = '';
  pendingAuthAction = null;
}

function completePendingAuthAction() {
  if (!pendingAuthAction || !(window.clerk && window.clerk.user)) return;
  const action = pendingAuthAction;
  pendingAuthAction = null;
  closeAuthModal();
  action();
}

function checkAuthAndProceed(actionCallback) {
  if (window.clerk && window.clerk.user && window.clerk.session) {
    actionCallback();
    return;
  }
  openAuthModal(actionCallback);
}

function renderClerkHeader() {
  const clerk = window.clerk;
  const userButton = document.getElementById('user-button');
  const signInBtn = document.getElementById('sign-in-btn');
  if (!clerk || !userButton || !signInBtn) return;

  if (clerk.user) {
    signInBtn.hidden = true;
    userButton.hidden = false;
    clerk.mountUserButton(userButton);
  } else {
    userButton.hidden = true;
    signInBtn.hidden = false;
    signInBtn.onclick = () => openAuthModal();
  }
}

function setupAuthModal() {
  const { modal, closeButton } = getAuthModalElements();
  if (!modal || modal.dataset.bound === 'true') return;

  modal.dataset.bound = 'true';
  if (closeButton) closeButton.addEventListener('click', closeAuthModal);
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeAuthModal();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modal.hidden) closeAuthModal();
  });
}

// Delegation keeps guards attached as the single-page views rerender their cards.
document.addEventListener('click', (event) => {
  const link = event.target.closest('a[data-auth-required]');
  if (!link || event.defaultPrevented || event.button !== 0
    || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

  event.preventDefault();
  const destination = link.getAttribute('href');
  checkAuthAndProceed(() => window.location.assign(destination));
});

async function initClerkAuth() {
  if (typeof window.Clerk === 'function') {
    window.clerk = new window.Clerk(CLERK_PUBLISHABLE_KEY);
  } else if (window.Clerk) {
    window.clerk = window.Clerk;
  } else {
    console.error('Clerk SDK failed to load');
    return;
  }

  await window.clerk.load({ ui: { ClerkUI: window.__internal_ClerkUICtor } });

  renderClerkHeader();
  const { modal } = getAuthModalElements();
  if (modal && !modal.hidden) mountAuthSignIn();

  let lastUserId = window.clerk.user ? window.clerk.user.id : null;
  if (typeof loadUserData === 'function') await loadUserData();
  completePendingAuthAction();

  if (typeof window.clerk.addListener === 'function') {
    window.clerk.addListener(() => {
      renderClerkHeader();
      const userId = window.clerk.user ? window.clerk.user.id : null;
      if (userId !== lastUserId) {
        lastUserId = userId;
        if (typeof loadUserData === 'function') loadUserData();
      } else if (typeof refreshTrackingUI === 'function') {
        refreshTrackingUI();
      }
      completePendingAuthAction();
    });
  }
}

window.addEventListener('DOMContentLoaded', setupAuthModal);
window.addEventListener('load', initClerkAuth);
window.addEventListener('themechange', () => {
  const { modal } = getAuthModalElements();
  if (modal && !modal.hidden) mountAuthSignIn();
});
