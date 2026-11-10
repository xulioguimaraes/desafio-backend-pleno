import { Module } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { LoggerModule } from 'nestjs-pino';
import { loadConfig } from '../../config/app-config';
import type { TenantRequest } from '../../tenancy/tenant';

/**
 * Logs estruturados (JSON) com company_code, event_id e latency_ms.
 *
 * Segurança: o serializer de request só expõe método, URL e id. Os headers
 * NUNCA são logados (x-company-secret vive neles). O `redact` é uma segunda
 * barreira caso alguém reintroduza headers no futuro.
 */
@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: loadConfig().logLevel,
        genReqId: (req) => (req.headers['x-request-id'] as string) || randomUUID(),
        customAttributeKeys: { responseTime: 'latency_ms' },
        serializers: {
          req: (req: { id: string; method: string; url: string }) => ({
            id: req.id,
            method: req.method,
            url: req.url,
          }),
          res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
        },
        redact: {
          paths: ['req.headers', 'headers', '*.secret', '*.secret_hash', 'x-company-secret'],
          remove: true,
        },
        customProps: (req: IncomingMessage) => {
          const r = req as unknown as TenantRequest & { body?: { event_id?: unknown } };
          const eventId = typeof r.body?.event_id === 'string' ? r.body.event_id : undefined;
          return {
            company_code: r.tenant?.companyCode,
            event_id: eventId,
          };
        },
        autoLogging: { ignore: (req) => req.url === '/health' },
      },
    }),
  ],
})
export class LoggingModule {}
