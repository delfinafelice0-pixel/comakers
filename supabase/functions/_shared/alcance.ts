// ═══════════════════════════════════════════════════════════════
//  _shared/alcance.ts
//
//  ⚠️ EL ALCANCE DE META ES INTERMITENTE, NO ESTÁ ROTO SIEMPRE.
//
//  Medido el 11/09/2026 · Visitando Tandil · tres meses seguidos,
//  a nivel cuenta:
//    junio  2026:  reach   403  ·  views  1474   → creíble, pasó
//    julio  2026:  reach  null  ·  views 16107   → descartado
//    agosto 2026:  reach    56  ·  views  4158   → descartado
//
//  Agosto se diagnosticó a fondo: la ventana de 30 días devolvió
//  total_value = 56, la suma diaria coincidió en 56 y el pico diario
//  fue 6. Los dos métodos dan lo mismo, sin errores ni problemas de
//  paginación: no es cómo lo pedimos ni cómo lo leemos. Y junio
//  demuestra que tampoco es que el endpoint esté muerto. Falla de a
//  ratos. La propia descripción que devuelve Meta admite que reach
//  "es una estimación y está en desarrollo".
//
//  Por eso esto no apaga la métrica: la evalúa caso por caso contra
//  las views y descarta solo cuando no cierra. Si apagáramos el
//  alcance del todo, perderíamos los meses buenos.
//
//  Preferimos un hueco visible a un número que nadie puede creer.
//  NUNCA escribir 0 donde esto devuelve null: en el panel, null es
//  "no sabemos" y 0 es "no llegó a nadie". No son lo mismo.
//
//  ─── Sobre el umbral ───────────────────────────────────────────
//  10 salió de los datos de arriba, medidos a nivel CUENTA sobre un
//  mes entero. El reach por POST viene de otro endpoint y podría
//  comportarse distinto. Cuando tengamos la primera corrida de
//  pull-posts, hay que mirar cuántos descarta: si descarta casi
//  todos o casi ninguno, el umbral está mal calibrado para posts y
//  conviene separar las dos constantes.
// ═══════════════════════════════════════════════════════════════

export const UMBRAL_ALCANCE = 10;

export type Veredicto = {
  reach: number | null;
  descartado: boolean;
  motivo: string | null;
};

/**
 * Contrasta el alcance contra las views del mismo período. Si es
 * menos de 1/UMBRAL de las views, es inconsistente y no se guarda.
 *
 * Devuelve el reach ya limpio: escribí lo que sale de acá, no la
 * variable original.
 */
export function evaluarAlcance(
  reach: number | null,
  views: number | null,
  umbral: number = UMBRAL_ALCANCE,
): Veredicto {
  if (reach !== null && views !== null && views > 0 && reach < views / umbral) {
    return {
      reach: null,
      descartado: true,
      motivo:
        `alcance descartado: Meta devolvió un valor inconsistente ` +
        `(reach ${reach} contra ${views} views)`,
    };
  }
  return { reach, descartado: false, motivo: null };
}
