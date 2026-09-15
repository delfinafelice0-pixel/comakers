#!/usr/bin/env python3
"""
panel.html — tanda visual:
  1. Los meses pasan a ser solapas, con el mismo lenguaje que
     Cuenta/Organico/Pauta. El filtro queda generico: sirve igual
     cuando se sumen otros modulos a la izquierda.
  2. Las tarjetas de metricas son mas grandes y el delta lleva flecha.
  3. El analisis baja al final de cada solapa: primero los numeros.
  4. "Seguidores" pasa a "Nuevos seguidores", que es lo que mide.

Correr desde la raiz del repo:
    python3 parche-panel-visual.py
Idempotente. Backup en panel.html.bak-visual
"""
import sys, os, shutil

RUTA = "panel.html"
E = []

# 1 ── meses como solapas + tarjetas mas grandes
E.append(("css", """  .barra-meses .meses .borr { font-size: 10px; }""",
"""  .barra-meses .meses .borr { font-size: 10px; }

  /* Los meses usan el mismo lenguaje que las solapas del reporte:
     sin caja, subrayado en el activo. Asi el filtro se lee igual
     en cualquier modulo que se sume despues. */
  .barra-meses .meses button {
    background: none; box-shadow: none; border-radius: 0;
    border-bottom: 2px solid transparent; margin-bottom: -1px;
    padding: 4px 2px 10px; color: var(--ink-mute);
  }
  .barra-meses .meses button:hover { background: none; color: var(--ink); }
  .barra-meses .meses button.activo {
    background: none; box-shadow: none; color: var(--ink);
    border-bottom-color: currentColor; font-weight: 700;
  }
  .barra-meses .meses button > span:first-child { font-size: 16px; }
  .barra-meses .meses { gap: 24px; }

  /* Tarjetas: el numero manda. */
  .metricas { grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 12px; }
  .met { padding: 18px 20px 16px; }
  .met .et { font-size: 11px; letter-spacing: .06em; text-transform: uppercase; }
  .met .val { font-size: 38px; }
  .met .delta.bien::before { content: '▲ '; }
  .met .delta.mal::before  { content: '▼ '; }"""))

# 2 ── el analisis se arma pero no se inserta todavia
E.append(("guardar", """    bloques.cuenta   += bloqueTexto('Análisis', r.analisis, true);
    bloques.organico += bloqueTexto('Análisis del contenido', r.analisis_organico, false);
    bloques.pauta    += bloqueTexto('Análisis de la pauta', r.analisis_pauta, false);""",
"""    // El analisis va al final de cada solapa: primero los numeros,
    // despues la lectura. Se arma aca y se inserta mas abajo.
    const textos = {
      cuenta:   bloqueTexto('Análisis', r.analisis, true),
      organico: bloqueTexto('Análisis del contenido', r.analisis_organico, false),
      pauta:    bloqueTexto('Análisis de la pauta', r.analisis_pauta, false),
    };"""))

# 3 ── y se inserta recien antes de los proximos pasos
E.append(("insertar", """    if (r.proximos_pasos) bloques.cuenta += '<section class="bloque"><h2>Qué hacemos el mes que viene</h2><p class="prosa">' + esc(r.proximos_pasos) + '</p></section>';""",
"""    bloques.cuenta += textos.cuenta;
    bloques.organico += textos.organico;
    bloques.pauta += textos.pauta;

    if (r.proximos_pasos) bloques.cuenta += '<section class="bloque"><h2>Qué hacemos el mes que viene</h2><p class="prosa">' + esc(r.proximos_pasos) + '</p></section>';"""))

# 4 ── la etiqueta dice lo que el numero mide
E.append(("et1", """      { clave: 'seguidores',    etiqueta: 'Seguidores',         unidad: 'num', mejor: 'sube' },""",
"""      { clave: 'seguidores',    etiqueta: 'Nuevos seguidores',  unidad: 'num', mejor: 'sube' },"""))

E.append(("et2", """    { clave: 'seguidores',      etiqueta: 'Seguidores',      col: c => c.follows_mes },""",
"""    { clave: 'seguidores',      etiqueta: 'Nuevos seguidores', col: c => c.follows_mes },"""))


def main():
    if not os.path.exists(RUTA):
        sys.exit("No encuentro panel.html. Estas en la raiz del repo?")
    s = open(RUTA, encoding="utf-8").read()
    if 'const textos = {' in s:
        print("Ya esta aplicado."); return
    malas = [n for n, v, _ in E if s.count(v) != 1]
    if malas:
        print("NO se toco nada. Anclas que no coinciden:", ", ".join(malas)); sys.exit(1)
    for _, v, n in E:
        s = s.replace(v, n, 1)
    shutil.copy2(RUTA, RUTA + ".bak-visual")
    open(RUTA, "w", encoding="utf-8").write(s)
    print("Listo. %d ediciones. Backup en %s.bak-visual" % (len(E), RUTA))

if __name__ == "__main__":
    main()
