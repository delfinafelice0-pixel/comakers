#!/usr/bin/env python3
"""
panel.html: tres solapas (Cuenta / Organico / Pauta).

Que hace:
  - Carga analisis_organico y analisis_pauta desde la base.
  - Parte el reporte en tres paneles con una barra de solapas.
      Cuenta   -> resumen + analisis general + destacados + proximos pasos
      Organico -> analisis del contenido propio + metricas + publicaciones
      Pauta    -> analisis de la inversion + metricas + anuncios
  - Las solapas de modulos apagados no se dibujan.

Correr desde la raiz del repo:
    python3 parche-panel-solapas.py

Idempotente. Si un ancla no coincide, no escribe NADA.
Backup en panel.html.bak-solapas
"""
import sys, os, shutil

RUTA = "panel.html"

E = []  # (nombre, viejo, nuevo)

# 1 ── CSS de las solapas
E.append(("css", """  .analisis.es-borrador .prosa { border-left: 3px solid var(--coral-soft); padding-left: 14px; }""",
"""  .analisis.es-borrador .prosa { border-left: 3px solid var(--coral-soft); padding-left: 14px; }

  /* Solapas del reporte */
  .solapas { display: flex; gap: 26px; border-bottom: 1px solid var(--linea, #e6e3dc);
             margin: 22px 0 26px; overflow-x: auto; }
  .solapa { background: none; border: 0; padding: 0 0 12px; cursor: pointer;
            text-align: left; white-space: nowrap; border-bottom: 2px solid transparent;
            margin-bottom: -1px; font: inherit; color: var(--ink-mute); }
  .solapa .t { display: block; font-weight: 700; font-size: 17px; line-height: 1.2; }
  .solapa .s { display: block; font-size: 12px; margin-top: 2px; }
  .solapa.activa { color: var(--ink, #1a1a1a); border-bottom-color: currentColor; }
  .solapa:hover { color: var(--ink, #1a1a1a); }
  .pane { display: none; }
  .pane.activa { display: block; }"""))

# 2 ── traer las dos columnas nuevas
E.append(("select", """              'analisis, analisis_generado_en')""",
"""              'analisis, analisis_organico, analisis_pauta, analisis_generado_en')"""))

E.append(("map", """      analisis: r.analisis || '', analisis_generado_en: r.analisis_generado_en || null,""",
"""      analisis: r.analisis || '', analisis_generado_en: r.analisis_generado_en || null,
      analisis_organico: r.analisis_organico || '', analisis_pauta: r.analisis_pauta || '',"""))

# 3 ── el bloque de texto pasa a ser reutilizable y arranca el pane Cuenta
E.append(("cuenta", """    if (r.resumen) html += '<p class="prosa">' + esc(r.resumen) + '</p>';""",
"""    // ── Solapas ────────────────────────────────────────────────
    // El reporte se parte en tres vistas. Cuenta es la lectura que
    // cruza las dos patas; las otras dos son cada servicio por
    // separado. Un módulo apagado no dibuja su solapa: cliente_modulo
    // sigue siendo la verdad.
    const SOLAPAS = [['cuenta', 'Cuenta', 'Instagram completo']];
    if (MODULOS.organico) SOLAPAS.push(['organico', 'Orgánico', 'Contenido y comunidad']);
    if (MODULOS.pauta)    SOLAPAS.push(['pauta', 'Pauta', 'Inversión publicitaria']);

    if (SOLAPAS.length > 1) {
      html += '<div class="solapas" role="tablist">' + SOLAPAS.map((s, i) =>
        '<button type="button" class="solapa' + (i === 0 ? ' activa' : '') + '" data-solapa="' + s[0] + '">' +
        '<span class="t">' + esc(s[1]) + '</span><span class="s">' + esc(s[2]) + '</span></button>').join('') +
      '</div>';
    }

    // El aviso de borrador es el mismo para los tres textos: los
    // genera la misma llamada y se revisan juntos.
    const esBorradorAn = !!r.analisis_generado_en;
    const bloqueTexto = (titulo, texto, conBoton) => {
      if (!texto && !AGENCIA) return '';
      let s = '<section class="bloque analisis' + (esBorradorAn && texto ? ' es-borrador' : '') + '">' +
        '<h2>' + titulo + (esBorradorAn && texto ? '<span class="borrador-tag">borrador sin revisar</span>' : '') + '</h2>';
      if (texto) {
        if (esBorradorAn) s += '<p class="aviso">Lo escribió Claude con los números del mes. Editalo y guardalo para darlo por revisado.</p>';
        s += '<p class="prosa">' + esc(texto) + '</p>';
      } else {
        s += '<p class="prosa mute">Todavía no hay análisis de este mes.</p>' +
          (conBoton ? '<button type="button" class="btn chico" id="btnAnalisis">Generar borrador</button>' : '');
      }
      return s + '</section>';
    };

    const bloques = { cuenta: '', organico: '', pauta: '' };

    if (r.resumen) bloques.cuenta += '<p class="prosa">' + esc(r.resumen) + '</p>';"""))

