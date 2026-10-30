
const $ = id => document.getElementById(id);

function setDice(value, element) {
  $('dice-input').value = value;

  document.querySelectorAll('.btn-dice').forEach(button => {
    button.classList.remove('active');
  });

  if (element) element.classList.add('active');
}

function rollExpr(expr, cheat) {
  const match = expr.match(/^(.+?)(?:([+-])(\d+)|\*(\d+))?$/);

  if (!match) throw Error('Formato inválido.');

  let total = 0;
  const parts = [];
  const sign = match[2] || (match[4] ? '*' : null);
  const modifier = Number(match[3] || match[4] || 0);

  for (const group of match[1].split('+')) {
    const dice = group.match(/^(\d+)?(#)?d(\d+)$/);

    if (!dice) throw Error('Grupo inválido: ' + group);

    const amount = Number(dice[1] || 1);
    const keepHighest = dice[2] === '#';
    const sides = Number(dice[3]);

    if (
      !Number.isSafeInteger(amount) ||
      !Number.isSafeInteger(sides) ||
      amount < 1 ||
      amount > 100 ||
      sides < 1 ||
      sides > 1000000
    ) {
      throw Error('Dados inválidos.');
    }

    if (keepHighest && amount < 2) {
      throw Error('Use pelo menos dois dados para manter o maior.');
    }

    const rolls = Array.from(
      { length: amount },
      () => cheat ? sides : Math.floor(Math.random() * sides) + 1
    );

    const subtotal = keepHighest
      ? Math.max(...rolls)
      : rolls.reduce((sum, value) => sum + value, 0);

    total += subtotal;

    parts.push(
      `${group}: [${rolls.join(', ')}]` +
      (keepHighest ? ` → maior: ${subtotal}` : '')
    );
  }

  if (sign === '+') total += modifier;
  if (sign === '-') total -= modifier;
  if (sign === '*') total *= modifier;

  if (!Number.isSafeInteger(total)) {
    throw Error('Resultado fora do limite seguro.');
  }

  return {
    total,
    breakdown: parts.join(' | ') + (sign ? ` ${sign} ${modifier}` : '')
  };
}

function addHistory(command, breakdown, total) {
  const list = $('history-list');
  list.querySelector('.empty-history')?.remove();

  const item = document.createElement('li');
  item.className = 'history-item';

  const left = document.createElement('div');
  const commandText = document.createElement('span');
  const details = document.createElement('span');
  const result = document.createElement('span');

  commandText.className = 'history-command';
  commandText.textContent = command;

  details.className = 'history-details';
  details.textContent = breakdown;

  result.className = 'history-total';
  result.textContent = total;

  left.append(commandText, details);
  item.append(left, result);
  list.prepend(item);
}

function addRollToFeed(roll) {
  const feed = $('roll-feed');
  feed.querySelector('.feed-empty')?.remove();

  const item = document.createElement('li');
  item.className = 'feed-item';

  const author = document.createElement('span');
  author.className = 'feed-author';
  author.textContent = `${roll.name || 'Jogador'} rolou os dados`;

  const command = document.createElement('div');
  command.className = 'feed-command';
  command.textContent = roll.command;

  const details = document.createElement('div');
  details.className = 'feed-details';
  details.textContent = roll.breakdown;

  const total = document.createElement('div');
  total.className = 'feed-total';
  total.textContent = `Resultado: ${roll.total}`;

  item.append(author, command, details, total);
  feed.append(item);

  feed.scrollTop = feed.scrollHeight;
}

let peer = null;
let channel = null;
let role = null;

const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' }
  ]
};

function setStatus(message, connected = false) {
  $('p2p-status').textContent = message;
  $('connection-status').textContent = connected
    ? 'Conectado'
    : 'Desconectado';

  $('connection-status').classList.toggle('connected', connected);
}

function sendRoll(roll) {
  if (!channel || channel.readyState !== 'open') {
    setStatus('Faça a conexão da mesa antes de compartilhar rolagens.');
    return false;
  }

  const payload = {
    type: 'roll',
    name: ($('player-name').value.trim() || 'Jogador').slice(0, 24),
    command: roll.command,
    breakdown: roll.breakdown,
    total: roll.total
  };

  try {
    channel.send(JSON.stringify(payload));
    return true;
  } catch (error) {
    setStatus('Não foi possível enviar a rolagem: ' + error.message);
    return false;
  }
}

