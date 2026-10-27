const path = require("path");

const NODE_ENV = process.env.NODE_ENV || "development";
const isProduction = NODE_ENV === "production";

function parseInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : fallback;
}

const PORT = parseInteger(process.env.PORT, 3000);
const DISPLAY_SECONDS = parseInteger(process.env.DISPLAY_SECONDS, 15);
const QUEUE_MAX_LENGTH = parseInteger(process.env.QUEUE_MAX_LENGTH, 100);
const SESSION_TTL_MINUTES = parseInteger(process.env.SESSION_TTL_MINUTES, 480);
const STORAGE_BACKUP_LIMIT = Math.min(
  Math.max(parseInteger(process.env.STORAGE_BACKUP_LIMIT, 5), 0),
  50
);
const STORAGE_FILE_NAME = process.env.STORAGE_FILE_NAME || "event-state.json";

const DEFAULT_DEV_ADMIN_PASSWORD = "dev-admin-password";
const DEFAULT_DEV_SESSION_SECRET = "dev-session-secret-change-me-not-for-production";

const usingDevPassword = !process.env.ADMIN_PASSWORD && !isProduction;
const usingDevSessionSecret = !process.env.SESSION_SECRET && !isProduction;

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || (isProduction ? "" : DEFAULT_DEV_ADMIN_PASSWORD);
const SESSION_SECRET = process.env.SESSION_SECRET || (isProduction ? "" : DEFAULT_DEV_SESSION_SECRET);

const SESSION_COOKIE_NAME = "halloween_sid";
const SESSION_TTL_MS = SESSION_TTL_MINUTES * 60 * 1000;

const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "").trim();
const TRUST_PROXY = process.env.TRUST_PROXY === "1" || process.env.TRUST_PROXY === "true";
const COOKIE_SECURE = process.env.COOKIE_SECURE === "1" || process.env.COOKIE_SECURE === "true";

// Submission protection
const SUBMIT_IP_WINDOW_MS = parseInteger(process.env.SUBMIT_IP_WINDOW_MS, 60000);
const SUBMIT_IP_MAX = parseInteger(process.env.SUBMIT_IP_MAX, 10);
const SUBMIT_PARTICIPANT_WINDOW_MS = parseInteger(process.env.SUBMIT_PARTICIPANT_WINDOW_MS, 60000);
const SUBMIT_PARTICIPANT_MAX = parseInteger(process.env.SUBMIT_PARTICIPANT_MAX, 2);
const SUBMIT_GLOBAL_WINDOW_MS = parseInteger(process.env.SUBMIT_GLOBAL_WINDOW_MS, 60000);
const SUBMIT_GLOBAL_MAX = parseInteger(process.env.SUBMIT_GLOBAL_MAX, 100);
const SUBMIT_DUPLICATE_TTL_MS = parseInteger(process.env.SUBMIT_DUPLICATE_TTL_MS, 10 * 60 * 1000);
const PARTICIPANT_COOKIE_NAME = process.env.PARTICIPANT_COOKIE_NAME || "halloween_pid";
const REQUIRE_APPROVAL = process.env.REQUIRE_APPROVAL === "1" || process.env.REQUIRE_APPROVAL === "true";
const INSCRIPTIONS_OPEN = process.env.INSCRIPTIONS_OPEN === "0" || process.env.INSCRIPTIONS_OPEN === "false" ? false : true;

const PUBLIC_DIR = path.join(__dirname, "..", "..", "public");
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, "..", "..", "data"));
const VIEWS_DIR = path.join(__dirname, "..", "views");
const JOIN_HTML = path.join(PUBLIC_DIR, "join.html");
const LOGIN_HTML = path.join(VIEWS_DIR, "login.html");
const SCREEN_HTML = path.join(VIEWS_DIR, "screen.html");
const ADMIN_HTML = path.join(VIEWS_DIR, "admin.html");

