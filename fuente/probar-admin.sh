#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  probar-admin.sh · abre la solapa Clientes de administración con el
#  Supabase de mentira, saca capturas.
#
#  Uso, desde la raíz del repo (después de correr fuente/build.py):
#
#      bash fuente/probar-admin.sh
#
#  Prueba el administracion.html recién buildeado (fuente/), no el de
#  la raíz: así se ve lo que se va a subir antes de copiarlo.
#
#  Mismo método que probar-panel.sh: se reemplaza la línea del CDN de
#  Supabase por el mock (fuente/mock-supabase.js) sembrado con
#  fuente/datos-admin.js, así la página nunca sale a internet. No hay
#  RLS: esto prueba la PANTALLA.
#
#  Deja en _prueba/ las capturas (carpeta en .gitignore):
#    cap-admin-lista.png      la solapa Clientes (una sola lista + ⚙)
#    cap-admin-popup.png      el popup de FOS con la sección Panel
#    cap-admin-inactivos.png  "Ver inactivos" prendido
# ═══════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")/.."
RAIZ="$(pwd)"
OUT="_prueba"
SRC="fuente/administracion.html"

[ -f "$SRC" ] || { echo "No está $SRC. Corré fuente/build.py primero." >&2; exit 1; }

if command -v cygpath >/dev/null 2>&1; then
  URL_RAIZ="file:///$(cygpath -m "$RAIZ")"
  DIR_OUT="$(cygpath -m "$RAIZ")/_prueba"
  DIR_PERFIL="$(cygpath -w "$RAIZ")\\_prueba\\.chrome"
else
  URL_RAIZ="file://$RAIZ"
  DIR_OUT="$RAIZ/_prueba"
  DIR_PERFIL="$RAIZ/_prueba/.chrome"
fi

if [ -z "${CHROME:-}" ]; then
  for c in \
    "/c/Program Files/Google/Chrome/Application/chrome.exe" \
    "/c/Program Files (x86)/Google/Chrome/Application/chrome.exe" \
    "/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" \
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"; do
    [ -x "$c" ] && CHROME="$c" && break
  done
fi
[ -n "${CHROME:-}" ] || { echo "No encontré Chrome. Pasalo con CHROME=/ruta bash fuente/probar-admin.sh" >&2; exit 1; }
echo "Chrome: $CHROME"

mkdir -p "$OUT"

CDN=$(grep -n 'supabase-js@2' "$SRC" | head -1 | cut -d: -f1)
[ -n "$CDN" ] || { echo "No encontré la línea del CDN de Supabase en $SRC" >&2; exit 1; }
echo "Línea del CDN que se reemplaza por el mock: $CDN"

# $1 salida · $2 driver js
armar() {
  local out="$1" driver="$2"
  head -n $((CDN - 1)) "$SRC" > "$out"
  cat >> "$out" <<BOOT
<!-- ── arranque de prueba · lo pone fuente/probar-admin.sh ───── -->
<script>var module = { exports: {} };</script>
<script src="fuente/mock-supabase.js"></script>
<script src="fuente/datos-admin.js"></script>
<script>
  var hacer = (typeof textoDelMock === 'function') ? textoDelMock : module.exports.textoDelMock;
  eval(hacer(DATOS_ADMIN, SESION_ADMIN));

  // confirm() en headless se auto-descarta y no se puede fotografiar: se
  // captura el texto y se dibuja, avisando qué es. Se devuelve false, así
  // que el toggle no avanza: la captura es del TEXTO de la confirmación.
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
    d.appendChild(h); d.appendChild(b);
    document.body.appendChild(d);
    return false;
  };

  function esperar(sel, fn, n) {
    n = n || 0;
    var el = document.querySelector(sel);
    if (el) { fn(el); return; }
    if (n < 150) setTimeout(function () { esperar(sel, fn, n + 1); }, 40);
  }
  window.addEventListener('load', function () { setTimeout(function () { $driver }, 200); });
</script>
<!-- ── fin del arranque de prueba ────────────────────────────── -->
BOOT
  tail -n +$((CDN + 1)) "$SRC" >> "$out"
}

