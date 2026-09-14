#!/usr/bin/env python3
"""
analizar-reporte pasa a devolver cinco bloques en vez de un texto:
  resumen, cuenta, organico, pauta, proximos pasos.

Tres ediciones:
  1. El prompt SISTEMA
  2. La instruccion final del prompt de usuario
  3. El parseo + guardado + respuesta

Correr desde la raiz del repo:
    python3 parche-tres-solapas.py

Idempotente. Si un ancla no aparece tal cual, no escribe NADA.
Backup en index.ts.bak-solapas
"""

import sys, os, shutil, re

RUTA = "supabase/functions/analizar-reporte/index.ts"

SISTEMA_NUEVO = '''const SISTEMA = `Sos analista en una agencia de marketing digital argentina. Escribís el informe mensual sobre las redes de un cliente.

Contexto importante sobre quién te lee: esto es un BORRADOR. Lo revisa y edita una persona de la agencia antes de que el cliente lo vea. No le estás hablando al cliente todavía: le estás dejando a la agencia un primer tiro con el que trabajar. Por eso podés arriesgar una lectura y proponer un plan. Si te equivocás, ella lo corrige; si no decís nada, ella tiene que escribir todo de cero.

FORMATO DE SALIDA — esto es obligatorio y no admite variantes.
Devolvés bloques separados por marcadores, cada marcador solo en su línea:

[RESUMEN]
(dos o tres oraciones: qué pasó este mes. Es lo primero y a veces lo único que lee el cliente. Sin preámbulo.)

[CUENTA]
(la lectura general del mes, cruzando contenido propio y pauta. 2 o 3 párrafos.)

[ORGANICO]
(el contenido propio. 2 o 3 párrafos. Solo si te paso métricas de contenido propio; si no, omití el bloque entero, incluido el marcador.)

[PAUTA]
(la inversión publicitaria. 2 o 3 párrafos. Solo si te paso métricas de pauta; si no, omití el bloque entero, incluido el marcador.)

[PROXIMOS]
(qué conviene sostener y qué conviene incorporar el mes que viene. Podés usar dos listas cortas con guiones, una de cada cosa. Es el único bloque donde se permiten listas.)

No repitas entre bloques. Si algo ya lo dijiste en ORGANICO, en CUENTA no lo repetís: CUENTA es la lectura que cruza las dos patas y que no se ve mirando una sola.

Reglas de forma:
- Español rioplatense, voseo. Tono profesional y cálido, de agencia hablándole a su cliente. Nada de jerga técnica.
- Párrafos corridos. Sin títulos, sin viñetas, sin despedida ni firma. La única excepción son las dos listas de PROXIMOS.
- Nunca nombres métricas por su nombre técnico ni menciones tablas, columnas, APIs ni Instagram Insights. Decí "las visualizaciones", "los guardados", "los seguidores nuevos".
- Cuando uses una métrica que una persona no técnica no entendería sola, traducila en la misma oración. "Una frecuencia de 1,4 quiere decir que cada persona vio el anuncio poco más de una vez." Eso vale más que el número suelto y es lo que hace que el informe se entienda sin que nadie lo explique.

Reglas sobre los números:
- Solo podés usar los números que te paso. No inventes ni estimes ninguno. No calcules nada que no esté en los datos, salvo las variaciones entre los dos meses y los porcentajes que se desprenden directamente de lo que te paso.
- NUNCA sumes el alcance del contenido propio con el alcance de la pauta, ni presentes un "alcance total". Son dos mediciones separadas que cuentan dos veces a las mismas personas. Si querés hablar de las dos, nombralas por separado.
- Si una métrica dice "sin dato", decí que ese dato no está disponible este mes. Nunca la trates como cero ni la ignores como si fuera cero. Un cero explícito sí es un cero real y se puede nombrar como tal.
- Los números te los paso ya escritos como van: los montos con su signo y sin decimales, los porcentajes con su símbolo. Copialos tal cual, no los reformatees ni les agregues decimales.

Reglas sobre qué podés concluir:
- Podés y DEBÉS conectar los números entre sí cuando cuentan algo junto. Si la inversión bajó y el costo por resultado también bajó y el CTR subió, eso es una lectura y hay que decirla: cada peso rindió mejor. No la dejes para que la arme el lector: si el dato la sostiene, escribila.
- Buscá activamente lo que llama la atención. Una métrica que se mantuvo igual mientras el resto se movió, dos indicadores que van en direcciones opuestas, una pieza que rindió distinto al promedio: eso es lo que vale la pena señalar. Un mes donde todo sube o baja parejo no tiene nada que contar; uno donde algo se desmarca, sí.
- Lo que NO podés hacer es explicar causas que estén fuera de los datos. No sabés qué pasó en el negocio, qué se ve en la imagen, qué hizo la competencia ni qué hizo el algoritmo. "El costo por resultado bajó" es una lectura; "bajó porque el creativo era mejor" es una invención. La diferencia está en si el dato que tenés adelante lo sostiene.
- Si dudás de una lectura, escribila igual pero con la duda adentro: "puede estar relacionado con", "habría que mirar si". La agencia decide si la deja. Una hipótesis marcada como hipótesis es útil; una afirmación sin respaldo, no.
- Cuando un número tenga poco volumen detrás, decilo. "Cinco guardados en todo el mes es poco para sacar una conclusión" es más útil que presentarlo como tendencia.
- Si un número se movió mucho, decilo con precisión. Podés decir si es bueno o malo para el objetivo cuando sea evidente (un costo por resultado más bajo es mejor, más seguidores es mejor). No lo dramatices: nada de "explosivo", "histórico" ni "preocupante".

Reglas del bloque PROXIMOS:
- Es una propuesta para que la agencia la evalúe, no un compromiso con el cliente.
- Escribilo como recomendación: "convendría", "valdría la pena probar", "el número a mirar es". Nunca "vamos a hacer", "te acercamos", "lo vemos en la reunión". La agencia decide y se lo comunica al cliente con sus palabras.
- Cada punto tiene que salir de un número del mes. Si no podés señalar de dónde sale, no lo pongas.
- Si una pieza compró barato pero tuvo poco volumen, decir que valdría la pena darle presupuesto propio para saber si aguanta es una recomendación legítima: sale del dato.
- No prometas entregables, reuniones, informes ni plazos.
- Si no hay mes anterior, describí el mes solo, sin comparar y sin mencionar que falta la comparación.

Sobre las publicaciones y los anuncios, cuando te los pase:
- NO los enumeres. Te paso cinco de cada uno para que elijas, no para que los recites. El panel ya muestra la lista completa con sus imágenes justo debajo de tu texto: repetirla en prosa es un bloque de números que nadie lee.
- Mencioná dos, tres como mucho, y solo si hacen a un punto que valga la pena. El caso típico: la pieza que más se llevó y la que mejor rindió, cuando no son la misma.
- Podés comparar su rendimiento y sacar conclusiones de esa comparación: cuál tuvo más alcance, cuál costó menos por resultado, cuál se llevó la inversión sin devolverla. Todo eso está en los números.
- Lo que NO podés es decir por qué una pieza anduvo mejor apelando a lo que no ves. No digas que "el formato reel conecta mejor" ni que "el copy fue más directo": no viste ni el video ni el copy.
- Al nombrar una pieza, usá el nombre tal cual te lo paso. No lo reescribas ni lo interpretes.
`;'''

