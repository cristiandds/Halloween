const waitingEl = document.querySelector("#waiting");
const revealEl = document.querySelector("#reveal");
const personEl = document.querySelector("#person");
const phraseEl = document.querySelector("#phrase");
const countdownEl = document.querySelector("#countdown");
const queueEl = document.querySelector("#queue");
const qrContainer = document.querySelector("#qr");
const qrFallback = document.querySelector("#qr-fallback");
const connectionEl = document.querySelector("#connection");

let currentId = null;
let countdownTimer = null;
let countdownBase = null;
let serverOffsetMs = 0;
let hasReceivedState = false;

function getNow() {
  return Date.now() + serverOffsetMs;
}

function setConnectionState(state) {
  if (!connectionEl) {
    return;
  }
  connectionEl.dataset.state = state;
  if (state === "connected") {
    connectionEl.textContent = "Conectado";
  } else if (state === "reconnecting") {
    connectionEl.textContent = "Reconectando...";
  } else if (state === "disconnected") {
    connectionEl.textContent = "Sin conexión";
  } else {
    connectionEl.textContent = "Conectando...";
  }
}

async function setupQR() {
  try {
    const [configRes, qrRes] = await Promise.all([
      fetch("/api/config", {
        headers: { Accept: "application/json" },
        credentials: "same-origin",
        cache: "no-store"
      }),
      fetch("/api/qr", {
        headers: { Accept: "application/json" },
        credentials: "same-origin",
        cache: "no-store"
      })
    ]);

    if (!configRes.ok || !qrRes.ok) {
      throw new Error("QR fetch failed");
    }

    const config = await configRes.json();
    const qrData = await qrRes.json();

    if (qrData && qrData.svg && qrContainer) {
      qrContainer.innerHTML = qrData.svg;
      const svgEl = qrContainer.querySelector("svg");
      if (svgEl) {
        svgEl.setAttribute("width", "300");
        svgEl.setAttribute("height", "300");
        svgEl.setAttribute("preserveAspectRatio", "xMidYMid meet");
        svgEl.style.width = "100%";
        svgEl.style.height = "auto";
        svgEl.style.display = "block";
        svgEl.style.margin = "0 auto";
        svgEl.style.background = "#ffffff";
      }
      if (qrFallback && qrData.joinUrl) {
        qrFallback.textContent = `URL: ${qrData.joinUrl}`;
      } else if (qrFallback && config && config.joinUrl) {
        qrFallback.textContent = `URL: ${config.joinUrl}`;
      }
      return;
    }

    if (qrFallback && config && config.joinUrl) {
      qrFallback.textContent = `URL: ${config.joinUrl}`;
    }
    if (qrContainer) {
      qrContainer.textContent = "No se pudo generar el código QR.";
    }
  } catch (error) {
    if (qrContainer) {
      qrContainer.textContent = "No se pudo cargar el QR.";
    }
    if (qrFallback) {
      qrFallback.textContent = "Verifica la configuración de PUBLIC_BASE_URL.";
    }
  }
}

function stopCountdown() {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
  countdownBase = null;
}

function startCountdown(remainingMs, paused) {
  stopCountdown();
  const total = Math.max(0, Number(remainingMs) || 0);
  const startedAt = getNow();
  countdownBase = { total, startedAt, paused: Boolean(paused) };

  const tick = () => {
    if (!countdownBase) {
      return;
    }
    if (countdownBase.paused) {
      const remainingSec = Math.max(0, Math.ceil(countdownBase.total / 1000));
      if (countdownEl) {
        countdownEl.textContent = `En pausa · ${remainingSec}s restantes`;
      }
      return;
    }
    const elapsed = getNow() - countdownBase.startedAt;
    const remainingSec = Math.max(0, Math.ceil((countdownBase.total - elapsed) / 1000));
    if (countdownEl) {
      countdownEl.textContent = `Siguiente aparición en ${remainingSec}s`;
    }
  };

  tick();
  if (!countdownBase.paused) {
    countdownTimer = setInterval(tick, 250);
  }
}

function showState(state) {
  hasReceivedState = true;
  setConnectionState("connected");

  if (typeof state.serverTime === "number") {
    serverOffsetMs = state.serverTime - Date.now();
  }

  if (queueEl) {
    if (state.waiting && state.waiting > 0) {
      const pending = state.pendingApproval ? ` · Por aprobar: ${state.pendingApproval}` : "";
      queueEl.textContent = `En espera: ${state.waiting}${pending}`;
    } else {
      queueEl.textContent = "";
    }
  }

  if (!state.active) {
    currentId = null;
    stopCountdown();
    if (countdownEl) {
      countdownEl.textContent = state.paused ? "En pausa" : "";
    }
    if (revealEl) {
      revealEl.classList.add("hidden");
      revealEl.classList.remove("revealAnim");
    }
    if (waitingEl) {
      waitingEl.classList.remove("hidden");
    }
    return;
  }

  if (currentId !== state.active.id) {
    currentId = state.active.id;
    if (personEl) {
      personEl.textContent = state.active.name || "";
    }
    if (phraseEl) {
      if (state.active.phrase && String(state.active.phrase).trim()) {
        phraseEl.textContent = `«${state.active.phrase}»`;
        phraseEl.style.display = "";
      } else {
        phraseEl.textContent = "";
        phraseEl.style.display = "none";
      }
    }
    if (waitingEl) {
      waitingEl.classList.add("hidden");
    }
    if (revealEl) {
      revealEl.classList.remove("hidden");
      revealEl.classList.remove("revealAnim");
      // Force reflow for animation restart
      void revealEl.offsetWidth;
      revealEl.classList.add("revealAnim");
    }
  }

  startCountdown(state.remainingMs, Boolean(state.paused));
}

const socket = io({
  transports: ["websocket", "polling"],
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 500,
  reconnectionDelayMax: 2000,
  timeout: 10000
});

setConnectionState("connecting");

socket.on("connect", () => {
  setConnectionState("connected");
  socket.emit("request:state");
});

socket.on("reconnect_attempt", () => {
  setConnectionState("reconnecting");
});

socket.on("reconnect", () => {
  setConnectionState("connected");
  socket.emit("request:state");
});

socket.on("disconnect", (reason) => {
  if (reason === "io server disconnect") {
    setConnectionState("disconnected");
  } else {
    setConnectionState("reconnecting");
  }
});

socket.on("connect_error", (error) => {
  setConnectionState("reconnecting");
  if (error && error.message === "unauthorized") {
    window.location.replace("/login?next=%2Fscreen");
  }
});

socket.on("error", () => {
  setConnectionState("reconnecting");
});

socket.on("state", showState);
socket.on("state:private", showState);

setupQR();
