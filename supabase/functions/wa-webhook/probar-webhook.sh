#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  probar-webhook.sh · prueba wa-webhook con payloads de ejemplo de
#  Meta, sin número conectado.
#
#  ⚠️ INSERTA FILAS REALES en la base a la que apunte WA_WEBHOOK_URL.
#  No hay base de prueba aparte: el webhook escribe con service_role.
#  Por eso:
#    · Todos los teléfonos de prueba empiezan con 990000047 y los wa_id
#      con wamid.PRUEBA47_ — prefijos reconocibles, no colisionan con
#      datos reales.
#    · Al terminar, el script BORRA lo que insertó (delete por ese
#      prefijo, con cascada a mensaje y conversacion_pauta) si le pasás
#      SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.
#    · Los POST no corren hasta que confirmes la base con ACEPTO_INSERTAR=si.
#
#  Qué chequea (a nivel HTTP):
#    1. GET verify token correcto → 200 y devuelve el challenge
#    2. GET verify token incorrecto → 403
#    3. POST mensaje normal, firma válida → 200           (INSERCIÓN)
#    4. el MISMO POST otra vez → 200                      (IDEMPOTENCIA)
#    5. POST con referral/ctwa_clid, firma válida → 200
#    6. POST eco del negocio (smb_message_echoes) → 200
#    7. POST con firma inválida → 401                     (FIRMA RECHAZADA)
#    8. POST con phone_number_id que no mapea → 200 (no inserta)
#
#  Uso:
#    WA_WEBHOOK_URL="https://<ref>.supabase.co/functions/v1/wa-webhook" \
#    WHATSAPP_APP_SECRET="<app secret de Meta>" \
#    WHATSAPP_VERIFY_TOKEN="<verify token>" \
#    PHONE_NUMBER_ID="<id de un cliente_whatsapp activo>" \
#    SUPABASE_URL="https://<ref>.supabase.co" \
#    SUPABASE_SERVICE_ROLE_KEY="<service role key>" \
#    ACEPTO_INSERTAR=si \
#    bash supabase/functions/wa-webhook/probar-webhook.sh
#
#  PHONE_NUMBER_ID tiene que coincidir con una fila de cliente_whatsapp
#  activa para que los inserts ocurran; si no, los POST dan 200 pero no
#  insertan nada. Los secrets se leen del ambiente: NO van en el repo.
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

URL="${WA_WEBHOOK_URL:?falta WA_WEBHOOK_URL}"
SECRET="${WHATSAPP_APP_SECRET:?falta WHATSAPP_APP_SECRET}"
VERIFY="${WHATSAPP_VERIFY_TOKEN:?falta WHATSAPP_VERIFY_TOKEN}"
PNID="${PHONE_NUMBER_ID:-NO_MAPEA_000}"

PREFIJO_TEL="990000047"          # 9 dígitos reconocibles para el delete
PREFIJO_WA="wamid.PRUEBA47_"

TMP="$(mktemp -d)"

