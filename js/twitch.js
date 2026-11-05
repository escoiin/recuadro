/* Conexión con Twitch desde el navegador:
   - EventSub por WebSocket para recibir los canjes de puntos y los mensajes del chat.
   - API Helix para escribir en el chat (como la cuenta del canal).
   - Bits (cheers) para el recuadro de alquiler.
   Permisos del token: channel:read:redemptions, user:read:chat, user:write:chat, bits:read.
   - Power-ups personalizados (se pagan con bits y pueden pedir texto al espectador).
   Cada fuente de OBS elige a qué se suscribe (op.eventos: 'canjes', 'chat', 'bits', 'powerups'). */
(function () {
  var C = window.Cartas;
  var EVENTSUB = 'wss://eventsub.wss.twitch.tv/ws';
  C.ESCOPOS_TWITCH = ['channel:read:redemptions', 'user:read:chat', 'user:write:chat', 'bits:read'];
  C.ESCOPOS_ALQUILER = ['user:read:chat', 'user:write:chat', 'bits:read'];

  C.validarToken = function (token) {
    return fetch('https://id.twitch.tv/oauth2/validate', { headers: { Authorization: 'OAuth ' + token } })
      .then(function (r) {
        if (!r.ok) throw new Error('El acceso a Twitch ha caducado o no es válido. Vuelve a la página de configuración y conecta de nuevo.');
        return r.json();
      });
  };

  C.conectarTwitch = function (op) {
    var clientId = op.clientId, token = op.token;
    var alCanjear = op.onCanje || function () {}, alMensaje = op.onMensaje || function () {}, alEstado = op.onEstado || function () {};
    var alBits = op.onBits || function () {};
    var alPowerUp = op.onPowerUp || function () {};
    var eventos = op.eventos || ['canjes', 'chat'];
    var usuario = null, ws = null, cerrado = false, reconectando = false, vigilante = null, esperaMs = 20000;
    var vistos = {}, ordenVistos = [];

    function helix(ruta, init) {
      init = init || {};
      return fetch('https://api.twitch.tv/helix/' + ruta, {
        method: init.method || 'GET', body: init.body,
        headers: { 'Client-Id': clientId, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }
      });
    }

    var avisosSub = [];
    function suscribir(sesion) {
      avisosSub = [];
      var todas = {
        canjes: { type: 'channel.channel_points_custom_reward_redemption.add', version: '1', condition: { broadcaster_user_id: usuario.user_id } },
        chat: { type: 'channel.chat.message', version: '1', condition: { broadcaster_user_id: usuario.user_id, user_id: usuario.user_id } },
        bits: { type: 'channel.cheer', version: '1', condition: { broadcaster_user_id: usuario.user_id } },
        powerups: { type: 'channel.custom_power_up_redemption.add', version: '1', condition: { broadcaster_user_id: usuario.user_id }, opcional: true }
      };
      var subs = eventos.map(function (k) { return todas[k]; }).filter(Boolean);
      return subs.reduce(function (p, s) {
        return p.then(function () {
          var cuerpo = { type: s.type, version: s.version, condition: s.condition, transport: { method: 'websocket', session_id: sesion } };
          return helix('eventsub/subscriptions', { method: 'POST', body: JSON.stringify(cuerpo) }).then(function (r) {
            if (r.ok || r.status === 409) return;
            return r.text().then(function (t) {
              // Los Power-ups personalizados aún no están en todos los canales: si fallan, el resto sigue funcionando.
              if (s.opcional) { avisosSub.push('Twitch no deja escuchar los Power-ups personalizados (' + r.status + '); los bits con enlace siguen funcionando.'); return; }
              throw new Error('Twitch rechazó ' + s.type + ' (' + r.status + '): ' + t);
            });
          });
        });
      }, Promise.resolve());
    }

    function rearmar() {
      clearTimeout(vigilante);
      vigilante = setTimeout(function () {
        // Sin noticias de Twitch: cerramos y empezamos de cero.
        alEstado('aviso', 'Twitch no responde, reconectando…');
        if (ws) { ws.onclose = null; try { ws.close(); } catch (e) {} }
        ws = null; reconectando = false;
        abrir(EVENTSUB, false);
      }, esperaMs);
    }

    function yaVisto(id) {
      if (!id) return false;
      if (vistos[id]) return true;
      vistos[id] = 1; ordenVistos.push(id);
      if (ordenVistos.length > 500) delete vistos[ordenVistos.shift()];
      return false;
    }

    function abrir(url, esReconexion) {
      if (cerrado) return;
      var s = new WebSocket(url), bienvenida = false;
      if (!esReconexion) ws = s;
      s.onmessage = function (ev) {
        var m;
        try { m = JSON.parse(ev.data); } catch (e) { return; }
        var tipo = m.metadata && m.metadata.message_type;
        if (s === ws || tipo === 'session_welcome') rearmar();
        if (tipo === 'session_welcome') {
          bienvenida = true;
          esperaMs = ((m.payload.session.keepalive_timeout_seconds || 10) + 8) * 1000;
          rearmar();
          if (esReconexion) {
            var viejo = ws; ws = s; reconectando = false;
            if (viejo && viejo !== s) { viejo.onclose = null; try { viejo.close(); } catch (e) {} }
            return;
          }
          suscribir(m.payload.session.id).then(function () {
            if (avisosSub.length) alEstado('aviso', 'Conectado a Twitch (' + usuario.login + '). ' + avisosSub.join(' '));
            else alEstado('ok', 'Conectado a Twitch (' + usuario.login + ')');
          }, function (e) { alEstado('error', e.message); });
        } else if (tipo === 'session_reconnect') {
          reconectando = true;
          abrir(m.payload.session.reconnect_url, true);
        } else if (tipo === 'notification') {
          if (yaVisto(m.metadata.message_id)) return;
          var t = m.payload.subscription.type, e = m.payload.event;
          if (t === 'channel.channel_points_custom_reward_redemption.add') {
            alCanjear({ login: e.user_login, nombre: e.user_name, recompensa: e.reward && e.reward.title, texto: e.user_input || '', id: e.id });
          } else if (t === 'channel.chat.message') {
            var insignias = (e.badges || []).map(function (b) { return b.set_id; });
            var esMod = e.chatter_user_id === usuario.user_id || insignias.indexOf('broadcaster') >= 0 ||
              insignias.indexOf('moderator') >= 0 || insignias.indexOf('lead_moderator') >= 0;
            alMensaje({ login: e.chatter_user_login, nombre: e.chatter_user_name, texto: (e.message && e.message.text) || '', id: e.message_id, esMod: esMod });
          } else if (t === 'channel.custom_power_up_redemption.add') {
            var pu = e.custom_power_up || {};
            alPowerUp({ login: e.user_login || '', nombre: e.user_name || e.user_login || 'Alguien', texto: e.user_input || '',
              bits: pu.bits || 0, titulo: pu.title || '', id: e.id || m.metadata.message_id });
          } else if (t === 'channel.cheer') {
            alBits({ login: e.user_login || '', nombre: e.is_anonymous ? 'Anónimo' : (e.user_name || e.user_login), anonimo: !!e.is_anonymous,
              bits: e.bits || 0, texto: e.message || '', id: m.metadata.message_id });
          }
        } else if (tipo === 'revocation') {
          alEstado('error', 'Twitch ha retirado un permiso (' + m.payload.subscription.status + '). Vuelve a conectar desde la configuración.');
        }
      };
      s.onclose = function () {
        if (cerrado) return;
        if (esReconexion && !bienvenida) {
          // Falló la reconexión que pidió Twitch: empezamos de cero.
          reconectando = false;
          if (ws) { ws.onclose = null; try { ws.close(); } catch (e) {} }
          ws = null;
          setTimeout(function () { abrir(EVENTSUB, false); }, 1000);
          return;
        }
        if (s !== ws || reconectando) return;
        ws = null;
        alEstado('aviso', 'Conexión con Twitch perdida, reconectando…');
        setTimeout(function () { abrir(EVENTSUB, false); }, 3000);
      };
    }

    function enviarChat(texto) {
      if (!usuario) return Promise.reject(new Error('Aún no hay conexión con Twitch'));
      return helix('chat/messages', {
        method: 'POST',
        body: JSON.stringify({ broadcaster_id: usuario.user_id, sender_id: usuario.user_id, message: String(texto).slice(0, 500) })
      }).then(function (r) {
        if (!r.ok) throw new Error('No se pudo escribir en el chat (' + r.status + ')');
        return r.json();
      }).then(function (j) {
        var d = j.data && j.data[0];
        if (d && d.is_sent === false) throw new Error('Twitch no publicó el mensaje' + (d.drop_reason ? ': ' + d.drop_reason.message : ''));
      });
    }

    function iniciar() {
      return C.validarToken(token).then(function (u) {
        if (u.client_id !== clientId) throw new Error('El acceso a Twitch no corresponde a este ID de cliente. Vuelve a conectar desde la configuración.');
        var faltan = (op.escopos || C.ESCOPOS_TWITCH).filter(function (s) { return (u.scopes || []).indexOf(s) < 0; });
        if (faltan.length) throw new Error('Faltan permisos de Twitch: ' + faltan.join(', ') + '. Vuelve a conectar desde la configuración.');
        usuario = u;
        abrir(EVENTSUB, false);
        // Twitch pide comprobar el token cada hora.
        setInterval(function () {
          C.validarToken(token).catch(function (e) { alEstado('error', e.message); });
        }, 3600 * 1000);
        return u;
      });
    }

    return {
      iniciar: iniciar,
      enviarChat: enviarChat,
      usuario: function () { return usuario; },
      cerrar: function () { cerrado = true; clearTimeout(vigilante); if (ws) ws.close(); }
    };
  };
})();
