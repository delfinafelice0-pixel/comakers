#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  probar-enviar-capi.sh · prueba el envío a la Conversions API.
#
#  Lo que importa:
#   · solo el service_role puede dispararla (el cron) → 401 si no;
#   · en DRY-RUN arma el payload EXACTO sin postear a Meta ni tocar
#     filas: se chequea la forma del evento;
#   · el envío real (permiso todavía sin aprobar) cae en
#     PERMISO_PENDIENTE y deja la fila pendiente, no en error.
#
#  Siembra (service_role) un cliente_whatsapp + una conversación de
#  pauta con su clid + dos eventos en la cola (LeadSubmitted y
#  Purchase), y lo borra al terminar (prefijos fijos).
#
#  Para ver el payload sin mandar nada, deployá la función con el
#  secret CAPI_DRY_RUN=1, corré esto, y después sacalo.
#
#  Uso:
#    ENVIAR_CAPI_URL="https://<ref>.supabase.co/functions/v1/enviar-capi" \
#    SUPABASE_URL="https://<ref>.supabase.co" \
#    SUPABASE_ANON_KEY="<anon key>" \
#    SUPABASE_SERVICE_ROLE_KEY="<service role key>" \
#    CLIENTE_ID="<uuid de un cliente>" \
#    bash supabase/functions/enviar-capi/probar-enviar-capi.sh
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

URL="${ENVIAR_CAPI_URL:?falta ENVIAR_CAPI_URL}"
SB="${SUPABASE_URL:?falta SUPABASE_URL}"; SB="${SB%/}"
ANON="${SUPABASE_ANON_KEY:?falta SUPABASE_ANON_KEY}"
SRK="${SUPABASE_SERVICE_ROLE_KEY:?falta SUPABASE_SERVICE_ROLE_KEY}"
CLI="${CLIENTE_ID:?falta CLIENTE_ID}"

# Datos de prueba, prefijos fijos para poder limpiarlos.
CW='cccc0000-0000-0000-0000-00000000ca01'   # cliente_whatsapp
CONV='dddd0000-0000-0000-0000-00000000ca01'  # conversación
EV_L='eeee0000-0000-0000-0000-00000000ca01'  # evento LeadSubmitted
EV_P='eeee0000-0000-0000-0000-00000000ca02'  # evento Purchase
PNID='pnid-prueba-capi-0001'                 # phone_number_id (unique) de prueba
WABA='100000000000001'                       # waba_id de prueba (numérico)
DATASET='200000000000002'                    # dataset_id de prueba

ok=0; fallo=0
check() { if [ "$2" = "$3" ]; then echo "  PASS  $1 ($3)"; ok=$((ok+1)); else echo "  FALLA $1 · esperaba $2, obtuve $3"; fallo=$((fallo+1)); fi; }

