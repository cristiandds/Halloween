const { PRIVATE_ROOM, PUBLIC_ROOM } = require("../utils/rooms");

function createState({ queueService, phraseService, displaySeconds }) {
  function publicState() {
    return {
      active: Boolean(queueService.getActive()),
      waiting: queueService.getQueueLength(),
      displaySeconds
    };
  }

  function privateState() {
    return {
      active: queueService.getActive(),
      waiting: queueService.getQueueLength(),
      queuePreview: queueService.getQueuePreview(5),
      displaySeconds
    };
  }

  function broadcast(io) {
    const privateSnapshot = privateState();
    io.to(PRIVATE_ROOM).emit("state", privateSnapshot);
    io.to(PRIVATE_ROOM).emit("state:private", privateSnapshot);
    io.to(PUBLIC_ROOM).emit("state:public", publicState());
  }

  return {
    publicState,
    privateState,
    broadcast
  };
}

module.exports = { createState };
