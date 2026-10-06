// ═══════════════════════════════════════════════════════════════
//  Datos de prueba para panel.html
//
//  `datos-prueba.js` es del panel interno: tiene tareas y proyectos,
//  no reportes. Esto es el equivalente para el panel del cliente.
//
//  Se carga de dos formas: con `require()` desde node, y con un
//  `<script src>` desde el navegador (lo que hace probar-panel.sh).
//  Por eso el module.exports del final va con guarda.
//
//  ── El escenario, armado para ver tres cosas de una ────────────
//
//  julio 2026       manual    publicado   claves VIEJAS: costo_por_resultado, alcance
//  agosto 2026      de Meta   PUBLICADO   con analisis_generado_en PUESTO
//  septiembre 2026  de Meta   borrador    análisis viejo: los números se
//                                         sincronizaron después del texto
//
//  1. Julio manual + agosto de Meta es el cruce de nomenclaturas que
//     dejaba "sin mes anterior" en costo y alcance, y comparaba bien
//     todas las demás tarjetas. Si el delta de "Costo por conversación"
//     de agosto vuelve a decir "sin mes anterior", se rompió prevVal().
//
//  2. Agosto es un reporte PUBLICADO con el borrador todavía marcado:
//     el caso exacto en que el cliente veía el chip "borrador sin
//     revisar" y el cartel "Editalo y guardalo", que son para la
//     agencia. En la vista de cliente no tienen que aparecer.
//
//  3. Septiembre está en borrador, así que la agencia ve el botón
//     Publicar, y con el análisis sin revisar tiene que preguntar
//     antes de publicar.
//
//  ⚠️ El mock NO tiene RLS. Por eso DATOS_CLIENTE trae a mano SOLO
//  las filas publicadas: es lo que la base le devolvería de verdad.
//  Que la RLS realmente le esconda el borrador se prueba con SQL, no
//  con esto. Acá se prueba la PANTALLA.
// ═══════════════════════════════════════════════════════════════

var AG  = '11111111-1111-1111-1111-111111111111';
var CL  = '99999999-9999-9999-9999-999999999999';
var FOS = '287db773-625a-48c4-8bb5-0c5f6ed0cd06';

var SESION_AGENCIA = { user: { id: AG, email: 'delfi@comakers.com.ar' }, access_token: 'x' };
var SESION_CLIENTE = { user: { id: CL, email: 'cliente@fos.com.ar' },    access_token: 'x' };

var PERFIL_AGENCIA = { id: AG, nombre: 'Delfi',      tipo: 'agencia', super_admin: true };
var PERFIL_CLIENTE = { id: CL, nombre: 'Marcos Fos', tipo: 'cliente', super_admin: false };

var CLIENTE_FOS = { id: FOS, nombre: 'FOS Gestiones Inmobiliarias', slug: 'fos', activo: true };

// ── Julio: cargado a mano ──────────────────────────────────────
// Sin marcas de sincronización, así que mezclarInstagram() y
// mezclarPauta() no corren y mandan las filas de reporte_metrica.
var REP_JUL = {
  id: 'rep-jul', cliente_id: FOS, mes: '2026-07-01', estado: 'publicado',
  publicado_en: '2026-08-04', fuente: 'manual',
  sincronizado_en: null, ads_sincronizado_en: null,
  resumen: 'Julio fue el mes de arranque de la campaña de verano.',
  proximos_pasos: null, analisis: null, analisis_generado_en: null,
  analisis_organico: null, analisis_pauta: null, bloques: [], notas_anuncios: {},
  moneda_ads: 'ARS'
};