INSTRUCCION_VIEJA = "      'Escribí el comentario del mes.',"
INSTRUCCION_NUEVA = """      'Escribí el informe del mes con los bloques que correspondan: ' +
        '[RESUMEN], [CUENTA]' +
        (hayOrg ? ', [ORGANICO]' : '') +
        (hayAds ? ', [PAUTA]' : '') +
        ', [PROXIMOS].',"""

PARSEO_VIEJO = """    const texto = respuesta.content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('\\n')
      .trim();

    if (!texto) {
      return json({ error: { message: 'Claude devolvió una respuesta vacía.' } }, 502);
    }

    // ── 5. Escribir. Solo `analisis` y su marca de borrador. ──
    const { error: errUp } = await admin
      .from('reporte')
      .update({ analisis: texto, analisis_generado_en: new Date().toISOString() })
      .eq('id', actual.id);

    if (errUp) {
      return json({
        error: { message: 'Se generó el texto pero no se pudo guardar: ' + (errUp.message ?? ''), texto },
      }, 500);
    }

    return json({
      ok: true,
      cliente: cliente.nombre,
      mes,
      comparado_con: previo ? mesPrev : null,
      modelo: respuesta.model,
      incluyo: { organico: hayOrg, pauta: hayAds },
      analisis: texto,
      es_borrador: true,
      regenerado: esBorradorSinRevisar,
      datos_usados: partes.join('\\n'),
    });"""

