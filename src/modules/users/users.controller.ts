import { Body, Controller, Get, Post, Param } from '@nestjs/common';
import { UsersService } from './users.service.js';
import { CreateUserDto } from './dto/create-user.dto.js';


@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // POST /api/users
  // Crea un nuevo usuario.
  // El DTO valida que firstName, lastName, username y password
  // cumplan las reglas definidas antes de llegar aquí.
  @Post()
  async create(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }

  // GET /api/users
  // Lista todos los usuarios (sin passwords).
  @Get()
  async findAll() {
    return this.usersService.findAll();
  }

  // GET /api/users/:id
  // Obtiene un usuario por su ID.
  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.usersService.findById(id);
  }
}