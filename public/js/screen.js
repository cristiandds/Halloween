/* ==========================================================================
   HALLOWEEN SCREEN CONTROLLER - RESOLUME ARENA & PROJECTION
   Zero External Dependencies • Self-Contained QR • Native ES6
   ========================================================================== */

(function () {
  'use strict';

  // DOM Elements
  const waitingView = document.querySelector('#waiting');
  const revealView = document.querySelector('#reveal');
  const personEl = document.querySelector('#person');
  const phraseEl = document.querySelector('#phrase');
  const qrContainer = document.querySelector('#qr');
  const qrFallback = document.querySelector('#qr-fallback');
  const timerProgress = document.querySelector('#timer-progress');
  const hudEl = document.querySelector('#hud');
  const connectionEl = document.querySelector('#connection');
  const queueStatusEl = document.querySelector('#queue-status');
  const countdownEl = document.querySelector('#countdown');

  // Internal state
  let currentActiveId = null;
  let timerInterval = null;
  let pollInterval = null;
  let cursorTimeout = null;
  let resolvedJoinUrl = '';
  let serverOffsetMs = 0;
  let lastDurationMs = 15000;

  // Resolume Clean Mode Check
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('clean') === '1' || urlParams.get('hud') === '0') {
    if (hudEl) hudEl.classList.add('hud-hidden');
  }

  // Auto-hide mouse cursor after 2.5s of inactivity
  function resetCursorTimer() {
    document.body.classList.remove('hide-cursor');
    clearTimeout(cursorTimeout);
    cursorTimeout = setTimeout(() => {
      document.body.classList.add('hide-cursor');
    }, 2500);
  }
  window.addEventListener('mousemove', resetCursorTimer);
  window.addEventListener('mousedown', resetCursorTimer);
  resetCursorTimer();

  // Fullscreen & HUD toggle key listeners (F for fullscreen, H for HUD)
  window.addEventListener('keydown', (e) => {
    if (e.key === 'f' || e.key === 'F') {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    } else if (e.key === 'h' || e.key === 'H') {
      if (hudEl) hudEl.classList.toggle('hud-hidden');
    }
  });

  // Double click to toggle fullscreen
  window.addEventListener('dblclick', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  });

  function setConnectionStatus(status) {
    if (!connectionEl) return;
    connectionEl.dataset.state = status;
    if (status === 'connected') {
      connectionEl.textContent = 'En Vivo';
    } else if (status === 'reconnecting') {
      connectionEl.textContent = 'Reconectando...';
    } else if (status === 'disconnected') {
      connectionEl.textContent = 'Sin Conexión';
    } else {
      connectionEl.textContent = 'Conectando...';
    }
  }

  /**
   * Determine real site URL and generate QR code
   */
  async function initQRCode() {
    try {
      // 1. Try to get canonical production URL from /api/config
      try {
        const configRes = await fetch('/api/config', { cache: 'no-store' });
        if (configRes.ok) {
          const cfg = await configRes.json();
          if (cfg.joinUrl && cfg.joinUrl.startsWith('http')) {
            resolvedJoinUrl = cfg.joinUrl;
          }
          if (cfg.displaySeconds) {
            lastDurationMs = cfg.displaySeconds * 1000;
          }
        }
      } catch (e) {
        // Fallback to origin
      }

      if (!resolvedJoinUrl) {
        resolvedJoinUrl = `${window.location.origin}/join`;
      }

      if (qrFallback) {
        qrFallback.textContent = resolvedJoinUrl;
      }

      if (!qrContainer) return;
      qrContainer.innerHTML = '';

      // Try local Davidshimjs QRCode generator first (vendor/qrcode.min.js)
      let qrRendered = false;
      if (typeof QRCode !== 'undefined') {
        try {
          new QRCode(qrContainer, {
            text: resolvedJoinUrl,
            width: 380,
            height: 380,
            colorDark: '#000000',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.M
          });

          // Style canvas or image nicely
          const img = qrContainer.querySelector('img');
          const canvas = qrContainer.querySelector('canvas');
          if (img) img.style.width = '100%';
          if (canvas) canvas.style.width = '100%';
          qrRendered = true;
        } catch (err) {
          console.warn('Local QRCode generator failed:', err);
        }
      }

      // Fallback to server SVG QR if needed
      if (!qrRendered) {
        try {
          const qrRes = await fetch('/api/qr', { cache: 'no-store' });
          if (qrRes.ok) {
            const qrData = await qrRes.json();
            if (qrData.svg) {
              qrContainer.innerHTML = qrData.svg;
              qrRendered = true;
            }
          }
        } catch (e) {}
      }

      if (!qrRendered) {
        qrContainer.innerHTML = `<div style="color:#000;padding:20px;font-size:14px;word-break:break-all;"><strong>${resolvedJoinUrl}</strong></div>`;
      }
    } catch (err) {
      console.error('Error initializing QR:', err);
    }
  }

  function stopTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    if (timerProgress) {
      timerProgress.style.width = '0%';
    }
  }

  function startTimer(remainingMs, totalDurationMs, isPaused) {
    stopTimer();
    const total = totalDurationMs || lastDurationMs || 15000;
    const initialRemaining = Math.max(0, Number(remainingMs) || total);
    const startTimestamp = Date.now();

    const updateTimer = () => {
      let currentRemaining;
      if (isPaused) {
        currentRemaining = initialRemaining;
      } else {
        const elapsed = Date.now() - startTimestamp;
        currentRemaining = Math.max(0, initialRemaining - elapsed);
      }

      const fraction = Math.max(0, Math.min(1, currentRemaining / total));
      const secondsLeft = Math.ceil(currentRemaining / 1000);

      if (timerProgress) {
        timerProgress.style.width = `${fraction * 100}%`;
      }

      if (countdownEl) {
        if (isPaused) {
          countdownEl.textContent = `PAUSA • ${secondsLeft}s`;
        } else {
          countdownEl.textContent = `${secondsLeft}s`;
        }
      }
    };

    updateTimer();
    if (!isPaused) {
      timerInterval = setInterval(updateTimer, 200);
    }
  }

  /**
   * Render state received from /api/state
   */
  function renderState(data) {
    setConnectionStatus('connected');

    if (typeof data.serverTime === 'number') {
      serverOffsetMs = data.serverTime - Date.now();
    }

    const isActive = data.status === 'active' || Boolean(data.active);
    const active = data.active || null;
    const activeId = active ? (active.id || active.name) : null;
    const remainingMs = typeof data.remainingMs === 'number' ? data.remainingMs : (typeof data.timeRemaining === 'number' ? data.timeRemaining * 1000 : 15000);
    const durationMs = (data.displaySeconds || 15) * 1000;
    const waitingCount = typeof data.waiting === 'number' ? data.waiting : 0;
    const isPaused = Boolean(data.paused);

    // Update queue count badge
    if (queueStatusEl) {
      if (waitingCount > 0) {
        queueStatusEl.textContent = `En cola: ${waitingCount} ${waitingCount === 1 ? 'persona' : 'personas'}`;
      } else {
        queueStatusEl.textContent = '';
      }
    }

    // STATE A: EMPTY QUEUE -> DISPLAY QR
    if (!isActive || !active) {
      currentActiveId = null;
      stopTimer();

      if (countdownEl) {
        countdownEl.textContent = isPaused ? 'EN PAUSA' : '';
      }

      if (revealView) {
        revealView.classList.add('hidden');
      }
      if (waitingView) {
        waitingView.classList.remove('hidden');
      }
      return;
    }

    // STATE B: ACTIVE PARTICIPANT REVEAL
    if (waitingView) {
      waitingView.classList.add('hidden');
    }
    if (revealView) {
      revealView.classList.remove('hidden');
    }

    // Trigger animation when active participant changes
    if (currentActiveId !== activeId) {
      currentActiveId = activeId;

      if (personEl) {
        personEl.textContent = active.name || 'ANÓNIMO';
      }

      if (phraseEl) {
        phraseEl.textContent = active.phrase ? `«${active.phrase}»` : '';
      }

      // Re-trigger impact animation
      const revealContent = revealView?.querySelector('.reveal-content');
      if (revealContent) {
        revealContent.style.animation = 'none';
        void revealContent.offsetWidth; // trigger reflow
        revealContent.style.animation = '';
      }
    }

    startTimer(remainingMs, durationMs, isPaused);
  }

  /**
   * Main polling cycle
   */
  async function pollState() {
    try {
      const response = await fetch('/api/state', {
        headers: { Accept: 'application/json' },
        cache: 'no-store'
      });

      if (response.ok) {
        const data = await response.json();
        renderState(data);
      } else {
        setConnectionStatus('reconnecting');
      }
    } catch (err) {
      setConnectionStatus('disconnected');
    }
  }

  // Initialize
  setConnectionStatus('connecting');
  initQRCode();
  pollState();
  pollInterval = setInterval(pollState, 1500);

  window.addEventListener('beforeunload', () => {
    clearInterval(pollInterval);
    clearInterval(timerInterval);
    clearTimeout(cursorTimeout);
  });
})();
