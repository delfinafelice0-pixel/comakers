// ═══════════════════════════════════════════════════════════════
//  editor-texto.js · GENERADO (v11/10 19:12) por fuente/build.py desde
//  fuente/interno.src.html (bloque @@EDITOR). NO editar a mano: los
//  cambios van allá y se regenera con el build.
//
//  Es el MISMO editor con formato de /interno (negrita, cursiva,
//  subrayado, tachado, resaltado, listas, checklist, links, títulos),
//  para la ficha de contenido del Calendario del panel del cliente.
//  En la base nunca se guarda HTML: se guarda texto con marcas
//  (**negrita**, [texto](url)…) y el HTML lo arma renderTexto, que
//  escapa todo primero. Se expone en window.EditorTexto.
// ═══════════════════════════════════════════════════════════════
(function () {
  'use strict';
  // Lo que el editor toma prestado de /interno, en versión panel.
  const $ = s => document.querySelector(s);
  const $si = s => document.querySelector(s);
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }
  function autoGrow(el) { if (!el) return; el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }

  // ── De acá hasta @@FINEDITOR, build.py lo copia además a
  //    editor-texto.js, que usa el panel del cliente (la ficha de
  //    contenido del Calendario). UNA sola fuente: lo que se arregle acá
  //    se arregla en los dos. Los bloques @@INTERNO/@@ADMIN de adentro no
  //    van a esa copia.
  // ═══════════════ TEXTO CON FORMATO ═══════════════
  // Guardamos markdown mínimo en texto plano: [palabra](url).
  // Nunca guardamos HTML escrito por el usuario: escapamos TODO
  // primero y recién después convertimos lo que reconocemos nosotros.
  // Así el panel del cliente puede mostrar el mismo texto sin riesgo.
  //
  //  Ojo con el texto de adentro de los corchetes: los títulos de acá
  //  empiezan casi siempre con el cliente entre corchetes —"[Comakers]
  //  Contenido de - Pelis"—, así que el texto de un link LLEVA `]`.
  //  Con el `[^\]]` de antes el link no se reconocía y se veía crudo.
  //  Lo que sí se prohíbe es un `](` adentro (ahí arranca la URL) y un
  //  corchete suelto sin cerrar: así "mirá [nota] y [esto](http://…)"
  //  sigue agarrando solo el segundo y no se come media oración.
  const TXT_LINK = '(?:[^\\[\\]\\n]|\\[[^\\[\\]\\n]*\\])+';
  const RE_LINK = new RegExp('\\[(' + TXT_LINK + ')\\]\\((https?:\\/\\/[^\\s)]+)\\)', 'g');

  // Un link envuelto en otro link: se queda el de adentro.
  //
  //  De dónde salía el bicho: pegabas el link de una tarea, se veía
  //  como pastilla, y al guardar la pastilla volvía a texto como
  //  `[título](url)`. Pero ese texto no se reconocía (por el `]` del
  //  cliente), así que al abrir de nuevo solo se dibujaba la URL de
  //  adentro y el `[título](` quedaba de adorno… y al guardar se
  //  envolvía otra vez. Cada vuelta sumaba una capa:
  //    [T]([T]([T]([T](url))))
  //  Esto desarma lo que ya quedó escrito así, sin tocar la base: se
  //  endereza al mostrarlo y se guarda derecho la próxima vez.
  const RE_ENVOLTORIO = new RegExp(
    '\\[' + TXT_LINK + '\\]\\(\\s*(\\[' + TXT_LINK + '\\]\\(https?:\\/\\/[^\\s)]+\\))\\s*\\)', 'g');
  function enderezarLinks(txt) {
    let s = String(txt == null ? '' : txt);
    if (s.indexOf('](') === -1) return s;   // el 99% de los textos, sin gastar nada
    for (let i = 0; i < 20; i++) {
      const antes = s;
      s = s.replace(RE_ENVOLTORIO, '$1');
      if (s === antes) break;
    }
    return s;
  }
  // Las menciones se guardan como @[Nombre](uuid): sobreviven a que la
  // persona se cambie el nombre y no hay que adivinar quién es "@marti".
  // El id no se limita a la forma de un uuid a propósito: si algún día
  // cambia, las menciones ya escritas se tienen que seguir viendo bien.
  // Lo que sí excluimos es un http(s), para no comerse un link.
  const RE_MENCION = /@\[([^\]\n]*)\]\((?!https?:)([^\s)]{1,64})\)/g;

  // Marcas de formato. Son las de siempre (markdown) salvo el subrayado:
  // markdown no tiene, así que usamos __texto__ (que en markdown sería
  // negrita, pero acá la negrita es ** y no se pisan).
  // Ojo con el `[\s\S]+?`: las marcas SÍ pueden cruzar renglones. Lo
  // aprendí a los golpes — el `envolver()` viejo, al marcar una línea
  // entera con su Enter incluido, dejaba el cierre en el renglón de
  // abajo y el texto se veía con los asteriscos crudos. Eso lo arreglé,
  // pero quedó todo lo ya escrito. En vez de pedir que se remarque a
  // mano, es el que MUESTRA el que tiene que ser tolerante: si la marca
  // abarca varias líneas, se aplica a cada una por separado.
  // La bastardilla queda de una sola línea a propósito: el asterisco
  // suelto aparece escrito de verdad mucho más seguido que `**` o `~~`.
  const FORMATO = [
    { re: /\*\*([\s\S]+?)\*\*/g,  a: '<strong>', z: '</strong>' },
    { re: /__([\s\S]+?)__/g,      a: '<u>',      z: '</u>' },
    { re: /~~([\s\S]+?)~~/g,      a: '<s>',      z: '</s>' },
    // El resaltador. Pide algo pegado a los `==` de los dos lados: así
    // un "a == b" escrito en el medio de una frase no se pinta solo.
    // (Los links ya están guardados aparte, así que el `==` de un
    // base64 en una URL tampoco lo toca.)
    { re: /==(?=\S)([\s\S]*?\S)==/g, a: '<mark>', z: '</mark>' },
    { re: /(^|[^*])\*([^\n*]+)\*(?!\*)/g, a: '<em>', z: '</em>', pre: true }
  ];

  // Aplica una marca respetando los renglones: cada línea se envuelve
  // sola, y las vacías quedan vacías.
  function marcarPorLinea(txt, a, z) {
    if (txt.indexOf('\n') === -1) return a + txt + z;
    return txt.split('\n').map(function (l) {
      if (!l.trim()) return l;
      const ini = l.length - l.replace(/^\s+/, '').length;
      const fin = l.length - l.replace(/\s+$/, '').length;
      return l.slice(0, ini) + a + l.slice(ini, l.length - fin) + z + l.slice(l.length - fin);
    }).join('\n');
  }

  // Un link a una tarea de este mismo panel se muestra como una
  // pastilla con el título, no como un URL kilométrico. Y al tocarla
  // abre la tarea al costado en vez de recargar la página.
  const RE_TLINK = /#t\/([A-Za-z0-9-]{6,})$/;
  function idDeLink(url) {
    const m = String(url || '').match(RE_TLINK);
    if (!m) return null;
    // Solo si el link es a ESTE panel. Uno a otro dominio se abre normal.
    const limpio = String(url).replace(RE_TLINK, '');
    if (limpio && limpio.indexOf('://') !== -1 &&
        limpio.indexOf(location.host) === -1) return null;
    return m[1];
  }
  function linkDeTarea(id) {
    return location.origin + location.pathname + '#t/' + id;
  }
  function chipTarea(id, texto) {
    const t = (typeof TAREAS !== 'undefined') ? TAREAS.find(x => x.id === id) : null;
    // Ojo: `texto` ya viene escapado (renderTexto escapa todo primero).
    // El título lo sacamos crudo del modelo, así que ese sí hay que escaparlo.
    const nom = (texto === null || texto === undefined)
      ? esc(t ? textoPlano(t.titulo) : 'tarea') : texto;
    const hecha = t && t.completada;
    return '<a class="tarea-link' + (hecha ? ' hecha' : '') + '" href="#t/' + id + '"' +
      ' data-tlink="' + id + '" title="' + (t ? esc(textoPlano(t.titulo)) : 'Abrir la tarea') + '">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 20 6"></polyline><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9"></path></svg>' +
      nom + '</a>';
  }

  // Dibuja una lista y todo lo que le cuelga. Recursiva a propósito:
  // anidar con un solo `for` y una pila de etiquetas abiertas termina
  // siempre en <ul> mal cerrados, y un <ul> mal cerrado se come el
  // resto del texto.
  //
  //  La sublista va ADENTRO del <li> del que cuelga, no al lado: así
  //  el HTML es válido y la sangría la hace el navegador sola.
  function listaHTML(items, i, nivel) {
    const tipo = items[i].tipo;
    let html = '<' + tipo + '>';
    while (i < items.length && items[i].nivel === nivel && items[i].tipo === tipo) {
      html += abrirLi(items[i]);
      i++;
      // Lo que venga más adentro cuelga de este renglón.
      while (i < items.length && items[i].nivel > nivel) {
        const r = listaHTML(items, i, items[i].nivel);
        html += r.html;
        if (r.i === i) break;
        i = r.i;
      }
      html += '</li>';
    }
    return { html: html + '</' + tipo + '>', i: i };
  }

  // Un renglón de checklist es una viñeta que arranca con `[ ]` o `[x]`.
  // La casilla es `contenteditable=false`: adentro del editor se clickea
  // pero no se puede escribir encima ni borrarla letra por letra.
  const RE_CHK = /^\[([ xX])\](?:[ \t]+|$)/;
  function cajaChk(hecha) {
    return '<span class="chk-box' + (hecha ? ' on' : '') + '" contenteditable="false"' +
      ' role="checkbox" aria-checked="' + (hecha ? 'true' : 'false') + '"></span>';
  }
  function abrirLi(it) {
    if (it.chk == null) return '<li>' + it.texto;
    return '<li class="chk' + (it.chk ? ' hecho' : '') + '">' + cajaChk(it.chk) + it.texto;
  }

  function renderTexto(txt) {
    if (!txt) return '';
    let h = esc(enderezarLinks(String(txt).replace(/\u0000/g, '')));

    // Guardamos menciones y links aparte antes de tocar el formato: si no,
    // una URL con __ adentro rompería su propio atributo href.
    const piezas = [];
    const guardar = html => '\u0000' + (piezas.push(html) - 1) + '\u0000';

    // El `data-mid` no es decorativo: es lo que le permite al editor
    // volver de la pastilla al texto `@[Nombre](id)` cuando guarda.
    h = h.replace(RE_MENCION, (m, nombre, id) =>
      guardar('<span class="mencion" data-mid="' + id + '" contenteditable="false">@' + nombre + '</span>'));
    h = h.replace(RE_LINK, (m, texto, url) => {
      const t = idDeLink(url);
      return guardar(t ? chipTarea(t, texto)
        : '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + texto + '</a>');
    });
    h = h.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (m, pre, url) => {
      const t = idDeLink(url);
      return pre + guardar(t ? chipTarea(t, null)
        : '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + url + '</a>');
    });
    // Y el link cortito, por si alguien copia solo el pedacito de atrás.
    h = h.replace(/(^|\s)#t\/([A-Za-z0-9-]{6,})/g, (m, pre, id) => pre + guardar(chipTarea(id, null)));

    FORMATO.forEach(f => {
      h = f.pre
        ? h.replace(f.re, (m, antes, dentro) => antes + f.a + dentro + f.z)
        : h.replace(f.re, (m, dentro) =>
            dentro.trim() ? marcarPorLinea(dentro, f.a, f.z) : m);
    });

    // Listas: líneas que arrancan con "- " o "1. ". La sangría de
    // adelante —dos espacios por nivel— es lo que las anida.
    const lineas = h.split('\n');
    let salida = '', pend = [], nivAnt = -1;

    // Vuelca lo que se venía juntando y arranca de cero.
    const cerrar = () => {
      if (!pend.length) return;
      let j = 0;
      while (j < pend.length) {
        const r = listaHTML(pend, j, pend[j].nivel);
        salida += r.html;
        if (r.i === j) break;          // red de seguridad: nunca en bucle
        j = r.i;
      }
      pend = []; nivAnt = -1;
    };

    // Tablas: renglones seguidos que empiezan y terminan con "|". El
    // segundo, si es "| --- | --- |", dice que el primero es encabezado.
    // Un "|" dentro de una celda se guarda escapado: "\|".
    let filasTabla = [];
    const volcarTabla = () => {
      if (!filasTabla.length) return;
      salida += tablaHTML(filasTabla);
      filasTabla = [];
    };

    lineas.forEach((l, i) => {
      if (RE_FILA_TABLA.test(l)) { cerrar(); filasTabla.push(l); return; }
      volcarTabla();
      const m = l.match(/^([ \t]*)([-•]|\d+[.)])[ \t]+(.*)$/);
      if (m) {
        const ancho = m[1].replace(/\t/g, '  ').length;
        // Saltar dos niveles de una no existe: se pega al anterior.
        // Si no, el árbol queda con agujeros y el dibujo se cuelga.
        const nivel = Math.min(Math.floor(ancho / 2), nivAnt + 1);
        nivAnt = nivel;
        const tipo = (m[2] === '-' || m[2] === '•') ? 'ul' : 'ol';
        // La casilla solo va en viñetas: "1. [ ]" se deja como texto.
        const c = tipo === 'ul' ? m[3].match(RE_CHK) : null;
        pend.push({ nivel: nivel, tipo: tipo,
                    texto: c ? m[3].slice(c[0].length) : m[3],
                    chk: c ? (c[1] !== ' ' ? 1 : 0) : null });
      } else if (/^#{1,2}[ \t]+\S/.test(l)) {
        // Un título: "# Grande" o "## Chico". Va como bloque propio, sin
        // <br> atrás (el título ya ocupa su renglón).
        cerrar();
        const nivelT = l.match(/^#+/)[0].length;
        salida += (nivelT === 1 ? '<h3>' : '<h4>') + l.replace(/^#{1,2}[ \t]+/, '') + (nivelT === 1 ? '</h3>' : '</h4>');
      } else if (/^[ \t]*-{3,}[ \t]*$/.test(l)) {
        // Un renglón de puros guiones es una línea divisoria. Los
        // "-------" que ya venían escritos a mano se ven como línea
        // sin tocar nada.
        cerrar();
        salida += '<hr>';
      } else {
        cerrar();
        salida += l + (i < lineas.length - 1 ? '<br>' : '');
      }
    });
    volcarTabla();
    cerrar();

    return salida.replace(/\u0000(\d+)\u0000/g, (m, i) => piezas[+i]);
  }

  // ── Tablas ───────────────────────────────────────────────────
  //  Se guardan como en markdown, en texto:
  //    | Columna 1 | Columna 2 |
  //    | --- | --- |
  //    | celda | celda |
  //  El HTML lo arma tablaHTML (las celdas ya vienen escapadas y con su
  //  formato, igual que cualquier renglón). Las celdas vacías llevan un
  //  <br> para que en el editor se puedan clickear.
  const RE_FILA_TABLA = /^[ \t]*\|.*\|[ \t]*$/;
  const RE_SEP_TABLA = /^[ \t]*\|([ \t]*:?-{3,}:?[ \t]*\|)+[ \t]*$/;
  function celdasDe(l) {
    return l.trim().replace(/^\|/, '').replace(/\|$/, '')
      .split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'));
  }
  function tablaHTML(filas) {
    let cab = null, cuerpo = filas;
    if (filas.length > 1 && RE_SEP_TABLA.test(filas[1])) { cab = celdasDe(filas[0]); cuerpo = filas.slice(2); }
    cuerpo = cuerpo.filter(f => !RE_SEP_TABLA.test(f)).map(celdasDe);
    const n = Math.max(cab ? cab.length : 0, ...cuerpo.map(f => f.length), 1);
    const celda = (tag, c) => '<' + tag + '>' + (c || '<br>') + '</' + tag + '>';
    const fila = (tag, f) => '<tr>' + Array.from({ length: n }, (_, k) => celda(tag, f[k])).join('') + '</tr>';
    return '<table class="tabla-txt">' + (cab ? '<thead>' + fila('th', cab) + '</thead>' : '') +
      '<tbody>' + cuerpo.map(f => fila('td', f)).join('') + '</tbody></table>';
  }

  // Para previews de una línea: se ve la palabra, no el markdown.
  function textoPlano(txt) {
    return enderezarLinks(txt || '')
      .replace(RE_MENCION, '@$1')
      .replace(RE_LINK, '$1')
      .replace(/\*\*([\s\S]+?)\*\*/g, '$1')
      .replace(/__([\s\S]+?)__/g, '$1')
      .replace(/~~([\s\S]+?)~~/g, '$1')
      .replace(/==(?=\S)([\s\S]*?\S)==/g, '$1')
      .replace(/(^|[^*])\*([^\n*]+)\*(?!\*)/g, '$1$2')
      .replace(/^[ \t]*-{3,}[ \t]*$/gm, '')
      .replace(/^#{1,2}[ \t]+/gm, '')
      .replace(/^\s*[-•]\s+\[[ xX]\](?:[ \t]+|$)/gm, '')
      .replace(/^\s*[-•]\s+/gm, '')
      .replace(/^\s*\d+[.)]\s+/gm, '');
  }

  // Preview de una línea, para tarjetas y filas. Además del markdown, saca
  // las URLs sueltas: una tarjeta cuya descripción era
  // "https://drive.google.com/drive/folders/1ztjANFO…?usp=share_link"
  // gastaba dos renglones para no decir nada. El link igual se cuenta
  // aparte, con el 🔗 de abajo.
  function resumenTexto(txt) {
    return textoPlano(txt)
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      // Si el texto era "mirá acá: <link>", al sacar el link quedaba
      // colgando el dos puntos. Se limpia lo que quedó apuntando a nada.
      .replace(/[\s:;,\-–—·]+$/, '');
  }

  // ═══════════════ EL EDITOR CON FORMATO ═══════════════
  //
  //  Hasta ahora, para poner algo en negrita había que escribir **así**
  //  y los asteriscos se veían mientras escribías. Esto los saca: ves
  //  la negrita, como en Asana.
  //
  //  ── LA REGLA QUE NO SE TOCA ──────────────────────────────────
  //  En la base NUNCA se guarda el HTML que escribió una persona. Se
  //  guarda el mismo texto plano con marcas de siempre —`**negrita**`,
  //  `@[Nombre](id)`, `[texto](url)`— y el HTML lo arma `renderTexto`,
  //  que es nuestro y solo sabe hacer siete etiquetas.
  //
  //  Guardar HTML de una usuaria sería abrir la puerta a que alguien
  //  escriba un <script> en una descripción y se lo ejecute a las
  //  demás. Como el que edita es un contenteditable, hay dos lugares
  //  por donde podría colarse HTML ajeno, y los dos están tapados:
  //    · el pegado, que se fuerza a texto pelado (ver `montarEditor`);
  //    · el guardado, que no lee `innerHTML` sino que RECORRE los nodos
  //      y solo entiende los que armamos nosotros. Lo que no reconoce,
  //      lo deja pasar como texto.
  //
  //  ── CÓMO SE USA ──────────────────────────────────────────────
  //    ponerTexto(el, 'hola **mundo**')  → lo muestra formateado
  //    leerTexto(el)                     → 'hola **mundo**'
  //  Las dos andan igual con un <textarea> y con un editor, así que el
  //  resto del panel no tiene que saber cuál de los dos le tocó.

  function esEditor(el) { return !!(el && el.isContentEditable); }

  // ── DÓNDE ESTABA EL CURSOR ───────────────────────────────────
  //  Clickear un botón de la barra —el emoji, el link— le saca el foco
  //  al editor. Y `el.focus()` no lo devuelve donde estaba: manda el
  //  cursor al principio. Por eso el emoji terminaba siempre pegado al
  //  primer renglón y el link se metía adelante de todo.
  //  La solución es acordarse: cada vez que movés el cursor adentro de
  //  un editor se guarda dónde quedó, y las herramientas vuelven ahí
  //  antes de escribir.
  let RANGO_EDITOR = null;
  document.addEventListener('selectionchange', () => {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const n = sel.getRangeAt(0).startContainer;
    const nodo = (n.nodeType === 1) ? n : n.parentElement;
    const ed = nodo && nodo.closest ? nodo.closest('[contenteditable="true"]') : null;
    if (ed) RANGO_EDITOR = { el: ed, rango: sel.getRangeAt(0).cloneRange() };
  });

  // El editor es el <div> de afuera, pero el cursor puede estar adentro
  // de una negrita o de un renglón: ahí `e.target` es ese pedacito y no
  // el campo. Hacerle `focus()` a un pedacito manda el cursor a su
  // principio y te borra lo que tenías seleccionado —era por esto que
  // ⌘U no subrayaba nada.
  function raizEditor(el) {
    if (!el || !el.closest) return el;
    return el.closest('[contenteditable="true"]') || el;
  }

  function volverAlCursor(el) {
    if (!el) return false;
    el.focus();
    if (!RANGO_EDITOR || RANGO_EDITOR.el !== el || !el.contains(RANGO_EDITOR.rango.startContainer)) return false;
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(RANGO_EDITOR.rango);
    return true;
  }

  // De qué marca es cada etiqueta, al volver a texto.
  const TAG_MARCA = { B: '**', STRONG: '**', I: '*', EM: '*', U: '__', S: '~~', STRIKE: '~~', DEL: '~~', MARK: '==' };

  // Una lista, con las que le cuelguen adentro. Cada nivel son dos
  // espacios de sangría, que es lo que después lee `renderTexto`.
  //
  //  Los navegadores no se ponen de acuerdo en dónde cuelgan la
  //  sublista: Chrome la mete como hermana del <li>, otros la meten
  //  adentro. Se contemplan las dos, porque el texto lo escribe
  //  cualquiera desde cualquier navegador y tiene que guardarse igual.
  function serieLista(n, nivel) {
    const tag = n.tagName;
    const sangria = '  '.repeat(nivel);
    let s = '', i = 1;
    for (let j = 0; j < n.childNodes.length; j++) {
      const h = n.childNodes[j];
      if (h.nodeType !== 1) continue;
      if (h.tagName === 'UL' || h.tagName === 'OL') { s += serieLista(h, nivel + 1); continue; }
      if (h.tagName !== 'LI') continue;
      // Lo que es del renglón va por un lado; las sublistas, por otro.
      const propios = [], subs = [];
      for (let k = 0; k < h.childNodes.length; k++) {
        const c = h.childNodes[k];
        ((c.tagName === 'UL' || c.tagName === 'OL') ? subs : propios).push(c);
      }
      // La casilla no tiene texto: lo que dice es si está tildada.
      const caja = tag === 'UL' ? cajaDe(h) : null;
      const pre = caja ? (caja.classList.contains('on') ? '[x] ' : '[ ] ') : '';
      s += sangria + (tag === 'UL' ? '- ' : (i++) + '. ') + (pre + serieNodos(propios).trim()).trimEnd() + '\n';
      subs.forEach(u => { s += serieLista(u, nivel + 1); });
    }
    return s;
  }

  // La casilla de un renglón de checklist: la que es hija directa, no la
  // de una sublista que cuelgue de él.
  function cajaDe(li) {
    for (let k = 0; k < li.childNodes.length; k++) {
      const c = li.childNodes[k];
      if (c.nodeType === 1 && c.classList.contains('chk-box')) return c;
    }
    return null;
  }

  function serieNodos(nodos) {
    let s = '';
    for (let k = 0; k < nodos.length; k++) {
      const n = nodos[k];
      if (n.nodeType === 3) { s += n.nodeValue; continue; }
      if (n.nodeType !== 1) continue;
      const tag = n.tagName;

      if (tag === 'BR') { s += '\n'; continue; }
      if (tag === 'SVG' || tag === 'svg') continue;
      // La línea divisoria: un renglón propio con tres guiones.
      if (tag === 'HR') {
        if (s && !/\n$/.test(s)) s += '\n';
        s += '---\n';
        continue;
      }

      // Una mención: vuelve a ser @[Nombre](id).
      if (n.classList && n.classList.contains('mencion')) {
        s += '@[' + n.textContent.replace(/^@/, '').trim() + '](' + (n.dataset.mid || '') + ')';
        continue;
      }
      // La pastilla de una tarea: vuelve a ser su link.
      //
      //  Si lo que dice la pastilla es el título de la tarea —o sea,
      //  lo pusimos nosotros—, se guarda el link PELADO. Dos motivos:
      //  la pastilla va a mostrar siempre el título de ahora (si le
      //  cambian el nombre a la tarea, se actualiza sola), y no hay
      //  nada que envolver la próxima vez que se abra.
      //  Si alguien le escribió un texto propio —"[mirá acá](url)"—,
      //  ese sí se respeta.
      if (n.dataset && n.dataset.tlink) {
        const id = n.dataset.tlink;
        const txt = n.textContent.trim();
        const tt = (typeof TAREAS !== 'undefined') ? TAREAS.find(x => x.id === id) : null;
        if (tt && txt && txt !== textoPlano(tt.titulo).trim()) {
          s += '[' + txt + '](' + linkDeTarea(id) + ')';
          continue;
        }
        // Un link pelado necesita aire a los costados: si se le pega
        // la palabra de al lado, se la come adentro de la URL.
        if (s && !/[\s(]$/.test(s)) s += ' ';
        s += linkDeTarea(id);
        const sig = nodos[k + 1];
        const pegado = sig && (sig.nodeType === 3
          ? !/^[\s)]/.test(sig.nodeValue)
          : sig.tagName !== 'BR');
        if (pegado) s += ' ';
        continue;
      }
      if (tag === 'A') {
        const href = n.getAttribute('href') || '';
        const txt = serieNodos(n.childNodes).trim();
        // Un link cuyo texto ES el link se guarda pelado: si no,
        // cada vez que se abre y se cierra la tarea se iría anidando.
        s += (!href || txt === href) ? (txt || href) : ('[' + txt + '](' + href + ')');
        continue;
      }
      if (tag === 'UL' || tag === 'OL') {
        if (s && !/\n$/.test(s)) s += '\n';
        s += serieLista(n, 0);
        continue;
      }
      // Una tabla vuelve a ser sus renglones "| … |". La primera fila es
      // el encabezado (lleva su "| --- |" abajo). El texto de cada celda
      // va en un solo renglón y con sus "|" escapados.
      if (tag === 'TABLE') {
        if (s && !/\n$/.test(s)) s += '\n';
        const trs = Array.from(n.querySelectorAll('tr'));
        trs.forEach((tr, i) => {
          const cs = Array.from(tr.children).filter(c => c.tagName === 'TD' || c.tagName === 'TH');
          if (!cs.length) return;
          s += '| ' + cs.map(c => serieNodos(c.childNodes).replace(/\s*\n+\s*/g, ' ').trim().replace(/\|/g, '\\|')).join(' | ') + ' |\n';
          if (i === 0) s += '|' + cs.map(() => ' --- ').join('|') + '|\n';
        });
        continue;
      }
      if (tag === 'DIV' || tag === 'P' || /^H[1-6]$/.test(tag)) {
        if (s && !/\n$/.test(s)) s += '\n';
        // Un título vuelve a ser "# …" (h1–h3) o "## …" (h4–h6).
        const tit = /^H[1-6]$/.test(tag) ? (Number(tag[1]) <= 3 ? '# ' : '## ') : '';
        const dentroTit = serieNodos(n.childNodes);
        s += (tit && dentroTit.trim()) ? tit + dentroTit.replace(/\n+/g, ' ').trim() + '\n' : dentroTit;
        // Un renglón-bloque seguido de texto suelto: el texto va abajo,
        // no pegado al final ("Guionesdespués").
        const sig = nodos[k + 1];
        if (sig && sig.nodeType === 3 && sig.nodeValue.length && !/\n$/.test(s)) s += '\n';
        continue;
      }
      const marca = TAG_MARCA[tag];
      const dentro = serieNodos(n.childNodes);
      // Si adentro no hay nada más que espacios, la marca sobra: un
      // `****` suelto se vería como cuatro asteriscos.
      s += (marca && dentro.trim()) ? (marca + dentro + marca) : dentro;
    }
    return s;
  }

  function leerTexto(el) {
    if (!el) return '';
    if (!esEditor(el)) return el.value || '';
    return enderezarLinks(serieNodos(el.childNodes))
      .replace(/ /g, ' ')          // el espacio duro que mete el navegador
      .replace(/[ \t]+$/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function ponerTexto(el, txt) {
    if (!el) return;
    if (!esEditor(el)) { el.value = txt || ''; if (el.tagName === 'TEXTAREA') autoGrow(el); return; }
    el.innerHTML = txt ? renderTexto(txt) : '';
    marcarVacio(el);
  }

  // El texto gris de "escribí acá…" se dibuja con CSS, pero
  // `:empty` no alcanza: el navegador deja un <br> adentro apenas
  // tocás el campo y desde ahí ya no está vacío para el CSS.
  function marcarVacio(el) {
    if (!el) return;
    // Una viñeta recién creada todavía no tiene texto, pero no está
    // vacía: si se la tratara como vacía se borraba en el acto, y por eso
    // el botón de lista no hacía nada en un detalle en blanco.
    const vacio = !el.textContent.trim() && !el.querySelector('img, .mencion, a, hr, .chk-box, li, table');
    el.classList.toggle('vacio', vacio);
    if (vacio && el.innerHTML && el.innerHTML !== '<br>') el.innerHTML = '';
  }

  function montarEditor(el) {
    if (typeof el === 'string') el = $si(el);
    if (!el) return;

    // Pegar SIEMPRE como texto pelado. Sin esto, copiar de un Word o de
    // una página web metería etiquetas ajenas —con estilos, imágenes o
    // peor— adentro del campo.
    el.addEventListener('paste', e => {
      e.preventDefault();
      const t = (e.clipboardData || window.clipboardData).getData('text/plain') || '';
      document.execCommand('insertText', false, t);
    });
    // Lo mismo si te arrastran algo adentro.
    el.addEventListener('drop', e => {
      const t = e.dataTransfer && e.dataTransfer.getData('text/plain');
      if (t == null) return;
      e.preventDefault();
      document.execCommand('insertText', false, t);
    });

    el.addEventListener('keydown', e => {
      // Si otro ya lo atendió (el detalle tiene su propio ⌘B/⌘I/⌘U/⌘K),
      // acá no se hace nada: aplicarlo dos veces lo prende y lo apaga.
      if (e.defaultPrevented) return;

      // Tab adentro de una viñeta la corre a la derecha; Shift+Tab la
      // trae de vuelta. Como Asana.
      //
      //  FUERA de una lista el Tab se deja en paz y hace lo de
      //  siempre: pasar al campo siguiente. Robárselo dejaría
      //  encerrada acá adentro a cualquiera que navegue con teclado,
      //  y para meter una sangría suelta ya está la barra espaciadora.
      if (e.key === 'Tab' && enViñeta()) {
        e.preventDefault();
        mandar(e.shiftKey ? 'outdent' : 'indent');
        ordenarChecklist(el);
        guardarCampoDe(el);
        return;
      }

      // Tab en una tabla pasa a la celda siguiente; en la última, agrega
      // una fila. Shift+Tab vuelve.
      if (e.key === 'Tab' && celdaDelCursor(el)) {
        e.preventDefault();
        moverEnTabla(el, e.shiftKey ? -1 : 1);
        return;
      }

      // La checklist tiene su propio Enter, su Backspace y su ⌘↵.
      if (tecladoChecklist(e, el)) return;

      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      const k = (e.key || '').toLowerCase();
      if (k === 'h' && e.shiftKey) { e.preventDefault(); resaltar(el); return; }
      if (k === 'b' || k === 'i' || k === 'u') {
        e.preventDefault();
        mandar(k === 'b' ? 'bold' : k === 'i' ? 'italic' : 'underline');
      }
    });

    el.addEventListener('input', () => { ordenarChecklist(el); marcarVacio(el); });
    el.addEventListener('blur', () => marcarVacio(el));
    marcarVacio(el);
  }

  // `styleWithCSS` en false: que el navegador use <b> y <i> y no
  // <span style="font-weight:bold">. Los tags los sabemos volver a
  // marcas; los estilos sueltos, no.
  // ¿El cursor está parado adentro de una viñeta?
  function enViñeta() {
    const s = window.getSelection();
    if (!s || !s.rangeCount) return false;
    let n = s.getRangeAt(0).startContainer;
    if (n && n.nodeType === 3) n = n.parentNode;
    return !!(n && n.closest && n.closest('li'));
  }

  // ── Tablas: insertar, filas y columnas ───────────────────────
  //  Con el cursor adentro de una tabla aparece una barrita arriba de
  //  ella: + fila, − fila, + columna, − columna, borrar. Es una sola para
  //  toda la página y sirve en /interno y en el panel.
  function insertarTabla(el) {
    if (!el) return;
    if (!esEditor(el)) { insertarEn(el, '\n| Columna 1 | Columna 2 |\n| --- | --- |\n|  |  |\n'); return; }
    el = raizEditor(el);
    alCursor(el);
    mandar('insertHTML', '<table class="tabla-txt"><thead><tr><th>Columna 1</th><th>Columna 2</th></tr></thead>' +
      '<tbody><tr><td><br></td><td><br></td></tr></tbody></table><div><br></div>');
    marcarVacio(el);
    guardarCampoDe(el);
  }

  function celdaDelCursor(el) {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    let n = sel.getRangeAt(0).startContainer;
    if (n && n.nodeType === 3) n = n.parentNode;
    const c = n && n.closest ? n.closest('td, th') : null;
    return (c && el.contains(c)) ? c : null;
  }

  function ponerCursorEn(celda) {
    const r = document.createRange();
    r.selectNodeContents(celda); r.collapse(false);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
  }

  function celdaNueva(tag) { const c = document.createElement(tag); c.appendChild(document.createElement('br')); return c; }

  function opTabla(el, op) {
    el = raizEditor(el);
    const c = celdaDelCursor(el);
    if (!c) return;
    const tr = c.parentNode, tabla = c.closest('table');
    const col = Array.from(tr.children).indexOf(c);
    const filas = Array.from(tabla.querySelectorAll('tr'));
    if (op === 'fila+') {
      const nueva = document.createElement('tr');
      const ancho = tr.children.length;
      for (let k = 0; k < ancho; k++) nueva.appendChild(celdaNueva('td'));
      // Abajo del encabezado, la fila nueva va primera en el cuerpo.
      if (tr.parentNode.tagName === 'THEAD') {
        let tb = tabla.querySelector('tbody');
        if (!tb) { tb = document.createElement('tbody'); tabla.appendChild(tb); }
        tb.insertBefore(nueva, tb.firstChild);
      } else tr.after(nueva);
      ponerCursorEn(nueva.children[Math.min(col, ancho - 1)]);
    } else if (op === 'fila-') {
      const sig = tr.nextElementSibling || tr.previousElementSibling;
      tr.remove();
      if (!tabla.querySelector('tr')) { tabla.remove(); ocultarBarraTabla(); }
      else if (sig && sig.children[col]) ponerCursorEn(sig.children[col]);
    } else if (op === 'col+') {
      filas.forEach(f => {
        const ref = f.children[col];
        const nueva = celdaNueva(f.parentNode.tagName === 'THEAD' ? 'th' : 'td');
        if (ref) ref.after(nueva); else f.appendChild(nueva);
      });
      ponerCursorEn(tr.children[col + 1]);
    } else if (op === 'col-') {
      filas.forEach(f => { if (f.children[col]) f.children[col].remove(); });
      if (!tabla.querySelector('td, th')) { tabla.remove(); ocultarBarraTabla(); }
      else ponerCursorEn(tr.children[Math.max(0, col - 1)]);
    } else if (op === 'borrar') {
      tabla.remove(); ocultarBarraTabla();
    }
    marcarVacio(el);
    guardarCampoDe(el);
    pintarBarraTabla();
  }

  function moverEnTabla(el, paso) {
    const c = celdaDelCursor(el); if (!c) return;
    const todas = Array.from(c.closest('table').querySelectorAll('td, th'));
    const i = todas.indexOf(c) + paso;
    if (i >= todas.length) { opTabla(el, 'fila+'); ponerCursorEn(c.closest('table').querySelector('tr:last-child').firstElementChild); return; }
    if (i >= 0) ponerCursorEn(todas[i]);
  }

  // La barrita de la tabla, una sola para toda la página.
  let BARRA_TABLA = null;
  function barraTabla() {
    if (BARRA_TABLA) return BARRA_TABLA;
    const b = document.createElement('div');
    b.className = 'tabla-barra';
    b.innerHTML = [['fila+', '+ fila'], ['fila-', '− fila'], ['col+', '+ columna'], ['col-', '− columna'], ['borrar', 'Borrar tabla']]
      .map(([op, t]) => '<button type="button" data-tablaop="' + op + '">' + t + '</button>').join('');
    // mousedown y no click: así el editor no pierde el foco ni el cursor.
    b.addEventListener('mousedown', e => {
      const btn = e.target.closest('[data-tablaop]'); if (!btn) return;
      e.preventDefault();
      const sel = window.getSelection();
      const n = sel && sel.rangeCount ? sel.getRangeAt(0).startContainer : null;
      const ed = n && (n.nodeType === 3 ? n.parentNode : n).closest('[contenteditable="true"]');
      if (ed) opTabla(ed, btn.dataset.tablaop);
    });
    b.style.display = 'none';
    document.body.appendChild(b);
    return (BARRA_TABLA = b);
  }
  function ocultarBarraTabla() { if (BARRA_TABLA) BARRA_TABLA.style.display = 'none'; }
  function pintarBarraTabla() {
    const sel = window.getSelection();
    const n = sel && sel.rangeCount ? sel.getRangeAt(0).startContainer : null;
    const nodo = n && (n.nodeType === 3 ? n.parentNode : n);
    const ed = nodo && nodo.closest ? nodo.closest('[contenteditable="true"]') : null;
    const c = ed ? celdaDelCursor(ed) : null;
    if (!c) { ocultarBarraTabla(); return; }
    const b = barraTabla(), r = c.closest('table').getBoundingClientRect();
    b.style.display = 'flex';
    b.style.left = (r.left + window.scrollX) + 'px';
    b.style.top = Math.max(0, r.top + window.scrollY - b.offsetHeight - 4) + 'px';
  }
  document.addEventListener('selectionchange', pintarBarraTabla);

  function mandar(cmd, valor) {
    try { document.execCommand('styleWithCSS', false, false); } catch (_) {}
    try { document.execCommand(cmd, false, valor == null ? null : valor); } catch (_) {}
  }

  // Gancho para las pruebas automáticas. No expone datos ni permisos:
  // son funciones puras de texto.
  window.__panel = { renderTexto: renderTexto, textoPlano: textoPlano, leerTexto: leerTexto, ponerTexto: ponerTexto };

  // Al clickear el botón de emoji o el de link, el campo pierde el foco.
  // Sin esto, el editor se cerraría justo antes de que insertemos nada.
  let TOCANDO_HERRAMIENTA = false;
  document.addEventListener('mousedown', e => {
    TOCANDO_HERRAMIENTA = !!(e.target.closest &&
      e.target.closest('#emojiPop, #ovLink, .d-tools, [data-restool], #wkEmoji, #wkLink'));
  }, true);

  function insertarEn(el, txt) {
    if (esEditor(el)) {
      el = raizEditor(el);
      volverAlCursor(el);
      document.execCommand('insertText', false, txt);
      marcarVacio(el);
      guardarCampoDe(el);
      return;
    }
    const i = el.selectionStart == null ? el.value.length : el.selectionStart;
    const f = el.selectionEnd == null ? el.value.length : el.selectionEnd;
    el.value = el.value.slice(0, i) + txt + el.value.slice(f);
    const c = i + txt.length;
    el.focus();
    try { el.setSelectionRange(c, c); } catch (_) {}
    if (el.tagName === 'TEXTAREA') autoGrow(el);
  }

  // ── Negrita, cursiva, subrayado, tachado y listas ────────────
  // Si el texto ya está envuelto, el botón lo desenvuelve: el mismo
  // atajo prende y apaga, como en cualquier editor.
  const MARCA_CMD = { '**': 'bold', '*': 'italic', '__': 'underline', '~~': 'strikeThrough' };

  function envolver(el, marca) {
    if (!el) return;
    // En el editor no hay marcas que poner: se le pide al navegador que
    // ponga la negrita de verdad, y al guardar la volvemos a `**`.
    if (esEditor(el)) {
      el = raizEditor(el);
      volverAlCursor(el);
      mandar(MARCA_CMD[marca] || 'bold');
      guardarCampoDe(el);
      return;
    }
    let i = el.selectionStart, f = el.selectionEnd;
    const v = el.value;
    if (i === f) {
      // Sin selección, agarramos la palabra donde está el cursor
      while (i > 0 && !/\s/.test(v[i - 1])) i--;
      while (f < v.length && !/\s/.test(v[f])) f++;
      if (i === f) return;
    }
    // Los espacios y saltos de línea de las puntas quedan AFUERA de las
    // marcas. Si no, seleccionar una línea entera (con su Enter final)
    // dejaba el `**` de cierre al principio del renglón siguiente y el
    // texto se veía con los asteriscos crudos.
    while (i < f && /\s/.test(v[i])) i++;
    while (f > i && /\s/.test(v[f - 1])) f--;
    if (i >= f) return;

    const sel = v.slice(i, f);
    const n = marca.length;

    // Selección de varias líneas: se marca CADA línea por separado.
    // El formato no cruza saltos de línea, ni acá ni al mostrarlo.
    if (sel.indexOf('\n') !== -1) {
      const marcado = sel.split('\n').map(function (linea) {
        const t = linea.trim();
        if (!t) return linea;
        if (t.startsWith(marca) && t.endsWith(marca) && t.length > marca.length * 2) {
          return linea.replace(t, t.slice(marca.length, -marca.length));
        }
        return linea.replace(t, marca + t + marca);
      }).join('\n');
      el.value = v.slice(0, i) + marcado + v.slice(f);
      el.focus();
      try { el.setSelectionRange(i, i + marcado.length); } catch (_) {}
      if (el.tagName === 'TEXTAREA') autoGrow(el);
      guardarCampoDe(el);
      return;
    }

    const yaEsta = v.slice(i - n, i) === marca && v.slice(f, f + n) === marca;
    const dentro = sel.startsWith(marca) && sel.endsWith(marca) && sel.length > n * 2;

    let nuevo, ini, fin;
    if (yaEsta) {
      nuevo = v.slice(0, i - n) + sel + v.slice(f + n);
      ini = i - n; fin = f - n;
    } else if (dentro) {
      const limpio = sel.slice(n, -n);
      nuevo = v.slice(0, i) + limpio + v.slice(f);
      ini = i; fin = i + limpio.length;
    } else {
      nuevo = v.slice(0, i) + marca + sel + marca + v.slice(f);
      ini = i + n; fin = f + n;
    }
    el.value = nuevo;
    el.focus();
    try { el.setSelectionRange(ini, fin); } catch (_) {}
    if (el.tagName === 'TEXTAREA') autoGrow(el);
    guardarCampoDe(el);
  }

  function listar(el, orden) {
    if (!el) return;
    if (esEditor(el)) {
      el = raizEditor(el);
      volverAlCursor(el);
      mandar(orden ? 'insertOrderedList' : 'insertUnorderedList');
      guardarCampoDe(el);
      return;
    }
    const v = el.value;
    let i = v.lastIndexOf('\n', el.selectionStart - 1) + 1;
    let f = v.indexOf('\n', el.selectionEnd);
    if (f === -1) f = v.length;
    const lineas = v.slice(i, f).split('\n');
    const yaEsta = lineas.every(l => !l.trim() ||
      (orden ? /^\s*\d+[.)]\s/.test(l) : /^\s*[-•]\s/.test(l)));
    const nuevas = lineas.map((l, k) => {
      const limpia = l.replace(/^\s*(?:[-•]|\d+[.)])\s+/, '');
      if (yaEsta) return limpia;
      return (orden ? (k + 1) + '. ' : '- ') + limpia;
    });
    el.value = v.slice(0, i) + nuevas.join('\n') + v.slice(f);
    el.focus();
    try { el.setSelectionRange(i, i + nuevas.join('\n').length); } catch (_) {}
    if (el.tagName === 'TEXTAREA') autoGrow(el);
    guardarCampoDe(el);
  }

  // ── Resaltar ─────────────────────────────────────────────────
  //  En el editor se le pide al navegador que pinte el fondo (así se
  //  arregla solo con selecciones que cruzan renglones o viñetas) con un
  //  color de contraseña, y enseguida cada pedazo pintado se cambia por
  //  un <mark> nuestro. El color de verdad lo pone la hoja de estilo, por
  //  eso en modo oscuro también se ve bien.
  //  Si lo seleccionado ya estaba resaltado, se despinta: el mismo botón
  //  prende y apaga, como la negrita.
  const COLOR_SEÑA = 'rgb(255, 254, 1)';

  function desenvolver(n) {
    const p = n.parentNode;
    if (!p) return;
    while (n.firstChild) p.insertBefore(n.firstChild, n);
    p.removeChild(n);
  }

  // Con el atajo el foco ya está en el campo y la selección de ahora es
  // la buena. Solo un click en la barra se lleva el foco, y ahí sí hay
  // que volver a donde estaba el cursor.
  function alCursor(el) {
    if (document.activeElement !== el) volverAlCursor(el);
  }

  function resaltar(el) {
    if (!el) return;
    if (!esEditor(el)) { envolver(el, '=='); return; }
    el = raizEditor(el);
    alCursor(el);
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const r = sel.getRangeAt(0);
    if (!el.contains(r.commonAncestorContainer)) return;

    const pintadas = Array.from(el.querySelectorAll('mark')).filter(m => r.intersectsNode(m));
    if (pintadas.length) {
      pintadas.forEach(desenvolver);
      el.normalize();
      guardarCampoDe(el);
      return;
    }
    if (r.collapsed) return;

    try { document.execCommand('styleWithCSS', false, true); } catch (_) {}
    try { document.execCommand('hiliteColor', false, COLOR_SEÑA); } catch (_) {}
    try { document.execCommand('styleWithCSS', false, false); } catch (_) {}

    const nuevas = [];
    el.querySelectorAll('[style]').forEach(n => {
      if (n.style.backgroundColor !== COLOR_SEÑA) return;
      if (n.tagName === 'SPAN' && !n.classList.contains('mencion')) {
        const m = document.createElement('mark');
        n.parentNode.insertBefore(m, n);
        while (n.firstChild) m.appendChild(n.firstChild);
        n.remove();
        nuevas.push(m);
      } else {
        // Algo nuestro (una mención, un renglón) que el navegador pintó
        // por arriba: se le saca el fondo y queda como estaba.
        n.style.removeProperty('background-color');
        if (!n.getAttribute('style')) n.removeAttribute('style');
      }
    });
    // Dos pedazos pegados quedan como uno solo.
    nuevas.forEach(m => {
      const sig = m.nextSibling;
      if (sig && sig.nodeType === 1 && sig.tagName === 'MARK') {
        while (sig.firstChild) m.appendChild(sig.firstChild);
        sig.remove();
      }
    });
    const vivas = nuevas.filter(m => m.isConnected);
    if (vivas.length) {
      const nr = document.createRange();
      nr.setStartBefore(vivas[0]);
      nr.setEndAfter(vivas[vivas.length - 1]);
      sel.removeAllRanges();
      sel.addRange(nr);
    }
    guardarCampoDe(el);
  }

  // ── Línea divisoria ──────────────────────────────────────────
  //  Adentro de una viñeta no se mete: la línea iría a parar adentro del
  //  renglón y al guardar partiría la lista en dos. Va abajo de la lista
  //  entera, con un renglón vacío después para seguir escribiendo.
  function divisor(el) {
    if (!el) return;
    if (!esEditor(el)) { insertarEn(el, '\n---\n'); return; }
    el = raizEditor(el);
    alCursor(el);
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    let n = sel.getRangeAt(0).startContainer;
    if (n.nodeType === 3) n = n.parentNode;
    const li = n.closest ? n.closest('li') : null;
    if (li && el.contains(li)) {
      let tope = li;
      while (tope.parentNode && tope.parentNode !== el) tope = tope.parentNode;
      const hr = document.createElement('hr');
      const sig = document.createElement('div');
      sig.appendChild(document.createElement('br'));
      tope.after(hr, sig);
      const r = document.createRange();
      r.setStart(sig, 0); r.collapse(true);
      sel.removeAllRanges(); sel.addRange(r);
    } else {
      mandar('insertHorizontalRule');
    }
    marcarVacio(el);
    guardarCampoDe(el);
  }

  // ── Checklist ────────────────────────────────────────────────
  //  Un renglón de checklist es un <li class="chk"> con su casilla
  //  adelante. Se guarda como `- [ ] texto` o `- [x] texto`.
  function nuevaCaja(hecha) {
    const t = document.createElement('template');
    t.innerHTML = cajaChk(hecha);
    return t.content.firstChild;
  }
  function ponerChk(li) {
    if (!cajaDe(li)) li.insertBefore(nuevaCaja(false), li.firstChild);
    li.classList.add('chk');
  }
  function sacarChk(li) {
    const c = cajaDe(li);
    if (c) c.remove();
    li.classList.remove('chk', 'hecho');
    if (!li.getAttribute('class')) li.removeAttribute('class');
  }
  function liDelCursor(el) {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    const r = sel.getRangeAt(0);
    let n = r.startContainer;
    if (n.nodeType === 3) n = n.parentNode;
    let li = n && n.closest ? n.closest('li') : null;
    // Recién creada una lista, el navegador deja el cursor "apuntando" a
    // la lista desde afuera (el campo, posición 0) aunque lo que escribas
    // vaya adentro del renglón. Se busca el renglón al que apunta.
    if (!li && r.startContainer.nodeType === 1) {
      const kids = r.startContainer.childNodes;
      const desp = kids[r.startOffset], ant = kids[r.startOffset - 1];
      const c = (desp && desp.nodeType === 1) ? desp : ant;
      if (c && c.nodeType === 1) {
        if (c.tagName === 'LI') li = c;
        else if (c.tagName === 'UL' || c.tagName === 'OL') {
          const todos = c.querySelectorAll('li');
          li = c === desp ? todos[0] : todos[todos.length - 1];
        }
      }
    }
    return (li && el.contains(li)) ? li : null;
  }
  // Los renglones que toca la selección. Si seleccionás un renglón con
  // sublista adentro, cuenta el renglón y no todos los de abajo.
  function lisDeSeleccion(el) {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return [];
    const r = sel.getRangeAt(0);
    const propio = liDelCursor(el);
    if (r.collapsed) return propio ? [propio] : [];
    const tocadas = Array.from(el.querySelectorAll('li')).filter(li => r.intersectsNode(li));
    return tocadas.filter(li => li === propio || !tocadas.some(o => o !== li && li.contains(o)));
  }

  function checklist(el) {
    if (!el || !esEditor(el)) return;
    el = raizEditor(el);
    alCursor(el);
    let lis = lisDeSeleccion(el);
    // Fuera de una lista, o en una numerada: primero se vuelve viñeta.
    if (!lis.length || lis.some(li => li.parentNode.tagName === 'OL')) {
      mandar('insertUnorderedList');
      lis = lisDeSeleccion(el);
      if (lis.some(li => li.parentNode.tagName === 'OL')) { mandar('insertUnorderedList'); lis = lisDeSeleccion(el); }
    }
    if (!lis.length) return;
    const todas = lis.every(li => li.classList.contains('chk'));
    lis.forEach(li => todas ? sacarChk(li) : ponerChk(li));
    // En un renglón vacío el cursor va DESPUÉS de la casilla: si quedara
    // adelante, lo que escribas iría antes que ella.
    if (!todas && lis.length === 1 && !textoPropio(lis[0])) {
      const c = cajaDe(lis[0]);
      const r = document.createRange();
      r.setStartAfter(c); r.collapse(true);
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
    }
    marcarVacio(el);
    guardarCampoDe(el);
  }

  function tildar(caja) {
    const li = caja.closest('li');
    const on = !caja.classList.contains('on');
    caja.classList.toggle('on', on);
    caja.setAttribute('aria-checked', on ? 'true' : 'false');
    if (li) li.classList.toggle('hecho', on);
  }

  // Lo que el renglón tiene escrito, sin contar sus sublistas.
  function textoPropio(li) {
    let t = '';
    li.childNodes.forEach(c => {
      if (c.nodeType === 1 && (c.tagName === 'UL' || c.tagName === 'OL')) return;
      t += c.textContent;
    });
    return t.replace(/\u00a0/g, ' ').trim();
  }

  // El navegador no sabe qué es una casilla: al partir, juntar o correr
  // renglones la puede dejar en cualquier lado. Esto la vuelve a su lugar
  // después de cada cambio, sin tocar el texto.
  function ordenarChecklist(el) {
    el.querySelectorAll('.chk-box').forEach(c => {
      const li = c.parentNode && c.parentNode.tagName === 'LI' ? c.parentNode : null;
      // Una casilla suelta (afuera de una viñeta, o en una numerada) sobra.
      if (!li || li.parentNode.tagName !== 'UL') { c.remove(); if (li) li.classList.remove('chk', 'hecho'); return; }
      // Solo vale la que está primera. Las demás vienen de juntar renglones.
      let primero = li.firstChild;
      while (primero && primero.nodeType === 3 && !primero.nodeValue.length) primero = primero.nextSibling;
      if (primero !== c) {
        // Si adelante hay OTRA casilla, esta sobra (vino de juntar dos
        // renglones). Si no, es la del renglón y se la vuelve al principio.
        if (primero && primero.nodeType === 1 && primero.classList.contains('chk-box')) { c.remove(); return; }
        li.insertBefore(c, li.firstChild);
      }
      li.classList.add('chk');
      li.classList.toggle('hecho', c.classList.contains('on'));
      // Al correr renglones el navegador le pega estilos copiados (un
      // fondo blanco, la tipografía): taparían el rosa de tildada.
      if (c.hasAttribute('style')) c.removeAttribute('style');
    });
    // Un renglón marcado que se quedó sin casilla la recupera.
    el.querySelectorAll('li.chk').forEach(li => {
      if (li.parentNode.tagName !== 'UL') { li.classList.remove('chk', 'hecho'); return; }
      if (!cajaDe(li)) li.insertBefore(nuevaCaja(li.classList.contains('hecho')), li.firstChild);
    });
  }

  function tecladoChecklist(e, el) {
    if (e.isComposing) return false;
    const li = liDelCursor(el);
    if (!li || !li.classList.contains('chk')) return false;
    const sel = window.getSelection();
    const r = sel.getRangeAt(0);

    // ⌘↵ tilda o destilda el renglón donde estás.
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      const c = cajaDe(li);
      if (c) { tildar(c); guardarCampoDe(el); }
      return true;
    }

    // Borrar al principio del renglón saca la casilla y deja una viñeta
    // común. Un segundo borrar ya hace lo de siempre.
    if (e.key === 'Backspace' && r.collapsed && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const antes = document.createRange();
      antes.setStart(li, 0);
      antes.setEnd(r.startContainer, r.startOffset);
      if (!antes.toString().replace(/\u00a0/g, ' ').length) {
        e.preventDefault();
        sacarChk(li);
        if (!li.firstChild) li.appendChild(document.createElement('br'));
        guardarCampoDe(el);
        return true;
      }
      return false;
    }

    if (e.key !== 'Enter' || e.shiftKey || e.altKey) return false;
    e.preventDefault();

    // Enter en un renglón vacío: en una sublista lo trae un nivel para
    // afuera; en el primer nivel sale de la checklist.
    if (!textoPropio(li) && !li.querySelector('ul, ol')) {
      const anidado = li.parentNode.parentNode && li.parentNode.parentNode.tagName === 'LI';
      if (anidado) { mandar('outdent'); ordenarChecklist(el); }
      else {
        sacarChk(li);
        if (!li.firstChild) li.appendChild(document.createElement('br'));
        mandar('insertUnorderedList');
      }
      guardarCampoDe(el);
      return true;
    }

    // Enter con texto: se parte el renglón y el pedazo de la derecha va
    // a un renglón nuevo, también con casilla (sin tildar). Las
    // sublistas se quedan colgando del renglón de arriba.
    if (!r.collapsed) r.deleteContents();
    const resto = document.createRange();
    resto.setStart(r.startContainer, r.startOffset);
    const sub = Array.from(li.childNodes).find(c => c.nodeType === 1 && (c.tagName === 'UL' || c.tagName === 'OL'));
    if (sub) resto.setEndBefore(sub); else resto.setEnd(li, li.childNodes.length);
    const pedazo = resto.extractContents();

    const nuevo = document.createElement('li');
    nuevo.className = 'chk';
    const caja = nuevaCaja(false);
    nuevo.appendChild(caja);
    nuevo.appendChild(pedazo);
    if (!nuevo.textContent.trim() && !nuevo.querySelector('br, img, .mencion')) nuevo.appendChild(document.createElement('br'));
    if (!textoPropio(li) && !Array.from(li.childNodes).some(c => c.nodeType === 1 && c.tagName === 'BR')) {
      li.insertBefore(document.createElement('br'), sub || null);
    }
    li.after(nuevo);

    const cur = document.createRange();
    cur.setStartAfter(caja); cur.collapse(true);
    sel.removeAllRanges(); sel.addRange(cur);
    marcarVacio(el);
    guardarCampoDe(el);
    return true;
  }

  // Click en una casilla: se tilda y se guarda. Solo adentro de un
  // editor; en un comentario ya mandado o en administración la casilla
  // se ve pero no se toca.
  document.addEventListener('mousedown', e => {
    const caja = e.target.closest && e.target.closest('.chk-box');
    if (!caja) return;
    const ed = caja.closest('[contenteditable="true"]');
    if (!ed) return;
    e.preventDefault();          // que el cursor no salte a la casilla
    tildar(caja);
    guardarCampoDe(ed);
  });

  // Cada campo se guarda donde corresponde
  function guardarCampoDe(el) {
    if (!el) return;
    el = raizEditor(el);
  }

  // La barra de formato, igual en todos lados
  const BARRA_FORMATO =
    '<button class="mini-btn fmt" data-fmt="**" title="Negrita (⌘B)"><b>B</b></button>' +
    '<button class="mini-btn fmt" data-fmt="*" title="Cursiva (⌘I)"><i>i</i></button>' +
    '<button class="mini-btn fmt" data-fmt="__" title="Subrayado (⌘U)"><u>U</u></button>' +
    '<button class="mini-btn fmt" data-fmt="~~" title="Tachado"><s>S</s></button>' +
    '<button class="mini-btn fmt" data-fmt="==" title="Resaltar (⌘⇧H)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 11-6 6v3h9l3-3"></path><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"></path></svg></button>' +
    '<button class="mini-btn fmt" data-lista="" title="Lista">•—</button>' +
    '<button class="mini-btn fmt" data-lista="1" title="Lista numerada">1—</button>' +
    '<button class="mini-btn fmt" data-tabla="1" title="Tabla"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"></rect><line x1="3" y1="10" x2="21" y2="10"></line><line x1="10" y1="4" x2="10" y2="20"></line></svg></button>';
  window.EditorTexto = {
    renderTexto: renderTexto, textoPlano: textoPlano, leerTexto: leerTexto, ponerTexto: ponerTexto,
    montarEditor: montarEditor, envolver: envolver, listar: listar, resaltar: resaltar, checklist: checklist,
    divisor: divisor, mandar: mandar, insertarTabla: insertarTabla, volverAlCursor: volverAlCursor, raizEditor: raizEditor,
    marcarVacio: marcarVacio, insertarEn: insertarEn, BARRA_FORMATO: BARRA_FORMATO,
    rangoGuardado: function () { return RANGO_EDITOR; }
  };
})();
