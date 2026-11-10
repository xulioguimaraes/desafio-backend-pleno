import { Module, Type } from '@nestjs/common';
import { ACTION_STRATEGIES, ActionStrategy } from './action-strategy';
import { ActionStrategyRegistry } from './action-strategy.registry';
import {
  BetPlacedStrategy,
  DepositConfirmedStrategy,
  LoginStrategy,
  WithdrawalApprovedStrategy,
} from './strategies';

/** Para adicionar uma action nova, basta incluir a classe nesta lista. */
const STRATEGIES: Type<ActionStrategy>[] = [
  DepositConfirmedStrategy,
  WithdrawalApprovedStrategy,
  BetPlacedStrategy,
  LoginStrategy,
];

@Module({
  providers: [
    ...STRATEGIES,
    {
      provide: ACTION_STRATEGIES,
      useFactory: (...strategies: ActionStrategy[]) => strategies,
      inject: STRATEGIES,
    },
    ActionStrategyRegistry,
  ],
  exports: [ActionStrategyRegistry],
})
export class ActionsModule {}
