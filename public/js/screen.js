const waiting = document.querySelector("#waiting");
const reveal = document.querySelector("#reveal");
const person = document.querySelector("#person");
const phrase = document.querySelector("#phrase");
const countdown = document.querySelector("#countdown");
const queueLabel = document.querySelector("#queue");
const qrContainer = document.querySelector("#qr");
const qrFallback = document.querySelector("#qr-fallback");
let currentId = null;
let countdownTimer = null;
let countdownBase = null;

async function setupQR() {
  try {
    const [configRes, qrRes] = await Promise.all([
      fetch("/api/config", {
        headers: { "Accept": "application/json" },
        credentials: "same-origin"
      }),
      fetch("/api/qr", {
        headers: { "Accept": "application/json" },
        credentials: "same-origin"
      })
    ]);

    const config = await configRes.json();
    const qrData = await qrRes.json();

    if (qrData && qrData.svg) {
      qrContainer.innerHTML = qrData.svg;
      // Ensure proper styling
      const svgEl = qrContainer.querySelector("svg");
      if (svgEl) {
        svgEl.setAttribute("width", "300");
        svgEl.setAttribute("height", "300");
        svgEl.style.maxWidth = "100%";
        svgEl.style.height = "auto";
        svgEl.style.display = "block";
        svgEl.style.margin = "0 auto";
        svgEl.style.background = "#ffffff";
      }
      if (qrFallback && qrData.joinUrl) {
        qrFallback.textContent = `URL: ${qrData.joinUrl}`;
      }
      return;
    }

    // Fallback to config URL if svg not available
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
  clearInterval(countdownTimer);
  countdownTimer = null;
  countdownBase = null;
}

function startCountdown(remainingMs, paused) {
  stopCountdown();
  const total = Math.max(0, Number(remainingMs) || 0);
  const startedAt = Date.now();
  countdownBase = { total, startedAt, paused };

  const tick = () => {
    if (!countdownBase) {
      return;
    }
    const elapsed = countdownBase.paused ? 0 : Date.now() - countdownBase.startedAt;
    const remaining = Math.max(0, Math.ceil((countdownBase.total - elapsed) / 1000));
    countdown.textContent = countdownBase.paused
      ? `En pausa · ${remaining}s restantes`
      : `Siguiente aparición en ${remaining}s`;
  };

  tick();
  if (!paused) {
    countdownTimer = setInterval(tick, 250);
  }
}

function showState(state) {
  queueLabel.textContent = state.waiting
    ? `En espera: ${state.waiting}${state.pendingApproval ? ` · Por aprobar: ${state.pendingApproval}` : ""}`
    : "";

  if (!state.active) {
    currentId = null;
    stopCountdown();
    countdown.textContent = state.paused ? "En pausa" : "";
    reveal.classList.add("hidden");
    waiting.classList.remove("hidden");
    return;
  }

  if (currentId !== state.active.id) {
    currentId = state.active.id;
    person.textContent = state.active.name;
    phrase.textContent = state.active.phrase ? `«${state.active.phrase}»` : "";
    waiting.classList.add("hidden");
    reveal.classList.remove("hidden");
    reveal.classList.remove("revealAnim");
    void reveal.offsetWidth;
    reveal.classList.add("revealAnim");
  }

  // El servidor envía el tiempo restante autoritativo. El navegador solo
  // representa la cuenta atrás; nunca decide cuándo termina la aparición.
  startCountdown(state.remainingMs, Boolean(state.paused));
}

const socket = io();

socket.on("state", showState);
socket.on("connect_error", (error) => {
  if (error && error.message === "unauthorized") {
    window.location.replace("/login?next=%2Fscreen");
  }
});

setupQR();
