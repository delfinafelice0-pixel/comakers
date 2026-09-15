// ═══════════════════════════════════════════════════════════════
//  Los datos con los que corren las pruebas.
//
//  Un proyecto (EKHOS) con tres secciones y tareas repartidas, más
//  DOS casos que son los que importan:
//
//    · t-huerfana  — está en el proyecto con seccion_id = null
//    · t-colgada   — está en el proyecto apuntando a una sección
//                    que ya no existe (seccion_id = 'sec-borrada')
//
//  Las dos tienen que verse. Antes el tablero no las dibujaba.
// ═══════════════════════════════════════════════════════════════
const YO = '11111111-1111-1111-1111-111111111111';
const MARTI = '22222222-2222-2222-2222-222222222222';

const SESION = { user: { id: YO, email: 'delfi@comakers.com.ar' }, access_token: 'x' };

function tarea(id, titulo, extra) {
  return Object.assign({
    id: id, titulo: titulo, descripcion: null, responsable_id: YO,
    cliente_id: null, proyecto_id: null, padre_id: null,
    completada: false, completada_en: null, vence: null,
    urgencia: 'normal', orden: 1000, comentarios: 0,
    creado_por: YO, creado_en: '2026-08-01T10:00:00Z', archivada: false
  }, extra || {});
}

const DATOS = {
  profiles: [
    { id: YO, email: 'delfi@comakers.com.ar', nombre: 'Delfi', tipo: 'agencia', agencia: 'CoMakers', super_admin: true, rol: 'socia', activo: true },
    { id: MARTI, email: 'marti@comakers.com.ar', nombre: 'Marti', tipo: 'agencia', agencia: 'CoMakers', super_admin: false, rol: 'socia', activo: true }
  ],
  persona_externa: [],
  clientes: [
    { id: 'cli-ekhos', nombre: 'EKHOS', slug: 'ekhos', agencia: 'CoMakers', activo: true },
    { id: 'cli-vt', nombre: 'Visitando Tandil', slug: 'vt', agencia: 'CoMakers', activo: true }
  ],
  proyecto: [
    { id: 'proy-ekhos', nombre: 'EKHOS 2026', cliente_id: 'cli-ekhos', color: 'rosa', icono: null, archivado: false, privado: false, orden: 1000 },
    { id: 'proy-vt', nombre: 'Visitando Tandil', cliente_id: 'cli-vt', color: 'verde', icono: null, archivado: false, privado: false, orden: 2000 }
  ],
  proyecto_miembro: [
    { proyecto_id: 'proy-ekhos', user_id: YO }, { proyecto_id: 'proy-ekhos', user_id: MARTI },
    { proyecto_id: 'proy-vt', user_id: YO }
  ],
  seccion: [
    { id: 'sec-hacer', proyecto_id: 'proy-ekhos', nombre: 'Por hacer', tipo: 'pendiente', orden: 1000 },
    { id: 'sec-curso', proyecto_id: 'proy-ekhos', nombre: 'En curso', tipo: 'curso', orden: 2000 },
    { id: 'sec-listo', proyecto_id: 'proy-ekhos', nombre: 'Listo', tipo: 'listo', orden: 3000 },
    { id: 'sec-vt-hacer', proyecto_id: 'proy-vt', nombre: 'Por hacer', tipo: 'pendiente', orden: 1000 }
  ],
  tarea: [
    tarea('t-normal', 'Armar el carrusel de la Ruta de la Luz'),
    tarea('t-curso', 'Editar el video de India 2027'),
    tarea('t-huerfana', 'Reunión con Jessica por el programa'),
    tarea('t-colgada', 'Pasar el presupuesto de verificación'),
    tarea('t-vt', 'Fotos del finde largo en Tandil'),
    tarea('t-suelta', 'Comprar café para la oficina', { responsable_id: null })
  ],
  tarea_proyecto: [
    { tarea_id: 't-normal', proyecto_id: 'proy-ekhos', seccion_id: 'sec-hacer', orden: 1000, principal: true },
    { tarea_id: 't-curso', proyecto_id: 'proy-ekhos', seccion_id: 'sec-curso', orden: 2000, principal: true },
    // ── Los dos casos que se perdían ──────────────────────────
    { tarea_id: 't-huerfana', proyecto_id: 'proy-ekhos', seccion_id: null, orden: 3000, principal: true },
    { tarea_id: 't-colgada', proyecto_id: 'proy-ekhos', seccion_id: 'sec-borrada', orden: 4000, principal: true },
    { tarea_id: 't-vt', proyecto_id: 'proy-vt', seccion_id: 'sec-vt-hacer', orden: 1000, principal: true }
  ],
  tarea_responsable: [], tarea_colaborador: [], tarea_dependencia: [], tarea_etiqueta: [],
  etiqueta: [], subtarea: [], adjunto_tarea: [], comentario_tarea: [], actividad_tarea: [],
  trabajo_extra: [], proyecto_favorito: [], proyecto_orden: [], proyecto_dato: [],
  proyecto_link: [], preferencia: [], novedad: [], dato_visto: [], acceso_cliente: [],
  wiki_carpeta: [], wiki_pagina: [], entregable: [], servicio: [], servicio_item: []
};

module.exports = { DATOS, SESION, YO, MARTI };
