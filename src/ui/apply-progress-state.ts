import type { TransactionState } from "../transaction/types";

const TERMINAL_STATES = new Set<TransactionState>(["COMPLETED", "ROLLED_BACK", "ROLLBACK_INCOMPLETE"]);

export class ApplyProgressState {
  state: TransactionState = "PREPARING";
  path: string | undefined;
  message = "Preparing transaction";
  terminal = false;

  update(state: TransactionState, path?: string): void {
    this.state = state;
    this.path = path;
    this.message = state.replaceAll("_", " ").toLocaleLowerCase();
    this.terminal = TERMINAL_STATES.has(state);
  }

  fail(message: string): void {
    this.message = message;
    this.path = undefined;
    this.terminal = true;
  }

  canClose(): boolean {
    return this.terminal;
  }
}
