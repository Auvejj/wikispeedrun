import './style.css';
import './modern.css';
import { Peer, type DataConnection } from 'peerjs';

type WikiArticle = { title: string; html: string; url: string };
type MultiplayerPlayer = { id: string; name: string; clicks: number; wins: number; totalClicks: number; article: string; finished: boolean; elapsedSeconds: number; inLobby: boolean; ready: boolean };
type RoomPacket =
  | { type: 'join'; name: string }
  | { type: 'transfer-host'; playerId: string }
  | { type: 'kick-request'; playerId: string }
  | { type: 'start-request'; startTitle: string; targetTitle: string; language: string }
  | { type: 'room'; hostId: string; startTitle: string; targetTitle: string; language: string; players: MultiplayerPlayer[]; started: boolean; startsAt: number }
  | { type: 'start'; startTitle: string; targetTitle: string; language: string; countdownMs: number }
  | { type: 'progress'; name: string; clicks: number; article: string; finished: boolean; elapsedSeconds: number }
  | { type: 'ready'; ready: boolean }
  | { type: 'finish'; winnerId: string; winnerName: string; elapsedSeconds: number; winnerWins: number; winnerTotalClicks: number; winnerClicks: number }
  | { type: 'return-lobby' }
  | { type: 'kicked'; message: string }
  | { type: 'error'; message: string };

const app = document.querySelector<HTMLDivElement>('#app')!;
const ROOM_MAX_PLAYERS = 30;
const randomArticles: { cs: string[]; en: string[] } = {
  cs: ['Praha', 'Měsíc', 'Karel IV.', 'Vltava', 'Slunce', 'Eiffelova věž', 'Pes', 'Fotbal', 'Saturn', 'Albert Einstein', 'Japonsko', 'Amazonka', 'Česká republika', 'Leonardo da Vinci', 'Oceán'],
  en: ['Prague', 'Moon', 'Charles IV, Holy Roman Emperor', 'Vltava', 'Sun', 'Eiffel Tower', 'Dog', 'Association football', 'Saturn', 'Albert Einstein', 'Japan', 'Amazon River', 'Czech Republic', 'Leonardo da Vinci', 'Ocean'],
};
let currentTitle = '';
let startTitle = '';
let targetTitle = '';
let clicks = 0;
let startedAt = 0;
let timerId: number | undefined;
let language = 'cs';
let route: string[] = [];
let loading = false;
let playerName = '';
let isMultiplayer = false;
let isRoomHost = false;
let currentPeer: Peer | null = null;
let hostConnection: DataConnection | null = null;
let roomConnections = new Map<string, DataConnection>();
let multiplayerPlayers = new Map<string, MultiplayerPlayer>();
let roomCode = '';
let roomHostId = '';
let roomStarted = false;
let roomStartsAt = 0;
let startTimeout: number | undefined;
let raceWinner = '';
let raceWinnerTime = 0;
let noticeTimeout: number | undefined;
let roomStartDraft: string | null = null;
let roomTargetDraft: string | null = null;
let selectedTheme: 'light' | 'dark' = 'light';

function wikiUrl(title: string) {
  return `https://${language}.wikipedia.org/wiki/${encodeURIComponent(title.replaceAll(' ', '_'))}`;
}

function cleanTitle(title: string) {
  return title.replaceAll('_', ' ').trim();
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

function renderWelcome() {
  app.innerHTML = `
    <main class="setup-shell welcome-shell">
      <header class="topbar"><a class="brand" href="#"><span class="brand-mark">W</span> wiki<span class="brand-light">sprint</span></a><span class="top-note"><i></i> VYBER SI SVŮJ ZÁVOD</span></header>
      <section class="hero welcome-hero">
        <div class="hero-copy"><p class="eyebrow"><span>WIKI SPRINT</span> ZÁVOD ZAČÍNÁ TADY</p><h1>Každý klik<br>je <em>nový směr.</em></h1><p class="intro">Vyber si, jestli se vydáš na cestu sám, nebo s ostatními.</p></div>
        <div class="route-card welcome-card">
          <div class="card-top welcome-card-top"></div>
          <div class="mode-buttons"><button class="start-button mode-button" id="single-mode"><span>SINGLEPLAYER</span></button><button class="mode-button mode-button-secondary" id="multi-mode"><span>MULTIPLAYER</span></button></div>
          <button class="theme-toggle" id="theme-toggle" type="button"></button>
        </div>
      </section>
      <section class="how-row"><div><span class="how-num">01</span><strong>Vyber režim</strong><small>Sólo nebo závod s ostatními.</small></div><div><span class="how-num">02</span><strong>Nastav trasu</strong><small>Vyber start a cílový článek.</small></div><div><span class="how-num">03</span><strong>Proklikej se</strong><small>Každý odkaz tě posune dál.</small></div></section>
      <footer class="site-footer"><span>© WIKI SPRINT</span><span>POSTAVENO ZVĚDAVOSTÍ <b>✳</b></span></footer>
    </main>`;

  app.querySelector('#single-mode')!.addEventListener('click', () => { playerName = ''; renderRouteSetup(); });
  app.querySelector('#multi-mode')!.addEventListener('click', renderMultiplayerIntro);
  const themeToggle = app.querySelector<HTMLButtonElement>('#theme-toggle')!;
  updateThemeToggle(themeToggle);
  themeToggle.addEventListener('click', () => {
    selectedTheme = selectedTheme === 'light' ? 'dark' : 'light';
    applyTheme();
    updateThemeToggle(themeToggle);
    try { localStorage.setItem('wiki-sprint-theme', selectedTheme); } catch { /* Theme still works until this page closes. */ }
  });
}

function updateThemeToggle(toggle: HTMLButtonElement) {
  toggle.textContent = selectedTheme === 'light' ? 'PŘEPNOUT NA TMAVÝ REŽIM' : 'PŘEPNOUT NA SVĚTLÝ REŽIM';
  toggle.setAttribute('aria-label', selectedTheme === 'light' ? 'Zapnout tmavý režim' : 'Zapnout světlý režim');
}

function renderMultiplayerIntro() {
  app.innerHTML = `
    <main class="setup-shell welcome-shell">
      <header class="topbar"><button class="back-button welcome-back" id="back-to-modes">ZPĚT</button><a class="brand" href="#"><span class="brand-mark">W</span> wiki<span class="brand-light">sprint</span></a><span class="top-note"><i></i> MULTIPLAYER</span></header>
      <section class="hero welcome-hero setup-hero-centered">
        <div class="route-card welcome-card multiplayer-card">
          <div class="card-top welcome-card-top"></div>
          <label class="field-label" for="nickname-input">TVOJE PŘEZDÍVKA</label>
          <div class="input-wrap"><span class="field-symbol">@</span><input id="nickname-input" autocomplete="nickname" maxlength="20" placeholder="např. dádyfousek" required aria-required="true" value="${escapeHtml(playerName)}"></div>
          <button class="start-button mode-button" id="create-room"><span>VYTVOŘIT MÍSTNOST</span></button>
          <div class="room-divider"><span>NEBO SE PŘIPOJ</span></div>
          <label class="field-label" for="room-code-input">KÓD MÍSTNOSTI</label>
          <div class="input-wrap"><span class="field-symbol room-code-symbol">#</span><input id="room-code-input" autocomplete="one-time-code" inputmode="numeric" maxlength="4" placeholder="např. 4827" aria-label="Čtyřmístný kód místnosti"></div>
          <button class="mode-button mode-button-secondary" id="join-room"><span>PŘIPOJIT SE</span></button>
          <p class="form-error" id="multiplayer-error" aria-live="polite"></p>
          <p class="microcopy">Až ${ROOM_MAX_PLAYERS} hráčů v jedné místnosti.</p>
        </div>
      </section>
      <footer class="site-footer"><span>© WIKI SPRINT</span><span>PŘIHLÁŠEN/A JAKO ${escapeHtml(playerName.toLocaleUpperCase())}</span></footer>
    </main>`;
  app.querySelector('#back-to-modes')!.addEventListener('click', renderWelcome);
  const withNickname = (action: () => void) => {
    const name = app.querySelector<HTMLInputElement>('#nickname-input')!.value.trim();
    if (!name) { showMultiplayerError('Pro multiplayer si nejdřív zvol přezdívku.'); app.querySelector<HTMLInputElement>('#nickname-input')!.focus(); return; }
    playerName = name.slice(0, 20);
    action();
  };
  app.querySelector('#create-room')!.addEventListener('click', () => withNickname(createRoom));
  app.querySelector('#join-room')!.addEventListener('click', () => withNickname(() => joinRoom(app.querySelector<HTMLInputElement>('#room-code-input')!.value)));
  app.querySelector<HTMLInputElement>('#room-code-input')!.addEventListener('input', (event) => {
    const input = event.currentTarget as HTMLInputElement;
    input.value = input.value.replace(/\D/g, '').slice(0, 4);
  });
  app.querySelector<HTMLInputElement>('#room-code-input')!.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      app.querySelector<HTMLButtonElement>('#join-room')!.click();
    }
  });
}

