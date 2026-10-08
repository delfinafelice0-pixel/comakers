// ═══════════════════════════════════════════════════════════════
//  Datos de prueba para las solapas nuevas del panel (panel-modulos.js)
//
//  Los datos en sí NO están acá: salen de DEMO_PANEL, que genera
//  _datos-privados/demo_panel.py (gitignored, son clientes reales).
//  Este archivo solo arma los dos escenarios:
//
//    DATOS_MOD_AGENCIA  → la agencia ve todo
//    DATOS_MOD_CLIENTE  → lo que la RLS de la migración 51 le dejaría
//                         ver a un usuario de Don Felipe
//
//  ⚠️ comoCliente() IMITA las policies de la 51 para probar la
//  pantalla. No prueba la RLS: eso se prueba con SQL.
//
//  Las RPC (panel_aprobar_contenido, panel_servicio) se imitan en
//  window.__MOCK_RPC, que lee el mock (fuente/mock-supabase.js).
// ═══════════════════════════════════════════════════════════════
(function () {
  var D = (typeof DEMO_PANEL !== 'undefined') ? DEMO_PANEL : { tablas: {}, clientes: { DF: 'df', MACA: 'mf' }, gente: {} };
  var DF = D.clientes.DF, MF = D.clientes.MACA;
  var CL_USER = '99999999-9999-9999-9999-999999999999';

  var CLIENTES = [
    { id: DF, nombre: 'Don Felipe', slug: 'don-felipe', activo: true },
    { id: MF, nombre: 'Dr. Maca Flos', slug: 'dr-maca-flos', activo: true }
  ];
  var GENTE = Object.keys(D.gente).map(function (n, i) {
    return { id: D.gente[n], nombre: n, tipo: 'agencia', super_admin: i === 0 };
  });

  function copia(x) { return JSON.parse(JSON.stringify(x)); }
  function t(nombre) { return copia(D.tablas[nombre] || []); }

  var BASE = {
    profiles: GENTE.concat([{ id: CL_USER, nombre: 'Ani (Don Felipe)', tipo: 'cliente', super_admin: false }]),
    clientes: CLIENTES,
    reporte: t('reporte'), reporte_metrica: [], reporte_destacado: [],
    post_instagram: [], anuncio_meta: [], reporte_publicado: [], tarea: [],
    panel_comentario: t('panel_comentario')
  };
  ['cliente_modulo', 'cal_categoria', 'cal_contenido', 'cal_evento', 'cal_config', 'estrategia_bloque',
   'objetivo', 'oneshot_doc', 'oneshot_seccion', 'contrato', 'contrato_ajuste', 'servicio_publicacion',
   'servicio', 'servicio_item', 'entregable'].forEach(function (k) { BASE[k] = t(k); });

  // Lo que la 51 le deja ver al cliente `cid`.
  function comoCliente(b, cid) {
    var x = copia(b);
    var suyo = function (r) { return r.cliente_id === cid; };
    x.clientes = x.clientes.filter(function (c) { return c.id === cid; });
    x.profiles = x.profiles.filter(function (p) { return p.id === CL_USER; });
    x.cliente_modulo = x.cliente_modulo.filter(suyo);
    x.reporte = x.reporte.filter(function (r) { return suyo(r) && r.estado === 'publicado'; });
    x.cal_categoria = x.cal_categoria.filter(function (k) { return !k.cliente_id || k.cliente_id === cid; });
    ['cal_contenido', 'cal_config', 'estrategia_bloque', 'objetivo', 'oneshot_doc'].forEach(function (k) {
      x[k] = x[k].filter(function (r) { return suyo(r) && r.publicado; });
    });
    x.cal_evento = x.cal_evento.filter(function (r) { return suyo(r) && (r.publicado || r.cargado_por_cliente); });
    var docsPub = x.oneshot_doc.map(function (d) { return d.id; });
    x.oneshot_seccion = x.oneshot_seccion.filter(function (s) { return suyo(s) && s.publicado && docsPub.indexOf(s.doc_id) !== -1; });
    x.panel_comentario = x.panel_comentario.filter(function (c) { return suyo(c) && c.canal === 'cliente'; });
    // Servicio: el cliente NO lee estas tablas; va por RPC.
    ['contrato', 'contrato_ajuste', 'servicio_publicacion', 'servicio', 'servicio_item', 'entregable', 'tarea']
      .forEach(function (k) { x[k] = []; });
    return x;
  }

  window.DATOS_MOD_AGENCIA = BASE;
  window.DATOS_MOD_CLIENTE = comoCliente(BASE, DF);
  window.SESION_MOD_AGENCIA = { user: { id: GENTE.length ? GENTE[0].id : 'ag', email: 'delfi@comakers.com.ar' }, access_token: 'x' };
  window.SESION_MOD_CLIENTE = { user: { id: CL_USER, email: 'ani@donfelipe.com.ar' }, access_token: 'x' };

  // ── RPC de mentira ────────────────────────────────────────────
  window.__MOCK_RPC = {
    panel_aprobar_contenido: function (a) {
      var c = (window.__TABLAS.cal_contenido || []).find(function (r) { return r.id === a.p_id && r.publicado; });
      if (!c) return { data: false, error: null };
      c.aprob_cliente = a.p_ok; c.aprob_cliente_en = a.p_ok ? new Date().toISOString() : null;
      return { data: true, error: null };
    },
    panel_servicio: function (a) {
      // Misma forma que la función de la 51.
      // El cliente no tiene estas tablas (las vacía comoCliente): la RPC
      // real corre como security definer y las lee igual. Acá, de BASE.
      var esAgencia = window.__MODO !== 'cliente';
      var src = esAgencia ? window.__TABLAS : BASE;
      var pub = (src.servicio_publicacion || []).find(function (p) { return p.cliente_id === a.p_cliente; }) || {};
      var inc = esAgencia || !!pub.incluye, mon = esAgencia || !!pub.monto, his = esAgencia || !!pub.historial, prox = esAgencia || !!pub.proximo_ajuste;
      var cts = (src.contrato || []).filter(function (k) { return k.cliente_id === a.p_cliente && k.activo !== false; })
        .sort(function (x, y) { return x.nombre < y.nombre ? -1 : 1; });
      return { data: {
        agencia: esAgencia,
        publicacion: esAgencia ? { incluye: !!pub.incluye, monto: !!pub.monto, historial: !!pub.historial, proximo_ajuste: !!pub.proximo_ajuste } : null,
        incluye_texto: inc ? (pub.incluye_texto || null) : null,
        contratos: !(inc || mon || his || prox) ? [] : cts.map(function (k) {
          var sv = (src.servicio || []).find(function (s) { return s.id === k.servicio_id; });
          return {
            id: k.id, nombre: k.nombre, detalle: inc ? k.detalle : null, plan: inc && sv ? sv.nombre : null,
            items: inc ? (src.servicio_item || []).filter(function (i) { return i.servicio_id === k.servicio_id; })
              .map(function (i) { var e = (src.entregable || []).find(function (x) { return x.id === i.entregable_id; }) || {};
                return { nombre: e.nombre, cantidad: i.cantidad, unidad: e.unidad }; }) : null,
            monto: mon ? k.monto : null, tipo: mon ? k.tipo : null,
            ultimo_ajuste: (his || prox) ? k.ultimo_ajuste : null, proximo_ajuste: prox ? k.proximo_ajuste : null,
            ajuste_pct: esAgencia ? k.ajuste_pct : null,
            historial: his ? (src.contrato_ajuste || []).filter(function (h) { return h.contrato_id === k.id; })
              .sort(function (x, y) { return x.fecha < y.fecha ? 1 : -1; })
              .map(function (h) { return { id: h.id, fecha: h.fecha, anterior: h.monto_anterior, nuevo: h.monto_nuevo, pct: h.pct, nota: h.nota }; }) : null
          };
        })
      }, error: null };
    }
  };
})();
