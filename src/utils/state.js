const { PRIVATE_ROOM, PUBLIC_ROOM } = require("../utils/rooms");

function createState({ queueService, phraseService, displaySeconds }) {
  function publicState() {
    const snapshot = queueService.getSnapshot();
    return {
      active: Boolean(snapshot.active),
      waiting: snapshot.waiting,
      displaySeconds: snapshot.displaySeconds,
      paused: snapshot.paused,
      mode: snapshot.mode,
      remainingMs: snapshot.remainingMs,
      serverTime: snapshot.serverTime
    };
  }

  function privateState() {
    const snapshot = queueService.getSnapshot();
    const active = snapshot.active;
    return {
      active: active
        ? {
            ...active,
            remainingMs: snapshot.remainingMs
          }
        : null,
      waiting: snapshot.waiting,
      pendingApproval: snapshot.pendingApproval,
      queuePreview: queueService.getQueuePreview(5),
      queueItems: queueService.getQueueItems(20),
      pendingApprovalPreview: queueService.getPendingApprovalPreview(5),
      pendingApprovalItems: queueService.getPendingApprovalItems(20),
      participants: queueService.getParticipants(),
      displaySeconds: snapshot.displaySeconds,
      paused: snapshot.paused,
      mode: snapshot.mode,
      remainingMs: snapshot.remainingMs,
      serverTime: snapshot.serverTime,
      finishedCount: queueService.getFinishedCount(),
      states: queueService.PARTICIPANT_STATES
    };
  }

  function broadcast(io) {
    if (!io) {
      return;
    }
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