NADA='void 0;'
B1='String.fromCharCode(91)'   # [
B2='String.fromCharCode(93)'   # ]
# Abrir el popup de FOS: clic en su engranaje (data-cabrir="c-fos").
POPUP='esperar('"$B1"'+"data-cabrir=\"c-fos\""+'"$B2"', function (b) { b.click(); });'
# Prender "Ver inactivos".
INACTIVOS='esperar("#verInactivosBtn", function (b) { b.click(); });'
# Abrir el popup de FOS y prender el toggle del CRM: dispara el confirm,
# que el harness dibuja con su texto (la confirmación específica del CRM).
CRM='esperar('"$B1"'+"data-cabrir=\"c-fos\""+'"$B2"', function (b) { b.click(); esperar('"$B1"'+"data-clmod=\"crm\""+'"$B2"', function (m) { m.click(); }); });'
# Ir a la solapa Distribución y a Fondo + Gastos. En Distribución la grilla
# es muy ancha (scroll horizontal): para la captura se destraba el overflow
# así entra entera, incluida la columna Verif.
DIST='esperar("#navDist", function (b) { b.click(); setTimeout(function () { var ts = document.querySelectorAll(".tabla-ancha"); for (var i = 0; i < ts.length; i++) ts[i].style.overflow = "visible"; }, 400); });'
# Fondo + Gastos ya no es un módulo del menú: es sub-solapa de Distribución.
FONDO='esperar("#navDist", function (b) { b.click(); esperar('"$B1"'+"data-disttab=\"fondo\""+'"$B2"', function (t) { t.click(); setTimeout(function () { var ts = document.querySelectorAll(".tabla-ancha"); for (var i = 0; i < ts.length; i++) ts[i].style.overflow = "visible"; }, 300); }); });'
# Servicios: la tabla de planes (con costo/margen).
SERV='esperar("#navServicios", function (b) { b.click(); });'
# Editor de un plan: abre el plan CM y despliega "Crear entregable nuevo".
PLAN='esperar("#navServicios", function (b) { b.click(); var B = String.fromCharCode(91), C = String.fromCharCode(93); esperar(B + "data-serv=\"sv-cm\"" + C, function (r) { r.click(); setTimeout(function () { var s = document.querySelector("#svAddItem"); if (s) { s.value = "__nuevo__"; s.dispatchEvent(new Event("change", { bubbles: true })); } }, 350); }); });'
# Proyección por servicio (el toggle nuevo).
PROY='esperar("#navServicios", function (b) { b.click(); var B = String.fromCharCode(91), C = String.fromCharCode(93); esperar(B + "data-svtab=\"proyeccion\"" + C, function (t) { t.click(); setTimeout(function () { var s = document.querySelector(B + "data-proypor=\"servicio\"" + C); if (s) s.click(); }, 350); }); });'
# Gestor de Entregables (modal). Solo se abre; el toggle "Ver archivados"
# se ve igual. (Clickearlo durante la apertura hacía fallar la captura.)
ENT='esperar("#navServicios", function (b) { b.click(); esperar("#svCostos", function (c) { c.click(); }); });'

armar _prueba-admin-lista.html     "$NADA"
armar _prueba-admin-popup.html     "$POPUP"
armar _prueba-admin-inactivos.html "$INACTIVOS"
armar _prueba-admin-crm.html       "$CRM"
armar _prueba-admin-dist.html      "$DIST"
armar _prueba-admin-fondo.html     "$FONDO"
armar _prueba-admin-serv.html      "$SERV"
armar _prueba-admin-plan.html      "$PLAN"
armar _prueba-admin-proy.html      "$PROY"
armar _prueba-admin-ent.html       "$ENT"

capturar() {
  local nombre="$1" archivo="$2"
  "$CHROME" --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
    --user-data-dir="$DIR_PERFIL" --window-size=2600,2000 --virtual-time-budget=9000 \
    --screenshot="$DIR_OUT/cap-$nombre.png" "$URL_RAIZ/$archivo" >/dev/null 2>&1 || true
  if [ -s "$OUT/cap-$nombre.png" ]; then echo "  OK    $OUT/cap-$nombre.png"
  else echo "  FALLÓ $nombre" >&2; fi
}

echo "Capturas:"
capturar admin-lista     _prueba-admin-lista.html
capturar admin-popup     _prueba-admin-popup.html
capturar admin-inactivos _prueba-admin-inactivos.html
capturar admin-crm       _prueba-admin-crm.html
capturar admin-dist      _prueba-admin-dist.html
capturar admin-fondo     _prueba-admin-fondo.html
capturar admin-serv      _prueba-admin-serv.html
capturar admin-plan      _prueba-admin-plan.html
capturar admin-proy      _prueba-admin-proy.html
capturar admin-ent       _prueba-admin-ent.html

rm -f _prueba-admin-*.html
echo "Listo. Las capturas quedaron en $OUT/"
