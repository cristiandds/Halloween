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
    let inscriptions = { open: true };
    try {
      if (typeof queueService.getInscriptionsStatus === "function") {
        inscriptions = queueService.getInscriptionsStatus();
      } else if (queueService.getLocalState) {
        const s = queueService.getLocalState();
        inscriptions = { open: s.inscriptionsOpen !== false, paused: s.inscriptionsPaused === true };
      }
    } catch (e) {
      inscriptions = { open: true };
    }
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
      states: queueService.PARTICIPANT_STATES,
      inscriptions,
      inscriptionsOpen: inscriptions.open,
      systemStatus: "ok",
      connectionStatus: "connected"
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