function normalizedRoomCode(input: string) {
  return input.replace(/\D/g, '').slice(0, 4);
}

function formatRoomCode(code: string) {
  return code;
}

function peerIdForRoom(code: string) {
  return `wikisprint-${code.toLowerCase()}`;
}

function newRoomCode() {
  return (crypto.getRandomValues(new Uint16Array(1))[0] % 10_000).toString().padStart(4, '0');
}

function showMultiplayerError(message: string) {
  const error = app.querySelector<HTMLElement>('#multiplayer-error, #room-status, #form-error');
  if (!error) return;
  window.clearTimeout(noticeTimeout);
  error.textContent = message;
  noticeTimeout = window.setTimeout(() => {
    if (error.isConnected && error.textContent === message) error.textContent = '';
  }, 3000);
}

function setupPeerEvents(peer: Peer) {
  peer.on('error', (error) => {
    const message = error.type === 'peer-unavailable'
      ? 'Místnost s tímto kódem neexistuje nebo už není dostupná.'
      : error.type === 'unavailable-id'
        ? 'Tento kód je už obsazený. Zkus vytvořit místnost znovu.'
        : 'Nepodařilo se připojit k online službě. Zkus to za chvíli znovu.';
    showMultiplayerError(message);
    app.querySelectorAll<HTMLButtonElement>('#create-room, #join-room').forEach((button) => { button.disabled = false; });
  });
}

function createRoom() {
  startTitle = '';
  targetTitle = '';
  isMultiplayer = true;
  isRoomHost = true;
  roomStarted = false;
  roomCode = newRoomCode();
  roomStartDraft = null;
  roomTargetDraft = null;
  route = [];
  multiplayerPlayers.clear();
  app.querySelector<HTMLButtonElement>('#create-room')!.disabled = true;
  showMultiplayerError('Vytvářím místnost…');

  const peer = new Peer(peerIdForRoom(roomCode), { debug: 1 });
  currentPeer = peer;
  setupPeerEvents(peer);
  peer.on('open', (id) => {
    roomHostId = id;
    multiplayerPlayers.set(id, { id, name: playerName, clicks: 0, wins: 0, totalClicks: 0, article: '', finished: false, elapsedSeconds: 0, inLobby: true, ready: false });
    peer.on('connection', (connection) => acceptRoomConnection(connection));
    renderRoomLobby();
  });
}

function acceptRoomConnection(connection: DataConnection) {
  roomConnections.set(connection.peer, connection);
  connection.on('data', (data) => {
    const packet = data as RoomPacket;
    if (packet.type === 'join') {
      if (roomStarted || multiplayerPlayers.size >= ROOM_MAX_PLAYERS || [...multiplayerPlayers.values()].some((player) => player.name === packet.name.slice(0, 20))) {
        connection.send({ type: 'error', message: roomStarted ? 'Závod už začal. Počkej na další místnost.' : [...multiplayerPlayers.values()].some((player) => player.name === packet.name.slice(0, 20)) ? 'Tato přezdívka už v místnosti je.' : `Místnost je plná (maximálně ${ROOM_MAX_PLAYERS} hráčů).` });
        connection.close();
        return;
      }
      multiplayerPlayers.set(connection.peer, { id: connection.peer, name: packet.name.slice(0, 20), clicks: 0, wins: 0, totalClicks: 0, article: startTitle, finished: false, elapsedSeconds: 0, inLobby: true, ready: false });
      sendRoomSnapshot(connection);
      broadcastRoomSnapshot();
      renderRoomLobby();
    } else if (packet.type === 'transfer-host' && connection.peer === roomHostId && multiplayerPlayers.has(packet.playerId)) {
      roomHostId = packet.playerId;
      multiplayerPlayers.forEach((player, id) => multiplayerPlayers.set(id, { ...player, ready: false }));
      broadcastRoomSnapshot();
      renderRoomLobby();
    } else if (packet.type === 'kick-request' && connection.peer === roomHostId) {
      kickRoomPlayer(packet.playerId);
    } else if (packet.type === 'start-request' && connection.peer === roomHostId) {
      startMultiplayerRace({ startTitle: packet.startTitle, targetTitle: packet.targetTitle, language: packet.language }, true);
    } else if (packet.type === 'progress') {
      const existing = multiplayerPlayers.get(connection.peer);
      if (!existing || raceWinner) return;
      const finished = packet.finished && packet.article.toLocaleLowerCase() === targetTitle.toLocaleLowerCase();
      multiplayerPlayers.set(connection.peer, { ...existing, clicks: packet.clicks, article: packet.article, finished, elapsedSeconds: packet.elapsedSeconds });
      if (finished) {
        finishMultiplayerRace(connection.peer, packet.elapsedSeconds);
        return;
      }
      broadcastRoomSnapshot();
    } else if (packet.type === 'ready') {
      const player = multiplayerPlayers.get(connection.peer);
      if (!player || roomStarted) return;
      multiplayerPlayers.set(connection.peer, { ...player, ready: packet.ready });
      broadcastRoomSnapshot();
      renderRoomLobby();
    } else if (packet.type === 'return-lobby' && isRoomHost) {
      const player = multiplayerPlayers.get(connection.peer);
      if (!player || !raceWinner) return;
      multiplayerPlayers.set(connection.peer, { ...player, inLobby: true, ready: false });
      syncLobbyReturns();
    }
  });
  connection.on('close', () => {
    roomConnections.delete(connection.peer);
    multiplayerPlayers.delete(connection.peer);
    if (raceWinner) syncLobbyReturns();
    else {
      broadcastRoomSnapshot();
      if (!roomStarted) renderRoomLobby();
    }
  });
}

