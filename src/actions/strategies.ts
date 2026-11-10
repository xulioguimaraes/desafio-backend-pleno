import { Injectable } from '@nestjs/common';
import { CountOnlyActionStrategy, FinancialActionStrategy } from './action-strategy';

@Injectable()
export class DepositConfirmedStrategy extends FinancialActionStrategy {
  readonly action = 'DEPOSIT_CONFIRMED';
}

@Injectable()
export class WithdrawalApprovedStrategy extends FinancialActionStrategy {
  readonly action = 'WITHDRAWAL_APPROVED';
}

@Injectable()
export class BetPlacedStrategy extends FinancialActionStrategy {
  readonly action = 'BET_PLACED';
}

@Injectable()
export class LoginStrategy extends CountOnlyActionStrategy {
  readonly action = 'LOGIN';
}
