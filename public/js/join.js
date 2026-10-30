/* ==========================================================================
   HALLOWEEN MOBILE CLIENT - JOIN & LIVE STATUS TRACKER
   100% Native JavaScript • Zero Frameworks • Auto Session Recovery
   ========================================================================== */

(function () {
  'use strict';

  // DOM Elements
  const form = document.querySelector('#invocation-form');
  const nameInput = document.querySelector('#participant-name');
  const submitBtn = document.querySelector('#submit-btn');
  const warningEl = document.querySelector('#name-warning');

  // Panels
  const stateForm = document.querySelector('#state-form');
  const stateSending = document.querySelector('#state-sending');
  const stateTracking = document.querySelector('#state-tracking');
  const stateError = document.querySelector('#state-error');
  const stateClosed = document.querySelector('#state-closed');

  // Tracking Elements
  const trackingTitle = document.querySelector('#tracking-title');
  const trackingMessage = document.querySelector('#tracking-message');
  const trackStatusBadge = document.querySelector('#track-status-badge');
  const trackPosition = document.querySelector('#track-position');
  const trackWait = document.querySelector('#track-wait');
  const activeAlertBox = document.querySelector('#active-alert-box');
  const refreshTrackBtn = document.querySelector('#refresh-track-btn');
  const backToFormBtn = document.querySelector('#back-to-form-btn');
  const retryOpenBtn = document.querySelector('#retry-open-btn');
  const errorMessageEl = document.querySelector('#error-message');

  const STORAGE_KEY = 'halloween_ritual_participant_v3';
  let currentParticipant = loadSession();
  let pollTimer = null;
  let isSubmitting = false;

  function loadSession() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function saveSession(data) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {}
  }

  function clearSession() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {}
  }

  function setPanel(panel) {
    [stateForm, stateSending, stateTracking, stateError, stateClosed].forEach(el => {
      if (!el) return;
      el.classList.toggle('active', el === panel);
    });
  }

  function validateName(val) {
    const raw = typeof val === 'string' ? val.trim() : '';
    if (raw.length === 0) {
      return { valid: false, message: 'Por favor, escribe tu nombre o apodo.' };
    }
    if (raw.length < 2) {
      return { valid: false, message: 'El nombre debe tener al menos 2 caracteres.' };
    }
    if (raw.length > 32) {
      return { valid: false, message: 'El nombre no puede superar los 32 caracteres.' };
    }
    if (/[<>]/.test(raw) || /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2060\uFEFF\u202A-\u202E]/.test(raw)) {
      return { valid: false, message: 'No se permiten caracteres especiales o etiquetas.' };
    }
    return { valid: true, message: '' };
  }

  nameInput?.addEventListener('input', () => {
    if (!warningEl) return;
    const res = validateName(nameInput.value);
    warningEl.textContent = res.valid ? '' : res.message;
  });

  // Handle Form Submission
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (isSubmitting) return;

    const nameVal = (nameInput.value || '').trim();
    const validation = validateName(nameVal);

    if (!validation.valid) {
      if (warningEl) warningEl.textContent = validation.message;
      nameInput.focus();
      return;
    }

    isSubmitting = true;
    if (submitBtn) submitBtn.disabled = true;
    setPanel(stateSending);

    try {
      const response = await fetch('/api/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ name: nameVal })
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || 'Ocurrió un error al enviar tu nombre.');
      }

      currentParticipant = {
        id: data.id,
        name: data.name || nameVal,
        position: data.position || 1,
        isActive: false, // Placed in queue; never "EN PANTALLA" immediately at submission
        screenConnected: data.screenConnected !== false,
        estimatedWaitSeconds: data.estimatedWaitSeconds || 15,
        submittedAt: Date.now()
      };
      saveSession(currentParticipant);

      renderTrackingView(currentParticipant);
      startTracking();
    } catch (err) {
      console.error('Submission error:', err);
      if (errorMessageEl) {
        errorMessageEl.textContent = err.message || 'No se pudo conectar con el servidor.';
      }
      setPanel(stateError);
    } finally {
      isSubmitting = false;
      if (submitBtn) submitBtn.disabled = false;
    }
  });

  function renderTrackingView(participant) {
    setPanel(stateTracking);

    if (participant.isActive) {
      if (trackingTitle) trackingTitle.textContent = '¡EN PANTALLA!';
      if (trackingMessage) trackingMessage.textContent = 'Tu nombre se está proyectando en este momento.';
      if (trackStatusBadge) {
        trackStatusBadge.textContent = 'EN PANTALLA';
        trackStatusBadge.className = 'track-value badge-active';
      }
      if (trackPosition) trackPosition.textContent = 'AHORA';
      if (trackWait) trackWait.textContent = '0s';
      if (activeAlertBox) activeAlertBox.classList.remove('hidden');
    } else {
      if (trackingTitle) trackingTitle.textContent = '¡INVOCACIÓN ENVIADA!';
      if (trackingMessage) trackingMessage.textContent = 'Tu nombre está en la cola del ritual.';
      if (trackStatusBadge) {
        trackStatusBadge.textContent = 'En cola';
        trackStatusBadge.className = 'track-value badge-waiting';
      }
      if (trackPosition) {
        trackPosition.textContent = participant.position ? `#${participant.position}` : '#1';
      }
      if (trackWait) {
        const sec = participant.estimatedWaitSeconds || 15;
        if (participant.screenConnected === false) {
          trackWait.textContent = 'En espera...';
        } else {
          trackWait.textContent = sec < 60 ? `~${sec}s` : `~${Math.ceil(sec / 60)}m`;
        }
      }
      if (activeAlertBox) activeAlertBox.classList.add('hidden');
    }
  }

  async function pollParticipantStatus() {
    if (!currentParticipant || !currentParticipant.id) return;

    try {
      const response = await fetch(`/api/participant/status?id=${encodeURIComponent(currentParticipant.id)}`, {
        cache: 'no-store'
      });

      if (response.status === 404) {
        return;
      }

      if (response.ok) {
        const data = await response.json();

        if (data.state === 'active') {
          currentParticipant.isActive = true;
          currentParticipant.position = 1;
          currentParticipant.screenConnected = true;
          renderTrackingView(currentParticipant);
        } else if (data.state === 'waiting') {
          currentParticipant.isActive = false;
          currentParticipant.position = data.position;
          currentParticipant.screenConnected = data.screenConnected !== false;
          currentParticipant.estimatedWaitSeconds = data.estimatedWaitSeconds;
          renderTrackingView(currentParticipant);
        } else if (data.state === 'completed') {
          if (trackingTitle) trackingTitle.textContent = 'RITUAL CONCLUIDO';
          if (trackingMessage) trackingMessage.textContent = 'Tu turno en la pantalla ha finalizado. ¡Gracias por participar!';
          if (trackStatusBadge) {
            trackStatusBadge.textContent = 'Finalizado';
            trackStatusBadge.className = 'track-value';
          }
          if (trackPosition) trackPosition.textContent = 'LISTO';
          if (trackWait) trackWait.textContent = '-';
          if (activeAlertBox) activeAlertBox.classList.add('hidden');
          stopTracking();
          clearSession();
        }
      }
    } catch (err) {
      console.warn('Error polling participant status:', err);
    }
  }

  function startTracking() {
    stopTracking();
    pollParticipantStatus();
    pollTimer = setInterval(pollParticipantStatus, 2000);
  }

  function stopTracking() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  refreshTrackBtn?.addEventListener('click', pollParticipantStatus);

  backToFormBtn?.addEventListener('click', () => {
    setPanel(stateForm);
    nameInput?.focus();
  });

  retryOpenBtn?.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/inscriptions/status', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (data.open) {
          setPanel(stateForm);
          nameInput?.focus();
          return;
        }
      }
      alert('Las inscripciones aún siguen cerradas.');
    } catch (e) {
      alert('No se pudo verificar el estado.');
    }
  });

  // Initialization check on page load
  window.addEventListener('load', async () => {
    if (currentParticipant && currentParticipant.id) {
      renderTrackingView(currentParticipant);
      startTracking();
      return;
    }

    // Check if inscriptions are open
    try {
      const res = await fetch('/api/inscriptions/status', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (data.open === false) {
          setPanel(stateClosed);
          return;
        }
      }
    } catch (e) {}

    setPanel(stateForm);
    nameInput?.focus();
  });

  window.addEventListener('beforeunload', stopTracking);
})();
