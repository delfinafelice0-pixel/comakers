// ═══════════════════════════════════════════════════════════════
//  "Sin sección": las tareas que no cayeron en ninguna columna
//  tienen que VERSE, en el tablero y en la lista.
//
//  Antes el tablero filtraba `seccion_id === c.id` contra las
//  secciones del proyecto: una tarea con seccion_id nulo, o
//  apuntando a una sección borrada, no entraba en ninguna columna y
//  no se dibujaba en ningún lado. La lista sí la mostraba. Las dos
//  vistas se contradecían y la tarea se perdía.
//
//  Uso:  node test-sin-seccion.js
// ═══════════════════════════════════════════════════════════════
const { chromium } = require('playwright');
const path = require('path');
const { textoDelMock } = require('./mock-supabase');
const { DATOS, SESION } = require('./datos-prueba');

let fallas = 0;
function ok(nombre, cond, detalle) {
  if (cond) { console.log('  ✓ ' + nombre); return; }
  fallas++;
  console.log('  ✗ ' + nombre + (detalle ? '\n      ' + detalle : ''));
}

async function abrir(browser) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.clock.install({ time: new Date('2026-08-15T10:00:00') });
  await page.addInitScript(textoDelMock(DATOS, SESION));
  // Nada de fuentes ni de librerías: la de Supabase la pisa el mock.
  await page.route('**://fonts.googleapis.com/**', r => r.abort());
  await page.route('**://fonts.gstatic.com/**', r => r.abort());
  await page.route('**://cdn.jsdelivr.net/**', r => r.fulfill({ status: 200, body: '' }));
  page.on('console', m => { if (m.type() === 'error') console.log('    [consola] ' + m.text()); });
  page.on('pageerror', e => { fallas++; console.log('    [ERROR JS] ' + e.message); });
  await page.goto('file://' + path.join(__dirname, 'interno.html'));
  await page.clock.resume();
  await page.waitForSelector('#cargando', { state: 'hidden', timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(400);
  return page;
}

// Ir al proyecto EKHOS y a la vista de tablero.
async function irAlTablero(page) {
  await page.evaluate(() => {
    __app.FILTRO.proyecto = 'proy-ekhos';
    __app.VISTA = 'tablero';
    __app.render();
  });
  await page.waitForTimeout(150);
}
async function irALaLista(page) {
  await page.evaluate(() => {
    __app.FILTRO.proyecto = 'proy-ekhos';
    __app.VISTA = 'lista';
    __app.AGRUPAR = 'seccion';
    __app.render();
  });
  await page.waitForTimeout(150);
}

(async () => {
  const browser = await chromium.launch();
  try {
    const page = await abrir(browser);

    // ── 1. El tablero del proyecto ────────────────────────────
    console.log('\n1. Tablero adentro del proyecto');
    await irAlTablero(page);

    const cols = await page.$$eval('#kanban .columna', els =>
      els.map(e => ({ id: e.dataset.col, titulo: e.querySelector('.columna-titulo').textContent.trim() })));
    ok('hay una columna "Sin sección"', cols.some(c => c.id === '__sinsec'),
       'columnas: ' + JSON.stringify(cols.map(c => c.id)));
    ok('va última, después de las de verdad',
       cols.length && cols[cols.length - 1].id === '__sinsec',
       'última: ' + (cols.length ? cols[cols.length - 1].id : '(ninguna)'));

    const enSinSec = await page.$$eval('#kanban .columna[data-col="__sinsec"] .card-k',
      els => els.map(e => e.dataset.id));
    ok('la tarea sin sección está ahí', enSinSec.includes('t-huerfana'),
       'adentro: ' + JSON.stringify(enSinSec));
    ok('la que apunta a una sección borrada también', enSinSec.includes('t-colgada'),
       'adentro: ' + JSON.stringify(enSinSec));

    // Lo importante de verdad: NINGUNA tarea del proyecto queda sin dibujar.
    const enTablero = await page.$$eval('#kanban .card-k', els => els.map(e => e.dataset.id));
    ['t-normal', 't-curso', 't-huerfana', 't-colgada'].forEach(id =>
      ok('se ve ' + id + ' en el tablero', enTablero.includes(id),
         'en pantalla: ' + JSON.stringify(enTablero)));
    ok('no se cuela una tarea de otro proyecto', !enTablero.includes('t-vt'));

    // La columna no tiene botón de "nueva tarea acá" ni de borrar.
    const botones = await page.$$eval('#kanban .columna[data-col="__sinsec"] .col-add', e => e.length);
    ok('no tiene botones de sección (ni + ni borrar)', botones === 0, 'encontró ' + botones);

    // ── 2. La lista dice lo mismo que el tablero ──────────────
    console.log('\n2. La lista dice lo mismo');
    await irALaLista(page);
    const enLista = await page.$$eval('#lista .grupo[data-grupo="__sinsec"] .fila',
      els => els.map(e => e.dataset.id));
    ok('la lista también junta las dos',
       enLista.includes('t-huerfana') && enLista.includes('t-colgada'),
       'adentro: ' + JSON.stringify(enLista));

    const arrastrable = await page.$$eval('#lista .grupo[data-grupo="__sinsec"] .fila-mano', e => e.length);
    ok('se pueden arrastrar para sacarlas de ahí', arrastrable >= 2, 'manijas: ' + arrastrable);

    // ── 3. Sacar una de "Sin sección" la arregla de verdad ─────
    console.log('\n3. Mover una a una sección de verdad');
    await irAlTablero(page);
    await page.evaluate(async () => {
      const body = document.querySelector('#kanban .columna[data-col="sec-hacer"] .columna-body');
      await __app.soltar('t-huerfana', 'sec-hacer', 'pendiente', body, 0);
    });
    await page.waitForTimeout(200);

    const guardado = await page.evaluate(() =>
      window.__TABLAS.tarea_proyecto.find(x => x.tarea_id === 't-huerfana').seccion_id);
    ok('quedó guardada en la sección', guardado === 'sec-hacer', 'guardó: ' + guardado);
    const ahora = await page.$$eval('#kanban .columna[data-col="sec-hacer"] .card-k', els => els.map(e => e.dataset.id));
    ok('y se ve en la columna nueva', ahora.includes('t-huerfana'), JSON.stringify(ahora));

    // ── 4. Volver a soltarla en "Sin sección" guarda NULL ──────
    console.log('\n4. Soltarla de nuevo en "Sin sección"');
    await page.evaluate(async () => {
      const body = document.querySelector('#kanban .columna[data-col="__sinsec"] .columna-body');
      await __app.soltar('t-huerfana', '__sinsec', 'pendiente', body, 0);
    });
    await page.waitForTimeout(200);
    const vuelta = await page.evaluate(() =>
      window.__TABLAS.tarea_proyecto.find(x => x.tarea_id === 't-huerfana').seccion_id);
    ok('guarda null, no el id inventado de la columna', vuelta === null, 'guardó: ' + JSON.stringify(vuelta));

    // ── 5. Sin huérfanas, la columna no aparece ────────────────
    console.log('\n5. Si no hay huérfanas, la columna no está');
    await page.evaluate(async () => {
      for (const id of ['t-huerfana', 't-colgada']) {
        const body = document.querySelector('#kanban .columna[data-col="sec-hacer"] .columna-body');
        await __app.soltar(id, 'sec-hacer', 'pendiente', body, 0);
      }
    });
    await page.waitForTimeout(250);
    const quedan = await page.$$eval('#kanban .columna', els => els.map(e => e.dataset.col));
    ok('la columna desaparece sola', !quedan.includes('__sinsec'), JSON.stringify(quedan));

    // ── 6. Agrupando, cada "sin nada" tiene su grupo ───────────
    console.log('\n6. Los grupos de "sin nada" al agrupar');
    const grupos = await page.evaluate(async (nada) => {
      const out = {};
      __app.FILTRO.proyecto = '';
      __app.VISTA = 'lista';
      for (const modo of ['responsable', 'cliente', 'proyecto']) {
        __app.AGRUPAR = modo;
        __app.render();
        out[modo] = Array.from(document.querySelectorAll('#lista .grupo'))
          .map(e => ({ k: e.dataset.grupo, label: e.querySelector('.grupo-title').textContent.trim() }));
      }
      return out;
    });
    ok('por responsable hay "Sin responsable"',
       grupos.responsable.some(g => g.k === '__sin'), JSON.stringify(grupos.responsable));
    ok('por proyecto hay "Sin proyecto"',
       grupos.proyecto.some(g => g.k === '__sinproy'), JSON.stringify(grupos.proyecto));
    ok('por cliente hay un grupo para las que no tienen',
       grupos.cliente.some(g => g.k === '__interno'), JSON.stringify(grupos.cliente));
    ['responsable', 'cliente', 'proyecto'].forEach(m => {
      const g = grupos[m];
      ok('agrupando por ' + m + ', el "sin" va último',
         !g.length || String(g[g.length - 1].k).startsWith('__'),
         'último: ' + (g.length ? g[g.length - 1].k : '(ninguno)'));
    });

    // La tarea que está en el proyecto de EKHOS pero sin cliente_id
    // propio tiene que agrupar bajo EKHOS, no bajo "Interno".
    const dondeCae = await page.evaluate(() => {
      __app.AGRUPAR = 'cliente'; __app.render();
      const fila = document.querySelector('#lista .fila[data-id="t-normal"]');
      const grupo = fila ? fila.closest('.grupo') : null;
      return grupo ? grupo.querySelector('.grupo-title').textContent.trim() : '(no está)';
    });
    ok('una tarea del proyecto de EKHOS agrupa en EKHOS, no en "Interno"',
       dondeCae === 'EKHOS', 'cayó en: ' + dondeCae);

    await page.close();
  } finally {
    await browser.close();
  }

  console.log(fallas ? '\n' + fallas + ' cosa(s) mal.\n' : '\nTodo bien.\n');
  process.exit(fallas ? 1 : 0);
})();
