/* ==========================================================================
   HALLOWEEN ADMIN PANEL - CONTROLLER
   100% Native JavaScript • Zero Frameworks • Real-Time Queue Manager
   ========================================================================== */

(function () {
  'use strict';

  // DOM Elements
  const authSection = document.querySelector('#auth-section');
  const dashboardSection = document.querySelector('#dashboard-section');
  const loginForm = document.querySelector('#admin-login-form');
  const adminPassInput = document.querySelector('#admin-pass');
  const loginError = document.querySelector('#login-error');
  const logoutBtn = document.querySelector('#logout-btn');
  const statusBanner = document.querySelector('#status-banner');

  // Stats
  const statWaiting = document.querySelector('#stat-waiting');
  const statProjection = document.querySelector('#stat-projection');
  const statRemaining = document.querySelector('#stat-remaining');
  const statInscriptions = document.querySelector('#stat-inscriptions');

  // Action Buttons
  const btnTogglePause = document.querySelector('#btn-toggle-pause');
  const btnNext = document.querySelector('#btn-next');
  const btnToggleInscriptions = document.querySelector('#btn-toggle-inscriptions');
  const btnClearQueue = document.querySelector('#btn-clear-queue');
  const btnRefresh = document.querySelector('#btn-refresh');

  // Details
  const activeNameEl = document.querySelector('#active-name');
  const activePhraseEl = document.querySelector('#active-phrase');
  const queueTbody = document.querySelector('#queue-tbody');

  let adminToken = sessionStorage.getItem('halloween_admin_token') || '';
  let refreshTimer = null;
  let bannerTimer = null;
  let lastState = null;

  function showBanner(message, isError = false) {
    if (!statusBanner) return;
    clearTimeout(bannerTimer);
    statusBanner.textContent = message;
    statusBanner.style.color = isError ? '#f87171' : '#4ade80';
    statusBanner.style.borderColor = isError ? 'rgba(239, 68, 68, 0.4)' : 'rgba(34, 197, 94, 0.4)';
    statusBanner.style.background = isError ? 'rgba(239, 68, 68, 0.15)' : 'rgba(34, 197, 94, 0.15)';
    statusBanner.classList.remove('hidden');
    bannerTimer = setTimeout(() => {
      statusBanner.classList.add('hidden');
    }, 4000);
  }

  function setAuthenticated(isAuth) {
    if (isAuth) {
      if (authSection) authSection.classList.add('hidden');
      if (dashboardSection) dashboardSection.classList.remove('hidden');
      startAutoRefresh();
      fetchAdminState();
    } else {
      stopAutoRefresh();
      sessionStorage.removeItem('halloween_admin_token');
      adminToken = '';
      if (dashboardSection) dashboardSection.classList.add('hidden');
      if (authSection) authSection.classList.remove('hidden');
      if (adminPassInput) adminPassInput.focus();
    }
  }

  async function apiCall(endpoint, method = 'GET', body = null) {
    const headers = {
      'Accept': 'application/json',
      'X-Admin-Password': adminToken
    };
    if (body) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(endpoint, {
      method,
      headers,
      body: body ? JSON.stringify(body) : null
    });

    if (response.status === 401) {
      setAuthenticated(false);
      throw new Error('Sesión expirada o no autorizada.');
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || 'Error en la operación.');
    }
    return data;
  }

  // Handle Login Form
  loginForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = (adminPassInput?.value || '').trim();
    if (!password) return;

    if (loginError) loginError.textContent = 'Verificando...';

    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || 'Contraseña incorrecta.');
      }

      adminToken = password;
      sessionStorage.setItem('halloween_admin_token', adminToken);
      if (loginError) loginError.textContent = '';
      setAuthenticated(true);
    } catch (err) {
      if (loginError) loginError.textContent = err.message || 'Error al iniciar sesión.';
    }
  });

  logoutBtn?.addEventListener('click', () => {
    setAuthenticated(false);
  });

  function renderDashboard(data) {
    lastState = data;

    const waiting = Array.isArray(data.queue) ? data.queue.length : (data.waiting || 0);
    const active = data.active || null;
    const isPaused = Boolean(data.paused);
    const inscriptionsOpen = data.inscriptionsOpen !== false;
    const remainingSec = typeof data.timeRemaining === 'number' ? data.timeRemaining : Math.ceil((data.remainingMs || 0) / 1000);

    // Update stats
    if (statWaiting) statWaiting.textContent = String(waiting);
    if (statRemaining) statRemaining.textContent = active ? `${remainingSec}s` : '-';

    if (statProjection) {
      if (data.screenConnected === false) {
        statProjection.textContent = 'PANTALLA DESCONECTADA';
        statProjection.style.color = '#f87171';
      } else if (isPaused) {
        statProjection.textContent = 'EN PAUSA';
        statProjection.style.color = '#fbbf24';
      } else if (active) {
        statProjection.textContent = 'PROYECTANDO';
        statProjection.style.color = '#4ade80';
      } else {
        statProjection.textContent = 'MODO QR';
        statProjection.style.color = '#ffffff';
      }
    }

    if (statInscriptions) {
      statInscriptions.textContent = inscriptionsOpen ? 'ABIERTAS' : 'CERRADAS';
      statInscriptions.className = inscriptionsOpen ? 'stat-value ok' : 'stat-value danger';
      statInscriptions.style.color = inscriptionsOpen ? '#4ade80' : '#f87171';
    }

    // Update buttons text
    if (btnTogglePause) {
      btnTogglePause.textContent = isPaused ? '▶️ Reanudar Proyección' : '⏸️ Pausar Proyección';
    }
    if (btnToggleInscriptions) {
      btnToggleInscriptions.textContent = inscriptionsOpen ? '🔒 Pausar Inscripciones' : '🔓 Abrir Inscripciones';
    }

    // Update Active Card
    if (active) {
      if (activeNameEl) activeNameEl.textContent = active.name || 'Sin nombre';
      if (activePhraseEl) activePhraseEl.textContent = active.phrase ? `«${active.phrase}»` : '';
    } else {
      if (activeNameEl) activeNameEl.textContent = 'Nadie (Mostrando Código QR en Pantalla)';
      if (activePhraseEl) activePhraseEl.textContent = '';
    }

    // Update Queue Table
    if (queueTbody) {
      queueTbody.innerHTML = '';
      const queue = Array.isArray(data.queue) ? data.queue : [];

      if (queue.length === 0) {
        queueTbody.innerHTML = '<tr><td colspan="4" class="empty-cell">Sin participantes en espera</td></tr>';
      } else {
        queue.forEach((p, index) => {
          const tr = document.createElement('tr');
          const timeStr = p.registeredAt ? new Date(p.registeredAt).toLocaleTimeString() : '-';

          tr.innerHTML = `
            <td><strong>#${index + 1}</strong></td>
            <td><strong>${escapeHtml(p.name)}</strong></td>
            <td><em>${escapeHtml(p.phrase || '-')}</em></td>
            <td>${timeStr}</td>
          `;
          queueTbody.appendChild(tr);
        });
      }
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  async function fetchAdminState() {
    if (!adminToken) return;
    try {
      const data = await apiCall('/api/admin');
      renderDashboard(data);
    } catch (err) {
      console.warn('Error fetching admin state:', err.message);
    }
  }

  function startAutoRefresh() {
    stopAutoRefresh();
    fetchAdminState();
    refreshTimer = setInterval(fetchAdminState, 2500);
  }

  function stopAutoRefresh() {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  }

  // Button Actions
  btnTogglePause?.addEventListener('click', async () => {
    try {
      const isPaused = lastState && lastState.paused;
      const action = isPaused ? 'resume' : 'pause';
      await apiCall(`/api/admin/${action}`, 'POST');
      showBanner(isPaused ? 'Proyección reanudada.' : 'Proyección pausada.');
      fetchAdminState();
    } catch (err) {
      showBanner(err.message, true);
    }
  });

  btnNext?.addEventListener('click', async () => {
    try {
      await apiCall('/api/admin/next', 'POST');
      showBanner('Avanzado al siguiente participante.');
      fetchAdminState();
    } catch (err) {
      showBanner(err.message, true);
    }
  });

  btnToggleInscriptions?.addEventListener('click', async () => {
    try {
      const currentlyOpen = lastState && lastState.inscriptionsOpen !== false;
      await apiCall('/api/admin/toggle', 'POST', { open: !currentlyOpen });
      showBanner(!currentlyOpen ? 'Inscripciones abiertas.' : 'Inscripciones pausadas.');
      fetchAdminState();
    } catch (err) {
      showBanner(err.message, true);
    }
  });

  btnClearQueue?.addEventListener('click', async () => {
    const confirmed = window.confirm('¿Estás seguro de que deseas vaciar toda la cola de participantes? La pantalla volverá inmediatamente al código QR.');
    if (!confirmed) return;

    try {
      await apiCall('/api/admin/clear', 'POST');
      showBanner('La cola ha sido vaciada por completo.');
      fetchAdminState();
    } catch (err) {
      showBanner(err.message, true);
    }
  });

  btnRefresh?.addEventListener('click', () => {
    fetchAdminState();
    showBanner('Estado actualizado.');
  });

  // Init
  if (adminToken) {
    setAuthenticated(true);
  } else {
    setAuthenticated(false);
  }

  window.addEventListener('beforeunload', stopAutoRefresh);
})();
