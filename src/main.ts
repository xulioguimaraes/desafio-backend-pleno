import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { loadConfig } from './config/app-config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  await configureApp(app);
  await app.listen(loadConfig().port);
}

void bootstrap();
