if (typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile();
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

const { createApp } = require("./src/app");
const config = require("./src/config");

const { app, server, io, storage } = createApp();
const PORT = config.PORT;

if (require.main === module) {
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Sistema QR de terror activo en el puerto ${PORT}`);
    console.log("Acceso privado disponible en /login.");
    console.log(`Persistencia del evento: ${storage.filePath}`);
    console.warn(
      "AVISO: la persistencia local es para una sola instancia. " +
        "El hosting debe ofrecer un disco persistente real; un disco efímero borra los datos al reiniciar."
    );
    if (config.USING_DEV_PASSWORD) {
      console.warn("AVISO: ADMIN_PASSWORD no está definido. Se está usando la contraseña de desarrollo.");
    }
    if (config.USING_DEV_SESSION_SECRET) {
      console.warn("AVISO: SESSION_SECRET no está definido. Se está usando el secreto de desarrollo.");
    }
  });
}

module.exports = { app, server, io, createApp };
