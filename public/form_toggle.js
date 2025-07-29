document.addEventListener('DOMContentLoaded', () => {
  const loginForm = document.getElementById('login-form');
  const signupForm = document.getElementById('signup-form');
  const resetPasswordForm = document.getElementById('reset-password-form');
  const showLoginBtn = document.getElementById('show-login');
  const showSignupBtn = document.getElementById('show-signup');
  const resetLink = document.querySelector('.reset-link');
  const backToLoginLink = document.getElementById('back-to-login');
  const showResetLink = document.getElementById('show-reset');

  function setActiveButton(activeBtn) {
    showLoginBtn.classList.remove('active');
    showSignupBtn.classList.remove('active');
    activeBtn.classList.add('active');
  }

  // Show login form & reset link, hide signup form & reset form
  showLoginBtn.addEventListener('click', () => {
    loginForm.classList.remove('hidden');
    signupForm.classList.add('hidden');
    resetPasswordForm.classList.add('hidden');
    resetLink.classList.remove('hidden');
    backToLoginLink.classList.add('hidden');
    setActiveButton(showLoginBtn);
  });

  // Show signup form & hide reset link and other forms
  showSignupBtn.addEventListener('click', () => {
    signupForm.classList.remove('hidden');
    loginForm.classList.add('hidden');
    resetPasswordForm.classList.add('hidden');
    resetLink.classList.add('hidden');  // Hide forgot password here
    backToLoginLink.classList.add('hidden');
    setActiveButton(showSignupBtn);
  });

  // Show reset password form, hide login & signup forms, hide reset link, show back to login
  showResetLink.addEventListener('click', (e) => {
    e.preventDefault();
    resetPasswordForm.classList.remove('hidden');
    loginForm.classList.add('hidden');
    signupForm.classList.add('hidden');
    resetLink.classList.add('hidden');
    backToLoginLink.classList.remove('hidden');
    // Optionally, remove active from both buttons during reset form
    showLoginBtn.classList.remove('active');
    showSignupBtn.classList.remove('active');
  });

  // Back to login from reset password form
  backToLoginLink.addEventListener('click', (e) => {
    e.preventDefault();
    resetPasswordForm.classList.add('hidden');
    loginForm.classList.remove('hidden');
    signupForm.classList.add('hidden');
    resetLink.classList.remove('hidden');
    backToLoginLink.classList.add('hidden');
    setActiveButton(showLoginBtn);
  });

  // Initialize with login active by default
  setActiveButton(showLoginBtn);
});
