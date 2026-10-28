// Runs before every e2e file. DATABASE_URL and REDIS_URL must point at
// disposable instances: tests create users and audit rows.
for (const name of ['DATABASE_URL', 'REDIS_URL']) {
  if (!process.env[name]) throw new Error(`${name} is required for e2e tests`);
}
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.TRUST_PROXY_HOPS = '1';
process.env.TOKEN_CLEANUP_INTERVAL_MINUTES = '0';
process.env.JWT_ACCESS_SECRET ??= 'e2e-secret-e2e-secret-e2e-secret-e2e';
