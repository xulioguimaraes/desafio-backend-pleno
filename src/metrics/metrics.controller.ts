import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { CurrentTenant } from '../tenancy/current-tenant.decorator';
import type { Tenant } from '../tenancy/tenant';
import { TenantAuthGuard } from '../tenancy/tenant-auth.guard';
import { MetricsQueries } from './metrics.queries';

@Controller('v1')
@UseGuards(TenantAuthGuard)
export class MetricsController {
  constructor(private readonly queries: MetricsQueries) {}

  @Get('clients/:clientId/metrics')
  clientMetrics(@CurrentTenant() tenant: Tenant, @Param('clientId') clientId: string) {
    return this.queries.clientMetrics(tenant, clientId);
  }

  @Get('reports/daily')
  dailyReport(
    @CurrentTenant() tenant: Tenant,
    @Query('from') from: unknown,
    @Query('to') to: unknown,
  ) {
    return this.queries.dailyReport(tenant, from, to);
  }
}
