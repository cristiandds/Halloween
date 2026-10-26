const form = document.querySelector("#login-form");
const passwordInput = document.querySelector("#password");
const submitButton = document.querySelector("#submit");
const message = document.querySelector("#message");

function safeNextPath() {
  const value = new URLSearchParams(window.location.search).get("next");
  return value === "/screen" || value === "/admin" ? value : "/admin";
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  submitButton.disabled = true;
  message.textContent = "Comprobando...";

  try {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      credentials: "same-origin",
      body: JSON.stringify({ password: passwordInput.value })
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      message.textContent = data.error || "No se pudo iniciar sesión.";
      passwordInput.value = "";
      passwordInput.focus();
      return;
    }

    window.location.replace(safeNextPath());
  } catch (error) {
    message.textContent = "No se pudo conectar con el servidor.";
  } finally {
    submitButton.disabled = false;
  }
});