const WEAK_SECRETS = new Set([
  "change-me",
  "changeme",
  "change-me-please",
  "password",
  "password123",
  "admin",
  "admin123",
  "secret",
  "secret123",
  "session-secret",
  "dev-admin-password",
  "dev-session-secret-change-me",
  "dev-session-secret-change-me-not-for-production",
  "cambia-esta-contraseña",
  "cambia-esta-contrasena"
]);

function isBlank(value) {
  return typeof value !== "string" || value.trim().length === 0;
}

function assertValidConfig() {
  if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
    throw new Error("PORT no es válido. Usa un número entre 1 y 65535.");
  }
  if (!Number.isInteger(DISPLAY_SECONDS) || DISPLAY_SECONDS < 5 || DISPLAY_SECONDS > 120) {
    throw new Error("DISPLAY_SECONDS debe ser un número entre 5 y 120.");
  }
  if (!Number.isInteger(SESSION_TTL_MINUTES) || SESSION_TTL_MINUTES < 1 || SESSION_TTL_MINUTES > 1440) {
    throw new Error("SESSION_TTL_MINUTES debe ser un número entre 1 y 1440.");
  }
  if (isBlank(ADMIN_PASSWORD)) {
    throw new Error("ADMIN_PASSWORD es obligatorio. Define una contraseña larga y privada.");
  }
  if (ADMIN_PASSWORD.length > 256) {
    throw new Error("ADMIN_PASSWORD no puede superar los 256 caracteres.");
  }
  if (isBlank(SESSION_SECRET)) {
    throw new Error("SESSION_SECRET es obligatorio. Define un secreto aleatorio y privado.");
  }
  if (SESSION_SECRET.length < 32) {
    throw new Error("SESSION_SECRET debe tener al menos 32 caracteres.");
  }
  if (
    !STORAGE_FILE_NAME ||
    /[\\/]/.test(STORAGE_FILE_NAME) ||
    STORAGE_FILE_NAME === "." ||
    STORAGE_FILE_NAME === ".."
  ) {
    throw new Error("STORAGE_FILE_NAME debe ser un nombre de archivo simple.");
  }

  if (isProduction) {
    if (usingDevPassword || WEAK_SECRETS.has(ADMIN_PASSWORD.toLowerCase())) {
      throw new Error("ADMIN_PASSWORD no puede usar valores predeterminados o débiles en producción.");
    }
    if (ADMIN_PASSWORD.length < 16) {
      throw new Error("ADMIN_PASSWORD debe tener al menos 16 caracteres en producción.");
    }
    if (usingDevSessionSecret || WEAK_SECRETS.has(SESSION_SECRET.toLowerCase())) {
      throw new Error("SESSION_SECRET no puede usar valores predeterminados o débiles en producción.");
    }
  }
}

module.exports = {
  NODE_ENV,
  isProduction,
  PORT,
  DISPLAY_SECONDS,
  SESSION_TTL_MINUTES,
  SESSION_TTL_MS,
  SESSION_COOKIE_NAME,
  ADMIN_PASSWORD,
  SESSION_SECRET,
  PUBLIC_BASE_URL,
  TRUST_PROXY,
  COOKIE_SECURE,
  USING_DEV_PASSWORD: usingDevPassword,
  USING_DEV_SESSION_SECRET: usingDevSessionSecret,
  PUBLIC_DIR,
  VIEWS_DIR,
  DATA_DIR,
  STORAGE_FILE_NAME,
  STORAGE_BACKUP_LIMIT,
  JOIN_HTML,
  LOGIN_HTML,
  SCREEN_HTML,
  ADMIN_HTML,
  SUBMIT_IP_WINDOW_MS,
  SUBMIT_IP_MAX,
  SUBMIT_PARTICIPANT_WINDOW_MS,
  SUBMIT_PARTICIPANT_MAX,
  SUBMIT_GLOBAL_WINDOW_MS,
  SUBMIT_GLOBAL_MAX,
  SUBMIT_DUPLICATE_TTL_MS,
  PARTICIPANT_COOKIE_NAME,
  REQUIRE_APPROVAL,
  INSCRIPTIONS_OPEN,
  QUEUE_MAX_LENGTH,
  assertValidConfig
};
