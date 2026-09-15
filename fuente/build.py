#!/usr/bin/env python3
# ═══════════════════════════════════════════════════════════════
#  El build de CoMakers: de UN fuente salen las DOS páginas.
#
#  `interno.src.html` tiene todo. Los bloques marcados se quedan solo
#  en la página que les corresponde:
#
#      /*@@INTERNO*/  ... /*@@FIN*/     solo en interno.html
#      /*@@ADMIN*/    ... /*@@FIN*/     solo en administracion.html
#      <!--@@INTERNO--> ... <!--@@FIN-->   lo mismo, en el HTML
#
#  Lo que no está marcado va a las dos. Las líneas de marca no salen
#  en ningún lado.
#
#  Por qué un solo fuente: las dos páginas comparten media docena de
#  funciones. Con dos archivos separados, arreglar algo en una y
#  olvidarse de la otra es cuestión de tiempo.
#
#  Uso:  ./build.py
# ═══════════════════════════════════════════════════════════════
import re, subprocess, sys, datetime, pathlib

RAIZ = pathlib.Path(__file__).parent
FUENTE = RAIZ / 'interno.src.html'

ABRE = re.compile(r'(?:/\*|<!--)@@(INTERNO|ADMIN)(?:\*/|-->)\s*$')
CIERRA = re.compile(r'(?:/\*|<!--)@@FIN(?:\*/|-->)\s*$')

def para(pagina, lineas):
    """Las líneas que le tocan a esta página."""
    out, saltando = [], None
    for l in lineas:
        m = ABRE.search(l.strip())
        if m:
            # Se salta el bloque si es de la OTRA página.
            saltando = None if m.group(1) == pagina else m.group(1)
            continue
        if CIERRA.search(l.strip()):
            saltando = None
            continue
        if saltando is None:
            out.append(l)
    return out

def main():
    if not FUENTE.exists():
        sys.exit('No está interno.src.html')
    lineas = FUENTE.read_text(encoding='utf-8').split('\n')
    sello = datetime.datetime.now().strftime('v%d/%m %H:%M')

    for pagina, nombre, archivo in (('INTERNO', 'interno', 'interno.html'),
                                    ('ADMIN', 'administracion', 'administracion.html')):
        txt = '\n'.join(para(pagina, lineas))
        # `__PAGINA__` es el único placeholder que queda: dice en qué
        # página corre el código. El fondo y la versión ya vienen
        # puestos en el fuente.
        txt = txt.replace('__PAGINA__', nombre)
        txt = re.sub(r'v\d\d/\d\d \d\d:\d\d', sello, txt)
        (RAIZ / archivo).write_text(txt, encoding='utf-8')
        kb = len(txt.encode('utf-8')) // 1024
        print(f'  {archivo:<26} {kb} KB')

    print('build', sello)
    # El chequeo de nombres colgados es bloqueante: si una página quedó
    # llamando a algo que vive solo en la otra, no se sube nada.
    if (RAIZ / 'revisar-paginas.js').exists():
        r = subprocess.run(['node', str(RAIZ / 'revisar-paginas.js')])
        if r.returncode != 0:
            print('  ⚠️  NO SUBAS ESTOS ARCHIVOS hasta arreglar lo de arriba.')
            sys.exit(1)

if __name__ == '__main__':
    main()
