const qs = s => document.querySelector(s);
const qsa = s => Array.from(document.querySelectorAll(s));

let screen = 0;
let ably, channelControl, channelEvents, channelState;
let player = 0;
let lobbyId = "";
let selectedAttackIdx = null;
let selectedCharacter = null;
let selectedStackIndex = null;
let catalog = [];

// ---- Backend URL anpassen, wenn du den Server hostest ----
const BASE_URL = localStorage.getItem("OSJA_BASE_URL") || "http://localhost:8000";

function showScreen(n) {
  qsa(".screen").forEach(el => el.classList.add("hidden"));
  qs(`[data-screen="${n}"]`).classList.remove("hidden");
  screen = n;
}

function pushMessage(text) {
  const m = qs("#messages");
  const div = document.createElement("div");
  div.textContent = text;
  m.appendChild(div);
}

async function ablyConnect() {
  const res = await fetch(`${BASE_URL}/auth`);
  const token = await res.json();
  ably = new Ably.Realtime.Promise({ tokenDetails: token });
}

function makeChannels() {
  channelControl = ably.channels.get(`osja:${lobbyId}:p${player}:control`);
  channelEvents  = ably.channels.get(`osja:${lobbyId}:p${player}:events`);
  channelState   = ably.channels.get(`osja:${lobbyId}:state`);

  channelControl.subscribe(msg => {
    const { name, data } = msg;
    switch (name) {
      case "message":
        pushMessage(data.text);
        break;
      case "ask_atk_target":
        channelEvents.publish("atk_target", {
          character_id: selectedCharacter?.id ?? null,
          attack_index: selectedAttackIdx
        });
        break;
      case "ask_character_target":
        channelEvents.publish("character_target", {
          character_id: selectedCharacter?.id ?? null
        });
        break;
      case "ask_stack_target":
        channelEvents.publish("stack_target", { stack_index: selectedStackIndex });
        break;
      case "win":
        qs("#winnerBanner").textContent = "Du hast gewonnen!";
        showScreen(4);
        break;
    }
  });

  channelState.subscribe(msg => {
    if (msg.name === "state") {
      renderState(msg.data);
    }
  });
}

function renderCatalog(attacks) {
  const wrap = qs("#attacksContainer");
  wrap.innerHTML = "";
  // nur type=0 (normale) anzeigen
  const normals = attacks.filter(a => a.type === 0);
  normals.forEach(a => {
    const div = document.createElement("div");
    div.className = "card";
    div.innerHTML = `<strong>${a.name}</strong><div>${a.text}</div>`;
    div.onclick = () => {
      div.classList.toggle("selected");
      const selected = qsa("#attacksContainer .card.selected");
      const names = selected.map(d => d.querySelector("strong").textContent);
      const limit = names.includes("Verführerisches Angebot") ? 6 : 4;
      if (selected.length > limit) {
        div.classList.remove("selected");
        pushMessage(`Maximal ${limit} Attacken wählbar.`);
      }
    };
    wrap.appendChild(div);
  });
}

function renderState(state) {
  // Kopfleiste
  qs("#turnNum").textContent = state.turn ?? "-";
  qs("#turnPhase").textContent = state.phase ?? "-";
  qs("#priorityName").textContent = state.priorityName ?? "-";

  // Stack
  const stackList = qs("#stackList");
  stackList.innerHTML = "";
  (state.stack || []).forEach((it, idx) => {
    const li = document.createElement("li");
    li.textContent = `${it.name} (${it.owner})`;
    li.className = "card";
    li.onclick = () => {
      selectedStackIndex = idx;
      qsa("#stackList .card").forEach(x => x.classList.remove("selected"));
      li.classList.add("selected");
    };
    stackList.appendChild(li);
  });

  // Friends / Foes
  const friends = qs("#friends"); friends.innerHTML = "";
  const foes = qs("#foes"); foes.innerHTML = "";
  (state.friends || []).forEach(ch => {
    const div = document.createElement("div");
    div.className = "card";
    div.textContent = `${ch.name} (${ch.hp}/${ch.max})`;
    div.onclick = () => {
      selectedCharacter = { id: ch.id, side: "friend" };
      qsa("#friends .card, #foes .card").forEach(x => x.classList.remove("selected"));
      div.classList.add("selected");
      // Beim Klick auf Freund: eigene Attacken anzeigen
      renderAttacks(state.self_attacks || []);
    };
    friends.appendChild(div);
  });
  (state.foes || []).forEach(ch => {
    const div = document.createElement("div");
    div.className = "card";
    div.textContent = `${ch.name} (${ch.hp}/${ch.max})`;
    div.onclick = () => {
      selectedCharacter = { id: ch.id, side: "foe" };
      qsa("#friends .card, #foes .card").forEach(x => x.classList.remove("selected"));
      div.classList.add("selected");
      // Beim Klick auf Gegner: bekannte Gegner-Attacken zeigen
      renderAttacks(state.opp_known_attacks || []);
    };
    foes.appendChild(div);
  });

  // Bekannte Gegner-Attacken (Screen 2)
  const known = qs("#knownOppAttacks");
  if (known) {
    known.innerHTML = "";
    (state.opp_known_attacks || []).forEach(a => {
      const div = document.createElement("div");
      div.className = "card";
      div.innerHTML = `<strong>${a.name}</strong><div>${a.text}</div>`;
      known.appendChild(div);
    });
  }
}

