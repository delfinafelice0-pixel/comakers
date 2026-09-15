#!/usr/bin/env python3
"""
panel.html — bloques editables por solapa.

Cada bloque tiene titulo, pregunta y cuerpo, igual que las secciones
de los reportes en Word. Se agregan, se editan y se borran desde el
propio reporte, sin pasar por el editor grande.

Viven en reporte.bloques (jsonb), asi que heredan el estado del
reporte: el cliente no los ve mientras este en borrador.

Correr desde la raiz del repo:
    python3 parche-panel-bloques.py
Idempotente. Backup en panel.html.bak-bloques
"""
import sys, os, shutil

RUTA = "panel.html"
E = []

E.append(("css", """  .met .delta.mal::before  { content: '▼ '; }""",
"""  .met .delta.mal::before  { content: '▼ '; }

  /* Bloques que escribe la agencia */
  .bloque-extra .pregunta {
    font-family: var(--display); font-style: italic;
    color: var(--ink-soft); margin: -6px 0 12px; max-width: 62ch;
  }
  .acc-bloque { display: flex; gap: 8px; margin-top: 12px; }
  .ed-bloque { display: flex; flex-direction: column; gap: 10px; }
  .ed-bloque input, .ed-bloque textarea {
    width: 100%; font: inherit; padding: 10px 12px;
    border: 1px solid var(--line); border-radius: 10px;
    background: var(--bg); color: var(--ink);
  }
  .ed-bloque textarea { min-height: 120px; resize: vertical; line-height: 1.6; }
  .agregar-bloque { margin: 6px 0 26px; }"""))

E.append(("estado", """  let REPORTES = [];""",
"""  // Indice del bloque que se esta editando, o {nuevo: modulo}.
  let BEDIT = null;
  let REPORTES = [];"""))

E.append(("select", """              'analisis, analisis_organico, analisis_pauta, analisis_generado_en')""",
"""              'analisis, analisis_organico, analisis_pauta, analisis_generado_en, bloques')"""))

E.append(("map", """      analisis_organico: r.analisis_organico || '', analisis_pauta: r.analisis_pauta || '',""",
"""      analisis_organico: r.analisis_organico || '', analisis_pauta: r.analisis_pauta || '',
      bloques_extra: Array.isArray(r.bloques) ? r.bloques : [],"""))

E.append(("render", """    bloques.cuenta += textos.cuenta;""",
"""    // ── Bloques que escribe la agencia ─────────────────────────
    // El indice es el del array completo, no el del filtrado por
    // modulo: es lo que despues se edita y se borra.
    const listaBl = r.bloques_extra || [];
    const formBloque = (b, idx, mod) =>
      '<section class="bloque bloque-extra"><div class="ed-bloque">' +
      '<input id="blTitulo" placeholder="Título (ej: 01. Inversión y entrega)" value="' + esc(b.titulo || '') + '">' +
      '<input id="blPregunta" placeholder="La pregunta que responde esta sección" value="' + esc(b.pregunta || '') + '">' +
      '<textarea id="blCuerpo" placeholder="La respuesta.">' + esc(b.cuerpo || '') + '</textarea>' +
      '<div class="acc-bloque">' +
      '<button type="button" class="btn lima chico" data-bsave="' + idx + '" data-bmod="' + mod + '">Guardar</button>' +
      '<button type="button" class="btn chico" data-bcancel="1">Cancelar</button>' +
      '</div></div></section>';

    const bloquesExtra = (mod) => {
      let s = '';
      listaBl.forEach((b, idx) => {
        if ((b.modulo || 'cuenta') !== mod) return;
        if (AGENCIA && BEDIT === idx) { s += formBloque(b, idx, mod); return; }
        s += '<section class="bloque bloque-extra">' +
          (b.titulo ? '<h2>' + esc(b.titulo) + '</h2>' : '') +
          (b.pregunta ? '<p class="pregunta">' + esc(b.pregunta) + '</p>' : '') +
          (b.cuerpo ? '<p class="prosa">' + esc(b.cuerpo) + '</p>' : '') +
          (AGENCIA ? '<div class="acc-bloque">' +
            '<button type="button" class="btn chico" data-bed="' + idx + '">Editar</button>' +
            '<button type="button" class="btn chico" data-bdel="' + idx + '">Borrar</button></div>' : '') +
          '</section>';
      });
      if (AGENCIA && BEDIT && BEDIT.nuevo === mod) s += formBloque({}, -1, mod);
      if (AGENCIA && BEDIT === null) s += '<div class="agregar-bloque">' +
        '<button type="button" class="btn chico" data-badd="' + mod + '">+ Agregar sección</button></div>';
      return s;
    };

    bloques.cuenta   += bloquesExtra('cuenta');
    bloques.organico += bloquesExtra('organico');
    bloques.pauta    += bloquesExtra('pauta');

    bloques.cuenta += textos.cuenta;"""))