function joinRoom(codeInput: string) {
  const code = normalizedRoomCode(codeInput);
  if (!/^\d{4}$/.test(code)) { showMultiplayerError('Zadej celý čtyřmístný číselný kód.'); return; }
  roomCode = formatRoomCode(code);
  startTitle = '';
  targetTitle = '';
  isMultiplayer = true;
  isRoomHost = false;
  roomHostId = '';
  roomStarted = false;
  multiplayerPlayers.clear();
  app.querySelector<HTMLButtonElement>('#join-room')!.disabled = true;
  showMultiplayerError('Připojuji se do místnosti…');

  const peer = new Peer({ debug: 1 });
  currentPeer = peer;
  setupPeerEvents(peer);
  peer.on('open', () => {
    const connection = peer.connect(peerIdForRoom(code), { reliable: true });
    hostConnection = connection;
    connection.on('open', () => {
      connection.send({ type: 'join', name: playerName });
      multiplayerPlayers.set(peer.id, { id: peer.id, name: playerName, clicks: 0, wins: 0, totalClicks: 0, article: '', finished: false, elapsedSeconds: 0, inLobby: true, ready: false });
      renderRoomLobby();
    });
    connection.on('data', (data) => handleRoomPacket(data as RoomPacket));
    connection.on('close', () => showMultiplayerError('Spojení s místností bylo přerušeno.'));
    connection.on('error', () => showMultiplayerError('Nepodařilo se připojit. Zkontroluj kód místnosti.'));
  });
}

function roomSnapshot(): RoomPacket {
  return { type: 'room', hostId: roomHostId, startTitle, targetTitle, language, players: [...multiplayerPlayers.values()], started: roomStarted, startsAt: roomStartsAt };
}

function isLocalRoomHost() {
  return Boolean(currentPeer?.id && currentPeer.id === roomHostId);
}

function sendRoomSnapshot(connection: DataConnection) {
  if (connection.open) connection.send(roomSnapshot());
}

function broadcastRoomSnapshot() {
  const snapshot = roomSnapshot();
  roomConnections.forEach((connection) => { if (connection.open) connection.send(snapshot); });
}

function handleRoomPacket(packet: RoomPacket) {
  if (packet.type === 'error') { showMultiplayerError(packet.message); return; }
  if (packet.type === 'kicked') {
    showMultiplayerError(packet.message);
    currentPeer?.destroy();
    currentPeer = null;
    hostConnection = null;
    roomCode = '';
    roomHostId = '';
    isMultiplayer = false;
    renderMultiplayerIntro();
    showMultiplayerError(packet.message);
    return;
  }
  if (packet.type === 'finish') {
    raceWinner = packet.winnerName;
    raceWinnerTime = packet.elapsedSeconds;
    const winner = multiplayerPlayers.get(packet.winnerId);
    if (winner) multiplayerPlayers.set(packet.winnerId, { ...winner, wins: packet.winnerWins, totalClicks: packet.winnerTotalClicks, clicks: packet.winnerClicks });
    if (timerId) window.clearInterval(timerId);
    showMultiplayerWinner();
    return;
  }
  if (packet.type === 'room') {
    roomHostId = packet.hostId;
    startTitle = packet.startTitle;
    targetTitle = packet.targetTitle;
    language = packet.language;
    roomStarted = packet.started;
    roomStartsAt = packet.startsAt;
    multiplayerPlayers = new Map(packet.players.map((player) => [player.id, player] as const));
    if (!roomStarted) {
      raceWinner = '';
      renderRoomLobby();
    } else if (raceWinner && multiplayerPlayers.get(currentPeer?.id ?? '')?.inLobby) {
      renderRoomLobby();
    }
    return;
  }
  if (packet.type === 'start') {
    startTitle = packet.startTitle;
    targetTitle = packet.targetTitle;
    language = packet.language;
    roomStarted = true;
    multiplayerPlayers.forEach((player, id) => multiplayerPlayers.set(id, { ...player, inLobby: false, ready: false }));
    roomStartsAt = Date.now() + packet.countdownMs;
    window.clearTimeout(startTimeout);
    startTimeout = window.setTimeout(beginMultiplayerGame, packet.countdownMs);
  }
}

