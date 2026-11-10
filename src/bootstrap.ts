import type { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { Logger } from 'nestjs-pino';

/**
 * Configuração comum entre main.ts e os testes de integração, para que os
 * testes rodem exatamente o mesmo app que sobe em produção.
 */
export async function configureApp(app: INestApplication): Promise<void> {
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();

  // Pegadinha: autoIndex cria índices em background. Se a primeira rajada de
  // requisições chegar antes do índice único existir, o C2 aceitaria duplicatas.
  // Por isso esperamos todos os modelos terem seus índices criados.
  const connection = app.get<Connection>(getConnectionToken());
  await Promise.all(Object.values(connection.models).map((model) => model.init()));
}
