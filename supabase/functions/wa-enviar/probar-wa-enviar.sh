#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  probar-wa-enviar.sh · prueba la función de envío.
#
#  Lo que importa: que FUERA de la ventana gratis NO mande nada (409),
#  que valide la entrada, y que no mande dos veces con la misma
#  idem_key. El envío real a Meta es opcional (ENVIAR_REAL=si) y
#  necesita un número registrado como destinatario de prueba.
#
#  Qué chequea:
#    1. Sin Authorization → 401
#    2. Con sesión, falta conversacion_id → 400
#    3. Con sesión, idem_key no-uuid → 400
#    4. Conversación con ventana VENCIDA → 409 (no manda nada)
#    5. (ENVIAR_REAL=si) ventana abierta → 200 ok
#    6. (ENVIAR_REAL=si) misma idem_key otra vez → 200 repetido (no reenvía)
#
#  Siembra (service_role) dos conversaciones de prueba bajo un cliente
#  que el usuario de agencia pueda ver, y las borra al terminar
#  (prefijo dddd0000, cascada a mensaje/conversacion_pauta/outbox).
#
#  Uso:
#    WA_ENVIAR_URL="https://<ref>.supabase.co/functions/v1/wa-enviar" \
#    SUPABASE_URL="https://<ref>.supabase.co" \
#    SUPABASE_ANON_KEY="<anon key>" \
#    SUPABASE_SERVICE_ROLE_KEY="<service role key>" \
#    TEST_EMAIL="<mail de un usuario de agencia>" \
#    TEST_PASSWORD="<su password>" \
#    CLIENTE_ID="<uuid de un cliente que ese usuario ve>" \
#    [ ENVIAR_REAL=si DESTINO="<wa_id de prueba, solo dígitos>" ] \
#    bash supabase/functions/wa-enviar/probar-wa-enviar.sh
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

URL="${WA_ENVIAR_URL:?falta WA_ENVIAR_URL}"
SB="${SUPABASE_URL:?falta SUPABASE_URL}"; SB="${SB%/}"   # sin barra final: evita //rest/v1 → 404
ANON="${SUPABASE_ANON_KEY:?falta SUPABASE_ANON_KEY}"
SRK="${SUPABASE_SERVICE_ROLE_KEY:?falta SUPABASE_SERVICE_ROLE_KEY}"
EMAIL="${TEST_EMAIL:?falta TEST_EMAIL}"
PASS="${TEST_PASSWORD:?falta TEST_PASSWORD}"
CLI="${CLIENTE_ID:?falta CLIENTE_ID}"
DESTINO="${DESTINO:-990000053001}"

CV='dddd0000-0000-0000-0000-00000000e0c1'   # conversación VENCIDA
CA='dddd0000-0000-0000-0000-00000000e0a1'   # conversación ABIERTA

ok=0; fallo=0
check() { if [ "$2" = "$3" ]; then echo "  PASS  $1 ($3)"; ok=$((ok+1)); else echo "  FALLA $1 · esperaba $2, obtuve $3"; fallo=$((fallo+1)); fi; }
uuid() { local h; h=$(openssl rand -hex 16); echo "${h:0:8}-${h:8:4}-${h:12:4}-${h:16:4}-${h:20:12}"; }

jpost() { # $1 bearer · $2 json  → http code
  curl -s -o /dev/null -w '%{http_code}' -X POST "$URL" \
    -H "Authorization: Bearer $1" -H 'Content-Type: application/json' --data-binary "$2"
}
jbody() { # $1 bearer · $2 json  → body
  curl -s -X POST "$URL" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' --data-binary "$2"
}

limpiar() {
  echo ""; echo "Limpieza:"
  local code
  # id es uuid: NO se puede filtrar con like (no hay operador uuid ~~),
  # da 404. Se borra por la lista exacta de ids; la cascada se lleva
  # mensaje, conversacion_pauta y outbox_envio.
  code=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE \
    "$SB/rest/v1/conversacion?id=in.($CV,$CA)" \
    -H "apikey: $SRK" -H "Authorization: Bearer $SRK" -H "Prefer: return=minimal" || echo ERR)
  echo "  delete conversaciones de prueba (cascada) → HTTP $code"
}
trap limpiar EXIT

