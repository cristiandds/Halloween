const waiting = document.querySelector("#waiting");
const pendingApproval = document.querySelector("#pending-approval");
const duration = document.querySelector("#duration");
const remaining = document.querySelector("#remaining");
const mode = document.querySelector("#mode");
const activeName = document.querySelector("#active-name");
const activePhrase = document.querySelector("#active-phrase");
const preview = document.querySelector("#preview");
const approvalList = document.querySelector("#approval-list");
const message = document.querySelector("#message");
const refreshButton = document.querySelector("#refresh");
const logoutButton = document.querySelector("#logout");
const nextButton = document.querySelector("#next");
const pauseButton = document.querySelector("#pause");
const resumeButton = document.querySelector("#resume");
const skipButton = document.querySelector("#skip");
const finishButton = document.querySelector("#finish");

let csrfToken = "";
let refreshTimer = null;
let lastState = null;
let socket = null;

function redirectToLogin() {
  window.location.replace("/login?next=%2Fadmin");
}

function renderPreview(names) {
  preview.textContent = "";
  if (!Array.isArray(names) || names.length === 0) {
    const item = document.createElement("li");
    item.className = "empty";
    item.textContent = "Sin nombres en cola";
    preview.appendChild(item);
    return;
  }

  for (const name of names) {
    const item = document.createElement("li");
    item.textContent = String(name);
    preview.appendChild(item);
  }
}

function renderApproval(items) {
  approvalList.textContent = "";
  if (!Array.isArray(items) || items.length === 0) {
    const item = document.createElement("li");
    item.className = "empty";
    item.textContent = "Sin solicitudes pendientes";
    approvalList.appendChild(item);
    return;
  }

  for (const participant of items) {
    const item = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = String(participant.name);
    const actions = document.createElement("span");

    const approve = document.createElement("button");
    approve.type = "button";
    approve.textContent = "Aprobar";
    approve.dataset.action = "approve";
    approve.dataset.id = String(participant.id);

    const reject = document.createElement("button");
    reject.type = "button";
    reject.className = "reject";
    reject.textContent = "Rechazar";
    reject.dataset.action = "reject";
    reject.dataset.id = String(participant.id);

    actions.appendChild(approve);
    actions.appendChild(reject);
    item.appendChild(name);
    item.appendChild(actions);
    approvalList.appendChild(item);
  }
}

function render(state) {
  lastState = state;
  waiting.textContent = String(state.waiting ?? 0);
  pendingApproval.textContent = String(state.pendingApproval ?? 0);
  duration.textContent = `${state.displaySeconds ?? 0}s`;
  remaining.textContent =
    state.active && typeof state.remainingMs === "number"
      ? `${Math.ceil(state.remainingMs / 1000)}s`
      : "—";

  if (state.paused) {
    mode.textContent = "Pausa";
  } else if (state.active) {
    mode.textContent = "Activo";
  } else {
    mode.textContent = "QR";
  }

  if (state.active) {
    activeName.textContent = state.active.name || "Nadie";
    activePhrase.textContent = state.active.phrase ? `«${state.active.phrase}»` : "";
  } else {
    activeName.textContent = "Nadie";
    activePhrase.textContent = "";
  }

  renderPreview(state.queuePreview);
  renderApproval(state.pendingApprovalItems);

  pauseButton.disabled = Boolean(state.paused);
  resumeButton.disabled = !state.paused;
  skipButton.disabled = !state.active;
  finishButton.disabled = !state.active;
  nextButton.disabled = Boolean(state.active) || Boolean(state.paused);
}

async function loadSession() {
  const response = await fetch("/api/auth/session", {
    headers: { "Accept": "application/json" },
    credentials: "same-origin"
  });
  if (response.status === 401) {
    redirectToLogin();
    return null;
  }
  if (!response.ok) {
    throw new Error("No se pudo comprobar la sesión.");
  }
  return response.json();
}

