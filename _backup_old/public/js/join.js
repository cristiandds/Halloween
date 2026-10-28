const form = document.querySelector("#invocation-form");
const nameInput = document.querySelector("#participant-name");
const submitBtn = document.querySelector("#submit-btn");
const warningEl = document.querySelector("#name-warning");
const liveRegion = document.querySelector("#live-region");

const stateForm = document.querySelector("#state-form");
const stateSending = document.querySelector("#state-sending");
const stateTracking = document.querySelector("#state-tracking");
const stateError = document.querySelector("#state-error");
const stateClosed = document.querySelector("#state-closed");

const trackingTitle = document.querySelector("#tracking-title");
const trackingMessage = document.querySelector("#tracking-message");
const trackingDetail = document.querySelector("#tracking-detail");
const infoStatus = document.querySelector("#info-status");
const cardPosition = document.querySelector("#card-position");
const infoPosition = document.querySelector("#info-position");
const cardWait = document.querySelector("#card-wait");
const infoWait = document.querySelector("#info-wait");
const cardApproval = document.querySelector("#card-approval");
const infoApproval = document.querySelector("#info-approval");
const refreshBtn = document.querySelector("#refresh-btn");

const errorMessage = document.querySelector("#error-message");
const retryBtn = document.querySelector("#retry-btn");
const backToFormBtn = document.querySelector("#back-to-form-btn");
const checkStatusBtn = document.querySelector("#check-status-btn");

const STORAGE_KEY = "halloween_join_session_v2";
const PARTICIPANT_ID_COOKIE_NAME = "halloween_pid";

let submitting = false;
let participantId = getCookie(PARTICIPANT_ID_COOKIE_NAME);
let lastSubmit = loadSession();
let pollTimer = null;
let socket = null;

const PARTICIPANT_STATES = {
  PENDING_APPROVAL: "pending_approval",
  WAITING: "waiting",
  ACTIVE: "active",
  COMPLETED: "completed",
  REJECTED: "rejected",
  SKIPPED: "skipped"
};

function getCookie(name) {
  if (!document.cookie) return null;
  const parts = document.cookie.split(";").map((c) => c.trim());
  for (let i = 0; i < parts.length; i += 1) {
    if (parts[i].startsWith(name + "=")) {
      return parts[i].substring(name.length + 1);
    }
  }
  return null;
}

function loadSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed;
  } catch (error) {
    return null;
  }
}

function saveSession(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (error) {
    // Ignore storage errors
  }
}

function clearSession() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    // Ignore
  }
}

function announce(message) {
  if (!liveRegion) return;
  liveRegion.textContent = "";
  // Force reflow for screen readers
  void liveRegion.offsetHeight;
  liveRegion.textContent = message;
}

function setActiveState(panel) {
  [stateForm, stateSending, stateTracking, stateError, stateClosed].forEach((el) => {
    if (!el) return;
    el.classList.toggle("active", el === panel);
  });
}

function validateName(value) {
  const raw = typeof value === "string" ? value : "";
  if (raw.length === 0) {
    return { valid: false, message: "Escribe tu nombre para invocar tu destino." };
  }
  if (raw.length < 2) {
    return { valid: false, message: "El nombre debe tener al menos 2 caracteres." };
  }
  if (raw.length > 32) {
    return { valid: false, message: "El nombre no puede superar los 32 caracteres." };
  }
  // Basic client-side check matching server rules
  if (/[<>]/.test(raw)) {
    return { valid: false, message: "No uses caracteres < o > en tu nombre." };
  }
  if (/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2060\uFEFF\u202A-\u202E]/.test(raw)) {
    return { valid: false, message: "No uses caracteres invisibles o de control." };
  }
  if (!/^[\p{L}\p{M}0-9 .'-]+$/u.test(raw)) {
    return { valid: false, message: "Usa solo letras, números, espacios, punto, apóstrofe o guion." };
  }
  return { valid: true, message: "" };
}

