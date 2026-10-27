"use strict";

if (typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile();
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

const path = require("path");
const fs = require("fs");

const config = require("../src/config");
const {
  createStorageService,
  StorageCorruptionError
} = require("../src/services/storage.service");

const args = process.argv.slice(2);
const listOnly = args.includes("--list");
const fromIndex = args.indexOf("--from");
const preferredBackup = fromIndex >= 0 ? args[fromIndex + 1] : null;

function usage() {
  console.log("Uso:");
  console.log("  npm run storage:backups");
  console.log("  npm run storage:recover");
  console.log("  npm run storage:recover -- --from <ruta-del-respaldo>");
}

if (args.includes("--help") || args.includes("-h")) {
  usage();
  process.exit(0);
}

const storage = createStorageService({
  dataDir: config.DATA_DIR,
  fileName: config.STORAGE_FILE_NAME,
  maxBackups: config.STORAGE_BACKUP_LIMIT,
  displaySeconds: config.DISPLAY_SECONDS,
  queueMaxLength: config.QUEUE_MAX_LENGTH
});

try {
  const backups = storage.listBackupsSync();
  if (listOnly) {
    if (backups.length === 0) {
      console.log(`No hay respaldos en ${path.join(config.DATA_DIR, config.STORAGE_FILE_NAME)}.`);
    } else {
      console.log(`Respaldos disponibles en ${storage.dataDir}:`);
      for (const backup of backups) {
        console.log(`- ${backup.name}${backup.size === null ? "" : ` (${backup.size} bytes)`}`);
      }
    }
    process.exit(0);
  }

  if (fs.existsSync(storage.filePath)) {
    try {
      storage.initializeSync();
    } catch (error) {
      if (!(error instanceof StorageCorruptionError)) {
        throw error;
      }
    }
  }

  const result = storage.recoverFromBackupSync(
    preferredBackup
      ? (path.isAbsolute(preferredBackup) ? preferredBackup : path.join(storage.dataDir, preferredBackup))
      : undefined
  );
  console.log(`Estado recuperado desde: ${result.source}`);
  console.log(`Archivo activo: ${storage.filePath}`);
  if (result.quarantine) {
    console.log(`Copia del archivo anterior conservada en: ${result.quarantine}`);
  }
  console.log(
    `Participantes: ${result.state.pendingParticipants.length} pendientes, ` +
      `${result.state.activeParticipant ? 1 : 0} activo, ` +
      `${result.state.finishedParticipants.length} finalizados.`
  );
} catch (error) {
  console.error(`No se pudo recuperar el estado: ${error.message}`);
  process.exitCode = 1;
}
