// One authoritative clock and score per multiplayer room.
// No client message can directly set a score or time.
export const ROUND_MS = 600_000; // 10 minutes until combat/objective timing is implemented.
export const FREEZE_MS = 5_000;
export const END_MS = 5_000;

export class RoomMatch {
  constructor(mode) {
    this.mode = mode;
    this.phase = "waiting";
    this.endsAt = null;
    this.round = 1;
    this.score = { CT: 0, T: 0 };
    this.revision = 0;
    this.winner = null;
  }

  transition(phase, endsAt = null) {
    if (this.phase === phase && this.endsAt === endsAt) return;
    this.phase = phase;
    this.endsAt = endsAt;
    this.revision++;
  }

  advance(now, bothTeamsReady) {
    // Wait without running a clock if either team has no loaded human players.
    if (!bothTeamsReady) {
      this.winner = null;
      this.transition("waiting");
      return;
    }

    if (this.phase === "waiting") {
      this.transition("countdown", now + FREEZE_MS);
      return;
    }

    if (this.endsAt === null || now < this.endsAt) return;

    const deadline = this.endsAt;
    if (this.phase === "countdown") {
      this.transition("live", deadline + ROUND_MS);
    } else if (this.phase === "live") {
      // No networked bomb or combat events yet. In Defusal, timeout means
      // CT wins unless a plant occurred; planting is not implemented yet.
      // Never accept fabricated scores or outcomes from browser clients.
      this.winner = this.mode === "defusal" ? "CT" : null;
      if (this.winner) this.score[this.winner]++;
      this.transition("ended", deadline + END_MS);
    } else if (this.phase === "ended") {
      this.round++;
      this.winner = null;
      this.transition("countdown", deadline + FREEZE_MS);
    }
  }

  snapshot(room, players, now) {
    const list = [...players.values()];
    return {
      type: "match_state",
      room,
      revision: this.revision,
      phase: this.phase,
      round: this.round,
      roundSeconds: ROUND_MS / 1000,
      remainingMs: this.endsAt === null ? 0 : Math.max(0, Math.ceil(this.endsAt - now)),
      score: { ...this.score },
      winner: this.winner,
      ct: list.filter(player => player.team === "CT").length,
      t: list.filter(player => player.team === "T").length,
      ready: list.filter(player => player.ready).length,
      players: list.length
    };
  }
}