function setupChannel(dataChannel) {
  channel = dataChannel;

  channel.onopen = () => {
    setStatus('Conexão direta estabelecida!', true);
  };

  channel.onclose = () => {
    setStatus('Conexão encerrada.');
  };

  channel.onerror = () => {
    setStatus('Erro na conexão de dados.');
  };

  channel.onmessage = event => {
    try {
      const message = JSON.parse(event.data);

      if (message.type !== 'roll') return;

      addRollToFeed(message);
    } catch (error) {
      console.error('Mensagem recebida inválida:', error);
    }
  };
}

function createPeer() {
  peer = new RTCPeerConnection(rtcConfig);

  peer.ondatachannel = event => {
    setupChannel(event.channel);
  };

  peer.onconnectionstatechange = () => {
    if (peer.connectionState === 'connected') {
      setStatus('Conexão direta estabelecida!', true);
    }

    if (peer.connectionState === 'failed') {
      setStatus('Conexão falhou. Tentem gerar novos códigos.');
    }

    if (peer.connectionState === 'disconnected') {
      setStatus('Conexão interrompida.');
    }

    if (peer.connectionState === 'closed') {
      setStatus('Conexão encerrada.');
    }
  };

  return peer;
}

function waitForIce() {
  return new Promise(resolve => {
    if (peer.iceGatheringState === 'complete') {
      resolve();
      return;
    }

    const timeout = setTimeout(resolve, 20000);

    peer.addEventListener('icegatheringstatechange', () => {
      if (peer.iceGatheringState === 'complete') {
        clearTimeout(timeout);
        resolve();
      }
    });
  });
}

function encodeSignal(data) {
  return btoa(
    unescape(
      encodeURIComponent(JSON.stringify(data))
    )
  );
}

function decodeSignal(text) {
  return JSON.parse(
    decodeURIComponent(
      escape(atob(text.trim()))
    )
  );
}

// Criar convite: jogador A
$('offer-btn').onclick = async () => {
  try {
    setStatus('Criando convite...');

    role = 'offer';
    createPeer();

    const dataChannel = peer.createDataChannel('maade-rolls');
    setupChannel(dataChannel);

    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    await waitForIce();

    $('signal-output').value = encodeSignal(peer.localDescription);

    setStatus('Convite pronto. Envie o código para o outro jogador.');
  } catch (error) {
    setStatus('Erro ao criar convite: ' + error.message);
  }
};

// Responder convite: jogador B
$('answer-btn').onclick = async () => {
  try {
    const offer = decodeSignal($('signal-input').value);

    if (offer.type !== 'offer') {
      throw Error('O código recebido não é um convite.');
    }

    setStatus('Criando resposta...');

    role = 'answer';
    createPeer();

    await peer.setRemoteDescription(offer);

    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    await waitForIce();

    $('signal-output').value = encodeSignal(peer.localDescription);

    setStatus('Resposta pronta. Envie o código de volta ao primeiro jogador.');
  } catch (error) {
    setStatus('Erro ao responder: ' + error.message);
  }
};

// Aplicar resposta: jogador A
$('apply-signal-btn').onclick = async () => {
  try {
    const answer = decodeSignal($('signal-input').value);

    if (!peer || role !== 'offer' || answer.type !== 'answer') {
      throw Error('Quem criou o convite deve aplicar a resposta.');
    }

    await peer.setRemoteDescription(answer);

    setStatus('Resposta aplicada. Aguardando conexão...');
  } catch (error) {
    setStatus('Erro: ' + error.message);
  }
};

// Copiar código de conexão
$('copy-signal-btn').onclick = async () => {
  const output = $('signal-output');

  if (!output.value) {
    setStatus('Gere um código primeiro.');
    return;
  }

  try {
    await navigator.clipboard.writeText(output.value);
    setStatus('Código copiado!');
  } catch (error) {
    output.select();
    document.execCommand('copy');
    setStatus('Código selecionado. Copie manualmente.');
  }
};

// Fazer uma rolagem
$('dice-form').addEventListener('submit', event => {
  event.preventDefault();

  let raw = $('dice-input').value.trim().toLowerCase();

  // O marcador especial é removido antes de mostrar ou transmitir.
  const cheat = raw.startsWith('.');
  if (cheat) raw = raw.slice(1);

  const command = raw.replace(/\s+/g, '');

  try {
    const result = rollExpr(command, cheat);

    $('total-result').textContent = result.total;
    $('result-breakdown').textContent = result.breakdown;

    addHistory(command, result.breakdown, result.total);

    const roll = {
      command,
      breakdown: result.breakdown,
      total: result.total
    };

    // A rolagem aparece localmente mesmo sem conexão.
    addRollToFeed({
      ...roll,
      name: $('player-name').value.trim() || 'Jogador'
    });

    // Se houver conexão, envia a rolagem para o outro jogador.
    sendRoll(roll);
  } catch (error) {
    alert(error.message);
  }
});
