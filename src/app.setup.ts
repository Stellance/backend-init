import {
  ValidationPipe,
  VersioningType,
  type INestApplication,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { requestContextMiddleware } from './common/request-context.js';
import type { EnvVars } from './config/env.validation.js';

/** Shared by main.ts and e2e tests so tests run the production pipeline. */
export function configureApp(app: NestExpressApplication): void {
  const config = app.get<ConfigService<EnvVars, true>>(ConfigService);
  const swaggerEnabled = config.get('SWAGGER_ENABLED', { infer: true });

  app.useLogger(app.get(Logger));
  app.set('trust proxy', config.get('TRUST_PROXY_HOPS', { infer: true }));
  app.disable('x-powered-by');

  app.use(requestContextMiddleware);
  // Swagger UI relies on inline scripts, so CSP is relaxed only when it is on.
  app.use(
    helmet({ contentSecurityPolicy: swaggerEnabled ? false : undefined }),
  );

  const origins = config
    .get('CORS_ORIGINS', { infer: true })
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({ origin: origins.length > 0 ? origins : false });

  app.useBodyParser('json', { limit: '100kb' });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableShutdownHooks();

  if (swaggerEnabled)
    setupSwagger(app, config.get('APP_NAME', { infer: true }));
}

function setupSwagger(app: INestApplication, appName: string): void {
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle(`${appName} API`)
      .setDescription(
        'Success bodies are `{ statusCode, message, data }`; paginated `data` is `{ results, paginationMeta }`. Errors share one envelope (see ErrorResponseDto).',
      )
      .setVersion('1')
      .addBearerAuth()
      .build(),
  );
  SwaggerModule.setup('docs', app, document, {
    jsonDocumentUrl: 'docs/json',
    swaggerOptions: { persistAuthorization: true },
  });
}