// ── Agosto: de Meta, publicado, con el borrador todavía marcado ──
var REP_AGO = {
  id: 'rep-ago', cliente_id: FOS, mes: '2026-08-01', estado: 'publicado',
  publicado_en: '2026-09-05', fuente: 'instagram',
  sincronizado_en: '2026-09-02T06:04:00Z', ads_sincronizado_en: '2026-09-02T06:05:00Z',
  resumen: 'Agosto cerró con la pauta rindiendo mejor que en julio: se invirtió menos y cada conversación salió más barata.',
  proximos_pasos: 'Sostener el reel de casa madera, que viene siendo el más barato. Probar un segundo creativo con el mismo gancho.',
  analisis: 'La inversión bajó 19% y el costo por conversación bajó 20%: cada peso rindió mejor que el mes pasado. El alcance de la pauta se mantuvo casi igual con menos plata, lo que sugiere que la segmentación está más afinada. Habría que mirar si el reel de casa madera sostiene el rendimiento cuando se le suba el presupuesto.',
  analisis_organico: 'El contenido propio llegó a 64.000 personas y sumó 210 seguidores. Los guardados subieron 36%, que es la señal más fuerte de que el contenido sirve: alguien lo guarda para volver.',
  analisis_pauta: 'Se consiguieron 202 conversaciones a 2.079 pesos cada una. La frecuencia de 2,2 está en zona cómoda: todavía no hay desgaste.',
  analisis_generado_en: '2026-09-04T06:12:00Z',
  bloques: [], notas_anuncios: {},
  views_org: 120000, reach_org: 64000, likes_org: 2100, comments_org: 180,
  shares_org: 90, saves_org: 340, follows_mes: 210,
  visitas_perfil_org: 3100, clics_web_org: 240,
  views_seguidores_org: 48000, views_no_seguidores_org: 72000,
  reach_seguidores_org: 26000, reach_no_seguidores_org: 38000,
  cuentas_interactuaron_org: 5400, unicos_dias: 30,
  seguidores_total: 8450, seguidores_total_en: '2026-09-02T06:04:00Z',
  demografia_org: {
    edad:   { '18-24': 900, '25-34': 3100, '35-44': 2600, '45-54': 1200, '55-64': 400 },
    genero: { F: 5100, M: 3300 },
    ciudad: { 'Tandil, Buenos Aires': 3900, 'Mar del Plata, Buenos Aires': 800, 'Buenos Aires': 700 },
    pais:   { AR: 8200, UY: 150, ES: 100 }
  },
  inversion_ads: 420000, moneda_ads: 'ARS', resultados_ads: 202,
  accion_ads: 'onsite_conversion.total_messaging_connection',
  costo_resultado_ads: 2079, reach_ads: 85000, impresiones_ads: 190000,
  frecuencia_ads: 2.2, clics_ads: 3400, ctr_ads: 1.8, cpm_ads: 2210
};

// ── Septiembre: borrador, y con el análisis desactualizado ──────
// El texto se escribió el 4 y los números se trajeron el 6: dispara
// además el cartel rosado, que es solo para la agencia.
var REP_SEP = {
  id: 'rep-sep', cliente_id: FOS, mes: '2026-09-01', estado: 'borrador',
  publicado_en: null, fuente: 'instagram',
  sincronizado_en: '2026-10-06T06:03:00Z', ads_sincronizado_en: '2026-10-06T06:04:00Z',
  resumen: 'Septiembre bajó en volumen pero mejoró en eficiencia.',
  proximos_pasos: 'Sostener el creativo de casa madera. Revisar el conjunto que dejó de entregar.',
  analisis: 'La inversión bajó 38% respecto de agosto y el costo por conversación bajó otro 17%: la tendencia de los dos meses anteriores se sostiene. Con menos plata se consiguieron 150 conversaciones. Habría que mirar si el volumen alcanza para el equipo comercial o si conviene volver a subir el presupuesto ahora que el costo está bajo.',
  analisis_organico: 'El alcance del contenido propio bajó a 58.000 personas, en línea con haber publicado menos. Los guardados se mantuvieron, así que la caída es de volumen y no de calidad.',
  analisis_pauta: 'Se consiguieron 150 conversaciones a 1.733 pesos. El CTR subió a 2,1%: la gente toca más el anuncio que el mes pasado.',
  analisis_generado_en: '2026-10-04T06:09:00Z',
  bloques: [], notas_anuncios: {},
  views_org: 98000, reach_org: 58000, likes_org: 1700, comments_org: 140,
  shares_org: 70, saves_org: 335, follows_mes: 160,
  visitas_perfil_org: 2600, clics_web_org: 190,
  views_seguidores_org: 41000, views_no_seguidores_org: 57000,
  reach_seguidores_org: 24000, reach_no_seguidores_org: 34000,
  cuentas_interactuaron_org: 4800, unicos_dias: 30,
  seguidores_total: 8610, seguidores_total_en: '2026-10-06T06:03:00Z',
  demografia_org: {
    edad:   { '18-24': 920, '25-34': 3180, '35-44': 2650, '45-54': 1230, '55-64': 410 },
    genero: { F: 5200, M: 3360 },
    ciudad: { 'Tandil, Buenos Aires': 3980, 'Mar del Plata, Buenos Aires': 820, 'Buenos Aires': 710 },
    pais:   { AR: 8350, UY: 160, ES: 100 }
  },
  inversion_ads: 260000, moneda_ads: 'ARS', resultados_ads: 150,
  accion_ads: 'onsite_conversion.total_messaging_connection',
  costo_resultado_ads: 1733, reach_ads: 61000, impresiones_ads: 140000,
  frecuencia_ads: 2.3, clics_ads: 2900, ctr_ads: 2.1, cpm_ads: 1857
};

