/** A bounded, match-scoped event ledger. Also used at the browser boundary. */
export class MatchEventLedger {
  private scopes = new Map<string, Set<string>>();
  claim(roomId: string, matchId: string, id: string): boolean {
    const key=JSON.stringify([roomId,matchId]);
    let scope = this.scopes.get(key);
    if (!scope) {
      scope = new Set();
      this.scopes.set(key, scope);
      if (this.scopes.size > 1024) this.scopes.delete(this.scopes.keys().next().value!);
    }
    if (scope.has(id)) return false;
    scope.add(id);
    return true;
  }
}
