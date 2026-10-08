// ═══════════════════════════════════════════════════════════════
//  panel-modulos.js · las solapas nuevas del panel del cliente
//
//  Calendario · Estrategia · Objetivos · One Shot · Servicio
//
//  Vive aparte de panel.html (que ya pasa las 2.700 líneas) y habla
//  con él por window.PANEL: la conexión a Supabase, quién mira
//  (agencia o cliente), qué cliente está abierto y los reportes. Se
//  registra en window.PanelModulos; panel.html lo llama desde render()
//  cuando el ítem del menú no es Reportes.
//
//  Reglas que valen para todo lo de acá (ver la migración 51):
//
//   · Todo cuelga de cliente_id.
//   · El cliente no ve nada que no esté publicado, y no hay herencia:
//     cada cosa tiene su propio "Visible para el cliente". La RLS es la
//     garantía; acá además se filtra para la vista "Ver como cliente"
//     de la agencia.
//   · Comentarios por canal separado, interno por defecto. El cliente
//     ni recibe los internos (RLS).
//   · Cada solapa es un módulo de cliente_modulo, apagado por defecto.
// ═══════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const P = () => window.PANEL;
  const SB = () => window.PANEL.SB;
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m, mal) => P().toast(m, mal);
  const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const DIAS_CORTOS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

  // ── Fechas, siempre como texto 'YYYY-MM-DD' (sin husos) ─────────
  const pad = n => String(n).padStart(2, '0');
  const iso = (y, m, d) => y + '-' + pad(m) + '-' + pad(d);
  const isoDe = dt => iso(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
  const hoyISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
  const aFecha = s => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
  const fechaLarga = s => { if (!s) return ''; const d = aFecha(s); return d.getDate() + ' de ' + MESES[d.getMonth()] + ' de ' + d.getFullYear(); };
  const fechaCorta = s => { if (!s) return ''; const d = aFecha(s); return d.getDate() + ' ' + MESES[d.getMonth()].slice(0, 3); };
  const mesSig = (ym, n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return d.getFullYear() + '-' + pad(d.getMonth() + 1); };
  const plata = v => v == null || v === '' ? '—' : '$' + Number(v).toLocaleString('es-AR', { maximumFractionDigits: 0 });

  function esTablaFaltante(e) {
    return !!e && (e.code === '42P01' || e.code === 'PGRST205' || /does not exist|could not find the table|no existe/i.test(e.message || ''));
  }

  // ── Quién mira ──────────────────────────────────────────────────
  // La agencia puede mirar "como cliente": se ve solo lo publicado y sin
  // botones. Sirve para chequear antes de mandar el link (y para la
  // presentación). No reemplaza a la RLS: es una vista.
  let VISTA_CLIENTE = false;
  const edita = () => P().AGENCIA && !VISTA_CLIENTE;
  const veo = x => edita() || !!x.publicado;

  function botonVista() {
    if (!P().AGENCIA) return '';
    return '<button type="button" class="btn chico pm-vista' + (VISTA_CLIENTE ? ' on' : '') + '" data-vista="1" ' +
      'title="Muestra solo lo publicado, sin botones">' +
      (VISTA_CLIENTE ? '✕ Salir de la vista cliente' : '👁 Ver como cliente') + '</button>';
  }

  // "Visible para el cliente" / "Oculto": cada cosa se publica sola.
  function pubBoton(tabla, id, publicado, campo) {
    if (!edita()) return '';
    return '<button type="button" class="pm-pub ' + (publicado ? 'on' : 'off') + '" data-pub="' + esc(tabla) + '" data-id="' + esc(id) + '"' +
      (campo ? ' data-campo="' + esc(campo) + '"' : '') +
      ' title="' + (publicado ? 'El cliente lo ve. Tocá para ocultarlo.' : 'El cliente NO lo ve. Tocá para publicarlo.') + '">' +
      (publicado ? '● Visible para el cliente' : '○ Oculto para el cliente') + '</button>';
  }

  // Cabecera común. Mismas clases que el reporte.
  function cabecera(titulo, em, sub, acciones) {
    return '<div class="cabecera"><div>' +
      '<h1>' + esc(titulo) + (em ? ' <em>' + esc(em) + '</em>' : '') + '</h1>' +
      '<div class="sub">' + esc(P().CLIENTE.nombre) + (sub ? ' · ' + sub : '') +
      (VISTA_CLIENTE ? ' <span class="pill pm-pill-vista">vista cliente: solo lo publicado</span>' : '') + '</div></div>' +
      '<div class="acciones">' + (acciones || '') + botonVista() + '</div></div>';
  }

  function faltaMigracion() {
    return '<div class="vacio"><h1>Falta un paso</h1><p>' + (P().AGENCIA
      ? 'Las tablas de esta solapa todavía no existen. Corré claude_migracion-interno-51-panel-modulos.sql en el SQL Editor de Supabase y recargá.'
      : 'Esta sección todavía no está lista. Volvé a mirar en un rato.') + '</p></div>';
  }

  // ── Modal ───────────────────────────────────────────────────────
  function cerrarModal() { const o = $('#pmOv'); if (o) o.remove(); }
  function modal(html, alMontar, ancho) {
    cerrarModal();
    const ov = document.createElement('div');
    ov.className = 'pm-ov'; ov.id = 'pmOv';
    ov.innerHTML = '<div class="pm-modal' + (ancho ? ' ancho' : '') + '" role="dialog" aria-modal="true">' +
      '<button type="button" class="pm-x" data-cerrar="1" aria-label="Cerrar">×</button>' + html + '</div>';
    ov.addEventListener('mousedown', e => { if (e.target === ov) cerrarModal(); });
    ov.addEventListener('click', e => { if (e.target.closest('[data-cerrar]')) cerrarModal(); });
    document.body.appendChild(ov);
    if (alMontar) alMontar(ov.firstChild);
    const f = ov.querySelector('input:not([type=checkbox]):not([type=color]), textarea, select');
    if (f && edita()) setTimeout(() => f.focus(), 40);
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape') cerrarModal(); });

  const val = (id, el) => { const x = $(id, el); return x ? x.value.trim() : ''; };
  const chk = (id, el) => { const x = $(id, el); return !!(x && x.checked); };
  const opciones = (lista, actual, vacioTxt) =>
    (vacioTxt != null ? '<option value="">' + esc(vacioTxt) + '</option>' : '') +
    lista.map(o => { const v = Array.isArray(o) ? o[0] : o, t = Array.isArray(o) ? o[1] : o;
      return '<option value="' + esc(v) + '"' + (String(actual || '') === String(v) ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join('');

  // Texto con saltos de línea y links clickeables.
  function prosa(t) {
    return esc(t || '').replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  }

  // ── Comentarios (por canal) ─────────────────────────────────────
  // interno = solo la agencia (por defecto); cliente = la conversación
  // con el cliente. El cliente solo recibe los suyos por RLS.
  async function cargarComentarios(entidad, id) {
    const { data, error } = await SB().from('panel_comentario').select('*')
      .eq('entidad', entidad).eq('entidad_id', id).order('creado_en');
    return error ? [] : (data || []);
  }

  function comentariosHtml(lista, canal) {
    const ag = P().AGENCIA;
    const vis = lista.filter(c => c.canal === canal);
    return '<div class="pm-coment">' +
      (ag ? '<div class="pm-canales">' +
        '<button type="button" data-canal="interno" class="' + (canal === 'interno' ? 'on' : '') + '">🔒 Interno <small>' + lista.filter(c => c.canal === 'interno').length + '</small></button>' +
        '<button type="button" data-canal="cliente" class="' + (canal === 'cliente' ? 'on' : '') + '">💬 Con el cliente <small>' + lista.filter(c => c.canal === 'cliente').length + '</small></button>' +
        '</div>' : '<div class="pm-et">Comentarios con la agencia</div>') +
      (ag && canal === 'interno' ? '<p class="pm-ayuda">Solo lo ve la agencia. Nunca le llega al cliente.</p>' : '') +
      (ag && canal === 'cliente' ? '<p class="pm-ayuda aviso">Esto lo lee el cliente.</p>' : '') +
      '<div class="pm-coment-lista">' + (vis.length ? vis.map(c =>
        '<div class="pm-c' + (c.es_cliente ? ' de-cliente' : '') + '"><div class="pm-c-quien">' + esc(c.autor_nombre || (c.es_cliente ? 'Cliente' : 'Agencia')) +
        ' <span>' + esc(fechaCorta(c.creado_en)) + '</span></div><div class="pm-c-txt">' + prosa(c.texto) + '</div></div>').join('')
        : '<p class="pm-vacio-chico">Sin comentarios.</p>') + '</div>' +
      '<div class="pm-coment-nuevo"><textarea id="pmComTxt" rows="2" placeholder="' +
        (canal === 'interno' ? 'Nota interna…' : 'Escribile al ' + (ag ? 'cliente' : 'equipo') + '…') + '"></textarea>' +
      '<button type="button" class="btn chico ' + (canal === 'cliente' ? 'lima' : 'primario') + '" id="pmComEnviar">Enviar</button></div>' +
      '</div>';
  }

  // Monta los comentarios en `cont` y los mantiene vivos.
  async function montarComentarios(cont, entidad, id) {
    let canal = P().AGENCIA ? 'interno' : 'cliente';
    let lista = await cargarComentarios(entidad, id);
    const pintar = () => {
      cont.innerHTML = comentariosHtml(lista, canal);
      $$('[data-canal]', cont).forEach(b => b.addEventListener('click', () => { canal = b.dataset.canal; pintar(); }));
      $('#pmComEnviar', cont).addEventListener('click', async () => {
        const texto = val('#pmComTxt', cont);
        if (!texto) return;
        const fila = { cliente_id: P().CLIENTE.id, entidad, entidad_id: id, canal: P().AGENCIA ? canal : 'cliente',
                       texto, autor_id: P().YO.id, autor_nombre: P().YO.nombre || null, es_cliente: !P().AGENCIA };
        const { data, error } = await SB().from('panel_comentario').insert(fila).select('*').single();
        if (error) { toast('No se pudo enviar: ' + error.message, true); return; }
        lista.push(data); pintar();
      });
    };
    pintar();
  }

  // Publicar / ocultar una fila (o un campo booleano de una fila).
  async function alternarPub(tabla, fila, campo, despues) {
    campo = campo || 'publicado';
    const nuevo = !fila[campo];
    const clave = tabla === 'cal_config' || tabla === 'servicio_publicacion' ? 'cliente_id' : 'id';
    const patch = {}; patch[campo] = nuevo;
    const { error } = await SB().from(tabla).update(patch).eq(clave, fila[clave]);
    if (error) { toast('No se pudo: ' + error.message, true); return; }
    fila[campo] = nuevo;
    toast(nuevo ? 'Publicado: el cliente ya lo ve.' : 'Oculto: el cliente ya no lo ve.');
    if (despues) despues();
  }

  // ═════════════════════════════════════════════════════════════
  //  CALENDARIO
  //  Reemplaza al Canva. Meses uno abajo del otro, lunes a domingo.
  //  Publicaciones = tarjetas del color de su categoría. Ideas sin
  //  fecha a la derecha, se arrastran al día.
  // ═════════════════════════════════════════════════════════════
  const CAL = { cargado: false, falta: false, cats: [], conts: [], evs: [], cfg: null, gente: [], desde: null, cuantos: 3 };
  const FORMATOS = ['Reel', 'Carrusel', 'Historia', 'Imagen', 'Video', 'TikTok', 'En vivo', 'Otro'];
  const TIPO_EV = { recurrente: 'Recurrente', ausencia: 'Ausencia', comercial: 'Actividad comercial', especial: 'Fecha especial' };

  async function cargarCalendario() {
    const cid = P().CLIENTE.id;
    const [cats, conts, evs, cfg] = await Promise.all([
      SB().from('cal_categoria').select('*').order('orden'),
      SB().from('cal_contenido').select('*').eq('cliente_id', cid).order('orden'),
      SB().from('cal_evento').select('*').eq('cliente_id', cid).order('desde'),
      SB().from('cal_config').select('*').eq('cliente_id', cid).maybeSingle()
    ]);
    if (esTablaFaltante(conts.error) || esTablaFaltante(cats.error)) { CAL.falta = true; CAL.cargado = true; return; }
    CAL.falta = false;
    CAL.cats = (cats.data || []).filter(c => c.activo !== false && (!c.cliente_id || c.cliente_id === cid));
    CAL.conts = conts.data || [];
    CAL.evs = evs.data || [];
    CAL.cfg = cfg.data || null;
    if (P().AGENCIA && !CAL.gente.length) {
      const { data } = await SB().from('profiles').select('id, nombre, tipo').eq('tipo', 'agencia').order('nombre');
      CAL.gente = (data || []).filter(p => p.nombre);
    }
    if (!CAL.desde) CAL.desde = hoyISO().slice(0, 7);
    CAL.cargado = true;
  }

  const catDe = id => CAL.cats.find(c => c.id === id) || null;
  const colorDe = c => { const k = catDe(c.categoria_id); return k ? k.color : '#e4e1e8'; };

  // ── Fechas especiales de Argentina, calculadas ───────────────────
  // Las móviles (Madre, Padre, Infancias, Carnaval, Semana Santa,
  // Black Friday) se calculan por año: no hay que cargar nada.
  function pascua(y) {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4,
      f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30,
      i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
      mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(y, mes - 1, dia);
  }
  const nEsimo = (y, mes, dow, n) => { // dow: 0 = domingo
    const d = new Date(y, mes - 1, 1); return new Date(y, mes - 1, 1 + ((dow - d.getDay() + 7) % 7) + 7 * (n - 1));
  };
  const masDias = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const CACHE_AR = {};
  function fechasAR(y) {
    if (CACHE_AR[y]) return CACHE_AR[y];
    const f = (m, d, t) => [iso(y, m, d), t];
    const p = pascua(y);
    const lista = [
      f(1, 1, '🎆 Año Nuevo'), [isoDe(masDias(p, -48)), '🎭 Carnaval'], [isoDe(masDias(p, -47)), '🎭 Carnaval'],
      f(2, 14, '❤️ San Valentín'), f(3, 8, '💜 Día de la Mujer'), f(3, 24, 'Día de la Memoria'),
      f(4, 2, 'Día de Malvinas'), [isoDe(masDias(p, -3)), 'Jueves Santo'], [isoDe(masDias(p, -2)), 'Viernes Santo'],
      [isoDe(p), '🐣 Pascuas'], f(5, 1, 'Día del Trabajador'), f(5, 25, '🇦🇷 25 de Mayo'),
      [isoDe(nEsimo(y, 6, 0, 3)), '👔 Día del Padre'], f(6, 17, 'Paso a la inmortalidad de Güemes'),
      f(6, 20, '🇦🇷 Día de la Bandera'), f(7, 9, '🇦🇷 Día de la Independencia'), f(7, 20, '🤝 Día del Amigo'),
      f(8, 17, 'Paso a la inmortalidad de San Martín'), [isoDe(nEsimo(y, 8, 0, 3)), '🧸 Día de las Infancias'],
      f(9, 11, '📚 Día del Maestro'), f(9, 21, '🌸 Día de la Primavera y del Estudiante'), f(9, 27, '🧳 Día Mundial del Turismo'),
      f(10, 12, 'Día de la Diversidad Cultural'), [isoDe(nEsimo(y, 10, 0, 3)), '💐 Día de la Madre'],
      f(10, 31, '🎃 Halloween'), f(11, 10, '🧉 Día de la Tradición'), f(11, 20, 'Día de la Soberanía'),
      [isoDe(masDias(nEsimo(y, 11, 4, 4), 1)), '🛍️ Black Friday'], f(12, 3, '🩺 Día del Médico'),
      f(12, 8, 'Inmaculada Concepción'), f(12, 24, '🎄 Nochebuena'), f(12, 25, '🎄 Navidad'), f(12, 31, '🥂 Fin de año')
    ];
    const porDia = {};
    lista.forEach(([d, t]) => { (porDia[d] = porDia[d] || []).push(t); });
    return (CACHE_AR[y] = porDia);
  }
  const verFechasAR = () => edita() || !!(CAL.cfg && CAL.cfg.mostrar_fechas_especiales);

  // Eventos de un día. Recurrentes por día de la semana (1 = lunes).
  function eventosDelDia(f, dow) {
    return CAL.evs.filter(e => (veo(e) || e.cargado_por_cliente)).filter(e => {
      if (f < e.desde) return false;
      if (e.tipo === 'recurrente') return (!e.hasta || f <= e.hasta) && (e.dias_semana || []).indexOf(dow) !== -1;
      return f <= (e.hasta || e.desde);
    });
  }

  function tarjetaContenido(c) {
    const k = catDe(c.categoria_id);
    const oculto = P().AGENCIA && !c.publicado;
    const puedeA = edita(), puedeC = edita() || (!P().AGENCIA && c.publicado);
    return '<div class="cal-card' + (oculto ? ' oculta' : '') + '" style="--c:' + esc(colorDe(c)) + '" data-cont="' + esc(c.id) + '"' +
      (edita() ? ' draggable="true"' : '') + ' title="' + esc((k ? k.nombre + ' · ' : '') + c.titulo) + '">' +
      (oculto ? '<span class="cal-oculta" title="El cliente no la ve">oculta</span>' : '') +
      '<div class="cal-card-t">' + esc(c.titulo) + '</div>' +
      '<div class="cal-card-pie">' +
        '<span class="cal-resp">' + esc(c.responsable || '') + (c.formato ? (c.responsable ? ' · ' : '') + esc(c.formato) : '') + '</span>' +
        '<span class="cal-checks">' +
          '<button type="button" class="cal-ok' + (c.aprob_agencia ? ' si' : '') + '" data-aprob="agencia" data-id="' + esc(c.id) + '"' + (puedeA ? '' : ' disabled') +
            ' title="Aprobado por la agencia' + (c.aprob_agencia ? '' : ': todavía no') + '">A' + (c.aprob_agencia ? '✓' : '') + '</button>' +
          '<button type="button" class="cal-ok' + (c.aprob_cliente ? ' si' : '') + '" data-aprob="cliente" data-id="' + esc(c.id) + '"' + (puedeC ? '' : ' disabled') +
            ' title="Aprobado por el cliente' + (c.aprob_cliente ? '' : ': todavía no') + '">C' + (c.aprob_cliente ? '✓' : '') + '</button>' +
        '</span></div></div>';
  }

  function chipEvento(e, f) {
    const oculto = P().AGENCIA && !e.publicado && !e.cargado_por_cliente;
    const clase = 'cal-ev ' + e.tipo + (oculto ? ' oculta' : '');
    let txt = e.titulo;
    if (e.tipo === 'recurrente' && e.hora) txt = e.hora + ' ' + e.titulo;
    if (e.tipo === 'ausencia' && e.desde !== f && aFecha(f).getDay() !== 1) txt = '';   // la barra sigue, el texto no se repite
    return '<button type="button" class="' + clase + '" data-ev="' + esc(e.id) + '"' + (e.color ? ' style="--e:' + esc(e.color) + '"' : '') +
      ' title="' + esc(TIPO_EV[e.tipo] + ': ' + e.titulo + (e.cargado_por_cliente ? ' (lo cargó el cliente)' : '')) + '">' +
      (e.tipo === 'comercial' ? '★ ' : '') + esc(txt || ' ') + '</button>';
  }

  function mesCalendario(ym) {
    const [y, m] = ym.split('-').map(Number);
    const dias = new Date(y, m, 0).getDate();
    const offset = (new Date(y, m - 1, 1).getDay() + 6) % 7;
    const hoy = hoyISO();
    const ar = verFechasAR() ? fechasAR(y) : {};
    const conts = CAL.conts.filter(c => c.fecha && c.fecha.slice(0, 7) === ym && veo(c));
    let celdas = '';
    for (let i = 0; i < offset; i++) celdas += '<div class="cal-dia fuera"></div>';
    for (let d = 1; d <= dias; d++) {
      const f = iso(y, m, d);
      const dow = ((new Date(y, m - 1, d).getDay() + 6) % 7) + 1;
      const evs = eventosDelDia(f, dow);
      const orden = { ausencia: 0, especial: 1, comercial: 2, recurrente: 3 };
      evs.sort((a, b) => orden[a.tipo] - orden[b.tipo] || String(a.hora || '').localeCompare(String(b.hora || '')));
      const espAR = ar[f] || [];
      celdas += '<div class="cal-dia' + (f === hoy ? ' hoy' : '') + (dow >= 6 ? ' finde' : '') + '" data-fecha="' + f + '">' +
        '<div class="cal-num"><span>' + d + '</span>' +
          (edita() ? '<button type="button" class="cal-mas" data-nuevo="' + f + '" title="Nuevo contenido el ' + esc(fechaCorta(f)) + '">+</button>' : '') + '</div>' +
        espAR.map(t => '<div class="cal-esp" title="Fecha especial">' + esc(t) + '</div>').join('') +
        evs.map(e => chipEvento(e, f)).join('') +
        conts.filter(c => c.fecha === f).map(tarjetaContenido).join('') +
        '</div>';
    }
    const resto = (7 - ((offset + dias) % 7)) % 7;
    for (let i = 0; i < resto; i++) celdas += '<div class="cal-dia fuera"></div>';
    return '<section class="cal-mes"><h2>' + esc(MESES[m - 1]) + ' <span>' + y + '</span></h2>' +
      '<div class="cal-grilla">' + DIAS_CORTOS.map(d => '<div class="cal-cab">' + d + '</div>').join('') + celdas + '</div></section>';
  }

  function bloqueFijo() {
    const c = CAL.cfg;
    const ver = c && (edita() || c.publicado);
    if (!ver && !edita()) return '';
    if (!c || (!c.drive_link && !c.instrucciones)) {
      return edita() ? '<div class="cal-fijo vacio-fijo"><div class="pm-et">Para el cliente</div>' +
        '<p>Link de Drive e instrucciones para subir el material.</p>' +
        '<button type="button" class="btn chico" data-cfg="1">Cargar</button></div>' : '';
    }
    return '<div class="cal-fijo' + (P().AGENCIA && !c.publicado ? ' oculta' : '') + '">' +
      '<div class="pm-et">📌 Para subir contenido</div>' +
      (c.drive_link ? '<a class="btn lima chico cal-drive" href="' + esc(c.drive_link) + '" target="_blank" rel="noopener">Abrir la carpeta de Drive ↗</a>' : '') +
      (c.instrucciones ? '<p class="cal-instr">' + prosa(c.instrucciones) + '</p>' : '') +
      (edita() ? '<div class="pm-fila-acc">' + pubBoton('cal_config', c.cliente_id, c.publicado) +
        '<button type="button" class="btn chico" data-cfg="1">Editar</button></div>' : '') +
      '</div>';
  }

  function panelIdeas() {
    const ideas = CAL.conts.filter(c => !c.fecha && veo(c));
    if (!ideas.length && !edita()) return '';
    return '<div class="cal-ideas" data-ideas="1">' +
      '<div class="cal-ideas-cab"><div class="pm-et">💡 Ideas sin fecha</div>' +
      (edita() ? '<button type="button" class="btn chico" data-nuevo="">+ Idea</button>' : '') + '</div>' +
      (edita() ? '<p class="pm-ayuda">Arrastralas a un día para agendarlas. Y al revés: soltá acá un contenido para sacarle la fecha.</p>' : '') +
      (ideas.length ? ideas.map(tarjetaContenido).join('') : '<p class="pm-vacio-chico">No hay ideas cargadas.</p>') +
      '</div>';
  }

  function leyenda() {
    const usadas = CAL.cats;
    return '<div class="cal-leyenda">' + usadas.map(k => '<span class="cal-ley"><i style="background:' + esc(k.color) + '"></i>' + esc(k.nombre) + '</span>').join('') +
      '<span class="cal-ley ev"><i class="r"></i>Recurrente</span><span class="cal-ley ev"><i class="a"></i>Ausencia</span>' +
      '<span class="cal-ley ev"><i class="c"></i>Comercial</span>' +
      '<span class="cal-ley ev">A✓ C✓ = aprobado por agencia / cliente</span></div>';
  }

  function renderCalendario(main) {
    if (CAL.falta) { main.innerHTML = cabecera('Calendario', '', '', '') + faltaMigracion(); conectarVista(main); return; }
    const acc = (edita()
      ? '<button type="button" class="btn primario" data-nuevo="">+ Contenido</button>' +
        '<button type="button" class="btn" data-evnuevo="1">+ Evento</button>' +
        '<button type="button" class="btn" data-cats="1">Categorías</button>'
      : (!P().AGENCIA ? '<button type="button" class="btn primario" data-evnuevo="comercial">+ Actividad comercial</button>' : ''));
    let meses = '';
    for (let i = 0; i < CAL.cuantos; i++) meses += mesCalendario(mesSig(CAL.desde, i));
    main.innerHTML = cabecera('Calendario', 'de contenidos', '', acc) +
      leyenda() +
      '<div class="cal-layout">' +
        '<div class="cal-meses"><button type="button" class="btn chico cal-masmes" data-masmes="-1">‹ Ver el mes anterior</button>' +
          meses + '<button type="button" class="btn chico cal-masmes" data-masmes="1">Ver un mes más ›</button></div>' +
        '<aside class="cal-lado">' + bloqueFijo() + panelIdeas() + '</aside>' +
      '</div>';
    conectarCalendario(main);
    conectarVista(main);
  }

  function conectarCalendario(main) {
    // Cada render pasa por render() de abajo, que clona el <main> y así
    // suelta estos listeners: no se acumulan.
    const re = () => P().rerender();
    main.addEventListener('click', async e => {
      const t = e.target;
      const ap = t.closest('[data-aprob]');
      if (ap) { e.stopPropagation(); if (!ap.disabled) await aprobar(ap.dataset.id, ap.dataset.aprob, re); return; }
      const nu = t.closest('[data-nuevo]');
      if (nu) { fichaContenido(null, nu.dataset.nuevo || null, re); return; }
      const card = t.closest('[data-cont]');
      if (card) { fichaContenido(CAL.conts.find(c => c.id === card.dataset.cont), null, re); return; }
      const ev = t.closest('[data-ev]');
      if (ev) { fichaEvento(CAL.evs.find(x => x.id === ev.dataset.ev), null, re); return; }
      const evn = t.closest('[data-evnuevo]');
      if (evn) { fichaEvento(null, evn.dataset.evnuevo === 'comercial' ? 'comercial' : null, re); return; }
      if (t.closest('[data-cats]')) { fichaCategorias(re); return; }
      if (t.closest('[data-cfg]')) { fichaConfig(re); return; }
      const mm = t.closest('[data-masmes]');
      if (mm) { if (mm.dataset.masmes === '-1') { CAL.desde = mesSig(CAL.desde, -1); } CAL.cuantos++; re(); return; }
      const pb = t.closest('[data-pub]');
      if (pb && pb.dataset.pub === 'cal_config') { await alternarPub('cal_config', CAL.cfg, null, re); return; }
    });

    if (!edita()) return;
    // Arrastrar: tarjetas a un día, o al panel de ideas (sin fecha).
    main.addEventListener('dragstart', e => {
      const c = e.target.closest && e.target.closest('[data-cont]');
      if (!c) return;
      e.dataTransfer.setData('text/plain', c.dataset.cont);
      e.dataTransfer.effectAllowed = 'move';
      c.classList.add('arrastrando');
    });
    main.addEventListener('dragend', () => $$('.arrastrando, .soltar', main).forEach(x => x.classList.remove('arrastrando', 'soltar')));
    const destino = t => t.closest && (t.closest('.cal-dia[data-fecha]') || t.closest('[data-ideas]'));
    main.addEventListener('dragover', e => {
      const d = destino(e.target); if (!d) return;
      e.preventDefault(); e.dataTransfer.dropEffect = 'move';
      $$('.soltar', main).forEach(x => x !== d && x.classList.remove('soltar'));
      d.classList.add('soltar');
    });
    main.addEventListener('drop', async e => {
      const d = destino(e.target); if (!d) return;
      e.preventDefault();
      const id = e.dataTransfer.getData('text/plain');
      const c = CAL.conts.find(x => x.id === id); if (!c) return;
      const fecha = d.dataset.fecha || null;
      if (c.fecha === fecha) { re(); return; }
      await moverContenido(c, fecha);
      re();
    });
  }

  async function moverContenido(c, fecha) {
    const { error } = await SB().from('cal_contenido').update({ fecha, actualizado_en: new Date().toISOString() }).eq('id', c.id);
    if (error) { toast('No se pudo mover: ' + error.message, true); return; }
    c.fecha = fecha;
    // Las tareas de /interno siguen al contenido.
    const tareas = [c.tarea_edicion_id, c.tarea_subida_id].filter(Boolean);
    if (tareas.length && fecha) await SB().from('tarea').update({ empieza: fecha, vence: fecha }).in('id', tareas);
    toast(fecha ? 'Agendado para el ' + fechaLarga(fecha) + '.' : 'Pasó a ideas sin fecha.');
  }

  async function aprobar(id, quien, re) {
    const c = CAL.conts.find(x => x.id === id); if (!c) return;
    const campo = quien === 'agencia' ? 'aprob_agencia' : 'aprob_cliente';
    const nuevo = !c[campo];
    let error;
    if (P().AGENCIA) {
      const patch = {}; patch[campo] = nuevo;
      if (campo === 'aprob_cliente') patch.aprob_cliente_en = nuevo ? new Date().toISOString() : null;
      ({ error } = await SB().from('cal_contenido').update(patch).eq('id', id));
    } else {
      // El cliente aprueba por RPC: no puede tocar ninguna otra columna.
      const r = await SB().rpc('panel_aprobar_contenido', { p_id: id, p_ok: nuevo });
      error = r.error || (r.data === false ? { message: 'no autorizado' } : null);
    }
    if (error) { toast('No se pudo: ' + error.message, true); return; }
    c[campo] = nuevo;
    toast(nuevo ? (quien === 'agencia' ? 'Aprobado por la agencia.' : 'Aprobado. ¡Gracias!') : 'Aprobación quitada.');
    re();
  }

  // ── Ficha de un contenido ────────────────────────────────────────
  function fichaContenido(c, fechaNueva, re) {
    const nuevo = !c;
    if (!edita()) { if (c) verContenido(c, re); return; }
    c = c || { fecha: fechaNueva, titulo: '', categoria_id: '', formato: '', responsable_id: P().YO.id, copy: '', referencias: '', link: '', publicado: false };
    const cats = CAL.cats.map(k => [k.id, k.nombre]);
    const gente = CAL.gente.map(g => [g.id, g.nombre]);
    modal(
      '<h3>' + (nuevo ? (c.fecha ? 'Nuevo contenido' : 'Nueva idea') : 'Contenido') + '</h3>' +
      '<div class="pm-form">' +
        '<label class="ancho">Título<input id="fcTit" value="' + esc(c.titulo) + '" placeholder="Ej: Reel recorrido por la cabaña"></label>' +
        '<label>Fecha<input type="date" id="fcFecha" value="' + esc(c.fecha || '') + '"><small>Vacía = idea sin fecha</small></label>' +
        '<label>Categoría<select id="fcCat">' + opciones(cats, c.categoria_id, 'Sin categoría') + '</select></label>' +
        '<label>Formato<select id="fcFormato">' + opciones(FORMATOS, c.formato, '—') + '</select></label>' +
        '<label>Responsable<select id="fcResp">' + opciones(gente, c.responsable_id, 'Sin asignar') + '</select></label>' +
        '<label class="ancho">Copy<textarea id="fcCopy" rows="5" placeholder="El texto de la publicación">' + esc(c.copy || '') + '</textarea></label>' +
        '<label class="ancho">Referencias<textarea id="fcRefs" rows="2" placeholder="Links, ideas, ejemplos">' + esc(c.referencias || '') + '</textarea></label>' +
        '<label class="ancho">Link (el archivo o la publicación)<input id="fcLink" value="' + esc(c.link || '') + '" placeholder="https://"></label>' +
        '<div class="ancho pm-checks">' +
          '<label class="pm-chk"><input type="checkbox" id="fcAprA"' + (c.aprob_agencia ? ' checked' : '') + '> Aprobado por la agencia</label>' +
          '<label class="pm-chk"><input type="checkbox" id="fcAprC"' + (c.aprob_cliente ? ' checked' : '') + '> Aprobado por el cliente</label>' +
          '<label class="pm-chk pub"><input type="checkbox" id="fcPub"' + (c.publicado ? ' checked' : '') + '> Visible para el cliente</label>' +
          (nuevo ? '<label class="pm-chk tareas"><input type="checkbox" id="fcTareas" checked> Crear en /interno las tareas de <b>edición</b> y de <b>subida</b> para ese día</label>' : '') +
          (!nuevo && (c.tarea_edicion_id || c.tarea_subida_id) ? '<p class="pm-ayuda">Tiene tareas en /interno: se mueven con el contenido.</p>' : '') +
        '</div>' +
      '</div>' +
      '<div class="pm-pie">' +
        (!nuevo ? '<button type="button" class="btn quieto" id="fcBorrar">Borrar</button>' : '') +
        '<span class="pm-esp"></span><button type="button" class="btn" data-cerrar="1">Cancelar</button>' +
        '<button type="button" class="btn primario" id="fcGuardar">Guardar</button></div>' +
      (!nuevo ? '<div id="fcComent" class="pm-coment-caja"></div>' : ''),
      el => {
        if (!nuevo) montarComentarios($('#fcComent', el), 'cal_contenido', c.id);
        $('#fcGuardar', el).addEventListener('click', () => guardarContenido(c, nuevo, el, re));
        const b = $('#fcBorrar', el);
        if (b) b.addEventListener('click', async () => {
          if (!confirm('¿Borrar "' + c.titulo + '"? Las tareas de /interno no se borran.')) return;
          const { error } = await SB().from('cal_contenido').delete().eq('id', c.id);
          if (error) { toast('No se pudo borrar: ' + error.message, true); return; }
          CAL.conts = CAL.conts.filter(x => x.id !== c.id);
          cerrarModal(); toast('Borrado.'); re();
        });
      }, true);
  }

  async function guardarContenido(c, nuevo, el, re) {
    const titulo = val('#fcTit', el);
    if (!titulo) { toast('Ponele un título', true); return; }
    const respId = val('#fcResp', el) || null;
    const persona = CAL.gente.find(g => g.id === respId);
    const fila = {
      cliente_id: P().CLIENTE.id, titulo, fecha: val('#fcFecha', el) || null,
      categoria_id: val('#fcCat', el) || null, formato: val('#fcFormato', el) || null,
      responsable_id: respId, responsable: persona ? persona.nombre : (respId ? c.responsable : null),
      copy: val('#fcCopy', el) || null, referencias: val('#fcRefs', el) || null, link: val('#fcLink', el) || null,
      aprob_agencia: chk('#fcAprA', el), aprob_cliente: chk('#fcAprC', el), publicado: chk('#fcPub', el),
      actualizado_en: new Date().toISOString()
    };
    if (fila.aprob_cliente !== !!c.aprob_cliente) fila.aprob_cliente_en = fila.aprob_cliente ? new Date().toISOString() : null;
    const btn = $('#fcGuardar', el); btn.disabled = true;
    try {
      if (nuevo) {
        fila.orden = Date.now() / 1000;
        const { data, error } = await SB().from('cal_contenido').insert(fila).select('*').single();
        if (error) { toast('No se pudo guardar: ' + error.message, true); return; }
        CAL.conts.push(data);
        if (chk('#fcTareas', el) && data.fecha) await crearTareas(data);
      } else {
        const { error } = await SB().from('cal_contenido').update(fila).eq('id', c.id);
        if (error) { toast('No se pudo guardar: ' + error.message, true); return; }
        const fechaAntes = c.fecha;
        Object.assign(c, fila);
        const tareas = [c.tarea_edicion_id, c.tarea_subida_id].filter(Boolean);
        if (tareas.length && c.fecha && c.fecha !== fechaAntes) await SB().from('tarea').update({ empieza: c.fecha, vence: c.fecha }).in('id', tareas);
      }
      cerrarModal(); toast('Guardado.'); re();
    } finally { btn.disabled = false; }
  }

  // Las dos tareas internas (edición y subida) para ese mismo día, en la
  // tabla que usa /interno. Nunca visibles para el cliente.
  async function crearTareas(c) {
    const base = {
      cliente_id: c.cliente_id, cliente_manual: true,
      responsable_id: c.responsable_id || null, responsable: c.responsable || null, responsable_tipo: 'agencia',
      urgencia: 'normal', empieza: c.fecha, vence: c.fecha, visible_cliente: false,
      descripcion: 'Del calendario del panel (' + (c.formato || 'contenido') + '): ' + c.titulo
    };
    const ids = {};
    for (const [clave, pre] of [['tarea_edicion_id', 'Editar'], ['tarea_subida_id', 'Subir']]) {
      let fila = Object.assign({}, base, { titulo: pre + ': ' + c.titulo, orden: Date.now() / 1000 });
      let r = await SB().from('tarea').insert(fila).select('id').single();
      // Bases sin la columna cliente_manual (migración 26): sin ella.
      if (r.error && /cliente_manual/.test(r.error.message || '')) { delete fila.cliente_manual; r = await SB().from('tarea').insert(fila).select('id').single(); }
      if (r.error) { toast('El contenido se guardó, pero no las tareas: ' + r.error.message, true); return; }
      ids[clave] = r.data.id;
    }
    await SB().from('cal_contenido').update(ids).eq('id', c.id);
    Object.assign(c, ids);
    toast('Contenido y tareas de edición y subida creados.');
  }

  // Lo que ve el cliente (o la agencia en vista cliente).
  function verContenido(c, re) {
    const k = catDe(c.categoria_id);
    const puedeAprobar = !P().AGENCIA;
    modal(
      '<div class="pm-ficha-cab" style="--c:' + esc(colorDe(c)) + '">' +
        (k ? '<span class="pm-cat">' + esc(k.nombre) + '</span>' : '') +
        '<h3>' + esc(c.titulo) + '</h3>' +
        '<div class="pm-sub">' + esc(c.fecha ? fechaLarga(c.fecha) : 'Idea sin fecha') +
          (c.formato ? ' · ' + esc(c.formato) : '') + (c.responsable ? ' · ' + esc(c.responsable) : '') + '</div></div>' +
      (c.copy ? '<div class="pm-et">Copy</div><p class="pm-prosa">' + prosa(c.copy) + '</p>' : '') +
      (c.referencias ? '<div class="pm-et">Referencias</div><p class="pm-prosa">' + prosa(c.referencias) + '</p>' : '') +
      (c.link ? '<div class="pm-et">Link</div><p><a href="' + esc(c.link) + '" target="_blank" rel="noopener">' + esc(c.link) + ' ↗</a></p>' : '') +
      '<div class="pm-aprobs">' +
        '<span class="pm-aprob' + (c.aprob_agencia ? ' si' : '') + '">' + (c.aprob_agencia ? '✓ Aprobado por la agencia' : 'Pendiente de la agencia') + '</span>' +
        (puedeAprobar
          ? '<button type="button" class="btn ' + (c.aprob_cliente ? '' : 'lima') + '" id="vcAprobar">' + (c.aprob_cliente ? '✓ Lo aprobaste · deshacer' : 'Aprobar este contenido') + '</button>'
          : '<span class="pm-aprob' + (c.aprob_cliente ? ' si' : '') + '">' + (c.aprob_cliente ? '✓ Aprobado por el cliente' : 'Pendiente del cliente') + '</span>') +
      '</div>' +
      '<div id="vcComent" class="pm-coment-caja"></div>',
      el => {
        montarComentarios($('#vcComent', el), 'cal_contenido', c.id);
        const b = $('#vcAprobar', el);
        if (b) b.addEventListener('click', async () => { await aprobar(c.id, 'cliente', re); verContenido(c, re); });
      }, true);
  }

  // ── Eventos (recurrentes, ausencias, comerciales, especiales) ────
  function fichaEvento(e, tipoFijo, re) {
    const nuevo = !e;
    const esCliente = !P().AGENCIA;
    const puedeEditar = edita() || (esCliente && (nuevo || (e && e.cargado_por_cliente && e.tipo === 'comercial')));
    if (!puedeEditar) {
      modal('<span class="pm-cat ev ' + esc(e.tipo) + '">' + esc(TIPO_EV[e.tipo]) + '</span><h3>' + esc(e.titulo) + '</h3>' +
        '<div class="pm-sub">' + esc(rangoEvento(e)) + '</div>' + (e.detalle ? '<p class="pm-prosa">' + prosa(e.detalle) + '</p>' : ''));
      return;
    }
    e = e || { tipo: tipoFijo || 'recurrente', titulo: '', desde: hoyISO(), hasta: '', dias_semana: [], hora: '', detalle: '', publicado: false, color: '' };
    const tipos = esCliente ? [['comercial', TIPO_EV.comercial]] : Object.keys(TIPO_EV).map(k => [k, TIPO_EV[k]]);
    modal(
      '<h3>' + (nuevo ? (esCliente ? 'Nueva actividad comercial' : 'Nuevo evento') : 'Evento') + '</h3>' +
      (esCliente ? '<p class="pm-ayuda">Lanzamientos, promos, eventos del local: lo que tengamos que acompañar con contenido. La agencia lo ve al instante.</p>' : '') +
      '<div class="pm-form">' +
        (esCliente ? '' : '<label>Tipo<select id="feTipo">' + opciones(tipos, e.tipo) + '</select></label>') +
        '<label class="' + (esCliente ? 'ancho' : '') + '">Título<input id="feTit" value="' + esc(e.titulo) + '" placeholder="' + (esCliente ? 'Ej: Promo 2x1 de primavera' : 'Ej: Pilates · Viaje Maca · Lanzamiento') + '"></label>' +
        '<label>Desde<input type="date" id="feDesde" value="' + esc(e.desde || '') + '"></label>' +
        '<label>Hasta<input type="date" id="feHasta" value="' + esc(e.hasta || '') + '"><small id="feHastaAy">Vacío = un solo día</small></label>' +
        (esCliente ? '' :
          '<label class="ancho fe-rec">Días de la semana<span class="pm-dias">' + DIAS_CORTOS.map((d, i) =>
            '<label><input type="checkbox" value="' + (i + 1) + '"' + ((e.dias_semana || []).indexOf(i + 1) !== -1 ? ' checked' : '') + '>' + d + '</label>').join('') + '</span></label>' +
          '<label class="fe-rec">Hora<input id="feHora" value="' + esc(e.hora || '') + '" placeholder="09:00"></label>' +
          '<label>Color (opcional)<input type="color" id="feColor" value="' + esc(e.color || '#d9d4e0') + '"></label>') +
        '<label class="ancho">Detalle<textarea id="feDet" rows="2">' + esc(e.detalle || '') + '</textarea></label>' +
        (esCliente ? '' : '<label class="pm-chk pub ancho"><input type="checkbox" id="fePub"' + (e.publicado ? ' checked' : '') + '> Visible para el cliente</label>') +
        (!esCliente && e.cargado_por_cliente ? '<p class="pm-ayuda ancho">Lo cargó el cliente: lo ve siempre.</p>' : '') +
      '</div>' +
      '<div class="pm-pie">' + (!nuevo ? '<button type="button" class="btn quieto" id="feBorrar">Borrar</button>' : '') +
        '<span class="pm-esp"></span><button type="button" class="btn" data-cerrar="1">Cancelar</button>' +
        '<button type="button" class="btn primario" id="feGuardar">Guardar</button></div>',
      el => {
        const sel = $('#feTipo', el);
        const ajustar = () => {
          const rec = (sel ? sel.value : 'comercial') === 'recurrente';
          $$('.fe-rec', el).forEach(x => { x.style.display = rec ? '' : 'none'; });
          $('#feHastaAy', el).textContent = rec ? 'Vacío = sin fin' : 'Vacío = un solo día';
        };
        if (sel) sel.addEventListener('change', ajustar);
        ajustar();
        $('#feGuardar', el).addEventListener('click', async () => {
          const tipo = sel ? sel.value : 'comercial';
          const fila = {
            cliente_id: P().CLIENTE.id, tipo, titulo: val('#feTit', el), detalle: val('#feDet', el) || null,
            desde: val('#feDesde', el), hasta: val('#feHasta', el) || null
          };
          if (!fila.titulo || !fila.desde) { toast('Faltan el título y la fecha', true); return; }
          if (fila.hasta && fila.hasta < fila.desde) { toast('"Hasta" es antes que "Desde"', true); return; }
          if (esCliente) { fila.cargado_por_cliente = true; }
          else {
            fila.dias_semana = tipo === 'recurrente' ? $$('.pm-dias input:checked', el).map(x => Number(x.value)) : null;
            fila.hora = tipo === 'recurrente' ? (val('#feHora', el) || null) : null;
            fila.color = $('#feColor', el).value === '#d9d4e0' ? null : $('#feColor', el).value;
            fila.publicado = chk('#fePub', el);
            if (tipo === 'recurrente' && !fila.dias_semana.length) { toast('Elegí al menos un día de la semana', true); return; }
          }
          const q = nuevo ? SB().from('cal_evento').insert(fila).select('*').single()
                          : SB().from('cal_evento').update(fila).eq('id', e.id).select('*').single();
          const { data, error } = await q;
          if (error) { toast('No se pudo guardar: ' + error.message, true); return; }
          if (nuevo) CAL.evs.push(data); else Object.assign(e, data || fila);
          cerrarModal(); toast('Guardado.'); re();
        });
        const b = $('#feBorrar', el);
        if (b) b.addEventListener('click', async () => {
          if (!confirm('¿Borrar "' + e.titulo + '"?')) return;
          const { error } = await SB().from('cal_evento').delete().eq('id', e.id);
          if (error) { toast('No se pudo borrar: ' + error.message, true); return; }
          CAL.evs = CAL.evs.filter(x => x.id !== e.id); cerrarModal(); re();
        });
      });
  }

  function rangoEvento(e) {
    if (e.tipo === 'recurrente') return 'Todos los ' + (e.dias_semana || []).map(d => DIAS_CORTOS[d - 1].toLowerCase()).join(', ') +
      (e.hora ? ' a las ' + e.hora : '') + (e.hasta ? ' · hasta el ' + fechaCorta(e.hasta) : '');
    return e.hasta && e.hasta !== e.desde ? 'Del ' + fechaCorta(e.desde) + ' al ' + fechaCorta(e.hasta) : fechaLarga(e.desde);
  }

  // ── Categorías y color (las define la agencia) ───────────────────
  function fichaCategorias(re) {
    const fila = k => '<div class="pm-catfila" data-cat="' + esc(k.id) + '">' +
      '<input type="color" value="' + esc(k.color) + '" data-campo="color">' +
      '<input value="' + esc(k.nombre) + '" data-campo="nombre">' +
      '<span class="pm-alc">' + (k.cliente_id ? 'solo este cliente' : 'todos los clientes') + '</span>' +
      '<button type="button" class="btn quieto chico" data-catdel="' + esc(k.id) + '" title="Sacar">✕</button></div>';
    modal('<h3>Categorías</h3><p class="pm-ayuda">El color de cada tarjeta del calendario. Las de "todos los clientes" son las de la agencia; también podés crear una solo para este cliente. Los cambios se guardan al salir de cada campo.</p>' +
      '<div id="catLista">' + CAL.cats.map(fila).join('') + '</div>' +
      '<div class="pm-catfila nueva"><input type="color" id="catColor" value="#bfe3d0"><input id="catNom" placeholder="Nueva categoría">' +
      '<select id="catAlc"><option value="">Todos los clientes</option><option value="c">Solo ' + esc(P().CLIENTE.nombre) + '</option></select>' +
      '<button type="button" class="btn chico primario" id="catAdd">Agregar</button></div>',
      el => {
        el.addEventListener('change', async ev => {
          const f = ev.target.closest('[data-cat]'); if (!f || !ev.target.dataset.campo) return;
          const k = CAL.cats.find(x => x.id === f.dataset.cat);
          const patch = {}; patch[ev.target.dataset.campo] = ev.target.value.trim();
          if (!patch[ev.target.dataset.campo]) return;
          const { error } = await SB().from('cal_categoria').update(patch).eq('id', k.id);
          if (error) { toast('No se pudo: ' + error.message, true); return; }
          Object.assign(k, patch); toast('Guardado.'); re();
        });
        el.addEventListener('click', async ev => {
          const d = ev.target.closest('[data-catdel]'); if (!d) return;
          const k = CAL.cats.find(x => x.id === d.dataset.catdel);
          if (!confirm('¿Sacar "' + k.nombre + '"? Los contenidos que la usan quedan sin color.')) return;
          const { error } = await SB().from('cal_categoria').update({ activo: false }).eq('id', k.id);
          if (error) { toast('No se pudo: ' + error.message, true); return; }
          CAL.cats = CAL.cats.filter(x => x.id !== k.id); d.closest('[data-cat]').remove(); re();
        });
        $('#catAdd', el).addEventListener('click', async () => {
          const nombre = val('#catNom', el); if (!nombre) return;
          const fila = { nombre, color: $('#catColor', el).value, cliente_id: val('#catAlc', el) ? P().CLIENTE.id : null, orden: Date.now() / 1000 };
          const { data, error } = await SB().from('cal_categoria').insert(fila).select('*').single();
          if (error) { toast('No se pudo: ' + error.message, true); return; }
          CAL.cats.push(data); $('#catLista', el).insertAdjacentHTML('beforeend', fila(data)); $('#catNom', el).value = ''; re();
        });
      });
  }

  // ── Bloque fijo: Drive + instrucciones ───────────────────────────
  function fichaConfig(re) {
    const c = CAL.cfg || {};
    modal('<h3>Para el cliente</h3><p class="pm-ayuda">Queda fijo al costado del calendario. Cada cosa se publica por separado.</p>' +
      '<div class="pm-form">' +
        '<label class="ancho">Link de la carpeta de Drive<input id="cfDrive" value="' + esc(c.drive_link || '') + '" placeholder="https://drive.google.com/…"></label>' +
        '<label class="ancho">Instrucciones<textarea id="cfInstr" rows="4" placeholder="Ej: subir los contenidos con 48/24 horas de anticipación">' + esc(c.instrucciones || '') + '</textarea></label>' +
        '<label class="pm-chk pub ancho"><input type="checkbox" id="cfPub"' + (c.publicado ? ' checked' : '') + '> El bloque (Drive + instrucciones) es visible para el cliente</label>' +
        '<label class="pm-chk pub ancho"><input type="checkbox" id="cfEsp"' + (c.mostrar_fechas_especiales ? ' checked' : '') + '> El cliente ve las fechas especiales de Argentina en su calendario</label>' +
      '</div><div class="pm-pie"><span class="pm-esp"></span><button type="button" class="btn" data-cerrar="1">Cancelar</button>' +
      '<button type="button" class="btn primario" id="cfGuardar">Guardar</button></div>',
      el => $('#cfGuardar', el).addEventListener('click', async () => {
        const fila = { cliente_id: P().CLIENTE.id, drive_link: val('#cfDrive', el) || null, instrucciones: val('#cfInstr', el) || null,
                       publicado: chk('#cfPub', el), mostrar_fechas_especiales: chk('#cfEsp', el), actualizado_en: new Date().toISOString() };
        const q = CAL.cfg ? SB().from('cal_config').update(fila).eq('cliente_id', fila.cliente_id)
                          : SB().from('cal_config').insert(fila);
        const { error } = await q;
        if (error) { toast('No se pudo guardar: ' + error.message, true); return; }
        CAL.cfg = Object.assign(CAL.cfg || {}, fila); cerrarModal(); toast('Guardado.'); re();
      }));
  }

  // ═════════════════════════════════════════════════════════════
  //  ESTRATEGIA
  //  Dos partes separadas: contenido orgánico y pauta. Cada parte es
  //  una lista de bloques de texto o de tabla, cada uno publicable por
  //  separado. La plantilla orgánica sigue al PDF de Don Felipe.
  // ═════════════════════════════════════════════════════════════
  const EST = { cargado: false, falta: false, bloques: [], parte: 'organico' };
  const PARTES = [['organico', 'Contenido orgánico', 'Mercado, posicionamiento y contenido'], ['pauta', 'Pauta', 'Campañas, presupuesto y públicos']];
  const tablaVacia = cols => ({ columnas: cols, filas: [cols.map(() => '')] });
  const PLANTILLA = {
    organico: [
      ['analisis_mercado', 'Análisis del mercado', 'texto'],
      ['oportunidad', 'Oportunidad', 'texto'],
      ['posicionamiento', 'Posicionamiento', 'texto'],
      ['competencia', 'Competencia', tablaVacia(['Marca', '¿Qué hace bien?', 'Ventaja frente a nosotros', 'Desventaja / oportunidad', '¿Dónde entramos?'])],
      ['para_que', '¿Para qué?', 'texto'],
      ['como', '¿Cómo?', 'texto'],
      ['objetivo_mes', 'Objetivo del mes', 'texto'],
      ['pilares', 'Pilares de contenido', tablaVacia(['Pilar', 'Qué contamos', 'Ejemplos'])],
      ['formatos', 'Formatos', tablaVacia(['Formato', 'Para qué lo usamos', 'Cuántos por mes'])],
      ['frecuencia', 'Frecuencia', 'texto'],
      ['tono', 'Tono de comunicación', 'texto']
    ],
    pauta: [
      ['objetivos_pauta', 'Objetivos de la pauta', 'texto'],
      ['presupuesto', 'Presupuesto', 'texto'],
      ['campanas', 'Campañas', tablaVacia(['Campaña', 'Objetivo', 'Presupuesto', 'Público', 'Período', 'Estado'])],
      ['publicos', 'Públicos', tablaVacia(['Público', 'Segmentación', 'Para qué campañas'])]
    ]
  };

  async function cargarEstrategia() {
    const { data, error } = await SB().from('estrategia_bloque').select('*').eq('cliente_id', P().CLIENTE.id).order('orden');
    EST.falta = esTablaFaltante(error);
    EST.bloques = data || [];
    EST.cargado = true;
  }

  function tablaHtml(t) {
    if (!t || !Array.isArray(t.columnas)) return '';
    const filas = (t.filas || []).filter(f => f.some(x => String(x || '').trim()));
    if (!filas.length) return '<p class="pm-vacio-chico">Tabla vacía.</p>';
    return '<div class="est-tabla-wrap"><table class="est-tabla"><thead><tr>' + t.columnas.map(c => '<th>' + esc(c) + '</th>').join('') +
      '</tr></thead><tbody>' + filas.map(f => '<tr>' + t.columnas.map((c, i) => '<td' + (i === 0 ? ' class="primera"' : '') + '>' + prosa(f[i] || '') + '</td>').join('') + '</tr>').join('') +
      '</tbody></table></div>';
  }

  function bloqueEstrategia(b, i, lista) {
    const vacio = b.tipo === 'texto' && !String(b.texto || '').trim();
    const clases = 'est-bloque' + (b.tipo === 'tabla' ? ' ancho' : '') + (b.clave === 'objetivo_mes' ? ' hero' : '') + (P().AGENCIA && !b.publicado ? ' oculta' : '');
    return '<section class="' + clases + '" data-bloque="' + esc(b.id) + '">' +
      '<h3>' + esc(b.titulo) + '</h3>' +
      (b.tipo === 'tabla' ? tablaHtml(b.tabla) : (vacio ? '<p class="pm-vacio-chico">Sin escribir todavía.</p>' : '<p class="pm-prosa">' + prosa(b.texto) + '</p>')) +
      (edita() ? '<div class="pm-fila-acc">' + pubBoton('estrategia_bloque', b.id, b.publicado) +
        '<button type="button" class="btn chico" data-bed="' + esc(b.id) + '">Editar</button>' +
        (i > 0 ? '<button type="button" class="btn chico quieto" data-bmov="-1" data-id="' + esc(b.id) + '" title="Subir">↑</button>' : '') +
        (i < lista.length - 1 ? '<button type="button" class="btn chico quieto" data-bmov="1" data-id="' + esc(b.id) + '" title="Bajar">↓</button>' : '') +
        '</div>' : '') +
      '</section>';
  }

  function renderEstrategia(main) {
    if (EST.falta) { main.innerHTML = cabecera('Estrategia', '', '', '') + faltaMigracion(); conectarVista(main); return; }
    const parte = EST.parte;
    const lista = EST.bloques.filter(b => b.parte === parte && veo(b));
    const todosParte = EST.bloques.filter(b => b.parte === parte);
    const acc = edita() ? '<button type="button" class="btn primario" data-badd="texto">+ Bloque de texto</button>' +
      '<button type="button" class="btn" data-badd="tabla">+ Tabla</button>' : '';
    main.innerHTML = cabecera('Estrategia', '', '', acc) +
      '<div class="solapas" role="tablist">' + PARTES.map(p =>
        '<button type="button" class="solapa' + (p[0] === parte ? ' activa' : '') + '" data-parte="' + p[0] + '">' +
        '<span class="t">' + esc(p[1]) + '</span><span class="s">' + esc(p[2]) + '</span></button>').join('') + '</div>' +
      (lista.length
        ? '<div class="est-grilla">' + lista.map(bloqueEstrategia).join('') + '</div>'
        : '<div class="vacio"><p>' + (edita()
            ? 'Todavía no hay estrategia de ' + (parte === 'pauta' ? 'pauta' : 'contenido orgánico') + ' para este cliente.'
            : 'Cuando la agencia publique esta parte de la estrategia, la vas a ver acá.') + '</p>' +
          (edita() && !todosParte.length ? '<button type="button" class="btn primario" data-plantilla="1">Empezar con la plantilla</button>' +
            '<p class="pm-ayuda" style="margin-top:10px">' + (parte === 'pauta' ? 'Objetivos, presupuesto, campañas y públicos.'
              : 'Análisis del mercado, oportunidad, posicionamiento, competencia, para qué, cómo, objetivo del mes, pilares, formatos, frecuencia y tono.') +
            ' Todo arranca oculto para el cliente.</p>' : '') + '</div>');
    conectarVista(main);
    main.addEventListener('click', async e => {
      const t = e.target, re = () => P().rerender();
      const pa = t.closest('[data-parte]'); if (pa) { EST.parte = pa.dataset.parte; re(); return; }
      if (t.closest('[data-plantilla]')) { await cargarPlantilla(parte); re(); return; }
      const ad = t.closest('[data-badd]'); if (ad) { editarBloque(null, ad.dataset.badd); return; }
      const ed = t.closest('[data-bed]'); if (ed) { editarBloque(EST.bloques.find(b => b.id === ed.dataset.bed)); return; }
      const pb = t.closest('[data-pub]'); if (pb) { await alternarPub('estrategia_bloque', EST.bloques.find(b => b.id === pb.dataset.id), null, re); return; }
      const mv = t.closest('[data-bmov]');
      if (mv) {
        const i = lista.findIndex(b => b.id === mv.dataset.id), j = i + Number(mv.dataset.bmov);
        const a = lista[i], b = lista[j]; if (!a || !b) return;
        const oa = a.orden, ob = b.orden === oa ? oa + (j > i ? 1 : -1) : b.orden;
        await Promise.all([SB().from('estrategia_bloque').update({ orden: ob }).eq('id', a.id), SB().from('estrategia_bloque').update({ orden: oa }).eq('id', b.id)]);
        a.orden = ob; b.orden = oa; EST.bloques.sort((x, y) => x.orden - y.orden); re();
      }
    });
  }

  async function cargarPlantilla(parte) {
    const base = Date.now() / 1000;
    const filas = PLANTILLA[parte].map(([clave, titulo, tipo], i) => ({
      cliente_id: P().CLIENTE.id, parte, clave, titulo, orden: base + i, publicado: false,
      tipo: tipo === 'texto' ? 'texto' : 'tabla', tabla: tipo === 'texto' ? null : tipo, texto: null
    }));
    const { data, error } = await SB().from('estrategia_bloque').insert(filas).select('*');
    if (error) { toast('No se pudo: ' + error.message, true); return; }
    EST.bloques = EST.bloques.concat(data || []).sort((x, y) => x.orden - y.orden);
    toast('Plantilla cargada. Todo está oculto hasta que lo publiques.');
  }

  // Editor de un bloque. Las tablas se editan como grilla.
  function editarBloque(b, tipoNuevo) {
    const nuevo = !b;
    b = b || { titulo: '', tipo: tipoNuevo, texto: '', tabla: tipoNuevo === 'tabla' ? tablaVacia(['Columna 1', 'Columna 2']) : null, publicado: false };
    const T = b.tipo === 'tabla' ? JSON.parse(JSON.stringify(b.tabla || tablaVacia(['Columna 1']))) : null;
    const grilla = () => '<div class="pm-tabla-ed"><table><thead><tr>' + T.columnas.map((c, i) =>
        '<th><input data-col="' + i + '" value="' + esc(c) + '">' + (T.columnas.length > 1 ? '<button type="button" class="pm-mini" data-delcol="' + i + '" title="Sacar columna">✕</button>' : '') + '</th>').join('') +
        '<th class="pm-th-acc"><button type="button" class="btn chico" data-addcol="1">+ Columna</button></th></tr></thead><tbody>' +
      T.filas.map((f, r) => '<tr>' + T.columnas.map((c, i) => '<td><textarea rows="2" data-celda="' + r + ':' + i + '">' + esc(f[i] || '') + '</textarea></td>').join('') +
        '<td class="pm-th-acc"><button type="button" class="pm-mini" data-delfila="' + r + '" title="Sacar fila">✕</button></td></tr>').join('') +
      '</tbody></table><button type="button" class="btn chico" data-addfila="1">+ Fila</button></div>';
    modal('<h3>' + (nuevo ? (b.tipo === 'tabla' ? 'Nueva tabla' : 'Nuevo bloque') : 'Editar bloque') + '</h3>' +
      '<div class="pm-form"><label class="ancho">Título<input id="ebTit" value="' + esc(b.titulo) + '" placeholder="Ej: Posicionamiento"></label>' +
      (b.tipo === 'texto' ? '<label class="ancho">Texto<textarea id="ebTxt" rows="10">' + esc(b.texto || '') + '</textarea></label>' : '<div class="ancho" id="ebGrilla">' + grilla() + '</div>') +
      '<label class="pm-chk pub ancho"><input type="checkbox" id="ebPub"' + (b.publicado ? ' checked' : '') + '> Visible para el cliente</label></div>' +
      '<div class="pm-pie">' + (!nuevo ? '<button type="button" class="btn quieto" id="ebBorrar">Borrar</button>' : '') +
      '<span class="pm-esp"></span><button type="button" class="btn" data-cerrar="1">Cancelar</button>' +
      '<button type="button" class="btn primario" id="ebGuardar">Guardar</button></div>',
      el => {
        const leer = () => {
          if (!T) return;
          $$('[data-col]', el).forEach(x => { T.columnas[Number(x.dataset.col)] = x.value; });
          $$('[data-celda]', el).forEach(x => { const [r, i] = x.dataset.celda.split(':').map(Number); T.filas[r][i] = x.value; });
        };
        if (T) $('#ebGrilla', el).addEventListener('click', ev => {
          const q = ev.target;
          let hizo = true;
          leer();
          if (q.closest('[data-addcol]')) { T.columnas.push('Nueva'); T.filas.forEach(f => f.push('')); }
          else if (q.closest('[data-addfila]')) T.filas.push(T.columnas.map(() => ''));
          else if (q.closest('[data-delcol]')) { const i = Number(q.closest('[data-delcol]').dataset.delcol); T.columnas.splice(i, 1); T.filas.forEach(f => f.splice(i, 1)); }
          else if (q.closest('[data-delfila]')) { T.filas.splice(Number(q.closest('[data-delfila]').dataset.delfila), 1); if (!T.filas.length) T.filas.push(T.columnas.map(() => '')); }
          else hizo = false;
          if (hizo) $('#ebGrilla', el).innerHTML = grilla();
        });
        $('#ebGuardar', el).addEventListener('click', async () => {
          leer();
          const fila = { titulo: val('#ebTit', el), publicado: chk('#ebPub', el), actualizado_en: new Date().toISOString() };
          if (!fila.titulo) { toast('Ponele un título', true); return; }
          if (b.tipo === 'texto') fila.texto = $('#ebTxt', el).value.trim() || null;
          else fila.tabla = { columnas: T.columnas.map(c => c.trim()), filas: T.filas };
          let r;
          if (nuevo) {
            Object.assign(fila, { cliente_id: P().CLIENTE.id, parte: EST.parte, tipo: b.tipo, orden: Date.now() / 1000 });
            r = await SB().from('estrategia_bloque').insert(fila).select('*').single();
            if (!r.error) EST.bloques.push(r.data);
          } else {
            r = await SB().from('estrategia_bloque').update(fila).eq('id', b.id);
            if (!r.error) Object.assign(b, fila);
          }
          if (r.error) { toast('No se pudo guardar: ' + r.error.message, true); return; }
          cerrarModal(); toast('Guardado.'); P().rerender();
        });
        const del = $('#ebBorrar', el);
        if (del) del.addEventListener('click', async () => {
          if (!confirm('¿Borrar el bloque "' + b.titulo + '"?')) return;
          const { error } = await SB().from('estrategia_bloque').delete().eq('id', b.id);
          if (error) { toast('No se pudo: ' + error.message, true); return; }
          EST.bloques = EST.bloques.filter(x => x.id !== b.id); cerrarModal(); P().rerender();
        });
      }, b.tipo === 'tabla');
  }

  // ═════════════════════════════════════════════════════════════
  //  SERVICIO
  //  Qué incluye, el monto pactado, el historial de ajustes y la
  //  próxima fecha. Sale de contrato / servicio_item por la RPC
  //  panel_servicio: el cliente nunca lee `contrato` directo, y lo que
  //  no está publicado ni siquiera viaja a su navegador.
  //  El monto se cambia en administración ("Ajustar"); el trigger de la
  //  51 anota cada cambio en el historial solo.
  // ═════════════════════════════════════════════════════════════
  const SRV = { cargado: false, falta: false, datos: null };
  const PARTES_SRV = [['incluye', 'Qué incluye'], ['monto', 'Monto'], ['historial', 'Historial'], ['proximo_ajuste', 'Próximo ajuste']];

  async function cargarServicio() {
    const { data, error } = await SB().rpc('panel_servicio', { p_cliente: P().CLIENTE.id });
    SRV.falta = !!error && /panel_servicio|function|does not exist|no existe/i.test(error.message || '');
    if (error && !SRV.falta) throw error;
    SRV.datos = data || { contratos: [] };
    SRV.cargado = true;
  }

  function renderServicio(main) {
    if (SRV.falta) { main.innerHTML = cabecera('Servicio', '', '', '') + faltaMigracion(); conectarVista(main); return; }
    const d = SRV.datos;
    const pub = d.publicacion || {};
    // Agencia normal: todo, con los interruptores. Agencia "como cliente"
    // y cliente: solo las partes publicadas (al cliente ya le llegan solas).
    const ve = parte => P().AGENCIA ? (edita() || !!pub[parte]) : true;
    const cts = d.contratos || [];
    const lineas = String(d.incluye_texto || '').split('\n').map(x => x.trim()).filter(Boolean);
    const inter = edita() ? '<div class="srv-pub"><span class="pm-et">Qué ve el cliente</span>' + PARTES_SRV.map(([k, n]) =>
        '<button type="button" class="pm-pub ' + (pub[k] ? 'on' : 'off') + '" data-srvpub="' + k + '">' + (pub[k] ? '● ' : '○ ') + esc(n) + '</button>').join('') +
        '</div>' : '';
    const totalMensual = cts.filter(k => k.monto != null && (k.tipo || 'mensual') === 'mensual').reduce((s, k) => s + Number(k.monto), 0);
    const algo = cts.length && (ve('incluye') || ve('monto') || ve('historial') || ve('proximo_ajuste'));

    let html = cabecera('Tu', 'servicio', '', edita() ? '<a class="btn" href="administracion.html" title="El monto y las fechas se editan en administración">Editar montos en administración ↗</a>' : '') + inter;
    if (!algo) {
      main.innerHTML = html + '<div class="vacio"><p>' + (edita()
        ? (cts.length ? '' : 'Este cliente no tiene contratos activos. Cargalos en administración.')
        : 'Cuando la agencia publique el detalle de tu servicio, lo vas a ver acá.') + '</p></div>';
      conectar(); return;
    }
    // Lo que incluye: lo escrito a mano manda; si no, los entregables del plan.
    if (ve('incluye')) {
      const items = [].concat(...cts.map(k => (k.items || []).map(i => (i.cantidad && Number(i.cantidad) !== 1 ? i.cantidad + ' × ' : '') + i.nombre + (i.unidad ? ' (' + i.unidad + ')' : ''))));
      const lista = lineas.length ? lineas : items;
      const detalles = cts.filter(k => k.detalle).map(k => '<p class="pm-ayuda"><b>' + esc(k.nombre) + ':</b> ' + esc(k.detalle) + '</p>').join('');
      html += '<section class="srv-card' + (P().AGENCIA && !pub.incluye ? ' oculta' : '') + '"><h2>Qué incluye</h2>' +
        (lista.length ? '<ul class="srv-lista">' + lista.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '<p class="pm-vacio-chico">Sin detalle cargado.</p>') +
        detalles + (edita() ? '<div class="pm-fila-acc"><button type="button" class="btn chico" data-srvinc="1">Escribir lo que incluye</button>' +
          '<span class="pm-ayuda" style="margin:0">' + (lineas.length ? 'Escrito a mano (manda sobre el plan).' : 'Sale de los entregables del plan del contrato.') + '</span></div>' : '') +
        '</section>';
    }
    html += '<div class="srv-grilla">' + cts.map(k => {
      let s = '<section class="srv-ct">' + '<div class="pm-et">' + esc(k.nombre) + (k.plan ? ' · plan ' + esc(k.plan) : '') + '</div>';
      if (ve('monto') && k.monto != null) s += '<div class="srv-monto' + (P().AGENCIA && !pub.monto ? ' oculta' : '') + '">' + esc(plata(k.monto)) +
        '<small>' + esc(k.tipo === 'cuotas' ? 'por cuota' : k.tipo === 'unico' ? 'pago único' : 'por mes') + '</small></div>';
      if (ve('proximo_ajuste')) s += '<div class="srv-prox' + (P().AGENCIA && !pub.proximo_ajuste ? ' oculta' : '') + '">Próxima actualización: <b>' +
        esc(k.proximo_ajuste ? fechaLarga(k.proximo_ajuste) : 'sin fecha') + '</b>' +
        (edita() && k.ajuste_pct ? ' <span class="pm-ayuda">(propuesta +' + esc(k.ajuste_pct) + '%)</span>' : '') + '</div>';
      if (ve('historial')) {
        const h = k.historial || [];
        s += '<div class="srv-hist' + (P().AGENCIA && !pub.historial ? ' oculta' : '') + '"><div class="pm-et">Historial de actualizaciones</div>' +
          (h.length ? '<table class="est-tabla"><thead><tr><th>Desde</th><th>Antes</th><th>Ahora</th><th>Cambio</th></tr></thead><tbody>' +
            h.map(a => '<tr><td>' + esc(fechaLarga(a.fecha)) + '</td><td>' + esc(plata(a.anterior)) + '</td><td><b>' + esc(plata(a.nuevo)) + '</b></td><td>' +
              (a.pct != null ? '+' + esc(String(a.pct).replace('.', ',')) + '%' : '—') + (a.nota ? ' <span class="pm-ayuda">' + esc(a.nota) + '</span>' : '') + '</td></tr>').join('') +
            '</tbody></table>' : '<p class="pm-vacio-chico">Sin actualizaciones registradas.</p>') +
          (edita() ? '<button type="button" class="btn chico" data-srvaj="' + esc(k.id) + '" style="margin-top:8px">+ Registrar un ajuste anterior</button>' : '') + '</div>';
      }
      return s + '</section>';
    }).join('') + '</div>';
    if (ve('monto') && cts.length > 1 && totalMensual) html += '<p class="srv-total">Total mensual: <b>' + esc(plata(totalMensual)) + '</b></p>';
    main.innerHTML = html;
    conectar();

    function conectar() {
      conectarVista(main);
      main.addEventListener('click', async e => {
        const t = e.target;
        const sp = t.closest('[data-srvpub]'); if (sp) { await guardarPubServicio({ [sp.dataset.srvpub]: !pub[sp.dataset.srvpub] }); return; }
        if (t.closest('[data-srvinc]')) { editarIncluye(); return; }
        const aj = t.closest('[data-srvaj]'); if (aj) registrarAjuste(cts.find(k => k.id === aj.dataset.srvaj));
      });
    }
  }

  async function guardarPubServicio(patch) {
    const cid = P().CLIENTE.id;
    const actual = SRV.datos.publicacion || {};
    const fila = Object.assign({ cliente_id: cid, incluye: !!actual.incluye, monto: !!actual.monto, historial: !!actual.historial,
                                 proximo_ajuste: !!actual.proximo_ajuste, incluye_texto: SRV.datos.incluye_texto || null }, patch,
                               { actualizado_en: new Date().toISOString() });
    const { data: hay } = await SB().from('servicio_publicacion').select('cliente_id').eq('cliente_id', cid).maybeSingle();
    const { error } = hay ? await SB().from('servicio_publicacion').update(fila).eq('cliente_id', cid)
                          : await SB().from('servicio_publicacion').insert(fila);
    if (error) { toast('No se pudo: ' + error.message, true); return; }
    const k = Object.keys(patch)[0];
    if (k !== 'incluye_texto') toast(patch[k] ? 'Publicado: el cliente ya lo ve.' : 'Oculto: el cliente ya no lo ve.');
    SRV.cargado = false; P().rerender();
  }

  function editarIncluye() {
    modal('<h3>Qué incluye</h3><p class="pm-ayuda">Una línea por entregable. Si lo dejás vacío, se muestran los entregables del plan del contrato.</p>' +
      '<div class="pm-form"><label class="ancho"><textarea id="siTxt" rows="9" placeholder="12 publicaciones por mes&#10;Historias 3 veces por semana&#10;Reporte mensual">' +
      esc(SRV.datos.incluye_texto || '') + '</textarea></label></div>' +
      '<div class="pm-pie"><span class="pm-esp"></span><button type="button" class="btn" data-cerrar="1">Cancelar</button><button type="button" class="btn primario" id="siOk">Guardar</button></div>',
      el => $('#siOk', el).addEventListener('click', async () => { cerrarModal(); await guardarPubServicio({ incluye_texto: $('#siTxt', el).value.trim() || null }); }));
  }

  function registrarAjuste(k) {
    modal('<h3>Registrar un ajuste anterior</h3><p class="pm-ayuda">Para los ajustes de antes de que existiera el historial. Los nuevos se anotan solos cuando cambiás el monto en administración.</p>' +
      '<div class="pm-form"><label>Desde<input type="date" id="raF"></label><label>Monto anterior<input type="number" id="raA"></label>' +
      '<label>Monto nuevo<input type="number" id="raN"></label><label>Nota (opcional)<input id="raNota"></label></div>' +
      '<div class="pm-pie"><span class="pm-esp"></span><button type="button" class="btn" data-cerrar="1">Cancelar</button><button type="button" class="btn primario" id="raOk">Guardar</button></div>',
      el => $('#raOk', el).addEventListener('click', async () => {
        const ant = Number(val('#raA', el)) || null, nue = Number(val('#raN', el));
        if (!val('#raF', el) || !nue) { toast('Faltan la fecha y el monto nuevo', true); return; }
        const { error } = await SB().from('contrato_ajuste').insert({ cliente_id: P().CLIENTE.id, contrato_id: k.id, fecha: val('#raF', el),
          monto_anterior: ant, monto_nuevo: nue, pct: ant ? Math.round((nue - ant) / ant * 1000) / 10 : null, nota: val('#raNota', el) || null });
        if (error) { toast('No se pudo: ' + error.message, true); return; }
        cerrarModal(); toast('Registrado.'); SRV.cargado = false; P().rerender();
      }));
  }

  // ═════════════════════════════════════════════════════════════
  //  Registro
  // ═════════════════════════════════════════════════════════════
  const ICO = p => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + p + '</svg>';
  const NAV = [
    ['calendario', 'Calendario', ICO('<rect x="3" y="4" width="18" height="18" rx="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line>')],
    ['estrategia', 'Estrategia', ICO('<circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="6"></circle><circle cx="12" cy="12" r="2"></circle>')],
    ['servicio', 'Servicio', ICO('<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line>')]
  ];

  const MODS = {
    calendario: { estado: CAL, cargar: cargarCalendario, render: renderCalendario },
    estrategia: { estado: EST, cargar: cargarEstrategia, render: renderEstrategia },
    servicio:   { estado: SRV, cargar: cargarServicio, render: renderServicio }
  };

  // Un solo listener para "Ver como cliente", en cualquier solapa.
  function conectarVista(main) {
    const b = $('[data-vista]', main);
    if (b) b.addEventListener('click', () => { VISTA_CLIENTE = !VISTA_CLIENTE; P().rerender(); });
  }

  async function render(seccion, main) {
    const m = MODS[seccion];
    if (!m) { main.innerHTML = P().vacio('Sección desconocida', seccion); return; }
    // El main se reemplaza para soltar los listeners del render anterior.
    const nuevo = main.cloneNode(false);
    main.parentNode.replaceChild(nuevo, main);
    main = nuevo;
    if (!m.estado.cargado) {
      main.innerHTML = '<div class="vacio"><p>Cargando…</p></div>';
      try { await m.cargar(); }
      catch (e) { main.innerHTML = P().vacio('No se pudo cargar', e.message || String(e)); return; }
    }
    m.render(main);
  }

  // Al cambiar de cliente se olvida todo.
  function reiniciar() {
    Object.keys(MODS).forEach(k => { MODS[k].estado.cargado = false; });
    CAL.desde = null; CAL.cuantos = 3; VISTA_CLIENTE = false;
    cerrarModal();
  }

  window.PanelModulos = {
    NAV, render, reiniciar,
    cargarObjetivos: async () => {},
    objetivosEnReporte: () => ''
  };
})();
