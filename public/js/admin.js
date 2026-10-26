const waiting = document.querySelector("#waiting");
const duration = document.querySelector("#duration");
const activeName = document.querySelector("#active-name");
const activePhrase = document.querySelector("#active-phrase");
const preview = document.querySelector("#preview");
const message = document.querySelector("#message");
const refreshButton = document.querySelector("#refresh");
const logoutButton = document.querySelector("#logout");

let csrfToken = "";
let refreshTimer = null;

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

function render(state) {
  waiting.textContent = String(state.waiting ?? 0);
  duration.textContent = `${state.displaySeconds ?? 0}s`;

  if (state.active) {
    activeName.textContent = state.active.name || "Nadie";
    activePhrase.textContent = state.active.phrase ? `«${state.active.phrase}»` : "";
  } else {
    activeName.textContent = "Nadie";
    activePhrase.textContent = "";
  }

  renderPreview(state.queuePreview);
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

async function refresh() {
  try {
    const session = await loadSession();
    if (!session) {
      return;
    }
    csrfToken = session.csrfToken;

    const response = await fetch("/api/admin/state", {
      headers: { "Accept": "application/json" },
      credentials: "same-origin"
    });
    if (response.status === 401) {
      redirectToLogin();
      return;
    }
    if (!response.ok) {
      throw new Error("No se pudo cargar el estado privado.");
    }

    render(await response.json());
    message.textContent = "";
  } catch (error) {
    message.textContent = error.message || "No se pudo actualizar el estado.";
  }
}

refreshButton.addEventListener("click", refresh);

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

refresh();
refreshTimer = setInterval(refresh, 5000);
window.addEventListener("beforeunload", () => clearInterval(refreshTimer));