// ── reporte_metrica: SOLO julio, que es el mes manual ───────────
// Las claves son las VIEJAS a propósito. No las "arregles": son
// justo lo que tiene que seguir cruzando contra las de Meta.
var METRICAS_JUL = [
  { id: 'm1', reporte_id: 'rep-jul', modulo: 'pauta',    clave: 'inversion',           etiqueta: 'Inversión',           valor: 520000, unidad: 'ars', mejor: 'sube', orden: 0 },
  { id: 'm2', reporte_id: 'rep-jul', modulo: 'pauta',    clave: 'resultados',          etiqueta: 'Resultados',          valor: 200,    unidad: 'num', mejor: 'sube', orden: 1 },
  { id: 'm3', reporte_id: 'rep-jul', modulo: 'pauta',    clave: 'costo_por_resultado', etiqueta: 'Costo por resultado', valor: 2600,   unidad: 'ars', mejor: 'baja', orden: 2 },
  { id: 'm4', reporte_id: 'rep-jul', modulo: 'pauta',    clave: 'alcance',             etiqueta: 'Alcance',             valor: 48000,  unidad: 'num', mejor: 'sube', orden: 3 },
  { id: 'm5', reporte_id: 'rep-jul', modulo: 'pauta',    clave: 'impresiones',         etiqueta: 'Impresiones',         valor: 150000, unidad: 'num', mejor: 'sube', orden: 4 },
  { id: 'm6', reporte_id: 'rep-jul', modulo: 'organico', clave: 'alcance',             etiqueta: 'Alcance',             valor: 51000,  unidad: 'num', mejor: 'sube', orden: 5 },
  { id: 'm7', reporte_id: 'rep-jul', modulo: 'organico', clave: 'interacciones',       etiqueta: 'Interacciones',       valor: 2000,   unidad: 'num', mejor: 'sube', orden: 6 },
  { id: 'm8', reporte_id: 'rep-jul', modulo: 'organico', clave: 'guardados',           etiqueta: 'Guardados',           valor: 250,    unidad: 'num', mejor: 'sube', orden: 7 },
  { id: 'm9', reporte_id: 'rep-jul', modulo: 'organico', clave: 'seguidores',          etiqueta: 'Nuevos seguidores',   valor: 180,    unidad: 'num', mejor: 'sube', orden: 8 }
];

var MODULOS_FOS = [
  { cliente_id: FOS, modulo: 'organico', activo: true },
  { cliente_id: FOS, modulo: 'pauta',    activo: true }
];

// La agencia ve todo, incluido el borrador de septiembre.
var DATOS_AGENCIA = {
  profiles: [PERFIL_AGENCIA],
  clientes: [CLIENTE_FOS],
  cliente_modulo: MODULOS_FOS,
  reporte: [REP_SEP, REP_AGO, REP_JUL],
  reporte_metrica: METRICAS_JUL,
  reporte_destacado: [],
  post_instagram: [],
  anuncio_meta: []
};

// El cliente: solo lo publicado. Ver la advertencia de la cabecera.
var DATOS_CLIENTE = {
  profiles: [PERFIL_CLIENTE],
  clientes: [CLIENTE_FOS],
  cliente_modulo: MODULOS_FOS,
  reporte: [REP_AGO, REP_JUL],
  reporte_metrica: METRICAS_JUL,
  reporte_destacado: [],
  post_instagram: [],
  anuncio_meta: []
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DATOS_AGENCIA, DATOS_CLIENTE, SESION_AGENCIA, SESION_CLIENTE, FOS };
}
