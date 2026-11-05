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
  /* Solo el código (lo que va después de i.imgur.com/), para chats que bloquean enlaces: «AbCd123.png» o «AbCd123». */
  var CODIGO_SUELTO = /(?:^|[\s/])([A-Za-z0-9]{5,12})\.(png|jpe?g|gif|webp)\b/i;
  C.imgurDeCodigo = function (texto, aceptarSinExtension) {
    var directo = C.imgurDirecto(texto);
    if (directo) return directo;
    var t = String(texto || '').trim(), m = t.match(CODIGO_SUELTO);
    if (m) return 'https://i.imgur.com/' + m[1] + '.' + m[2].toLowerCase().replace('jpeg', 'jpg');
    // Sin extensión solo si parece un código real de Imgur: 7 caracteres con alguna mayúscula o número.
    if (aceptarSinExtension && /^[A-Za-z0-9]{7}$/.test(t) && /[A-Z0-9]/.test(t)) return 'https://i.imgur.com/' + t + '.png';
    return null;
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
  function miles(n) { return String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
  function pagoDe(x) { return x.pago || ((x.bits || 0) + ' bits'); }

  C.crearAlquiler = function (raiz, op) {
    var precio = op.bits || 100, minutosBloque = op.minutos || 30, maxMin = op.maxMinutos || 180;
    var puntos = op.puntos && op.puntos.recompensaId ? op.puntos : null;   // { recompensaId, titulo, coste, minutos }
    var alAprobar = op.alAprobar || function () { return Promise.resolve(); };
    var alRechazar = op.alRechazar || function () { return Promise.resolve(); };
    var enviarChat = op.enviarChat || function () { return Promise.resolve(); };
    var ahora = op.ahora || function () { return Date.now(); };
    var resolver = op.resolverImagen || function (url) { return url; };
    var clave = op.clave || 'alquiler-estado';
    var est = { pendientes: [], cola: [], actual: null };
    var ultimoInfo = 0, temporizador = null;

    try { var guardado = JSON.parse(localStorage.getItem(clave) || 'null'); if (guardado) est = guardado; } catch (e) {}
    function guardar() { try { localStorage.setItem(clave, JSON.stringify(est)); } catch (e) {} }
    function chat(t) { return enviarChat(t).catch(function (e) { if (op.onError) op.onError(e.message); }); }
    // Números cortos y fáciles de teclear (1, 2, 3…). Vuelven a empezar cuando no queda nada pendiente ni en cola.
    function nuevoNumero() {
      if (!est.pendientes.length && !est.cola.length && !est.actual) est.contador = 0;
      est.contador = (est.contador || 0) + 1;
      while (usado(String(est.contador))) est.contador++;
      return String(est.contador);
    }
    function usado(c) {
      return est.pendientes.concat(est.cola).some(function (x) { return x.id === c; }) || (est.actual && est.actual.id === c);
    }

    raiz.innerHTML =
      '<div class="caja">' +
        '<div class="cartel">' +
          '<div class="cartel-placa"><span class="cartel-se">SE</span><span class="cartel-alquila">ALQUILA</span></div>' +
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
      if (op.onCambio) op.onCambio(est);
    }

    var marca = ahora();
    function tic() {
      var t = ahora(), dt = t - marca;
      marca = t;
      if (est.actual) {
        est.actual.restante -= dt;
        if (est.actual.restante <= 0) {
          chat('El alquiler de ' + est.actual.nombre + ' ha terminado. ¡Gracias!');
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

    /* Una petición de alquiler. ev.tipo: 'bits' (bits con enlace en el mensaje), 'powerup' o 'puntos'.
       Los Power-ups y los canjes de puntos siempre crean una petición (ya han pagado), aunque el enlace no sirva. */
    function peticion(ev) {
      var tipo = ev.tipo || (ev.esPowerUp ? 'powerup' : 'bits');
      var url = tipo === 'bits' ? C.imgurDirecto(ev.texto) : C.imgurDeCodigo(ev.texto, true);
      var otroImgur = !url && IMGUR_CUALQUIERA.test(ev.texto);
      if (tipo === 'bits') {
        if (!url && !otroImgur) return null; // bits normales, sin imagen
        if (ev.bits < precio) {
          chat('@' + ev.nombre + ' ¡gracias por los bits! El recuadro se alquila a partir de ' + precio + ' bits.');
          return null;
        }
      }
      var esPuntos = tipo === 'puntos';
      var item = {
        id: nuevoNumero(), nombre: ev.nombre, login: String(ev.login || '').toLowerCase(), tipo: tipo,
        bits: esPuntos ? 0 : (ev.bits || 0),
        pago: esPuntos ? miles(ev.coste || (puntos && puntos.coste)) + ' puntos' : (ev.bits || 0) + ' bits',
        minutos: esPuntos ? ((puntos && puntos.minutos) || 10) : Math.max(1, Math.min(maxMin, Math.round(((ev.bits || 0) / precio) * minutosBloque))),
        recompensaId: ev.recompensaId || null, canjeId: esPuntos ? (ev.canjeId || ev.id) : null,
        url: url, enlace: url || (String(ev.texto || '').match(IMGUR_CUALQUIERA) || [''])[0] || String(ev.texto || '').trim().slice(0, 120)
      };
      est.pendientes.push(item);
      guardar(); pintar();
      if (url) {
        chat('Imagen pendiente ' + item.id + ' de ' + item.nombre + ' (' + pagoDe(item) + ', ' + item.minutos + ' min): ' + item.url +
          ' · Mods: !si ' + item.id + ' o !no ' + item.id);
      } else {
        chat('@' + item.nombre + ' tu petición ' + item.id + ' (' + item.minutos + ' min) no trae un enlace directo de Imgur. ' +
          'Escribe en el chat !imagen y el código de tu imagen, lo que va después de i.imgur.com/ (por ejemplo: !imagen AbCd123.png). ' +
          'Mods: !no ' + item.id + ' para rechazarla' + (item.canjeId ? ' (se le devuelven los puntos).' : '.'));
      }
      return item;
    }

    function comando(ev) {
      var texto = String(ev.texto || '').trim(), m;
      if (/^!alquiler\b/i.test(texto)) {
        if (ahora() - ultimoInfo < 30000) return false;
        ultimoInfo = ahora();
        if (puntos) {
          chat('El recuadro se alquila con puntos del canal: canjea «' + puntos.titulo + '» (' + miles(puntos.coste) + ' puntos, ' + puntos.minutos + ' min) ' +
            'y pega el enlace directo de tu imagen de Imgur (i.imgur.com/…) o solo su código (por ejemplo AbCd123.png). ' +
            'Los mods la revisan antes de que salga; si la rechazan, te devolvemos los puntos.' +
            (op.powerUp ? ' También con bits: Power-up «' + op.powerUp + '».' : ''));
        } else {
          chat('El recuadro se alquila: ' + precio + ' bits = ' + minutosBloque + ' minutos. ' +
            (op.powerUp ? 'Canjea el Power-up «' + op.powerUp + '» en el menú de Power-ups del chat y pega el enlace directo de tu imagen de Imgur (i.imgur.com/…) o solo su código (por ejemplo AbCd123.png). '
                        : 'Manda bits con el enlace directo de tu imagen de Imgur (i.imgur.com/…). ') +
            'Los mods la revisan antes de que salga; si no cumple las normas, no se muestra.');
        }
        return true;
      }
      if ((m = texto.match(/^!imagen\s+(\S+)/i))) {
        // El espectador completa su petición con el código de la imagen (vale también el enlace si el chat lo deja).
        var nuevaUrl = C.imgurDeCodigo(m[1], true), login = String(ev.login || '').toLowerCase(), mia = null;
        for (var q = est.pendientes.length - 1; q >= 0; q--) if (est.pendientes[q].login === login) { mia = est.pendientes[q]; break; }
        if (!mia) { chat('@' + ev.nombre + ' no tienes ninguna petición pendiente. Para alquilar el recuadro escribe !alquiler.'); return true; }
        if (!nuevaUrl) { chat('@' + ev.nombre + ' no entiendo ese código. Es lo que va después de i.imgur.com/, por ejemplo: !imagen AbCd123.png'); return true; }
        mia.url = nuevaUrl;
        guardar(); pintar();
        chat('Imagen pendiente ' + mia.id + ' de ' + mia.nombre + ' (' + pagoDe(mia) + ', ' + mia.minutos + ' min): ' + mia.url + ' · Mods: !si ' + mia.id + ' o !no ' + mia.id);
        return true;
      }
      if (!ev.esMod) return false;
      if ((m = texto.match(/^!s[ií]\s+#?([a-z0-9]{1,6})\b(.*)$/i))) {
        var id = m[1].toLowerCase(), i = indice(est.pendientes, id);
        if (i < 0) { chat('No hay ninguna imagen pendiente con el número ' + id + '.'); return true; }
        var item = est.pendientes[i], nueva = C.imgurDirecto(m[2]);
        if (nueva) item.url = nueva;
        if (!item.url) { chat('Falta el enlace directo: !si ' + id + ' https://i.imgur.com/….png'); return true; }
        est.pendientes.splice(i, 1);
        // Las pagadas con bits pasan delante de las de puntos.
        var pos = est.cola.length;
        if (item.tipo !== 'puntos') for (var k = 0; k < est.cola.length; k++) if (est.cola[k].tipo === 'puntos') { pos = k; break; }
        est.cola.splice(pos, 0, item);
        var espera = est.actual ? est.actual.restante + est.cola.slice(0, pos).reduce(function (a, x) { return a + x.minutos * 60000; }, 0) : 0;
        chat('Imagen ' + id + ' de ' + item.nombre + ' aprobada. ' + (espera ? 'Saldrá en unos ' + formatoMin(espera) + '.' : 'Ya está en el recuadro.'));
        if (item.canjeId) alAprobar(item).catch(function (e) { if (op.onError) op.onError(e.message); });
        tic();
        return true;
      }
      if ((m = texto.match(/^!no\s+#?([a-z0-9]{1,6})\b/i))) {
        var cod = m[1].toLowerCase(), ip = indice(est.pendientes, cod), ic = indice(est.cola, cod), quitado;
        if (ip >= 0) quitado = est.pendientes.splice(ip, 1)[0];
        else if (ic >= 0) quitado = est.cola.splice(ic, 1)[0];
        else { chat('No hay ninguna imagen pendiente con el número ' + cod + '.'); return true; }
        guardar(); pintar();
        // Si ya se marcó como completado al aprobarla, Twitch no deja devolver los puntos: solo se devuelven si estaba pendiente.
        if (quitado.canjeId && ip >= 0) {
          alRechazar(quitado).then(function () {
            chat('Imagen ' + cod + ' rechazada. @' + quitado.nombre + ', te hemos devuelto los puntos.');
          }, function (e) {
            chat('Imagen ' + cod + ' rechazada. No se pudieron devolver los puntos automáticamente.');
            if (op.onError) op.onError(e.message);
          });
        } else {
          chat('Imagen ' + cod + ' rechazada.');
        }
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
    return { peticion: peticion, bits: peticion, comando: comando, tic: tic, estado: function () { return est; } };
  };
})();
