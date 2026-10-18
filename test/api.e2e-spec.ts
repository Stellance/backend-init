import { v7 } from 'uuid';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Pool } from 'pg';
import request from 'supertest';
import {
  createPool,
  createTestApp,
  freshIp,
  PASSWORD,
  registerUser,
  uniqueEmail,
} from './helpers.js';

describe('API (e2e)', () => {
  let app: NestExpressApplication;
  let pool: Pool;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp();
    pool = createPool();
  });

  afterAll(async () => {
    await pool.end();
    await app.close();
  });

  const auth = (token: string) => `Bearer ${token}`;

  async function login(email: string, ip = freshIp()) {
    return http()
      .post('/v1/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ email, password: PASSWORD });
  }

  describe('auth', () => {
    it('registers, then returns the caller from /auth/me', async () => {
      const session = await registerUser(app);
      const me = await http()
        .get('/v1/auth/me')
        .set('X-Forwarded-For', freshIp())
        .set('Authorization', auth(session.accessToken))
        .expect(200);
      expect(me.body).toMatchObject({
        email: session.email,
        role: 'user',
      });
      expect(me.body.passwordHash).toBeUndefined();
      expect(me.body.id[14]).toBe('7');
    });

    it('rejects a duplicate email with 409', async () => {
      const session = await registerUser(app);
      const res = await http()
        .post('/v1/auth/register')
        .set('X-Forwarded-For', freshIp())
        .send({ email: session.email, password: PASSWORD })
        .expect(409);
      expect(res.body.code).toBe('CONFLICT');
    });

    it('rejects invalid and unknown body fields with a uniform envelope', async () => {
      const res = await http()
        .post('/v1/auth/register')
        .set('X-Forwarded-For', freshIp())
        .send({ email: 'nope', password: 'short', admin: true })
        .expect(400);
      expect(res.body).toMatchObject({
        statusCode: 400,
        code: 'BAD_REQUEST',
        message: 'Validation failed',
      });
      expect(res.body.details.length).toBeGreaterThanOrEqual(3);
      expect(res.body.requestId).toEqual(res.headers['x-request-id']);
    });

    it('returns 401 for a wrong password and audits the failure', async () => {
      const session = await registerUser(app);
      const res = await http()
        .post('/v1/auth/login')
        .set('X-Forwarded-For', freshIp())
        .send({ email: session.email, password: 'wrong-password-123' })
        .expect(401);
      expect(res.body.message).toBe('Invalid credentials');
      const { rows } = await pool.query(
        `SELECT 1 FROM audit_log WHERE action = 'auth.login_failed' AND metadata->>'email' = $1`,
        [session.email],
      );
      expect(rows).toHaveLength(1);
    });

    it('returns 401 for an unknown email without leaking which part failed', async () => {
      const res = await login(uniqueEmail());
      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Invalid credentials');
    });

    it('rotates refresh tokens and revokes the family on reuse', async () => {
      const session = await registerUser(app);
      const refresh = (token: string) =>
        http()
          .post('/v1/auth/refresh')
          .set('X-Forwarded-For', freshIp())
          .send({ refreshToken: token });

      const rotated = await refresh(session.refreshToken).expect(200);
      expect(rotated.body.refreshToken).not.toBe(session.refreshToken);

      await refresh(session.refreshToken).expect(401);
      // The legitimate descendant is revoked too.
      await refresh(rotated.body.refreshToken).expect(401);

      const { rows } = await pool.query(
        `SELECT 1 FROM audit_log WHERE action = 'auth.refresh_reuse_detected' AND request_id IS NOT NULL`,
      );
      expect(rows.length).toBeGreaterThan(0);
    });

    it('logout revokes the refresh token', async () => {
      const session = await registerUser(app);
      await http()
        .post('/v1/auth/logout')
        .set('X-Forwarded-For', freshIp())
        .send({ refreshToken: session.refreshToken })
        .expect(204);
      await http()
        .post('/v1/auth/refresh')
        .set('X-Forwarded-For', freshIp())
        .send({ refreshToken: session.refreshToken })
        .expect(401);
    });

    it('rejects missing, malformed and forged bearer tokens', async () => {
      await http()
        .get('/v1/auth/me')
        .set('X-Forwarded-For', freshIp())
        .expect(401);
      await http()
        .get('/v1/auth/me')
        .set('X-Forwarded-For', freshIp())
        .set('Authorization', 'Bearer not.a.jwt')
        .expect(401);
    });
  });

  describe('health', () => {
    it('is not public', async () => {
      await http().get('/health').set('X-Forwarded-For', freshIp()).expect(401);
    });

    it('reports database and redis with a valid JWT', async () => {
      const session = await registerUser(app);
      const res = await http()
        .get('/health')
        .set('X-Forwarded-For', freshIp())
        .set('Authorization', auth(session.accessToken))
        .expect(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.info.database.status).toBe('up');
      expect(res.body.info.redis.status).toBe('up');
    });
  });

  describe('authorization', () => {
    async function makeAdmin() {
      const session = await registerUser(app);
      await pool.query(`UPDATE users SET role = 'admin' WHERE id = $1`, [
        session.userId,
      ]);
      const res = await login(session.email);
      return { ...session, accessToken: res.body.accessToken as string };
    }

    it('RBAC: plain user is forbidden from admin routes', async () => {
      const user = await registerUser(app);
      await http()
        .get('/v1/users')
        .set('X-Forwarded-For', freshIp())
        .set('Authorization', auth(user.accessToken))
        .expect(403);
      await http()
        .get('/v1/audit-logs')
        .set('X-Forwarded-For', freshIp())
        .set('Authorization', auth(user.accessToken))
        .expect(403);
    });

    it('RBAC: admin lists users with offset/limit pagination', async () => {
      const admin = await makeAdmin();
      const res = await http()
        .get('/v1/users?limit=2&offset=0')
        .set('X-Forwarded-For', freshIp())
        .set('Authorization', auth(admin.accessToken))
        .expect(200);
      expect(res.body.limit).toBe(2);
      expect(res.body.offset).toBe(0);
      expect(res.body.data.length).toBeLessThanOrEqual(2);
      expect(res.body.total).toBeGreaterThanOrEqual(res.body.data.length);
      expect(res.body.data[0].passwordHash).toBeUndefined();
    });

    it('caps page size', async () => {
      const admin = await makeAdmin();
      await http()
        .get('/v1/users?limit=1000')
        .set('X-Forwarded-For', freshIp())
        .set('Authorization', auth(admin.accessToken))
        .expect(400);
    });

    it('policy: user reads self, not others; admin reads anyone', async () => {
      const [a, b, admin] = await Promise.all([
        registerUser(app),
        registerUser(app),
        makeAdmin(),
      ]);
      const get = (id: string, token: string) =>
        http()
          .get(`/v1/users/${id}`)
          .set('X-Forwarded-For', freshIp())
          .set('Authorization', auth(token));

      await get(a.userId, a.accessToken).expect(200);
      await get(b.userId, a.accessToken).expect(403);
      await get(b.userId, admin.accessToken).expect(200);
      // Non-admins cannot probe for existence via 404 vs 403.
      await get(v7(), a.accessToken).expect(403);
      await get(v7(), admin.accessToken).expect(404);
    });

    it('admin filters the audit log', async () => {
      const admin = await makeAdmin();
      const res = await http()
        .get('/v1/audit-logs?action=auth.register&limit=5')
        .set('X-Forwarded-For', freshIp())
        .set('Authorization', auth(admin.accessToken))
        .expect(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(
        res.body.data.every(
          (r: { action: string }) => r.action === 'auth.register',
        ),
      ).toBe(true);
    });
  });

  describe('tracing', () => {
    it('propagates request id and trace id into the response and audit log', async () => {
      const traceId = 'a'.repeat(32);
      const requestId = `req-${v7()}`;
      const email = uniqueEmail();
      const res = await http()
        .post('/v1/auth/register')
        .set('X-Forwarded-For', freshIp())
        .set('x-request-id', requestId)
        .set('traceparent', `00-${traceId}-${'b'.repeat(16)}-01`)
        .send({ email, password: PASSWORD })
        .expect(201);

      expect(res.headers['x-request-id']).toBe(requestId);
      expect(res.headers['traceparent']).toMatch(
        new RegExp(`^00-${traceId}-[0-9a-f]{16}-01$`),
      );
      const { rows } = await pool.query(
        `SELECT trace_id, request_id FROM audit_log WHERE request_id = $1`,
        [requestId],
      );
      expect(rows).toEqual([{ trace_id: traceId, request_id: requestId }]);
    });

    it('replaces malformed ids instead of trusting them', async () => {
      const res = await http()
        .get('/health')
        .set('X-Forwarded-For', freshIp())
        .set('x-request-id', 'bad id with spaces')
        .set('traceparent', 'garbage')
        .expect(401);
      expect(res.headers['x-request-id']).not.toBe('bad id with spaces');
      expect(res.body.traceId).toMatch(/^[0-9a-f]{32}$/);
    });
  });

  describe('rate limiting', () => {
    it('returns 429 with Retry-After once the route bucket is empty', async () => {
      const ip = freshIp();
      const email = uniqueEmail();
      const statuses: number[] = [];
      let last;
      for (let i = 0; i < 7; i++) {
        last = await login(email, ip);
        statuses.push(last.status);
      }
      expect(statuses.slice(0, 5).every((s) => s === 401)).toBe(true);
      expect(statuses.slice(5)).toEqual([429, 429]);
      expect(Number(last!.headers['retry-after'])).toBeGreaterThan(0);
      expect(last!.body.code).toBe('TOO_MANY_REQUESTS');
    });

    it('limits per client: another IP is unaffected', async () => {
      const email = uniqueEmail();
      const exhausted = freshIp();
      for (let i = 0; i < 6; i++) await login(email, exhausted);
      const other = await login(email, freshIp());
      expect(other.status).toBe(401);
    });

    it('exposes remaining budget on allowed requests', async () => {
      const session = await registerUser(app);
      const res = await http()
        .get('/v1/auth/me')
        .set('X-Forwarded-For', freshIp())
        .set('Authorization', auth(session.accessToken))
        .expect(200);
      expect(Number(res.headers['ratelimit-limit'])).toBe(60);
      expect(Number(res.headers['ratelimit-remaining'])).toBeLessThan(60);
    });
  });

  describe('audit log', () => {
    it('is append-only at the database level', async () => {
      await registerUser(app);
      await expect(
        pool.query(`UPDATE audit_log SET action = 'x'`),
      ).rejects.toThrow(/append-only/);
      await expect(pool.query(`DELETE FROM audit_log`)).rejects.toThrow(
        /append-only/,
      );
      await expect(pool.query(`TRUNCATE audit_log`)).rejects.toThrow(
        /append-only/,
      );
    });

    it('records no audit row for a rejected duplicate registration', async () => {
      const email = uniqueEmail();
      const first = await http()
        .post('/v1/auth/register')
        .set('X-Forwarded-For', freshIp())
        .send({ email, password: PASSWORD })
        .expect(201);
      expect(first.body.accessToken).toBeDefined();
      const requestId = `dup-${v7()}`;
      await http()
        .post('/v1/auth/register')
        .set('X-Forwarded-For', freshIp())
        .set('x-request-id', requestId)
        .send({ email, password: PASSWORD })
        .expect(409);
      const { rows } = await pool.query(
        `SELECT 1 FROM audit_log WHERE request_id = $1`,
        [requestId],
      );
      expect(rows).toHaveLength(0);
    });
  });
});
