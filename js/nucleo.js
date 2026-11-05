/* Núcleo de las cartas: rarezas, sorteo, recuentos, textos y dibujo de cada carta.
   Sin módulos ni sintaxis moderna arriesgada: tiene que funcionar en la fuente de navegador de OBS. */
(function () {
  var C = (window.Cartas = window.Cartas || {});

  C.RAREZAS = [
    { id: 'comun', nombre: 'Común', plural: 'Comunes', color: '#aab4c0', peso: 60 },
    { id: 'poco', nombre: 'Poco común', plural: 'Poco comunes', color: '#35c46d', peso: 26 },
    { id: 'rara', nombre: 'Rara', plural: 'Raras', color: '#3d8bff', peso: 10 },
    { id: 'epica', nombre: 'Épica', plural: 'Épicas', color: '#a862ff', peso: 3.4 },
    { id: 'legendaria', nombre: 'Legendaria', plural: 'Legendarias', color: '#ffb21e', peso: 0.6 }
  ];

  C.rareza = function (id) {
    for (var i = 0; i < C.RAREZAS.length; i++) if (C.RAREZAS[i].id === id) return C.RAREZAS[i];
    return C.RAREZAS[0];
  };
  C.nivel = function (id) {
    for (var i = 0; i < C.RAREZAS.length; i++) if (C.RAREZAS[i].id === id) return i;
    return 0;
  };
  C.pad = function (n) { return String(n).padStart(3, '0'); };
  C.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  C.clonar = function (o) { return o == null ? o : JSON.parse(JSON.stringify(o)); };
  C.mismoTexto = function (a, b) {
    var n = function (s) { return String(s || '').trim().toLowerCase(); };
    return n(a) !== '' && n(a) === n(b);
  };

  /* Número aleatorio de calidad (los sorteos tienen que ser justos). */
  C.aleatorio = function () {
    if (window.crypto && crypto.getRandomValues) return crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
    return Math.random();
  };

  /* Elige rareza según las probabilidades y luego una carta al azar de esa rareza. */
  C.sacarCarta = function (coleccion, forzarRareza, aleatorio) {
    aleatorio = aleatorio || C.aleatorio;
    var porRareza = {};
    coleccion.cartas.forEach(function (c) { (porRareza[c.rareza] = porRareza[c.rareza] || []).push(c); });
    var rareza = forzarRareza && porRareza[forzarRareza] ? forzarRareza : null;
    if (!rareza) {
      var disponibles = C.RAREZAS.filter(function (r) { return porRareza[r.id]; });
      var probs = coleccion.probabilidades || {};
      var pesos = disponibles.map(function (r) { return probs[r.id] != null ? probs[r.id] : r.peso; });
      var total = pesos.reduce(function (a, b) { return a + b; }, 0);
      var x = aleatorio() * total;
      rareza = disponibles[disponibles.length - 1].id;
      for (var i = 0; i < disponibles.length; i++) {
        x -= pesos[i];
        if (x < 0) { rareza = disponibles[i].id; break; }
      }
    }
    var lista = porRareza[rareza];
    return lista[Math.floor(aleatorio() * lista.length)];
  };

  /* Recuento de un álbum: cuántas distintas tiene de cada rareza y cuántas repetidas. */
  C.resumen = function (album, coleccion) {
    var tiene = (album && album.cartas) || {};
    var filas = C.RAREZAS.map(function (r) {
      return { id: r.id, nombre: r.nombre, plural: r.plural, color: r.color, total: 0, tengo: 0 };
    });
    var porId = {};
    filas.forEach(function (f) { porId[f.id] = f; });
    var unicas = 0, cartas = 0;
    coleccion.cartas.forEach(function (c) {
      var f = porId[c.rareza];
      if (!f) return;
      f.total++;
      var n = tiene[c.n] || 0;
      if (n > 0) { f.tengo++; unicas++; }
      cartas += n;
    });
    return {
      filas: filas, unicas: unicas, total: coleccion.cartas.length,
      cartas: cartas, repetidas: cartas - unicas, sobres: (album && album.sobres) || 0
    };
  };

  /* Mensajes del chat */
  C.textoAlbum = function (nombre, res, url) {
    var partes = res.filas.map(function (f) { return f.plural + ' ' + f.tengo + '/' + f.total; });
    return '@' + nombre + ' tu álbum: ' + res.unicas + '/' + res.total + ' · ' + partes.join(' · ') +
      ' · Repetidas ' + res.repetidas + (url ? ' · Míralo entero aquí: ' + url : '');
  };
  C.textoSinCartas = function (nombre, recompensa) {
    return '@' + nombre + ' todavía no tienes cartas. Canjea «' + (recompensa || 'Abrir sobre') +
      '» con tus puntos del canal para abrir tu primer sobre.';
  };
  C.textoCanje = function (nombre, carta, cantidad, res) {
    var r = C.rareza(carta.rareza);
    return nombre + ' ha conseguido «' + carta.nombre + '» (' + r.nombre + ')' +
      (cantidad === 1 ? ' ¡Nueva!' : ' · repetida, ya tiene ' + cantidad) +
      ' · Álbum ' + res.unicas + '/' + res.total;
  };

  /* Emblema: anillo con los cinco colores de rareza. */
  C.emblemaHTML = function (clase) {
    return '<span class="emblema ' + (clase || '') + '"><span>★</span></span>';
  };

  /* Ilustración provisional mientras no haya imagen definitiva. */
  var contador = 0;
  C.arteProvisional = function (carta) {
    var id = 'ap' + (++contador);
    var h = Math.round((carta.n * 137.508) % 360);
    var c1 = 'hsl(' + h + ',72%,58%)', c2 = 'hsl(' + ((h + 50) % 360) + ',60%,18%)';
    var formas = [
      '<circle cx="50" cy="37" r="23"/>',
      '<polygon points="50,12 72,25 72,50 50,63 28,50 28,25"/>',
      '<polygon points="50,10 77,37 50,64 23,37"/>',
      '<rect x="30" y="17" width="40" height="40" rx="8" transform="rotate(14 50 37)"/>'
    ];
    var puntos = '';
    for (var i = 0; i < 6; i++) {
      var x = (carta.n * 37 + i * 53) % 100, y = (carta.n * 23 + i * 71) % 80, r = 1.5 + ((carta.n + i) % 4);
      puntos += '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="#fff" opacity=".12"/>';
    }
    return '<svg viewBox="0 0 100 80" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' +
      '<defs><radialGradient id="' + id + '" cx="50%" cy="30%" r="80%"><stop offset="0" stop-color="' + c1 + '"/>' +
      '<stop offset="1" stop-color="' + c2 + '"/></radialGradient></defs>' +
      '<rect width="100" height="80" fill="url(#' + id + ')"/>' + puntos +
      '<g fill="#fff" fill-opacity=".16" stroke="#fff" stroke-opacity=".4" stroke-width="1.2">' + formas[carta.n % 4] + '</g>' +
      '<text x="50" y="45" text-anchor="middle" font-family="Lilita One, Rubik, sans-serif" font-size="22" fill="#fff" fill-opacity=".92">' + C.pad(carta.n) + '</text>' +
      '<text x="50" y="71" text-anchor="middle" font-family="Rubik, sans-serif" font-size="5" letter-spacing="1.4" fill="#fff" fill-opacity=".6">IMAGEN PENDIENTE</text>' +
      '</svg>';
  };

  /* Dibuja una carta. op.ancho en píxeles; por debajo de 170 px se oculta el texto. */
  C.crearCarta = function (carta, coleccion, op) {
    op = op || {};
    var r = C.rareza(carta.rareza), nivel = C.nivel(r.id), w = op.ancho || 300;
    var div = document.createElement('div');
    div.className = 'carta r-' + r.id + (w < 170 ? ' mini' : '');
    div.style.setProperty('--w', w + 'px');
    var arte = carta.imagen
      ? '<img src="' + C.esc(carta.imagen) + '" alt="" draggable="false">'
      : C.arteProvisional(carta);
    var pips = '';
    for (var i = 0; i <= nivel; i++) pips += '<i></i>';
    div.innerHTML =
      '<div class="carta-cara">' +
        '<div class="carta-cabecera"><span class="carta-nombre">' + C.esc(carta.nombre) + '</span>' +
        '<span class="carta-num">' + C.pad(carta.n) + '<small>/' + coleccion.cartas.length + '</small></span></div>' +
        '<div class="carta-arte">' + arte + '</div>' +
        '<div class="carta-rareza"><span>' + r.nombre + '</span><span class="pips">' + pips + '</span></div>' +
        '<p class="carta-texto">' + C.esc(carta.texto || '') + '</p>' +
        '<div class="carta-pie"><span>' + C.esc(coleccion.nombre || '') + '</span><span>' + C.esc(coleccion.edicion || '') + '</span></div>' +
      '</div>' +
      '<div class="carta-brillo"></div>';
    return div;
  };

  C.crearReverso = function (op) {
    op = op || {};
    var div = document.createElement('div');
    div.className = 'carta reverso' + ((op.ancho || 300) < 170 ? ' mini' : '');
    div.style.setProperty('--w', (op.ancho || 300) + 'px');
    div.innerHTML = '<div class="reverso-dibujo">' + C.emblemaHTML('reverso-emblema') +
      '<span class="reverso-texto">Colección del canal</span></div>';
    return div;
  };

  /* Configuración en el hash de la URL: #demo o #c=<base64url de un JSON>. */
  C.codificarConfig = function (obj) {
    var bytes = new TextEncoder().encode(JSON.stringify(obj)), bin = '';
    bytes.forEach(function (b) { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  C.leerConfigHash = function (hash) {
    hash = (hash || '').replace(/^#/, '');
    if (hash === 'demo') return { demo: true };
    if (hash.indexOf('c=') !== 0) return {};
    try {
      var b = hash.slice(2).replace(/-/g, '+').replace(/_/g, '/');
      var bin = atob(b), bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch (e) { return { error: 'La configuración de la URL está dañada' }; }
  };
})();
