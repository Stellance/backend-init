import type { Redis } from 'ioredis';
import { configStub } from '../../test/fake-context.js';
import { SessionRevocationService } from './session-revocation.service.js';

const config = configStub({ ACCESS_TOKEN_TTL_SECONDS: 900 });

describe('SessionRevocationService', () => {
  it('writes one expiring key per session id', async () => {
    const set = vi.fn();
    const redis = {
      pipeline: () => ({
        set,
        exec: async () => [
          [null, 'OK'],
          [null, 'OK'],
        ],
      }),
    } as unknown as Redis;
    await new SessionRevocationService(redis, config).revoke(['a', 'b']);
    expect(set).toHaveBeenCalledWith('revoked:sid:a', '1', 'EX', 960);
    expect(set).toHaveBeenCalledWith('revoked:sid:b', '1', 'EX', 960);
  });

  it('does nothing for an empty list', async () => {
    const pipeline = vi.fn();
    await new SessionRevocationService(
      { pipeline } as unknown as Redis,
      config,
    ).revoke([]);
    expect(pipeline).not.toHaveBeenCalled();
  });

  it('revoke throws on a failed pipeline command; tryRevoke swallows it', async () => {
    const redis = {
      pipeline: () => ({
        set: vi.fn(),
        exec: async () => [[new Error('boom'), null]],
      }),
    } as unknown as Redis;
    const svc = new SessionRevocationService(redis, config);
    await expect(svc.revoke(['a'])).rejects.toThrow('boom');
    await expect(svc.tryRevoke(['a'])).resolves.toBeUndefined();
  });

  it('reports revoked ids and fails open on Redis errors', async () => {
    const exists = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    const svc = new SessionRevocationService(
      { exists } as unknown as Redis,
      config,
    );
    expect(await svc.isRevoked('a')).toBe(true);
    expect(await svc.isRevoked('b')).toBe(false);
    exists.mockRejectedValueOnce(new Error('down'));
    expect(await svc.isRevoked('c')).toBe(false);
  });
});
