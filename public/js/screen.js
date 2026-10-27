const waiting = document.querySelector("#waiting");
const reveal = document.querySelector("#reveal");
const person = document.querySelector("#person");
const phrase = document.querySelector("#phrase");
const countdown = document.querySelector("#countdown");
const queueLabel = document.querySelector("#queue");
let currentId = null;
let countdownTimer = null;
let countdownBase = null;

async function setupQR() {
  try {
    const response = await fetch("/api/config", {
      headers: { "Accept": "application/json" },
      credentials: "same-origin"
    });
    const config = await response.json();
    if (window.QRCode) {
      new QRCode(document.querySelector("#qr"), {
        text: config.joinUrl,
        width: 300,
        height: 300,
        colorDark: "#000000",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.M
      });
    } else {
      document.querySelector("#qr").textContent = "No se pudo cargar el generador QR. Revisa la conexión a internet.";
    }
  } catch (error) {
    document.querySelector("#qr").textContent = "No se pudo cargar el QR.";
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
