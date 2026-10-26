const waiting = document.querySelector("#waiting");
const reveal = document.querySelector("#reveal");
const person = document.querySelector("#person");
const phrase = document.querySelector("#phrase");
const countdown = document.querySelector("#countdown");
const queueLabel = document.querySelector("#queue");
let currentId = null;
let countdownTimer = null;

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

function showState(state) {
  queueLabel.textContent = state.waiting ? `En espera: ${state.waiting}` : "";

  if (!state.active) {
    currentId = null;
    clearInterval(countdownTimer);
    countdown.textContent = "";
    reveal.classList.add("hidden");
    waiting.classList.remove("hidden");
    return;
  }

  if (currentId !== state.active.id) {
    currentId = state.active.id;
    person.textContent = state.active.name;
    phrase.textContent = `«${state.active.phrase}»`;
    waiting.classList.add("hidden");
    reveal.classList.remove("hidden");
    reveal.classList.remove("revealAnim");
    void reveal.offsetWidth;
    reveal.classList.add("revealAnim");
  }

  const tick = () => {
    const remaining = Math.max(
      0,
      Math.ceil((state.active.startedAt + state.active.durationMs - Date.now()) / 1000)
    );
    countdown.textContent = `Siguiente aparición en ${remaining}s`;
  };

  clearInterval(countdownTimer);
  tick();
  countdownTimer = setInterval(tick, 250);
}

const socket = io();

socket.on("state", showState);
socket.on("connect_error", (error) => {
  if (error && error.message === "unauthorized") {
    window.location.replace("/login?next=%2Fscreen");
  }
});

setupQR();
