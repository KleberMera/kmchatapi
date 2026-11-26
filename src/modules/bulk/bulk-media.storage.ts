import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

@Injectable()
export class BulkMediaStorage {
  private readonly directory = resolve(process.cwd(), 'bulk-media');

  async save(data: Buffer): Promise<string> {
    await mkdir(this.directory, { recursive: true });
    const key = randomUUID();
    await writeFile(this.getPath(key), data, { flag: 'wx' });
    return key;
  }

  read(key: string): Promise<Buffer> {
    return readFile(this.getPath(key));
  }

  async remove(key: string): Promise<void> {
    try {
      await unlink(this.getPath(key));
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return;
      }
      throw error;
    }
  }

  private getPath(key: string): string {
    if (!/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(key)) {
      throw new Error('Identificador de video no válido');
    }
    const path = resolve(this.directory, `${key}.video`);
    if (!path.startsWith(`${this.directory}${sep}`)) {
      throw new Error('La ruta del video está fuera del almacenamiento permitido');
    }
    return join(this.directory, `${key}.video`);
  }
}
