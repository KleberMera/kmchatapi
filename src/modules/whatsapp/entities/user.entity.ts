import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';
import { WhatsappSession } from './whatsapp-session.entity.js';

// Entidad que representa a un usuario del sistema.
// Un usuario puede tener muchas sesiones de WhatsApp vinculadas.
@Entity()
export class User {
  // ID único generado automáticamente como UUID
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Nombres del usuario
  @Column()
  firstName: string;

  // Apellidos del usuario
  @Column()
  lastName: string;

  // Nombre de usuario único para login (reemplaza al email)
  @Column({ unique: true })
  username: string;

  // Contraseña hasheada (nunca en texto plano)
  @Column()
  password: string;

  // Estado del usuario en un solo carácter.
  // 'A' = Active, 'I' = Inactive
  @Column({ type: 'char', length: 1, default: 'A' })
  status: string;

  // Relación uno-a-muchos: un usuario tiene muchas sesiones de WhatsApp.
  // La relación inversa se define en WhatsappSession.user
  @OneToMany(() => WhatsappSession, (session) => session.user)
  sessions: WhatsappSession[];
}