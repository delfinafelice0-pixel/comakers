// ═══════════════════════════════════════════════════════════════
//  _shared/meta.ts
//
//  Todo lo que hace falta para hablar con la Graph API sin repetirlo
//  en cada función: el cliente con reintentos, la traducción de los
//  códigos de error de Meta a algo que se pueda leer en un toast, y
//  los helpers de CORS.
//
//  Extraído tal cual de pull-instagram. Si cambiás algo acá, cambia
//  para todas las funciones que lo importen — que es el punto.
// ═══════════════════════════════════════════════════════════════

export const V = 'v26.0';
export const GRAPH = `https://graph.facebook.com/${V}`;

const TIMEOUT_MS = 20_000;
const MAX_REINTENTOS = 3;

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

// ─────────────────────────────────────────────────────────────
//  Errores: objeto, no string. El panel los muestra en un toast,
//  así que `mensaje` tiene que leerse sin saber de APIs.
// ─────────────────────────────────────────────────────────────
export class ErrorMeta extends Error {
  code: number | null;
  subcode: number | null;
  mensaje: string;
  reintentable: boolean;

  constructor(code: number | null, subcode: number | null, crudo: string) {
    super(crudo);
    this.code = code;
    this.subcode = subcode;
    const t = traducir(code, subcode, crudo);
    this.mensaje = t.mensaje;
    this.reintentable = t.reintentable;
  }

  aJSON() {
    return { code: this.code, subcode: this.subcode, message: this.mensaje, detalle: this.message };
  }
}

// Los dos códigos que nunca se reintentan ni se tragan: token muerto
// y cuenta bloqueada. Cualquier función que capture errores parciales
// tiene que dejar pasar estos dos hacia arriba.
export function esFatal(e: unknown): boolean {
  return e instanceof ErrorMeta && (e.code === 190 || e.code === 368);
}

export function traducir(code: number | null, subcode: number | null, crudo: string) {
  // 190: el token murió. Reintentar no sirve y además ensucia.
  if (code === 190) {
    return {
      mensaje: subcode === 463
        ? 'El acceso a Instagram venció. Hay que generar un token nuevo en Meta.'
        : 'El acceso a Instagram dejó de ser válido. Hay que generar un token nuevo en Meta.',
      reintentable: false,
    };
  }
  // 368: Meta marcó la cuenta. Se para y se avisa; no se reintenta.
  if (code === 368) {
    return {
      mensaje: 'Meta bloqueó temporalmente esta cuenta por sus políticas. Hay que revisarlo en Business Manager antes de volver a sincronizar.',
      reintentable: false,
    };
  }
  // Rate limits: sí se reintentan, con espera.
  if (code === 17 || code === 32 || code === 613 || code === 4 || code === 80000) {
    return {
      mensaje: 'Meta pidió esperar unos minutos antes de seguir consultando. Probá de nuevo en un rato.',
      reintentable: true,
    };
  }
  if (code === 10 || (code !== null && code >= 200 && code <= 299)) {
    return {
      mensaje: 'El acceso a Instagram no tiene los permisos necesarios para leer estadísticas.',
      reintentable: false,
    };
  }
  if (code === 100) {
    return {
      mensaje: 'Instagram no reconoció una de las métricas pedidas. Puede ser un cambio de la API.',
      reintentable: false,
    };
  }
  if (code === 1 || code === 2) {
    return { mensaje: 'Instagram no está respondiendo bien en este momento.', reintentable: true };
  }
  return { mensaje: 'Instagram devolvió un error inesperado: ' + crudo, reintentable: true };
}

// ─────────────────────────────────────────────────────────────
//  Fetch a Graph: token en header, timeout, backoff con jitter.
// ─────────────────────────────────────────────────────────────
export const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Diagnóstico de cuota, para mirar si algo se pone raro.
// Es estado de módulo: cada edge function corre en su propio proceso,
// así que no se pisan entre sí.
let ultimaCuota: string | null = null;
export const cuota = () => ultimaCuota;

export async function graph(path: string, token: string): Promise<any> {
  let ultimo: ErrorMeta | null = null;

  for (let intento = 0; intento < MAX_REINTENTOS; intento++) {
    if (intento > 0) {
      // 2s, 4s, 8s ± jitter, para no sincronizarnos con nadie.
      const base = 2000 * Math.pow(2, intento - 1);
      await dormir(base + Math.random() * 1000);
    }

    const ctrl = new AbortController();
    const reloj = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(`${GRAPH}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: ctrl.signal,
      });
      clearTimeout(reloj);

      ultimaCuota = res.headers.get('x-business-use-case-usage') ?? ultimaCuota;

      const body = await res.json().catch(() => null);

      if (res.ok && body && !body.error) return body;

      const e = body?.error ?? {};
      ultimo = new ErrorMeta(
        e.code ?? res.status,
        e.error_subcode ?? null,
        e.message ?? `HTTP ${res.status}`,
      );
      if (!ultimo.reintentable) throw ultimo;
    } catch (err) {
      clearTimeout(reloj);
      if (err instanceof ErrorMeta) {
        if (!err.reintentable) throw err;
        ultimo = err;
        continue;
      }
      // Timeout o corte de red: reintentable.
      const esAbort = err instanceof DOMException && err.name === 'AbortError';
      ultimo = new ErrorMeta(
        null,
        null,
        esAbort ? `La consulta a Instagram tardó más de ${TIMEOUT_MS / 1000}s` : String(err),
      );
    }
  }

  throw ultimo ?? new ErrorMeta(null, null, 'No se pudo contactar a Instagram');
}

// ─────────────────────────────────────────────────────────────
//  Lectura de respuestas de insights
// ─────────────────────────────────────────────────────────────
export function valorTotal(body: any, nombre: string): number | null {
  const fila = (body?.data ?? []).find((d: any) => d.name === nombre);
  const v = fila?.total_value?.value;
  return typeof v === 'number' ? v : null;
}

export function porBreakdown(body: any, nombre: string): Record<string, number> {
  const fila = (body?.data ?? []).find((d: any) => d.name === nombre);
  const out: Record<string, number> = {};
  for (const b of fila?.total_value?.breakdowns ?? []) {
    for (const r of b.results ?? []) {
      const clave = String((r.dimension_values ?? [])[0] ?? '').toUpperCase();
      if (clave) out[clave] = (out[clave] ?? 0) + (Number(r.value) || 0);
    }
  }
  return out;
}

export const sumar = (a: number | null, b: number | null) =>
  a === null && b === null ? null : (a ?? 0) + (b ?? 0);
