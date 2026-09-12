#!/usr/bin/env python3
"""
Saca clientes.rep_pauta de pull-instagram y lo reemplaza por
cliente_modulo (modulo = 'pauta').

v2 — el chequeo final de la v1 contaba las menciones a rep_pauta que
hay DENTRO del comentario nuevo y abortaba sin razon. Ahora solo mira
lineas de codigo.

Correr desde la raiz del repo:
    python3 parche-rep-pauta.py

Idempotente. Si un ancla no aparece tal cual, no escribe nada.
Deja backup en pull-instagram/index.ts.bak
"""

import sys, os, shutil

RUTA = "supabase/functions/pull-instagram/index.ts"

EDICIONES = [
    (
        "1. select sobre clientes",
        "      .select('id, nombre, rep_pauta')",
        "      .select('id, nombre')",
    ),
    (
        "2. lectura del modulo",
        "    // ── 5. `alcance` solo si el cliente no tiene pauta ────────",
        """    // ¿Tiene pauta? Antes salía de una columna de `clientes` que
    // quedó obsoleta; ahora de cliente_modulo, igual que pull-ads.
    // Se lee con `admin` y no con `llamador` a propósito: el chequeo
    // de acceso multi-tenant ya lo hizo el select sobre `clientes`
    // de más arriba, esto es configuración.
    //
    // Sin fila en cliente_modulo se asume PRENDIDO, igual que en
    // sync_diario(). Por eso la comparación es contra false explícito
    // y no un `!activo`: un null tiene que comportarse como prendido.
    const { data: modPauta } = await admin
      .from('cliente_modulo')
      .select('activo')
      .eq('cliente_id', clienteId)
      .eq('modulo', 'pauta')
      .maybeSingle();

    const sinPauta = modPauta?.activo === false;

    // ── 5. `alcance` solo si el cliente no tiene pauta ────────""",
    ),
    (
        "3. condicion del bloque 5",
        "    if (cliente.rep_pauta === false) {",
        "    if (sinPauta) {",
    ),
    (
        "4. respuesta de la funcion",
        "      alcance_escrito: cliente.rep_pauta === false,",
        "      alcance_escrito: sinPauta,",
    ),
]


def lineas_de_codigo_con(texto, aguja):
    """Lineas que mencionan `aguja` y NO son comentario."""
    fuera = []
    for i, linea in enumerate(texto.splitlines(), 1):
        if aguja not in linea:
            continue
        limpia = linea.strip()
        if limpia.startswith("//") or limpia.startswith("*") or limpia.startswith("/*"):
            continue
        fuera.append((i, limpia))
    return fuera


def main():
    if not os.path.exists(RUTA):
        sys.exit(f"No encuentro {RUTA}. Estas en la raiz del repo?")

    original = open(RUTA, encoding="utf-8").read()

    if not lineas_de_codigo_con(original, "rep_pauta"):
        print("Ya esta aplicado: no queda rep_pauta en ninguna linea de codigo.")
        return

    problemas = []
    for nombre, viejo, _ in EDICIONES:
        n = original.count(viejo)
        if n == 0:
            problemas.append(f"  x {nombre}: no aparece el ancla")
        elif n > 1:
            problemas.append(f"  x {nombre}: aparece {n} veces, es ambiguo")

    if problemas:
        print("NO se toco nada. Problemas:")
        print("\n".join(problemas))
        sys.exit(1)

    nuevo = original
    for _, viejo, reemplazo in EDICIONES:
        nuevo = nuevo.replace(viejo, reemplazo, 1)

    sobran = lineas_de_codigo_con(nuevo, "rep_pauta")
    if sobran:
        print("NO se escribio: quedo rep_pauta en codigo sin cubrir:")
        for n, l in sobran:
            print(f"    linea {n}: {l}")
        sys.exit(1)

    shutil.copy2(RUTA, RUTA + ".bak")
    open(RUTA, "w", encoding="utf-8").write(nuevo)

    print("Listo. 4 ediciones aplicadas.")
    print(f"Backup en {RUTA}.bak")
    print("\nSiguiente: git diff -> deploy -> probar FOS y Visitando.")
    print("Las columnas NO se borran hasta despues de probar.")


if __name__ == "__main__":
    main()
