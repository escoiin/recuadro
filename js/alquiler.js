/* Recuadro «Se alquila»: los espectadores mandan bits con un enlace directo de Imgur,
   un moderador lo aprueba en el chat y la imagen sale en el recuadro el tiempo pagado.
   Nunca se enseña nada sin aprobar. Solo se cargan imágenes de i.imgur.com (para no exponer tu IP a webs ajenas). */
(function () {
  var C = window.Cartas;
  var IMGUR_DIRECTO = /(?:https?:\/\/)?i\.imgur\.com\/([A-Za-z0-9]{5,12})\.(png|jpe?g|gif|webp)\b/i;
  var IMGUR_CUALQUIERA = /(?:https?:\/\/)?(?:[a-z]+\.)?imgur\.com\/\S+/i;

  C.imgurDirecto = function (texto) {
    var m = String(texto || '').match(IMGUR_DIRECTO);
    if (!m) return null;
    return 'https://i.imgur.com/' + m[1] + '.' + m[2].toLowerCase().replace('jpeg', 'jpg');
  };

  function codigoDe(texto, usados) {
    // Código corto y fácil de teclear, derivado del id del evento (igual en cualquier fuente que lo reciba).
    var h = 2166136261;
    for (var i = 0; i < texto.length; i++) { h ^= texto.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    var letras = 'abcdefghjkmnpqrstuvwxyz23456789', cod;
    do {
      cod = '';
      for (var k = 0; k < 3; k++) { cod += letras[h % letras.length]; h = Math.floor(h / letras.length); }
      h = Math.imul(h + 7, 2654435761) >>> 0;
    } while (usados(cod));
    return cod;
  }
  function formatoMin(ms) { return Math.max(1, Math.ceil(ms / 60000)) + ' min'; }

  C.crearAlquiler = function (raiz, op) {
    var precio = op.bits || 100, minutosBloque = op.minutos || 30, maxMin = op.maxMinutos || 180;
    var enviarChat = op.enviarChat || function () { return Promise.resolve(); };
    var ahora = op.ahora || function () { return Date.now(); };
    var resolver = op.resolverImagen || function (url) { return url; };
    var clave = op.clave || 'alquiler-estado';
    var est = { pendientes: [], cola: [], actual: null };
    var ultimoInfo = 0, temporizador = null;

    try { var guardado = JSON.parse(localStorage.getItem(clave) || 'null'); if (guardado) est = guardado; } catch (e) {}
    function guardar() { try { localStorage.setItem(clave, JSON.stringify(est)); } catch (e) {} }
    function chat(t) { return enviarChat(t).catch(function (e) { if (op.onError) op.onError(e.message); }); }
    function usado(c) {
      return est.pendientes.concat(est.cola).some(function (x) { return x.id === c; }) || (est.actual && est.actual.id === c);
    }

    raiz.innerHTML =
      '<div class="caja">' +
        '<div class="cartel">' +
          '<div class="cartel-placa"><span class="cartel-se">SE</span><span class="cartel-alquila">ALQUILA</span></div>' +
          '<div class="cartel-precio"><b>' + precio + ' bits</b> · ' + minutosBloque + ' min</div>' +
          '<div class="cartel-como">' + (op.powerUp ? 'Canjéalo en los Power-ups' : 'Manda bits con el enlace directo de tu imagen') + '<br><span>i.imgur.com/…</span></div>' +
          '<div class="cartel-cola" hidden></div>' +
        '</div>' +
        '<div class="anuncio" hidden>' +
          '<div class="anuncio-fondo"></div>' +
          '<img class="anuncio-img" alt="" referrerpolicy="no-referrer">' +
          '<div class="anuncio-pie"><span class="anuncio-quien"></span><span class="anuncio-tiempo"></span></div>' +
        '</div>' +
      '</div>';
    // --u = 1 % del lado menor del recuadro, para que todo escale con el tamaño de la fuente.
    function medir() { var r = raiz.getBoundingClientRect(); raiz.style.setProperty('--u', (Math.min(r.width, r.height) / 100) + 'px'); }
    medir();
    if (window.ResizeObserver) new ResizeObserver(medir).observe(raiz); else window.addEventListener('resize', medir);
    var cartel = raiz.querySelector('.cartel'), anuncio = raiz.querySelector('.anuncio');
    var img = raiz.querySelector('.anuncio-img'), fondo = raiz.querySelector('.anuncio-fondo');
    var quien = raiz.querySelector('.anuncio-quien'), tiempo = raiz.querySelector('.anuncio-tiempo');
    var colaTxt = raiz.querySelector('.cartel-cola');

    function pintar() {
      var a = est.actual;
      if (a) {
        var url = resolver(a.url);
        if (img.getAttribute('data-url') !== url) {
          img.setAttribute('data-url', url);
          img.src = url;
          fondo.style.backgroundImage = 'url("' + url + '")';
        }
        quien.innerHTML = 'Alquilado por <b>' + C.esc(a.nombre) + '</b>';
        tiempo.textContent = formatoMin(a.restante);
        anuncio.hidden = false; cartel.hidden = true;
      } else {
        anuncio.hidden = true; cartel.hidden = false;
        img.removeAttribute('src'); img.removeAttribute('data-url');
      }
      var esperando = est.pendientes.length + est.cola.length;
      colaTxt.hidden = !esperando;
      colaTxt.textContent = est.cola.length ? 'Siguiente imagen ya aprobada' : 'Imagen en revisión';
      if (op.onCambio) op.onCambio(est);
    }

    var marca = ahora();
    function tic() {
      var t = ahora(), dt = t - marca;
      marca = t;
      if (est.actual) {
        est.actual.restante -= dt;
        if (est.actual.restante <= 0) {
          chat('El alquiler de ' + est.actual.nombre + ' ha terminado. ¡Gracias por los bits!');
          est.actual = null;
        }
      }
      if (!est.actual && est.cola.length) {
        est.actual = est.cola.shift();
        est.actual.restante = est.actual.minutos * 60000;
      }
      guardar();
      pintar();
    }
    function arrancar() { clearInterval(temporizador); temporizador = setInterval(tic, 5000); }

    img.addEventListener('error', function () {
      if (!est.actual || !img.getAttribute('src')) return;
      chat('No se pudo cargar la imagen ' + est.actual.id + ' de ' + est.actual.nombre + '. Un mod puede volver a ponerla con !si ' + est.actual.id + ' y un enlace directo de Imgur.');
      est.pendientes.unshift(est.actual);
      est.actual = null;
      tic();
    });

    function bits(ev) {
      var url = C.imgurDirecto(ev.texto);
      var otroImgur = !url && IMGUR_CUALQUIERA.test(ev.texto);
      if (!url && !otroImgur && !ev.esPowerUp) return null; // bits normales, sin imagen
      if (ev.bits < precio && !ev.esPowerUp) {
        chat('@' + ev.nombre + ' ¡gracias por los bits! El recuadro se alquila a partir de ' + precio + ' bits.');
        return null;
      }
      var item = {
        id: codigoDe(String(ev.id || Math.random()), usado), nombre: ev.nombre, login: ev.login, bits: ev.bits,
        minutos: Math.max(1, Math.min(maxMin, Math.round((ev.bits / precio) * minutosBloque))),
        url: url, enlace: url || (ev.texto.match(IMGUR_CUALQUIERA) || [''])[0] || String(ev.texto || '').trim().slice(0, 120)
      };
      est.pendientes.push(item);
      guardar(); pintar();
      if (url) {
        chat('Imagen pendiente ' + item.id + ' de ' + item.nombre + ' (' + item.bits + ' bits, ' + item.minutos + ' min): ' + item.url +
          ' · Mods: !si ' + item.id + ' o !no ' + item.id);
      } else {
        chat('Imagen pendiente ' + item.id + ' de ' + item.nombre + ' (' + item.bits + ' bits, ' + item.minutos + ' min): ' + (item.enlace || 'sin enlace') +
          ' · No es un enlace directo de Imgur. Mods: !si ' + item.id + ' seguido del enlace i.imgur.com/… de la imagen, o !no ' + item.id);
      }
      return item;
    }

    function comando(ev) {
      var texto = String(ev.texto || '').trim(), m;
      if (/^!alquiler\b/i.test(texto)) {
        if (ahora() - ultimoInfo < 30000) return false;
        ultimoInfo = ahora();
        chat('El recuadro se alquila: ' + precio + ' bits = ' + minutosBloque + ' minutos. ' +
          (op.powerUp ? 'Canjea el Power-up «' + op.powerUp + '» en el menú de Power-ups del chat y pega el enlace directo de tu imagen de Imgur (i.imgur.com/…). También vale mandar bits con el enlace en el mensaje. '
                      : 'Manda bits con el enlace directo de tu imagen de Imgur (i.imgur.com/…). ') +
          'Los mods la revisan antes de que salga; si no cumple las normas, no se muestra.');
        return true;
      }
      if (!ev.esMod) return false;
      if ((m = texto.match(/^!s[ií]\s+([a-z0-9]{3})\b(.*)$/i))) {
        var id = m[1].toLowerCase(), i = indice(est.pendientes, id);
        if (i < 0) { chat('No hay ninguna imagen pendiente con el código ' + id + '.'); return true; }
        var item = est.pendientes[i], nueva = C.imgurDirecto(m[2]);
        if (nueva) item.url = nueva;
        if (!item.url) { chat('Falta el enlace directo: !si ' + id + ' https://i.imgur.com/….png'); return true; }
        est.pendientes.splice(i, 1);
        est.cola.push(item);
        var espera = est.actual ? est.actual.restante + est.cola.slice(0, -1).reduce(function (a, x) { return a + x.minutos * 60000; }, 0) : 0;
        chat('Imagen ' + id + ' de ' + item.nombre + ' aprobada. ' + (espera ? 'Saldrá en unos ' + formatoMin(espera) + '.' : 'Ya está en el recuadro.'));
        tic();
        return true;
      }
      if ((m = texto.match(/^!no\s+([a-z0-9]{3})\b/i))) {
        var cod = m[1].toLowerCase(), ip = indice(est.pendientes, cod), ic = indice(est.cola, cod);
        if (ip >= 0) est.pendientes.splice(ip, 1);
        else if (ic >= 0) est.cola.splice(ic, 1);
        else { chat('No hay ninguna imagen pendiente con el código ' + cod + '.'); return true; }
        chat('Imagen ' + cod + ' rechazada.');
        guardar(); pintar();
        return true;
      }
      if (/^!quitar\b/i.test(texto)) {
        if (!est.actual) { chat('Ahora mismo no hay ninguna imagen en el recuadro.'); return true; }
        chat('Imagen de ' + est.actual.nombre + ' retirada del recuadro.');
        est.actual = null;
        tic();
        return true;
      }
      return false;
    }
    function indice(lista, id) {
      for (var i = 0; i < lista.length; i++) if (lista[i].id === id) return i;
      return -1;
    }

    pintar();
    arrancar();
    tic();
    return { bits: bits, comando: comando, tic: tic, estado: function () { return est; } };
  };
})();