limpiar() {
  rm -rf "$TMP"
  echo ""
  echo "Limpieza:"
  if [ -z "${SUPABASE_URL:-}" ] || [ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
    echo "  omitida (faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY). Borrá a mano:"
    echo "    delete from conversacion where telefono like '${PREFIJO_TEL}%';"
    return
  fi
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE \
    "$SUPABASE_URL/rest/v1/conversacion?telefono=like.${PREFIJO_TEL}*" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Prefer: return=minimal" || echo "ERR")
  echo "  delete conversacion where telefono like '${PREFIJO_TEL}%' (cascada a mensaje y conversacion_pauta) → HTTP $code"
}
trap limpiar EXIT

# ── Qué base ─────────────────────────────────────────────────────
echo "── wa-webhook ──"
echo "  endpoint : $URL"
echo "  db REST  : ${SUPABASE_URL:-'(no seteada: sin limpieza automática)'}"
echo ""

ok=0; fallo=0
check() { # $1 etiqueta · $2 esperado · $3 obtenido
  if [ "$2" = "$3" ]; then echo "  PASS  $1 ($3)"; ok=$((ok+1));
  else echo "  FALLA $1 · esperaba $2, obtuve $3"; fallo=$((fallo+1)); fi
}

firma() { openssl dgst -sha256 -hmac "$SECRET" -hex "$1" | awk '{print $NF}'; }
postcode() { # $1 archivo · $2 firma opcional
  local sig="${2:-sha256=$(firma "$1")}"
  curl -s -o /dev/null -w '%{http_code}' -X POST "$URL" \
    -H 'Content-Type: application/json' \
    -H "X-Hub-Signature-256: $sig" \
    --data-binary @"$1"
}

# ── Verificación (GET): read-only, corre siempre ─────────────────
echo "Verificación (GET):"
CH="reto-$RANDOM"
check "1. verify token correcto devuelve el challenge" "$CH" \
  "$(curl -s "$URL?hub.mode=subscribe&hub.verify_token=$VERIFY&hub.challenge=$CH")"
check "2. verify token incorrecto" "403" \
  "$(curl -s -o /dev/null -w '%{http_code}' "$URL?hub.mode=subscribe&hub.verify_token=mal&hub.challenge=$CH")"

# ── Entrega (POST): inserta, requiere confirmación de base ───────
if [ "${ACEPTO_INSERTAR:-no}" != "si" ]; then
  echo ""
  echo "POST omitido: estos casos INSERTAN en $URL."
  echo "Confirmá la base y volvé a correr con  ACEPTO_INSERTAR=si"
  exit 0
fi

cat > "$TMP/normal.json" <<JSON
{"object":"whatsapp_business_account","entry":[{"id":"WABA_PRUEBA47","changes":[{"field":"messages","value":{"messaging_product":"whatsapp","metadata":{"display_phone_number":"${PREFIJO_TEL}000","phone_number_id":"$PNID"},"contacts":[{"profile":{"name":"Prueba 47 Normal"},"wa_id":"${PREFIJO_TEL}001"}],"messages":[{"from":"${PREFIJO_TEL}001","id":"${PREFIJO_WA}NORMAL_1","timestamp":"1759838400","type":"text","text":{"body":"Hola! Vi el anuncio de las cabanas"}}]}}]}]}
JSON

cat > "$TMP/referral.json" <<JSON
{"object":"whatsapp_business_account","entry":[{"id":"WABA_PRUEBA47","changes":[{"field":"messages","value":{"messaging_product":"whatsapp","metadata":{"display_phone_number":"${PREFIJO_TEL}000","phone_number_id":"$PNID"},"contacts":[{"profile":{"name":"Prueba 47 Referral"},"wa_id":"${PREFIJO_TEL}002"}],"messages":[{"from":"${PREFIJO_TEL}002","id":"${PREFIJO_WA}REFERRAL_1","timestamp":"1759838500","type":"text","text":{"body":"Hola, precio del salon?"},"referral":{"source_url":"https://fb.me/xyz","source_id":"120200000000000000","source_type":"ad","headline":"Salon - Cumple de 15","body":"Reserva tu fecha","media_type":"image","ctwa_clid":"ARDm4WsUf8jHgP2vTq9cLe"}}]}}]}]}
JSON

cat > "$TMP/eco.json" <<JSON
{"object":"whatsapp_business_account","entry":[{"id":"WABA_PRUEBA47","changes":[{"field":"smb_message_echoes","value":{"messaging_product":"whatsapp","metadata":{"display_phone_number":"${PREFIJO_TEL}000","phone_number_id":"$PNID"},"message_echoes":[{"from":"${PREFIJO_TEL}000","to":"${PREFIJO_TEL}001","id":"${PREFIJO_WA}ECO_1","timestamp":"1759838600","type":"text","text":{"body":"Hola! Si, esta libre."}}]}}]}]}
JSON

cat > "$TMP/sinmapa.json" <<JSON
{"object":"whatsapp_business_account","entry":[{"id":"WABA_PRUEBA47","changes":[{"field":"messages","value":{"messaging_product":"whatsapp","metadata":{"display_phone_number":"0","phone_number_id":"000_QUE_NO_MAPEA"},"contacts":[{"profile":{"name":"Prueba 47 SinMapa"},"wa_id":"${PREFIJO_TEL}999"}],"messages":[{"from":"${PREFIJO_TEL}999","id":"${PREFIJO_WA}SINMAPA_1","timestamp":"1759838700","type":"text","text":{"body":"hola"}}]}}]}]}
JSON

echo ""
echo "Entrega (POST):"
check "3. mensaje normal, firma válida (INSERCIÓN)"       "200" "$(postcode "$TMP/normal.json")"
check "4. mismo mensaje otra vez (IDEMPOTENCIA)"          "200" "$(postcode "$TMP/normal.json")"
check "5. referral con ctwa_clid"                          "200" "$(postcode "$TMP/referral.json")"
check "6. eco del negocio"                                 "200" "$(postcode "$TMP/eco.json")"
check "7. firma inválida (RECHAZADA)"                      "401" "$(postcode "$TMP/normal.json" "sha256=deadbeef")"
check "8. phone_number_id sin mapeo"                       "200" "$(postcode "$TMP/sinmapa.json")"

echo ""
echo "── $ok OK · $fallo fallas ──"
echo ""
cat <<NOTA
Verificación en la base (Supabase → SQL Editor), ANTES de que corra la
limpieza de abajo, con PHONE_NUMBER_ID apuntando a un cliente_whatsapp activo:

  -- inserción + idempotencia: una sola fila aunque se posteó dos veces
  select count(*) from mensaje where wa_id = '${PREFIJO_WA}NORMAL_1';   -- 1

  -- el referral marcó pauta y guardó el clid
  select c.origen, c.ad_id, c.campana, cp.ctwa_clid
    from conversacion c join conversacion_pauta cp on cp.conversacion_id = c.id
   where c.telefono = '${PREFIJO_TEL}002';   -- pauta / 1202.. / ARDm4Ws...

  -- el eco quedó saliente
  select entrante from mensaje where wa_id = '${PREFIJO_WA}ECO_1';      -- false

  -- el sin-mapeo NO se insertó
  select count(*) from mensaje where wa_id = '${PREFIJO_WA}SINMAPA_1';  -- 0
NOTA

[ "$fallo" -eq 0 ]
