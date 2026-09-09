(function () {
  'use strict';

  const GOOGLE_CLIENT_ID = '786421437802-f14c9nbsuhtaet16bdq9u1ldpfudjcnq.apps.googleusercontent.com';
  const TOKEN_KEY = 'auth_token';
  const USER_KEY = 'auth_user';
  const API_BASE_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:3000'
    : '';
  let isSignUpMode = false;
  let authView = 'signin';
  let pendingAuth = null;
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

  function enforcePageProtection() {
    const currentPath = window.location.pathname;
    const isProtectedPage = currentPath.endsWith('year.html') || currentPath.endsWith('subject.html') || currentPath.endsWith('bookmarks.html');
    if (isProtectedPage && !isAuthenticated()) {
      window.location.replace('index.html');
      return true;
    }
    return false;
  }

  function setError(message) {
    const node = byId('auth-error-msg');
    if (!node) return;
    node.textContent = message || '';
    node.hidden = !message;
  }

  function setVisible(node, visible, display) {
    if (!node) return;
    node.hidden = !visible;
    node.style.display = visible ? (display || '') : 'none';
  }

  function setAuthView(nextView) {
    authView = nextView;
    isSignUpMode = nextView === 'signup' || nextView === 'signupOtp';

    const title = byId('auth-modal-title');
    const subtitle = byId('auth-modal-subtitle');
    const nameGroup = byId('name-field-group');
    const emailGroup = byId('email-field-group');
    const passwordGroup = byId('password-field-group');
    const otpGroup = byId('otp-field-group');
    const resetPasswordFields = byId('reset-password-fields');
    const forgotPassword = byId('forgot-password-container');
    const passwordHint = byId('password-hint');
    const divider = document.querySelector('.auth-divider');
    const googleButton = byId('google-signin-btn');
    const toggleMode = document.querySelector('.auth-toggle-mode');
    const submitButton = byId('auth-submit-btn');
    const toggleText = byId('auth-toggle-text');
    const toggleButton = byId('auth-toggle-btn');
    const emailInput = byId('auth-email');
    const nameInput = byId('auth-name');
    const passwordInput = byId('auth-password');
    const otpInput = byId('auth-otp');
    const newPasswordInput = byId('auth-new-password');
    const confirmPasswordInput = byId('auth-confirm-password');

    const isSignIn = nextView === 'signin';
    const isSignUp = nextView === 'signup';
    const isSignUpOtp = nextView === 'signupOtp';
    const isResetEmail = nextView === 'resetEmail';
    const isResetOtp = nextView === 'resetOtp';
    const isResetPassword = nextView === 'resetPassword';
    const showsOtp = isSignUpOtp || isResetOtp;
    const showsEmail = !isResetPassword;
    const showsPassword = isSignIn || isSignUp;
    const showsSocialOptions = isSignIn || isSignUp;
    const showsModeToggle = isSignIn || isSignUp;

    setError('');
    setVisible(nameGroup, isSignUp, 'grid');
    setVisible(emailGroup, showsEmail, 'grid');
    setVisible(passwordGroup, showsPassword, 'grid');
    setVisible(otpGroup, showsOtp, 'grid');
    setVisible(resetPasswordFields, isResetPassword, 'grid');
    setVisible(forgotPassword, isSignIn, 'flex');
    setVisible(passwordHint, isSignUp);
    setVisible(divider, showsSocialOptions, 'flex');
    setVisible(googleButton, showsSocialOptions);
    setVisible(toggleMode, showsModeToggle);

    if (emailInput) {
      emailInput.required = showsEmail;
      emailInput.readOnly = isSignUpOtp || isResetOtp;
    }
    if (nameInput) nameInput.required = isSignUp;
    if (passwordInput) {
      passwordInput.required = showsPassword;
      passwordInput.autocomplete = isSignUp ? 'new-password' : 'current-password';
    }
    if (otpInput) otpInput.required = showsOtp;
    if (newPasswordInput) newPasswordInput.required = isResetPassword;
    if (confirmPasswordInput) confirmPasswordInput.required = isResetPassword;

    if (isSignIn) {
      if (title) title.textContent = 'Welcome Back!';
      if (subtitle) subtitle.textContent = 'Sign in to access Year-wise & Subject-wise PYQs, track your progress, and save bookmarks.';
      if (submitButton) submitButton.textContent = 'Sign In';
      if (toggleText) toggleText.textContent = "Don't have an account?";
      if (toggleButton) toggleButton.textContent = 'Sign Up';
    } else if (isSignUp) {
      if (title) title.textContent = 'Create Account';
      if (subtitle) subtitle.textContent = 'Sign up to track your PYQ progress and save bookmarks.';
      if (submitButton) submitButton.textContent = 'Create Account';
      if (toggleText) toggleText.textContent = 'Already have an account?';
      if (toggleButton) toggleButton.textContent = 'Sign In';
    } else if (isSignUpOtp) {
      if (title) title.textContent = 'Verify Your Email';
      if (subtitle) subtitle.textContent = 'Enter the 6-digit code we sent to your email address.';
      if (submitButton) submitButton.textContent = 'Verify & Register';
    } else if (isResetEmail) {
      if (title) title.textContent = 'Reset Password';
      if (subtitle) subtitle.textContent = 'Enter your email address to receive a verification code.';
      if (submitButton) submitButton.textContent = 'Send Verification Code';
    } else if (isResetOtp) {
      if (title) title.textContent = 'Verify Your Code';
      if (subtitle) subtitle.textContent = 'Enter the 6-digit code we sent to your email address.';
      if (submitButton) submitButton.textContent = 'Verify Code';
    } else if (isResetPassword) {
      if (title) title.textContent = 'Choose a New Password';
      if (subtitle) subtitle.textContent = 'Use at least 8 characters for your new password.';
      if (submitButton) submitButton.textContent = 'Confirm Password';
    }

    const focusTarget = isSignUpOtp || isResetOtp ? otpInput
      : isResetPassword ? newPasswordInput
        : emailInput;
    const modal = byId('auth-modal');
    if (modal && !modal.hidden && focusTarget) window.setTimeout(() => focusTarget.focus(), 0);
  }

  function setAuthMode(isSignUp) {
    setAuthView(isSignUp ? 'signup' : 'signin');
  }

  function openAuthModal() {
    const modal = byId('auth-modal');
    if (!modal) return;
    pendingAuth = null;
    byId('native-auth-form').reset();
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

  function openPasswordResetModal(email) {
    openAuthModal();
    const emailInput = byId('auth-email');
    if (emailInput && email) emailInput.value = email;
    setAuthView('resetEmail');
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

  function getInitials(user) {
    const source = (user && (user.name || user.email)) || 'GATE Aspirant';
    const parts = String(source).trim().split(/\s+/).filter(Boolean);
    return (parts.slice(0, 2).map((part) => part.charAt(0)).join('') || 'GA').toUpperCase();
  }

  function setAvatarContent(avatar, user) {
    avatar.replaceChildren();
    const initials = getInitials(user);
    avatar.setAttribute('aria-label', `Open profile for ${user.name || user.email || 'GATE Aspirant'}`);
    avatar.title = user.name || user.email || 'Profile';
    if (user.picture) {
      const image = document.createElement('img');
      image.src = user.picture;
      image.alt = '';
      image.addEventListener('error', () => avatar.replaceChildren(document.createTextNode(initials)), { once: true });
      avatar.appendChild(image);
    } else {
      avatar.textContent = initials;
    }
  }

  function updateHeaderUI(user) {
    const signedIn = isAuthenticated() && user;
    document.querySelectorAll('.sign-in-btn').forEach((node) => {
      node.hidden = signedIn;
      node.style.display = signedIn ? 'none' : '';
      node.setAttribute('aria-hidden', String(signedIn));
    });
    document.querySelectorAll('.user-avatar').forEach((avatar) => {
      avatar.hidden = !signedIn;
      avatar.style.display = signedIn ? '' : 'none';
      avatar.setAttribute('aria-hidden', String(!signedIn));
      if (signedIn) setAvatarContent(avatar, user);
    });
  }

  function renderAuthHeader() {
    updateHeaderUI(currentUser());
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
    const code = byId('auth-otp').value.trim();
    const newPassword = byId('auth-new-password').value;
    const confirmPassword = byId('auth-confirm-password').value;
    setError('');
    button.disabled = true;
    try {
      if (authView === 'signin') {
        button.textContent = 'Signing in…';
        await acceptAuthResult(await sendAuthRequest('/api/auth/login', { email, password }));
      } else if (authView === 'signup') {
        button.textContent = 'Sending code…';
        await sendAuthRequest('/api/auth/send-otp', { email, type: 'signup' });
        pendingAuth = { email, name, password, code: '' };
        setAuthView('signupOtp');
      } else if (authView === 'signupOtp') {
        if (!pendingAuth) throw new Error('Please restart sign-up and request a new verification code');
        button.textContent = 'Verifying…';
        const result = await sendAuthRequest('/api/auth/verify-signup-otp', {
          email: pendingAuth.email,
          name: pendingAuth.name,
          password: pendingAuth.password,
          code
        });
        await acceptAuthResult(result);
      } else if (authView === 'resetEmail') {
        button.textContent = 'Sending code…';
        await sendAuthRequest('/api/auth/send-otp', { email, type: 'reset' });
        pendingAuth = { email, code: '' };
        setAuthView('resetOtp');
      } else if (authView === 'resetOtp') {
        if (!pendingAuth) throw new Error('Please restart password recovery and request a new verification code');
        button.textContent = 'Verifying…';
        await sendAuthRequest('/api/auth/verify-reset-otp', { email: pendingAuth.email, code });
        pendingAuth.code = code;
        setAuthView('resetPassword');
      } else if (authView === 'resetPassword') {
        if (!pendingAuth) throw new Error('Please restart password recovery and request a new verification code');
        if (newPassword.length < 8) throw new Error('Password must be at least 8 characters');
        if (newPassword !== confirmPassword) throw new Error('Passwords do not match');
        button.textContent = 'Updating password…';
        const result = await sendAuthRequest('/api/auth/reset-password', {
          email: pendingAuth.email,
          code: pendingAuth.code,
          newPassword
        });
        await acceptAuthResult(result);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      button.disabled = false;
      if (!byId('auth-modal').hidden) setAuthView(authView);
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

  function logout() {
    if (typeof flushSyncQueue === 'function') Promise.resolve(flushSyncQueue()).catch(() => {});
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    if (typeof clearUserProgress === 'function') clearUserProgress();
    if (typeof refreshTrackingUI === 'function') refreshTrackingUI();
    renderAuthHeader();
    window.dispatchEvent(new Event('authchange'));
    const currentPath = window.location.pathname;
    if (!currentPath.endsWith('index.html') && currentPath !== '/') window.location.assign('index.html');
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
      pendingAuth = null;
      setAuthView('resetEmail');
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
      if (event.target.closest('.user-avatar')) window.location.assign('user.html');
    });
  }

  function initialise() {
    if (enforcePageProtection()) return;
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
  window.updateHeaderUI = updateHeaderUI;
  window.openPasswordResetModal = openPasswordResetModal;
  window.logout = logout;
  window.handleGoogleCredentialResponse = handleGoogleCredentialResponse;
  document.addEventListener('DOMContentLoaded', enforcePageProtection);
  window.addEventListener('load', initialise);
}());

