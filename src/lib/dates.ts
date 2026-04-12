const TZ = 'America/Argentina/Buenos_Aires';

/** Returns today's date as YYYY-MM-DD in Argentina timezone */
export function todayAR(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ });
}

/** Formats a Date or unix-seconds timestamp as a human-readable Argentina datetime */
export function formatDateAR(date: Date | number): string {
  const d = typeof date === 'number' ? new Date(date * 1000) : date;
  return d.toLocaleString('es-AR', { timeZone: TZ });
}
