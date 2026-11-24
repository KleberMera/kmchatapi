import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from '../whatsapp/entities/user.entity.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { USER_STATUS } from '../../common/constants/status.constants.js';

@Injectable()
export class UsersService {
  constructor(
    // Inyectamos el repositorio de User para interactuar con la tabla
    @InjectRepository(User)
    private userRepo: Repository<User>,
  ) {}

  // Crea un nuevo usuario en la base de datos.
  // 1. Verifica que el username no exista.
  // 2. Hashea la contraseña.
  // 3. Guarda el usuario con estado 'A' (Active).
  async create(createUserDto: CreateUserDto): Promise<User> {
    const { username, password, firstName, lastName } = createUserDto;

    // Verificamos si el username ya está en uso
    const existing = await this.userRepo.findOne({ where: { username } });
    if (existing) {
      throw new ConflictException(`El username "${username}" ya está en uso`);
    }

    // Hasheamos la contraseña con bcrypt.
    // 10 salt rounds es un buen equilibrio entre seguridad y velocidad.
    // Nunca guardamos la contraseña en texto plano.
    const hashedPassword = await bcrypt.hash(password, 10);

    // Creamos la instancia del usuario.
    // Usamos create() para que TypeORM prepare la entidad,
    // pero aún no la guarda en la BD.
    const user = this.userRepo.create({
      firstName,
      lastName,
      username,
      password: hashedPassword,
      status: USER_STATUS.ACTIVE, // 'A'
    });

    // save() persiste el usuario en la base de datos
    const saved = await this.userRepo.save(user);

    // No devolvemos el password en la respuesta
    const { password: _, ...result } = saved;
    return result as User;
  }

  // Busca un usuario por su username.
  // Lo usa el AuthService para validar credenciales en el login.
  async findByUsername(username: string): Promise<User | null> {
    return this.userRepo.findOne({ where: { username } });
  }

  // Busca un usuario por su ID.
  // Útil para endpoints que necesitan los datos del usuario autenticado.
  async findById(id: string): Promise<User> {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }
    // No devolvemos el password
    const { password: _, ...result } = user;
    return result as User;
  }

  // Devuelve todos los usuarios (sin passwords).
  // Por ahora lo dejamos simple; después puedes añadir paginación.
  async findAll(): Promise<User[]> {
    const users = await this.userRepo.find();
    return users.map(({ password: _, ...user }) => user as User);
  }
}