function renderAttacks(list) {
  const panel = qs("#attacksPanel");
  panel.innerHTML = "";
  list.forEach((a, i) => {
    const div = document.createElement("div");
    div.className = "card";
    div.innerHTML = `<strong>${a.name}</strong><div>${a.text}</div>`;
    div.onclick = () => {
      selectedAttackIdx = i;
      qsa("#attacksPanel .card").forEach(x => x.classList.remove("selected"));
      div.classList.add("selected");
    };
    panel.appendChild(div);
  });
}

// --- Screen 0 ---
qs("#btnJoin").onclick = async () => {
  const name = qs("#name").value.trim();
  lobbyId = qs("#lobby").value.trim();
  player = parseInt(qs("#playerIdx").value, 10);

  if (!name || !lobbyId) {
    pushMessage("Bitte Name und Lobby-Code ausfüllen.");
    return;
  }
  await ablyConnect();
  makeChannels();

  await fetch(`${BASE_URL}/lobby/create`, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({ lobby_id: lobbyId })
  }).catch(()=>{});

  const res = await fetch(`${BASE_URL}/lobby/join`, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({ lobby_id: lobbyId, name, player })
  });
  const data = await res.json();
  if (!data.ok) {
    pushMessage("Lobby voll oder Join fehlgeschlagen.");
    return;
  }

  // Katalog laden
  const cat = await fetch(`${BASE_URL}/catalog`).then(r=>r.json());
  catalog = cat.attacks || [];
  renderCatalog(catalog);

  showScreen(1);
};

// --- Screen 1: Attackenwahl ---
qs("#btnConfirmAttacks").onclick = async () => {
  const selected = qsa("#attacksContainer .card.selected")
    .map(d => d.querySelector("strong").textContent);
  if (selected.length === 0) {
    pushMessage("Bitte wähle mindestens 1 Attacke.");
    return;
  }
  const res = await fetch(`${BASE_URL}/choose_attacks`, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({ lobby_id: lobbyId, player, attacks: selected })
  });
  const data = await res.json();
  if (!data.ok) {
    pushMessage(data.detail || "Fehler bei Wahl.");
    return;
  }
  showScreen(2);
};

// --- Screen 2: Leben zahlen ---
qs("#btnPay").onclick = async () => {
  const pay = parseInt(qs("#pay").value, 10) || 0;
  const stop_start = qs("#cb_start").checked;
  const stop_end = qs("#cb_end").checked;
  const stop_react = qs("#cb_react").checked;
  const res = await fetch(`${BASE_URL}/pay`, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({ lobby_id: lobbyId, player, pay, stop_start, stop_end, stop_react })
  });
  const data = await res.json();
  if (!data.ok) {
    pushMessage(data.detail || "Fehler beim Bezahlen.");
    return;
  }
  showScreen(3);
};

// --- Screen 3: Flags live setzen ---
["cb_start_3","cb_end_3","cb_react_3"].forEach(id => {
  qs(`#${id}`).addEventListener("change", async () => {
    const stop_start = qs("#cb_start_3").checked;
    const stop_end = qs("#cb_end_3").checked;
    const stop_react = qs("#cb_react_3").checked;
    await fetch(`${BASE_URL}/flags`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({ lobby_id: lobbyId, player, stop_start, stop_end, stop_react })
    });
  });
});

// --- Screen 3: Attacke einsetzen ---
qs("#btnUseAttack").onclick = async () => {
  if (selectedAttackIdx == null) {
    pushMessage("Bitte wähle eine Attacke (rechte Spalte).");
    return;
  }
  // Owner ist in dieser Minimal-Version immer der Spieler selbst (nicht Monster)
  const res = await fetch(`${BASE_URL}/use_attack`, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({ lobby_id: lobbyId, player, attack_index: selectedAttackIdx })
  });
  const data = await res.json();
  if (!data.ok) {
    pushMessage(data.detail || "Konnte Attacke nicht einsetzen.");
    return;
  }
};

// Init
showScreen(0);
