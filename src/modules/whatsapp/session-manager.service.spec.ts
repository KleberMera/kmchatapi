import type { Repository } from 'typeorm';
import { SessionManagerService } from './session-manager.service.js';
import { WhatsappSession } from './entities/whatsapp-session.entity.js';

describe('SessionManagerService', () => {
  it('sends an optional video with its caption', async () => {
    const service = new SessionManagerService(
      {} as Repository<WhatsappSession>,
    );
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    service['clients'].set('session-1', { sendMessage } as never);

    await service.sendVideo('session-1', '593999000001', 'Caption', {
      data: 'Y2xpcA==',
      mimetype: 'video/mp4',
      filename: 'promo.mp4',
      filesize: 4,
    });

    expect(sendMessage).toHaveBeenCalledWith(
      '593999000001@c.us',
      expect.objectContaining({
        mimetype: 'video/mp4',
        data: 'Y2xpcA==',
        filename: 'promo.mp4',
      }),
      { caption: 'Caption' },
    );
  });

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
