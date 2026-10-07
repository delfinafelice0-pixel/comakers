// ═══════════════════════════════════════════════════════════════
//  Datos de mentira para probar las solapas de administración
//  (Clientes + popup, Distribución, Fondo + Gastos).
//  Al lado de datos-panel.js, misma idea: se siembran las tablas que
//  usa la pantalla y el mock (fuente/mock-supabase.js) las sirve.
//
//  NO hay RLS acá: esto prueba la PANTALLA, no los permisos.
//  La sesión es de una socia (rol:'socia', tipo:'agencia').
// ═══════════════════════════════════════════════════════════════

var SESION_ADMIN = {
  user: { id: 'u-delfi', email: 'delfi@comakers.com.ar' }
};

var DATOS_ADMIN = {
  // Tres socias (Marti/Lari/Delfi) + una colaboradora con cuenta.
  profiles: [
    { id: 'u-delfi', nombre: 'Delfina', email: 'delfi@comakers.com.ar', tipo: 'agencia', rol: 'socia',  super_admin: true,  activo: true, agencia: 'CoMakers', baja_en: null },
    { id: 'u-marti', nombre: 'Martina', email: 'marti@comakers.com.ar', tipo: 'agencia', rol: 'socia',  super_admin: false, activo: true, agencia: 'CoMakers', baja_en: null },
    { id: 'u-lari',  nombre: 'Lara',    email: 'lara@comakers.com.ar',  tipo: 'agencia', rol: 'socia',  super_admin: false, activo: true, agencia: 'CoMakers', baja_en: null },
    { id: 'u-pau',   nombre: 'Pauli',   email: 'pau@comakers.com.ar',   tipo: 'agencia', rol: 'equipo', super_admin: false, activo: true, agencia: 'CoMakers', baja_en: null }
  ],

  clientes: [
    { id: 'c-fos',   nombre: 'FOS Gestiones Inmobiliarias', slug: 'fos',              agencia: 'CoMakers', activo: true },
    { id: 'c-visit', nombre: 'Visitando Tandil',            slug: 'visitando-tandil', agencia: 'CoMakers', activo: true },
    { id: 'c-ekhos', nombre: 'EKHOS',                       slug: 'ekhos',            agencia: 'CoMakers', activo: false }
  ],

  // Catálogo de servicios (solapa Servicios). Lo usa el selector del popup.
  servicio: [
    { id: 'sv-cm',      nombre: 'CM',       categoria: 'Contenido', descripcion: null, precio: 120000, periodo: 'mes',   archivado: false, orden: 1 },
    { id: 'sv-pauta',   nombre: 'Pauta',    categoria: 'Ads',       descripcion: null, precio: 60000,  periodo: 'mes',   archivado: false, orden: 2 },
    { id: 'sv-landing', nombre: 'Landing',  categoria: 'Web',       descripcion: null, precio: 90000,  periodo: 'unica', archivado: false, orden: 3 },
    { id: 'sv-videos',  nombre: 'Videos',   categoria: 'Contenido', descripcion: null, precio: 70000,  periodo: 'mes',   archivado: false, orden: 4 }
  ],

  // Entregables (con costo interno) y qué incluye cada plan. El costo del
  // plan sale de cantidad × costo de cada entregable.
  entregable: [
    { id: 'e-reel',    nombre: 'Reel',             unidad: 'pieza',    cuesta: 8000,  horas: 2,   sistema: true,  activo: true, orden: 1 },
    { id: 'e-carr',    nombre: 'Carrusel',         unidad: 'pieza',    cuesta: 5000,  horas: 1.5, sistema: true,  activo: true, orden: 2 },
    { id: 'e-hist',    nombre: 'Historias',        unidad: 'pieza',    cuesta: 2000,  horas: 0.5, sistema: true,  activo: true, orden: 3 },
    { id: 'e-pauta',   nombre: 'Gestión de pauta', unidad: 'campaña',  cuesta: 15000, horas: 3,   sistema: true,  activo: true, orden: 4 }
  ],
  servicio_item: [
    { id: 'si-1', servicio_id: 'sv-cm',    entregable_id: 'e-reel', cantidad: 8,  orden: 100 },
    { id: 'si-2', servicio_id: 'sv-cm',    entregable_id: 'e-hist', cantidad: 12, orden: 200 },
    { id: 'si-3', servicio_id: 'sv-pauta', entregable_id: 'e-pauta', cantidad: 1, orden: 100 },
    { id: 'si-4', servicio_id: 'sv-videos', entregable_id: 'e-reel', cantidad: 4, orden: 100 }
  ],

  // La relación cliente-servicio: `contrato`. FOS tiene dos servicios.
  contrato: [
    { id: 'ct-fos1', cliente_id: 'c-fos',   servicio_id: 'sv-cm',    nombre: 'CM + Pauta', activo: true, tipo: 'mensual', dia_desde: 10, dia_hasta: null, monto: 180000, proximo_ajuste: null },
    { id: 'ct-fos2', cliente_id: 'c-fos',   servicio_id: 'sv-videos', nombre: 'Videos',    activo: true, tipo: 'mensual', dia_desde: 10, dia_hasta: null, monto: 70000,  proximo_ajuste: null },
    { id: 'ct-vis1', cliente_id: 'c-visit', servicio_id: 'sv-cm',    nombre: 'CM',         activo: true, tipo: 'mensual', dia_desde: 5,  dia_hasta: null, monto: 120000, proximo_ajuste: null }
  ],

  cobro: [
    { id: 'cb-fos1', contrato_id: 'ct-fos1', cliente_id: 'c-fos',   periodo: '2026-10-01', estado: 'cobrado',   monto: 180000, fecha_cobro: '2026-10-03', cuota_n: null },
    { id: 'cb-fos2', contrato_id: 'ct-fos2', cliente_id: 'c-fos',   periodo: '2026-10-01', estado: 'cobrado',   monto: 70000,  fecha_cobro: '2026-10-03', cuota_n: null },
    { id: 'cb-vis1', contrato_id: 'ct-vis1', cliente_id: 'c-visit', periodo: '2026-10-01', estado: 'pendiente', monto: 120000, fecha_cobro: null,         cuota_n: null }
  ],

  // Quién ejecutó cada cobro (el 85% se reparte entre estas personas).
  cobro_ejecutora: [
    { cobro_id: 'cb-fos1', user_id: 'u-marti' },
    { cobro_id: 'cb-fos1', user_id: 'u-lari' },
    { cobro_id: 'cb-fos2', user_id: 'u-delfi' },
    { cobro_id: 'cb-vis1', user_id: 'u-delfi' }
  ],
  contrato_ejecutora: [
    { contrato_id: 'ct-fos1', user_id: 'u-marti' },
    { contrato_id: 'ct-fos2', user_id: 'u-delfi' },
    { contrato_id: 'ct-vis1', user_id: 'u-delfi' }
  ],

  // Los porcentajes del reparto (los "Supuestos").
  reparto: [{ pct_ejecutora: 85, pct_socias: 5, pct_fondo: 10 }],
  socia_reparto: [
    { user_id: 'u-marti', pct: 45 },
    { user_id: 'u-lari',  pct: 30 },
    { user_id: 'u-delfi', pct: 25 }
  ],

  acceso_cliente: [
    { cliente_id: 'c-fos',   user_id: 'u-delfi' },
    { cliente_id: 'c-fos',   user_id: 'u-marti' },
    { cliente_id: 'c-visit', user_id: 'u-delfi' }
  ],

  proyecto: [
    { id: 'p-fos', nombre: 'FOS · contenido', cliente_id: 'c-fos', color: null, privado: false, archivado: false, finalizado_en: null, creado_por: 'u-delfi' }
  ],

  // Fondo + Gastos (migración 48).
  fondo_inicial: [
    { id: true, saldo: 500000, desde: '2026-08-01', actualizado_en: '2026-08-01T12:00:00Z' }
  ],
  gasto: [
    { id: 'g-1', fecha: '2026-10-02', descripcion: 'Nafta reunión San Eusebio', categoria: 'Nafta/Traslados', monto: 18000, comprobante: 'ticket #4821', pagado_por: 'u-marti' },
    { id: 'g-2', fecha: '2026-10-05', descripcion: 'Canva Pro (anual / 12)',     categoria: 'Apps/Plataformas', monto: 9500,  comprobante: null,          pagado_por: 'u-delfi' },
    { id: 'g-3', fecha: '2026-10-06', descripcion: 'Trípode + luz led',          categoria: 'Herramientas',     monto: 42000, comprobante: 'factura B',   pagado_por: 'u-lari' }
  ],

  cliente_integracion: [
    { id: 'ci-fos-ig',  cliente_id: 'c-fos',   tipo: 'meta_ig',  cuenta_id: '17841466933923139', cuenta_nombre: '@fos.inmobiliaria', activo: true, ultimo_sync: '2026-10-07T06:02:00Z', ultimo_error: null },
    { id: 'ci-fos-ads', cliente_id: 'c-fos',   tipo: 'meta_ads', cuenta_id: 'act_483803057555648', cuenta_nombre: 'FOS GI — Ads',   activo: true, ultimo_sync: '2026-10-07T06:03:00Z', ultimo_error: null },
    { id: 'ci-vis-ig',  cliente_id: 'c-visit', tipo: 'meta_ig',  cuenta_id: '17841463436895688', cuenta_nombre: '@visitandotandil', activo: true, ultimo_sync: null, ultimo_error: '2026-09 · El acceso a Instagram venció.' }
  ],

  // crm lo creó la migración 46 con activo=false para todos los clientes
  // existentes (se lee al revés: sin fila o con activo=false está apagado).
  cliente_modulo: [
    { cliente_id: 'c-fos',   modulo: 'organico', activo: true },
    { cliente_id: 'c-fos',   modulo: 'pauta',    activo: true },
    { cliente_id: 'c-fos',   modulo: 'crm',      activo: false },
    { cliente_id: 'c-visit', modulo: 'organico', activo: true },
    { cliente_id: 'c-visit', modulo: 'pauta',    activo: false },
    { cliente_id: 'c-visit', modulo: 'crm',      activo: false }
  ]
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DATOS_ADMIN: DATOS_ADMIN, SESION_ADMIN: SESION_ADMIN };
}
