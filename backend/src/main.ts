import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Enable CORS
  app.enableCors();

  // Trust the first proxy hop so `req.ip` reflects the real client
  // when running behind nginx / a load balancer. Phase 9's rate
  // limiter + Phase 10's failed-login source-IP report both depend
  // on this — without it, every request appears to come from
  // 127.0.0.1 in production deployments. NestExpressApplication is
  // the typed way to reach the underlying Express knob.
  app.set('trust proxy', 1);

  // Enable global validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Phase 10 — global exception filter is registered via APP_FILTER
  // in AppModule (so it can DI HealthService). No manual
  // useGlobalFilters needed here.

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`Application is running on: ${await app.getUrl()}`);
}
bootstrap();
