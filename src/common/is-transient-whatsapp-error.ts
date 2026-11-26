export function isTransientWhatsAppBrowserError(error: Error): boolean {
  const stack = error.stack ?? '';
  if (!stack.includes('whatsapp-web.js')) return false;

  if (
    error.message.includes(
      'Execution context was destroyed, most likely because of a navigation',
    )
  ) {
    return true;
  }

  return (
    /^Waiting failed: \d+ms exceeded/.test(error.message) &&
    stack.includes('Client.inject')
  );
}
