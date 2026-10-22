// Match timings taken from Clutcher's supplied main.js / in-game help.
// Bomb Defuse: 5s freeze, 115.2s round (displayed as 1:55), 15 rounds,
// first to 8, no halftime in the active native preset, 40s C4 timer.
// Team Deathmatch: immediate start, 600s match, 6s results, then restart.
// Combat, C4 and individual death/respawn ownership are separate milestones.
export const RULES = Object.freeze({
  defusal: Object.freeze({
    freezeMs: 5_000, roundMs: 115_200, endMs: 5_000, matchEndMs: 8_000,
    maxRounds: 15, winRounds: 8, halftime: false,
    bombMs: 40_000, plantMs: 3_200, defuseMs: 10_000, defuseKitMs: 5_000
  }),
  dm: Object.freeze({
    freezeMs: 0, roundMs: 600_000, endMs: 6_000,
    maxRounds: 1, winRounds: null, halftime: false
  })
});
export const ROUND_MS = RULES.defusal.roundMs;
export const FREEZE_MS = RULES.defusal.freezeMs;
export const END_MS = RULES.defusal.endMs;

export class RoomMatch {
  constructor(mode) {
    this.mode = mode;
    this.phase = "waiting";
    this.endsAt = null;
    this.round = 1;
    this.score = { CT: 0, T: 0 };
    this.revision = 0;
    this.winner = null;
    this.matchWinner = null;
  }

  get rules() { return RULES[this.mode] ?? RULES.defusal; }

  transition(phase, endsAt = null) {
    if (this.phase === phase && this.endsAt === endsAt) return;
    this.phase = phase;
    this.endsAt = endsAt;
    this.revision++;
  }

  advance(now, bothTeamsReady) {
    if (!bothTeamsReady) {
      this.winner = null;
      this.matchWinner = null;
      this.transition("waiting");
      return;
    }

    if (this.phase === "waiting") {
      this.transition(this.rules.freezeMs ? "countdown" : "live",
        now + (this.rules.freezeMs || this.rules.roundMs));
      return;
    }

    if (this.endsAt === null || now < this.endsAt) return;
    const deadline = this.endsAt;

    if (this.phase === "countdown") {
      this.transition("live", deadline + this.rules.roundMs);
    } else if (this.phase === "live") {
      // Only the objective-free Defusal timeout outcome is known for now:
      // no networked plant, defuse, or elimination events exist yet.
      this.winner = this.mode === "defusal" ? "CT" : null;
      if (this.winner) this.score[this.winner]++;
      this.transition("ended", deadline + this.rules.endMs);
    } else if (this.phase === "ended") {
      if (this.mode === "defusal" && (this.score.CT >= this.rules.winRounds ||
          this.score.T >= this.rules.winRounds || this.round >= this.rules.maxRounds)) {
        this.matchWinner = this.score.CT > this.score.T ? "CT" :
          this.score.T > this.score.CT ? "T" : null;
        this.transition("match_end", deadline + this.rules.matchEndMs);
      } else {
        if (this.mode === "defusal") this.round++;
        else this.score = { CT: 0, T: 0 }; // native TDM starts a new match
        this.winner = null;
        this.transition(this.rules.freezeMs ? "countdown" : "live",
          deadline + (this.rules.freezeMs || this.rules.roundMs));
      }
    } else if (this.phase === "match_end") {
      this.round = 1;
      this.score = { CT: 0, T: 0 };
      this.winner = null;
      this.matchWinner = null;
      this.transition("countdown", deadline + this.rules.freezeMs);
    }
  }

  snapshot(room, players, now) {
    const list = [...players.values()];
    const rules = this.rules;
    return {
      type: "match_state",
      room,
      revision: this.revision,
      phase: this.phase,
      round: this.round,
      roundSeconds: rules.roundMs / 1000,
      remainingMs: this.endsAt === null ? 0 : Math.max(0, Math.ceil(this.endsAt - now)),
      score: { ...this.score },
      winner: this.winner,
      matchWinner: this.matchWinner,
      maxRounds: rules.maxRounds,
      winRounds: rules.winRounds,
      ct: list.filter(player => player.team === "CT").length,
      t: list.filter(player => player.team === "T").length,
      ready: list.filter(player => player.ready).length,
      players: list.length
    };
  }
}