function renderRoomLobby() {
  const localIsHost = isLocalRoomHost();
  const isConnected = isRoomHost || hostConnection?.open === true;
  const players = [...multiplayerPlayers.values()];
  const leaderboard = [...players].sort((a, b) => b.wins - a.wins || a.totalClicks - b.totalClicks || a.name.localeCompare(b.name));
  const startDraft = roomStartDraft ?? startTitle;
  const targetDraft = roomTargetDraft ?? targetTitle;
  const guestsReady = players.filter((player) => player.id !== roomHostId).every((player) => player.ready);
  const localPlayer = multiplayerPlayers.get(currentPeer?.id ?? '');
  const localIsReady = localPlayer?.ready ?? false;
  const waitingForReturns = roomStarted && Boolean(raceWinner);
  app.innerHTML = `
    <main class="setup-shell welcome-shell room-shell">
      <header class="topbar"><button class="back-button welcome-back" id="leave-room">ZPĚT</button><a class="brand" href="#"><span class="brand-mark">W</span> wiki<span class="brand-light">sprint</span></a><span class="top-note"><i></i> ${isConnected ? 'V MÍSTNOSTI' : 'PŘIPOJOVÁNÍ'}</span></header>
      <section class="hero welcome-hero room-hero setup-hero-centered">
        <section class="leaderboard" aria-label="Žebříček multiplayer místnosti"><div class="leaderboard-heading"><span class="card-label">ŽEBŘÍČEK</span><span class="leaderboard-sort">VÝHRY · KLIKY</span></div><ol class="leaderboard-list">${leaderboard.map((player, index) => `<li><span class="leaderboard-rank">${String(index + 1).padStart(2, '0')}</span><span class="leaderboard-name">${escapeHtml(player.name)}</span><span class="leaderboard-score"><b>${player.wins}</b><small>${player.totalClicks} kliků</small></span></li>`).join('')}</ol></section>
        <div class="route-card welcome-card room-card">
          <div class="card-top"><span class="card-label">KÓD MÍSTNOSTI</span><span class="room-role">${localIsHost ? 'HOSTITEL' : 'HRÁČ'}</span></div>
          <div class="room-code-display" id="room-code-display">${escapeHtml(roomCode)}</div>
          ${localIsHost ? '<button class="mode-button mode-button-secondary copy-room-code" id="copy-room-code"><span>KOPÍROVAT KÓD</span></button>' : ''}
          ${localIsHost && !roomStarted ? `<div class="room-route-editor">
            <button class="mode-button mode-button-secondary random-route-button" id="random-route"><span>VYBRAT NÁHODNOU TRASU</span></button>
            <label class="field-label" for="room-start-input">STARTOVNÍ ČLÁNEK</label><div class="input-wrap"><span class="field-symbol">◉</span><input id="room-start-input" autocomplete="off" placeholder="např. Praha" value="${escapeHtml(startDraft)}"></div>
            <label class="field-label" for="room-target-input">CÍLOVÝ ČLÁNEK</label><div class="input-wrap"><span class="field-symbol target-symbol">◎</span><input id="room-target-input" autocomplete="off" placeholder="např. Měsíc" value="${escapeHtml(targetDraft)}"></div>
            <div class="language-row"><span>JAZYK WIKIPEDIE</span><div class="language-switch"><button class="lang-choice${language === 'cs' ? ' active' : ''}" data-lang="cs">ČEŠTINA</button><button class="lang-choice${language === 'en' ? ' active' : ''}" data-lang="en">ENGLISH</button></div></div>
            <p class="form-error" id="multiplayer-error" aria-live="polite"></p>
          </div>` : `<div class="room-route"><span>TRASA</span><strong>${escapeHtml(startTitle || 'Hostitel nastavuje trasu')}${targetTitle ? ` — ${escapeHtml(targetTitle)}` : ''}</strong><small>${language === 'cs' ? 'ČEŠTINA' : 'ANGLIČTINA'}</small></div>`}
          <div class="room-players-heading"><span class="card-label">HRÁČI</span><span class="room-player-count">${players.length} / ${ROOM_MAX_PLAYERS}</span></div>
          <ul class="room-player-list" id="room-player-list">${players.map((player) => `<li><span class="player-avatar">${escapeHtml(player.name.slice(0, 1).toUpperCase())}</span><span class="player-name">${escapeHtml(player.name)}${player.id === currentPeer?.id ? ' (ty)' : ''}${player.id === roomHostId ? ' · HOSTITEL' : ''}</span><span class="player-state">${roomStarted && raceWinner ? (player.inLobby ? 'V LOBBY' : 'VÝSLEDEK') : player.ready ? 'PŘIPRAVEN/A' : 'ČEKÁ'}</span>${localIsHost && player.id !== currentPeer?.id ? `<button class="transfer-host" data-transfer="${escapeHtml(player.id)}" aria-label="Předat hostitelství hráči ${escapeHtml(player.name)}">PŘEDAT HOSTA</button><button class="kick-player" data-kick="${escapeHtml(player.id)}" aria-label="Vyhodit hráče ${escapeHtml(player.name)}">VYHODIT</button>` : ''}</li>`).join('')}</ul>
          <p class="room-status" id="room-status">${waitingForReturns ? 'Počkej, až se všichni vrátí z výsledku.' : localIsHost ? (!startTitle ? 'Nastav trasu a pozvi další hráče.' : players.length < 2 ? 'Čekám na další hráče…' : guestsReady ? 'Všichni jsou připraveni.' : 'Čekám, až se hráči připraví…') : roomStarted ? 'Do lobby ses vrátil/a. Čekám na ostatní…' : localIsReady ? 'Jsi připraven/a. Čekám na start hostitele.' : 'Až budeš připraven/a, klikni na tlačítko níže.'}</p>
          ${localIsHost ? `<button class="start-button mode-button" id="start-multiplayer" ${players.length < 2 || !guestsReady || roomStarted ? 'disabled' : ''}><span>START</span></button>` : `<button class="start-button mode-button" id="toggle-ready" ${waitingForReturns ? 'disabled' : ''}><span>${localIsReady ? 'ZRUŠIT PŘIPRAVENOST' : 'PŘIPRAVIT'}</span></button>`}
        </div>
      </section>
      <footer class="site-footer"><span>© WIKI SPRINT</span><span>HRÁČI SE PŘIPOJUJÍ PŘES PEER-TO-PEER</span></footer>
    </main>`;
  app.querySelector('#leave-room')!.addEventListener('click', goHome);
  app.querySelector('#copy-room-code')?.addEventListener('click', () => {
    if (!navigator.clipboard) { showMultiplayerError(`Kód místnosti: ${roomCode}`); return; }
    void navigator.clipboard.writeText(roomCode).then(() => showMultiplayerError('Kód místnosti zkopírován.')).catch(() => showMultiplayerError(`Kód místnosti: ${roomCode}`));
  });
  app.querySelector('#start-multiplayer')?.addEventListener('click', () => startMultiplayerRace());
  app.querySelector('#toggle-ready')?.addEventListener('click', toggleReady);
  app.querySelector('#random-route')?.addEventListener('click', () => { void chooseRandomRoute(); });
  app.querySelector<HTMLInputElement>('#room-start-input')?.addEventListener('input', (event) => { roomStartDraft = (event.currentTarget as HTMLInputElement).value; });
  app.querySelector<HTMLInputElement>('#room-target-input')?.addEventListener('input', (event) => { roomTargetDraft = (event.currentTarget as HTMLInputElement).value; });
  app.querySelectorAll<HTMLButtonElement>('.lang-choice').forEach((button) => button.addEventListener('click', () => {
    language = button.dataset.lang ?? 'cs';
    app.querySelectorAll('.lang-choice').forEach((choice) => choice.classList.toggle('active', choice === button));
  }));
  app.querySelectorAll<HTMLButtonElement>('.kick-player').forEach((button) => button.addEventListener('click', () => kickRoomPlayer(button.dataset.kick ?? '')));
  app.querySelectorAll<HTMLButtonElement>('.transfer-host').forEach((button) => button.addEventListener('click', () => transferRoomHost(button.dataset.transfer ?? '')));
}

