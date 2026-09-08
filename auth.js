(function () {
  'use strict';

  const GOOGLE_CLIENT_ID = '786421437802-f14c9nbsuhtaet16bdq9u1ldpfudjcnq.apps.googleusercontent.com';
  const TOKEN_KEY = 'auth_token';
  const USER_KEY = 'auth_user';
  const API_BASE_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:3000'
    : '';
  let isSignUpMode = false;
  let pendingAuthAction = null;
  let googleInitialised = false;

  function byId(id) {
    return document.getElementById(id);
  }

  function currentUser() {
    try {
      return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
    } catch (_) {
      return null;
    }
  }

  function isAuthenticated() {
    return Boolean(localStorage.getItem(TOKEN_KEY));
  }

  function setError(message) {
    const node = byId('auth-error-msg');
    if (!node) return;
    node.textContent = message || '';
    node.hidden = !message;
  }

  function setAuthMode(isSignUp) {
    isSignUpMode = isSignUp;

    const title = byId('auth-modal-title');
    const subtitle = byId('auth-modal-subtitle');
    const nameGroup = byId('name-field-group');
    const nameInput = byId('auth-name');
    const passwordInput = byId('auth-password');
    const forgotPassword = byId('forgot-password-container');
    const submitButton = byId('auth-submit-btn');
    const toggleText = byId('auth-toggle-text');
    const toggleButton = byId('auth-toggle-btn');

    setError('');

    if (isSignUpMode) {
      if (title) title.textContent = 'Create Account';
      if (subtitle) subtitle.textContent = 'Sign up to track your PYQ progress and save bookmarks.';
      if (nameGroup) nameGroup.hidden = false;
      if (nameInput) nameInput.required = true;
      if (passwordInput) passwordInput.autocomplete = 'new-password';
      if (forgotPassword) forgotPassword.hidden = true;
      if (submitButton) submitButton.textContent = 'Create Account';
      if (toggleText) toggleText.textContent = 'Already have an account?';
      if (toggleButton) toggleButton.textContent = 'Sign In';
      return;
    }

    if (title) title.textContent = 'Welcome Back!';
    if (subtitle) subtitle.textContent = 'Sign in to access Year-wise & Subject-wise PYQs, track your progress, and save bookmarks.';
    if (nameGroup) nameGroup.hidden = true;
    if (nameInput) {
      nameInput.required = false;
      nameInput.value = '';
    }
    if (passwordInput) passwordInput.autocomplete = 'current-password';
    if (forgotPassword) forgotPassword.hidden = false;
    if (submitButton) submitButton.textContent = 'Sign In';
    if (toggleText) toggleText.textContent = "Don't have an account?";
    if (toggleButton) toggleButton.textContent = 'Sign Up';
  }

  function openAuthModal() {
    const modal = byId('auth-modal');
    if (!modal) return;
    setAuthMode(false);
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('auth-modal-open');
    window.setTimeout(() => byId('auth-email').focus(), 0);
  }

  function closeAuthModal() {
    const modal = byId('auth-modal');
    if (!modal) return;
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('auth-modal-open');
    setError('');
  }

  function checkAuthAndProceed(actionCallback) {
    if (isAuthenticated()) {
      if (typeof actionCallback === 'function') actionCallback();
      return true;
    }
    pendingAuthAction = typeof actionCallback === 'function' ? actionCallback : null;
    openAuthModal();
    return false;
  }

  function renderAuthHeader() {
    const user = currentUser();
    const signedIn = isAuthenticated() && user;
    document.querySelectorAll('.auth-user-email').forEach((node) => {
      node.textContent = signedIn ? user.email : '';
      node.hidden = !signedIn;
    });
    document.querySelectorAll('.sign-in-btn').forEach((node) => { node.hidden = signedIn; });
    document.querySelectorAll('.logout-btn').forEach((node) => { node.hidden = !signedIn; });
  }

  async function acceptAuthResult(result) {
    localStorage.setItem(TOKEN_KEY, result.token);
    localStorage.setItem(USER_KEY, JSON.stringify(result.user));
    renderAuthHeader();
    closeAuthModal();
    if (typeof loadUserData === 'function') await loadUserData();
    const action = pendingAuthAction;
    pendingAuthAction = null;
    if (action) action();
    window.dispatchEvent(new Event('authchange'));
  }

  async function sendAuthRequest(path, payload) {
    const response = await fetch(API_BASE_URL + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Authentication failed');
    return data;
  }

  async function handleFormSubmit(event) {
    event.preventDefault();
    const button = byId('auth-submit-btn');
    const email = byId('auth-email').value.trim();
    const password = byId('auth-password').value;
    const name = byId('auth-name').value.trim();
    setError('');
    button.disabled = true;
    button.textContent = isSignUpMode ? 'Creating account…' : 'Signing in…';
    try {
      const payload = { email, password };
      if (isSignUpMode) payload.name = name;
      const result = await sendAuthRequest('/api/auth/' + (isSignUpMode ? 'signup' : 'login'), payload);
      await acceptAuthResult(result);
    } catch (err) {
      setError(err.message);
    } finally {
      button.disabled = false;
      button.textContent = isSignUpMode ? 'Create Account' : 'Sign In';
    }
  }

  async function handleGoogleCredentialResponse(response) {
    try {
      setError('');
      const result = await sendAuthRequest('/api/auth/google', { credential: response.credential });
      await acceptAuthResult(result);
    } catch (err) {
      setError(err.message);
    }
  }

  function initialiseGoogle() {
    const target = byId('google-signin-btn');
    if (!target || !window.google || !window.google.accounts || googleInitialised) return;
    googleInitialised = true;
    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: handleGoogleCredentialResponse
    });
    window.google.accounts.id.renderButton(target, { theme: 'outline', size: 'large', width: '100%' });
  }

  function loadGoogleIdentity() {
    if (window.google && window.google.accounts) return initialiseGoogle();
    const existing = document.querySelector('script[data-google-identity]');
    if (existing) {
      existing.addEventListener('load', initialiseGoogle, { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.dataset.googleIdentity = 'true';
    script.onload = initialiseGoogle;
    document.head.appendChild(script);
  }

  async function logout() {
    if (typeof flushSyncQueue === 'function') await flushSyncQueue();
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    if (typeof clearUserProgress === 'function') clearUserProgress();
    if (typeof refreshTrackingUI === 'function') refreshTrackingUI();
    renderAuthHeader();
    window.dispatchEvent(new Event('authchange'));
  }

  function bindEvents() {
    byId('native-auth-form').addEventListener('submit', handleFormSubmit);
    byId('close-auth-modal').addEventListener('click', closeAuthModal);
    byId('auth-toggle-btn').addEventListener('click', () => setAuthMode(!isSignUpMode));
    byId('toggle-password-btn').addEventListener('click', () => {
      const input = byId('auth-password');
      input.type = input.type === 'password' ? 'text' : 'password';
    });
    byId('forgot-password-link').addEventListener('click', (event) => {
      event.preventDefault();
      setError('Password recovery is not available yet. Please sign in with Google or create a new account.');
    });
    byId('auth-modal').addEventListener('click', (event) => {
      if (event.target === byId('auth-modal')) closeAuthModal();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !byId('auth-modal').hidden) closeAuthModal();
    });
    document.addEventListener('click', (event) => {
      const protectedLink = event.target.closest('a[data-auth-required]');
      if (protectedLink && !event.defaultPrevented && event.button === 0
        && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        checkAuthAndProceed(() => window.location.assign(protectedLink.getAttribute('href')));
        return;
      }
      if (event.target.closest('.sign-in-btn')) openAuthModal();
      if (event.target.closest('.logout-btn')) logout();
    });
  }

  function initialise() {
    bindEvents();
    setAuthMode(false);
    renderAuthHeader();
    loadGoogleIdentity();
    if (isAuthenticated() && typeof loadUserData === 'function') loadUserData();
  }

  window.openAuthModal = openAuthModal;
  window.closeAuthModal = closeAuthModal;
  window.checkAuthAndProceed = checkAuthAndProceed;
  window.renderAuthHeader = renderAuthHeader;
  window.handleGoogleCredentialResponse = handleGoogleCredentialResponse;
  window.addEventListener('load', initialise);
}());
