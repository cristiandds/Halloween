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
  const registerAnotherBtn = document.querySelector('#register-another-btn');
  const backToFormBtn = document.querySelector('#back-to-form-btn');
  const retryOpenBtn = document.querySelector('#retry-open-btn');
  const errorMessageEl = document.querySelector('#error-message');

  const STORAGE_KEY = 'halloween_ritual_participant_v3';
  let currentParticipant = loadSession();
  let pollTimer = null;
  let isSubmitting = false;
  let isPollingStatus = false;

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

  function showTrackingState(title, message, badge, position = '-', wait = '-') {
    setPanel(stateTracking);
    if (trackingTitle) trackingTitle.textContent = title;
    if (trackingMessage) trackingMessage.textContent = message;
    if (trackStatusBadge) {
      trackStatusBadge.textContent = badge;
      trackStatusBadge.className = 'track-value badge-waiting';
    }
    if (trackPosition) trackPosition.textContent = position;
    if (trackWait) trackWait.textContent = wait;
    if (activeAlertBox) activeAlertBox.classList.add('hidden');
  }

  function renderTrackingView(participant) {
    setPanel(stateTracking);

    // Never claim projection when the screen is offline or its timer expired.
    if (participant.isActive && participant.screenConnected === false) {
      showTrackingState('PANTALLA DESCONECTADA', 'Tu turno está reservado, pero la pantalla no está conectada.', 'En espera', 'PAUSADO', '...');
    } else if (participant.isActive && !(participant.remainingSeconds > 0)) {
      showTrackingState('SINCRONIZANDO...', 'Esperando confirmación de la proyección.', 'Verificando', '...', '...');
    } else if (participant.isActive) {
      if (trackingTitle) trackingTitle.textContent = '¡EN PANTALLA!';
      if (trackingMessage) trackingMessage.textContent = 'Tu nombre se está proyectando en este momento.';
      if (trackStatusBadge) {
        trackStatusBadge.textContent = 'EN PANTALLA';
        trackStatusBadge.className = 'track-value badge-active';
      }
      if (trackPosition) trackPosition.textContent = 'AHORA';
      if (trackWait) trackWait.textContent = `${Math.ceil(participant.remainingSeconds)}s`;
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

  function endTracking(message, title = 'RITUAL CONCLUIDO', badge = 'Finalizado') {
    stopTracking();
    clearSession();
    currentParticipant = null;
    showTrackingState(title, message, badge, 'LISTO');
  }

  async function pollParticipantStatus() {
    if (!currentParticipant || !currentParticipant.id || isPollingStatus) return;
    const queriedId = currentParticipant.id;
    isPollingStatus = true;

    try {
      const response = await fetch(`/api/participant/status?id=${encodeURIComponent(queriedId)}`, {
        cache: 'no-store'
      });

      // The user may have pressed "Registrar otro nombre" while this was loading.
      if (!currentParticipant || currentParticipant.id !== queriedId) return;

      if (response.status === 404) {
        endTracking('No encontramos este registro. Puedes registrar otro nombre.', 'REGISTRO NO DISPONIBLE', 'No encontrado');
        return;
      }

      if (!response.ok) {
        throw new Error(`Estado HTTP ${response.status}`);
      }

      const data = await response.json();
      if (!currentParticipant || currentParticipant.id !== queriedId) return;

      if (data.state === 'active') {
        currentParticipant.isActive = true;
        currentParticipant.position = 1;
        currentParticipant.screenConnected = data.screenConnected === true;
        currentParticipant.remainingSeconds = Math.max(0, Number(data.remainingSeconds) || 0);
        renderTrackingView(currentParticipant);
      } else if (data.state === 'waiting') {
        currentParticipant.isActive = false;
        currentParticipant.position = data.position;
        currentParticipant.screenConnected = data.screenConnected === true;
        currentParticipant.estimatedWaitSeconds = data.estimatedWaitSeconds;
        renderTrackingView(currentParticipant);
      } else if (data.state === 'completed') {
        endTracking('Tu turno ha finalizado. Puedes registrar otro nombre.', 'RITUAL CONCLUIDO', 'Finalizado');
      } else {
        showTrackingState('ESTADO DESCONOCIDO', 'No fue posible confirmar el turno. Puedes actualizar o registrar otro nombre.', 'Verificar');
      }
    } catch (err) {
      // Do not leave a stale green "EN PANTALLA" alert after losing the API.
      if (currentParticipant && currentParticipant.id === queriedId) {
        console.warn('Error polling participant status:', err);
        showTrackingState('SIN CONEXIÓN', 'No se pudo verificar el estado de la proyección. Se intentará de nuevo.', 'Reconectando');
      }
    } finally {
      isPollingStatus = false;
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

  // Register another person without cancelling the previous person's place.
  registerAnotherBtn?.addEventListener('click', () => {
    stopTracking();
    currentParticipant = null;
    clearSession();
    form?.reset();
    if (warningEl) warningEl.textContent = '';
    setPanel(stateForm);
    nameInput?.focus();
  });

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
      // Persisted flags are never proof that a name is currently on screen.
      currentParticipant.isActive = false;
      currentParticipant.screenConnected = false;
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
