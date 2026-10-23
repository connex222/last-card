'use strict';
/** Server-authoritative CATCH! race. Only the first eligible tap can win. */
class CatchWindow {
  constructor({ clock = () => Date.now(), durationMs = 4000 } = {}) {
    if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > 4000) throw new RangeError('CATCH! maximum is 4000ms');
    this.clock = clock; this.durationMs = durationMs; this.current = null; this.sequence = 0;
  }
  open(offenderId, eligibleIds) {
    if (!offenderId || !Array.isArray(eligibleIds)) throw new TypeError('Offender and eligible players required');
    const now = this.clock();
    this.current = { id: ++this.sequence, offenderId,
      eligible: new Set(eligibleIds.filter(id => id !== offenderId)),
      openedAt: now, deadline: now + this.durationMs };
    return this.publicState();
  }
  publicState() {
    const w = this.current;
    return (!w || this.clock() >= w.deadline) ? null :
      { id: w.id, offenderId: w.offenderId, expiresAt: w.deadline };
  }
  resolve(actorId, kind, onCaught) {
    const w = this.current;
    if (!w) return { ok: false, reason: 'closed' };
    if (this.clock() >= w.deadline) { this.current = null; return { ok: false, reason: 'expired' }; }
    if (!['call','catch'].includes(kind)) return { ok: false, reason: 'invalid_action' };
    if (kind === 'call' && actorId !== w.offenderId) return { ok: false, reason: 'not_offender' };
    if (kind === 'catch' && !w.eligible.has(actorId)) return { ok: false, reason: 'not_eligible' };
    this.current = null;
    if (kind === 'catch') onCaught(w.offenderId, actorId);
    return { ok: true, outcome: kind === 'call' ? 'saved' : 'caught', offenderId: w.offenderId, catcherId: kind === 'catch' ? actorId : null };
  }
  close() { this.current = null; }
}
module.exports = { CatchWindow };
