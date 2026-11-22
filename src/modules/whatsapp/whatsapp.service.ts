import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as whatsappWeb from 'whatsapp-web.js';
import * as qrcode from 'qrcode-terminal';

// whatsapp-web.js es CommonJS. Al importarlo como namespace en ESM,
// las clases pueden estar en el nivel superior o dentro de .default.
// Esta línea cubre ambos casos.
const wwjs = (whatsappWeb as any).default ?? whatsappWeb;

const { Client, LocalAuth } = wwjs;

type WAClient = whatsappWeb.Client;
type WAState = whatsappWeb.WAState;


@Injectable() // Le dice a Nest que esta clase puede ser inyectada en otras clases
export class WhatsappService implements OnModuleInit {
  // Logger con el nombre de la clase como contexto. Así los logs salen como:
  // [WhatsappService] mensaje...
  private readonly logger = new Logger(WhatsappService.name);

  // La instancia del cliente de WhatsApp. Es privada porque solo este servicio
  // debe manipularla; el resto del mundo habla con este servicio, no con el Client.
  // Usamos WAClient (el tipo del namespace) porque al desestructurar Client
  // desde whatsappWeb, Client queda como valor de runtime y no como tipo.
  private client: WAClient;

  // Guardamos el último QR generado para poder exponerlo vía API si hace falta.
  // Es null cuando no hay QR pendiente (porque ya se autenticó o aún no se genera).
  private latestQr: string | null = null;

  // Bandera que indica si el cliente ya está autenticado y listo para enviar.
  // La usamos para rechazar envíos antes de tiempo.
  private isReady = false;

  // Nest llama a este método automáticamente al iniciar la aplicación.
  // Aquí arrancamos el cliente de WhatsApp.
  onModuleInit() {
    this.initializeClient();
  }

  private initializeClient() {
    // Creamos el cliente con dos opciones principales:
    this.client = new Client({
      // LocalAuth guarda las credenciales en la carpeta .wwebjs_auth.
      // clientId: 'default' permite tener varias sesiones después (una por id).
      authStrategy: new LocalAuth({ clientId: 'default' }),

      // Opciones de Puppeteer (el navegador headless que whatsapp-web.js controla).
      puppeteer: {
        headless: true, // sin ventana visible del navegador
        // Estos flags son necesarios cuando corres en Linux/servidores
        // sin entorno gráfico o como root. Evitan que Chromium falle al arrancar.
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      },
    });

    // Evento 'qr': se dispara cada vez que WhatsApp genera un nuevo código QR.
    // Ocurre cuando no hay sesión guardada o cuando la sesión expiró.
    // Anotamos qr como string porque la desestructuración rompe la inferencia.
    this.client.on('qr', (qr: string) => {
      this.latestQr = qr;       // guardamos el string del QR
      this.isReady = false;     // todavía no estamos listos
      this.logger.log('QR generado. Escanéalo con WhatsApp.');
      // Imprimimos el QR en la consola en formato pequeño para escanearlo
      // directamente desde la terminal del servidor.
      qrcode.generate(qr, { small: true });
    });

    // Evento 'ready': el cliente terminó de autenticarse y está listo
    // para enviar y recibir mensajes. Es el momento clave.
    this.client.on('ready', () => {
      this.isReady = true;      // ahora sí podemos enviar
      this.latestQr = null;     // ya no hay QR pendiente
      this.logger.log('✅ Cliente de WhatsApp listo');
    });

    // Evento 'authenticated': las credenciales fueron aceptadas,
    // pero 'ready' aún no ha llegado. Es informativo.
    this.client.on('authenticated', () => {
      this.logger.log('Autenticado correctamente');
    });

    // Evento 'auth_failure': la autenticación falló (QR inválido, sesión corrupta, etc.)
    // El evento entrega un string con el motivo del fallo.
    this.client.on('auth_failure', (msg: string) => {
      this.logger.error(`Fallo de autenticación: ${msg}`);
    });

    // Evento 'disconnected': el cliente se desconectó (por logout, por red, etc.)
    // Marcamos isReady en false para que los envíos fallen limpiamente.
    // El motivo es un WAState o el literal 'LOGOUT'.
    this.client.on('disconnected', (reason: WAState | 'LOGOUT') => {
      this.isReady = false;
      this.logger.warn(`Cliente desconectado: ${reason}`);
    });

    // initialize() arranca Puppeteer, carga la sesión y empieza a emitir eventos.
    // Es asíncrono internamente, pero no necesitamos await aquí porque
    // los eventos nos avisan cuando está listo.
    this.client.initialize();
  }

  // Devuelve el estado actual para el endpoint GET /whatsapp/status
  getStatus() {
    return {
      connected: this.isReady,           // true si ya está autenticado
      hasQr: Boolean(this.latestQr),     // true si hay un QR esperando escaneo
    };
  }

  // Devuelve el QR actual (o null) para el endpoint GET /whatsapp/qr
  getQr() {
    return { qr: this.latestQr };
  }

  // Envía un mensaje de texto a un número.
  async sendMessage(phone: string, message: string): Promise<void> {
    // Si el cliente no está listo, lanzamos un error que el filtro global
    // convertirá en una respuesta { data: null, message, status: 500 }.
    if (!this.isReady) {
      throw new Error('WhatsApp no está conectado todavía');
    }

    // Convertimos el número al formato que espera whatsapp-web.js
    const chatId = this.toChatId(phone);

    // sendMessage devuelve una promesa que se resuelve cuando el mensaje
    // fue aceptado por el cliente (no garantiza que el destinatario lo leyó).
    await this.client.sendMessage(chatId, message);

    this.logger.log(`Mensaje enviado a ${chatId}`);
  }

  // Convierte "593987654321" o "+593 98 765 4321" a "593987654321@c.us"
  private toChatId(phone: string): string {
    // replace(/\D/g, '') elimina todo lo que no sea dígito
    const digits = phone.replace(/\D/g, '');
    if (!digits) throw new Error('Número inválido');
    // whatsapp-web.js usa el sufijo @c.us para chats individuales
    return `${digits}@c.us`;
  }
}