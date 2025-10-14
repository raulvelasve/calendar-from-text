(function () {
  const tz = 'Europe/Madrid';
  const el = (id) => document.getElementById(id);
  const $raw = el('raw');
  const $title = el('title');
  const $date = el('date');
  const $time = el('time');
  const $duration = el('duration');
  const $location = el('location');
  const $details = el('details');
  const $preview = el('preview');

  const STATE_KEYS = ["raw","title","date","time","duration","location","details"];

  // -------- Persistencia --------
  function saveState() {
    const data = {
      raw: $raw.value || "",
      title: $title.value || "",
      date: $date.value || "",
      time: $time.value || "",
      duration: $duration.value || "",
      location: $location.value || "",
      details: $details.value || ""
    };
    chrome.storage.local.set({ eventFromText_state: data });
  }

  function restoreState() {
    chrome.storage.local.get(["eventFromText_state"], (res) => {
      const s = res.eventFromText_state || {};
      if (typeof s.raw === "string") $raw.value = s.raw;
      if (typeof s.title === "string") $title.value = s.title;
      if (typeof s.date === "string") $date.value = s.date;
      if (typeof s.time === "string") $time.value = s.time;
      if (typeof s.duration !== "undefined") $duration.value = s.duration;
      if (typeof s.location === "string") $location.value = s.location;
      if (typeof s.details === "string") $details.value = s.details;

      // Si ya hay datos cargados, mostramos la previsualización
      if (s.title || s.date || s.time || s.location || s.details) {
        $preview.classList.remove('hidden');
      }
    });
  }

  function autoWirePersistence() {
    [$raw,$title,$date,$time,$duration,$location,$details].forEach($ =>
      $.addEventListener('input', saveState)
    );
    window.addEventListener('beforeunload', saveState);
  }

  // -------- Tu lógica original (con pequeños retoques de template string) --------
  el('parse').addEventListener('click', () => {
    const parsed = parseFixture($raw.value || '');
    if (!parsed) {
      alert('No se pudo reconocer fecha/hora y equipos. Revisa el texto.');
      return;
    }
    $title.value = parsed.title || '';
    $date.value = parsed.date || '';
    $time.value = parsed.time || '';
    $location.value = parsed.location || '';
    $details.value = parsed.details || '';
    $preview.classList.remove('hidden');
    saveState();
  });

  el('create').addEventListener('click', () => {
    const title = $title.value.trim();
    const date = $date.value.trim();   // dd/mm/aaaa
    const time = $time.value.trim();   // hh:mm
    const durationMin = Math.max(15, parseInt($duration.value || '120', 10));
    const location = $location.value.trim();
    const details = $details.value.trim();

    if (!title || !/^\d{2}\/\d{2}\/\d{4}$/.test(date) || !/^\d{1,2}:\d{2}$/.test(time)) {
      alert('Revisa título, fecha (dd/mm/aaaa) y hora (hh:mm).');
      return;
    }

    const [d, m, y] = date.split('/').map(Number);
    const [hh, mm] = time.split(':').map(Number);
    const start = new Date(y, m - 1, d, hh, mm, 0); // hora local
    const end = new Date(start.getTime() + durationMin * 60 * 1000);

    const pad = (n, l = 2) => String(n).padStart(l, '0');
    const fmt = (dt) => `${dt.getFullYear()}${pad(dt.getMonth() + 1)}${pad(dt.getDate())}T${pad(dt.getHours())}${pad(dt.getMinutes())}${pad(dt.getSeconds())}`;
    const datesParam = `${fmt(start)}/${fmt(end)}`;

    const url =
      `https://calendar.google.com/calendar/render?action=TEMPLATE` +
      `&text=${encodeURIComponent(title)}` +
      `&dates=${datesParam}` +
      `&location=${encodeURIComponent(location)}` +
      (details ? `&details=${encodeURIComponent(details)}` : '') +
      `&ctz=${encodeURIComponent(tz)}`;

    if (chrome?.tabs?.create) {
      chrome.tabs.create({ url });
    } else {
      window.open(url, '_blank');
    }
  });

  // --------- (el parseador igual que el tuyo, corrigiendo template strings) ---------
  function parseFixture(raw) {
    const text = (raw || '').replace(/\r/g, '\n');
    const lines = text.split(/\n+/).map(l => l.trim()).filter(Boolean);
    if (!lines.length) return null;

    const LABELS = ['LOCAL', 'VISITANTE', 'FECHA', 'HORA', 'INSTALACIÓN', 'INSTALACION', 'ROL', 'ACTA'];
    const isLabel = (s) => LABELS.includes((s || '').toUpperCase());

    // 1) Bloque de etiquetas seguido de valores
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

    // 2) Fallback etiqueta → valor inmediato
    const isLabelStrict = (s) => ['LOCAL', 'VISITANTE', 'FECHA', 'HORA', 'INSTALACIÓN', 'INSTALACION', 'ROL', 'ACTA'].includes((s || '').toUpperCase());
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

  // Init
  restoreState();
  autoWirePersistence();
})();
