import { isTransientWhatsAppBrowserError } from './is-transient-whatsapp-error.js';

describe('isTransientWhatsAppBrowserError', () => {
  it('recognizes navigation and injection timeouts from WhatsApp Web initialization', () => {
    const navigationError = new Error(
      'Execution context was destroyed, most likely because of a navigation',
    );
    navigationError.stack = `${navigationError.message}\n    at Client.inject (node_modules/whatsapp-web.js/src/Client.js:558:36)`;
    const timeoutError = new Error('Waiting failed: 30000ms exceeded');
    timeoutError.stack = `${timeoutError.message}\n    at Client.inject (node_modules/whatsapp-web.js/src/Client.js:139:55)`;

    expect(isTransientWhatsAppBrowserError(navigationError)).toBe(true);
    expect(isTransientWhatsAppBrowserError(timeoutError)).toBe(true);
  });

  it('does not classify errors outside WhatsApp Web initialization as transient', () => {
    const error = new Error('Waiting failed: 30000ms exceeded');
    error.stack = `${error.message}\n    at anotherOperation (src/app.ts:1:1)`;

    expect(isTransientWhatsAppBrowserError(error)).toBe(false);
  });
});