nameInput?.addEventListener("input", () => {
  if (!warningEl) return;
  const result = validateName(nameInput.value);
  warningEl.textContent = result.valid ? "" : result.message;
});

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (submitting) {
    return;
  }

  const nameValue = nameInput.value;
  const validation = validateName(nameValue);
  if (!validation.valid) {
    warningEl.textContent = validation.message;
    announce(validation.message);
    nameInput.focus();
    return;
  }

  submitting = true;
  submitBtn.disabled = true;
  warningEl.textContent = "";
  setActiveState(stateSending);
  announce("Enviando tu invocación...");

  try {
    const response = await fetch("/api/submit", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      credentials: "same-origin",
      body: JSON.stringify({ name: nameValue })
    });

    const text = await response.text();
    let data = {};
    try {
      data = JSON.parse(text);
    } catch (parseError) {
      data = {};
    }

    if (!response.ok) {
      throw {
        status: response.status,
        message: data.error || getErrorMessage(response.status)
      };
    }

    // Actualizar cookie de participante si viene
    participantId = getCookie(PARTICIPANT_ID_COOKIE_NAME) || participantId;

    const sessionData = {
      submittedAt: Date.now(),
      name: nameValue.trim().replace(/\s+/g, " "),
      pendingApproval: Boolean(data.pendingApproval),
      position: typeof data.position === "number" ? data.position : null,
      estimatedWaitSeconds: typeof data.estimatedWaitSeconds === "number" ? data.estimatedWaitSeconds : null,
      state: data.pendingApproval ? PARTICIPANT_STATES.PENDING_APPROVAL : PARTICIPANT_STATES.WAITING
    };
    saveSession(sessionData);
    lastSubmit = sessionData;

    showTracking(sessionData, data.message);
    announce(data.message || "Invocación enviada correctamente.");
    startTracking();
  } catch (error) {
    console.error("Error al enviar invocación:", error);
    const message = error.message || getErrorMessage(error.status);
    showError(message, error.status);
    announce(message);
  } finally {
    submitting = false;
    submitBtn.disabled = false;
  }
});

function getErrorMessage(status) {
  switch (status) {
    case 400:
      return "Los datos enviados no son válidos. Revisa tu nombre e inténtalo de nuevo.";
    case 403:
      return "Las inscripciones están cerradas en este momento.";
    case 409:
      return "Ya has enviado este nombre anteriormente.";
    case 429:
      return "Has enviado demasiadas solicitudes o la cola está llena. Espera un momento e inténtalo de nuevo.";
    case 503:
      return "El servicio no está disponible temporalmente. Comprueba tu conexión e inténtalo de nuevo.";
    case 0:
      return "No hay conexión con el servidor. Comprueba tu red e inténtalo de nuevo.";
    default:
      return "Ha ocurrido un error inesperado al enviar tu invocación.";
  }
}

function showError(message, status) {
  if (!errorMessage) return;
  if (status === 403) {
    setActiveState(stateClosed);
    return;
  }
  errorMessage.textContent = message;
  setActiveState(stateError);
}

retryBtn?.addEventListener("click", () => {
  setActiveState(stateForm);
  nameInput?.focus();
});

backToFormBtn?.addEventListener("click", () => {
  setActiveState(stateForm);
  nameInput?.focus();
});

checkStatusBtn?.addEventListener("click", () => {
  if (lastSubmit) {
    showTracking(lastSubmit);
    startTracking();
    announce("Comprobando estado de tu invocación.");
  } else {
    setActiveState(stateForm);
    nameInput?.focus();
  }
});

refreshBtn?.addEventListener("click", async () => {
  announce("Actualizando estado...");
  await fetchMyStatus();
});

