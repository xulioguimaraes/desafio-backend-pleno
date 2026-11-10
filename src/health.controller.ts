import { Controller, Get } from '@nestjs/common';

/** Sem autenticação: usado por healthchecks de infraestrutura. */
@Controller('health')
export class HealthController {
  @Get()
  check() {
    return { status: 'ok' };
  }
}
