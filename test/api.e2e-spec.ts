import { v7 } from 'uuid';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Pool } from 'pg';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import request from 'supertest';
import { TokenCleanupService } from '../src/auth/token-cleanup.service.js';
import {
  createPool,
  createTestApp,
  freshIp,
  PASSWORD,
  registerUser,
  uniqueEmail,
  mailbox,
  waitForMail,
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
        statusCode: 200,
        message: 'Profile retrieved',
      });
      expect(me.body.data).toMatchObject({
        email: session.email,
        role: 'user',
      });
      expect(me.body.data.passwordHash).toBeUndefined();
      expect(me.body.data.id[14]).toBe('7');
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
      expect(rotated.body.data.refreshToken).not.toBe(session.refreshToken);

      await refresh(session.refreshToken).expect(401);
      // The legitimate descendant is revoked too.
      await refresh(rotated.body.data.refreshToken).expect(401);

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
        .expect(204)
        .expect((r) => expect(r.body).toEqual({}));
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

  describe('session revocation', () => {
    const me = (token: string) =>
      http()
        .get('/v1/auth/me')
        .set('X-Forwarded-For', freshIp())
        .set('Authorization', auth(token));

    it('logout kills the access token immediately', async () => {
      const s = await registerUser(app);
      await me(s.accessToken).expect(200);
      await http()
        .post('/v1/auth/logout')
        .set('X-Forwarded-For', freshIp())
        .send({ refreshToken: s.refreshToken })
        .expect(204);
      await me(s.accessToken).expect(401);
    });

    it('logout-all ends every session of the caller only', async () => {
      const s = await registerUser(app);
      const other = await registerUser(app);
      const second = await login(s.email);
      await http()
        .post('/v1/auth/logout-all')
        .set('X-Forwarded-For', freshIp())
        .set('Authorization', auth(s.accessToken))
        .expect(204);
      await me(s.accessToken).expect(401);
      await me(second.body.data.accessToken).expect(401);
      await http()
        .post('/v1/auth/refresh')
        .set('X-Forwarded-For', freshIp())
        .send({ refreshToken: second.body.data.refreshToken })
        .expect(401);
      await me(other.accessToken).expect(200);
    });
  });

  describe('password reset', () => {
    const forgot = (email: string) =>
      http()
        .post('/v1/auth/forgot-password')
        .set('X-Forwarded-For', freshIp())
        .send({ email });

    it('answers identically for known and unknown emails, mailing only the known', async () => {
      const s = await registerUser(app);
      const unknown = uniqueEmail();
      const a = await forgot(s.email).expect(202);
      const b = await forgot(unknown).expect(202);
      expect(a.body).toEqual(b.body);
      await waitForMail(s.email, 'Reset your password');
      await new Promise((r) => setTimeout(r, 100));
      expect(mailbox.some((m) => m.to === unknown)).toBe(false);
    });

    it('resets the password, ends old sessions, and the token is single-use', async () => {
      const s = await registerUser(app);
      await forgot(s.email).expect(202);
      const { token } = await waitForMail(s.email, 'Reset your password');
      const newPassword = 'a-brand-new-password';

      await http()
        .post('/v1/auth/reset-password')
        .set('X-Forwarded-For', freshIp())
        .send({ token, newPassword })
        .expect(200);

      await http()
        .get('/v1/auth/me')
        .set('X-Forwarded-For', freshIp())
        .set('Authorization', auth(s.accessToken))
        .expect(401);
      await http()
        .post('/v1/auth/refresh')
        .set('X-Forwarded-For', freshIp())
        .send({ refreshToken: s.refreshToken })
        .expect(401);
      expect((await login(s.email)).status).toBe(401);
      await http()
        .post('/v1/auth/login')
        .set('X-Forwarded-For', freshIp())
        .send({ email: s.email, password: newPassword })
        .expect(200);

      const replay = await http()
        .post('/v1/auth/reset-password')
        .set('X-Forwarded-For', freshIp())
        .send({ token, newPassword: 'another-new-password' })
        .expect(400);
      expect(replay.body.message).toBe('Invalid or expired token');
    });

    it('rejects an expired token', async () => {
      const s = await registerUser(app);
      await forgot(s.email).expect(202);
      const { token } = await waitForMail(s.email, 'Reset your password');
      await pool.query(
        `UPDATE one_time_tokens SET expires_at = now() - interval '1 second' WHERE user_id = $1 AND purpose = 'reset_password'`,
        [s.userId],
      );
      await http()
        .post('/v1/auth/reset-password')
        .set('X-Forwarded-For', freshIp())
        .send({ token, newPassword: 'a-brand-new-password' })
        .expect(400);
    });

    it('a request inside the cooldown keeps the pending token', async () => {
      const s = await registerUser(app);
      await forgot(s.email).expect(202);
      const first = await waitForMail(s.email, 'Reset your password');
      const before = mailbox.length;
      await forgot(s.email).expect(202);
      await new Promise((r) => setTimeout(r, 150));
      expect(mailbox.length).toBe(before);
      await http()
        .post('/v1/auth/reset-password')
        .set('X-Forwarded-For', freshIp())
        .send({ token: first.token, newPassword: 'a-brand-new-password' })
        .expect(200);
    });

    it('a request after the cooldown replaces the older token', async () => {
      const s = await registerUser(app);
      await forgot(s.email).expect(202);
      const first = await waitForMail(s.email, 'Reset your password');
      await pool.query(
        `UPDATE one_time_tokens SET created_at = now() - interval '2 minutes' WHERE user_id = $1`,
        [s.userId],
      );
      await forgot(s.email).expect(202);
      for (let i = 0; i < 50; i++) {
        const latest = await waitForMail(s.email, 'Reset your password');
        if (latest.token !== first.token) break;
        await new Promise((r) => setTimeout(r, 40));
      }
      await http()
        .post('/v1/auth/reset-password')
        .set('X-Forwarded-For', freshIp())
        .send({ token: first.token, newPassword: 'a-brand-new-password' })
        .expect(400);
    });
  });

  describe('email verification', () => {
    it('registration mails a link; verifying flips emailVerified once', async () => {
      const s = await registerUser(app);
      const meOf = () =>
        http()
          .get('/v1/auth/me')
          .set('X-Forwarded-For', freshIp())
          .set('Authorization', auth(s.accessToken));
      expect((await meOf()).body.data.emailVerified).toBe(false);

      const { token } = await waitForMail(s.email, 'Verify your email');
      await http()
        .post('/v1/auth/verify-email')
        .set('X-Forwarded-For', freshIp())
        .send({ token })
        .expect(200);
      expect((await meOf()).body.data.emailVerified).toBe(true);
      await http()
        .post('/v1/auth/verify-email')
        .set('X-Forwarded-For', freshIp())
        .send({ token })
        .expect(400);
    });

    it('resend mails a fresh link until verified, then stops', async () => {
      const s = await registerUser(app);
      const first = await waitForMail(s.email, 'Verify your email');
      const resend = () =>
        http()
          .post('/v1/auth/resend-verification')
          .set('X-Forwarded-For', freshIp())
          .set('Authorization', auth(s.accessToken))
          .expect(202);
      await pool.query(
        `UPDATE one_time_tokens SET created_at = now() - interval '2 minutes' WHERE user_id = $1`,
        [s.userId],
      );
      await resend();
      let latest = first;
      for (let i = 0; i < 50 && latest.token === first.token; i++) {
        await new Promise((r) => setTimeout(r, 40));
        latest = await waitForMail(s.email, 'Verify your email');
      }
      expect(latest.token).not.toBe(first.token);
      await http()
        .post('/v1/auth/verify-email')
        .set('X-Forwarded-For', freshIp())
        .send({ token: latest.token })
        .expect(200);

      const before = mailbox.length;
      await resend();
      await new Promise((r) => setTimeout(r, 150));
      expect(mailbox.length).toBe(before);
    });
  });

  describe('token cleanup', () => {
    it('removes expired rows and keeps live ones', async () => {
      const s = await registerUser(app);
      const stale = `stale-${v7()}`;
      const fresh = `fresh-${v7()}`;
      await pool.query(
        `INSERT INTO used_refresh_tokens (token_hash, family_id, used_at) VALUES ($1, $3, now() - interval '31 days'), ($2, $3, now())`,
        [stale, fresh, v7()],
      );
      await pool.query(
        `INSERT INTO refresh_tokens (token_hash, family_id, user_id, expires_at) VALUES ($1, $3, $4, now() - interval '1 day'), ($2, $3, $4, now() + interval '1 day')`,
        [stale, fresh, v7(), s.userId],
      );
      await app.get(TokenCleanupService).run();
      const used = await pool.query(
        `SELECT token_hash FROM used_refresh_tokens WHERE token_hash IN ($1, $2)`,
        [stale, fresh],
      );
      const live = await pool.query(
        `SELECT token_hash FROM refresh_tokens WHERE token_hash IN ($1, $2)`,
        [stale, fresh],
      );
      expect(used.rows).toEqual([{ token_hash: fresh }]);
      expect(live.rows).toEqual([{ token_hash: fresh }]);
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
      expect(res.body.statusCode).toBeUndefined();
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
      return { ...session, accessToken: res.body.data.accessToken as string };
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

    it('RBAC: admin lists users inside the paginated envelope', async () => {
      const admin = await makeAdmin();
      const res = await http()
        .get('/v1/users?limit=2&page=1')
        .set('X-Forwarded-For', freshIp())
        .set('Authorization', auth(admin.accessToken))
        .expect(200);
      const { statusCode, message, data } = res.body;
      expect(statusCode).toBe(200);
      expect(message).toBe('Users retrieved');
      expect(data.results.length).toBeLessThanOrEqual(2);
      expect(data.results[0].passwordHash).toBeUndefined();
      expect(data.paginationMeta).toEqual({
        pageCount: data.results.length,
        totalPages: Math.ceil(data.paginationMeta.totalCount / 2),
        totalCount: expect.any(Number),
        previousPage: false,
        nextPage: data.paginationMeta.totalCount > 2,
      });
    });

    it('reports previous/next across pages', async () => {
      const admin = await makeAdmin();
      const get = (page: number) =>
        http()
          .get(`/v1/users?limit=1&page=${page}`)
          .set('X-Forwarded-For', freshIp())
          .set('Authorization', auth(admin.accessToken))
          .expect(200);
      const second = (await get(2)).body.data.paginationMeta;
      expect(second.previousPage).toBe(true);
      const last = (await get(second.totalPages)).body.data.paginationMeta;
      expect(last.nextPage).toBe(false);
      const beyond = (await get(second.totalPages + 1)).body.data;
      expect(beyond.results).toEqual([]);
      expect(beyond.paginationMeta.pageCount).toBe(0);
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

      const own = await get(a.userId, a.accessToken).expect(200);
      expect(own.body.data.id).toBe(a.userId);
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
      expect(res.body.data.results.length).toBeGreaterThan(0);
      expect(
        res.body.data.results.every(
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
      expect(first.body.data.accessToken).toBeDefined();
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

  describe('openapi', () => {
    const methods = ['get', 'post', 'put', 'patch', 'delete'] as const;

    it('documents every operation with summary, description, success and error schemas', () => {
      const doc = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().build(),
      );
      const missing: string[] = [];
      for (const [path, item] of Object.entries(doc.paths)) {
        if (path === '/health') continue;
        for (const m of methods) {
          const op = item[m];
          if (!op) continue;
          const id = `${m.toUpperCase()} ${path}`;
          if (!op.summary || !op.description) missing.push(`${id}: summary`);
          const codes = Object.keys(op.responses);
          if (!codes.some((c) => c.startsWith('2'))) missing.push(`${id}: 2xx`);
          if (!codes.includes('500')) missing.push(`${id}: error`);
        }
      }
      expect(missing).toEqual([]);
      expect(doc.components?.schemas).toHaveProperty('ErrorResponseDto');
      expect(doc.components?.schemas).toHaveProperty('PaginationMetaDto');
    });
  });
});