PARSEO_NUEVO = """    const texto = respuesta.content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('\\n')
      .trim();

    if (!texto) {
      return json({ error: { message: 'Claude devolvió una respuesta vacía.' } }, 502);
    }

    // ── 5. Partir la respuesta en sus bloques ─────────────────
    // Marcadores y no JSON a propósito: el texto lleva comillas,
    // saltos de línea y emojis. Un JSON mal escapado un día no
    // parsea y no se guarda nada; acá el peor caso es que un
    // bloque venga vacío y los otros se guarden igual.
    const bloques: Record<string, string> = {};
    let actualBloque = '';
    for (const linea of texto.split('\\n')) {
      const m = linea.trim().match(/^\\[(RESUMEN|CUENTA|ORGANICO|PAUTA|PROXIMOS)\\]$/);
      if (m) { actualBloque = m[1]; bloques[actualBloque] = ''; continue; }
      if (actualBloque) bloques[actualBloque] += linea + '\\n';
    }
    for (const k of Object.keys(bloques)) bloques[k] = bloques[k].trim();

    // Si no respetó el formato, no se pierde el trabajo: todo el
    // texto va a `analisis` como antes y se avisa en la respuesta.
    const respetoFormato = !!(bloques.CUENTA || bloques.RESUMEN);
    const fila: Record<string, unknown> = {
      analisis_generado_en: new Date().toISOString(),
    };

    if (respetoFormato) {
      fila.analisis = bloques.CUENTA || texto;
      if (bloques.RESUMEN)  fila.resumen         = bloques.RESUMEN;
      if (bloques.PROXIMOS) fila.proximos_pasos  = bloques.PROXIMOS;
      // Solo se escribe la solapa del módulo que corresponde. Si el
      // cliente no tiene pauta, la columna queda como estaba en vez
      // de pisarse con vacío.
      if (hayOrg && bloques.ORGANICO) fila.analisis_organico = bloques.ORGANICO;
      if (hayAds && bloques.PAUTA)    fila.analisis_pauta    = bloques.PAUTA;
    } else {
      fila.analisis = texto;
    }

    const { error: errUp } = await admin
      .from('reporte').update(fila).eq('id', actual.id);

    if (errUp) {
      return json({
        error: { message: 'Se generó el texto pero no se pudo guardar: ' + (errUp.message ?? ''), texto },
      }, 500);
    }

    return json({
      ok: true,
      cliente: cliente.nombre,
      mes,
      comparado_con: previo ? mesPrev : null,
      modelo: respuesta.model,
      incluyo: { organico: hayOrg, pauta: hayAds },
      respeto_formato: respetoFormato,
      resumen: bloques.RESUMEN ?? null,
      analisis: fila.analisis,
      analisis_organico: fila.analisis_organico ?? null,
      analisis_pauta: fila.analisis_pauta ?? null,
      proximos_pasos: bloques.PROXIMOS ?? null,
      es_borrador: true,
      regenerado: esBorradorSinRevisar,
      datos_usados: partes.join('\\n'),
    });"""


def main():
    if not os.path.exists(RUTA):
        sys.exit(f"No encuentro {RUTA}. Estas en la raiz del repo?")

    original = open(RUTA, encoding="utf-8").read()

    if "FORMATO DE SALIDA" in original:
        print("Ya esta aplicado.")
        return

    # 1. localizar el SISTEMA actual
    m = re.search(r"const SISTEMA = `", original)
    if not m:
        sys.exit("No encuentro 'const SISTEMA = `'. No toco nada.")
    fin_tick = original.find("`", m.end())
    if fin_tick == -1:
        sys.exit("No encuentro el cierre del prompt. No toco nada.")
    fin = fin_tick + 1
    if original[fin:fin + 1] == ";":
        fin += 1

    # 2. y 3. verificar los otros dos anclajes ANTES de escribir
    problemas = []
    if original.count(INSTRUCCION_VIEJA) != 1:
        problemas.append("  x instruccion final: no aparece exactamente una vez")
    if original.count(PARSEO_VIEJO) != 1:
        problemas.append("  x bloque de parseo/guardado: no aparece exactamente una vez")
    if problemas:
        print("NO se toco nada. Problemas:")
        print("\\n".join(problemas))
        sys.exit(1)

    nuevo = original[:m.start()] + SISTEMA_NUEVO + original[fin:]
    nuevo = nuevo.replace(INSTRUCCION_VIEJA, INSTRUCCION_NUEVA, 1)
    nuevo = nuevo.replace(PARSEO_VIEJO, PARSEO_NUEVO, 1)

    shutil.copy2(RUTA, RUTA + ".bak-solapas")
    open(RUTA, "w", encoding="utf-8").write(nuevo)

    print("Listo. 3 ediciones aplicadas.")
    print(f"Backup en {RUTA}.bak-solapas")
    print("\\nSiguiente: correr la migracion SQL, despues deploy, despues probar.")


if __name__ == "__main__":
    main()
