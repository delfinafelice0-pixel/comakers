#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  Probar una migración ANTES de pegarla en Supabase.
#
#  Levanta un Postgres de juguete, arma la base con el archivo
#  `-base`, corre la migración y después la prueba. Todo con `-1`,
#  o sea en UNA transacción: es exactamente lo que hace el editor
#  de SQL de Supabase, y por eso agarra los errores que allá
#  abortarían el archivo entero.
#
#  Uso:  ./probar-sql.sh prueba-44-base.sql migracion-interno-44-....sql prueba-44.sql
# ═══════════════════════════════════════════════════════════════
set -e
BASE=$1; MIG=$2; TEST=$3
D=/tmp/pg-probar; PORT=5444
export PATH=$PATH:/usr/lib/postgresql/16/bin

if ! pg_isready -h /tmp -p $PORT -q 2>/dev/null; then
  rm -rf $D; mkdir -p $D; chown postgres $D
  su postgres -c "initdb -D $D -A trust -U postgres" >/dev/null 2>&1
  su postgres -c "pg_ctl -D $D -o '-k /tmp -p $PORT -c listen_addresses=' -l /tmp/pg.log start" >/dev/null 2>&1
  sleep 2
fi
P="psql -h /tmp -p $PORT -U postgres -q -v ON_ERROR_STOP=1"
$P -c "drop database if exists probar" -c "create database probar" >/dev/null

echo "── sin la migración (tiene que fallar algo) ──"
$P -d probar -f "$BASE" >/dev/null
$P -d probar -1 -f "$TEST" || true

$P -c "drop database if exists probar" -c "create database probar" >/dev/null
echo ""
echo "── con la migración ──"
$P -d probar -f "$BASE" >/dev/null
$P -d probar -1 -f "$MIG"
echo ""
$P -d probar -1 -f "$TEST"
