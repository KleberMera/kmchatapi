import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BulkMediaStorage } from './bulk-media.storage.js';

describe('BulkMediaStorage', () => {
  let directory: string;
  let storage: BulkMediaStorage;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'bulk-media-'));
    vi.spyOn(process, 'cwd').mockReturnValue(directory);
    vi.stubEnv('BULK_MEDIA_DIR', join(directory, 'external'));
    storage = new BulkMediaStorage();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it('stores videos in the project directory regardless of BULK_MEDIA_DIR', async () => {
    const video = Buffer.from('video-content');
    const key = await storage.save(video);

    await expect(
      access(join(directory, 'bulk-media', `${key}.video`)),
    ).resolves.toBeUndefined();
    expect(await storage.read(key)).toEqual(video);
    await storage.remove(key);
    await expect(storage.read(key)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects keys that could escape the media directory', async () => {
    await expect(storage.read('../secrets')).rejects.toThrow(
      'Identificador de video no válido',
    );
  });
});
