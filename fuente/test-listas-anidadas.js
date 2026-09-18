// ═══════════════════════════════════════════════════════════════
//  Listas anidadas: Tab corre la viñeta a la derecha.
//
//  Lo que importa de verdad no es que Tab "haga algo": es que lo que
//  se ve vuelva a guardarse igual. El texto viaja
//      markdown-lite → HTML → editor → markdown-lite
//  y si ese viaje de ida y vuelta pierde un nivel, cada vez que
//  abrís y cerrás la tarea la lista se va aplanando sola.
//
//  Uso:  node test-listas-anidadas.js
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
function igual(nombre, dio, esperado) {
  ok(nombre, dio === esperado, 'dio:      ' + JSON.stringify(dio) +
                             '\n      esperaba: ' + JSON.stringify(esperado));
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.clock.install({ time: new Date('2026-08-15T10:00:00') });
  await page.addInitScript(textoDelMock(DATOS, SESION));
  await page.route('**://cdn.jsdelivr.net/**', r => r.fulfill({ status: 200, body: '' }));
  page.on('pageerror', e => { fallas++; console.log('    [ERROR JS] ' + e.message); });
  await page.goto('file://' + path.join(__dirname, 'interno.html'));
  await page.clock.resume();
  await page.waitForTimeout(600);

  try {
    // ── 1. El texto se dibuja anidado ─────────────────────────
    console.log('\n1. De markdown a HTML');
    const html = await page.evaluate(() => __panel.renderTexto(
      '- Actividades\n  - Gastronomía\n    - Conocé Tandil\n- Contacto'));
    igual('anida dos niveles adentro del <li> que corresponde', html,
      '<ul><li>Actividades<ul><li>Gastronomía<ul><li>Conocé Tandil</li></ul></li></ul></li>' +
      '<li>Contacto</li></ul>');

    const mixto = await page.evaluate(() => __panel.renderTexto('1. uno\n  - sub\n2. dos'));
    igual('numerada con viñetas adentro', mixto,
      '<ol><li>uno<ul><li>sub</li></ul></li><li>dos</li></ol>');

    // ── 2. Nada se cuelga con sangrías raras ──────────────────
    console.log('\n2. Sangrías rotas (lo que pasa cuando alguien pega de otro lado)');
    const salto = await page.evaluate(() => __panel.renderTexto('- uno\n      - se fue al fondo'));
    ok('un salto de tres niveles de una no cuelga el navegador',
       salto === '<ul><li>uno<ul><li>se fue al fondo</li></ul></li></ul>', salto);

    const arranca = await page.evaluate(() => __panel.renderTexto('    - arranca sangrada'));
    ok('una lista que arranca sangrada tampoco', arranca === '<ul><li>arranca sangrada</li></ul>', arranca);

    // ── 3. El viaje de ida y vuelta ───────────────────────────
    console.log('\n3. Ida y vuelta: lo que se ve vuelve a guardarse igual');
    const casos = [
      '- Actividades\n  - Gastronomía\n    - Conocé Tandil\n- Contacto',
      '1. uno\n  - sub\n  - otra sub\n2. dos',
      '- suelto\n\ntexto en el medio\n\n- otra lista\n  - adentro'
    ];
    for (const txt of casos) {
      const vuelta = await page.evaluate(t => {
        const d = document.createElement('div');
        d.setAttribute('contenteditable', 'true');
        d.innerHTML = __panel.renderTexto(t);
        document.body.appendChild(d);
        const r = __panel.leerTexto(d);
        d.remove();
        return r;
      }, txt);
      igual('vuelve igual · ' + txt.split('\n')[0] + '…', vuelta, txt);
    }

    // ── 4. Tab de verdad, tecleando ───────────────────────────
    console.log('\n4. La tecla Tab en el detalle de una tarea');
    await page.evaluate(() => __app.abrirDrawer(__app.TAREAS[0].id));
    await page.waitForTimeout(300);

    // Arranca de una lista plana y se para el cursor en un renglón.
    // Tipear las tres líneas con el teclado virtual metía fallas del
    // test y no del panel; lo que se prueba acá es la TECLA.
    const parar = n => page.evaluate(i => {
      const d = document.querySelector('#dDesc');
      const li = d.querySelectorAll('li')[i];
      const r = document.createRange();
      r.selectNodeContents(li); r.collapse(false);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      d.focus();
    }, n);
    const texto = () => page.evaluate(() => __panel.leerTexto(document.querySelector('#dDesc')));

    await page.evaluate(() => {
      document.querySelector('#dDesc').innerHTML =
        __panel.renderTexto('- Actividades\n- Gastronomía\n- Conocé Tandil');
    });

    await parar(1);
    await page.keyboard.press('Tab');
    igual('Tab corre la viñeta un nivel', await texto(),
      '- Actividades\n  - Gastronomía\n- Conocé Tandil');

    await parar(2);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    igual('dos Tabs, dos niveles', await texto(),
      '- Actividades\n  - Gastronomía\n    - Conocé Tandil');

    await page.keyboard.down('Shift');
    await page.keyboard.press('Tab');
    await page.keyboard.up('Shift');
    igual('y Shift+Tab la trae de vuelta', await texto(),
      '- Actividades\n  - Gastronomía\n  - Conocé Tandil');

    // ── 5. Fuera de una lista, Tab no se roba ─────────────────
    console.log('\n5. Fuera de una lista el Tab sigue siendo el de siempre');
    const robado = await page.evaluate(async () => {
      const d = document.querySelector('#dDesc');
      d.innerHTML = 'texto suelto sin viñetas';
      const r = document.createRange();
      r.selectNodeContents(d); r.collapse(false);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      d.focus();
      let prevenido = false;
      const espia = e => { if (e.key === 'Tab') prevenido = e.defaultPrevented; };
      d.addEventListener('keydown', espia);
      d.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
      d.removeEventListener('keydown', espia);
      return prevenido;
    });
    ok('no le hace preventDefault: se puede salir del campo con teclado', robado === false);

    await page.close();
  } finally {
    await browser.close();
  }

  console.log(fallas ? '\n' + fallas + ' cosa(s) mal.\n' : '\nTodo bien.\n');
  process.exit(fallas ? 1 : 0);
})();
