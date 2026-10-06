// ═══════════════════════════════════════════════════════════════
//  Checklist, resaltado y línea divisoria en el detalle de la tarea,
//  y plegar las subtareas de una fila de la lista.
//
//  Lo que más importa es lo mismo que con las listas anidadas: que lo
//  que se ve vuelva a guardarse igual. Si el viaje
//      texto con marcas → HTML → editor → texto con marcas
//  pierde una casilla tildada, cada vez que alguien abre la tarea se
//  le destilda sola.
//
//  Uso:  node test-checklist.js
// ═══════════════════════════════════════════════════════════════
const { chromium } = require('playwright');
const path = require('path');
const { textoDelMock } = require('./mock-supabase');
const { DATOS, SESION, YO } = require('./datos-prueba');

let fallas = 0;
function ok(nombre, cond, detalle) {
  if (cond) { console.log('  ✓ ' + nombre); return; }
  fallas++;
  console.log('  ✗ ' + nombre + (detalle ? '\n      ' + detalle : ''));
}
function igual(nombre, dio, esperado) {
  ok(nombre, dio === esperado, 'dio:      ' + JSON.stringify(dio) +
                             '\n      esperaba: ' + JSON.stringify(esperado));
}

// Los datos de siempre, más una tarea con dos subtareas: una vencida.
const datos = JSON.parse(JSON.stringify(DATOS));
const base = datos.tarea[0];
const t = (id, titulo, extra) => Object.assign({}, base, { id: id, titulo: titulo }, extra || {});
datos.tarea.push(
  t('t-madre', 'Contenido de pauta'),
  t('t-sub1', 'Guion del reel de India', { padre_id: 't-madre', vence: '2026-08-10', orden: 1 }),
  t('t-sub2', 'Copy del carrusel', { padre_id: 't-madre', orden: 2 })
);
datos.tarea_proyecto.push({ tarea_id: 't-madre', proyecto_id: 'proy-ekhos', seccion_id: 'sec-hacer', orden: 1500, principal: true });

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.clock.install({ time: new Date('2026-08-15T10:00:00') });
  await page.addInitScript(textoDelMock(datos, SESION));
  await page.route('**://cdn.jsdelivr.net/**', r => r.fulfill({ status: 200, body: '' }));
  page.on('pageerror', e => { fallas++; console.log('    [ERROR JS] ' + e.message); });
  await page.goto('file://' + path.join(__dirname, 'interno.html'));
  await page.clock.resume();
  await page.waitForTimeout(600);

  const vuelta = txt => page.evaluate(t => {
    const d = document.createElement('div');
    d.setAttribute('contenteditable', 'true');
    d.innerHTML = __panel.renderTexto(t);
    document.body.appendChild(d);
    const r = __panel.leerTexto(d);
    d.remove();
    return r;
  }, txt);
  const leer = () => page.evaluate(() => __panel.leerTexto(document.querySelector('#dDesc')));
  const guardado = id => page.evaluate(i => (__TABLAS.tarea.find(x => x.id === i) || {}).descripcion, id);
  // Pone el cursor justo después del texto que se le pasa, o al principio de él.
  const cursorEn = (texto, alPrincipio) => page.evaluate(([t, ini]) => {
    const ed = document.querySelector('#dDesc');
    const w = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      const i = n.nodeValue.indexOf(t);
      if (i === -1) continue;
      const r = document.createRange();
      r.setStart(n, ini ? i : i + t.length); r.collapse(true);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      return true;
    }
    return false;
  }, [texto, alPrincipio]);
  const seleccionar = texto => page.evaluate(t => {
    const ed = document.querySelector('#dDesc');
    const w = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      const i = n.nodeValue.indexOf(t);
      if (i === -1) continue;
      const r = document.createRange();
      r.setStart(n, i); r.setEnd(n, i + t.length);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      return true;
    }
    return false;
  }, texto);

  try {
    // ── 1. Ida y vuelta ───────────────────────────────────────
    console.log('\n1. Ida y vuelta: lo que se ve vuelve a guardarse igual');
    const casos = [
      'hay que ==mandar hoy== el presupuesto',
      '- [ ] pedir logo\n- [x] revisar copy\n  - [ ] la bajada\n- una viñeta común',
      'Ideas\n---\nGuiones',
      '- [ ] antes de la línea\n---\n- [x] después',
      '- [ ]',
      '==resaltado en dos líneas==\n==sigue acá==',
      '1. [ ] en una numerada no hay casilla'
    ];
    for (const c of casos) igual('vuelve igual · ' + c.split('\n')[0], await vuelta(c), c);

    const viejos = await page.evaluate(() =>
      __panel.renderTexto('IDEA 1\n--------------------------------------------\nIDEA 2'));
    ok('los "-------" escritos a mano se ven como línea', viejos.includes('<hr>'), viejos);
    igual('y al guardar quedan en tres guiones', await vuelta('A\n-------------\nB'), 'A\n---\nB');

    const igualdad = await page.evaluate(() => __panel.renderTexto('si a == b y b == c'));
    ok('un "a == b" suelto no se pinta', !igualdad.includes('<mark>'), igualdad);
    const url = await page.evaluate(() => __panel.renderTexto('https://x.com/p/?stkn=MWItN2Vm==&a=b==c'));
    ok('el == de adentro de un link no se pinta', !url.includes('<mark>'), url);

    // ── 2. Las previews ───────────────────────────────────────
    console.log('\n2. Las tarjetas muestran palabras, no marcas');
    igual('sin [ ], sin ==, sin ---',
      await page.evaluate(() => __panel.textoPlano('- [x] logo\n---\nmuy ==importante==')),
      'logo\n\nmuy importante');

    // ── 3. La checklist con el teclado ────────────────────────
    console.log('\n3. Armar una checklist escribiendo');
    await page.evaluate(() => __app.abrirDrawer('t-normal'));
    await page.waitForTimeout(400);
    await page.click('#dDesc');
    await page.click('#dToolsDesc [data-chk]');
    await page.keyboard.type('pedir logo');
    await page.keyboard.press('Enter');
    await page.keyboard.type('revisar copy');
    igual('Enter abre otro renglón con casilla', await leer(), '- [ ] pedir logo\n- [ ] revisar copy');

    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.type('después');
    igual('Enter en un renglón vacío sale de la checklist', await leer(),
      '- [ ] pedir logo\n- [ ] revisar copy\ndespués');

    // Partir un renglón por el medio.
    await cursorEn('pedir', false);
    await page.keyboard.press('Enter');
    igual('Enter en el medio parte el renglón en dos con casilla', await leer(),
      '- [ ] pedir\n- [ ] logo\n- [ ] revisar copy\ndespués');

    // De acá en adelante se arranca de un texto conocido.
    await page.evaluate(() => __panel.ponerTexto(document.querySelector('#dDesc'),
      '- [ ] pedir logo\n- [ ] revisar copy\ndespués'));

    console.log('\n4. Tildar');
    await page.click('#dDesc li.chk .chk-box');
    igual('click en la casilla la tilda', await leer(), '- [x] pedir logo\n- [ ] revisar copy\ndespués');
    await page.waitForTimeout(300);
    igual('y se guarda en la base', await guardado('t-normal'), '- [x] pedir logo\n- [ ] revisar copy\ndespués');
    const tachada = await page.evaluate(() => document.querySelector('#dDesc li.chk').classList.contains('hecho'));
    ok('el renglón tildado queda en gris', tachada);

    await cursorEn('revisar copy', false);
    await page.keyboard.press('Control+Enter');
    igual('⌘↵ tilda el renglón donde estás', await leer(), '- [x] pedir logo\n- [x] revisar copy\ndespués');

    await cursorEn('revisar', true);
    await page.keyboard.press('Backspace');
    igual('borrar al principio deja una viñeta común', await leer(), '- [x] pedir logo\n- revisar copy\ndespués');

    await cursorEn('revisar copy', false);
    await page.click('#dToolsDesc [data-chk]');
    igual('el botón vuelve a ponerle casilla', await leer(), '- [x] pedir logo\n- [ ] revisar copy\ndespués');
    await page.click('#dToolsDesc [data-chk]');
    igual('y la saca si ya tenía', await leer(), '- [x] pedir logo\n- revisar copy\ndespués');
    await page.click('#dToolsDesc [data-chk]');

    await cursorEn('revisar copy', false);
    await page.keyboard.press('Tab');
    igual('Tab la mete adentro sin perder la casilla', await leer(),
      '- [x] pedir logo\n  - [ ] revisar copy\ndespués');
    await page.keyboard.press('Shift+Tab');

    // ── 5. Resaltar ───────────────────────────────────────────
    console.log('\n5. Resaltar');
    await seleccionar('después');
    await page.keyboard.press('Control+Shift+H');
    igual('⌘⇧H resalta lo seleccionado', await leer(), '- [x] pedir logo\n- [ ] revisar copy\n==después==');
    const hayMark = await page.evaluate(() => !!document.querySelector('#dDesc mark') &&
      !document.querySelector('#dDesc [style*="background"]'));
    ok('queda como <mark>, sin colores pegados', hayMark, await page.evaluate(() => document.querySelector('#dDesc').innerHTML));
    await seleccionar('después');
    await page.click('#dToolsDesc [data-fmt="=="]');
    igual('el botón lo despinta', await leer(), '- [x] pedir logo\n- [ ] revisar copy\ndespués');

    await seleccionar('logo');
    await page.click('#dToolsDesc [data-fmt="=="]');
    igual('adentro de un renglón de checklist también', await leer(),
      '- [x] pedir ==logo==\n- [ ] revisar copy\ndespués');

    // ── 6. Línea divisoria ────────────────────────────────────
    console.log('\n6. Línea divisoria');
    await cursorEn('revisar copy', false);
    await page.click('#dToolsDesc [data-hr]');
    await page.keyboard.type('Guiones');
    igual('desde una lista va abajo de la lista entera', await leer(),
      '- [x] pedir ==logo==\n- [ ] revisar copy\n---\nGuiones\ndespués');

    await page.evaluate(() => __panel.ponerTexto(document.querySelector('#dDesc'), 'Ideas\nGuiones'));
    await cursorEn('Ideas', false);
    await page.click('#dToolsDesc [data-hr]');
    const conLinea = await leer();
    ok('en texto suelto queda entre los dos renglones',
      /^Ideas\n+---\n+Guiones$/.test(conLinea), JSON.stringify(conLinea));

    await page.evaluate(() => __app.cerrarDrawer());
    await page.waitForTimeout(300);

    // ── 7. Plegar las subtareas ───────────────────────────────
    console.log('\n7. Plegar una tarea con subtareas');
    const subsVistas = () => page.evaluate(() => document.querySelectorAll('#lista .fila.sub').length);
    await page.evaluate(() => { __app.FILTRO.proyecto = 'proy-ekhos'; __app.VISTA = 'lista'; __app.AGRUPAR = 'seccion'; __app.render(); });
    await page.waitForTimeout(200);
    igual('arranca desplegada', await subsVistas(), 2);
    const pill = '#lista [data-plegsub="t-madre"]';
    ok('la tarea madre tiene su botón', await page.$(pill) !== null);
    ok('las tareas sin subtareas no', (await page.$$('#lista [data-plegsub]')).length === 1);

    await page.click(pill);
    igual('al plegar se esconden', await subsVistas(), 0);
    const pillTxt = await page.textContent(pill);
    ok('y dice cuántas son', /2/.test(pillTxt), pillTxt);
    ok('en rojo, porque una está vencida',
      await page.evaluate(s => document.querySelector(s).classList.contains('alerta'), pill));
    igual('click en el botón no abre la tarea', await page.evaluate(() =>
      document.querySelector('#drawer').classList.contains('open')), false);

    // Una sección también.
    await page.click('#lista .grupo[data-grupo="sec-curso"] .grupo-head');

    await page.reload();
    await page.waitForTimeout(600);
    await page.evaluate(() => { __app.FILTRO.proyecto = 'proy-ekhos'; __app.VISTA = 'lista'; __app.AGRUPAR = 'seccion'; __app.render(); });
    await page.waitForTimeout(200);
    igual('al recargar sigue plegada', await subsVistas(), 0);
    ok('y la sección también se acuerda',
      await page.evaluate(() => document.querySelector('#lista .grupo[data-grupo="sec-curso"]').classList.contains('collapsed')));

    await page.evaluate(() => { __app.FILTRO.texto = 'guion'; __app.render(); });
    await page.waitForTimeout(200);
    ok('buscando, lo plegado no esconde el resultado',
      await page.evaluate(() => !!document.querySelector('#lista .fila[data-id="t-sub1"]')));
    await page.evaluate(() => { __app.FILTRO.texto = ''; __app.render(); });

    await page.click(pill);
    igual('y se despliega de nuevo', await subsVistas(), 2);

    await page.close();
  } finally {
    await browser.close();
  }

  console.log(fallas ? '\n' + fallas + ' cosa(s) mal.\n' : '\nTodo bien.\n');
  process.exit(fallas ? 1 : 0);
})();
