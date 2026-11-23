import { Body, Controller, Delete, Get, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import * as QRCode from 'qrcode';
import { SessionManagerService } from './session-manager.service.js';

@Controller('sessions')
export class SessionManagerController {
  constructor(private readonly sessionManager: SessionManagerService) {}

  // POST /sessions (body: { userId })
  // Crea una nueva sesión de WhatsApp para un usuario.
  // Devuelve el registro de la sesión con su sessionId.
  @Post()
  async create(@Body() body: { userId: string }) {
    return this.sessionManager.createSession(body.userId);
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
}