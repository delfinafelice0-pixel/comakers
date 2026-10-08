#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  probar-modulos.sh · las solapas nuevas del panel (Calendario,
#  Estrategia, Objetivos, One Shot, Servicio) con el Supabase de
#  mentira, en vista AGENCIA y vista CLIENTE. Saca capturas.
#
#  Uso, desde la raíz del repo:
#
#      bash fuente/probar-modulos.sh                 # todas
#      bash fuente/probar-modulos.sh calendario      # una
#
#  Necesita _datos-privados/demo-panel-mock.js, que genera
#  `python _datos-privados/demo_panel.py` (los datos de demo de Don
#  Felipe y Dr. Maca Flos: no están en el repo, que es público).
#
#  Mismo método que probar-panel.sh: se reemplaza la línea del CDN de
#  Supabase por el mock y se abre en Chrome headless. La vista cliente
#  usa los datos recortados por comoCliente() (fuente/datos-modulos.js),
#  que IMITA la RLS de la 51: lo que la RLS deja ver de verdad se
#  prueba con SQL, no con esto.
#
#  Deja en _prueba/ cap-mod-<solapa>-<agencia|cliente>[-extra].png
# ═══════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")/.."
RAIZ="$(pwd)"
OUT="_prueba"
DEMO="_datos-privados/demo-panel-mock.js"
[ -f "$DEMO" ] || { echo "Falta $DEMO: corré python _datos-privados/demo_panel.py" >&2; exit 1; }

if command -v cygpath >/dev/null 2>&1; then
  URL_RAIZ="file:///$(cygpath -m "$RAIZ")"
  DIR_OUT="$(cygpath -m "$RAIZ")/_prueba"
  DIR_PERFIL="$(cygpath -w "$RAIZ")\\_prueba\\.chrome-mod"
else
  URL_RAIZ="file://$RAIZ"; DIR_OUT="$RAIZ/_prueba"; DIR_PERFIL="$RAIZ/_prueba/.chrome-mod"
fi
if [ -z "${CHROME:-}" ]; then
  for c in "/c/Program Files/Google/Chrome/Application/chrome.exe" \
           "/c/Program Files (x86)/Google/Chrome/Application/chrome.exe" \
           "/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" \
           "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"; do
    [ -x "$c" ] && CHROME="$c" && break
  done
fi
[ -n "${CHROME:-}" ] || { echo "No encontré Chrome" >&2; exit 1; }
mkdir -p "$OUT"

CDN=$(grep -n 'supabase-js@2' panel.html | head -1 | cut -d: -f1)

# $1 salida · $2 modo (agencia|cliente) · $3 driver js · $4 ?c=slug
armar() {
  local out="$1" modo="$2" driver="$3"
  local datos=DATOS_MOD_AGENCIA sesion=SESION_MOD_AGENCIA
  [ "$modo" = cliente ] && datos=DATOS_MOD_CLIENTE && sesion=SESION_MOD_CLIENTE
  head -n $((CDN - 1)) panel.html > "$out"
  cat >> "$out" <<BOOT
<!-- ── arranque de prueba · fuente/probar-modulos.sh ── -->
<script>var module = { exports: {} }; window.__MODO = '$modo';</script>
<script src="fuente/mock-supabase.js"></script>
<script src="$DEMO"></script>
<script src="fuente/datos-modulos.js"></script>
<script>
  var hacer = (typeof textoDelMock === 'function') ? textoDelMock : module.exports.textoDelMock;
  eval(hacer($datos, $sesion));
  window.confirm = function () { return true; };
  function esperar(sel, fn, n) {
    n = n || 0;
    var el = document.querySelector(sel);
    if (el) { fn(el); return; }
    if (n < 150) setTimeout(function () { esperar(sel, fn, n + 1); }, 40);
  }
  function irA(sec, despues) {
    esperar('.nav-item[data-seccion="' + sec + '"]', function (b) { b.click(); if (despues) setTimeout(despues, 400); });
  }
  window.addEventListener('load', function () { setTimeout(function () { $driver }, 150); });
</script>
<!-- ── fin del arranque de prueba ── -->
BOOT
  tail -n +$((CDN + 1)) panel.html >> "$out"
}

capturar() {
  local nombre="$1" archivo="$2" alto="${3:-2300}"
  rm -f "$OUT/cap-mod-$nombre.png"
  "$CHROME" --headless=new --disable-gpu --no-sandbox --hide-scrollbars --allow-file-access-from-files \
    --user-data-dir="$DIR_PERFIL" --window-size=1500,$alto --virtual-time-budget=12000 \
    --screenshot="$DIR_OUT/cap-mod-$nombre.png" "$URL_RAIZ/$archivo" >/dev/null 2>&1 || true
  if [ -s "$OUT/cap-mod-$nombre.png" ]; then echo "  OK    $OUT/cap-mod-$nombre.png"
  else echo "  FALLÓ $nombre" >&2; fi
}

# caso: nombre · modo · driver · slug · alto
caso() {
  local nombre="$1" modo="$2" driver="$3" slug="$4" alto="${5:-2300}"
  local f="_prueba-mod-$nombre.html"
  armar "$f" "$modo" "$driver"
  capturar "$nombre" "$f?c=$slug" "$alto"
}

SOLO="${1:-}"
quiero() { [ -z "$SOLO" ] || [ "$SOLO" = "$1" ]; }

echo "Capturas:"
if quiero calendario; then
  caso calendario-agencia   agencia "irA('calendario');" don-felipe 3400
  caso calendario-cliente   cliente "irA('calendario');" don-felipe 3400
  caso calendario-maca      agencia "irA('calendario');" dr-maca-flos 2600
  caso calendario-ficha     agencia "irA('calendario', function () { esperar('[data-cont]', function (c) { c.click(); }); });" don-felipe 1400
  caso calendario-ficha-cl  cliente "irA('calendario', function () { esperar('[data-cont]', function (c) { c.click(); }); });" don-felipe 1400
  caso calendario-vista     agencia "irA('calendario', function () { esperar('[data-vista]', function (b) { b.click(); }); });" don-felipe 2600
fi
if quiero estrategia; then
  caso estrategia-agencia   agencia "irA('estrategia');" don-felipe 3200
  caso estrategia-cliente   cliente "irA('estrategia');" don-felipe 3200
  caso estrategia-pauta     agencia "irA('estrategia', function () { esperar('[data-parte=\"pauta\"]', function (b) { b.click(); }); });" dr-maca-flos 2200
fi
if quiero servicio; then
  caso servicio-agencia     agencia "irA('servicio');" don-felipe 1800
  caso servicio-cliente     cliente "irA('servicio');" don-felipe 1800
fi
if quiero objetivos; then
  caso objetivos-agencia    agencia "irA('objetivos');" don-felipe 2000
  caso objetivos-cliente    cliente "irA('objetivos');" don-felipe 2000
  caso objetivos-reporte    agencia "esperar('[data-irmes=\"2026-09\"]', function (b) { b.click(); });" don-felipe 2600
fi
if quiero one_shot; then
  caso oneshot-agencia      agencia "irA('one_shot');" don-felipe 2600
  caso oneshot-cliente      cliente "irA('one_shot');" don-felipe 2600
  caso oneshot-comparar     agencia "irA('one_shot', function () { esperar('[data-comparar]', function (b) { b.click(); }); });" don-felipe 2600
fi

[ -n "${KEEP:-}" ] || rm -f _prueba-mod-*.html
echo "Listo. Capturas en $OUT/"
