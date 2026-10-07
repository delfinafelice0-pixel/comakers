// ═══════════════════════════════════════════════════════════════
//  Datos de mentira para probar la solapa Clientes de administración.
//  Al lado de datos-panel.js, misma idea: se siembran las tablas que
//  usa la pantalla y el mock (fuente/mock-supabase.js) las sirve.
//
//  NO hay RLS acá: esto prueba la PANTALLA, no los permisos. Que la
//  base deje o no escribir cliente_modulo se prueba con SQL.
//
//  La sesión es de una socia (rol:'socia', tipo:'agencia'): es lo que
//  exige soySocia() para que la solapa Clientes se dibuje.
// ═══════════════════════════════════════════════════════════════

var SESION_ADMIN = {
  user: { id: 'u-delfi', email: 'delfi@comakers.com.ar' }
};

var DATOS_ADMIN = {
  profiles: [
    { id: 'u-delfi', nombre: 'Delfi',    email: 'delfi@comakers.com.ar', tipo: 'agencia', rol: 'socia',  super_admin: true,  activo: true,  agencia: 'CoMakers', baja_en: null },
    { id: 'u-marti', nombre: 'Martina',  email: 'marti@comakers.com.ar', tipo: 'agencia', rol: 'socia',  super_admin: false, activo: true,  agencia: 'CoMakers', baja_en: null },
    { id: 'u-pau',   nombre: 'Pauli',    email: 'pau@comakers.com.ar',   tipo: 'agencia', rol: 'equipo', super_admin: false, activo: true,  agencia: 'CoMakers', baja_en: null }
  ],

  clientes: [
    { id: 'c-fos',   nombre: 'FOS Gestiones Inmobiliarias', slug: 'fos',              agencia: 'CoMakers', activo: true },
    { id: 'c-visit', nombre: 'Visitando Tandil',            slug: 'visitando-tandil', agencia: 'CoMakers', activo: true },
    { id: 'c-ekhos', nombre: 'EKHOS',                       slug: 'ekhos',            agencia: 'CoMakers', activo: false }
  ],

  contrato: [
    { id: 'ct-fos1', cliente_id: 'c-fos',   nombre: 'CM + Pauta', activo: true, tipo: 'mensual', dia_desde: 10, dia_hasta: null, monto: 180000, proximo_ajuste: null },
    { id: 'ct-vis1', cliente_id: 'c-visit', nombre: 'CM',         activo: true, tipo: 'mensual', dia_desde: 5,  dia_hasta: null, monto: 120000, proximo_ajuste: null }
  ],

  cobro: [
    { id: 'cb-fos1', contrato_id: 'ct-fos1', periodo: '2026-10-01', estado: 'cobrado',   monto: 180000, cuota_n: null },
    { id: 'cb-vis1', contrato_id: 'ct-vis1', periodo: '2026-10-01', estado: 'pendiente', monto: 120000, cuota_n: null }
  ],

  acceso_cliente: [
    { cliente_id: 'c-fos',   user_id: 'u-delfi' },
    { cliente_id: 'c-fos',   user_id: 'u-marti' },
    { cliente_id: 'c-visit', user_id: 'u-delfi' }
  ],

  proyecto: [
    { id: 'p-fos', nombre: 'FOS · contenido', cliente_id: 'c-fos', color: null, privado: false, archivado: false, finalizado_en: null, creado_por: 'u-delfi' }
  ],

  // Lo nuevo: conexiones y módulos del panel de cliente.
  cliente_integracion: [
    { id: 'ci-fos-ig',  cliente_id: 'c-fos',   tipo: 'meta_ig',  cuenta_id: '17841466933923139', cuenta_nombre: '@fos.inmobiliaria', activo: true, ultimo_sync: '2026-10-07T06:02:00Z', ultimo_error: null },
    { id: 'ci-fos-ads', cliente_id: 'c-fos',   tipo: 'meta_ads', cuenta_id: 'act_483803057555648', cuenta_nombre: 'FOS GI — Ads',   activo: true, ultimo_sync: '2026-10-07T06:03:00Z', ultimo_error: null },
    { id: 'ci-vis-ig',  cliente_id: 'c-visit', tipo: 'meta_ig',  cuenta_id: '17841463436895688', cuenta_nombre: '@visitandotandil', activo: true, ultimo_sync: null, ultimo_error: '2026-09 · El acceso a Instagram venció. Hay que generar un token nuevo en Meta.' }
  ],

  cliente_modulo: [
    { cliente_id: 'c-fos',   modulo: 'organico', activo: true },
    { cliente_id: 'c-fos',   modulo: 'pauta',    activo: true },
    { cliente_id: 'c-visit', modulo: 'organico', activo: true },
    { cliente_id: 'c-visit', modulo: 'pauta',    activo: false }
  ]
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DATOS_ADMIN: DATOS_ADMIN, SESION_ADMIN: SESION_ADMIN };
}