async function chooseRandomRoute(startSelector = '#room-start-input', targetSelector = '#room-target-input', buttonSelector = '#random-route') {
  const button = app.querySelector<HTMLButtonElement>(buttonSelector);
  const titles = language === 'en' ? randomArticles.en : randomArticles.cs;
  if (!button) return;
  button.disabled = true;
  try {
    const endpoint = `https://${language}.wikipedia.org/w/api.php?action=query&list=random&rnnamespace=0&rnlimit=2&format=json&origin=*`;
    const response = await fetch(endpoint);
    if (!response.ok) throw new Error('Wikipedie teď neodpovídá.');
    const data = await response.json() as { query?: { random?: Array<{ title: string }> } };
    const randomTitles = data.query?.random?.map((article) => article.title) ?? [];
    if (randomTitles.length < 2) throw new Error('Články se nepodařilo náhodně vybrat.');
    setRouteDraft(randomTitles[0], randomTitles[1], startSelector, targetSelector);
  } catch {
    const firstIndex = Math.floor(Math.random() * titles.length);
    let secondIndex = Math.floor(Math.random() * (titles.length - 1));
    if (secondIndex >= firstIndex) secondIndex += 1;
    setRouteDraft(titles[firstIndex], titles[secondIndex], startSelector, targetSelector);
    showMultiplayerError('Náhodné články vybrány z nabídky.');
  } finally {
    if (button.isConnected) button.disabled = false;
  }
}

function setRouteDraft(start: string, target: string, startSelector = '#room-start-input', targetSelector = '#room-target-input') {
  if (startSelector === '#room-start-input') roomStartDraft = start;
  if (targetSelector === '#room-target-input') roomTargetDraft = target;
  const startInput = app.querySelector<HTMLInputElement>(startSelector);
  const targetInput = app.querySelector<HTMLInputElement>(targetSelector);
  if (startInput) startInput.value = start;
  if (targetInput) targetInput.value = target;
}

function kickRoomPlayer(playerId: string) {
  if ((!isRoomHost && !isLocalRoomHost()) || !playerId) return;
  if (!isRoomHost) { hostConnection?.send({ type: 'kick-request', playerId }); return; }
  const connection = roomConnections.get(playerId);
  connection?.send({ type: 'kicked', message: 'Hostitel tě odebral z místnosti.' });
  window.setTimeout(() => connection?.close(), 100);
  roomConnections.delete(playerId);
  multiplayerPlayers.delete(playerId);
  if (raceWinner) syncLobbyReturns();
  else {
    broadcastRoomSnapshot();
    renderRoomLobby();
  }
}

function transferRoomHost(playerId: string) {
  if (!isLocalRoomHost() || !playerId || !multiplayerPlayers.has(playerId)) return;
  if (!isRoomHost) { hostConnection?.send({ type: 'transfer-host', playerId }); return; }
  roomHostId = playerId;
  multiplayerPlayers.forEach((player, id) => multiplayerPlayers.set(id, { ...player, ready: false }));
  broadcastRoomSnapshot();
  renderRoomLobby();
}

function startMultiplayerRace(routeSelection?: { startTitle: string; targetTitle: string; language: string }, fromCoordinator = false) {
  const guestsReady = [...multiplayerPlayers.values()].filter((player) => player.id !== roomHostId).every((player) => player.ready);
  if ((!isLocalRoomHost() && !(isRoomHost && fromCoordinator)) || multiplayerPlayers.size < 2 || !guestsReady || roomStarted) return;
  const start = cleanTitle(routeSelection?.startTitle ?? app.querySelector<HTMLInputElement>('#room-start-input')?.value ?? startTitle);
  const target = cleanTitle(routeSelection?.targetTitle ?? app.querySelector<HTMLInputElement>('#room-target-input')?.value ?? targetTitle);
  if (!start || !target) { showMultiplayerError('Vyplň startovní i cílový článek.'); return; }
  if (start.toLocaleLowerCase() === target.toLocaleLowerCase()) { showMultiplayerError('Start a cíl musí být dva různé články.'); return; }
  if (!isRoomHost) {
    hostConnection?.send({ type: 'start-request', startTitle: start, targetTitle: target, language });
    return;
  }
  startTitle = start;
  targetTitle = target;
  language = routeSelection?.language ?? language;
  roomStartDraft = start;
  roomTargetDraft = target;
  route = [start];
  raceWinner = '';
  raceWinnerTime = 0;
  roomStarted = true;
  multiplayerPlayers.forEach((player, id) => multiplayerPlayers.set(id, { ...player, inLobby: false, ready: false }));
  roomStartsAt = Date.now() + 3000;
  const packet: RoomPacket = { type: 'start', startTitle, targetTitle, language, countdownMs: 3000 };
  roomConnections.forEach((connection) => { if (connection.open) connection.send(packet); });
  startTimeout = window.setTimeout(beginMultiplayerGame, Math.max(0, roomStartsAt - Date.now()));
}

function beginMultiplayerGame() {
  if (!isMultiplayer) return;
  clicks = 0;
  currentTitle = '';
  route = [startTitle];
  startedAt = roomStartsAt || Date.now();
  renderGame();
  void loadArticle(startTitle, false);
}

function reportMultiplayerProgress(article: string) {
  if (!isMultiplayer || !currentPeer || raceWinner) return;
  const previousScore = multiplayerPlayers.get(currentPeer.id);
  const player: MultiplayerPlayer = {
    id: currentPeer.id,
    name: playerName,
    clicks,
    wins: previousScore?.wins ?? 0,
    totalClicks: previousScore?.totalClicks ?? 0,
    article,
    finished: article.toLocaleLowerCase() === targetTitle.toLocaleLowerCase(),
    elapsedSeconds: Math.max(0, Math.floor((Date.now() - startedAt) / 1000)),
    inLobby: false,
    ready: false,
  };
  if (isRoomHost) {
    multiplayerPlayers.set(player.id, player);
    if (player.finished) {
      finishMultiplayerRace(player.id, player.elapsedSeconds);
      return;
    }
    broadcastRoomSnapshot();
  } else {
    hostConnection?.send({ type: 'progress', name: player.name, clicks: player.clicks, article: player.article, finished: player.finished, elapsedSeconds: player.elapsedSeconds });
  }
}

function toggleReady() {
  if (roomStarted || !currentPeer) return;
  const player = multiplayerPlayers.get(currentPeer.id);
  if (!player) return;
  const ready = !player.ready;
  multiplayerPlayers.set(currentPeer.id, { ...player, ready });
  hostConnection?.send({ type: 'ready', ready });
  renderRoomLobby();
}