async function loadState() {
  const response = await fetch("/api/admin/state", {
    headers: { "Accept": "application/json" },
    credentials: "same-origin"
  });
  if (response.status === 401) {
    redirectToLogin();
    return null;
  }
  if (!response.ok) {
    throw new Error("No se pudo cargar el estado privado.");
  }
  return response.json();
}

async function command(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfToken
    },
    credentials: "same-origin",
    body: JSON.stringify(body || {})
  });
  if (response.status === 401) {
    redirectToLogin();
    return null;
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "No se pudo completar la operación.");
  }
  if (payload.state) {
    render(payload.state);
  }
  return payload;
}

async function runCommand(path, body, successMessage) {
  try {
    message.textContent = "Procesando...";
    const result = await command(path, body);
    if (result) {
      message.textContent = successMessage || "Operación completada.";
    }
  } catch (error) {
    message.textContent = error.message || "No se pudo completar la operación.";
    await refresh();
  }
}

async function refresh() {
  try {
    if (!csrfToken) {
      const session = await loadSession();
      if (!session) {
        return;
      }
      csrfToken = session.csrfToken;
    }
    const snapshot = await loadState();
    if (snapshot) {
      render(snapshot);
      message.textContent = "";
    }
  } catch (error) {
    message.textContent = error.message || "No se pudo actualizar el estado.";
  }
}

function connectSocket() {
  if (socket) {
    socket.close();
  }
  socket = io();

  socket.on("state", (snapshot) => {
    render(snapshot);
  });

  socket.on("connect_error", (error) => {
    if (error && error.message === "unauthorized") {
      redirectToLogin();
    }
  });
}

refreshButton.addEventListener("click", refresh);
nextButton.addEventListener("click", () => runCommand("/api/admin/queue/next", {}, "Siguiente participante iniciado."));
pauseButton.addEventListener("click", () => runCommand("/api/admin/queue/pause", {}, "Cola pausada."));
resumeButton.addEventListener("click", () => runCommand("/api/admin/queue/resume", {}, "Cola reanudada."));
skipButton.addEventListener("click", () =>
  runCommand("/api/admin/queue/skip", lastState?.active ? { id: lastState.active.id } : {}, "Participante saltado.")
);
finishButton.addEventListener("click", () =>
  runCommand("/api/admin/queue/finish", lastState?.active ? { id: lastState.active.id } : {}, "Participante finalizado.")
);

approvalList.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) {
    return;
  }
  const id = Number.parseInt(button.dataset.id, 10);
  if (!Number.isInteger(id)) {
    return;
  }
  const action = button.dataset.action;
  button.disabled = true;
  try {
    if (action === "approve") {
      await runCommand("/api/admin/queue/approve", { id }, "Solicitud aprobada.");
    } else if (action === "reject") {
      await runCommand("/api/admin/queue/reject", { id }, "Solicitud rechazada.");
    }
  } finally {
    button.disabled = false;
  }
});

logoutButton.addEventListener("click", async () => {
  logoutButton.disabled = true;
  try {
    const response = await fetch("/api/auth/logout", {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "X-CSRF-Token": csrfToken
      },
      credentials: "same-origin"
    });
    if (!response.ok) {
      throw new Error("No se pudo cerrar la sesión.");
    }
    window.location.replace("/login");
  } catch (error) {
    message.textContent = error.message;
    logoutButton.disabled = false;
  }
});

async function start() {
  try {
    const session = await loadSession();
    if (!session) {
      return;
    }
    csrfToken = session.csrfToken;
    const snapshot = await loadState();
    if (snapshot) {
      render(snapshot);
    }
    connectSocket();
    refreshTimer = setInterval(refresh, 15000);
  } catch (error) {
    message.textContent = error.message || "No se pudo iniciar el panel.";
  }
}

window.addEventListener("beforeunload", () => {
  clearInterval(refreshTimer);
  if (socket) {
    socket.close();
  }
});

start();
