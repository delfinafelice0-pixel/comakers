#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  probar-panel.sh · abre panel.html con el Supabase de mentira,
#  saca capturas y chequea la sintaxis del <script>.
#
#  Uso, desde la raíz del repo:
#
#      bash fuente/probar-panel.sh
#
#  Deja en _prueba/ las capturas y las páginas generadas. Esa carpeta
#  está en .gitignore: nada de lo que genera va al repo.
#
#  ── Por qué así ────────────────────────────────────────────────
#
#  El método original usaba Playwright (page.addInitScript) desde
#  node. En esta máquina no hay node ni python, así que se usa Chrome
#  headless directamente: es el mismo V8 y no hace falta instalar
#  nada. El mock se inyecta reemplazando la línea del <script> del
#  CDN de Supabase, así `window.supabase` es el de mentira y la
#  página nunca sale a internet.
#
#  Usa el textoDelMock REAL de fuente/mock-supabase.js, no una copia.
#
#  ── Qué produce ────────────────────────────────────────────────
#
#    _prueba/cap-agencia.png   septiembre en borrador, visto por la agencia
#    _prueba/cap-cliente.png   agosto publicado, visto por el cliente
#    _prueba/cap-confirm.png   el confirm de Publicar
#
#  ⚠️ El confirm NO es el diálogo nativo. Chrome headless lo
#  auto-descarta y no lo dibuja, así que se captura el texto y se
#  pinta en la página con un encabezado que lo aclara. El texto es
#  literal; la ventanita no.
#
#  ⚠️ El mock no tiene RLS. La vista del cliente usa un dataset
#  recortado a mano a las filas publicadas. Que la RLS realmente le
#  esconda el borrador se prueba con SQL, no con esto.
# ═══════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")/.."
RAIZ="$(pwd)"
OUT="_prueba"

# Chrome en Windows no entiende las rutas de Git Bash (/c/Users/...):
# necesita C:/Users/... Con cygpath se convierte; en macOS no hace
# falta y la ruta va tal cual.
# --screenshot también necesita ruta absoluta de Windows: con una
# relativa escribe en silencio donde no es y el archivo no aparece.
if command -v cygpath >/dev/null 2>&1; then
  URL_RAIZ="file:///$(cygpath -m "$RAIZ")"
  DIR_OUT="$(cygpath -m "$RAIZ")/_prueba"
  DIR_PERFIL="$(cygpath -w "$RAIZ")\\_prueba\\.chrome"
else
  URL_RAIZ="file://$RAIZ"
  DIR_OUT="$RAIZ/_prueba"
  DIR_PERFIL="$RAIZ/_prueba/.chrome"
fi

# Chrome. Se puede pisar con:  CHROME="/ruta/al/chrome" bash fuente/probar-panel.sh
if [ -z "${CHROME:-}" ]; then
  for c in \
    "/c/Program Files/Google/Chrome/Application/chrome.exe" \
    "/c/Program Files (x86)/Google/Chrome/Application/chrome.exe" \
    "/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" \
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"; do
    [ -x "$c" ] && CHROME="$c" && break
  done
fi
if [ -z "${CHROME:-}" ]; then
  echo "No encontré Chrome. Pasalo con: CHROME=/ruta/al/chrome bash fuente/probar-panel.sh" >&2
  exit 1
fi
echo "Chrome: $CHROME"

mkdir -p "$OUT"
# Las páginas generadas van en la RAÍZ y no en $OUT: panel.html
# referencia fuente/ y las imágenes con rutas relativas a la raíz.
# El prefijo _prueba-panel- está en .gitignore.

CDN=$(grep -n 'supabase-js@2' panel.html | head -1 | cut -d: -f1)
[ -n "$CDN" ] || { echo "No encontré la línea del CDN de Supabase en panel.html" >&2; exit 1; }
echo "Línea del CDN que se reemplaza por el mock: $CDN"

