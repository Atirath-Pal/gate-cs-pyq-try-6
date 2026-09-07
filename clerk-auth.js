const CLERK_PUBLISHABLE_KEY = 'pk_test_Z2VuZXJvdXMtaGFsaWJ1dC01NDYzLmNsZXJrLmFjY291bnRzLmRldiQ';

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
    signInBtn.onclick = () => clerk.openSignIn();
  }
}

async function initClerkAuth() {
  if (typeof window.Clerk === 'function') {
    window.clerk = new window.Clerk(CLERK_PUBLISHABLE_KEY);
  } else if (window.Clerk) {
    window.clerk = window.Clerk;
  } else {
    console.error('Clerk SDK failed to load');
    return;
  }

  await window.clerk.load({
    ui: { ClerkUI: window.__internal_ClerkUICtor }
  });

  renderClerkHeader();
  if (typeof window.clerk.addListener === 'function') {
    window.clerk.addListener(() => renderClerkHeader());
  }
}

window.addEventListener('load', initClerkAuth);