jcode() { # $1 bearer(o vacío) → http code
  if [ -z "$1" ]; then
    curl -s -o /dev/null -w '%{http_code}' -X POST "$URL" -H 'Content-Type: application/json' --data-binary '{}'
  else
    curl -s -o /dev/null -w '%{http_code}' -X POST "$URL" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' --data-binary '{}'
  fi
}
jbody() { curl -s -X POST "$URL" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' --data-binary '{}'; }

seed() { curl -s -o /dev/null -X POST "$SB/rest/v1/$1" -H "apikey: $SRK" -H "Authorization: Bearer $SRK" \
  -H 'Content-Type: application/json' -H 'Prefer: resolution=merge-duplicates' --data-binary "$2"; }
del() { curl -s -o /dev/null -w '%{http_code}' -X DELETE "$SB/rest/v1/$1" -H "apikey: $SRK" -H "Authorization: Bearer $SRK" -H "Prefer: return=minimal" || echo ERR; }

limpiar() {
  echo ""; echo "Limpieza:"
  echo "  evento_capi    → HTTP $(del "evento_capi?id=in.($EV_L,$EV_P)")"
  echo "  conversacion   → HTTP $(del "conversacion?id=in.($CONV)")"   # cascada a conversacion_pauta
  echo "  cliente_whatsapp → HTTP $(del "cliente_whatsapp?id=in.($CW)")"
}
trap limpiar EXIT

echo "── enviar-capi · $URL ──"

# ── Siembra ──────────────────────────────────────────────────────
AHORA=$(date -u +%Y-%m-%dT%H:%M:%SZ)
seed cliente_whatsapp "{\"id\":\"$CW\",\"cliente_id\":\"$CLI\",\"phone_number_id\":\"$PNID\",\"waba_id\":\"$WABA\",\"dataset_id\":\"$DATASET\",\"moneda\":\"ARS\",\"activo\":true}"
seed conversacion "{\"id\":\"$CONV\",\"cliente_id\":\"$CLI\",\"telefono\":\"990000099001\",\"origen\":\"pauta\",\"estado\":\"reservo\",\"valor\":180000}"
seed conversacion_pauta "{\"conversacion_id\":\"$CONV\",\"ctwa_clid\":\"prueba-capi-clid\",\"recibido_en\":\"$AHORA\"}"
seed evento_capi "{\"id\":\"$EV_L\",\"conversacion_id\":\"$CONV\",\"evento\":\"LeadSubmitted\",\"estado\":\"pendiente\"}"
seed evento_capi "{\"id\":\"$EV_P\",\"conversacion_id\":\"$CONV\",\"evento\":\"Purchase\",\"valor\":180000,\"estado\":\"pendiente\"}"
echo "  seed OK (cliente_whatsapp + conversación pauta + 2 eventos)"

echo ""
echo "Gate (solo el cron/service_role dispara):"
check "1. sin Authorization → 401" "401" "$(jcode '')"
check "2. con anon (no service) → 401" "401" "$(jcode "$ANON")"

echo ""
echo "Disparo (service_role):"
CODE=$(jcode "$SRK")
check "3. service_role → 200" "200" "$CODE"
BODY=$(jbody "$SRK")
echo "     body: $BODY"

# Según el modo con el que se deployó la función:
if echo "$BODY" | grep -q '"dry_run":true'; then
  echo ""
  echo "DRY-RUN (payload, sin postear a Meta):"
  echo "$BODY" | grep -q '"action_source":"business_messaging"' && { echo "  PASS  action_source=business_messaging"; ok=$((ok+1)); } || { echo "  FALLA action_source"; fallo=$((fallo+1)); }
  echo "$BODY" | grep -q '"messaging_channel":"whatsapp"'       && { echo "  PASS  messaging_channel=whatsapp"; ok=$((ok+1)); } || { echo "  FALLA messaging_channel"; fallo=$((fallo+1)); }
  echo "$BODY" | grep -q "\"event_id\":\"$EV_P\""               && { echo "  PASS  event_id = id de la fila (dedup)"; ok=$((ok+1)); } || { echo "  FALLA event_id"; fallo=$((fallo+1)); }
  echo "$BODY" | grep -q '"event_name":"Purchase"'             && { echo "  PASS  Purchase presente"; ok=$((ok+1)); } || { echo "  FALLA Purchase"; fallo=$((fallo+1)); }
  echo "$BODY" | grep -q '"currency":"ARS"'                     && { echo "  PASS  custom_data.currency=ARS"; ok=$((ok+1)); } || { echo "  FALLA custom_data"; fallo=$((fallo+1)); }
else
  echo ""
  echo "  (La función NO está en dry-run. Con el permiso sin aprobar, lo"
  echo "   esperado es que estos eventos queden PENDIENTES con"
  echo "   codigo=PERMISO_PENDIENTE — revisá los logs por [CAPI][PERMISO-PENDIENTE]"
  echo "   y la cola con: select estado, codigo, intentos from evento_capi where id in ('$EV_L','$EV_P');)"
fi

echo ""
echo "── $ok OK · $fallo fallas ──"
[ "$fallo" -eq 0 ]
