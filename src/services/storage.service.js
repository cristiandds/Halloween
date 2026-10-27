"use strict";

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");

const SCHEMA_VERSION = 1;
const DEFAULT_FILE_NAME = "event-state.json";
const DEFAULT_BACKUP_LIMIT = 5;

class StorageError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "StorageError";
  }
}

class StorageCorruptionError extends StorageError {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "StorageCorruptionError";
    this.code = "STORAGE_CORRUPT";
  }
}

class StorageWriteError extends StorageError {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "StorageWriteError";
    this.code = "STORAGE_WRITE_FAILED";
  }
}

class StorageRecoveryError extends StorageError {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "StorageRecoveryError";
    this.code = "STORAGE_RECOVERY_FAILED";
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertPlainObject(value, label) {
  if (!isPlainObject(value)) {
    throw new StorageError(`El estado persistido no es válido: ${label}.`);
  }
}

function toIso(now) {
  return new Date(now).toISOString();
}

function toEpoch(value, label, { nullable = false } = {}) {
  if (nullable && (value === null || value === undefined)) {
    return null;
  }
  const parsed = typeof value === "number" ? value : Date.parse(String(value));
  if (!Number.isFinite(parsed)) {
    throw new StorageError(`El estado persistido no es válido: ${label}.`);
  }
  return parsed;
}

function toPositiveInteger(value, label, fallback) {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (!Number.isInteger(value) || value < 1) {
    throw new StorageError(`El estado persistido no es válido: ${label}.`);
  }
  return value;
}

function normalizeParticipant(raw, label) {
  assertPlainObject(raw, label);
  const id = toPositiveInteger(raw.id, `${label}.id`);
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) {
    throw new StorageError(`El estado persistido no es válido: ${label}.name.`);
  }
  return {
    id,
    name,
    phrase: typeof raw.phrase === "string" ? raw.phrase : null,
    submittedAt: toEpoch(raw.submittedAt, `${label}.submittedAt`, { nullable: true })
  };
}

function normalizeFinishedParticipant(raw, label) {
  assertPlainObject(raw, label);
  const id = toPositiveInteger(raw.id, `${label}.id`);
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) {
    throw new StorageError(`El estado persistido no es válido: ${label}.name.`);
  }
  return {
    id,
    name,
    phrase: typeof raw.phrase === "string" ? raw.phrase : null,
    startedAt: toEpoch(raw.startedAt, `${label}.startedAt`, { nullable: true }),
    finishedAt: toEpoch(raw.finishedAt, `${label}.finishedAt`, { nullable: true }),
    durationMs: toPositiveInteger(raw.durationMs, `${label}.durationMs`, null)
  };
}

function normalizeActiveParticipant(raw, label) {
  assertPlainObject(raw, label);
  const id = toPositiveInteger(raw.id, `${label}.id`);
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) {
    throw new StorageError(`El estado persistido no es válido: ${label}.name.`);
  }
  const startedAt = toEpoch(raw.startedAt, `${label}.startedAt`);
  const durationMs = toPositiveInteger(raw.durationMs, `${label}.durationMs`);
  const endsAt = toEpoch(raw.endsAt, `${label}.endsAt`, { nullable: true });
  return {
    id,
    name,
    phrase: typeof raw.phrase === "string" ? raw.phrase : null,
    startedAt,
    durationMs,
    endsAt: endsAt === null ? null : endsAt,
    remainingMs: toEpoch(raw.remainingMs, `${label}.remainingMs`, { nullable: true })
  };
}

function dedupeById(participants) {
  const seen = new Set();
  const result = [];
  for (const participant of participants) {
    if (seen.has(participant.id)) {
      continue;
    }
    seen.add(participant.id);
    result.push(participant);
  }
  return result;
}

