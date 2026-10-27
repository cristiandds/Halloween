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
const openInscriptionsBtn = document.querySelector("#open-inscriptions");
const closeInscriptionsBtn = document.querySelector("#close-inscriptions");
const reorderBtn = document.querySelector("#reorder-btn");
const reorderInput = document.querySelector("#reorder-input");
const totalParticipants = document.querySelector("#total-participants");
const activeNow = document.querySelector("#active-now");
const connectionEl = document.querySelector("#connection");
const inscriptionsEl = document.querySelector("#inscriptions");
const participantsTbody = document.querySelector("#participants-tbody");
const configForm = document.querySelector("#config-form");
const eventNameInput = document.querySelector("#eventName");
const displaySecondsInput = document.querySelector("#displaySeconds");
const queueMaxLengthInput = document.querySelector("#queueMaxLength");
const moderationEnabledInput = document.querySelector("#moderationEnabled");
const phrasesList = document.querySelector("#phrases-list");
const addPhraseBtn = document.querySelector("#add-phrase");
const configMessage = document.querySelector("#config-message");

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

function formatDate(ts) {
  if (!ts) return "—";
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleString();
  } catch (e) {
    return "—";
  }
}

function renderParticipants(state) {
  if (!participantsTbody) return;
  participantsTbody.textContent = "";
  const participants = Array.isArray(state.participants) ? state.participants : [];
  if (participants.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 6;
    td.className = "empty";
    td.textContent = "Sin participantes";
    tr.appendChild(td);
    participantsTbody.appendChild(tr);
    if (totalParticipants) totalParticipants.textContent = "0";
    return;
  }
  if (totalParticipants) totalParticipants.textContent = String(participants.length);

  for (const p of participants) {
    const tr = document.createElement("tr");
    const idTd = document.createElement("td");
    idTd.textContent = String(p.id);
    const nameTd = document.createElement("td");
    nameTd.textContent = String(p.name || "");
    const stateTd = document.createElement("td");
    stateTd.textContent = String(p.state || "—");
    const dateTd = document.createElement("td");
    dateTd.textContent = formatDate(p.registeredAt || p.submittedAt);
    const posTd = document.createElement("td");
    if (state.active && state.active.id === p.id) {
      posTd.textContent = "En pantalla";
    } else if (Array.isArray(state.queueItems)) {
      const idx = state.queueItems.findIndex(q => q.id === p.id);
      posTd.textContent = idx >= 0 ? String(idx + 1) : "—";
    } else {
      posTd.textContent = "—";
    }
    const actionsTd = document.createElement("td");
    actionsTd.className = "actions-cell";

    const approve = document.createElement("button");
    approve.type = "button";
    approve.textContent = "Aprobar";
    approve.dataset.action = "approve";
    approve.dataset.id = String(p.id);

    const reject = document.createElement("button");
    reject.type = "button";
    reject.className = "reject";
    reject.textContent = "Rechazar";
    reject.dataset.action = "reject";
    reject.dataset.id = String(p.id);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "reject";
    remove.textContent = "Eliminar";
    remove.dataset.action = "remove";
    remove.dataset.id = String(p.id);

    if (p.state === "pending_approval") {
      actionsTd.appendChild(approve);
    }
    actionsTd.appendChild(reject);
    actionsTd.appendChild(remove);
    tr.appendChild(idTd);
    tr.appendChild(nameTd);
    tr.appendChild(stateTd);
    tr.appendChild(dateTd);
    tr.appendChild(posTd);
    tr.appendChild(actionsTd);
    participantsTbody.appendChild(tr);
  }
}

function renderPhrases(phrases) {
  if (!phrasesList) return;
  phrasesList.innerHTML = "";
  const list = Array.isArray(phrases) ? phrases : [];
  if (list.length === 0) {
    const row = document.createElement("div");
    row.className = "phrase-row";
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Escribe una frase de terror";
    input.dataset.phrase = "";
    row.appendChild(input);
    phrasesList.appendChild(row);
    return;
  }
  for (const p of list) {
    const row = document.createElement("div");
    row.className = "phrase-row";
    const input = document.createElement("input");
    input.type = "text";
    input.value = String(p);
    input.placeholder = "Escribe una frase de terror";
    const del = document.createElement("button");
    del.type = "button";
    del.className = "secondary";
    del.textContent = "Eliminar";
    del.addEventListener("click", () => {
      if (phrasesList.querySelectorAll(".phrase-row").length <= 1) {
        if (configMessage) configMessage.textContent = "Debe haber al menos una frase.";
        return;
      }
      row.remove();
      if (phrasesList) phrasesList.dataset.dirty = "true";
    });
    input.addEventListener("input", () => {
      if (phrasesList) phrasesList.dataset.dirty = "true";
    });
    row.appendChild(input);
    row.appendChild(del);
    phrasesList.appendChild(row);
  }
}

