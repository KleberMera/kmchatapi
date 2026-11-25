import type { Repository } from 'typeorm';
import { BulkSenderService } from './bulk-sender.service.js';
import { BulkBatch } from './entities/bulk-batch.entity.js';
import { BulkMessageLog } from './entities/bulk-message-log.entity.js';
import { SessionManagerService } from '../whatsapp/session-manager.service.js';

describe('BulkSenderService', () => {
  it('rotates sessions after each sent message, including across batch pauses', async () => {
    const batch = {
      id: 'batch-1',
      status: 'PENDING',
      config: {
        sessionIds: ['session-a', 'session-b'],
        recipients: [
          { phone: '111' },
          { phone: '222' },
          { phone: '333' },
          { phone: '444' },
        ],
        message: 'Hello',
        delayBetweenMessagesMs: 0,
        batchSize: 2,
        longPauseMs: 0,
        verifyDelayMs: 0,
      },
      sent: 0,
      failed: 0,
      invalid: 0,
      processed: 0,
      currentSessionId: '',
    } as BulkBatch;
    const batchRepo = {
      findOneBy: vi.fn().mockResolvedValue(batch),
      save: vi.fn().mockResolvedValue(batch),
    };
    const logRepo = { save: vi.fn().mockResolvedValue(undefined) };
    const sessionManagerMock = {
      clients: new Map([
        ['session-a', {}],
        ['session-b', {}],
      ]),
      verifyNumber: vi.fn(async (_sessionId: string, phone: string) => phone),
      sendMessage: vi.fn(
        async (_sessionId: string, _phone: string, _message: string) =>
          undefined,
      ),
    };
    const sessionManager =
      sessionManagerMock as unknown as SessionManagerService;
    const service = new BulkSenderService(
      batchRepo as unknown as Repository<BulkBatch>,
      logRepo as unknown as Repository<BulkMessageLog>,
      sessionManager,
    );

    await service.processBatch('batch-1');

    expect(
      sessionManagerMock.sendMessage.mock.calls.map(([sessionId]) => sessionId),
    )
      .toEqual(['session-a', 'session-b', 'session-a', 'session-b']);
  });
});
