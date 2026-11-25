import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

// Representa un lote de envío masivo.
// Guarda la configuración, el progreso y el estado global.
@Entity()
export class BulkBatch {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Configuración del envío (todo lo que el usuario eligió en el frontend)
  @Column({ type: 'jsonb' })
  config: {
    sessionIds: string[];
    // Array de destinatarios. Cada uno tiene teléfono + campos dinámicos
    // (nombre, apellido, empresa, etc.) que vienen del Excel.
    recipients: Array<{
      phone: string;
      [key: string]: string;
    }>;
    message: string; // Plantilla con placeholders como {nombre}, {apellido}
    delayBetweenMessagesMs: number;
    batchSize: number;
    longPauseMs: number;
    verifyDelayMs: number;
  };

  // Contadores para el frontend
  @Column({ default: 0 }) total: number;
  @Column({ default: 0 }) processed: number;
  @Column({ default: 0 }) sent: number;
  @Column({ default: 0 }) failed: number;
  @Column({ default: 0 }) invalid: number;

  // Estado del lote: 'PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'
  @Column({ default: 'PENDING' })
  status: string;

  // Sesión que está enviando en este momento (para mostrar en el frontend)
  @Column({ nullable: true })
  currentSessionId: string;

  @CreateDateColumn()
  createdAt: Date;
}
