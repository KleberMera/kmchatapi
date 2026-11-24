import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import * as QRCode from 'qrcode';
import { SessionManagerService } from './session-manager.service.js';

@Controller('sessions')
export class SessionManagerController {
  constructor(private readonly sessionManager: SessionManagerService) {}

  // POST /sessions (body: { userId, name })
  // Crea una nueva sesión de WhatsApp para un usuario.
  // Devuelve el registro de la sesión con su sessionId.
  @Post()
  async create(@Body() body: { userId: string; name: string }) {
    return this.sessionManager.createSession(body.userId, body.name);
  }

  // GET /sessions/user/:userId
  // Devuelve todas las sesiones de WhatsApp que pertenecen a un usuario.
  @Get('user/:userId')
  async findByUser(@Param('userId') userId: string) {
    return this.sessionManager.findSessionsByUserId(userId);
  }

  // GET /sessions/:sessionId/status
  // Devuelve el estado actual de la sesión (status + hasQr).
  @Get(':sessionId/status')
  async status(@Param('sessionId') sessionId: string) {
    return this.sessionManager.getSessionStatus(sessionId);
  }

  // GET /sessions/:sessionId/qr-view
  // Renderiza el QR como HTML para escanearlo desde el navegador.
  // Usa @Res() para saltarse el ResponseInterceptor y devolver HTML puro.
  @Get(':sessionId/qr-view')
  async qrView(@Param('sessionId') sessionId: string, @Res() res: Response) {
    const qr = this.sessionManager.getQr(sessionId);

    if (!qr) {
      return res.send(`
        <html><body style="text-align:center;padding:40px;font-family:sans-serif;">
          <h2>No hay QR disponible</h2>
          <p>La sesión ya está conectada o aún no se ha generado un QR.</p>
        </body></html>
      `);
    }

    // Generamos la imagen del QR como Data URL (base64)
    const dataUrl = await QRCode.toDataURL(qr, { width: 300, margin: 2 });
    res.send(`
      <html><body style="text-align:center;padding:40px;font-family:sans-serif;">
        <h2>Escanea este QR para la sesión ${sessionId}</h2>
        <img src="${dataUrl}" />
        <p>WhatsApp → Dispositivos vinculados</p>
      </body></html>
    `);
  }

  // POST /sessions/:sessionId/send (body: { phone, message })
  // Envía un mensaje usando una sesión específica.
  @Post(':sessionId/send')
  async send(
    @Param('sessionId') sessionId: string,
    @Body() body: { phone: string; message: string },
  ) {
    await this.sessionManager.sendMessage(sessionId, body.phone, body.message);
    return { sent: true, from: sessionId, to: body.phone };
  }

  // DELETE /sessions/:sessionId
  // Elimina la sesión (cierra cliente, borra credenciales y registro en BD).
  @Delete(':sessionId')
  async remove(@Param('sessionId') sessionId: string) {
    await this.sessionManager.deleteSession(sessionId);
    return { deleted: true, sessionId };
  }

  // GET /sessions/:sessionId/qr
  // Devuelve el QR como Data URL (base64) en JSON, o null si no hay QR.
  // El frontend lo usa para mostrar el QR dentro de su propia UI.
  @Get(':sessionId/qr')
  async qrJson(@Param('sessionId') sessionId: string) {
    const qr = this.sessionManager.getQr(sessionId);
    const status = await this.sessionManager.getSessionStatus(sessionId);

    // Si no hay QR, devolvemos la info necesaria para que el frontend
    // decida qué mostrar (por ejemplo: "ya está conectada" o "esperando QR").
    if (!qr) {
      return {
        hasQr: false,
        status: status.status,
        qr: null,
      };
    }

    // Generamos la imagen del QR como Data URL (base64)
    const dataUrl = await QRCode.toDataURL(qr, { width: 300, margin: 2 });

    return {
      hasQr: true,
      status: status.status,
      qr: dataUrl, // string base64 listo para <img src="...">
    };
  }

  // POST /sessions/:sessionId/restart
  // Re-inicializa el cliente si no está activo en memoria.
  // Útil cuando la sesión quedó en 'P' tras un reinicio del servidor.
  @Post(':sessionId/restart')
  async restart(@Param('sessionId') sessionId: string) {
    const session = await this.sessionManager.getSessionStatus(sessionId);
    if (session.status === 'R') {
      return { restarted: false, message: 'La sesión ya está conectada' };
    }
    await this.sessionManager.restartSession(sessionId);
    return { restarted: true, sessionId };
  }
}