function collectPhrases() {
  if (!phrasesList) return [];
  const inputs = phrasesList.querySelectorAll("input");
  const result = [];
  for (const input of inputs) {
    const val = input.value || "";
    const trimmed = val.trim();
    if (trimmed.length > 0) {
      result.push(trimmed);
    }
  }
  return result;
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

  if (state.eventConfig) {
    if (eventNameInput && document.activeElement !== eventNameInput && phrasesList && !phrasesList.dataset.dirty) {
      eventNameInput.value = state.eventConfig.eventName || "";
    }
    if (displaySecondsInput && document.activeElement !== displaySecondsInput) {
      displaySecondsInput.value = state.eventConfig.displaySeconds ?? "";
    }
    if (queueMaxLengthInput && document.activeElement !== queueMaxLengthInput) {
      queueMaxLengthInput.value = state.eventConfig.queueMaxLength ?? "";
    }
    if (moderationEnabledInput) {
      moderationEnabledInput.checked = state.eventConfig.moderationEnabled === true;
    }
    if (phrasesList && !phrasesList.dataset.dirty) {
      renderPhrases(state.eventConfig.phrases || []);
    }
  }

  if (state.paused) {
    mode.textContent = "PAUSA";
  } else if (state.active) {
    mode.textContent = "ACTIVO";
  } else {
    mode.textContent = "ESPERA/QR";
  }

  if (activeNow) {
    activeNow.textContent = state.active && state.active.name ? state.active.name : "NADIE";
  }
  if (connectionEl) {
    connectionEl.textContent = socket && socket.connected ? "CONECTADO" : "DESCONECTADO";
  }
  if (inscriptionsEl) {
    const ins = state.inscriptions || { open: true };
    inscriptionsEl.textContent = ins.open !== false ? "ABIERTAS" : "CERRADAS";
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
  renderParticipants(state);

  if (pauseButton) pauseButton.disabled = Boolean(state.paused);
  if (resumeButton) resumeButton.disabled = !state.paused;
  if (skipButton) skipButton.disabled = !state.active;
  if (finishButton) finishButton.disabled = !state.active;
  if (nextButton) nextButton.disabled = Boolean(state.active) || Boolean(state.paused);
}

if (addPhraseBtn) {
  addPhraseBtn.addEventListener("click", () => {
    if (!phrasesList) return;
    phrasesList.dataset.dirty = "true";
    const row = document.createElement("div");
    row.className = "phrase-row";
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Escribe una frase de terror";
    const del = document.createElement("button");
    del.type = "button";
    del.className = "secondary";
    del.textContent = "Eliminar";
    del.addEventListener("click", () => {
      if (phrasesList.querySelectorAll(".phrase-row").length <= 1) {
        if (configMessage) configMessage.textContent = "Debe haber al menos una frase.";
        return;
      }
      row.remove();
      if (phrasesList) phrasesList.dataset.dirty = "true";
    });
    input.addEventListener("input", () => {
      if (phrasesList) phrasesList.dataset.dirty = "true";
    });
    row.appendChild(input);
    row.appendChild(del);
    phrasesList.appendChild(row);
    input.focus();
  });
}

if (configForm) {
  configForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!csrfToken) {
      if (configMessage) configMessage.textContent = "No hay token de sesión.";
      return;
    }
    const eventName = eventNameInput ? eventNameInput.value : "";
    const displaySeconds = displaySecondsInput ? Number(displaySecondsInput.value) : NaN;
    const queueMaxLength = queueMaxLengthInput ? Number(queueMaxLengthInput.value) : NaN;
    const moderationEnabled = moderationEnabledInput ? moderationEnabledInput.checked : false;
    const phrases = collectPhrases();
    if (eventName.trim().length === 0) {
      if (configMessage) configMessage.textContent = "El nombre del evento es obligatorio.";
      return;
    }
    if (!Number.isInteger(displaySeconds) || displaySeconds < 5 || displaySeconds > 60) {
      if (configMessage) configMessage.textContent = "La duración debe estar entre 5 y 60 segundos.";
      return;
    }
    if (!Number.isInteger(queueMaxLength) || queueMaxLength < 1 || queueMaxLength > 1000) {
      if (configMessage) configMessage.textContent = "La cantidad máxima en cola debe ser válida.";
      return;
    }
    if (phrases.length === 0) {
      if (configMessage) configMessage.textContent = "Debe haber al menos una frase de terror.";
      return;
    }
    const saveBtn = document.querySelector("#save-config");
    if (saveBtn) saveBtn.disabled = true;
    if (configMessage) configMessage.textContent = "Guardando...";
    try {
      const payload = {
        eventName: eventName.trim(),
        displaySeconds,
        queueMaxLength,
        moderationEnabled,
        phrases
      };
      const response = await fetch("/api/admin/config", {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken
        },
        credentials: "same-origin",
        body: JSON.stringify(payload)
      });
      if (response.status === 401) {
        redirectToLogin();
        return;
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "No se pudo guardar la configuración.");
      }
      if (phrasesList) phrasesList.dataset.dirty = "";
      if (configMessage) {
        configMessage.textContent = "Configuración guardada correctamente.";
        setTimeout(() => {
          if (configMessage.textContent === "Configuración guardada correctamente.") {
            configMessage.textContent = "";
          }
        }, 2000);
      }
      if (data.state) {
        render(data.state);
      } else {
        await refresh();
      }
    } catch (error) {
      if (configMessage) configMessage.textContent = error.message || "No se pudo guardar la configuración.";
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  });
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
    if (connectionEl) connectionEl.textContent = "CONECTADO";
  });
  socket.on("state:private", (snapshot) => {
    render(snapshot);
    if (connectionEl) connectionEl.textContent = "CONECTADO";
  });

  socket.on("connect_error", (error) => {
    if (connectionEl) connectionEl.textContent = "ERROR";
    if (error && error.message === "unauthorized") {
      redirectToLogin();
    }
  });
  socket.on("disconnect", () => {
    if (connectionEl) connectionEl.textContent = "DESCONECTADO";
  });
  socket.on("connect", () => {
    if (connectionEl) connectionEl.textContent = "CONECTADO";
  });
}

