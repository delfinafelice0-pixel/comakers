#!/usr/bin/env python3
"""
panel.html: la izquierda pasa a ser la navegacion del panel
(Reportes, y lo que venga despues), y el filtro de meses sube
arriba del contenido.

Correr desde la raiz del repo:
    python3 parche-panel-layout.py

Idempotente. Si un ancla no coincide, no escribe NADA.
Backup en panel.html.bak-layout
"""
import sys, os, shutil

RUTA = "panel.html"
E = []

E.append(("shell", """  <aside>
    <h2>Meses</h2>
    <ul class="meses" id="meses"></ul>
    <div class="meses-mobile"><select id="mesesMobile"></select></div>
  </aside>
  <main id="main">
    <div class="vacio"><p>Cargando…</p></div>
  </main>""",
"""  <aside>
    <nav class="secciones">
      <button type="button" class="seccion activa" data-seccion="reportes">Reportes</button>
    </nav>
  </aside>
  <div class="col">
    <div class="barra-meses">
      <ul class="meses" id="meses"></ul>
      <div class="meses-mobile"><select id="mesesMobile"></select></div>
    </div>
    <main id="main">
      <div class="vacio"><p>Cargando…</p></div>
    </main>
  </div>"""))

E.append(("css", """  .meses-mobile { display: none; }""",
"""  .meses-mobile { display: none; }

  /* Navegación del panel. Hoy una sola sección; se suman acá. */
  .secciones { display: flex; flex-direction: column; gap: 2px; }
  .seccion {
    width: 100%; text-align: left; background: none; border: 0;
    border-radius: 8px; padding: 9px 10px; cursor: pointer;
    font: inherit; color: var(--ink-soft);
  }
  .seccion:hover { background: var(--bg-elev); }
  .seccion.activa {
    background: var(--bg-elev); color: var(--ink); font-weight: 500;
    box-shadow: 0 1px 2px rgba(27,22,32,.06);
  }

  /* El mes se elige arriba del reporte, no al costado. */
  .col { min-width: 0; }
  .barra-meses { border-bottom: 1px solid var(--linea, #e6e3dc); margin-bottom: 26px; }
  .barra-meses .meses {
    flex-direction: row; gap: 4px; overflow-x: auto;
    padding-bottom: 8px; scrollbar-width: thin;
  }
  .barra-meses .meses button {
    width: auto; white-space: nowrap; flex-direction: column;
    align-items: flex-start; gap: 0; padding: 7px 12px; border-radius: 8px 8px 0 0;
  }
  .barra-meses .meses .borr { font-size: 10px; }"""))

def main():
    if not os.path.exists(RUTA):
        sys.exit("No encuentro panel.html. Estas en la raiz del repo?")
    s = open(RUTA, encoding="utf-8").read()
    if 'data-seccion' in s:
        print("Ya esta aplicado."); return
    malas = [n for n, v, _ in E if s.count(v) != 1]
    if malas:
        print("NO se toco nada. Anclas que no coinciden:", ", ".join(malas)); sys.exit(1)
    for _, v, n in E:
        s = s.replace(v, n, 1)
    shutil.copy2(RUTA, RUTA + ".bak-layout")
    open(RUTA, "w", encoding="utf-8").write(s)
    print("Listo. %d ediciones. Backup en %s.bak-layout" % (len(E), RUTA))

if __name__ == "__main__":
    main()
