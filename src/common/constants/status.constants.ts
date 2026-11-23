// Constantes de estado para evitar strings mágicos en el código.
// Cada estado es un solo carácter para que quepa en columnas char(1).

// Estados de usuario
export const USER_STATUS = {
  ACTIVE: 'A',    // Usuario activo
  INACTIVE: 'I',  // Usuario desactivado
} as const;

// Estados de sesión de WhatsApp
export const SESSION_STATUS = {
  PENDING: 'P',       // Esperando que se escanee el QR
  READY: 'R',         // Conectada y lista para enviar
  DISCONNECTED: 'D',  // Desconectada (por red, logout, etc.)
  FAILED: 'F',        // Fallo de autenticación
} as const;