E.append(("cuenta2", """    else if (AGENCIA) html += '<p class="prosa mute">Falta escribir qué pasó este mes.</p>';""",
"""    else if (AGENCIA) bloques.cuenta += '<p class="prosa mute">Falta escribir qué pasó este mes.</p>';

    bloques.cuenta   += bloqueTexto('Análisis', r.analisis, true);
    bloques.organico += bloqueTexto('Análisis del contenido', r.analisis_organico, false);
    bloques.pauta    += bloqueTexto('Análisis de la pauta', r.analisis_pauta, false);"""))

# 4 ── sacar el bloque viejo de analisis (ya lo hace bloqueTexto)
E.append(("viejo", """    // ── Análisis ───────────────────────────────────────────────
    // Bloque aparte del resumen y a propósito: `resumen` lo escribe la
    // agencia, `analisis` es la lectura de los números y puede venir
    // generada. Si está sin revisar, se dice.
    // Al cliente no se le muestra la sección vacía.
    const esBorradorAn = !!r.analisis_generado_en;
    if (r.analisis || AGENCIA) {
      html += '<section class="bloque analisis' + (esBorradorAn ? ' es-borrador' : '') + '">' +
        '<h2>Análisis' + (esBorradorAn ? '<span class="borrador-tag">borrador sin revisar</span>' : '') + '</h2>';
      if (r.analisis) {
        if (esBorradorAn) html += '<p class="aviso">Lo escribió Claude con los números del mes. Editalo y guardalo para darlo por revisado.</p>';
        html += '<p class="prosa">' + esc(r.analisis) + '</p>';
      } else {
        html += '<p class="prosa mute">Todavía no hay análisis de este mes.</p>' +
          '<button type="button" class="btn chico" id="btnAnalisis">Generar borrador</button>';
      }
      html += '</section>';
    }
""", ""))

# 5 ── las metricas van a su bucket, no al html
E.append(("metricas", """      html += '<section class="bloque"><h2>' + NOMBRE_MOD[mod] + '</h2>' + sincro + '<div class="metricas">' +""",
"""      bloques[mod] += '<section class="bloque"><h2>' + NOMBRE_MOD[mod] + '</h2>' + sincro + '<div class="metricas">' +"""))

E.append(("posts", """    html += renderPosts(postsMes);""",
"""    bloques.organico += renderPosts(postsMes);"""))

E.append(("anuncios", """      html += renderAnuncios(MES);""",
"""      bloques.pauta += renderAnuncios(MES);"""))

# 6 ── destacados y proximos van a Cuenta
E.append(("destacados", """    if (r.destacados.length) {
      html += '<section class="bloque"><h2>Lo que vale la pena mirar</h2><ul class="destacados">' +""",
"""    if (r.destacados.length) {
      bloques.cuenta += '<section class="bloque"><h2>Lo que vale la pena mirar</h2><ul class="destacados">' +"""))

E.append(("proximos", """    if (r.proximos_pasos) html += '<section class="bloque"><h2>Qué hacemos el mes que viene</h2><p class="prosa">' + esc(r.proximos_pasos) + '</p></section>';

    main.innerHTML = html;""",
"""    if (r.proximos_pasos) bloques.cuenta += '<section class="bloque"><h2>Qué hacemos el mes que viene</h2><p class="prosa">' + esc(r.proximos_pasos) + '</p></section>';

    // Si hay una sola solapa no se dibujan paneles: sería una caja
    // vacía alrededor de todo el contenido.
    if (SOLAPAS.length > 1) {
      html += SOLAPAS.map((s, i) =>
        '<div class="pane' + (i === 0 ? ' activa' : '') + '" data-pane="' + s[0] + '">' +
        (bloques[s[0]] || '<p class="prosa mute">Nada para mostrar en esta solapa.</p>') + '</div>').join('');
    } else {
      html += bloques.cuenta + bloques.organico + bloques.pauta;
    }

    main.innerHTML = html;

    main.querySelectorAll('[data-solapa]').forEach(b => b.addEventListener('click', () => {
      main.querySelectorAll('[data-solapa]').forEach(x => x.classList.toggle('activa', x === b));
      main.querySelectorAll('[data-pane]').forEach(p =>
        p.classList.toggle('activa', p.dataset.pane === b.dataset.solapa));
    }));"""))


def main():
    if not os.path.exists(RUTA):
        sys.exit("No encuentro panel.html. Estas en la raiz del repo?")
    s = open(RUTA, encoding="utf-8").read()

    if 'data-solapa' in s:
        print("Ya esta aplicado.")
        return

    malas = [n for n, v, _ in E if s.count(v) != 1]
    if malas:
        print("NO se toco nada. Estas anclas no coinciden:", ", ".join(malas))
        sys.exit(1)

    for _, v, n in E:
        s = s.replace(v, n, 1)

    shutil.copy2(RUTA, RUTA + ".bak-solapas")
    open(RUTA, "w", encoding="utf-8").write(s)
    print("Listo. %d ediciones. Backup en %s.bak-solapas" % (len(E), RUTA))


if __name__ == "__main__":
    main()
