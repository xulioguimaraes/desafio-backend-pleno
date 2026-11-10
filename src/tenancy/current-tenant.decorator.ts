import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AppError } from '../common/errors/app-error';
import type { Tenant, TenantRequest } from './tenant';

export const CurrentTenant = createParamDecorator((_: unknown, ctx: ExecutionContext): Tenant => {
  const tenant = ctx.switchToHttp().getRequest<TenantRequest>().tenant;
  if (!tenant) throw AppError.unauthorized();
  return tenant;
});