function showTracking(sessionData, serverMessage) {
  if (!stateTracking) return;

  if (sessionData.pendingApproval) {
    trackingTitle.textContent = "Pendiente de aprobación";
    trackingMessage.textContent = serverMessage || "Tu nombre quedó pendiente de aprobación por el organizador.";
    trackingDetail.textContent = "Cuando sea aprobado, pasarás automáticamente a la cola.";
    infoStatus.textContent = "Pendiente de aprobación";
    cardApproval.hidden = false;
    cardPosition.hidden = true;
    cardWait.hidden = true;
  } else {
    trackingTitle.textContent = "¡Invocación en proceso!";
    trackingMessage.textContent = serverMessage || "Tu nombre está en la cola esperando su turno.";
    trackingDetail.textContent = "Mantén esta página abierta. Los estados se sincronizan en tiempo real.";
    infoStatus.textContent = "En cola";
    cardApproval.hidden = true;
    
    if (typeof sessionData.position === "number" && sessionData.position > 0) {
      cardPosition.hidden = false;
      infoPosition.textContent = sessionData.position === 1 ? "Próximo a aparecer" : `#${sessionData.position}`;
    } else {
      cardPosition.hidden = true;
    }

    if (typeof sessionData.estimatedWaitSeconds === "number" && sessionData.estimatedWaitSeconds >= 0) {
      cardWait.hidden = false;
      const seconds = sessionData.estimatedWaitSeconds;
      if (seconds < 60) {
        infoWait.textContent = `${seconds} seg.`;
      } else {
        const minutes = Math.floor(seconds / 60);
        const secs = seconds % 60;
        infoWait.textContent = secs === 0 ? `${minutes} min.` : `${minutes} min. ${secs} seg.`;
      }
    } else {
      cardWait.hidden = true;
    }
  }

  setActiveState(stateTracking);
}

function updateTrackingFromServer(statusData) {
  if (!statusData || !lastSubmit) return;

  const pending = statusData.state === PARTICIPANT_STATES.PENDING_APPROVAL || statusData.pendingApproval;
  const inQueue = statusData.state === PARTICIPANT_STATES.WAITING;
  const active = statusData.state === PARTICIPANT_STATES.ACTIVE;
  const completed = statusData.state === PARTICIPANT_STATES.COMPLETED;
  const rejected = statusData.state === PARTICIPANT_STATES.REJECTED;
  const skipped = statusData.state === PARTICIPANT_STATES.SKIPPED;

  if (pending) {
    lastSubmit.pendingApproval = true;
    lastSubmit.state = PARTICIPANT_STATES.PENDING_APPROVAL;
    saveSession(lastSubmit);
    trackingTitle.textContent = "Pendiente de aprobación";
    trackingMessage.textContent = "Tu solicitud está siendo revisada por el organizador.";
    infoStatus.textContent = "Pendiente de aprobación";
    cardApproval.hidden = false;
    cardPosition.hidden = true;
    cardWait.hidden = true;
    trackingDetail.textContent = "En cuanto sea aprobada aparecerá en la cola.";
    return;
  }

  if (rejected) {
    trackingTitle.textContent = "Invocación rechazada";
    trackingMessage.textContent = "El organizador ha rechazado esta invocación.";
    trackingDetail.textContent = "Puedes intentar nuevamente con otro nombre si lo deseas.";
    infoStatus.textContent = "Rechazada";
    cardApproval.hidden = true;
    cardPosition.hidden = true;
    cardWait.hidden = true;
    stopTracking();
    return;
  }

  if (skipped) {
    trackingTitle.textContent = "Invocación omitida";
    trackingMessage.textContent = "Tu turno fue omitido en esta ronda.";
    trackingDetail.textContent = "Consulta con el organizador para más información.";
    infoStatus.textContent = "Omitida";
    cardApproval.hidden = true;
    cardPosition.hidden = true;
    cardWait.hidden = true;
    stopTracking();
    return;
  }

  if (active) {
    trackingTitle.textContent = "¡En pantalla!";
    trackingMessage.textContent = "Tu nombre está apareciendo ahora mismo en la pantalla del evento.";
    trackingDetail.textContent = "Disfruta del ritual...";
    infoStatus.textContent = "En pantalla";
    cardApproval.hidden = true;
    cardPosition.hidden = false;
    infoPosition.textContent = "ACTIVO";
    cardWait.hidden = false;
    infoWait.textContent = "Ahora";
    stopTracking();
    return;
  }

  if (completed) {
    trackingTitle.textContent = "Participación finalizada";
    trackingMessage.textContent = "Tu turno en pantalla ha concluido.";
    trackingDetail.textContent = "Gracias por participar en este ritual oscuro.";
    infoStatus.textContent = "Finalizada";
    cardApproval.hidden = true;
    cardPosition.hidden = true;
    cardWait.hidden = true;
    stopTracking();
    return;
  }

  if (inQueue) {
    lastSubmit.state = PARTICIPANT_STATES.WAITING;
    if (typeof statusData.position === "number") {
      lastSubmit.position = statusData.position;
      cardPosition.hidden = false;
      infoPosition.textContent = statusData.position === 1 ? "Próximo a aparecer" : `#${statusData.position}`;
    }
    if (typeof statusData.estimatedWaitSeconds === "number") {
      lastSubmit.estimatedWaitSeconds = statusData.estimatedWaitSeconds;
      cardWait.hidden = false;
      const seconds = statusData.estimatedWaitSeconds;
      if (seconds < 60) {
        infoWait.textContent = `${seconds} seg.`;
      } else {
        const minutes = Math.floor(seconds / 60);
        const secs = seconds % 60;
        infoWait.textContent = secs === 0 ? `${minutes} min.` : `${minutes} min. ${secs} seg.`;
      }
    }
    infoStatus.textContent = "En cola";
    saveSession(lastSubmit);
  }
}