# $1 salida · $2 sesión · $3 datos · $4 driver js · $5 panel fuente
armar() {
  local out="$1" sesion="$2" datos="$3" driver="$4" src="$5"
  head -n $((CDN - 1)) "$src" > "$out"
  cat >> "$out" <<BOOT
<!-- ── arranque de prueba · lo pone fuente/probar-panel.sh ───── -->
<script>var module = { exports: {} };</script>
<script src="fuente/mock-supabase.js"></script>
<script src="fuente/datos-panel.js"></script>
<script>
  var hacer = (typeof textoDelMock === 'function') ? textoDelMock : module.exports.textoDelMock;
  eval(hacer($datos, $sesion));

  // confirm() en headless se auto-descarta y no se puede fotografiar:
  // se captura el texto y se dibuja, avisando qué es.
  window.__CONFIRMS = [];
  window.confirm = function (msg) {
    window.__CONFIRMS.push(msg);
    var d = document.createElement('div');
    d.setAttribute('style', 'position:fixed;z-index:9999;left:50%;top:40px;transform:translateX(-50%);max-width:560px;background:#fff;border:2px solid #c0392b;border-radius:10px;font:14px/1.5 system-ui;box-shadow:0 18px 50px rgba(0,0,0,.35);overflow:hidden');
    var h = document.createElement('div');
    h.setAttribute('style', 'background:#c0392b;color:#fff;padding:8px 14px;font-size:11px;letter-spacing:.08em;text-transform:uppercase');
    h.textContent = 'texto capturado de window.confirm() — no es el diálogo nativo';
    var b = document.createElement('div');
    b.setAttribute('style', 'padding:14px 16px;white-space:pre-wrap');
    b.textContent = msg;
    var p = document.createElement('div');
    p.setAttribute('style', 'padding:0 16px 14px;color:#666;font-size:12px');
    p.textContent = 'Se devolvió false: no se publicó nada.';
    d.appendChild(h); d.appendChild(b); d.appendChild(p);
    document.body.appendChild(d);
    return false;
  };

  function esperar(sel, fn, n) {
    n = n || 0;
    var el = document.querySelector(sel);
    if (el) { fn(el); return; }
    if (n < 120) setTimeout(function () { esperar(sel, fn, n + 1); }, 40);
  }
  window.addEventListener('load', function () { setTimeout(function () { $driver }, 150); });
</script>
<!-- ── fin del arranque de prueba ────────────────────────────── -->
BOOT
  tail -n +$((CDN + 1)) "$src" >> "$out"
}

# La agencia abre en el mes en curso, que no tiene reporte: hay que
# caminar hasta septiembre. El cliente abre solo en su último mes
# publicado, así que no necesita driver.
IR_A_SEP='esperar(String.fromCharCode(91)+"data-irmes=\"2026-09\""+String.fromCharCode(93), function (b) { b.click(); });'
NADA='void 0;'
PUBLICAR="$IR_A_SEP setTimeout(function () { esperar('#btnPublicar', function (b) { b.click(); }); }, 500);"
# Agencia en agosto: tiene snapshot que DIFIERE de lo vivo → aviso
# "cambios sin publicar" + botón Republicar. Se llega sep → ago.
IR_A_AGO="$IR_A_SEP setTimeout(function () { esperar(String.fromCharCode(91)+'data-irmes=\"2026-08\"'+String.fromCharCode(93), function (b) { b.click(); }); }, 500);"

armar _prueba-panel-agencia.html SESION_AGENCIA DATOS_AGENCIA "$IR_A_SEP" panel.html
armar _prueba-panel-cliente.html SESION_CLIENTE DATOS_CLIENTE "$NADA"     panel.html
armar _prueba-panel-confirm.html SESION_AGENCIA DATOS_AGENCIA "$PUBLICAR" panel.html
armar _prueba-panel-agcambios.html SESION_AGENCIA DATOS_AGENCIA "$IR_A_AGO" panel.html

capturar() {
  local nombre="$1" archivo="$2"
  "$CHROME" --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
    --user-data-dir="$DIR_PERFIL" --window-size=1500,2300 --virtual-time-budget=9000 \
    --screenshot="$DIR_OUT/cap-$nombre.png" "$URL_RAIZ/$archivo" >/dev/null 2>&1 || true
  if [ -s "$OUT/cap-$nombre.png" ]; then echo "  OK    $OUT/cap-$nombre.png"
  else echo "  FALLÓ $nombre" >&2; fi
}

echo "Capturas:"
capturar agencia _prueba-panel-agencia.html
capturar cliente _prueba-panel-cliente.html
capturar confirm _prueba-panel-confirm.html
capturar agcambios _prueba-panel-agcambios.html

# ── Sintaxis del <script> ──────────────────────────────────────
# Reemplaza a `node --check` donde no hay node: new Function() parsea
# sin ejecutar, y es el mismo V8.
A=$(grep -n '^<script>$' panel.html | tail -1 | cut -d: -f1)
B=$(grep -n '^</script>$' panel.html | tail -1 | cut -d: -f1)
sed -n "$((A + 1)),$((B - 1))p" panel.html > "$OUT/panel-script.js"
{
  echo '<!doctype html><meta charset="utf-8"><title>chequeando</title><body><pre id="o"></pre>'
  echo '<script type="text/plain" id="src">'
  cat "$OUT/panel-script.js"
  echo '</scr'"ipt>"
  echo '<script>'
  echo 'var s = document.getElementById("src").textContent, o = document.getElementById("o");'
  echo 'try { new Function(s); o.textContent = "PARSE OK · " + s.length + " chars"; }'
  echo 'catch (e) { o.textContent = "PARSE ERROR: " + e.name + ": " + e.message; }'
  echo '</scr'"ipt>"
} > _prueba-check.html

"$CHROME" --headless=new --disable-gpu --no-sandbox --user-data-dir="$DIR_PERFIL" \
  --virtual-time-budget=5000 --dump-dom "$URL_RAIZ/_prueba-check.html" 2>/dev/null \
  | grep -o 'PARSE OK[^<]*\|PARSE ERROR[^<]*' | head -1 | sed 's/^/Sintaxis: /'

rm -f _prueba-panel-*.html _prueba-check.html
echo "Listo. Las capturas quedaron en $OUT/"
