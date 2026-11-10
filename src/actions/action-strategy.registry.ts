import { Inject, Injectable } from '@nestjs/common';
import { ACTION_STRATEGIES, ActionStrategy } from './action-strategy';

@Injectable()
export class ActionStrategyRegistry {
  private readonly byAction: ReadonlyMap<string, ActionStrategy>;

  constructor(@Inject(ACTION_STRATEGIES) strategies: ActionStrategy[]) {
    const map = new Map<string, ActionStrategy>();
    for (const strategy of strategies) {
      if (map.has(strategy.action)) {
        throw new Error(`Strategy duplicada para a action ${strategy.action}`);
      }
      map.set(strategy.action, strategy);
    }
    this.byAction = map;
  }

  find(action: string): ActionStrategy | undefined {
    return this.byAction.get(action);
  }

  actions(): string[] {
    return [...this.byAction.keys()];
  }
}