async function fetchMyStatus() {
  try {
    const response = await fetch("/api/participant/status", {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "same-origin"
    });

    if (response.status === 404) {
      // No hay registro encontrado
      return;
    }

    if (!response.ok) {
      throw new Error("Error al obtener estado");
    }

    const data = await response.json();
    updateTrackingFromServer(data);
  } catch (error) {
    console.error("Error fetching status:", error);
  }
}

function startTracking() {
  stopTracking();
  // Polling como respaldo
  pollTimer = setInterval(fetchMyStatus, 5000);
  fetchMyStatus();
  
  // Intentar usar Socket.IO si está disponible
  try {
    if (typeof io !== "undefined") {
      socket = io({ withCredentials: true, transports: ["websocket", "polling"] });
      socket.on("connect", () => {
        // Socket conectado, los eventos vendrán por broadcast
        // pero necesitamos filtrar solo nuestro estado
      });
      socket.on("state", (snapshot) => {
        // Buscar nuestro participante en el snapshot si es posible
        if (snapshot && Array.isArray(snapshot.participants) && lastSubmit) {
          // No tenemos ID local, pero podemos intentar por posición/nombre
          // Por seguridad, solo actualizamos con polling principalmente
          fetchMyStatus();
        }
      });
    }
  } catch (error) {
    // Socket no disponible, usar solo polling
  }
}

function stopTracking() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (socket) {
    try {
      socket.disconnect();
    } catch (error) {
      // Ignore
    }
    socket = null;
  }
}

window.addEventListener("beforeunload", stopTracking);

// Comprobar estado al cargar si ya existe sesión
window.addEventListener("load", async () => {
  participantId = getCookie(PARTICIPANT_ID_COOKIE_NAME) || participantId;
  
  // Comprobar si las inscripciones están abiertas
  try {
    const configRes = await fetch("/api/config", { headers: { Accept: "application/json" } });
    if (configRes.ok) {
      // Config loaded
    }
  } catch (error) {
    // Ignore
  }

  // Comprobar estado de inscripción
  try {
    const statusRes = await fetch("/api/inscriptions/status", { headers: { Accept: "application/json" } });
    if (statusRes.ok) {
      const statusData = await statusRes.json();
      if (statusData.open === false) {
        setActiveState(stateClosed);
        if (lastSubmit) {
          showTracking(lastSubmit);
          startTracking();
        }
        return;
      }
    }
  } catch (error) {
    // Ignore, asumir abiertas
  }

  if (lastSubmit) {
    showTracking(lastSubmit);
    startTracking();
    announce("Recuperando el estado de tu invocación.");
  } else {
    setActiveState(stateForm);
    nameInput?.focus();
  }
});
