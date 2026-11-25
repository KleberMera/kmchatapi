import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { BulkBatch } from './bulk-batch.entity.js';

// Registra el detalle de cada mensaje individual.
@Entity()
export class BulkMessageLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => BulkBatch, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'batchId' })
  batch: BulkBatch;

  @Column()
  batchId: string;

  @Column()
  phoneNumber: string;

  // Sesión que lo envió (null si fue inválido y no se intentó enviar)
  @Column({ nullable: true })
  sessionId: string;

  // Número de WhatsApp asociado a la sesión que realizó el intento.
  @Column({ nullable: true })
  sessionPhoneNumber: string;

  // Estado: 'SENT', 'FAILED', 'INVALID'
  @Column()
  status: string;

  // Si falló, el motivo
  @Column({ nullable: true })
  errorMessage: string;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  sentAt: Date;
}
