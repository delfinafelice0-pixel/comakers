// ═══════════════════════════════════════════════════════════════
//  Un Supabase de mentira, en memoria.
//
//  Se inyecta ANTES de los scripts de la página (page.addInitScript),
//  así `supabase.createClient(...)` devuelve esto y la página nunca
//  sale a internet. Las tablas son arrays de objetos comunes: las
//  sembrás con `datos` y listo.
//
//  No es PostgREST de verdad: implementa lo que la página usa
//  —select/insert/update/delete con eq, in, is, neq, gte, lte, or,
//  order, limit, single, maybeSingle— y nada más. Si algún día la
//  página empieza a usar otra cosa, esto tira un error con el nombre
//  del método en vez de devolver algo silenciosamente mal.
//
//  Ojo: acá NO hay RLS. Lo que la base te dejaría ver o no se prueba
//  con SQL, no con esto. Esto prueba la PANTALLA.
// ═══════════════════════════════════════════════════════════════
function textoDelMock(datos, sesion) {
  return '(' + String(function (DATOS, SESION) {
    const TABLAS = {};
    Object.keys(DATOS).forEach(k => { TABLAS[k] = DATOS[k].map(r => Object.assign({}, r)); });
    window.__TABLAS = TABLAS;

    let SEQ = 0;
    function nuevoId(t) { SEQ++; return t + '-' + SEQ + '-' + Date.now().toString(36); }

    function filasDe(t) { if (!TABLAS[t]) TABLAS[t] = []; return TABLAS[t]; }

    // Una columna puede venir como 'tabla.campo' en un `or`; alcanza el campo.
    function val(fila, campo) { return fila[campo.split('.').pop()]; }

    function cumple(fila, f) {
      const v = val(fila, f.campo);
      switch (f.op) {
        case 'eq':  return v === f.valor;
        case 'neq': return v !== f.valor;
        case 'is':  return f.valor === null ? (v === null || v === undefined) : v === f.valor;
        case 'in':  return (f.valor || []).indexOf(v) !== -1;
        case 'gte': return v >= f.valor;
        case 'lte': return v <= f.valor;
        case 'gt':  return v > f.valor;
        case 'lt':  return v < f.valor;
        case 'not.is': return !(f.valor === null ? (v === null || v === undefined) : v === f.valor);
        case 'or': return f.partes.some(p => cumple(fila, p));
        default: throw new Error('mock: filtro desconocido ' + f.op);
      }
    }

    // "a.eq.1,b.is.null" → [{campo:'a',op:'eq',valor:1}, …]
    function parsearOr(txt) {
      return txt.split(',').map(p => {
        const t = p.split('.');
        const campo = t[0];
        let op = t[1], crudo = t.slice(2).join('.');
        if (op === 'not') { op = 'not.' + t[2]; crudo = t.slice(3).join('.'); }
        let valor = crudo;
        if (crudo === 'null') valor = null;
        else if (crudo === 'true') valor = true;
        else if (crudo === 'false') valor = false;
        else if (crudo !== '' && !isNaN(Number(crudo))) valor = Number(crudo);
        return { campo: campo, op: op, valor: valor };
      });
    }

    function consulta(tabla) {
      const q = {
        tabla: tabla, filtros: [], orden: null, tope: null,
        modo: 'select', datos: null, unaSola: false, permiteVacio: false
      };

      function correr() {
        let filas = filasDe(q.tabla).filter(r => q.filtros.every(f => cumple(r, f)));

        if (q.modo === 'insert') {
          const nuevas = (Array.isArray(q.datos) ? q.datos : [q.datos]).map(d => {
            const fila = Object.assign({ id: nuevoId(q.tabla) }, d);
            if (fila.creado_en === undefined) fila.creado_en = new Date().toISOString();
            filasDe(q.tabla).push(fila);
            return Object.assign({}, fila);
          });
          return { data: q.unaSola ? nuevas[0] : nuevas, error: null };
        }
        if (q.modo === 'update') {
          filas.forEach(r => Object.assign(r, q.datos));
          const copias = filas.map(r => Object.assign({}, r));
          return { data: q.unaSola ? (copias[0] || null) : copias, error: null };
        }
        if (q.modo === 'delete') {
          const quedan = filasDe(q.tabla).filter(r => filas.indexOf(r) === -1);
          TABLAS[q.tabla] = quedan;
          return { data: filas.map(r => Object.assign({}, r)), error: null };
        }

        if (q.orden) {
          const c = q.orden.campo, asc = q.orden.asc;
          filas = filas.slice().sort((a, b) => {
            const x = val(a, c), y = val(b, c);
            if (x === y) return 0;
            if (x === null || x === undefined) return 1;
            if (y === null || y === undefined) return -1;
            return (x > y ? 1 : -1) * (asc ? 1 : -1);
          });
        }
        if (q.tope != null) filas = filas.slice(0, q.tope);
        const copias = filas.map(r => Object.assign({}, r));
        if (q.unaSola) {
          if (!copias.length) {
            return q.permiteVacio
              ? { data: null, error: null }
              : { data: null, error: { message: 'no rows', code: 'PGRST116' } };
          }
          return { data: copias[0], error: null };
        }
        return { data: copias, error: null, count: copias.length };
      }

      const api = {
        select: function () { if (q.modo === 'select') q.modo = 'select'; return api; },
        insert: function (d) { q.modo = 'insert'; q.datos = d; return api; },
        update: function (d) { q.modo = 'update'; q.datos = d; return api; },
        upsert: function (d) { q.modo = 'insert'; q.datos = d; return api; },
        delete: function () { q.modo = 'delete'; return api; },
        eq:  function (c, v) { q.filtros.push({ campo: c, op: 'eq',  valor: v }); return api; },
        neq: function (c, v) { q.filtros.push({ campo: c, op: 'neq', valor: v }); return api; },
        is:  function (c, v) { q.filtros.push({ campo: c, op: 'is',  valor: v }); return api; },
        in:  function (c, v) { q.filtros.push({ campo: c, op: 'in',  valor: v }); return api; },
        gte: function (c, v) { q.filtros.push({ campo: c, op: 'gte', valor: v }); return api; },
        lte: function (c, v) { q.filtros.push({ campo: c, op: 'lte', valor: v }); return api; },
        gt:  function (c, v) { q.filtros.push({ campo: c, op: 'gt',  valor: v }); return api; },
        lt:  function (c, v) { q.filtros.push({ campo: c, op: 'lt',  valor: v }); return api; },
        or:  function (t) { q.filtros.push({ op: 'or', partes: parsearOr(t) }); return api; },
        not: function (c, op, v) { q.filtros.push({ campo: c, op: 'not.' + op, valor: v }); return api; },
        order: function (c, o) { q.orden = { campo: c, asc: !(o && o.ascending === false) }; return api; },
        limit: function (n) { q.tope = n; return api; },
        single: function () { q.unaSola = true; return api; },
        maybeSingle: function () { q.unaSola = true; q.permiteVacio = true; return api; },
        then: function (ok, mal) { return Promise.resolve(correr()).then(ok, mal); }
      };
      return api;
    }

    const cliente = {
      from: consulta,
      rpc: function () { return { then: function (ok) { return Promise.resolve({ data: null, error: null }).then(ok); } }; },
      channel: function () {
        const ch = { on: function () { return ch; }, subscribe: function () { return ch; }, unsubscribe: function () { return Promise.resolve(); } };
        return ch;
      },
      removeChannel: function () { return Promise.resolve(); },
      auth: {
        getSession: function () { return Promise.resolve({ data: { session: SESION }, error: null }); },
        getUser: function () { return Promise.resolve({ data: { user: SESION.user }, error: null }); },
        signOut: function () { return Promise.resolve({ error: null }); },
        onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; }
      },
      storage: { from: function () { return { upload: function () { return Promise.resolve({ data: null, error: null }); }, getPublicUrl: function () { return { data: { publicUrl: '' } }; } }; } }
    };
    window.supabase = { createClient: function () { return cliente; } };
  }) + ')(' + JSON.stringify(datos) + ',' + JSON.stringify(sesion) + ')';
}

module.exports = { textoDelMock };
