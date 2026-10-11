#!/usr/bin/env python3
# ═══════════════════════════════════════════════════════════════
#  El build de CoMakers: de UN fuente salen las DOS páginas.
#
#  `interno.src.html` tiene todo. Los bloques marcados se quedan solo
#  en la página que les corresponde:
#
#      /*@@INTERNO*/  ... /*@@FIN*/     solo en interno.html
#      /*@@ADMIN*/    ... /*@@FIN*/     solo en administracion.html
#      <!--@@INTERNO--> ... <!--@@FIN-->   lo mismo, en el HTML
#
#  Lo que no está marcado va a las dos. Las líneas de marca no salen
#  en ningún lado.
#
#  Por qué un solo fuente: las dos páginas comparten media docena de
#  funciones. Con dos archivos separados, arreglar algo en una y
#  olvidarse de la otra es cuestión de tiempo.
#
#  Uso:  ./build.py
# ═══════════════════════════════════════════════════════════════
import re, subprocess, sys, datetime, pathlib

RAIZ = pathlib.Path(__file__).parent
FUENTE = RAIZ / 'interno.src.html'

ABRE = re.compile(r'(?:/\*|<!--)@@(INTERNO|ADMIN)(?:\*/|-->)\s*$')
CIERRA = re.compile(r'(?:/\*|<!--)@@FIN(?:\*/|-->)\s*$')

#  /*@@EDITOR*/ ... /*@@FINEDITOR*/   el editor de texto con formato:
#  va en las dos páginas como siempre, y ADEMÁS se copia a
#  ../editor-texto.js para el panel del cliente (sin los bloques
#  @@INTERNO/@@ADMIN de adentro). Las líneas de marca no salen.
EDITOR_ABRE = re.compile(r'/\*@@EDITOR\*/\s*$')
EDITOR_CIERRA = re.compile(r'/\*@@FINEDITOR\*/\s*$')

def para(pagina, lineas):
    """Las líneas que le tocan a esta página."""
    out, saltando = [], None
    for l in lineas:
        if EDITOR_ABRE.search(l.strip()) or EDITOR_CIERRA.search(l.strip()):
            continue
        m = ABRE.search(l.strip())
        if m:
            # Se salta el bloque si es de la OTRA página.
            saltando = None if m.group(1) == pagina else m.group(1)
            continue
        if CIERRA.search(l.strip()):
            saltando = None
            continue
        if saltando is None:
            out.append(l)
    return out

EDITOR_PREVIO = r"""// ═══════════════════════════════════════════════════════════════
//  editor-texto.js · GENERADO por fuente/build.py desde
//  fuente/interno.src.html (bloque @@EDITOR). NO editar a mano: los
//  cambios van allá y se regenera con el build.
//
//  Es el MISMO editor con formato de /interno (negrita, cursiva,
//  subrayado, tachado, resaltado, listas, checklist, links, títulos),
//  para la ficha de contenido del Calendario del panel del cliente.
//  En la base nunca se guarda HTML: se guarda texto con marcas
//  (**negrita**, [texto](url)…) y el HTML lo arma renderTexto, que
//  escapa todo primero. Se expone en window.EditorTexto.
// ═══════════════════════════════════════════════════════════════
(function () {
  'use strict';
  // Lo que el editor toma prestado de /interno, en versión panel.
  const $ = s => document.querySelector(s);
  const $si = s => document.querySelector(s);
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }
  function autoGrow(el) { if (!el) return; el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }

"""

EDITOR_FINAL = r"""
  window.EditorTexto = {
    renderTexto: renderTexto, textoPlano: textoPlano, leerTexto: leerTexto, ponerTexto: ponerTexto,
    montarEditor: montarEditor, envolver: envolver, listar: listar, resaltar: resaltar, checklist: checklist,
    divisor: divisor, mandar: mandar, volverAlCursor: volverAlCursor, raizEditor: raizEditor,
    marcarVacio: marcarVacio, insertarEn: insertarEn, BARRA_FORMATO: BARRA_FORMATO,
    rangoGuardado: function () { return RANGO_EDITOR; }
  };
})();
"""

def escribir_editor(lineas, sello):
    """Copia el bloque @@EDITOR a ../editor-texto.js (lo servido)."""
    dentro, bloque = False, []
    for l in lineas:
        if EDITOR_ABRE.search(l.strip()): dentro = True; continue
        if EDITOR_CIERRA.search(l.strip()): dentro = False; continue
        if dentro: bloque.append(l)
    if not bloque:
        print('  ⚠️  no encontré el bloque @@EDITOR: editor-texto.js no se generó')
        return
    # 'PANEL' no es ninguna página: se caen los @@INTERNO y los @@ADMIN.
    cuerpo = '\n'.join(para('PANEL', bloque))
    txt = EDITOR_PREVIO.replace('GENERADO por', 'GENERADO (' + sello + ') por') + cuerpo + EDITOR_FINAL
    destino = RAIZ.parent / 'editor-texto.js'
    destino.write_text(txt, encoding='utf-8')
    print(f'  {"../editor-texto.js":<26} {len(txt.encode("utf-8")) // 1024} KB')

def main():
    if not FUENTE.exists():
        sys.exit('No está interno.src.html')
    lineas = FUENTE.read_text(encoding='utf-8').split('\n')
    sello = datetime.datetime.now().strftime('v%d/%m %H:%M')

    for pagina, nombre, archivo in (('INTERNO', 'interno', 'interno.html'),
                                    ('ADMIN', 'administracion', 'administracion.html')):
        txt = '\n'.join(para(pagina, lineas))
        # `__PAGINA__` es el único placeholder que queda: dice en qué
        # página corre el código. El fondo y la versión ya vienen
        # puestos en el fuente.
        txt = txt.replace('__PAGINA__', nombre)
        txt = re.sub(r'v\d\d/\d\d \d\d:\d\d', sello, txt)
        (RAIZ / archivo).write_text(txt, encoding='utf-8')
        kb = len(txt.encode('utf-8')) // 1024
        print(f'  {archivo:<26} {kb} KB')

    escribir_editor(lineas, sello)
    print('build', sello)
    # El chequeo de nombres colgados es bloqueante: si una página quedó
    # llamando a algo que vive solo en la otra, no se sube nada.
    if (RAIZ / 'revisar-paginas.js').exists():
        r = subprocess.run(['node', str(RAIZ / 'revisar-paginas.js')])
        if r.returncode != 0:
            print('  ⚠️  NO SUBAS ESTOS ARCHIVOS hasta arreglar lo de arriba.')
            sys.exit(1)

if __name__ == '__main__':
    main()
