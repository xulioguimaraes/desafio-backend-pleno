import { ActionStrategy, CountOnlyActionStrategy } from './action-strategy';
import { ActionStrategyRegistry } from './action-strategy.registry';
import {
  BetPlacedStrategy,
  DepositConfirmedStrategy,
  LoginStrategy,
  WithdrawalApprovedStrategy,
} from './strategies';

describe('strategies', () => {
  it.each([
    [new DepositConfirmedStrategy(), 'DEPOSIT_CONFIRMED'],
    [new WithdrawalApprovedStrategy(), 'WITHDRAWAL_APPROVED'],
    [new BetPlacedStrategy(), 'BET_PLACED'],
  ])('%p é financeira: exige amount e soma centavos', (strategy, action) => {
    expect(strategy.action).toBe(action);
    expect(strategy.requiresAmount).toBe(true);
    expect(strategy.contribution({ amountCents: 1974n })).toEqual({ count: 1, totalCents: 1974n });
  });

  it('ações financeiras falham alto se chegarem sem amount', () => {
    expect(() => new DepositConfirmedStrategy().contribution({ amountCents: null })).toThrow();
  });

  it('LOGIN só conta', () => {
    const login = new LoginStrategy();
    expect(login.requiresAmount).toBe(false);
    expect(login.contribution()).toEqual({ count: 1, totalCents: 0n });
  });
});

describe('ActionStrategyRegistry', () => {
  const all: ActionStrategy[] = [
    new DepositConfirmedStrategy(),
    new WithdrawalApprovedStrategy(),
    new BetPlacedStrategy(),
    new LoginStrategy(),
  ];

  it('encontra a strategy pela action', () => {
    const registry = new ActionStrategyRegistry(all);
    expect(registry.find('LOGIN')).toBeInstanceOf(LoginStrategy);
    expect(registry.find('UNKNOWN')).toBeUndefined();
    expect(registry.actions()).toEqual([
      'DEPOSIT_CONFIRMED',
      'WITHDRAWAL_APPROVED',
      'BET_PLACED',
      'LOGIN',
    ]);
  });

  it('uma action nova entra só registrando a classe (sem tocar em consumidor/use-case)', () => {
    class ProfileUpdatedStrategy extends CountOnlyActionStrategy {
      readonly action = 'PROFILE_UPDATED';
    }
    const registry = new ActionStrategyRegistry([...all, new ProfileUpdatedStrategy()]);
    expect(registry.find('PROFILE_UPDATED')?.contribution({ amountCents: null })).toEqual({
      count: 1,
      totalCents: 0n,
    });
  });

  it('rejeita duas strategies para a mesma action', () => {
    expect(() => new ActionStrategyRegistry([...all, new LoginStrategy()])).toThrow(/duplicada/);
  });
});
