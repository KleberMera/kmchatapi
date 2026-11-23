import {
  Injectable,
  Logger,
  OnModuleInit,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as whatsappWeb from 'whatsapp-web.js';
import * as qrcode from 'qrcode-terminal';
import { WhatsappSession } from './entities/whatsapp-session.entity.js';
import { SESSION_STATUS } from '../../common/constants/status.constants.js';

// whatsapp-web.js es CommonJS. Al importarlo como namespace en ESM,
// las clases pueden estar en el nivel superior o dentro de .default.
const wwjs = (whatsappWeb as any).default ?? whatsappWeb;
const { Client, LocalAuth } = wwjs;

// Tipos tomados del namespace para no usar el valor desestructurado como tipo
type WAClient = whatsappWeb.Client;
type WAState = whatsappWeb.WAState;

@Injectable()
export class SessionManagerService implements OnModuleInit {
  private readonly logger = new Logger(SessionManagerService.name);

  // Mapa en memoria: sessionId (de la BD) -> instancia del Client activo
  private clients = new Map<string, WAClient>();

  // Mapa para guardar los QRs pendientes mientras el cliente no está listo
  private pendingQrs = new Map<string, string>();

  // Inyectamos el repositorio de WhatsappSession para persistir metadatos
  constructor(
    @InjectRepository(WhatsappSession)
    private sessionRepo: Repository<WhatsappSession>,
  ) {}

  // Al arrancar la app, restauramos las sesiones que estaban activas en la BD.
  // LocalAuth cargará las credenciales del disco y el cliente se reconectará
  // sin pedir QR de nuevo (siempre que la sesión no haya expirado).
  async onModuleInit() {
    const activeSessions = await this.sessionRepo.find({
      where: { status: SESSION_STATUS.READY },
    });

    for (const session of activeSessions) {
      this.logger.log(`Restaurando sesión: ${session.sessionId}`);
      this.initializeClient(session.sessionId, session.userId).catch((err) =>
        this.logger.error(
          `Error restaurando ${session.sessionId}: ${err.message}`,
        ),
      );
    }
  }

  // Crea una nueva sesión de WhatsApp para un usuario.
  // Genera un sessionId seguro, lo guarda en BD y arranca el cliente.
  async createSession(userId: string): Promise<WhatsappSession> {
    // Generamos un ID único y seguro para LocalAuth.
    // Solo usamos caracteres alfanuméricos para evitar problemas con rutas.
    const sessionId = `session-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

    // Guardamos el registro en la BD primero, con estado Pending
    const session = this.sessionRepo.create({
      sessionId,
      userId,
      status: SESSION_STATUS.PENDING,
    });
    await this.sessionRepo.save(session);

    // Arrancamos el cliente de WhatsApp en segundo plano.
    // Si falla, el estado en BD se actualizará a Failed por el evento auth_failure.
    this.initializeClient(sessionId, userId).catch((err) =>
      this.logger.error(`Error creando sesión ${sessionId}: ${err.message}`),
    );

    return session;
  }

  // Lógica central: crear el Client y enganchar los eventos.
  // Se llama tanto al crear una sesión nueva como al restaurar una existente.
  private async initializeClient(
    sessionId: string,
    userId: string,
  ): Promise<void> {
    // Si ya existe un cliente activo para este sessionId, no hacemos nada.
    // Esto evita crear dos navegadores apuntando a la misma sesión.
    if (this.clients.has(sessionId)) return;

    // Devolvemos una Promise que se resolverá cuando el cliente esté 'ready'
    // y se rechazará si falla la autenticación o se desconecta durante el arranque.
    // Así, onModuleInit puede esperar realmente a que una sesión termine
    // antes de pasar a la siguiente (serialización).
    return new Promise((resolve, reject) => {
      const client = new Client({
        // LocalAuth aísla las credenciales en una carpeta distinta por clientId.
        // La carpeta resultante será .wwebjs_auth/session-{sessionId}
        authStrategy: new LocalAuth({ clientId: sessionId }),
        puppeteer: {
          headless: true,
          // Flags necesarios en Linux/servidores sin entorno gráfico o como root
          args: ['--no-sandbox', '--disable-setuid-sandbox'],
          // Timeout más largo (60s) para dar margen a WhatsApp Web a cargar.
          // El valor por defecto de 30s a veces no es suficiente en la primera ejecución.
          //timeout: 60000,
        },
      });

      // Bandera para evitar rechazar la promesa dos veces si se disparan
      // varios eventos de error durante la inicialización.
      let settled = false;

      // Evento QR: se dispara cuando WhatsApp genera un nuevo código QR.
      // Guardamos el QR en el mapa y lo imprimimos en consola.
      client.on('qr', (qr: string) => {
        this.pendingQrs.set(sessionId, qr);
        this.logger.log(`QR generado para sesión ${sessionId}`);
        qrcode.generate(qr, { small: true });
      });

      // Evento ready: el cliente terminó de autenticarse y está listo.
      // Actualizamos la BD con el número de teléfono y el estado Ready,
      // y resolvemos la promesa para que onModuleInit pueda continuar.
      client.on('ready', async () => {
        // Evitamos resolver dos veces si por alguna razón el evento se repite
        if (settled) return;
        settled = true;

        // Limpiamos el QR pendiente (ya no hace falta)
        this.pendingQrs.delete(sessionId);

        // Registramos el cliente en el mapa de clientes activos
        this.clients.set(sessionId, client);

        // Obtenemos la info del usuario de WhatsApp para guardar el número.
        // client.info.wid.user contiene el número sin el sufijo @c.us
        const info = client.info;
        await this.sessionRepo.update(
          { sessionId },
          { status: SESSION_STATUS.READY, phoneNumber: info.wid.user },
        );

        this.logger.log(`✅ Sesión ${sessionId} lista (${info.wid.user})`);

        // Resolvemos la promesa: la inicialización terminó con éxito
        resolve();
      });

      // Evento authenticated: las credenciales fueron aceptadas.
      // Es informativo, no cambia el estado de la promesa.
      client.on('authenticated', () => {
        this.logger.log(
          `Sesión ${sessionId} autenticada, esperando 'ready'...`,
        );
      });

      // Evento auth_failure: la autenticación falló (QR inválido, sesión corrupta).
      // Marcamos la sesión como Failed en BD y rechazamos la promesa.
      client.on('auth_failure', async (msg: string) => {
        if (settled) return;
        settled = true;

        this.pendingQrs.delete(sessionId);
        await this.sessionRepo.update(
          { sessionId },
          { status: SESSION_STATUS.FAILED },
        );
        this.logger.error(`Fallo de autenticación en ${sessionId}: ${msg}`);

        // Rechazamos con un Error para que onModuleInit lo capture
        reject(new Error(`Auth failure en ${sessionId}: ${msg}`));
      });

      // Evento disconnected: el cliente se desconectó.
      // Si ocurre durante la inicialización (el cliente aún no está en el mapa),
      // rechazamos la promesa. Si ocurre después (ya estaba listo), solo
      // actualizamos el estado en BD y limpiamos el mapa.
      client.on('disconnected', async (reason: WAState | 'LOGOUT') => {
        this.clients.delete(sessionId);
        this.pendingQrs.delete(sessionId);
        await this.sessionRepo.update(
          { sessionId },
          { status: SESSION_STATUS.DISCONNECTED },
        );
        this.logger.warn(`Sesión ${sessionId} desconectada: ${reason}`);

        // Solo rechazamos si aún no se había resuelto (estaba inicializando)
        if (!settled) {
          settled = true;
          reject(
            new Error(`Disconnected durante init en ${sessionId}: ${reason}`),
          );
        }
      });

      // initialize() arranca Puppeteer y comienza a emitir eventos.
      // Si falla el arranque (por ejemplo, Chrome no encontrado), rechazamos.
      client.initialize().catch((err: any) => {
        if (!settled) {
          settled = true;
          reject(err);
        }
      });
    });
  }

  // Devuelve el estado de una sesión consultando primero la BD.
  // Si la sesión no existe, lanza NotFoundException (404).
  async getSessionStatus(
    sessionId: string,
  ): Promise<{ status: string; hasQr: boolean }> {
    const session = await this.sessionRepo.findOne({ where: { sessionId } });
    if (!session) {
      throw new NotFoundException(`Sesión ${sessionId} no encontrada`);
    }
    return {
      status: session.status,
      hasQr: this.pendingQrs.has(sessionId),
    };
  }

  // Devuelve el QR pendiente de una sesión (o null si no hay).
  // El controlador lo usa para renderizar el QR como imagen.
  getQr(sessionId: string): string | null {
    return this.pendingQrs.get(sessionId) ?? null;
  }

  // Envía un mensaje usando el cliente correspondiente a la sesión.
  // Si la sesión no está activa en memoria, lanza un error.
  async sendMessage(
    sessionId: string,
    phone: string,
    message: string,
  ): Promise<void> {
    const client = this.clients.get(sessionId);
    if (!client) {
      throw new Error(`La sesión ${sessionId} no está conectada o no existe`);
    }

    // Limpiamos el número: solo dígitos, y añadimos el sufijo @c.us
    const digits = phone.replace(/\D/g, '');
    if (!digits) throw new Error('Número inválido');
    const chatId = `${digits}@c.us`;

    await client.sendMessage(chatId, message);
    this.logger.log(`Mensaje enviado desde ${sessionId} a ${chatId}`);
  }

  // Elimina una sesión: cierra el cliente, borra la carpeta de auth y el registro en BD.
  async deleteSession(sessionId: string): Promise<void> {
    const client = this.clients.get(sessionId);
    if (client) {
      try {
        // logout() también borra la carpeta de sesión con LocalAuth
        await client.logout();
      } catch (err) {
        this.logger.error(`Error cerrando cliente ${sessionId}: ${err}`);
      }
      this.clients.delete(sessionId);
    }
    this.pendingQrs.delete(sessionId);
    await this.sessionRepo.delete({ sessionId });
  }
}
