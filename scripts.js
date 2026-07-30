(function () {
  // ===== Dark Mode Toggle =====
  const THEME_KEY = 'theme-preference';
  const html = document.documentElement;
  
  function updateThemeUI(theme) {
    const icon = document.getElementById('theme-icon');
    const label = document.getElementById('theme-label');
    if (icon) icon.textContent = theme === 'dark' ? '🌙' : '☀️';
    if (label) label.textContent = theme === 'dark' ? 'Dark' : 'Light';
  }
  
  function getThemePreference() {
    let stored = null;
    try { stored = localStorage.getItem(THEME_KEY); } catch (err) { /* storage blocked (private mode, disabled) */ }
    if (stored) return stored;

    // Dark is the default for visitors who haven't chosen a theme.
    return 'dark';
  }

  function setTheme(theme) {
    html.setAttribute('data-theme', theme);
    try { localStorage.setItem(THEME_KEY, theme); } catch (err) { /* storage blocked (private mode, disabled) */ }
    updateThemeUI(theme);
  }
  
  function toggleTheme() {
    const current = html.getAttribute('data-theme') || getThemePreference();
    const next = current === 'dark' ? 'light' : 'dark';
    setTheme(next);
  }
  
  // Initialize theme on page load
  const initialTheme = getThemePreference();
  setTheme(initialTheme);

  // This script runs in <head> before <body> exists, so the icon/label
  // elements aren't in the DOM yet when setTheme() first runs above.
  // Sync them once the DOM is ready.
  document.addEventListener('DOMContentLoaded', () => updateThemeUI(html.getAttribute('data-theme')));

  // Expose toggle function globally
  window.toggleTheme = toggleTheme;
  
  // ===== Google Analytics =====
  const gaScript = document.createElement('script');
  gaScript.async = true;
  gaScript.src = 'https://www.googletagmanager.com/gtag/js?id=G-YRZ8FJJ8YZ';
  document.head.appendChild(gaScript);

  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };
  gtag('js', new Date());
  gtag('config', 'G-YRZ8FJJ8YZ');
})();