E.append(("handlers", """    main.querySelectorAll('[data-solapa]').forEach(b => b.addEventListener('click', () => {""",
"""    // ── Bloques: agregar, editar, borrar ───────────────────────
    async function guardarBloques(arr) {
      const { error } = await SB.from('reporte')
        .update({ bloques: arr, actualizado_en: new Date().toISOString() })
        .eq('id', r.id);
      if (error) { toast('No se pudo guardar: ' + error.message, true); return false; }
      return true;
    }

    main.querySelectorAll('[data-badd]').forEach(b => b.addEventListener('click', () => {
      BEDIT = { nuevo: b.dataset.badd }; render();
    }));
    main.querySelectorAll('[data-bed]').forEach(b => b.addEventListener('click', () => {
      BEDIT = Number(b.dataset.bed); render();
    }));
    const bc = main.querySelector('[data-bcancel]');
    if (bc) bc.addEventListener('click', () => { BEDIT = null; render(); });

    main.querySelectorAll('[data-bdel]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('¿Borrar esta sección?')) return;
      const arr = listaBl.slice();
      arr.splice(Number(b.dataset.bdel), 1);
      if (await guardarBloques(arr)) { toast('Sección borrada.'); await cargarCliente(); }
    }));

    const bs = main.querySelector('[data-bsave]');
    if (bs) bs.addEventListener('click', async () => {
      const nuevo = {
        modulo:   bs.dataset.bmod,
        titulo:   ($('#blTitulo').value || '').trim(),
        pregunta: ($('#blPregunta').value || '').trim(),
        cuerpo:   ($('#blCuerpo').value || '').trim(),
      };
      if (!nuevo.titulo && !nuevo.cuerpo) { toast('Poné al menos un título o un texto.', true); return; }
      const idx = Number(bs.dataset.bsave);
      const arr = listaBl.slice();
      if (idx >= 0) arr[idx] = nuevo; else arr.push(nuevo);
      if (await guardarBloques(arr)) { BEDIT = null; toast('Sección guardada.'); await cargarCliente(); }
    });

    main.querySelectorAll('[data-solapa]').forEach(b => b.addEventListener('click', () => {"""))


def main():
    if not os.path.exists(RUTA):
        sys.exit("No encuentro panel.html. Estas en la raiz del repo?")
    s = open(RUTA, encoding="utf-8").read()
    if 'data-badd' in s:
        print("Ya esta aplicado."); return
    malas = [n for n, v, _ in E if s.count(v) != 1]
    if malas:
        print("NO se toco nada. Anclas que no coinciden:", ", ".join(malas)); sys.exit(1)
    for _, v, n in E:
        s = s.replace(v, n, 1)
    shutil.copy2(RUTA, RUTA + ".bak-bloques")
    open(RUTA, "w", encoding="utf-8").write(s)
    print("Listo. %d ediciones. Backup en %s.bak-bloques" % (len(E), RUTA))

if __name__ == "__main__":
    main()