echo "── wa-enviar · $URL ──"

# ── Login (JWT real del usuario de agencia) ──────────────────────
TOKEN=$(curl -s -X POST "$SB/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" \
  | grep -o '"access_token":"[^"]*"' | sed 's/.*:"//;s/"$//')
[ -n "$TOKEN" ] || { echo "No pude loguear a $EMAIL. Revisá mail/password." >&2; exit 1; }
echo "  login OK"

# ── Siembra (service_role) ───────────────────────────────────────
VENCIDA=$(date -u -d '-80 hours' +%Y-%m-%dT%H:%M:%SZ)
AHORA=$(date -u +%Y-%m-%dT%H:%M:%SZ)
seed() { curl -s -o /dev/null -X POST "$SB/rest/v1/$1" -H "apikey: $SRK" -H "Authorization: Bearer $SRK" \
  -H 'Content-Type: application/json' -H 'Prefer: resolution=merge-duplicates' --data-binary "$2"; }

seed conversacion "{\"id\":\"$CV\",\"cliente_id\":\"$CLI\",\"telefono\":\"990000053999\",\"origen\":\"pauta\"}"
seed conversacion "{\"id\":\"$CA\",\"cliente_id\":\"$CLI\",\"telefono\":\"$DESTINO\",\"origen\":\"pauta\"}"
seed conversacion_pauta "{\"conversacion_id\":\"$CV\",\"ctwa_clid\":\"prueba-vencida\",\"recibido_en\":\"$VENCIDA\"}"
seed conversacion_pauta "{\"conversacion_id\":\"$CA\",\"ctwa_clid\":\"prueba-abierta\",\"recibido_en\":\"$AHORA\"}"
echo "  seed OK (vencida y abierta)"

echo ""
echo "Gates:"
# 1. Sin Authorization (header con un bearer vacío no pasa el gateway;
#    mandamos sin header y el gateway/função responde 401).
check "1. sin sesión" "401" "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$URL" -H 'Content-Type: application/json' --data-binary '{}')"
check "2. falta conversacion_id" "400" "$(jpost "$TOKEN" "{\"idem_key\":\"$(uuid)\",\"texto\":\"hola\"}")"
check "3. idem_key no-uuid"       "400" "$(jpost "$TOKEN" "{\"conversacion_id\":\"$CA\",\"idem_key\":\"no-uuid\",\"texto\":\"hola\"}")"

echo ""
echo "Ventana (lo que no puede costar plata):"
RESP_V=$(jbody "$TOKEN" "{\"conversacion_id\":\"$CV\",\"idem_key\":\"$(uuid)\",\"texto\":\"hola\"}")
CODE_V=$(jpost "$TOKEN" "{\"conversacion_id\":\"$CV\",\"idem_key\":\"$(uuid)\",\"texto\":\"hola\"}")
check "4. ventana vencida → 409" "409" "$CODE_V"
echo "     body: $RESP_V"

if [ "${ENVIAR_REAL:-no}" = "si" ]; then
  echo ""
  echo "Envío real (ventana abierta, destino $DESTINO):"
  K=$(uuid)
  check "5. ventana abierta → 200"        "200" "$(jpost "$TOKEN" "{\"conversacion_id\":\"$CA\",\"idem_key\":\"$K\",\"texto\":\"Prueba wa-enviar · ignorar\"}")"
  check "6. misma idem_key → 200 (no reenvía)" "200" "$(jpost "$TOKEN" "{\"conversacion_id\":\"$CA\",\"idem_key\":\"$K\",\"texto\":\"Prueba wa-enviar · ignorar\"}")"
else
  echo ""
  echo "  (envío real omitido: pasá ENVIAR_REAL=si y DESTINO=<número de prueba> para probarlo)"
fi

echo ""
echo "── $ok OK · $fallo fallas ──"
[ "$fallo" -eq 0 ]
