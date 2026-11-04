import { VbdError } from "./errors.js";

export interface Disposable {
  readonly id: string;
  dispose(): { removed: boolean };
}
const owned = new WeakMap<Disposable, { owner: string; active: boolean; cleanup: () => void }>();
export function registration(owner: string, cleanup: () => void): Disposable {
  const token: Disposable = Object.freeze({
    id: crypto.randomUUID(),
    dispose: () => disposeRegistration(token, owner)
  });
  owned.set(token, { owner, active: true, cleanup });
  return token;
}
export function disposeRegistration(token: Disposable, owner: string): { removed: boolean } {
  const state = owned.get(token);
  if (!state || state.owner !== owner) throw new VbdError("INVALID_ARGUMENT", { operation: "events.dispose" });
  if (!state.active) return { removed: false };
  state.cleanup();
  state.active = false;
  return { removed: true };
}
