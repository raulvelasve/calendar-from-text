(function () {
  const tz = 'Europe/Madrid';
  const el = (id) => document.getElementById(id);

  const $raw = el('raw');
  const $parse = el('parse');
  const $clear = el('clear');
  const $previews = el('previews');
  const $cards = el('cards');
  const $createAll = el('createAll');

  // ---------- Persistencia simple (solo guardamos el bloque pegado) ----------
  function saveState() {
    chrome.storage.local.set({ eventFromText_raw: $raw.value || "" });
    toggleClearButton();
  }

  function restoreState() {
    chrome.storage.local.get(["eventFromText_raw"], (res) => {
      if (typeof res.eventFromText_raw === "string") {
        $raw.value = res.eventFromText_raw;
      }
      toggleClearButton();
    });
  }

  function hasAnyContent() {
    return ($raw.value || '').trim().length > 0 || ($cards?.children?.length || 0) > 0;
  }

  function toggleClearButton() {
    const has = !!hasAnyContent();
    if ($clear) {
      $clear.classList.toggle('hidden', !has);
      $clear.disabled = !has;
    }
  }

  // ---------- Crear una tarjeta ----------
  function createCard(index, data) {
    const wrapper = document.createElement('div');
    wrapper.className = 'card';

    wrapper.innerHTML = `
      <div class="grid">
        <label>Título</label>
        <input class="title" type="text" value="${escapeHtml(data.title || '')}" />

        <label>Fecha (dd/mm/aaaa)</label>
        <input class="date" type="text" value="${escapeHtml(data.date || '')}" />

        <label>Hora inicio (hh:mm)</label>
        <input class="time" type="text" value="${escapeHtml(data.time || '')}" />

        <label>Duración (min)</label>
        <input class="duration" type="number" min="15" step="15" value="${Number(data.duration || 120)}" />

        <label>Ubicación</label>
        <input class="location" type="text" value="${escapeHtml(data.location || '')}" />

        <label>Detalles</label>
        <textarea class="details">${escapeHtml(data.details || '')}</textarea>
      </div>
      <div class="buttons">
        <button class="createOne">Crear evento en Calendar</button>
      </div>
    `;

    // botón "Crear evento" de esta tarjeta
    wrapper.querySelector('.createOne').addEventListener('click', () => {
      const payload = readCard(wrapper);
      if (!validate(payload)) {
        alert('Revisa título, fecha (dd/mm/aaaa) y hora (hh:mm).');
        return;
      }
      openCalendarTab(payload);
    });

    return wrapper;
  }

  function readCard(card) {
    const q = (sel) => card.querySelector(sel);
    return {
      title: (q('.title').value || '').trim(),
      date: (q('.date').value || '').trim(),       // dd/mm/aaaa
      time: (q('.time').value || '').trim(),       // hh:mm
      duration: Math.max(15, parseInt(q('.duration').value || '120', 10)),
      location: (q('.location').value || '').trim(),
      details: (q('.details').value || '').trim(),
    };
  }

  function validate({ title, date, time }) {
    const okTitle = !!title;
    const okDate = /^\d{2}\/\d{2}\/\d{4}$/.test(date);
    const okTime = /^\d{1,2}:\d{2}$/.test(time);
    return okTitle && okDate && okTime;
  }

  // ---------- Abrir Google Calendar ----------
  function openCalendarTab({ title, date, time, duration, location, details }) {
    const [d, m, y] = date.split('/').map(Number);
    const [hh, mm] = time.split(':').map(Number);
    const start = new Date(y, m - 1, d, hh, mm, 0); // local
    const end = new Date(start.getTime() + duration * 60 * 1000);

    const pad = (n, l = 2) => String(n).padStart(l, '0');
    const fmt = (dt) =>
      `${dt.getFullYear()}${pad(dt.getMonth() + 1)}${pad(dt.getDate())}` +
      `T${pad(dt.getHours())}${pad(dt.getMinutes())}${pad(dt.getSeconds())}`;
    const datesParam = `${fmt(start)}/${fmt(end)}`;

    const url =
      `https://calendar.google.com/calendar/render?action=TEMPLATE` +
      `&text=${encodeURIComponent(title)}` +
      `&dates=${datesParam}` +
      `&location=${encodeURIComponent(location || '')}` +
      (details ? `&details=${encodeURIComponent(details)}` : '') +
      `&ctz=${encodeURIComponent(tz)}`;

    if (chrome?.tabs?.create) chrome.tabs.create({ url });
    else window.open(url, '_blank');
  }

  // ---------- Botones superiores ----------
  $parse.addEventListener('click', () => {
    const raw = ($raw.value || '').trim();
    if (!raw) {
      alert('Pega el texto de uno o varios partidos.');
      return;
    }

    const blocks = splitIntoBlocks(raw);          // NUEVO: divide en partidos
    const parsedList = blocks
      .map(b => parseFixture(b))
      .filter(Boolean);

    if (!parsedList.length) {
      alert('No se reconoció ningún partido. Revisa el formato.');
      return;
    }

    // limpia tarjetas anteriores y pinta nuevas
    $cards.innerHTML = '';
    parsedList.forEach((p, idx) => {
      const card = createCard(idx, { ...p, duration: 120 });
      $cards.appendChild(card);
    });

    $previews.classList.remove('hidden');
    saveState();
  });

  if ($clear) {
    $clear.addEventListener('click', () => {
      $raw.value = '';
      $cards.innerHTML = '';
      $previews.classList.add('hidden');
      chrome.storage.local.remove('eventFromText_raw', () => toggleClearButton());
    });
  }

  if ($createAll) {
 $createAll?.addEventListener('click', () => {
  const cards = Array.from($cards.querySelectorAll('.card'));
  if (!cards.length) return;

  const payloads = cards.map(readCard);
  const invalidIdx = payloads.findIndex(p => !validate(p));
  if (invalidIdx !== -1) {
    alert(`Revisa la tarjeta ${invalidIdx + 1}: título, fecha (dd/mm/aaaa) y hora (hh:mm).`);
    return;
  }
      payloads.forEach(openCalendarTab);
    });
  }

  // ---------- Splitting en varios partidos ----------
  function splitIntoBlocks(raw) {
    // normaliza saltos
    const text = raw.replace(/\r/g, '\n').trim();

    // estrategia principal: cada bloque comienza con una línea de cabecera tipo
    // "AUTONÓMICA", "INSULAR …", etc. Capturamos desde ese inicio hasta el siguiente
    const starts = [];
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i].trim();
      if (/^(AUTON[ÓO]MICA|INSULAR\b)/i.test(l)) {
        starts.push(i);
      }
    }
    // Si no encontramos cabeceras, fallback: divide por apariciones de la etiqueta LOCAL
    if (starts.length === 0) {
      for (let i = 0; i < lines.length; i++) {
        if (/^LOCAL$/i.test(lines[i].trim())) starts.push(i > 2 ? i - 2 : i);
      }
    }
    if (starts.length === 0) return [text];

    const blocks = [];
    for (let s = 0; s < starts.length; s++) {
      const from = starts[s];
      const to = s + 1 < starts.length ? starts[s + 1] : lines.length;
      const chunk = lines.slice(from, to).join('\n').trim();
      if (chunk) blocks.push(chunk);
    }
    return blocks;
  }

  // ---------- Parser (tu lógica, con mínimos retoques) ----------
  function parseFixture(raw) {
    const text = (raw || '').replace(/\r/g, '\n');
    const lines = text.split(/\n+/).map(l => l.trim()).filter(Boolean);
    if (!lines.length) return null;

    const LABELS = ['LOCAL', 'VISITANTE', 'FECHA', 'HORA', 'INSTALACIÓN', 'INSTALACION', 'ROL', 'ACTA'];
    const isLabel = (s) => LABELS.includes((s || '').toUpperCase());

    // localizar bloque etiquetas
    const labelBlockIdxs = lines
      .map((l, i) => ({ l, i }))
      .filter(x => isLabel(x.l))
      .map(x => x.i);

    if (labelBlockIdxs.length >= 5) {
      const lastLabelIdx = Math.max(...labelBlockIdxs);
      const tail = lines.slice(lastLabelIdx + 1);
      if (tail.length >= 5) {
        const [localV, visitanteV, fechaV, horaV, locationV] = tail;
        const date = normalizeDate(matchDate(fechaV) || fechaV);
        const time = normalizeTime(matchTime(horaV) || horaV);
        const location = locationV;

        const header1 = lines[0] || '';
        const header2 = lines[1] || '';
        const grupoMatch = lines.find(l => /^Grupo\s*:/i.test(l));
        const grupo = grupoMatch ? grupoMatch.replace(/^Grupo\s*:\s*/i, '').trim() : '';
        const categoria = (header2 && !isLabel(header2)) ? header2 : '';

        let title = '';
        if (localV && visitanteV) {
          title = `${localV} vs ${visitanteV}`;
          if (categoria) title += ` (${categoria}${grupo ? ` - ${grupo}` : ''})`;
          else if (grupo) title += ` (${grupo})`;
        } else {
          title = header1 || 'Partido';
        }

        const detailsParts = [];
        if (header1) detailsParts.push(header1);
        if (categoria) detailsParts.push(categoria);
        if (grupo) detailsParts.push(`Grupo: ${grupo}`);
        const details = detailsParts.join('\n');

        if (title && date && time && location) {
          return { title, date, time, location, details };
        }
      }
    }

    // Fallback etiqueta→valor
    const isLabelStrict = (s) => LABELS.includes((s || '').toUpperCase());
    const findAfter = (label) => {
      const idx = lines.findIndex(l => l.toUpperCase() === label.toUpperCase());
      if (idx === -1) return null;
      for (let j = idx + 1; j < lines.length; j++) {
        const v = lines[j];
        if (v && !isLabelStrict(v)) return v;
      }
      return null;
    };

    const local = findAfter('LOCAL') || guessTeam(lines);
    const visitante = findAfter('VISITANTE') || guessTeam(lines, local);
    let date = normalizeDate(findAfter('FECHA')) || matchDate(lines.join(' '));
    let time = normalizeTime(findAfter('HORA')) || matchTime(lines.join(' '));
    let location = findAfter('INSTALACIÓN') || findAfter('INSTALACION') || lastNonLabelLine(lines);

    const header1 = lines[0] || '';
    const header2 = lines[1] || '';
    const grupoMatch = lines.find(l => /^Grupo\s*:/i.test(l));
    const grupo = grupoMatch ? grupoMatch.replace(/^Grupo\s*:\s*/i, '').trim() : '';
    const categoria = header2 && !isLabelStrict(header2) ? header2 : '';

    let title = '';
    if (local && visitante) {
      title = `${local} vs ${visitante}`;
      if (categoria) title += ` (${categoria}${grupo ? ` - ${grupo}` : ''})`;
      else if (grupo) title += ` (${grupo})`;
    } else {
      title = header1 || 'Partido';
    }

    const detailsParts = [];
    if (header1) detailsParts.push(header1);
    if (categoria) detailsParts.push(categoria);
    if (grupo) detailsParts.push(`Grupo: ${grupo}`);
    const details = detailsParts.join('\n');

    if (!date || !time || !location || !title) return null;
    return { title, date, time, location, details };
  }

  function matchDate(s) {
    const m = s.match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})\b/);
    return m ? normalizeDate(`${m[1].padStart(2, '0')}/${m[2].padStart(2, '0')}/${m[3]}`) : null;
  }
  function matchTime(s) {
    const m = s.match(/\b(\d{1,2}):(\d{2})(?::(\d{2}))?\b/);
    return m ? normalizeTime(`${m[1].padStart(2, '0')}:${m[2]}`) : null;
  }
  function normalizeDate(d) {
    if (!d) return null;
    const m = d.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
    if (!m) return null;
    const dd = m[1].padStart(2, '0');
    const mm = m[2].padStart(2, '0');
    const yyyy = m[3];
    return `${dd}/${mm}/${yyyy}`;
  }
  function normalizeTime(t) {
    if (!t) return null;
    const m = t.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (!m) return null;
    const hh = m[1].padStart(2, '0');
    const mm = m[2];
    return `${hh}:${mm}`;
  }
  function lastNonLabelLine(lines) {
    for (let i = lines.length - 1; i >= 0; i--) {
      const v = lines[i];
      if (v && !/^(LOCAL|VISITANTE|FECHA|HORA|INSTALACI[ÓO]N|ROL|ACTA)$/i.test(v)) {
        return v;
      }
    }
    return '';
  }
  function guessTeam(lines, exclude) {
    const candidates = lines.filter(l => /[A-Za-zÁÉÍÓÚÜáéíóúüñÑ]/.test(l) && l === l.toUpperCase());
    for (const c of candidates) {
      if (c !== exclude && !/^(LOCAL|VISITANTE|FECHA|HORA|INSTALACI[ÓO]N|ROL|ACTA|GRUPO\s*:.*)$/i.test(c)) {
        return c;
      }
    }
    return null;
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  }

  // Init
  ['input','change'].forEach(evt => $raw.addEventListener(evt, saveState));
  window.addEventListener('beforeunload', saveState);
  restoreState();
  

 
})();
