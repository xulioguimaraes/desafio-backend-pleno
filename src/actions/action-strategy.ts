/** O que um evento soma nas métricas da sua action. */
export interface MetricContribution {
  count: number;
  /** Centavos inteiros. 0n para ações não financeiras. */
  totalCents: bigint;
}

/**
 * Uma strategy por action. Ela é a ÚNICA coisa que sabe:
 *  - se a action exige amount (validação do POST);
 *  - o que o evento contribui nas métricas (worker).
 *
 * Adicionar uma action nova = criar uma classe e registrá-la em ActionsModule.
 * Consumidor, use-case de processamento e validador não mudam.
 */
export interface ActionStrategy {
  readonly action: string;
  readonly requiresAmount: boolean;
  contribution(event: { amountCents: bigint | null }): MetricContribution;
}

export const ACTION_STRATEGIES = Symbol('ACTION_STRATEGIES');

/** Base para ações que movimentam dinheiro: conta 1 e soma o valor. */
export abstract class FinancialActionStrategy implements ActionStrategy {
  abstract readonly action: string;
  readonly requiresAmount = true;

  contribution(event: { amountCents: bigint | null }): MetricContribution {
    if (event.amountCents === null) {
      // Não deveria acontecer: o validador exige amount. Falhar alto é melhor que somar 0.
      throw new Error(`${this.action} sem amount`);
    }
    return { count: 1, totalCents: event.amountCents };
  }
}

/** Base para ações sem valor: só conta. */
export abstract class CountOnlyActionStrategy implements ActionStrategy {
  abstract readonly action: string;
  readonly requiresAmount = false;

  contribution(): MetricContribution {
    return { count: 1, totalCents: 0n };
  }
}
