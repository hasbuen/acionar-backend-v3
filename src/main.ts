import * as dotenv from 'dotenv';
dotenv.config();

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { json, urlencoded } from 'express';
import * as express from 'express';
import * as path from 'path';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const fs = require('fs');
  const uploadsDir = process.env.UPLOADS_DIR || (fs.existsSync('/var/www/acionar-v3/uploads') ? '/var/www/acionar-v3/uploads' : path.join(process.cwd(), 'uploads'));
  app.use('/uploads', express.static(uploadsDir));

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