function migrateState(raw) {
  assertPlainObject(raw, "raíz");
  const version = raw.schemaVersion;
  if (!Number.isInteger(version)) {
    throw new StorageError("El estado persistido no incluye una versión de esquema válida.");
  }
  if (version > SCHEMA_VERSION) {
    throw new StorageError(
      `La versión del estado (${version}) es más reciente que la soportada (${SCHEMA_VERSION}).`
    );
  }
  if (version < 1) {
    throw new StorageError(`La versión del estado (${version}) no es válida.`);
  }

  // Punto de extensión para futuras migraciones. Cada versión nueva debe
  // transformar explícitamente el estado anterior antes de devolverlo.
  switch (version) {
    case 1:
      return raw;
    default:
      throw new StorageError(`No existe una migración para la versión ${version}.`);
  }
}

function createInitialState({ displaySeconds = 15, queueMaxLength = 100, now = Date.now() } = {}) {
  const timestamp = toIso(now);
  return {
    schemaVersion: SCHEMA_VERSION,
    nextId: 1,
    pendingParticipants: [],
    activeParticipant: null,
    finishedParticipants: [],
    moderationPendingParticipants: [],
    pauseState: {
      paused: false,
      pausedAt: null,
      resumedAt: null,
      remainingMs: null
    },
    timers: {
      projectionStartedAt: null,
      projectionEndsAt: null,
      lastTickAt: null,
      lastFinishedAt: null
    },
    eventConfig: {
      displaySeconds,
      queueMaxLength,
      updatedAt: timestamp
    },
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function normalizeState(raw, { displaySeconds = 15, queueMaxLength = 100, now = Date.now() } = {}) {
  const migrated = migrateState(raw);

  if (migrated.pendingParticipants !== undefined && !Array.isArray(migrated.pendingParticipants)) {
    throw new StorageError("El estado persistido no es válido: pendingParticipants.");
  }
  if (migrated.finishedParticipants !== undefined && !Array.isArray(migrated.finishedParticipants)) {
    throw new StorageError("El estado persistido no es válido: finishedParticipants.");
  }
  if (migrated.moderationPendingParticipants !== undefined && !Array.isArray(migrated.moderationPendingParticipants)) {
    throw new StorageError("El estado persistido no es válido: moderationPendingParticipants.");
  }

  const finishedParticipants = dedupeById(
    (migrated.finishedParticipants || []).map((item, index) =>
      normalizeFinishedParticipant(item, `finishedParticipants[${index}]`)
    )
  );
  const finishedIds = new Set(finishedParticipants.map((participant) => participant.id));

  const pendingParticipants = dedupeById(
    (migrated.pendingParticipants || [])
      .map((item, index) => normalizeParticipant(item, `pendingParticipants[${index}]`))
      .filter((participant) => !finishedIds.has(participant.id))
  );
  const pendingIds = new Set(pendingParticipants.map((participant) => participant.id));

  let moderationPendingParticipants = dedupeById(
    (migrated.moderationPendingParticipants || [])
      .map((item, index) =>
        normalizeParticipant(item, `moderationPendingParticipants[${index}]`)
      )
      .filter((participant) => !finishedIds.has(participant.id) && !pendingIds.has(participant.id))
  );

  let activeParticipant = null;
  if (migrated.activeParticipant !== undefined && migrated.activeParticipant !== null) {
    activeParticipant = normalizeActiveParticipant(migrated.activeParticipant, "activeParticipant");
    if (finishedIds.has(activeParticipant.id)) {
      activeParticipant = null;
    } else {
      const activeIndex = pendingParticipants.findIndex(
        (participant) => participant.id === activeParticipant.id
      );
      if (activeIndex >= 0) {
        pendingParticipants.splice(activeIndex, 1);
      }
      moderationPendingParticipants = moderationPendingParticipants.filter(
        (participant) => participant.id !== activeParticipant.id
      );
    }
  }

  let nextId = toPositiveInteger(migrated.nextId, "nextId", 1);
  const usedIds = [
    ...pendingParticipants.map((participant) => participant.id),
    ...finishedParticipants.map((participant) => participant.id),
    ...moderationPendingParticipants.map((participant) => participant.id),
    ...(activeParticipant ? [activeParticipant.id] : [])
  ];
  if (usedIds.length > 0) {
    nextId = Math.max(nextId, Math.max(...usedIds) + 1);
  }

  const pauseSource = isPlainObject(migrated.pauseState) ? migrated.pauseState : {};
  const pauseState = {
    paused: pauseSource.paused === true,
    pausedAt: toEpoch(pauseSource.pausedAt, "pauseState.pausedAt", { nullable: true }),
    resumedAt: toEpoch(pauseSource.resumedAt, "pauseState.resumedAt", { nullable: true }),
    remainingMs: toEpoch(pauseSource.remainingMs, "pauseState.remainingMs", { nullable: true })
  };

  const timerSource = isPlainObject(migrated.timers) ? migrated.timers : {};
  const timers = {
    projectionStartedAt: toEpoch(timerSource.projectionStartedAt, "timers.projectionStartedAt", {
      nullable: true
    }),
    projectionEndsAt: toEpoch(timerSource.projectionEndsAt, "timers.projectionEndsAt", {
      nullable: true
    }),
    lastTickAt: toEpoch(timerSource.lastTickAt, "timers.lastTickAt", { nullable: true }),
    lastFinishedAt: toEpoch(timerSource.lastFinishedAt, "timers.lastFinishedAt", {
      nullable: true
    })
  };

  const configSource = isPlainObject(migrated.eventConfig) ? migrated.eventConfig : {};
  const eventConfig = {
    displaySeconds: toPositiveInteger(configSource.displaySeconds, "eventConfig.displaySeconds", displaySeconds),
    queueMaxLength: toPositiveInteger(
      configSource.queueMaxLength,
      "eventConfig.queueMaxLength",
      queueMaxLength
    ),
    updatedAt:
      typeof configSource.updatedAt === "string" && configSource.updatedAt
        ? configSource.updatedAt
        : toIso(now)
  };

  const createdAt =
    typeof migrated.createdAt === "string" && migrated.createdAt ? migrated.createdAt : toIso(now);
  const updatedAt =
    typeof migrated.updatedAt === "string" && migrated.updatedAt ? migrated.updatedAt : toIso(now);

  return {
    schemaVersion: SCHEMA_VERSION,
    nextId,
    pendingParticipants,
    activeParticipant,
    finishedParticipants,
    moderationPendingParticipants,
    pauseState,
    timers,
    eventConfig,
    createdAt,
    updatedAt
  };
}

function parseStateText(text, options = {}) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new StorageCorruptionError("El archivo de estado no contiene JSON válido.", {
      cause: error
    });
  }
  return normalizeState(raw, options);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createStorageService({
  dataDir,
  fileName = DEFAULT_FILE_NAME,
  maxBackups = DEFAULT_BACKUP_LIMIT,
  displaySeconds = 15,
  queueMaxLength = 100,
  logger = console,
  now = Date.now
} = {}) {
  if (typeof dataDir !== "string" || dataDir.trim().length === 0) {
    throw new StorageError("DATA_DIR es obligatorio para la persistencia.");
  }
  if (
    typeof fileName !== "string" ||
    fileName.length === 0 ||
    /[\\/]/.test(fileName) ||
    fileName === "." ||
    fileName === ".."
  ) {
    throw new StorageError("STORAGE_FILE_NAME debe ser un nombre de archivo simple.");
  }

  const resolvedDataDir = path.resolve(dataDir);
  const filePath = path.join(resolvedDataDir, fileName);
  const backupPrefix = `${fileName}.backup-`;
  const safeLogger = logger && typeof logger.error === "function" ? logger : console;
  const backupLimit = Number.isInteger(maxBackups) && maxBackups >= 0 ? maxBackups : DEFAULT_BACKUP_LIMIT;

  let state = null;
  let initialized = false;
  let corrupted = false;
  let lastError = null;
  let writeChain = Promise.resolve();
  let sequence = 0;

  function normalizeOptions() {
    return {
      displaySeconds,
      queueMaxLength,
      now: now()
    };
  }

  function ensureReady() {
    if (corrupted) {
      const error = new StorageCorruptionError(
        "El archivo de estado está corrupto. No se sobrescribirá automáticamente. " +
          "Usa la recuperación de respaldo antes de continuar."
      );
      error.cause = lastError;
      throw error;
    }
    if (!initialized || !state) {
      throw new StorageError("El servicio de almacenamiento no ha sido inicializado.");
    }
  }

  function backupFilesSync() {
    if (!fs.existsSync(resolvedDataDir)) {
      return [];
    }
    return fs
      .readdirSync(resolvedDataDir)
      .filter((name) => name.startsWith(backupPrefix) && name.endsWith(".json"))
      .sort()
      .reverse();
  }

  async function backupFiles() {
    try {
      const entries = await fsp.readdir(resolvedDataDir);
      return entries
        .filter((name) => name.startsWith(backupPrefix) && name.endsWith(".json"))
        .sort()
        .reverse();
    } catch (error) {
      if (error.code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  function backupName() {
    const stamp = toIso(now()).replace(/[:.]/g, "-");
    sequence += 1;
    return path.join(
      resolvedDataDir,
      `${backupPrefix}${stamp}-${process.pid}-${String(sequence).padStart(6, "0")}.json`
    );
  }

  function pruneBackupsSync() {
    if (backupLimit === 0) {
      return;
    }
    const files = backupFilesSync();
    for (const name of files.slice(backupLimit)) {
      try {
        fs.unlinkSync(path.join(resolvedDataDir, name));
      } catch (error) {
        safeLogger.error("[storage] No se pudo eliminar un respaldo antiguo:", error.message);
      }
    }
  }

  async function pruneBackups() {
    if (backupLimit === 0) {
      return;
    }
    const files = await backupFiles();
    for (const name of files.slice(backupLimit)) {
      try {
        await fsp.unlink(path.join(resolvedDataDir, name));
      } catch (error) {
        safeLogger.error("[storage] No se pudo eliminar un respaldo antiguo:", error.message);
      }
    }
  }

  function createBackupSync() {
    if (backupLimit === 0 || !fs.existsSync(filePath)) {
      return;
    }
    try {
      const target = backupName();
      fs.copyFileSync(filePath, target);
      pruneBackupsSync();
    } catch (error) {
      safeLogger.error("[storage] No se pudo crear un respaldo local:", error.message);
    }
  }

  async function createBackup() {
    if (backupLimit === 0 || !fs.existsSync(filePath)) {
      return;
    }
    try {
      const target = backupName();
      await fsp.copyFile(filePath, target);
      await pruneBackups();
    } catch (error) {
      safeLogger.error("[storage] No se pudo crear un respaldo local:", error.message);
    }
  }

  function writeAtomicSync(nextState, { createBackup: shouldBackup = true } = {}) {
    const payload = `${JSON.stringify(nextState, null, 2)}\n`;
    const tempPath = path.join(
      resolvedDataDir,
      `.${fileName}.${process.pid}.${++sequence}.tmp`
    );
    let fd = null;
    try {
      fs.mkdirSync(resolvedDataDir, { recursive: true });
      fd = fs.openSync(tempPath, "wx", 0o600);
      fs.writeFileSync(fd, payload, "utf8");
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = null;

      const verification = fs.readFileSync(tempPath, "utf8");
      if (verification !== payload) {
        throw new Error("La verificación del archivo temporal no coincide.");
      }

      fs.renameSync(tempPath, filePath);
      if (shouldBackup) {
        createBackupSync();
      }
    } catch (error) {
      if (fd !== null) {
        try {
          fs.closeSync(fd);
        } catch (closeError) {
          // El error original es el relevante.
        }
      }
      try {
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }
      } catch (cleanupError) {
        // No ocultar el error original.
      }
      if (error instanceof StorageError) {
        throw error;
      }
      throw new StorageWriteError("No se pudo guardar el estado del evento en disco.", {
        cause: error
      });
    }
  }

  async function writeAtomic(nextState, { createBackup: shouldBackup = true } = {}) {
    const payload = `${JSON.stringify(nextState, null, 2)}\n`;
    const tempPath = path.join(
      resolvedDataDir,
      `.${fileName}.${process.pid}.${++sequence}.tmp`
    );
    let handle = null;
    try {
      await fsp.mkdir(resolvedDataDir, { recursive: true });
      handle = await fsp.open(tempPath, "wx", 0o600);
      await handle.writeFile(payload, "utf8");
      await handle.sync();
      await handle.close();
      handle = null;

      const verification = await fsp.readFile(tempPath, "utf8");
      if (verification !== payload) {
        throw new Error("La verificación del archivo temporal no coincide.");
      }

      await fsp.rename(tempPath, filePath);
      if (shouldBackup) {
        await createBackup();
      }
    } catch (error) {
      if (handle) {
        try {
          await handle.close();
        } catch (closeError) {
          // El error original es el relevante.
        }
      }
      try {
        await fsp.unlink(tempPath);
      } catch (cleanupError) {
        // El archivo temporal puede no existir.
      }
      if (error instanceof StorageError) {
        throw error;
      }
      throw new StorageWriteError("No se pudo guardar el estado del evento en disco.", {
        cause: error
      });
    }
  }

  function prepareForWrite(nextState) {
    const prepared = normalizeState(nextState, normalizeOptions());
    prepared.schemaVersion = SCHEMA_VERSION;
    prepared.updatedAt = toIso(now());
    return prepared;
  }

  function enqueueWrite(task) {
    const run = writeChain.then(task);
    writeChain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  function initializeSync() {
    if (initialized) {
      return getState();
    }

    fs.mkdirSync(resolvedDataDir, { recursive: true });

    if (fs.existsSync(filePath)) {
      try {
        const text = fs.readFileSync(filePath, "utf8");
        state = parseStateText(text, normalizeOptions());
      } catch (error) {
        corrupted = true;
        lastError = error;
        safeLogger.error(
          `[storage] El archivo de estado no se pudo cargar de forma segura (${filePath}). ` +
            "No se modificará automáticamente. Recupera un respaldo válido."
        );
        throw new StorageCorruptionError(
          "El archivo de estado está corrupto. No se sobrescribirá automáticamente." +
            " Recupera un respaldo antes de iniciar la aplicación.",
          { cause: error }
        );
      }
    } else {
      state = createInitialState({
        displaySeconds,
        queueMaxLength,
        now: now()
      });
      try {
        writeAtomicSync(state, { createBackup: false });
      } catch (error) {
        state = null;
        throw error;
      }
    }

    initialized = true;
    return getState();
  }

  async function initialize() {
    if (initialized) {
      return getState();
    }
    return initializeSync();
  }

  function getState() {
    ensureReady();
    return clone(state);
  }

  function getStatus() {
    return {
      dataDir: resolvedDataDir,
      filePath,
      schemaVersion: SCHEMA_VERSION,
      initialized,
      corrupted,
      backupLimit,
      backupCount: backupFilesSync().length
    };
  }

  function replaceSync(nextState) {
    const prepared = prepareForWrite(nextState);
    writeAtomicSync(prepared);
    state = prepared;
    corrupted = false;
    lastError = null;
    initialized = true;
    return getState();
  }

  function replace(nextState) {
    return enqueueWrite(async () => {
      ensureReady();
      const prepared = prepareForWrite(nextState);
      await writeAtomic(prepared);
      state = prepared;
      lastError = null;
      return getState();
    });
  }

  function update(mutator) {
    return enqueueWrite(async () => {
      ensureReady();
      if (typeof mutator !== "function") {
        throw new StorageError("update() requiere una función de modificación.");
      }
      const draft = clone(state);
      const result = await mutator(draft);
      const prepared = prepareForWrite(result === undefined ? draft : result);
      await writeAtomic(prepared);
      state = prepared;
      lastError = null;
      return getState();
    });
  }

  function listBackupsSync() {
    return backupFilesSync().map((name) => {
      const fullPath = path.join(resolvedDataDir, name);
      let size = null;
      try {
        size = fs.statSync(fullPath).size;
      } catch (error) {
        size = null;
      }
      return { name, path: fullPath, size };
    });
  }

  async function listBackups() {
    const files = await backupFiles();
    const result = [];
    for (const name of files) {
      const fullPath = path.join(resolvedDataDir, name);
      let size = null;
      try {
        size = (await fsp.stat(fullPath)).size;
      } catch (error) {
        size = null;
      }
      result.push({ name, path: fullPath, size });
    }
    return result;
  }

  function readRestorableBackupSync(preferredBackupPath) {
    const candidates = preferredBackupPath
      ? [{ name: path.basename(preferredBackupPath), path: preferredBackupPath }]
      : listBackupsSync();
    if (candidates.length === 0) {
      throw new StorageRecoveryError("No hay respaldos locales disponibles para recuperar.");
    }

    for (const candidate of candidates) {
      try {
        const text = fs.readFileSync(candidate.path, "utf8");
        const restored = parseStateText(text, normalizeOptions());
        return { restored, source: candidate };
      } catch (error) {
        safeLogger.error(`[storage] Respaldo no válido (${candidate.name}): ${error.message}`);
      }
    }
    throw new StorageRecoveryError("Ningún respaldo local contiene un estado válido.");
  }

  async function readRestorableBackup(preferredBackupPath) {
    const candidates = preferredBackupPath
      ? [{ name: path.basename(preferredBackupPath), path: preferredBackupPath }]
      : await listBackups();
    if (candidates.length === 0) {
      throw new StorageRecoveryError("No hay respaldos locales disponibles para recuperar.");
    }

    for (const candidate of candidates) {
      try {
        const text = await fsp.readFile(candidate.path, "utf8");
        const restored = parseStateText(text, normalizeOptions());
        return { restored, source: candidate };
      } catch (error) {
        safeLogger.error(`[storage] Respaldo no válido (${candidate.name}): ${error.message}`);
      }
    }
    throw new StorageRecoveryError("Ningún respaldo local contiene un estado válido.");
  }

  function quarantineCurrentFileSync(restored) {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const stamp = toIso(now()).replace(/[:.]/g, "-");
    const suffix = corrupted ? "corrupt" : "replaced";
    const target = path.join(resolvedDataDir, `${fileName}.${suffix}-${stamp}.json`);
    try {
      fs.copyFileSync(filePath, target);
      return target;
    } catch (error) {
      safeLogger.error("[storage] No se pudo conservar una copia del archivo anterior:", error.message);
      if (!restored) {
        throw new StorageRecoveryError("No se pudo conservar el archivo actual antes de recuperar.");
      }
      return null;
    }
  }

  async function quarantineCurrentFile() {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const stamp = toIso(now()).replace(/[:.]/g, "-");
    const suffix = corrupted ? "corrupt" : "replaced";
    const target = path.join(resolvedDataDir, `${fileName}.${suffix}-${stamp}.json`);
    try {
      await fsp.copyFile(filePath, target);
      return target;
    } catch (error) {
      safeLogger.error("[storage] No se pudo conservar una copia del archivo anterior:", error.message);
      return null;
    }
  }

  function recoverFromBackupSync(backupPath) {
    fs.mkdirSync(resolvedDataDir, { recursive: true });
    const { restored, source } = readRestorableBackupSync(backupPath);
    const quarantine = quarantineCurrentFileSync(restored);
    writeAtomicSync(restored, { createBackup: false });
    state = restored;
    initialized = true;
    corrupted = false;
    lastError = null;
    return {
      state: getState(),
      source: source.name,
      quarantine
    };
  }

  function recoverFromBackup(backupPath) {
    return enqueueWrite(async () => {
      await fsp.mkdir(resolvedDataDir, { recursive: true });
      const { restored, source } = await readRestorableBackup(backupPath);
      const quarantine = await quarantineCurrentFile();
      await writeAtomic(restored, { createBackup: false });
      state = restored;
      initialized = true;
      corrupted = false;
      lastError = null;
      return {
        state: getState(),
        source: source.name,
        quarantine
      };
    });
  }

  async function flush() {
    await writeChain;
  }

  return {
    initializeSync,
    initialize,
    getState,
    getStatus,
    replaceSync,
    replace,
    update,
    listBackupsSync,
    listBackups,
    recoverFromBackupSync,
    recoverFromBackup,
    flush,
    filePath,
    dataDir: resolvedDataDir,
    schemaVersion: SCHEMA_VERSION
  };
}

module.exports = {
  SCHEMA_VERSION,
  DEFAULT_FILE_NAME,
  DEFAULT_BACKUP_LIMIT,
  StorageError,
  StorageCorruptionError,
  StorageWriteError,
  StorageRecoveryError,
  createStorageService,
  createInitialState,
  normalizeState
};
