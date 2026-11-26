import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { Repository } from 'typeorm';
import { BulkController } from './bulk.controller.js';
import { BulkMediaStorage } from './bulk-media.storage.js';
import { BulkBatch } from './entities/bulk-batch.entity.js';
import { BulkMessageLog } from './entities/bulk-message-log.entity.js';
import { WhatsappSession } from '../whatsapp/entities/whatsapp-session.entity.js';

describe('BulkController', () => {
  const userId = 'c0a80101-0000-4000-8000-000000000001';
  let batchRepo: {
    findAndCount: ReturnType<typeof vi.fn>;
    findOneBy: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
  };
  let sessionRepo: { find: ReturnType<typeof vi.fn> };
  let queue: { add: ReturnType<typeof vi.fn> };
  let controller: BulkController;

  beforeEach(() => {
    batchRepo = {
      findAndCount: vi.fn().mockResolvedValue([[], 0]),
      findOneBy: vi.fn().mockResolvedValue(null),
      create: vi.fn((batch) => ({ id: 'batch-id', ...batch })),
      save: vi.fn((batch) => Promise.resolve(batch)),
    };
    sessionRepo = {
      find: vi.fn().mockResolvedValue([{ sessionId: 'session-a' }]),
    };
    queue = { add: vi.fn().mockResolvedValue(undefined) };
    controller = new BulkController(
      queue as unknown as Queue,
      batchRepo as unknown as Repository<BulkBatch>,
      {} as Repository<BulkMessageLog>,
      {} as BulkMediaStorage,
      sessionRepo as unknown as Repository<WhatsappSession>,
    );
  });

  it('associates a new batch with the user who owns its sessions', async () => {
    const config = {
      sessionIds: ['session-a'],
      recipients: [{ phone: '123' }],
      message: 'Hello',
      delayBetweenMessagesMs: 0,
      batchSize: 1,
      longPauseMs: 0,
      verifyDelayMs: 0,
    };

    await controller.start(config, userId);

    expect(sessionRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId, sessionId: expect.anything() },
      }),
    );
    expect(batchRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ config, userId }),
    );
    expect(queue.add).toHaveBeenCalledOnce();
  });

  it('scopes the campaign history to the requested user', async () => {
    await controller.findAll('1', '20', userId);

    expect(batchRepo.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId } }),
    );
  });

  it('does not expose a batch owned by a different user', async () => {
    await expect(controller.getStatus('batch-id', userId)).rejects.toThrow(
      NotFoundException,
    );
    expect(batchRepo.findOneBy).toHaveBeenCalledWith({
      id: 'batch-id',
      userId,
    });
  });

  it('requires a valid user ID before querying campaigns', async () => {
    await expect(controller.findAll('1', '20')).rejects.toThrow(
      BadRequestException,
    );
    expect(batchRepo.findAndCount).not.toHaveBeenCalled();
  });
});