function finishMultiplayerRace(winnerId: string, elapsedSeconds: number) {
  if (!isRoomHost || raceWinner) return;
  const winner = multiplayerPlayers.get(winnerId);
  if (!winner) return;
  const winnerClicks = winner.clicks;
  const updatedWinner = { ...winner, wins: winner.wins + 1, totalClicks: winner.totalClicks + winnerClicks };
  multiplayerPlayers.set(winnerId, updatedWinner);
  raceWinner = winner.name;
  raceWinnerTime = elapsedSeconds;
  const packet: RoomPacket = { type: 'finish', winnerId, winnerName: winner.name, elapsedSeconds, winnerWins: updatedWinner.wins, winnerTotalClicks: updatedWinner.totalClicks, winnerClicks };
  roomConnections.forEach((connection) => { if (connection.open) connection.send(packet); });
  if (timerId) window.clearInterval(timerId);
  showMultiplayerWinner();
}

function showMultiplayerWinner() {
  const overlay = app.querySelector<HTMLDivElement>('#result-overlay');
  if (!overlay) return;
  overlay.classList.remove('hidden');
  overlay.innerHTML = `<div class="result-card multiplayer-result"><div class="result-symbol">✳</div><p class="eyebrow">ZÁVOD UKONČEN</p><h2>${escapeHtml(raceWinner)} vyhrál/a!</h2><p class="result-copy">${escapeHtml(raceWinner)} dorazil/a do cíle jako první.</p><div class="result-stats"><div><span>VÍTĚZŮV ČAS</span><strong>${formatTime(raceWinnerTime)}</strong></div><div><span>CÍL</span><strong class="winner-goal">${escapeHtml(targetTitle)}</strong></div></div><button class="start-button" id="return-to-lobby"><span>ZPĚT DO LOBBY</span></button></div>`;
  overlay.querySelector('#return-to-lobby')!.addEventListener('click', () => {
    returnPlayerToLobby();
  });
}

function returnPlayerToLobby() {
  if (!currentPeer || !raceWinner) return;
  const player = multiplayerPlayers.get(currentPeer.id);
  if (player) multiplayerPlayers.set(currentPeer.id, { ...player, inLobby: true, ready: false });
  if (isRoomHost) syncLobbyReturns();
  else {
    hostConnection?.send({ type: 'return-lobby' });
    renderRoomLobby();
  }
}

function syncLobbyReturns() {
  if (!isRoomHost) return;
  const allPlayersReturned = multiplayerPlayers.size > 0 && [...multiplayerPlayers.values()].every((player) => player.inLobby);
  if (allPlayersReturned) {
    if (timerId) window.clearInterval(timerId);
    roomStarted = false;
    raceWinner = '';
    raceWinnerTime = 0;
    clicks = 0;
    currentTitle = '';
    route = [startTitle];
    multiplayerPlayers.forEach((player, id) => multiplayerPlayers.set(id, {
      ...player, clicks: 0, article: startTitle, finished: false, elapsedSeconds: 0, inLobby: true, ready: false,
    }));
  }
  broadcastRoomSnapshot();
  if (allPlayersReturned || multiplayerPlayers.get(roomHostId)?.inLobby) renderRoomLobby();
}

function renderRouteSetup() {
  app.innerHTML = `
    <main class="setup-shell">
      <header class="topbar"><button class="back-button welcome-back" id="back-to-modes">ZPĚT</button><a class="brand" href="#"><span class="brand-mark">W</span> wiki<span class="brand-light">sprint</span></a><span class="top-note"><i></i> SINGLEPLAYER</span></header>
      <section class="hero setup-hero-centered">
        <div class="route-card">
          <div class="card-top welcome-card-top"></div>
          <button class="mode-button mode-button-secondary random-route-button" id="random-solo-route"><span>VYBRAT NÁHODNOU TRASU</span></button>
          <label class="field-label" for="start-input">STARTOVNÍ ČLÁNEK</label>
          <div class="input-wrap"><span class="field-symbol">◉</span><input id="start-input" autocomplete="off" placeholder="např. Praha" required aria-required="true"></div>
          <div class="route-connector"><span></span><small>TVÁ CESTA</small><span></span></div>
          <label class="field-label" for="target-input">CÍLOVÝ ČLÁNEK</label>
          <div class="input-wrap"><span class="field-symbol target-symbol">◎</span><input id="target-input" autocomplete="off" placeholder="např. Měsíc" required aria-required="true"></div>
          <div class="language-row"><span>JAZYK WIKIPEDIE</span><div class="language-switch"><button class="lang-choice active" data-lang="cs">ČEŠTINA</button><button class="lang-choice" data-lang="en">ENGLISH</button></div></div>
          <button class="start-button" id="start-game"><span>VYRAZIT NA CESTU</span></button>
          <p class="microcopy">Bez vyhledávání během hry. Jen ty a odkazy.</p>
          <p class="form-error" id="form-error" aria-live="polite"></p>
        </div>
      </section>
      <section class="how-row"><div><span class="how-num">01</span><strong>Vyber si trasu</strong><small>Zadej dva články Wikipedie.</small></div><div><span class="how-num">02</span><strong>Proklikávej se</strong><small>Každý odkaz je další krok.</small></div><div><span class="how-num">03</span><strong>Doraz do cíle</strong><small>Sleduj čas i počet kliknutí.</small></div><div class="how-aside">WIKIPEDIE JE VĚTŠÍ,<br>NEŽ SI MYSLÍŠ.</div></section>
      <footer class="site-footer"><span>© WIKI SPRINT</span><span>POSTAVENO ZVĚDAVOSTÍ <b>✳</b></span></footer>
    </main>`;
  const startInput = app.querySelector<HTMLInputElement>('#start-input')!;
  const targetInput = app.querySelector<HTMLInputElement>('#target-input')!;
  app.querySelector('#random-solo-route')!.addEventListener('click', () => { void chooseRandomRoute('#start-input', '#target-input', '#random-solo-route'); });
  app.querySelector('#back-to-modes')!.addEventListener('click', renderWelcome);
  app.querySelectorAll<HTMLButtonElement>('.lang-choice').forEach((button) => button.addEventListener('click', () => {
    language = button.dataset.lang ?? 'cs';
    app.querySelectorAll('.lang-choice').forEach((choice) => choice.classList.toggle('active', choice === button));
  }));
  app.querySelector<HTMLButtonElement>('#start-game')!.addEventListener('click', () => {
    const start = cleanTitle(startInput.value);
    const target = cleanTitle(targetInput.value);
    const error = app.querySelector<HTMLParagraphElement>('#form-error')!;
    if (!start || !target) { error.textContent = 'Vyplň oba články a můžeš vyrazit.'; return; }
    if (start.toLocaleLowerCase() === target.toLocaleLowerCase()) { error.textContent = 'Start a cíl musí být dva různé články.'; return; }
    startTitle = start;
    targetTitle = target;
    clicks = 0;
    route = [start];
    startedAt = Date.now();
    renderGame();
    void loadArticle(start, false);
  });
  [startInput, targetInput].forEach((input) => input.addEventListener('keydown', (event) => { if (event.key === 'Enter') app.querySelector<HTMLButtonElement>('#start-game')!.click(); }));
}

