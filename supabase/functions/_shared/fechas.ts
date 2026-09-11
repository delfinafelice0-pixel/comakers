// ═══════════════════════════════════════════════════════════════
//  _shared/fechas.ts
//
//  El mes se recorta en Buenos Aires, no en UTC. Si no, el 1° a la
//  madrugada y el último día se contaminan con datos del mes vecino.
//  Esto es fácil de hacer mal y difícil de notar: los números dan
//  "casi bien".
//
//  Extraído tal cual de pull-instagram.
// ═══════════════════════════════════════════════════════════════

export const TZ = 'America/Argentina/Buenos_Aires';

// Un mes de 31 días no entra en una sola llamada a insights (el
// endpoint corta en 30). Se parte en dos ventanas y se suma.
const MAX_DIAS_VENTANA = 30;

function offsetTz(instante: number, tz: string): number {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(new Date(instante))) p[x.type] = x.value;
  const comoUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return comoUTC - instante;
}

// Instante UTC que corresponde a la medianoche local de y-m-d.
export function medianocheLocal(y: number, m: number, d: number, tz: string = TZ): number {
  const pared = Date.UTC(y, m - 1, d, 0, 0, 0);
  let t = pared;
  for (let i = 0; i < 2; i++) t = pared - offsetTz(t, tz);
  return t;
}

// Solo para diagnóstico: un unix en hora de Buenos Aires, legible.
export function enBA(unixSeg: number): string {
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(unixSeg * 1000));
}

export function mesActualEnBA(): string {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit' });
  return f.format(new Date()).slice(0, 7);
}

export function mesAnterior(mes: string): string {
  const [y, m] = mes.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// Los dos bordes del mes en milisegundos unix. Si el mes todavía no
// terminó, el final se recorta a ahora: no le pedimos el futuro.
export function bordesDelMes(mes: string): { desde: number; hasta: number } {
  const [y, m] = mes.split('-').map(Number);
  const desde = medianocheLocal(y, m, 1);
  let hasta = medianocheLocal(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1);
  const ahora = Date.now();
  if (hasta > ahora) hasta = ahora;
  return { desde, hasta };
}

// Ventanas [since, until) en segundos unix, partidas si el mes no
// entra en una sola llamada. Solo lo necesita el endpoint de insights
// de cuenta; para /media se usan los bordes directamente.
export function ventanasDelMes(mes: string): Array<{ since: number; until: number }> {
  const { desde, hasta } = bordesDelMes(mes);
  if (hasta <= desde) return [];

  const dia = 86_400_000;
  const ventanas: Array<{ since: number; until: number }> = [];
  let cursor = desde;
  while (cursor < hasta) {
    const tope = Math.min(cursor + MAX_DIAS_VENTANA * dia, hasta);
    ventanas.push({ since: Math.floor(cursor / 1000), until: Math.floor(tope / 1000) });
    cursor = tope;
  }
  return ventanas;
}
