import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { json, urlencoded } from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(json({ limit: '10mb' }));
  app.use(urlencoded({ limit: '10mb', extended: true }));

  app.enableCors({
    origin: true,
    credentials: true,
  });

  const port = process.env.PORT || 3001;
  await app.listen(port, '0.0.0.0');
  console.log(`[ACIONAR V3 NESTJS] Backend API running on port ${port}`);
}

bootstrap();
