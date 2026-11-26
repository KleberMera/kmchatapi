import type { Repository } from 'typeorm';
import { BulkSenderService } from './bulk-sender.service.js';
import { BulkBatch } from './entities/bulk-batch.entity.js';
import { BulkMessageLog } from './entities/bulk-message-log.entity.js';
import { SessionManagerService } from '../whatsapp/session-manager.service.js';
import { BulkMediaStorage } from './bulk-media.storage.js';

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
      getSessionDetails: vi.fn().mockResolvedValue(
        new Map([
          [
            'session-a',
            { phoneNumber: '593991111111', name: 'Sesion A' },
          ],
          [
            'session-b',
            { phoneNumber: '593992222222', name: 'Sesion B' },
          ],
        ]),
      ),
      verifyNumber: vi
        .fn(async (_sessionId: string, phone: string) => phone)
        .mockRejectedValueOnce(new Error('sendIq called before startComms')),
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
      { read: vi.fn() } as unknown as BulkMediaStorage,
    );

    await service.processBatch('batch-1');

    expect(
      sessionManagerMock.sendMessage.mock.calls.map(([sessionId]) => sessionId),
    ).toEqual(['session-b', 'session-a', 'session-b', 'session-a']);
    expect(
      sessionManagerMock.verifyNumber.mock.calls.map(([sessionId]) => sessionId),
    ).toEqual([
      'session-a',
      'session-b',
      'session-a',
      'session-b',
      'session-a',
    ]);
    expect(logRepo.save.mock.calls.map(([log]) => log)).toEqual([
      {
        batchId: 'batch-1',
        phoneNumber: '111',
        sessionId: 'session-a',
        sessionPhoneNumber: '593991111111',
        sessionName: 'Sesion A',
        status: 'FAILED',
        errorMessage: 'Error de verificación: sendIq called before startComms',
      },
      {
        batchId: 'batch-1',
        phoneNumber: '111',
        sessionId: 'session-b',
        sessionPhoneNumber: '593992222222',
        sessionName: 'Sesion B',
        status: 'SENT',
      },
      {
        batchId: 'batch-1',
        phoneNumber: '222',
        sessionId: 'session-a',
        sessionPhoneNumber: '593991111111',
        sessionName: 'Sesion A',
        status: 'SENT',
      },
      {
        batchId: 'batch-1',
        phoneNumber: '333',
        sessionId: 'session-b',
        sessionPhoneNumber: '593992222222',
        sessionName: 'Sesion B',
        status: 'SENT',
      },
      {
        batchId: 'batch-1',
        phoneNumber: '444',
        sessionId: 'session-a',
        sessionPhoneNumber: '593991111111',
        sessionName: 'Sesion A',
        status: 'SENT',
      },
    ]);
  });

  it('sends without checking the recipient when verification is disabled', async () => {
    const batch = {
      id: 'batch-no-verify',
      status: 'PENDING',
      runToken: null,
      config: {
        sessionIds: ['session-a'],
        recipients: [{ phone: '111' }],
        message: 'Hello',
        delayBetweenMessagesMs: 0,
        batchSize: 1,
        longPauseMs: 0,
        verifyDelayMs: 0,
        verifyNumbers: false,
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
      clients: new Map([['session-a', {}]]),
      getSessionDetails: vi.fn().mockResolvedValue(new Map()),
      verifyNumber: vi.fn(),
      sendMessage: vi.fn().mockResolvedValue(undefined),
    };
    const service = new BulkSenderService(
      batchRepo as unknown as Repository<BulkBatch>,
      logRepo as unknown as Repository<BulkMessageLog>,
      sessionManagerMock as unknown as SessionManagerService,
      { read: vi.fn() } as unknown as BulkMediaStorage,
    );

    await service.processBatch(batch.id);

    expect(sessionManagerMock.verifyNumber).not.toHaveBeenCalled();
    expect(sessionManagerMock.sendMessage).toHaveBeenCalledWith(
      'session-a',
      '111',
      'Hello',
    );
    expect(batch.status).toBe('COMPLETED');
    expect(logRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'SENT', phoneNumber: '111' }),
    );
  });

  it('finishes the current message and preserves PAUSED status', async () => {
    const batch = {
      id: 'batch-pause',
      status: 'PENDING',
      runToken: null,
      config: {
        sessionIds: ['session-a'],
        recipients: [{ phone: '111' }, { phone: '222' }],
        message: 'Hello',
        delayBetweenMessagesMs: 0,
        batchSize: 2,
        longPauseMs: 0,
        verifyDelayMs: 0,
        verifyNumbers: false,
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
      clients: new Map([['session-a', {}]]),
      getSessionDetails: vi.fn().mockResolvedValue(new Map()),
      sendMessage: vi.fn(async () => {
        batch.status = 'PAUSED';
      }),
    };
    const service = new BulkSenderService(
      batchRepo as unknown as Repository<BulkBatch>,
      logRepo as unknown as Repository<BulkMessageLog>,
      sessionManagerMock as unknown as SessionManagerService,
      { read: vi.fn() } as unknown as BulkMediaStorage,
    );

    await service.processBatch(batch.id);

    expect(sessionManagerMock.sendMessage).toHaveBeenCalledTimes(1);
    expect(batch.processed).toBe(1);
    expect(batch.sent).toBe(1);
    expect(batch.status).toBe('PAUSED');
  });
});
