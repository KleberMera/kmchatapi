import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { User } from './user.entity.js';

// Entidad que representa una sesión de WhatsApp vinculada a un usuario.
// Cada sesión tiene su propio clientId en LocalAuth (credenciales en disco).
@Entity()
export class WhatsappSession {
  // ID único generado automáticamente como UUID
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // ID que se usa como clientId en LocalAuth.
  // Debe ser único y seguro (solo alfanumérico, guiones, guiones bajos).
  @Column({ unique: true })
  sessionId: string;

  // Nombre visible de la sesión. Nullable para conservar sesiones existentes.
  @Column({ nullable: true })
  name: string | null;

  // Número de teléfono vinculado (se llena cuando el cliente está ready).
  // Nullable porque al crear la sesión aún no hay número.
  @Column({ nullable: true })
  phoneNumber: string;

  // Estado de la sesión en un solo carácter.
  // 'P' = Pending, 'R' = Ready, 'D' = Disconnected, 'F' = Failed
  @Column({ type: 'char', length: 1, default: 'P' })
  status: string;

  // Relación muchos-a-uno: muchas sesiones pertenecen a un usuario.
  // onDelete CASCADE borra las sesiones si se elimina el usuario.
  @ManyToOne(() => User, (user) => user.sessions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  // Columna explícita para el userId (facilita consultas sin cargar la relación)
  @Column()
  userId: string;
}