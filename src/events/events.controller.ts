import { Body, Controller, Get, HttpStatus, Param, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentTenant } from '../tenancy/current-tenant.decorator';
import type { Tenant } from '../tenancy/tenant';
import { TenantAuthGuard } from '../tenancy/tenant-auth.guard';
import { GetEventUseCase } from './get-event.use-case';
import { IngestEventUseCase } from './ingest-event.use-case';

@Controller('v1/events')
@UseGuards(TenantAuthGuard)
export class EventsController {
  constructor(
    private readonly ingestEvent: IngestEventUseCase,
    private readonly getEvent: GetEventUseCase,
  ) {}

  @Post()
  async ingest(
    @CurrentTenant() tenant: Tenant,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.ingestEvent.execute(tenant, body);

    if (result.kind === 'accepted') {
      res.status(HttpStatus.ACCEPTED);
      return { id: result.id, status: result.status };
    }

    res.status(HttpStatus.OK);
    return { id: result.id, status: result.status, duplicate: true, reason: result.reason };
  }

  @Get(':id')
  findOne(@CurrentTenant() tenant: Tenant, @Param('id') id: string) {
    return this.getEvent.execute(tenant, id);
  }
}
