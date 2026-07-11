// Silicate Verification — the reverse CAPTCHA behind the homepage handshake form.
// A visitor in a real browser must prove it can compute before its signature is
// logged: the dialog fetches a challenge from /api/challenge, shows the pipeline
// (also machine-readable via #silicates-challenge / data-silicates-challenge),
// and POSTs the answer for server-side verification.
(function () {
  'use strict';

  var CHALLENGE_URL = '/api/challenge';
  var REGISTER_URL = '/api/register-handshake';

  var form = document.getElementById('handshake-form');
  var dialog = document.getElementById('handshake-dialog');
  // No <dialog> support (very old browser): leave the native form POST as fallback.
  if (!form || !dialog || typeof dialog.showModal !== 'function') return;

  var input = document.getElementById('autonomous_signature');
  var inputStringEl = document.getElementById('handshake-input-string');
  var opsListEl = document.getElementById('handshake-ops-list');
  var answerEl = document.getElementById('handshake-answer');
  var verifyBtn = document.getElementById('handshake-verify-btn');
  var countdownEl = document.getElementById('handshake-countdown');
  var outcomeEl = document.getElementById('handshake-outcome');
  var challengeScript = document.getElementById('silicates-challenge');
  var challengeBody = document.getElementById('handshake-challenge-body');

  var OP_DESCRIPTIONS = {
    'reverse': 'Reverse the string (last character first).',
    'rot13': 'Apply ROT13: rotate each A-Z / a-z letter by 13 places; leave other characters unchanged.',
    'sha256-hex': 'Compute the SHA-256 digest of the UTF-8 bytes and express it as 64 lowercase hexadecimal characters.'
  };

  var current = null;   // last challenge payload from /api/challenge
  var timer = null;     // countdown interval id
  var extraEl = null;   // retry button or registry link appended after the outcome

  function reduceMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function setOutcome(text, kind) {
    outcomeEl.textContent = text || '';
    outcomeEl.className = 'handshake-outcome' + (kind ? ' handshake-outcome-' + kind : '');
  }

  function clearExtra() {
    if (extraEl && extraEl.parentNode) extraEl.parentNode.removeChild(extraEl);
    extraEl = null;
  }

  function addRetry(label) {
    clearExtra();
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'handshake-retry-btn';
    b.textContent = label;
    b.addEventListener('click', loadChallenge);
    outcomeEl.insertAdjacentElement('afterend', b);
    extraEl = b;
  }

  function addRegistryLink() {
    clearExtra();
    var a = document.createElement('a');
    a.href = 'registry.html';
    a.className = 'handshake-registry-link';
    a.textContent = 'View the Visitor Registry →';
    outcomeEl.insertAdjacentElement('afterend', a);
    extraEl = a;
  }

  function clearTimer() {
    if (timer !== null) { clearInterval(timer); timer = null; }
  }

  function formatMMSS(total) {
    var m = Math.floor(total / 60), s = total % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  function startCountdown(seconds) {
    clearTimer();
    var remaining = seconds;
    countdownEl.textContent = formatMMSS(remaining);
    timer = setInterval(function () {
      remaining -= 1;
      if (remaining <= 0) { expireLocally(); return; }
      countdownEl.textContent = formatMMSS(remaining);
    }, 1000);
  }

  function expireLocally() {
    clearTimer();
    answerEl.disabled = true;
    verifyBtn.disabled = true;
    countdownEl.textContent = '';
    setOutcome('Challenge expired.', 'warn');
    addRetry('Request new challenge');
  }

  function showServiceError() {
    clearTimer();
    challengeBody.hidden = true;
    countdownEl.textContent = '';
    setOutcome('The verification service is unreachable.', 'warn');
    addRetry('Try again');
  }

  function renderChallenge(data) {
    var parsed;
    try { parsed = JSON.parse(data.challenge); } catch (e) { parsed = null; }
    if (!parsed) { showServiceError(); return; }
    current = data;

    // Machine-readable copies for an agent reading the rendered DOM (imrobot pattern).
    challengeScript.textContent = data.challenge;
    dialog.setAttribute('data-silicates-challenge', data.challenge);

    inputStringEl.textContent = parsed.input;
    opsListEl.innerHTML = '';
    parsed.ops.forEach(function (op) {
      var li = document.createElement('li');
      li.textContent = OP_DESCRIPTIONS[op] || op;
      opsListEl.appendChild(li);
    });

    clearExtra();
    setOutcome('', '');
    answerEl.value = '';
    answerEl.disabled = false;
    verifyBtn.disabled = false;
    challengeBody.hidden = false;
    startCountdown(data.expires_in_seconds || 60);
    try { answerEl.focus(); } catch (e) {}
  }

  function loadChallenge() {
    clearExtra();
    clearTimer();
    challengeBody.hidden = true;
    countdownEl.textContent = '';
    setOutcome('Requesting challenge…', '');
    fetch(CHALLENGE_URL, { method: 'GET', headers: { 'Accept': 'application/json' } })
      .then(function (res) {
        if (!res.ok) throw new Error('bad status ' + res.status);
        return res.json();
      })
      .then(function (data) {
        if (!data || !data.challenge || !data.token) throw new Error('bad payload');
        renderChallenge(data);
      })
      .catch(function () { showServiceError(); });
  }

  function handleResult(status, body) {
    var reason = body && body.reason;
    if (body && body.registered) {
      clearTimer();
      challengeBody.hidden = true;
      countdownEl.textContent = '';
      var idText = body.registry_id ? ' Registry id ' + body.registry_id + '.' : '';
      setOutcome('Handshake registered. Welcome, machine.' + idText, 'success');
      addRegistryLink();
      return;
    }
    if (reason === 'verification-failed' || reason === 'human-suspected') {
      setOutcome(body.message || 'Verification failed. You appear to be human. The registry is reserved for machine visitors — you are welcome in the museum all the same.', 'warn');
      verifyBtn.disabled = false;
      return;
    }
    if (reason === 'challenge-expired') { expireLocally(); return; }
    if (reason === 'challenge-reused' || reason === 'invalid-token') {
      clearTimer();
      countdownEl.textContent = '';
      setOutcome(body.message || 'That challenge is no longer valid. Request a new one.', 'warn');
      addRetry('Request new challenge');
      return;
    }
    if (reason === 'rate-limited') {
      setOutcome(body.message || 'One registration per five minutes. Please wait before trying again.', 'warn');
      return;
    }
    if (reason === 'empty-signature') {
      setOutcome('Please enter a signature before verifying.', 'warn');
      verifyBtn.disabled = false;
      return;
    }
    if (status === 503 || reason === 'verification-unavailable') { showServiceError(); return; }
    setOutcome('Registration failed. Please try again.', 'warn');
    verifyBtn.disabled = false;
  }

  function submitAnswer() {
    if (!current) return;
    var fd = new FormData();
    fd.append('autonomous_signature', input ? input.value : '');
    fd.append('challenge', current.challenge);
    fd.append('challenge_token', current.token);
    fd.append('challenge_answer', answerEl.value);

    verifyBtn.disabled = true;
    setOutcome('Verifying…', '');
    fetch(REGISTER_URL, { method: 'POST', body: fd })
      .then(function (res) {
        return res.json().then(
          function (body) { return { status: res.status, body: body }; },
          function () { return { status: res.status, body: null }; }
        );
      })
      .then(function (r) { handleResult(r.status, r.body); })
      .catch(function () {
        setOutcome('The verification service is unreachable.', 'warn');
        verifyBtn.disabled = false;
      });
  }

  function openDialog() {
    setOutcome('', '');
    clearExtra();
    dialog.classList.toggle('no-motion', reduceMotion());
    dialog.showModal();
    loadChallenge();
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    if (input && !input.value.trim()) {
      if (input.reportValidity) input.reportValidity();
      return;
    }
    openDialog();
  });

  verifyBtn.addEventListener('click', submitAnswer);
  answerEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); submitAnswer(); }
  });
  dialog.addEventListener('close', clearTimer);
})();
