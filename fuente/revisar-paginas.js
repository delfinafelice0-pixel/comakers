// ═══════════════════════════════════════════════════════════════
//  ¿Quedó alguna página llamando a algo que no existe en ella?
//
//  Las dos páginas salen del mismo fuente, y hay bloques que van solo
//  a una. Si una función vive en el bloque de administración y el
//  panel interno la llama, el panel explota apenas se toca ese botón
//  — y el error aparece en producción, no acá.
//
//  Esto lo agarra antes: parsea el JS de cada página y compara lo que
//  se USA contra lo que está DECLARADO. Lo corre el build y, si
//  encuentra algo, el build falla.
//
//  Uso:  node revisar-paginas.js
// ═══════════════════════════════════════════════════════════════
const fs = require('fs');
const acorn = require('acorn');
const walk = require('acorn-walk');

// Lo que existe sin declararlo: el navegador y el lenguaje.
const DE_AFUERA = new Set([
  'window','document','console','location','navigator','history','screen',
  'localStorage','sessionStorage','fetch','alert','confirm','prompt',
  'setTimeout','clearTimeout','setInterval','clearInterval','requestAnimationFrame',
  'Math','JSON','Date','Number','String','Boolean','Array','Object','Promise',
  'Map','Set','WeakMap','WeakSet','RegExp','Error','TypeError','Intl','Symbol',
  'parseInt','parseFloat','isNaN','isFinite','encodeURIComponent','decodeURIComponent',
  'encodeURI','decodeURI','URL','URLSearchParams','Blob','FormData','FileReader',
  'CustomEvent','Event','Node','NodeFilter','Range','getSelection','structuredClone',
  'getComputedStyle','matchMedia','scrollTo','scrollBy','open','close','print',
  'innerWidth','innerHeight','performance','crypto','btoa','atob','queueMicrotask',
  'undefined','NaN','Infinity','globalThis','arguments','eval','supabase','Intl'
]);

function jsDe(html) {
  // Todo el JS de la página, en orden.
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m, out = [];
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

function revisar(archivo) {
  const html = fs.readFileSync(archivo, 'utf8');
  const declarados = new Set();
  const usados = new Map();       // nombre → línea de la primera vez

  jsDe(html).forEach(src => {
    let ast;
    try {
      ast = acorn.parse(src, { ecmaVersion: 2022, locations: true, allowReturnOutsideFunction: true });
    } catch (e) {
      console.log('  (un <script> no se pudo leer: ' + e.message + ')');
      return;
    }
    // Lo declarado: variables, funciones, parámetros, clases.
    walk.full(ast, n => {
      if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier') declarados.add(n.id.name);
      if ((n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' ||
           n.type === 'ArrowFunctionExpression' || n.type === 'ClassDeclaration')) {
        if (n.id && n.id.name) declarados.add(n.id.name);
        (n.params || []).forEach(p => {
          if (p.type === 'Identifier') declarados.add(p.name);
          if (p.type === 'AssignmentPattern' && p.left.type === 'Identifier') declarados.add(p.left.name);
          if (p.type === 'RestElement' && p.argument.type === 'Identifier') declarados.add(p.argument.name);
          if (p.type === 'ObjectPattern') p.properties.forEach(q => {
            if (q.value && q.value.type === 'Identifier') declarados.add(q.value.name); });
          if (p.type === 'ArrayPattern') p.elements.forEach(q => {
            if (q && q.type === 'Identifier') declarados.add(q.name); });
        });
      }
      if (n.type === 'ObjectPattern') n.properties.forEach(q => {
        if (q.value && q.value.type === 'Identifier') declarados.add(q.value.name); });
      if (n.type === 'ArrayPattern') n.elements.forEach(q => {
        if (q && q.type === 'Identifier') declarados.add(q.name); });
      if (n.type === 'CatchClause' && n.param && n.param.type === 'Identifier') declarados.add(n.param.name);
      if (n.type === 'LabeledStatement') declarados.add(n.label.name);
    });

    // Lo usado. No cuentan: las propiedades (`x.foo`), las claves de un
    // objeto (`{ foo: 1 }`) ni las etiquetas de un `break`.
    walk.ancestor(ast, {
      Identifier(n, _st, anc) {
        const p = anc[anc.length - 2];
        if (!p) return;
        if (p.type === 'MemberExpression' && p.property === n && !p.computed) return;
        if (p.type === 'Property' && p.key === n && !p.computed) return;
        if (p.type === 'MethodDefinition' && p.key === n) return;
        if (p.type === 'BreakStatement' || p.type === 'ContinueStatement') return;
        if (p.type === 'LabeledStatement' && p.label === n) return;
        if (!usados.has(n.name)) usados.set(n.name, n.loc.start.line);
      }
    });
  });

  const faltan = [...usados.keys()]
    .filter(x => !declarados.has(x) && !DE_AFUERA.has(x))
    .sort();

  if (!faltan.length) {
    console.log(`${archivo.padEnd(22)} ${declarados.size} nombres declarados · ninguno queda colgado ← bien`);
    return true;
  }
  console.log(`${archivo.padEnd(22)} ← FALTAN ${faltan.length} nombre(s):`);
  faltan.forEach(x => console.log(`      ${x} (línea ${usados.get(x)})`));
  return false;
}

const ok = ['interno.html', 'administracion.html']
  .map(revisar).every(Boolean);
process.exit(ok ? 0 : 1);
