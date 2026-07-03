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
    const stored = localStorage.getItem(THEME_KEY);
    if (stored) return stored;
    
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    return systemDark ? 'dark' : 'light';
  }
  
  function setTheme(theme) {
    html.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_KEY, theme);
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
  
  // Listen for system theme changes (only if user hasn't set a preference)
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (!localStorage.getItem(THEME_KEY)) {
      setTheme(e.matches ? 'dark' : 'light');
    }
  });
  
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
