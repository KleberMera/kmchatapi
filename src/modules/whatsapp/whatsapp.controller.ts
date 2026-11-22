// Decoradores de Nest para definir rutas y extraer datos del request.
// Body: extrae el cuerpo JSON de la petición.
// Controller: marca la clase como controlador y define el prefijo de ruta.
// Get / Post: definen el método HTTP de cada endpoint.
import { Body, Controller, Get, Post, Res } from '@nestjs/common';
// Response de Express (no el global de Fetch API) para tener res.send()
import type { Response } from 'express';
import { WhatsappService } from './whatsapp.service.js';
import * as QRCode from 'qrcode';

@Controller('whatsapp') // Todas las rutas de este controlador empiezan con /whatsapp
export class WhatsappController {
  // Inyección de dependencias: Nest nos pasa la instancia de WhatsappService
  // que él mismo creó y gestiona. No hacemos new WhatsappService().
  constructor(private readonly whatsappService: WhatsappService) {}

  // GET /whatsapp/status
  // Devuelve si el cliente está conectado y si hay un QR pendiente.
  @Get('status')
  getStatus() {
    return this.whatsappService.getStatus();
  }

  // GET /whatsapp/qr
  // Devuelve el string del QR actual (o null si no hay).
  // Útil si prefieres renderizarlo en un frontend en vez de en la consola.
  @Get('qr')
  getQr() {
    return this.whatsappService.getQr();
  }

  // Nuevo endpoint: devuelve una página HTML con el QR como imagen.
  // Al usar @Res(), Nest no aplica el interceptor de respuesta,
  // por lo que el navegador recibe HTML puro (no el envelope JSON).
  @Get('qr-view')
  async qrView(@Res() res: Response) {
    const { qr } = this.whatsappService.getQr();

    if (!qr) {
      return res.send(`
        <html>
          <body style="font-family: sans-serif; text-align: center; padding: 40px;">
            <h2>No hay QR disponible</h2>
            <p>El cliente ya está autenticado o aún no se ha generado un QR.</p>
            <p>Estado: ${JSON.stringify(this.whatsappService.getStatus())}</p>
          </body>
        </html>
      `);
    }

    // Generamos la imagen del QR como Data URL (base64)
    const dataUrl = await QRCode.toDataURL(qr, { width: 300, margin: 2 });

    res.send(`
      <html>
        <body style="font-family: sans-serif; text-align: center; padding: 40px;">
          <h2>Escanea este QR con WhatsApp</h2>
          <img src="${dataUrl}" alt="QR de WhatsApp" />
          <p>WhatsApp → Dispositivos vinculados → Vincular un dispositivo</p>
        </body>
      </html>
    `);
  }

  // POST /whatsapp/send
  // Recibe { phone, message } en el body y envía el mensaje.
  @Post('send')
  async send(@Body() body: { phone: string; message: string }) {
    // Delegamos toda la lógica al servicio. El controlador solo orquesta.
    await this.whatsappService.sendMessage(body.phone, body.message);

    // Devolvemos un objeto simple. El ResponseInterceptor global lo envolverá
    // automáticamente en { data: { sent: true, to: ... }, message, status }.
    return { sent: true, to: body.phone };
  }
}