if (refreshButton) refreshButton.addEventListener("click", refresh);
if (nextButton) nextButton.addEventListener("click", () => runCommand("/api/admin/queue/next", {}, "Siguiente participante iniciado."));
if (pauseButton) pauseButton.addEventListener("click", () => runCommand("/api/admin/queue/pause", {}, "Proyección pausada."));
if (resumeButton) resumeButton.addEventListener("click", () => runCommand("/api/admin/queue/resume", {}, "Proyección reanudada."));
if (skipButton) skipButton.addEventListener("click", () => {
  if (!confirm("¿Saltar al participante actual?")) return;
  runCommand("/api/admin/queue/skip", lastState?.active ? { id: lastState.active.id } : {}, "Participante saltado.");
});
if (finishButton) finishButton.addEventListener("click", () => {
  if (!confirm("¿Finalizar al participante actual?")) return;
  runCommand("/api/admin/queue/finish", lastState?.active ? { id: lastState.active.id } : {}, "Participante finalizado.");
});
if (openInscriptionsBtn) openInscriptionsBtn.addEventListener("click", () => runCommand("/api/admin/inscriptions/open", {}, "Inscripciones abiertas."));
if (closeInscriptionsBtn) closeInscriptionsBtn.addEventListener("click", () => {
  if (!confirm("¿Cerrar las inscripciones?")) return;
  runCommand("/api/admin/inscriptions/close", {}, "Inscripciones cerradas.");
});
if (reorderBtn) reorderBtn.addEventListener("click", () => {
  const val = reorderInput ? reorderInput.value : "";
  const ids = val.split(",").map(x => x.trim()).filter(Boolean).map(x => Number.parseInt(x, 10)).filter(Number.isInteger);
  if (ids.length === 0) {
    message.textContent = "Introduce IDs válidos separados por coma.";
    return;
  }
  runCommand("/api/admin/queue/reorder", { order: ids }, "Cola reordenada.");
});

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
      if (!confirm("¿Rechazar esta solicitud?")) {
        button.disabled = false;
        return;
      }
      await runCommand("/api/admin/queue/reject", { id }, "Solicitud rechazada.");
    }
  } finally {
    button.disabled = false;
  }
});

if (participantsTbody) {
  participantsTbody.addEventListener("click", async (event) => {
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
        await runCommand("/api/admin/queue/approve", { id }, "Participante aprobado.");
      } else if (action === "reject") {
        if (!confirm("¿Rechazar este participante?")) {
          button.disabled = false;
          return;
        }
        await runCommand("/api/admin/queue/reject", { id }, "Participante rechazado.");
      } else if (action === "remove") {
        if (!confirm("¿Eliminar este participante? Esta acción es destructiva.")) {
          button.disabled = false;
          return;
        }
        await runCommand("/api/admin/queue/remove", { id }, "Participante eliminado.");
      }
    } finally {
      button.disabled = false;
    }
  });
}

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
