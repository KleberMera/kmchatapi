import type { Repository } from 'typeorm';
import { SessionManagerService } from './session-manager.service.js';
import { WhatsappSession } from './entities/whatsapp-session.entity.js';

describe('SessionManagerService', () => {
  it('closes and removes a session that is still waiting for its QR', async () => {
    const sessionRepo = {
      delete: vi.fn().mockResolvedValue({ affected: 1 }),
    } as unknown as Repository<WhatsappSession>;
    const service = new SessionManagerService(sessionRepo);
    const destroy = vi.fn().mockResolvedValue(undefined);
    const logout = vi.fn().mockResolvedValue(undefined);
    const cancelInitialization = vi.fn();

    service['managedClients'].set(
      'session-1',
      {
        client: { destroy },
        authStrategy: { logout },
        initialization: Promise.resolve(),
        cancelInitialization,
      } as never,
    );
    service['clients'].set('session-1', {} as never);
    service['pendingQrs'].set('session-1', 'pending-qr');

    await service.deleteSession('session-1');

    expect(cancelInitialization).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledTimes(2);
    expect(logout).toHaveBeenCalledOnce();
    expect(service['clients'].has('session-1')).toBe(false);
    expect(service.getQr('session-1')).toBeNull();
    expect(sessionRepo.delete).toHaveBeenCalledWith({
      sessionId: 'session-1',
    });
  });
});
