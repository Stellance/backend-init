import { v7 } from 'uuid';
import { resolve } from 'node:path';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { runMigrations } from '../src/database/migrator.js';

export async function createTestApp(): Promise<NestExpressApplication> {
  await runMigrations(process.env.DATABASE_URL!, resolve('drizzle'));
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    bufferLogs: true,
  });
  configureApp(app);
  await app.init();
  return app;
}

export const createPool = () =>
  new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });

let ipCounter = 0;
/** Unique client IP per call so rate-limit buckets do not leak between tests. */
export const freshIp = () =>
  `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter++ & 255}`;

export const uniqueEmail = () => `user-${v7()}@example.test`;
export const PASSWORD = 'correct-horse-battery';

export interface Session {
  email: string;
  accessToken: string;
  refreshToken: string;
  userId: string;
}

export async function registerUser(
  app: NestExpressApplication,
): Promise<Session> {
  const email = uniqueEmail();
  const res = await request(app.getHttpServer())
    .post('/v1/auth/register')
    .set('X-Forwarded-For', freshIp())
    .send({ email, password: PASSWORD })
    .expect(201);
  const me = await request(app.getHttpServer())
    .get('/v1/auth/me')
    .set('X-Forwarded-For', freshIp())
    .set('Authorization', `Bearer ${res.body.accessToken}`)
    .expect(200);
  return {
    email,
    accessToken: res.body.accessToken,
    refreshToken: res.body.refreshToken,
    userId: me.body.id,
  };
}
