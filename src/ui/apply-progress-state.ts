import type { TransactionState } from "../transaction/types";
import { createTranslator, transactionStateLabel, type Translate } from "../i18n";

const TERMINAL_STATES = new Set<TransactionState>(["COMPLETED", "ROLLED_BACK", "ROLLBACK_INCOMPLETE"]);

export class ApplyProgressState {
  state: TransactionState = "PREPARING";
  path: string | undefined;
  message: string;
  terminal = false;

  constructor(private readonly t: Translate = createTranslator("en")) {
    this.message = this.t("statePreparing");
  }

  update(state: TransactionState, path?: string): void {
    this.state = state;
    this.path = path;
    this.message = transactionStateLabel(state, this.t);
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