function formatTime(seconds: number) {
  const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
  const secs = (seconds % 60).toString().padStart(2, '0');
  return `${mins}:${secs}`;
}

function renderGame() {
  app.innerHTML = `
    <main class="game-shell">
      <header class="game-topbar"><button class="back-button" id="quit-game">ZPĚT</button><a class="brand" href="#"><span class="brand-mark">W</span> wiki<span class="brand-light">sprint</span></a><div class="game-status"><i></i> PROBÍHÁ HRA</div><button class="give-up" id="give-up">VZDÁT TO</button></header>
      <div class="game-layout">
        <section class="wiki-panel"><div class="browser-bar"><span class="browser-dots"><i></i><i></i><i></i></span><div class="browser-address"><span>⌕</span><span class="address-text">cs.wikipedia.org/wiki/${escapeHtml(startTitle.replaceAll(' ', '_'))}</span><button id="open-original" title="Otevřít originál">Otevřít</button></div><button class="reload-article" id="reload-article" title="Obnovit článek">Obnovit</button></div><div id="article-content" class="article-content"><div class="article-loading"><span class="loader"></span><p>NAČÍTÁM WIKIPEDII…</p></div></div></section>
        <aside class="hud"><div class="hud-heading"><span>TVŮJ ZÁVOD</span><span class="hud-live"><i></i> LIVE</span></div>
          <div class="timer-card"><div class="timer-label">UPLYNULÝ ČAS</div><div id="timer" class="timer">00:00</div><div class="timer-foot"><span class="pulse-dot"></span> ČAS BĚŽÍ</div></div>
          <div class="goal-card"><span class="goal-kicker">DOSTAŇ SE NA ČLÁNEK</span><div class="goal-title" id="goal-title">${escapeHtml(targetTitle)}</div><a id="goal-link" href="${wikiUrl(targetTitle)}" target="_blank" rel="noreferrer">ZOBRAZIT ČLÁNEK</a></div>
          <div class="stats-row"><div class="stat-card"><span>PROKLIKNUTÍ</span><strong id="click-count">00</strong></div></div>
          <div class="route-card-small"><div class="route-small-title">TVOJE TRASA</div><ol id="route-list"><li><i class="route-dot start-dot"></i><span class="route-item">${escapeHtml(startTitle)}</span><b>START</b></li></ol></div>
          <button class="new-game" id="new-game">NOVÁ HRA</button>
        </aside>
      </div>
      <footer class="game-footer"><span>WIKI SPRINT <b>✳</b></span><span>ČLÁNKY POSKYTUJE WIKIPEDIE</span><span id="current-language">${language === 'cs' ? 'ČESKÁ' : 'ANGLICKÁ'} VERZE</span></footer>
      <div id="result-overlay" class="result-overlay hidden" role="dialog" aria-modal="true"></div>
    </main>`;
  if (timerId) window.clearInterval(timerId);
  timerId = window.setInterval(() => {
    const timer = app.querySelector<HTMLDivElement>('#timer');
    if (timer) timer.textContent = formatTime(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
  }, 250);
  app.querySelector('#quit-game')!.addEventListener('click', () => confirmExit());
  app.querySelector('#give-up')!.addEventListener('click', () => confirmSurrender());
  app.querySelector('#new-game')!.addEventListener('click', () => confirmExit());
  app.querySelector('#reload-article')!.addEventListener('click', () => { if (currentTitle) void loadArticle(currentTitle, false); });
  app.querySelector('#open-original')!.addEventListener('click', () => window.open(wikiUrl(currentTitle || startTitle), '_blank', 'noopener,noreferrer'));
}

async function loadArticle(title: string, isClick: boolean) {
  if (loading) return;
  loading = true;
  const content = app.querySelector<HTMLDivElement>('#article-content');
  const address = app.querySelector<HTMLSpanElement>('.address-text');
  if (!content) { loading = false; return; }
  content.innerHTML = '<div class="article-loading"><span class="loader"></span><p>NAČÍTÁM ČLÁNEK…</p></div>';
  try {
    const endpoint = `https://${language}.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&prop=text%7Cdisplaytitle&format=json&origin=*&redirects=1`;
    const response = await fetch(endpoint);
    if (!response.ok) throw new Error('Nepodařilo se spojit s Wikipedií.');
    const data = await response.json() as { parse?: { title: string; text: { '*': string }; displaytitle: string }; error?: { info: string } };
    if (!data.parse) throw new Error(data.error?.info ?? 'Článek se nepodařilo najít. Zkontroluj jeho název.');
    const parsed: WikiArticle = { title: data.parse.title, html: data.parse.text['*'], url: wikiUrl(data.parse.title) };
    currentTitle = parsed.title;
    if (address) address.textContent = `${language}.wikipedia.org/wiki/${parsed.title.replaceAll(' ', '_')}`;
    content.innerHTML = `<div class="wiki-content"><div class="wiki-brand"><span class="wiki-globe">◎</span><div>WIKIPEDIA<small>The Free Encyclopedia</small></div></div><h1>${data.parse.displaytitle}</h1><div class="wiki-subtitle">Z Wikipedie, otevřené encyklopedie</div><div class="wiki-body">${parsed.html}</div></div>`;
    content.querySelectorAll<HTMLAnchorElement>('.wiki-body a').forEach((anchor) => {
      const href = anchor.getAttribute('href');
      const match = href?.match(/(?:\.\/wiki\/|\/wiki\/)([^#?]+)/);
      if (!match || anchor.classList.contains('new')) { anchor.removeAttribute('href'); anchor.classList.add('non-game-link'); return; }
      const articleName = decodeURIComponent(match[1]).replaceAll('_', ' ');
      anchor.href = '#';
      anchor.dataset.article = articleName;
      anchor.addEventListener('click', (event) => { event.preventDefault(); void navigateToArticle(articleName); });
    });
    if (isClick && !route.some((item) => item.toLocaleLowerCase() === parsed.title.toLocaleLowerCase())) route.push(parsed.title);
    else if (!isClick && route.length === 1) route[0] = parsed.title;
    updateHud();
    if (parsed.title.toLocaleLowerCase() === targetTitle.toLocaleLowerCase() && !isMultiplayer) showResult(true);
  } catch (error) {
    content.innerHTML = `<div class="article-error"><span>!</span><h2>Článek se nenačetl</h2><p>${escapeHtml(error instanceof Error ? error.message : 'Zkus to prosím znovu.')}</p><button id="retry-load">ZKUSIT ZNOVU</button></div>`;
    content.querySelector('#retry-load')?.addEventListener('click', () => void loadArticle(title, isClick));
  } finally { loading = false; }
}

async function navigateToArticle(title: string) {
  clicks += 1;
  if (!route.some((item) => item.toLocaleLowerCase() === title.toLocaleLowerCase())) route.push(title);
  updateHud();
  await loadArticle(title, true);
  reportMultiplayerProgress(currentTitle || title);
}

function updateHud() {
  const clickCount = app.querySelector<HTMLElement>('#click-count');
  const routeList = app.querySelector<HTMLOListElement>('#route-list');
  if (clickCount) clickCount.textContent = clicks.toString().padStart(2, '0');
  if (routeList) routeList.innerHTML = route.map((title, index) => `<li><i class="route-dot ${index === 0 ? 'start-dot' : ''}"></i><span class="route-item">${escapeHtml(title)}</span>${index === 0 ? '<b>START</b>' : ''}</li>`).join('');
  const target = app.querySelector<HTMLElement>('#goal-title');
  if (target) target.textContent = targetTitle;
}

function showResult(won: boolean) {
  if (timerId) window.clearInterval(timerId);
  const elapsed = formatTime(Math.floor((Date.now() - startedAt) / 1000));
  const overlay = app.querySelector<HTMLDivElement>('#result-overlay');
  if (!overlay) return;
  overlay.classList.remove('hidden');
  overlay.innerHTML = `<div class="result-card"><button id="close-result" class="result-close" aria-label="Zavřít">×</button><div class="result-symbol">✳</div><p class="eyebrow">${won ? 'CÍL DORUČEN' : 'KAŽDÁ CESTA NĚCO NAUČÍ'}</p><h2>${won ? 'To byla jízda.' : 'Závod ukončen.'}</h2><p class="result-copy">${won ? `Dostal/a ses z článku <b>${escapeHtml(startTitle)}</b> až na <b>${escapeHtml(targetTitle)}</b>.` : `Tvůj cíl byl článek <b>${escapeHtml(targetTitle)}</b>. Zkus trasu znovu a najdi jinou cestu.`}</p><div class="result-stats"><div><span>ČAS</span><strong>${elapsed}</strong></div><div><span>KLIKNUTÍ</span><strong>${clicks.toString().padStart(2, '0')}</strong></div></div><button class="start-button" id="result-new-game"><span>${isMultiplayer ? 'OPUSTIT MÍSTNOST' : 'JEŠTĚ JEDEN ZÁVOD'}</span></button><button class="text-button" id="result-home">ZMĚNIT TRASU</button></div>`;
  overlay.querySelector('#close-result')!.addEventListener('click', () => overlay.classList.add('hidden'));
  overlay.querySelector('#result-new-game')!.addEventListener('click', () => {
    if (isMultiplayer) { goHome(); return; }
    overlay.classList.add('hidden'); startedAt = Date.now(); clicks = 0; route = [startTitle]; renderGame(); void loadArticle(startTitle, false);
  });
  overlay.querySelector('#result-home')!.addEventListener('click', goHome);
}

function confirmExit() {
  if (clicks === 0 && !currentTitle) { goHome(); return; }
  const overlay = app.querySelector<HTMLDivElement>('#result-overlay')!;
  overlay.classList.remove('hidden');
  overlay.innerHTML = `<div class="result-card confirm-card"><button id="close-result" class="result-close" aria-label="Zavřít">×</button><div class="result-symbol">✳</div><p class="eyebrow">OPUSTIT ZÁVOD?</p><h2>Už teď končíš?</h2><p class="result-copy">Dosavadní čas a trasa se po opuštění smažou.</p><button class="start-button" id="confirm-home"><span>OPUSTIT HRU</span></button><button class="text-button" id="keep-playing">POKRAČOVAT VE HŘE</button></div>`;
  overlay.querySelector('#close-result')!.addEventListener('click', () => overlay.classList.add('hidden'));
  overlay.querySelector('#keep-playing')!.addEventListener('click', () => overlay.classList.add('hidden'));
  overlay.querySelector('#confirm-home')!.addEventListener('click', goHome);
}

function confirmSurrender() {
  const overlay = app.querySelector<HTMLDivElement>('#result-overlay');
  if (!overlay) return;
  overlay.classList.remove('hidden');
  overlay.innerHTML = `<div class="result-card confirm-card"><button id="close-result" class="result-close" aria-label="Zavřít">×</button><div class="result-symbol">✳</div><p class="eyebrow">VZDÁT ZÁVOD?</p><h2>Opravdu to chceš vzdát?</h2><p class="result-copy">Dosavadní čas a trasa se ukončí. Vrátíš se na nastavení singleplayeru.</p><button class="start-button" id="confirm-surrender"><span>VZDÁT A ZPĚT NA SINGLEPLAYER</span></button><button class="text-button" id="keep-playing">POKRAČOVAT VE HŘE</button></div>`;
  overlay.querySelector('#close-result')!.addEventListener('click', () => overlay.classList.add('hidden'));
  overlay.querySelector('#keep-playing')!.addEventListener('click', () => overlay.classList.add('hidden'));
  overlay.querySelector('#confirm-surrender')!.addEventListener('click', () => {
    if (timerId) window.clearInterval(timerId);
    clicks = 0;
    currentTitle = '';
    route = [];
    renderRouteSetup();
  });
}

function goHome() {
  if (timerId) window.clearInterval(timerId);
  if (startTimeout) window.clearTimeout(startTimeout);
  window.clearTimeout(noticeTimeout);
  currentPeer?.destroy();
  currentPeer = null;
  hostConnection = null;
  roomConnections.clear();
  multiplayerPlayers.clear();
  isMultiplayer = false;
  isRoomHost = false;
  roomStarted = false;
  roomCode = '';
  roomHostId = '';
  roomStartsAt = 0;
  raceWinner = '';
  raceWinnerTime = 0;
  roomStartDraft = null;
  roomTargetDraft = null;
  startTitle = '';
  targetTitle = '';
  currentTitle = '';
  clicks = 0;
  route = [];
  loading = false;
  renderWelcome();
}

function initializeTheme() {
  try {
    const savedTheme = localStorage.getItem('wiki-sprint-theme');
    if (savedTheme === 'dark' || savedTheme === 'light') selectedTheme = savedTheme;
  } catch {
    selectedTheme = 'light';
  }
  applyTheme();
}

function applyTheme() {
  document.body.classList.toggle('theme-light', selectedTheme === 'light');
  document.documentElement.style.colorScheme = selectedTheme;
}

initializeTheme();
renderWelcome();
