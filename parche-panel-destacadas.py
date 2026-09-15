#!/usr/bin/env python3
"""
panel.html — fila de destacadas arriba de cada solapa.

Toma las metricas que ya existen y muestra las 3 o 4 que resumen el
mes, en grande y con la comparacion contra el mes anterior.

En Cuenta se muestran juntas las de contenido propio y las de pauta,
pero SIEMPRE rotuladas por origen: el alcance de una y el de la otra
no se suman ni se presentan como un total.

Correr desde la raiz del repo:
    python3 parche-panel-destacadas.py
Idempotente. Backup en panel.html.bak-destacadas
"""
import sys, os, shutil

RUTA = "panel.html"
E = []

E.append(("css", """  .agregar-bloque { margin: 6px 0 26px; }""",
"""  .agregar-bloque { margin: 6px 0 26px; }

  /* Fila de destacadas: el titular del mes. */
  .destacadas-fila {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 12px; margin-bottom: 30px;
  }
  .dest-card {
    background: var(--bg-elev); border: 1px solid var(--line);
    border-radius: var(--radius-lg); padding: 18px 20px 16px;
  }
  .dest-card .et {
    font-size: 10px; letter-spacing: .07em; text-transform: uppercase;
    color: var(--ink-mute); margin-bottom: 10px;
  }
  .dest-card .val {
    font-family: var(--display); font-size: 40px; font-weight: 500;
    line-height: 1; letter-spacing: -0.02em;
  }
  .dest-card .val.vacio { color: var(--ink-mute); font-weight: 400; font-size: 30px; }
  .dest-card .delta { font-size: 12px; margin-top: 10px; display: inline-block; padding: 2px 7px; border-radius: 6px; }
  .dest-card .delta.bien { background: var(--lime-soft); }
  .dest-card .delta.bien::before { content: '▲ '; }
  .dest-card .delta.mal { background: var(--coral-soft); color: #B2405E; }
  .dest-card .delta.mal::before { content: '▼ '; }
  .dest-card .delta.nada { color: var(--ink-mute); padding-left: 0; }
  .dest-card .de { display: block; font-size: 10px; color: var(--ink-mute); margin-top: 8px;
                   letter-spacing: .05em; text-transform: uppercase; }"""))

E.append(("render", """    bloques.cuenta   += bloquesExtra('cuenta');""",
"""    // ── Fila de destacadas ─────────────────────────────────────
    // Se arman con las mismas metricas que ya estan cargadas: no hay
    // ningun numero nuevo ni ningun calculo propio de esta fila.
    const DESTACADAS = {
      organico: ['alcance', 'interacciones', 'guardados', 'seguidores'],
      pauta:    ['inversion', 'resultados', 'costo_por_resultado', 'alcance'],
    };

    const tarjeta = (m, mod, conOrigen) => {
      const sinDato = m.valor == null || m.valor === '';
      const d = sinDato ? null : delta(m, prevVal(mod, m.clave));
      return '<div class="dest-card">' +
        '<div class="et">' + esc(m.etiqueta) + '</div>' +
        (sinDato
          ? '<div class="val vacio">—</div>'
          : '<div class="val">' + esc(fmt(m.valor, m.unidad)) + '</div>' +
            '<div class="delta ' + d.clase + '">' + esc(d.txt) + '</div>') +
        (conOrigen ? '<span class="de">' + NOMBRE_MOD[mod] + '</span>' : '') +
        '</div>';
    };

    const filaDe = (pares, conOrigen) => {
      const cards = pares.map(([mod, clave]) => {
        const m = r.metricas.find(x => x.modulo === mod && x.clave === clave);
        return m ? tarjeta(m, mod, conOrigen) : '';
      }).filter(Boolean);
      if (!cards.length) return '';
      return '<div class="destacadas-fila">' + cards.join('') + '</div>';
    };

    ['organico', 'pauta'].forEach(mod => {
      if (!MODULOS[mod]) return;
      bloques[mod] = filaDe(DESTACADAS[mod].map(c => [mod, c]), false) + bloques[mod];
    });

    // En Cuenta conviven las dos patas. Van rotuladas por origen
    // justamente para que nadie las lea como un total: el alcance
    // del contenido propio y el de la pauta cuentan dos veces a las
    // mismas personas y no se suman.
    const paresCuenta = [];
    if (MODULOS.organico) paresCuenta.push(['organico', 'alcance'], ['organico', 'seguidores']);
    if (MODULOS.pauta)    paresCuenta.push(['pauta', 'inversion'], ['pauta', 'costo_por_resultado']);
    bloques.cuenta = filaDe(paresCuenta, true) + bloques.cuenta;

    bloques.cuenta   += bloquesExtra('cuenta');"""))


def main():
    if not os.path.exists(RUTA):
        sys.exit("No encuentro panel.html. Estas en la raiz del repo?")
    s = open(RUTA, encoding="utf-8").read()
    if 'destacadas-fila' in s:
        print("Ya esta aplicado."); return
    malas = [n for n, v, _ in E if s.count(v) != 1]
    if malas:
        print("NO se toco nada. Anclas que no coinciden:", ", ".join(malas)); sys.exit(1)
    for _, v, n in E:
        s = s.replace(v, n, 1)
    shutil.copy2(RUTA, RUTA + ".bak-destacadas")
    open(RUTA, "w", encoding="utf-8").write(s)
    print("Listo. %d ediciones. Backup en %s.bak-destacadas" % (len(E), RUTA))

if __name__ == "__main__":
    main()
