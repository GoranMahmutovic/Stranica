(function () {
  const MANIFEST_URL = "data/sessions.json";
  const REMOTE_SESSIONS_URL = "/api/sessions";
  const LOCAL_SESSIONS_KEY = "speedcoach.trainingDiary.localSessions.v1";
  const UPLOAD_KEY_STORAGE_KEY = "speedcoach.trainingDiary.uploadKey.v1";
  const COLORS = {
    pace: "#3b7dff",
    rate: "#ff6b35",
    hr: "#ff4f4f",
    power: "#22d86e",
    distance: "#3b7dff",
    grid: "rgba(255,255,255,0.06)",
    muted: "#6b7280",
    text: "#e8eaf0",
    green: "#22d86e",
    intervals: ["#3b7dff", "#ff6b35", "#22d86e", "#f6c85f", "#b979ff", "#ff4f4f", "#18c6c8"],
  };

  const state = {
    sessions: [],
    selectedId: "",
    rangeDays: "all",
    segmentMeters: 250,
    calendarMonth: "",
    isAdmin: false,
    uploadKey: "",
  };

  const elements = {
    csvUpload: document.getElementById("csvUpload"),
    uploadAction: document.getElementById("csvUpload")?.closest(".file-action"),
    exportButton: document.getElementById("exportButton"),
    uploadStatus: document.getElementById("uploadStatus"),
    headerSubtitle: document.getElementById("headerSubtitle"),
    deviceBadge: document.getElementById("deviceBadge"),
    sessionSelect: document.getElementById("sessionSelect"),
    rangeSelect: document.getElementById("rangeSelect"),
    segmentSize: document.getElementById("segmentSize"),
    metricSessions: document.getElementById("metricSessions"),
    metricDistance: document.getElementById("metricDistance"),
    metricDuration: document.getElementById("metricDuration"),
    metricPace: document.getElementById("metricPace"),
    metricRate: document.getElementById("metricRate"),
    metricBest500: document.getElementById("metricBest500"),
    sessionTitle: document.getElementById("sessionTitle"),
    sessionMeta: document.getElementById("sessionMeta"),
    detailDistance: document.getElementById("detailDistance"),
    detailDuration: document.getElementById("detailDuration"),
    detailPace: document.getElementById("detailPace"),
    detailRate: document.getElementById("detailRate"),
    detailHr: document.getElementById("detailHr"),
    detailPower: document.getElementById("detailPower"),
    intervalOverview: document.getElementById("intervalOverview"),
    sessionChart: document.getElementById("sessionChart"),
    intervalCharts: document.getElementById("intervalCharts"),
    chartTooltip: document.getElementById("chartTooltip"),
    historyHighlights: document.getElementById("historyHighlights"),
    historyCalendar: document.getElementById("historyCalendar"),
    mapFrame: document.getElementById("mapFrame") || { removeAttribute() {}, set src(_value) {} },
    mapTiles: document.getElementById("mapTiles"),
    routeOverlay: document.getElementById("routeOverlay"),
    mapLabels: document.getElementById("mapLabels"),
    intervalMaps: document.getElementById("intervalMaps"),
    sessionLegend: document.getElementById("sessionLegend"),
    routeStats: document.getElementById("routeStats"),
    sessionTable: document.getElementById("sessionTable"),
    segmentHead: document.getElementById("segmentHead"),
    segmentTable: document.getElementById("segmentTable"),
    emptyState: document.getElementById("emptyState"),
  };

  const columnHints = {
    time: [
      "elapsedtime",
      "elapsed time",
      "workouttime",
      "time",
      "timestamp",
      "duration",
      "cumulativetime",
      "cum time",
    ],
    distance: [
      "distance",
      "dist",
      "meters",
      "metres",
      "odometer",
    ],
    pace: ["split", "pace", "avg split", "500m", "time/500m"],
    speed: ["speed", "velocity", "boat speed"],
    rate: [
      "strokerate",
      "stroke rate",
      "rate",
      "spm",
      "cadence",
      "rating",
    ],
    hr: ["heartrate", "heart rate", "hr", "bpm", "pulse"],
    power: ["power", "watts", "watt"],
    lat: ["latitude", "lat"],
    lon: ["longitude", "lon", "lng"],
    state: ["workoutstate", "workout state"],
  };

  function normalizeHeader(value) {
    return String(value || "")
      .replace(/\uFEFF/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function compactHeader(value) {
    return normalizeHeader(value).replace(/[^a-z0-9]+/g, "");
  }

  function init() {
    captureAdminAccess();
    applyAccessMode();
    bindEvents();
    loadManifest();
  }

  function bindEvents() {
    elements.csvUpload.addEventListener("change", handleUpload);
    elements.exportButton.addEventListener("click", exportSummary);
    elements.sessionSelect.addEventListener("change", (event) => {
      state.selectedId = event.target.value;
      syncCalendarMonthToSelected();
      render();
    });
    elements.rangeSelect.addEventListener("change", (event) => {
      state.rangeDays = event.target.value;
      render();
    });
    elements.segmentSize.addEventListener("change", (event) => {
      state.segmentMeters = Number(event.target.value) || 500;
      render();
    });
    elements.sessionTable.addEventListener("click", handleSessionTableClick);
    elements.sessionTable.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        handleSessionTableActivate(event);
      }
    });
    elements.historyCalendar?.addEventListener("click", handleHistoryCalendarActivate);
    elements.sessionChart.addEventListener("mousemove", handleChartHover);
    elements.sessionChart.addEventListener("mouseleave", hideChartTooltip);
    const redrawVisuals = debounce(renderResponsiveVisuals, 150);
    window.addEventListener("resize", redrawVisuals);
    window.visualViewport?.addEventListener("resize", redrawVisuals);
    window.addEventListener("orientationchange", () => window.setTimeout(renderResponsiveVisuals, 250));
  }

  function handleSessionTableActivate(event) {
    if (event.target.closest("button, a, input, select")) return;
    const row = event.target.closest("tr[data-session-id]");
    if (!row) return;
    if (event.type === "keydown") event.preventDefault();
    state.selectedId = row.dataset.sessionId;
    syncCalendarMonthToSelected();
    render();
    elements.sessionSelect.value = state.selectedId;
  }

  async function handleDeleteSession(event) {
    event.preventDefault();
    event.stopPropagation();
    if (!state.isAdmin) {
      showUploadStatus("Brisanje je dostupno samo preko admin linka.", true);
      return;
    }
    const button = event.target.closest("[data-delete-session-id]");
    const id = button?.dataset.deleteSessionId || "";
    const session = state.sessions.find((item) => item.id === id);
    if (!session) return;
    const confirmed = window.confirm(
      `Obrisati trening "${sessionTitle(session)}"?\n\nAko je trening javno objavljen, bit ce uklonjen i s javne stranice.`,
    );
    if (!confirmed) return;

    button.disabled = true;
    showUploadStatus(`Brišem trening: ${sessionTitle(session)}...`);
    try {
      await deleteRemoteSession(id);
      deleteStoredSession(id);
      state.sessions = state.sessions.filter((item) => item.id !== id);
      if (state.selectedId === id) {
        state.selectedId = state.sessions[0]?.id || "";
      }
      syncCalendarMonthToSelected();
      render();
      showUploadStatus(`Trening je obrisan: ${sessionTitle(session)}`);
    } catch (error) {
      console.error(error);
      showUploadStatus(`Ne mogu obrisati trening: ${error.message}`, true);
      button.disabled = false;
    }
  }

  function handleHistoryCalendarActivate(event) {
    const actionButton = event.target.closest("[data-calendar-action]");
    if (actionButton) {
      const direction = actionButton.dataset.calendarAction === "next" ? 1 : -1;
      state.calendarMonth = shiftMonthKey(state.calendarMonth || monthKey(new Date()), direction);
      renderCharts();
      return;
    }

    const sessionButton = event.target.closest("[data-session-id]");
    if (!sessionButton) return;
    state.selectedId = sessionButton.dataset.sessionId;
    syncCalendarMonthToSelected();
    render();
    elements.sessionSelect.value = state.selectedId;
  }

  function syncCalendarMonthToSelected() {
    const session = getSelectedSession();
    if (session) state.calendarMonth = monthKey(parseDate(session.date));
  }

  function handleChartHover(event) {
    const canvas = event.currentTarget || elements.sessionChart;
    const hits = canvas._strokeHits || [];
    if (!hits.length) {
      hideChartTooltip();
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    let nearest = null;
    let nearestDistance = Infinity;
    hits.forEach((hit) => {
      const dx = hit.x - x;
      const dy = hit.y - y;
      const distance = dx * dx + dy * dy;
      if (distance < nearestDistance) {
        nearest = hit;
        nearestDistance = distance;
      }
    });
    if (!nearest || nearestDistance > 100) {
      canvas.style.cursor = "default";
      hideChartTooltip();
      return;
    }
    canvas.style.cursor = "pointer";
    showChartTooltip(event, nearest.point);
  }

  function showChartTooltip(event, point) {
    const rows = [
      ["Interval", point.intervalLabel || `Interval ${point.interval || 1}`],
      ["Distanca", `${formatNumber(Number.isFinite(point.localDistance) ? point.localDistance : point.distance, 1)} m`],
      ["Vrijeme", formatDurationTenths(Number.isFinite(point.localTime) ? point.localTime : point.time)],
      ["Split", formatPace(point.pace)],
      ["Tempo", `${formatNumber(point.rate, 1)} spm`],
      ["Zaveslaj", Number.isFinite(point.strokes) ? formatNumber(point.strokes, 0) : "--"],
      ["m/zaveslaj", Number.isFinite(point.distPerStroke) ? formatNumber(point.distPerStroke, 1) : "--"],
      ["HR", Number.isFinite(point.hr) ? `${formatNumber(point.hr, 0)} bpm` : "--"],
      ["Snaga", Number.isFinite(point.power) ? `${formatNumber(point.power, 0)} W` : "--"],
    ];
    elements.chartTooltip.innerHTML = `
      <strong>Zaveslaj ${Number.isFinite(point.strokes) ? formatNumber(point.strokes, 0) : point.index + 1}</strong>
      ${rows.map(([label, value]) => `<div><span>${label}</span><span>${value}</span></div>`).join("")}
    `;
    const margin = 12;
    const left = Math.min(event.clientX + 14, window.innerWidth - margin - 280);
    const top = Math.min(event.clientY + 14, window.innerHeight - margin - 210);
    elements.chartTooltip.style.left = `${Math.max(margin, left)}px`;
    elements.chartTooltip.style.top = `${Math.max(margin, top)}px`;
    elements.chartTooltip.hidden = false;
  }

  function hideChartTooltip(event) {
    elements.chartTooltip.hidden = true;
    if (event?.currentTarget) event.currentTarget.style.cursor = "default";
    elements.sessionChart.style.cursor = "default";
    elements.intervalCharts?.querySelectorAll("canvas").forEach((canvas) => {
      canvas.style.cursor = "default";
    });
  }

  function showUploadStatus(message, isError = false) {
    elements.uploadStatus.textContent = message;
    elements.uploadStatus.hidden = false;
    elements.uploadStatus.classList.toggle("error", isError);
  }

  function captureAdminAccess() {
    const params = new URLSearchParams(window.location.search);
    const clearAdmin = params.get("admin") === "off" || params.get("uploadKey") === "off";
    const keyFromUrl = params.get("uploadKey") || params.get("adminKey") || "";

    if (clearAdmin) {
      removeStoredUploadKey();
      params.delete("admin");
      params.delete("uploadKey");
      params.delete("adminKey");
      replaceQueryParams(params);
    } else if (keyFromUrl.trim()) {
      state.uploadKey = keyFromUrl.trim();
      saveUploadKey(state.uploadKey);
      params.delete("uploadKey");
      params.delete("adminKey");
      replaceQueryParams(params);
    } else {
      state.uploadKey = readUploadKey();
    }

    state.isAdmin = Boolean(state.uploadKey);
  }

  function applyAccessMode() {
    document.body.classList.toggle("admin-mode", state.isAdmin);
    if (elements.uploadAction) {
      elements.uploadAction.hidden = !state.isAdmin;
    }
    if (elements.csvUpload) {
      elements.csvUpload.disabled = !state.isAdmin;
    }
  }

  function handleSessionTableClick(event) {
    if (event.target.closest("[data-delete-session-id]")) {
      handleDeleteSession(event);
      return;
    }
    handleSessionTableActivate(event);
  }

  function replaceQueryParams(params) {
    const query = params.toString();
    const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
    window.history.replaceState(null, "", nextUrl);
  }

  function readUploadKey() {
    try {
      return localStorage.getItem(UPLOAD_KEY_STORAGE_KEY) || "";
    } catch (_error) {
      return "";
    }
  }

  function saveUploadKey(value) {
    try {
      localStorage.setItem(UPLOAD_KEY_STORAGE_KEY, value);
    } catch (_error) {
      // The key still works for this page load even if localStorage is blocked.
    }
  }

  function removeStoredUploadKey() {
    try {
      localStorage.removeItem(UPLOAD_KEY_STORAGE_KEY);
    } catch (_error) {
      // No-op: private/read-only mode is best effort when storage is blocked.
    }
  }

  async function loadManifest() {
    let publicSessions = [];
    try {
      const response = await fetch(MANIFEST_URL, { cache: "no-store" });
      if (!response.ok) {
        throw new Error("Manifest nije pronaden");
      }
      const manifest = await response.json();
      const entries = Array.isArray(manifest) ? manifest : manifest.sessions || [];
      const loaded = await Promise.allSettled(entries.map(loadSessionFromManifest));
      publicSessions = loaded
        .filter((result) => result.status === "fulfilled" && result.value)
        .map((result) => result.value)
        .sort(sortByDateDesc);
    } catch (error) {
      console.info("Nema javnog manifesta treninga.", error);
    }
    const remoteData = await loadRemoteSessions();
    const remoteSessions = remoteData.sessions || [];
    const deletedIds = new Set(remoteData.deletedIds || []);
    const localSessions = state.isAdmin ? loadStoredSessions() : [];
    state.sessions = mergeSessions(
      [...publicSessions.filter((session) => !deletedIds.has(session.id)), ...remoteSessions],
      localSessions.filter((session) => !deletedIds.has(session.id)),
    );
    state.selectedId = state.sessions[0]?.id || "";
    syncCalendarMonthToSelected();
    render();
  }

  async function loadRemoteSessions() {
    try {
      const response = await fetch(REMOTE_SESSIONS_URL, { cache: "no-store" });
      if (response.status === 404) return { sessions: [], deletedIds: [] };
      if (!response.ok) {
        throw new Error(`Javni API nije dostupan (${response.status})`);
      }
      const payload = await response.json();
      const entries = Array.isArray(payload.sessions) ? payload.sessions : [];
      const sessions = entries
        .map((entry) => {
          try {
            if (!entry?.csvText || !entry?.id) return null;
            return buildSession(entry.csvText, {
              ...(entry.meta || {}),
              id: entry.id,
              source: entry.meta?.source || "Netlify Blobs",
              publicEntry: true,
              storedEntry: false,
              remoteEntry: true,
              uploadedAt: entry.savedAt || entry.meta?.uploadedAt || "",
            });
          } catch (error) {
            console.warn("Javno spremljeni CSV nije moguce ucitati.", error);
            return null;
          }
        })
        .filter(Boolean)
        .sort(sortByDateDesc);
      const deletedIds = Array.isArray(payload.deletedIds) ? payload.deletedIds.map((id) => String(id)) : [];
      return { sessions, deletedIds };
    } catch (error) {
      console.info("Nema javno spremljenih treninga iz API-ja.", error);
      return { sessions: [], deletedIds: [] };
    }
  }

  async function loadSessionFromManifest(entry, index) {
    if (!entry || !entry.csv) return null;
    const csvUrl = new URL(entry.csv, new URL(MANIFEST_URL, window.location.href));
    const response = await fetch(csvUrl.href, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`CSV nije dostupan: ${entry.csv}`);
    }
    const text = await response.text();
    return buildSession(text, {
      id: entry.id || `session-${index + 1}`,
      title: entry.title || entry.name || csvUrl.pathname.split("/").pop(),
      date: entry.date || "",
      boat: entry.boat || "",
      location: entry.location || "",
      type: entry.type || "",
      notes: entry.notes || "",
      source: entry.csv,
      publicEntry: true,
    });
  }

  function loadStoredSessions() {
    return readStoredEntries()
      .map((entry) => {
        try {
          if (!entry?.csvText || !entry?.meta?.id) return null;
          return buildSession(entry.csvText, {
            ...entry.meta,
            publicEntry: false,
            storedEntry: true,
          });
        } catch (error) {
          console.warn("Spremljeni CSV nije moguće učitati.", error);
          return null;
        }
      })
      .filter(Boolean);
  }

  function saveStoredSession(entry) {
    const entries = readStoredEntries().filter((item) => item.id !== entry.id);
    entries.unshift({
      id: entry.id,
      csvText: entry.csvText,
      meta: entry.meta,
      savedAt: new Date().toISOString(),
    });
    try {
      localStorage.setItem(LOCAL_SESSIONS_KEY, JSON.stringify(entries));
    } catch (error) {
      throw new Error("CSV je analiziran, ali ga browser nije mogao trajno spremiti. Storage je vjerojatno pun ili blokiran.");
    }
  }

  function deleteStoredSession(id) {
    try {
      const entries = readStoredEntries().filter((entry) => entry.id !== id);
      localStorage.setItem(LOCAL_SESSIONS_KEY, JSON.stringify(entries));
    } catch (error) {
      console.warn("Lokalna kopija treninga nije obrisana.", error);
    }
  }

  function readStoredEntries() {
    try {
      const raw = localStorage.getItem(LOCAL_SESSIONS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.warn("Ne mogu pročitati lokalno spremljene treninge.", error);
      return [];
    }
  }

  function mergeSessions(publicSessions, localSessions) {
    const merged = new Map();
    [...publicSessions, ...localSessions].forEach((session) => {
      if (!session?.id) return;
      merged.set(session.id, session);
    });
    return Array.from(merged.values()).sort(sortByDateDesc);
  }

  function handleUpload(event) {
    if (!state.isAdmin) {
      showUploadStatus("Upload je dostupan samo preko tvog admin linka.", true);
      event.target.value = "";
      return;
    }
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const csvText = String(reader.result || "");
      try {
        const sessionId = `training-${hashString(`${file.name}\n${csvText}`)}`;
        const meta = {
          id: sessionId,
          title: file.name.replace(/\.csv$/i, ""),
          date: dateInputValue(new Date(file.lastModified || Date.now())),
          source: file.name,
          publicEntry: false,
          storedEntry: true,
          uploadedAt: new Date().toISOString(),
        };
        const session = buildSession(csvText, meta);
        if (!session.points.length) {
          throw new Error("CSV je pročitan, ali nisu pronađeni upotrebljivi SpeedCoach podaci.");
        }
        const storedMeta = {
          ...meta,
          title: session.title,
          date: session.date,
          startTime: session.startTime,
          type: session.type,
        };
        saveStoredSession({
          id: session.id,
          csvText,
          meta: storedMeta,
        });
        let nextSession = session;
        let published = false;
        try {
          nextSession = await saveRemoteSession({
            id: session.id,
            csvText,
            meta: storedMeta,
          });
          published = true;
        } catch (remoteError) {
          console.warn("CSV je spremljen lokalno, ali nije objavljen.", remoteError);
        }
        state.sessions = [nextSession, ...state.sessions.filter((item) => item.id !== nextSession.id)];
        state.sessions.sort(sortByDateDesc);
        state.selectedId = nextSession.id;
        showUploadStatus(
          `CSV učitan i trajno spremljen u ovom browseru: ${session.title} · ${formatDate(session.date)} · ${formatNumber(session.summary.distance, 1)} m · ${formatDurationTenths(session.summary.duration)}`,
        );
        render();
        if (published) {
          showUploadStatus(
            `CSV objavljen javno i spremljen kao lokalna kopija: ${nextSession.title} · ${formatDate(nextSession.date)} · ${formatNumber(nextSession.summary.distance, 1)} m · ${formatDurationTenths(nextSession.summary.duration)}`,
          );
        } else {
          showUploadStatus(
            `CSV je analiziran i spremljen samo u ovom browseru. Nije javno objavljen, pa ga trener neće vidjeti dok se upload ne spoji na Netlify: ${session.title}`,
            true,
          );
        }
      } catch (error) {
        console.error(error);
        showUploadStatus(`Ne mogu obraditi CSV: ${error.message}`, true);
      } finally {
        event.target.value = "";
      }
    };
    reader.onerror = () => {
      showUploadStatus("Ne mogu pročitati odabranu CSV datoteku.", true);
      event.target.value = "";
    };
    reader.readAsText(file);
  }

  async function saveRemoteSession(entry) {
    if (!state.uploadKey) {
      throw new Error("Nema admin kljuca za javnu objavu.");
    }
    const response = await fetch(REMOTE_SESSIONS_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        "x-upload-key": state.uploadKey,
      },
      body: JSON.stringify({
        id: entry.id,
        csvText: entry.csvText,
        meta: {
          ...entry.meta,
          publicEntry: true,
          storedEntry: false,
        },
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || `Javna objava nije uspjela (${response.status}).`);
    }
    return buildSession(entry.csvText, {
      ...entry.meta,
      ...(payload.session?.meta || {}),
      id: payload.session?.id || entry.id,
      publicEntry: true,
      storedEntry: false,
      remoteEntry: true,
      uploadedAt: payload.session?.savedAt || entry.meta.uploadedAt || "",
    });
  }

  async function deleteRemoteSession(id) {
    if (!state.uploadKey) {
      throw new Error("Nema admin ključa za brisanje.");
    }
    const response = await fetch(`${REMOTE_SESSIONS_URL}?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: {
        "x-upload-key": state.uploadKey,
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || `Brisanje nije uspjelo (${response.status}).`);
    }
    return payload;
  }

  function buildSession(csvText, meta) {
    const speedCoach = parseSpeedCoachReport(csvText);
    if (speedCoach) {
      const points = buildPoints(speedCoach.rows, {
        normalizeDistance: false,
        normalizeTime: false,
        allowIntervalResets: true,
      });
      const intervalData = buildIntervalData(points, speedCoach.intervalSummaries);
      const calculated = summarizePoints(points);
      const summary = {
        ...calculated,
        ...speedCoach.summary,
        pointCount: points.length,
        hasGps: calculated.hasGps,
        best500: calculated.best500,
        best1000: calculated.best1000,
        maxRate: calculated.maxRate,
        maxHr: calculated.maxHr,
      };
      const inferredDate = speedCoach.meta.date || meta.date || dateInputValue(new Date());
      return {
        ...meta,
        title: meta.title || speedCoach.meta.name || "SpeedCoach trening",
        date: inferredDate,
        deviceName: speedCoach.meta.deviceName,
        deviceModel: speedCoach.meta.deviceModel,
        deviceSerial: speedCoach.meta.deviceSerial,
        startTime: speedCoach.meta.startTime,
        type: meta.type || speedCoach.meta.type,
        location: meta.location || speedCoach.meta.location || "",
        boat: meta.boat || speedCoach.meta.boat || "",
        columns: speedCoach.columns,
        rawHeaders: speedCoach.headers,
        rows: speedCoach.rows,
        points,
        intervals: intervalData,
        summary,
        sourceKind: "SpeedCoach report",
        warnings: speedCoach.warnings,
      };
    }

    const parsed = parseCsvWithHeader(csvText);
    const columns = detectColumns(parsed.headers);
    const rows = parsed.rows.map((row) => normalizeRow(row, parsed.headers, columns));
    const points = buildPoints(rows);
    const summary = summarizePoints(points);
    const inferredDate = meta.date || inferDateFromRows(rows) || dateInputValue(new Date());
    return {
      ...meta,
      date: inferredDate,
      columns,
      rawHeaders: parsed.headers,
      rows,
      points,
      intervals: buildIntervalData(points, []),
      summary,
      sourceKind: "Generic CSV",
      warnings: parsed.warnings,
    };
  }

  function parseSpeedCoachReport(text) {
    const normalized = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    if (!/Per-Stroke Data:/i.test(normalized) && !/Session Summary:/i.test(normalized)) {
      return null;
    }
    const delimiter = detectDelimiter(normalized);
    const table = parseDelimited(normalized, delimiter).map((row) =>
      row.map((cell) => String(cell || "").trim()),
    );
    const perStrokeIndex = findSectionIndex(table, "Per-Stroke Data:");
    if (perStrokeIndex < 0) return null;

    const meta = parseSpeedCoachMeta(table);
    const summary = parseSpeedCoachSummary(table);
    const intervalSummaries = parseSpeedCoachIntervalSummaries(table);
    const perStroke = parseSpeedCoachPerStroke(table, perStrokeIndex);
    if (!perStroke.rows.length) return null;

    return {
      meta,
      summary,
      intervalSummaries,
      headers: perStroke.headers,
      columns: perStroke.columns,
      rows: perStroke.rows,
      warnings: [],
    };
  }

  function findSectionIndex(table, label) {
    return table.findIndex((row) => normalizeHeader(row[0]) === normalizeHeader(label));
  }

  function nextNonEmptyRow(table, startIndex) {
    for (let index = startIndex; index < table.length; index += 1) {
      if (table[index].some((cell) => cell !== "")) return index;
    }
    return -1;
  }

  function parseSpeedCoachMeta(table) {
    const start = findSectionIndex(table, "Session Information:");
    const meta = {};
    if (start < 0) return meta;
    for (let index = start + 1; index < table.length; index += 1) {
      const row = table[index];
      if (!row.some(Boolean)) {
        if (index > start + 1) break;
        continue;
      }
      assignPair(meta, "name", row[0], row[1], "Name:");
      assignPair(meta, "startTimeRaw", row[0], row[1], "Start Time:");
      assignPair(meta, "type", row[0], row[1], "Type:");
      assignPair(meta, "units", row[0], row[1], "System of Units:");
      assignPair(meta, "speedInput", row[0], row[1], "Speed Input:");
      assignPair(meta, "deviceName", row[4], row[5], "Name:");
      assignPair(meta, "deviceModel", row[4], row[5], "Model:");
      assignPair(meta, "deviceSerial", row[4], row[5], "Serial:");
      assignPair(meta, "firmwareVersion", row[4], row[5], "Firmware Version:");
      assignPair(meta, "boat", row[12], row[13], "Boat ID:");
    }
    const parsedDate = parseSpeedCoachDate(meta.startTimeRaw);
    return {
      ...meta,
      date: parsedDate.date,
      startTime: parsedDate.time,
    };
  }

  function assignPair(target, key, label, value, expectedLabel) {
    if (normalizeHeader(label) === normalizeHeader(expectedLabel) && value) {
      target[key] = value;
    }
  }

  function parseSpeedCoachDate(value) {
    const text = String(value || "").trim();
    const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})/);
    if (!match) return { date: "", time: text };
    const [, month, day, year, hour, minute, second] = match;
    return {
      date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      time: `${String(hour).padStart(2, "0")}:${minute}:${second}`,
    };
  }

  function parseSpeedCoachSummary(table) {
    const start = findSectionIndex(table, "Session Summary:");
    if (start < 0) return {};
    const headerIndex = nextNonEmptyRow(table, start + 1);
    if (headerIndex < 0) return {};
    const valueIndex = nextNonEmptyRow(table, headerIndex + 2);
    if (valueIndex < 0) return {};
    const row = rowObject(table[headerIndex], table[valueIndex]);
    const distance = firstFiniteValue(row, ["Total Distance (GPS)", "Total Distance (IMP)"], parseNumber);
    const duration = firstFiniteValue(row, ["Total Elapsed Time"], parseTime);
    const avgPace = firstFiniteValue(row, ["Avg Split (GPS)", "Avg Split (IMP)"], parsePace);
    const rate = firstFiniteValue(row, ["Avg Stroke Rate"], parseNumber);
    const strokes = firstFiniteValue(row, ["Total Strokes"], parseNumber);
    const distPerStroke = firstFiniteValue(row, ["Distance/Stroke (GPS)", "Distance/Stroke (IMP)"], parseNumber);
    const hr = firstFiniteValue(row, ["Avg Heart Rate"], parseNumber);
    const power = firstFiniteValue(row, ["Avg Power"], parseNumber);
    const startLat = firstFiniteValue(row, ["Start GPS Lat."], parseNumber);
    const startLon = firstFiniteValue(row, ["Start GPS Lon."], parseNumber);
    return {
      distance,
      duration,
      avgPace,
      rate,
      strokes,
      distPerStroke,
      hr,
      power,
      startLat,
      startLon,
    };
  }

  function parseSpeedCoachIntervalSummaries(table) {
    const start = findSectionIndex(table, "Interval Summaries:");
    if (start < 0) return [];
    const headerIndex = nextNonEmptyRow(table, start + 1);
    if (headerIndex < 0) return [];
    const headers = table[headerIndex].map((header, index) => header || `Column ${index + 1}`);
    const intervals = [];
    for (let index = headerIndex + 2; index < table.length; index += 1) {
      const line = table[index];
      if (!line.some(Boolean)) break;
      if (/^[A-Za-z].+:$/.test(line[0])) break;
      const row = rowObject(headers, line);
      const interval = parseNumber(row.Interval);
      if (!Number.isFinite(interval)) continue;
      intervals.push({
        interval,
        distance: firstFiniteValue(row, ["Total Distance (GPS)", "Total Distance (IMP)"], parseNumber),
        duration: firstFiniteValue(row, ["Total Elapsed Time"], parseTime),
        avgPace: firstFiniteValue(row, ["Avg Split (GPS)", "Avg Split (IMP)"], parsePace),
        rate: firstFiniteValue(row, ["Avg Stroke Rate"], parseNumber),
        strokes: firstFiniteValue(row, ["Total Strokes"], parseNumber),
        distPerStroke: firstFiniteValue(row, ["Distance/Stroke (GPS)", "Distance/Stroke (IMP)"], parseNumber),
        hr: firstFiniteValue(row, ["Avg Heart Rate"], parseNumber),
        power: firstFiniteValue(row, ["Avg Power"], parseNumber),
        startLat: firstFiniteValue(row, ["Start GPS Lat."], parseNumber),
        startLon: firstFiniteValue(row, ["Start GPS Lon."], parseNumber),
      });
    }
    return intervals;
  }

  function parseSpeedCoachPerStroke(table, sectionIndex) {
    const headerIndex = nextNonEmptyRow(table, sectionIndex + 1);
    if (headerIndex < 0) return { headers: [], columns: {}, rows: [] };
    const headers = table[headerIndex].map((header, index) => header || `Column ${index + 1}`);
    const rows = [];
    for (let index = headerIndex + 2; index < table.length; index += 1) {
      const line = table[index];
      if (!line.some(Boolean)) continue;
      if (/^[A-Za-z].+:$/.test(line[0])) break;
      const row = rowObject(headers, line);
      rows.push({
        time: parseTime(row["Elapsed Time"]),
        distance: parseNumber(row["Distance (GPS)"]),
        pace: parsePace(row["Split (GPS)"]),
        speed: parseSpeed(row["Speed (GPS)"], "Speed (GPS)"),
        rate: parseNumber(row["Stroke Rate"]),
        strokes: parseNumber(row["Total Strokes"]),
        distPerStroke: parseNumber(row["Distance/Stroke (GPS)"]),
        hr: parseNumber(row["Heart Rate"]),
        power: parseNumber(row.Power),
        lat: parseNumber(row["GPS Lat."]),
        lon: parseNumber(row["GPS Lon."]),
        interval: parseNumber(row.Interval),
        source: row,
      });
    }
    return {
      headers,
      columns: {
        time: "Elapsed Time",
        distance: "Distance (GPS)",
        pace: "Split (GPS)",
        speed: "Speed (GPS)",
        rate: "Stroke Rate",
        strokes: "Total Strokes",
        distPerStroke: "Distance/Stroke (GPS)",
        lat: "GPS Lat.",
        lon: "GPS Lon.",
      },
      rows,
    };
  }

  function rowObject(headers, values) {
    const object = {};
    headers.forEach((header, index) => {
      object[header] = values[index] ?? "";
    });
    return object;
  }

  function firstFiniteValue(row, keys, parser) {
    for (const key of keys) {
      const value = parser(row[key]);
      if (Number.isFinite(value)) return value;
    }
    return NaN;
  }

  function parseCsvWithHeader(text) {
    const normalized = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const delimiter = detectDelimiter(normalized);
    const allRows = parseDelimited(normalized, delimiter).filter((row) =>
      row.some((cell) => String(cell || "").trim() !== ""),
    );
    if (!allRows.length) {
      return { headers: [], rows: [], warnings: ["Prazna CSV datoteka"] };
    }

    let headerIndex = 0;
    let bestScore = -1;
    const scanLimit = Math.min(25, allRows.length);
    for (let index = 0; index < scanLimit; index += 1) {
      const score = headerScore(allRows[index]);
      if (score > bestScore) {
        bestScore = score;
        headerIndex = index;
      }
    }

    const headers = allRows[headerIndex].map((header, index) => {
      const trimmed = String(header || "").trim();
      return trimmed || `Column ${index + 1}`;
    });
    const rows = allRows.slice(headerIndex + 1).map((row) => {
      const object = {};
      headers.forEach((header, index) => {
        object[header] = row[index] ?? "";
      });
      return object;
    });
    return { headers, rows, warnings: [] };
  }

  function detectDelimiter(text) {
    const sample = text.split("\n").slice(0, 10).join("\n");
    const candidates = [",", ";", "\t", "|"];
    return candidates
      .map((delimiter) => ({
        delimiter,
        count: countOutsideQuotes(sample, delimiter),
      }))
      .sort((a, b) => b.count - a.count)[0].delimiter;
  }

  function countOutsideQuotes(text, delimiter) {
    let count = 0;
    let quoted = false;
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      if (char === '"' && text[index + 1] === '"') {
        index += 1;
      } else if (char === '"') {
        quoted = !quoted;
      } else if (!quoted && char === delimiter) {
        count += 1;
      }
    }
    return count;
  }

  function parseDelimited(text, delimiter) {
    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      if (char === '"' && quoted && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = !quoted;
      } else if (!quoted && char === delimiter) {
        row.push(cell);
        cell = "";
      } else if (!quoted && char === "\n") {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
      } else {
        cell += char;
      }
    }
    row.push(cell);
    rows.push(row);
    return rows;
  }

  function headerScore(row) {
    const values = row.map(normalizeHeader);
    const compactValues = row.map(compactHeader);
    let score = 0;
    Object.values(columnHints).forEach((hints) => {
      const found = values.some((value, index) =>
        hints.some((hint) => value.includes(hint) || compactValues[index].includes(compactHeader(hint))),
      );
      if (found) score += 1;
    });
    return score;
  }

  function detectColumns(headers) {
    const result = {};
    Object.entries(columnHints).forEach(([key, hints]) => {
      result[key] = findColumn(headers, hints, key);
    });
    return result;
  }

  function findColumn(headers, hints, key) {
    const normalized = headers.map((header) => ({
      original: header,
      normal: normalizeHeader(header),
      compact: compactHeader(header),
    }));

    const scored = normalized
      .map((header) => ({ header, score: scoreColumn(header, hints, key) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score);

    return scored[0]?.header.original || "";
  }

  function scoreColumn(header, hints, key) {
    let score = 0;
    hints.forEach((hint) => {
      const normalHint = normalizeHeader(hint);
      const compactHint = compactHeader(hint);
      if (header.normal === normalHint) score = Math.max(score, 120 + normalHint.length);
      if (header.compact === compactHint) score = Math.max(score, 110 + compactHint.length);
      if (header.normal.includes(normalHint)) score = Math.max(score, 60 + normalHint.length);
      if (header.compact.includes(compactHint)) score = Math.max(score, 55 + compactHint.length);
    });

    if (score <= 0) return 0;

    if (key === "time") {
      if (/(elapsed|cumulative|cum|workout|total)/.test(header.compact)) score += 80;
      if (/(drive|recovery|stroke)/.test(header.compact)) score -= 90;
    }
    if (key === "distance") {
      if (/(total|elapsed|cumulative|cum|odometer)/.test(header.compact)) score += 70;
      if (/(strokedistance|drivelength|effectivelength)/.test(header.compact)) score -= 100;
    }
    if (key === "rate" && /stroke/.test(header.compact)) score += 25;
    if (key === "power" && /(power|watt|watts)/.test(header.compact)) score += 35;
    if (key === "speed" && /(speed|velocity)/.test(header.compact)) score += 35;
    if (key === "lat" && /^lat(itude)?$/.test(header.compact)) score += 60;
    if (key === "lon" && /^(lon|lng|longitude)$/.test(header.compact)) score += 60;

    return score;
  }

  function normalizeRow(row, headers, columns) {
    const value = (key) => (columns[key] ? row[columns[key]] : "");
    return {
      time: parseTime(value("time")),
      distance: parseNumber(value("distance")),
      pace: parsePace(value("pace")),
      speed: parseSpeed(value("speed"), columns.speed),
      rate: parseNumber(value("rate")),
      hr: parseNumber(value("hr")),
      power: parseNumber(value("power")),
      lat: parseNumber(value("lat")),
      lon: parseNumber(value("lon")),
      state: parseNumber(value("state")),
      source: row,
    };
  }

  function buildPoints(rows, options = {}) {
    const normalizeTime = options.normalizeTime !== false;
    const normalizeDistance = options.normalizeDistance !== false;
    const allowIntervalResets = options.allowIntervalResets === true;
    const points = rows
      .map((row, index) => ({ ...row, index }))
      .filter((row) =>
        Number.isFinite(row.time) ||
        Number.isFinite(row.distance) ||
        Number.isFinite(row.pace) ||
        Number.isFinite(row.speed),
      );

    if (!points.length) return [];

    fillMissingTime(points);
    fillMissingDistance(points);

    const firstTime = normalizeTime ? firstFinite(points, "time") || 0 : 0;
    const firstDistance = normalizeDistance ? firstFinite(points, "distance") || 0 : 0;
    const lastByGroup = new Map();

    return points
      .map((point) => {
        const time = Number.isFinite(point.time) ? point.time - firstTime : NaN;
        const distance = Number.isFinite(point.distance) ? point.distance - firstDistance : NaN;
        const pace = Number.isFinite(point.pace)
          ? point.pace
          : Number.isFinite(point.speed) && point.speed > 0
            ? 500 / point.speed
            : NaN;
        return { ...point, time, distance, pace };
      })
      .filter((point) => {
        const groupKey =
          allowIntervalResets && Number.isFinite(point.interval)
            ? `interval-${point.interval}`
            : "session";
        const previous = lastByGroup.get(groupKey) || { time: -Infinity, distance: -Infinity };
        const okTime = Number.isFinite(point.time) && point.time >= previous.time;
        const okDistance = Number.isFinite(point.distance) && point.distance >= previous.distance;
        if (okTime) previous.time = point.time;
        if (okDistance) previous.distance = point.distance;
        lastByGroup.set(groupKey, previous);
        return okTime || okDistance;
      });
  }

  function fillMissingTime(points) {
    if (points.some((point) => Number.isFinite(point.time))) return;
    let time = 0;
    points.forEach((point, index) => {
      if (index > 0) {
        const previous = points[index - 1];
        const deltaDistance = Number.isFinite(point.distance) && Number.isFinite(previous.distance)
          ? Math.max(0, point.distance - previous.distance)
          : 0;
        const pace = Number.isFinite(point.pace) ? point.pace : previous.pace;
        if (deltaDistance > 0 && Number.isFinite(pace)) {
          time += (pace / 500) * deltaDistance;
        } else {
          time += 1;
        }
      }
      point.time = time;
    });
  }

  function fillMissingDistance(points) {
    if (points.some((point) => Number.isFinite(point.distance))) return;
    let distance = 0;
    points.forEach((point, index) => {
      if (index > 0) {
        const previous = points[index - 1];
        const deltaTime = Number.isFinite(point.time) && Number.isFinite(previous.time)
          ? Math.max(0, point.time - previous.time)
          : 0;
        const speed = Number.isFinite(point.speed)
          ? point.speed
          : Number.isFinite(point.pace) && point.pace > 0
            ? 500 / point.pace
            : 0;
        distance += deltaTime * speed;
      }
      point.distance = distance;
    });
  }

  function firstFinite(points, key) {
    const point = points.find((item) => Number.isFinite(item[key]));
    return point ? point[key] : NaN;
  }

  function summarizePoints(points) {
    if (!points.length) {
      return emptySummary();
    }
    const last = points[points.length - 1];
    const duration = Number.isFinite(last.time) ? last.time : 0;
    const distance = Number.isFinite(last.distance) ? last.distance : 0;
    const avgPace = distance > 0 ? duration / (distance / 500) : NaN;
    const rate = average(points.map((point) => point.rate));
    const hr = average(points.map((point) => point.hr));
    const power = average(points.map((point) => point.power));
    const strokes = maxFinite(points.map((point) => point.strokes));
    const distPerStroke = average(points.map((point) => point.distPerStroke));
    const best500 = bestDistanceTimeByInterval(points, 500);
    const best1000 = bestDistanceTimeByInterval(points, 1000);
    const maxRate = maxFinite(points.map((point) => point.rate));
    const maxHr = maxFinite(points.map((point) => point.hr));
    return {
      duration,
      distance,
      avgPace,
      rate,
      hr,
      power,
      strokes,
      distPerStroke,
      best500,
      best1000,
      maxRate,
      maxHr,
      pointCount: points.length,
      hasGps: points.some((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon)),
    };
  }

  function emptySummary() {
    return {
      duration: 0,
      distance: 0,
      avgPace: NaN,
      rate: NaN,
      hr: NaN,
      power: NaN,
      strokes: NaN,
      distPerStroke: NaN,
      best500: NaN,
      best1000: NaN,
      maxRate: NaN,
      maxHr: NaN,
      pointCount: 0,
      hasGps: false,
    };
  }

  function bestDistanceTime(points, meters) {
    const distancePoints = points.filter((point) => Number.isFinite(point.distance) && Number.isFinite(point.time));
    if (distancePoints.length < 2 || distancePoints[distancePoints.length - 1].distance < meters) return NaN;
    let best = Infinity;
    for (let startIndex = 0; startIndex < distancePoints.length; startIndex += 1) {
      const start = distancePoints[startIndex];
      const targetDistance = start.distance + meters;
      const endTime = interpolateTimeAtDistance(distancePoints, targetDistance, startIndex);
      if (Number.isFinite(endTime)) {
        best = Math.min(best, endTime - start.time);
      }
    }
    return Number.isFinite(best) ? best : NaN;
  }

  function bestDistanceTimeByInterval(points, meters) {
    const grouped = groupPointsByInterval(points);
    if (grouped.length <= 1) return bestDistanceTime(points, meters);
    return minFinite(grouped.map((group) => bestDistanceTime(group, meters)));
  }

  function groupPointsByInterval(points) {
    const hasIntervals = points.some((point) => Number.isFinite(point.interval));
    if (!hasIntervals) return [points];
    const grouped = new Map();
    points.forEach((point) => {
      const key = Number.isFinite(point.interval) ? point.interval : 1;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(point);
    });
    return Array.from(grouped.entries())
      .sort((a, b) => a[0] - b[0])
      .map((entry) => entry[1]);
  }

  function interpolateTimeAtDistance(points, targetDistance, startIndex) {
    for (let index = Math.max(1, startIndex + 1); index < points.length; index += 1) {
      const previous = points[index - 1];
      const current = points[index];
      if (previous.distance <= targetDistance && current.distance >= targetDistance) {
        const span = current.distance - previous.distance;
        if (span <= 0) return current.time;
        const ratio = (targetDistance - previous.distance) / span;
        return previous.time + ratio * (current.time - previous.time);
      }
    }
    return NaN;
  }

  function makeSegments(points, summary, meters) {
    if (!points.length || summary.distance < Math.min(100, meters)) return [];
    const distancePoints = points.filter((point) => Number.isFinite(point.distance) && Number.isFinite(point.time));
    const segments = [];
    const total = summary.distance;
    for (let start = 0; start < total; start += meters) {
      const end = Math.min(start + meters, total);
      if (end - start < meters * 0.35) continue;
      const startTime = start <= 0 ? 0 : interpolateTimeAtDistance(distancePoints, start, 0);
      const endTime = interpolateTimeAtDistance(distancePoints, end, 0);
      const slice = points.filter((point) => point.distance >= start && point.distance <= end);
      const duration = Number.isFinite(startTime) && Number.isFinite(endTime) ? endTime - startTime : NaN;
      segments.push({
        start,
        end,
        distance: end - start,
        duration,
        pace: duration > 0 ? duration / ((end - start) / 500) : NaN,
        rate: average(slice.map((point) => point.rate)),
        hr: average(slice.map((point) => point.hr)),
        power: average(slice.map((point) => point.power)),
      });
    }
    return segments;
  }

  function buildIntervalData(points, intervalSummaries) {
    const grouped = new Map();
    points.forEach((point, index) => {
      const key = Number.isFinite(point.interval) ? point.interval : 1;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push({ ...point, originalIndex: index });
    });
    const intervals = Array.from(grouped.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([interval, group], index) => {
        const summary = intervalSummaries.find((item) => item.interval === interval) || {};
        const first = group[0];
        const last = group[group.length - 1];
        const rawDistance = Number.isFinite(last?.distance) ? last.distance : NaN;
        const rawSpan = Number.isFinite(last?.distance) && Number.isFinite(first?.distance)
          ? last.distance - first.distance
          : NaN;
        const expectedDistance = Number.isFinite(summary.distance) ? summary.distance : rawDistance;
        const shouldOffsetDistance =
          Number.isFinite(expectedDistance) &&
          Number.isFinite(rawDistance) &&
          Number.isFinite(rawSpan) &&
          rawDistance > expectedDistance * 1.35 &&
          rawSpan > expectedDistance * 0.55;
        const distanceOffset = shouldOffsetDistance && Number.isFinite(first.distance) ? first.distance : 0;
        const timeOffset =
          Number.isFinite(first.time) &&
          Number.isFinite(summary.duration) &&
          Number.isFinite(last.time) &&
          last.time > summary.duration * 1.35
            ? first.time
            : 0;
        const normalizedPoints = group.map((point) => ({
          ...point,
          interval,
          intervalIndex: index,
          localDistance: Number.isFinite(point.distance) ? Math.max(0, point.distance - distanceOffset) : NaN,
          localTime: Number.isFinite(point.time) ? Math.max(0, point.time - timeOffset) : NaN,
        }));
        const distance = Number.isFinite(summary.distance)
          ? summary.distance
          : maxFinite(normalizedPoints.map((point) => point.localDistance));
        const duration = Number.isFinite(summary.duration)
          ? summary.duration
          : maxFinite(normalizedPoints.map((point) => point.localTime));
        return {
          ...summary,
          interval,
          index,
          label: `Interval ${interval}`,
          distance,
          duration,
          avgPace: Number.isFinite(summary.avgPace)
            ? summary.avgPace
            : distance > 0 && Number.isFinite(duration)
              ? duration / (distance / 500)
              : average(normalizedPoints.map((point) => point.pace)),
          rate: Number.isFinite(summary.rate) ? summary.rate : average(normalizedPoints.map((point) => point.rate)),
          strokes: Number.isFinite(summary.strokes) ? summary.strokes : normalizedPoints.length,
          distPerStroke: Number.isFinite(summary.distPerStroke)
            ? summary.distPerStroke
            : average(normalizedPoints.map((point) => point.distPerStroke)),
          points: normalizedPoints,
        };
      });
    intervals.forEach((interval, index) => {
      if (index === 0) return;
      const previousLast = intervals[index - 1].points.at(-1);
      const currentFirst = interval.points[0];
      interval.gapFromPreviousMeters = gpsDistanceMeters(previousLast, currentFirst);
    });
    return intervals.length ? intervals : [{ interval: 1, index: 0, label: "Interval 1", points }];
  }

  function strokePlotPoints(session) {
    if (!session) return [];
    const avgPace = session.summary.avgPace;
    const intervals = session.intervals?.length ? session.intervals : buildIntervalData(session.points, []);
    return intervals.flatMap((interval) =>
      interval.points.filter((point, index) => isUsableChartPoint(point, index, avgPace)),
    );
  }

  function isUsableChartPoint(point, index, avgPace) {
    const distance = Number.isFinite(point.localDistance) ? point.localDistance : point.distance;
    if (!Number.isFinite(distance) || !Number.isFinite(point.pace) || !Number.isFinite(point.rate)) {
      return false;
    }
    if (index === 0 && distance < 6 && Number.isFinite(avgPace) && point.pace > avgPace * 1.6) {
      return false;
    }
    return point.pace > 0 && point.pace < 600;
  }

  function makeStrokeSegments(session, meters) {
    const segments = [];
    const intervals = session.intervals?.length ? session.intervals : buildIntervalData(session.points, []);
    intervals.forEach((interval) => {
      const points = interval.points.filter((point) => {
        const distance = Number.isFinite(point.localDistance) ? point.localDistance : point.distance;
        return Number.isFinite(distance) && Number.isFinite(point.pace) && Number.isFinite(point.rate);
      });
      if (!points.length) return;
      const maxDistance = Number.isFinite(interval.distance)
        ? interval.distance
        : maxFinite(points.map((point) => point.localDistance));
      for (let start = 0; start < maxDistance; start += meters) {
        const isLast = start + meters >= maxDistance;
        const endExclusive = start + meters;
        const slice = points.filter((point) => {
          const distance = Number.isFinite(point.localDistance) ? point.localDistance : point.distance;
          return isLast
            ? distance >= start && distance <= maxDistance + 0.001
            : distance >= start && distance < endExclusive;
        });
        if (!slice.length) continue;
        const endLabel = isLast ? Math.round(maxDistance) : start + meters - 1;
        const avgSplit = average(slice.map((point) => point.pace));
        const avgSpm = average(slice.map((point) => point.rate));
        const roundedSplit = Number.isFinite(avgSplit) ? Math.round(avgSplit * 10) / 10 : NaN;
        const segmentDistance = Math.min(meters, maxDistance - start);
        segments.push({
          interval: interval.interval,
          intervalLabel: interval.label,
          start,
          end: endLabel,
          label: `${Math.round(start)}-${endLabel} m`,
          strokes: slice.length,
          pace: avgSplit,
          rate: avgSpm,
          hr: average(slice.map((point) => point.hr)),
          power: average(slice.map((point) => point.power)),
          duration: Number.isFinite(roundedSplit)
            ? Math.round(roundedSplit * (segmentDistance / 500) * 10) / 10
            : NaN,
        });
      }
    });
    const splitValues = segments.map((segment) => segment.pace).filter(Number.isFinite);
    const best = minFinite(splitValues);
    const worst = maxFinite(splitValues);
    return segments.map((segment, index) => ({
      ...segment,
      phase: segmentPhase(segment, index, segments.length, best, worst),
      isBest: Number.isFinite(segment.pace) && segment.pace === best,
      isWorst: Number.isFinite(segment.pace) && segment.pace === worst,
    }));
  }

  function segmentPhase(segment, index, count, best, worst) {
    if (index === 0) return "Start";
    if (index >= count - 2) return index === count - 1 ? "Finiš 2" : "Finiš 1";
    if (Number.isFinite(segment.pace) && segment.pace === best) return "Najbrže";
    if (Number.isFinite(segment.pace) && segment.pace === worst) return "Najsporije";
    if (index === 1) return "Post-start";
    return "Sredina";
  }

  function render() {
    window.__trainingState = state;
    const filtered = filteredSessions();
    const previousSelectedId = state.selectedId;
    if (!filtered.some((session) => session.id === state.selectedId)) {
      state.selectedId = filtered[0]?.id || state.sessions[0]?.id || "";
    }
    if (!state.calendarMonth || state.selectedId !== previousSelectedId) {
      syncCalendarMonthToSelected();
    }
    renderSessionSelect(filtered);
    renderSummary(filtered);
    renderSessionDetails(getSelectedSession());
    renderTables(filtered);
    renderCharts();
    queueResponsiveVisualsAfterLayout();
    elements.emptyState.hidden = state.sessions.length > 0;
  }

  function queueResponsiveVisualsAfterLayout() {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(renderResponsiveVisuals);
    });
  }

  function renderResponsiveVisuals() {
    renderCharts();
    renderHeatmapMapPanel(getSelectedSession());
  }

  function filteredSessions() {
    if (state.rangeDays === "all") return [...state.sessions].sort(sortByDateDesc);
    const days = Number(state.rangeDays);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    return state.sessions
      .filter((session) => parseDate(session.date) >= startOfDay(cutoff))
      .sort(sortByDateDesc);
  }

  function renderSessionSelect(sessions) {
    const options = sessions.length ? sessions : state.sessions;
    elements.sessionSelect.innerHTML = "";
    if (!options.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "Nema treninga";
      elements.sessionSelect.append(option);
      return;
    }
    options.forEach((session) => {
      const option = document.createElement("option");
      option.value = session.id;
      option.textContent = `${formatDate(session.date)} - ${session.title}`;
      elements.sessionSelect.append(option);
    });
    elements.sessionSelect.value = state.selectedId;
  }

  function renderSummary(sessions) {
    const session = getSelectedSession() || sessions[0];
    const summary = session?.summary || emptySummary();
    elements.metricSessions.textContent = formatDurationTenths(summary.duration);
    elements.metricDistance.textContent = Number.isFinite(summary.distance)
      ? formatNumber(summary.distance, 1)
      : "--";
    elements.metricDuration.textContent = formatSplitOnly(summary.avgPace);
    elements.metricPace.textContent = formatNumber(summary.rate, 1);
    elements.metricRate.textContent = Number.isFinite(summary.strokes)
      ? formatNumber(summary.strokes, 0)
      : "--";
    elements.metricBest500.textContent = Number.isFinite(summary.distPerStroke)
      ? formatNumber(summary.distPerStroke, 1)
      : "--";
  }

  function renderSessionDetails(session) {
    if (!session) {
      elements.sessionTitle.textContent = "Nema podataka";
      elements.sessionMeta.innerHTML = "";
      elements.headerSubtitle.textContent = "Javni veslački dnevnik";
      elements.deviceBadge.textContent = "SpeedCoach CSV";
      elements.detailDistance.textContent = "--";
      elements.detailDuration.textContent = "--";
      elements.detailPace.textContent = "--";
      elements.detailRate.textContent = "--";
      elements.detailHr.textContent = "--";
      elements.detailPower.textContent = "--";
      elements.routeStats.innerHTML = "";
      return;
    }
    const summary = session.summary;
    elements.sessionTitle.textContent = sessionTitle(session);
    elements.headerSubtitle.textContent = sessionSubtitle(session);
    elements.deviceBadge.textContent = deviceLabel(session);
    elements.sessionMeta.innerHTML = [
      formatDate(session.date),
      session.startTime,
      session.location,
      session.boat,
      session.type,
      session.sourceKind,
      sessionStorageLabel(session),
    ]
      .filter(Boolean)
      .map((value) => `<span>${escapeHtml(value)}</span>`)
      .join("");
    elements.detailDistance.textContent = formatPace(summary.best500);
    elements.detailDuration.textContent = Number.isFinite(summary.best1000)
      ? `${formatDurationTenths(summary.best1000)} (${formatSplitOnly(summary.best1000 / 2)})`
      : "--";
    elements.detailPace.textContent = String(strokePlotPoints(session).length || summary.pointCount || "--");
    elements.detailRate.textContent = Number.isFinite(summary.maxRate)
      ? formatNumber(summary.maxRate, 1)
      : "--";
    elements.detailHr.textContent = Number.isFinite(summary.hr)
      ? `${formatNumber(summary.hr, 0)} bpm`
      : "--";
    elements.detailPower.textContent = Number.isFinite(summary.power)
      ? `${formatNumber(summary.power, 0)} W`
      : "--";
    renderIntervalOverview(session);
    elements.routeStats.innerHTML = [
      `Točaka: ${summary.pointCount}`,
      summary.hasGps ? "GPS: dostupan" : "GPS: nema koordinata",
      Number.isFinite(summary.best1000)
        ? `Najboljih 1000 m: ${formatDurationTenths(summary.best1000)}`
        : "",
      Number.isFinite(summary.startLat) && Number.isFinite(summary.startLon)
        ? `Start: ${formatNumber(summary.startLat, 5)}, ${formatNumber(summary.startLon, 5)}`
        : "",
      Number.isFinite(summary.maxHr) ? `Max HR: ${formatNumber(summary.maxHr, 0)} bpm` : "",
    ]
      .filter(Boolean)
      .map((value) => `<div>${escapeHtml(value)}</div>`)
      .join("");
    renderHeatmapMapPanel(session);
  }

  function renderIntervalOverview(session) {
    const intervals = session.intervals || [];
    if (intervals.length <= 1) {
      elements.intervalOverview.hidden = true;
      elements.intervalOverview.innerHTML = "";
      return;
    }
    elements.intervalOverview.hidden = false;
    elements.intervalOverview.innerHTML = intervals
      .map(
        (interval) => `
          <article class="interval-card">
            <span>${escapeHtml(interval.label)}</span>
            <strong>${formatMetersCompact(interval.distance)}</strong>
            <div>${formatDurationTenths(interval.duration)} · ${formatSplitOnly(interval.avgPace)} /500</div>
            <div>${formatNumber(interval.rate, 1)} spm · ${formatNumber(interval.strokes, 0)} zaveslaja</div>
            ${
              Number.isFinite(interval.gapFromPreviousMeters)
                ? `<div>Razmak prije: ${formatMetersCompact(interval.gapFromPreviousMeters)}</div>`
                : ""
            }
          </article>
        `,
      )
      .join("");
  }

  function renderStaticMapPanel(session) {
    if (!session) {
      elements.mapTiles.innerHTML = "";
      elements.routeOverlay.innerHTML = "";
      elements.routeOverlay.setAttribute("viewBox", "0 0 100 100");
      if (elements.mapLabels) elements.mapLabels.innerHTML = "";
      elements.routeStats.innerHTML = "";
      return;
    }
    const routeGroups = groupPointsByInterval(session.points)
      .map((group) => group.filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon)))
      .filter((group) => group.length >= 2);
    const route = routeGroups.flat();
    if (route.length < 2) {
      elements.mapTiles.innerHTML = "";
      elements.routeOverlay.innerHTML = "";
      elements.routeOverlay.setAttribute("viewBox", "0 0 100 100");
      if (elements.mapLabels) elements.mapLabels.innerHTML = "";
      elements.routeStats.innerHTML = "<div>GPS koordinate nisu dostupne u ovom CSV-u.</div>";
      return;
    }
    const mapView = buildStaticMapView(route);
    const { width, height, zoom, topLeftX, topLeftY, tileMinX, tileMaxX, tileMinY, tileMaxY } = mapView;
    const centerLat = average(route.map((point) => point.lat));
    const centerLon = average(route.map((point) => point.lon));
    const tileLimit = 2 ** zoom;
    elements.mapTiles.innerHTML = "";
    elements.routeOverlay.setAttribute("viewBox", `0 0 ${width} ${height}`);
    elements.routeOverlay.setAttribute("preserveAspectRatio", "none");
    for (let tileY = tileMinY; tileY <= tileMaxY; tileY += 1) {
      if (tileY < 0 || tileY >= tileLimit) continue;
      for (let tileX = tileMinX; tileX <= tileMaxX; tileX += 1) {
        const wrappedX = ((tileX % tileLimit) + tileLimit) % tileLimit;
        const img = document.createElement("img");
        img.className = "map-tile";
        img.alt = "";
        img.loading = "lazy";
        img.decoding = "async";
        img.src = `https://tile.openstreetmap.org/${zoom}/${wrappedX}/${tileY}.png`;
        img.style.left = `${Math.round(tileX * 256 - topLeftX)}px`;
        img.style.top = `${Math.round(tileY * 256 - topLeftY)}px`;
        elements.mapTiles.append(img);
      }
    }
    const project = (point) => mapView.project(point);
    const paths = routeGroups
      .map((group, index) => {
        const color = intervalColor(index);
        const path = group
          .map((point, index) => {
            const projected = project(point);
            return `${index === 0 ? "M" : "L"} ${projected.x.toFixed(3)} ${projected.y.toFixed(3)}`;
          })
          .join(" ");
        return `
          <path class="map-route-halo" d="${path}"></path>
          <path class="map-route-line" d="${path}" style="stroke:${color}"></path>
        `;
      })
      .join("");
    const first = route[0];
    const last = route[route.length - 1];
    const start = project(first);
    const finish = project(last);
    elements.routeOverlay.innerHTML = `
      ${paths}
      <circle class="map-route-point" cx="${start.x.toFixed(3)}" cy="${start.y.toFixed(3)}" r="7"></circle>
      <circle class="map-route-point finish" cx="${finish.x.toFixed(3)}" cy="${finish.y.toFixed(3)}" r="7"></circle>
    `;
    if (elements.mapLabels) {
      const labels = routeGroups.length > 1
        ? routeGroups
            .map((group, index) => {
              const point = group[Math.floor(group.length / 2)];
              const position = project(point);
              const interval = Number.isFinite(point.interval) ? point.interval : index + 1;
              return mapLabelHtml(`I${interval}`, position, "interval", intervalColor(index));
            })
            .join("")
        : "";
      elements.mapLabels.innerHTML = `
        ${labels}
        ${mapLabelHtml("START", start, "start", COLORS.green)}
        ${mapLabelHtml("KRAJ", finish, "finish", COLORS.hr)}
      `;
    }
    const osmUrl = `https://www.openstreetmap.org/?mlat=${centerLat.toFixed(7)}&mlon=${centerLon.toFixed(7)}#map=${zoom}/${centerLat.toFixed(7)}/${centerLon.toFixed(7)}`;
    const intervalLegend = routeGroups.length > 1
      ? `<div class="map-legend">${routeGroups
          .map((group, index) => {
            const interval = Number.isFinite(group[0].interval) ? group[0].interval : index + 1;
            return `<span style="--legend-color:${intervalColor(index)}">I${interval}</span>`;
          })
          .join("")}</div>`
      : "";
    elements.routeStats.innerHTML = [
      `GPS točaka: ${route.length}`,
      routeGroups.length > 1 ? `GPS dionica: ${routeGroups.length}` : "",
      intervalLegend,
      `Zoom karte: ${zoom}`,
      `Start: ${formatNumber(first.lat, 5)}, ${formatNumber(first.lon, 5)}`,
      `Cilj: ${formatNumber(last.lat, 5)}, ${formatNumber(last.lon, 5)}`,
      `<a class="map-link" href="${osmUrl}" target="_blank" rel="noreferrer">Otvori na OpenStreetMap</a>`,
    ]
      .filter(Boolean)
      .map((value) => `<div>${value}</div>`)
      .join("");
  }

  function renderHeatmapMapPanel(session) {
    if (!session) {
      clearRouteMap(elements.mapTiles, elements.routeOverlay, elements.mapLabels);
      if (elements.intervalMaps) {
        elements.intervalMaps.hidden = true;
        elements.intervalMaps.innerHTML = "";
      }
      elements.routeStats.innerHTML = "";
      return;
    }

    const routeGroups = groupPointsByInterval(session.points)
      .map((group) => group.filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon)))
      .filter((group) => group.length >= 2);
    const route = routeGroups.flat();

    if (route.length < 2) {
      clearRouteMap(elements.mapTiles, elements.routeOverlay, elements.mapLabels);
      if (elements.intervalMaps) {
        elements.intervalMaps.hidden = true;
        elements.intervalMaps.innerHTML = "";
      }
      elements.routeStats.innerHTML = "<div>GPS koordinate nisu dostupne u ovom CSV-u.</div>";
      return;
    }

    const speedScales = makeRouteSpeedScales(routeGroups);
    const mapView = renderRouteMap(elements.mapTiles, elements.routeOverlay, elements.mapLabels, routeGroups, speedScales, {
      showEndpointLabels: true,
      showIntervalLabels: true,
    });
    const centerLat = average(route.map((point) => point.lat));
    const centerLon = average(route.map((point) => point.lon));
    const first = route[0];
    const last = route[route.length - 1];
    const osmUrl = `https://www.openstreetmap.org/?mlat=${centerLat.toFixed(7)}&mlon=${centerLon.toFixed(7)}#map=${mapView.zoom}/${centerLat.toFixed(7)}/${centerLon.toFixed(7)}`;

    elements.routeStats.innerHTML = [
      `GPS točaka: ${route.length}`,
      routeGroups.length > 1 ? `GPS dionica: ${routeGroups.length}` : "",
      heatmapLegendHtml(routeGroups.length > 1 ? null : speedScales[0], {
        note: routeGroups.length > 1 ? "skala po intervalu" : "",
      }),
      `Zoom karte: ${mapView.zoom}`,
      `Start: ${formatNumber(first.lat, 5)}, ${formatNumber(first.lon, 5)}`,
      `Cilj: ${formatNumber(last.lat, 5)}, ${formatNumber(last.lon, 5)}`,
      `<a class="map-link" href="${osmUrl}" target="_blank" rel="noreferrer">Otvori na OpenStreetMap</a>`,
    ]
      .filter(Boolean)
      .map((value) => `<div>${value}</div>`)
      .join("");

    renderIntervalRouteMaps(session, routeGroups, speedScales);
  }

  function clearRouteMap(tilesEl, overlayEl, labelsEl) {
    if (tilesEl) tilesEl.innerHTML = "";
    if (overlayEl) {
      overlayEl.innerHTML = "";
      overlayEl.setAttribute("viewBox", "0 0 100 100");
    }
    if (labelsEl) labelsEl.innerHTML = "";
  }

  function renderRouteMap(tilesEl, overlayEl, labelsEl, routeGroups, speedScales, options = {}) {
    const route = routeGroups.flat();
    const groupScales = Array.isArray(speedScales) ? speedScales : routeGroups.map(() => speedScales);
    const mapView = buildStaticMapView(route, tilesEl);
    const project = (point) => mapView.project(point);
    const markerRadius = options.small ? 4.8 : 7;
    const labels = [];

    renderMapTiles(tilesEl, mapView);
    overlayEl.setAttribute("viewBox", `0 0 ${mapView.width} ${mapView.height}`);
    overlayEl.setAttribute("preserveAspectRatio", "none");

    const halos = routeGroups
      .map((group) => `<path class="map-route-halo" d="${routePath(group, project)}"></path>`)
      .join("");
    const heatSegments = routeGroups
      .map((group, index) => routeHeatSegments(group, project, groupScales[index] || groupScales[0]))
      .join("");
    const first = route[0];
    const last = route[route.length - 1];
    const start = project(first);
    const finish = project(last);

    overlayEl.innerHTML = `
      ${halos}
      ${heatSegments}
      <circle class="map-route-point" cx="${start.x.toFixed(3)}" cy="${start.y.toFixed(3)}" r="${markerRadius}"></circle>
      <circle class="map-route-point finish" cx="${finish.x.toFixed(3)}" cy="${finish.y.toFixed(3)}" r="${markerRadius}"></circle>
    `;

    if (labelsEl) {
      if (options.showIntervalLabels && routeGroups.length > 1) {
        routeGroups.forEach((group, index) => {
          const point = group[Math.floor(group.length / 2)];
          const position = offsetMapLabel(project(point), index);
          const interval = Number.isFinite(point.interval) ? point.interval : index + 1;
          labels.push(mapLabelHtml(`I${interval}`, position, "interval", COLORS.text));
        });
      }
      if (options.showEndpointLabels) {
        labels.push(mapLabelHtml("START", start, "start", COLORS.green));
        labels.push(mapLabelHtml("KRAJ", finish, "finish", COLORS.hr));
      }
      labelsEl.innerHTML = labels.join("");
    }

    return mapView;
  }

  function offsetMapLabel(position, index) {
    const offsets = [
      { x: 0, y: -5 },
      { x: 5, y: 0 },
      { x: 0, y: 5 },
      { x: -5, y: 0 },
      { x: 4, y: -4 },
      { x: 4, y: 4 },
      { x: -4, y: 4 },
      { x: -4, y: -4 },
    ];
    const offset = offsets[index % offsets.length];
    return {
      ...position,
      xPercent: position.xPercent + offset.x,
      yPercent: position.yPercent + offset.y,
    };
  }

  function renderMapTiles(tilesEl, mapView) {
    const { zoom, topLeftX, topLeftY, tileMinX, tileMaxX, tileMinY, tileMaxY } = mapView;
    const tileLimit = 2 ** zoom;
    tilesEl.innerHTML = "";

    for (let tileY = tileMinY; tileY <= tileMaxY; tileY += 1) {
      if (tileY < 0 || tileY >= tileLimit) continue;
      for (let tileX = tileMinX; tileX <= tileMaxX; tileX += 1) {
        const wrappedX = ((tileX % tileLimit) + tileLimit) % tileLimit;
        const img = document.createElement("img");
        img.className = "map-tile";
        img.alt = "";
        img.loading = "lazy";
        img.decoding = "async";
        img.src = `https://tile.openstreetmap.org/${zoom}/${wrappedX}/${tileY}.png`;
        img.style.left = `${Math.round(tileX * 256 - topLeftX)}px`;
        img.style.top = `${Math.round(tileY * 256 - topLeftY)}px`;
        tilesEl.append(img);
      }
    }
  }

  function routePath(group, project) {
    return group
      .map((point, index) => {
        const projected = project(point);
        return `${index === 0 ? "M" : "L"} ${projected.x.toFixed(3)} ${projected.y.toFixed(3)}`;
      })
      .join(" ");
  }

  function routeHeatSegments(group, project, speedScale) {
    const segments = [];
    for (let index = 1; index < group.length; index += 1) {
      const previous = group[index - 1];
      const point = group[index];
      const from = project(previous);
      const to = project(point);
      segments.push(`
        <path
          class="map-route-heat"
          d="M ${from.x.toFixed(3)} ${from.y.toFixed(3)} L ${to.x.toFixed(3)} ${to.y.toFixed(3)}"
          style="stroke:${heatmapColor(routeSegmentSpeed(previous, point), speedScale)}"
        ></path>
      `);
    }
    return segments.join("");
  }

  function renderIntervalRouteMaps(session, routeGroups, speedScales) {
    if (!elements.intervalMaps) return;
    if (routeGroups.length <= 1) {
      elements.intervalMaps.hidden = true;
      elements.intervalMaps.innerHTML = "";
      return;
    }

    elements.intervalMaps.hidden = false;
    elements.intervalMaps.innerHTML = routeGroups
      .map((group, index) => {
        const intervalNumber = Number.isFinite(group[0].interval) ? group[0].interval : index + 1;
        const summary = (session.intervals || []).find((item) => item.interval === intervalNumber) || null;
        const title = summary?.label || `Interval ${intervalNumber}`;
        const meta = summary
          ? `${formatMetersCompact(summary.distance)} - ${formatDurationTenths(summary.duration)} - ${formatSplitOnly(summary.avgPace)} /500`
          : `${group.length} GPS točaka`;
        return `
          <article class="interval-map-card" data-interval-map-index="${index}">
            <div class="interval-map-heading">
              <strong>${escapeHtml(title)}</strong>
              <span>${escapeHtml(meta)}</span>
            </div>
            <div class="mini-map-wrap">
              <div class="map-tiles"></div>
              <svg aria-label="GPS heatmap intervala ${escapeHtml(String(intervalNumber))}"></svg>
              <div class="map-labels"></div>
            </div>
            ${heatmapLegendHtml(speedScales[index], { compact: true })}
          </article>
        `;
      })
      .join("");

    elements.intervalMaps.querySelectorAll(".interval-map-card").forEach((card, index) => {
      renderRouteMap(
        card.querySelector(".map-tiles"),
        card.querySelector("svg"),
        card.querySelector(".map-labels"),
        [routeGroups[index]],
        [speedScales[index]],
        { small: true },
      );
    });
  }

  function makeRouteSpeedScales(routeGroups) {
    return routeGroups.map((group) => makeGroupSpeedScale(group));
  }

  function makeGroupSpeedScale(group) {
    const segments = collectRouteSpeedSegments(group);
    const scaleSegments = trimStartForHeatmapScale(group, segments);
    let speeds = scaleSegments.map((segment) => segment.speed);
    if (speeds.length < Math.max(8, Math.floor(segments.length * 0.35))) {
      speeds = segments.map((segment) => segment.speed);
    }

    const min = percentile(speeds, 0.14);
    const max = percentile(speeds, 0.92);
    if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 1.5, max: 5 };
    if (Math.abs(max - min) < 0.05) return { min: min - 0.2, max: max + 0.2 };
    return {
      min,
      max,
      sampleCount: speeds.length,
      clippedStart: speeds.length < segments.length,
    };
  }

  function collectRouteSpeedSegments(group) {
    const distanceMin = minFinite(group.map((point) => point.distance));
    const distanceMax = maxFinite(group.map((point) => point.distance));
    const timeMin = minFinite(group.map((point) => point.time));
    const timeMax = maxFinite(group.map((point) => point.time));

    return group
      .slice(1)
      .map((point, index) => {
        const previous = group[index];
        const speed = routeSegmentSpeed(previous, point);
        const midpointDistance =
          Number.isFinite(previous.distance) && Number.isFinite(point.distance)
            ? (previous.distance + point.distance) / 2
            : NaN;
        const midpointTime =
          Number.isFinite(previous.time) && Number.isFinite(point.time)
            ? (previous.time + point.time) / 2
            : NaN;
        return {
          speed,
          index: index + 1,
          progressMeters: Number.isFinite(midpointDistance) ? midpointDistance - distanceMin : NaN,
          progressSeconds: Number.isFinite(midpointTime) ? midpointTime - timeMin : NaN,
          progressRatio: group.length > 1 ? (index + 1) / (group.length - 1) : 0,
          distanceSpan: distanceMax - distanceMin,
          timeSpan: timeMax - timeMin,
        };
      })
      .filter((segment) => Number.isFinite(segment.speed) && segment.speed > 0.2 && segment.speed < 12);
  }

  function trimStartForHeatmapScale(group, segments) {
    if (!segments.length) return [];
    const distanceSpan = segments[0].distanceSpan;
    const timeSpan = segments[0].timeSpan;
    const startIgnoreMeters = Number.isFinite(distanceSpan) && distanceSpan >= 300
      ? Math.min(120, Math.max(35, distanceSpan * 0.045))
      : NaN;
    const startIgnoreSeconds = Number.isFinite(timeSpan) && timeSpan >= 90
      ? Math.min(22, Math.max(8, timeSpan * 0.035))
      : NaN;
    const fallbackRatio = group.length >= 30 ? 0.06 : 0;

    return segments.filter((segment) => {
      if (Number.isFinite(startIgnoreMeters)) return segment.progressMeters >= startIgnoreMeters;
      if (Number.isFinite(startIgnoreSeconds)) return segment.progressSeconds >= startIgnoreSeconds;
      return segment.progressRatio >= fallbackRatio;
    });
  }

  function percentile(values, amount) {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return NaN;
    if (sorted.length === 1) return sorted[0];
    const position = Math.max(0, Math.min(sorted.length - 1, (sorted.length - 1) * amount));
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    const weight = position - lower;
    return sorted[lower] + (sorted[upper] - sorted[lower]) * weight;
  }

  function routeSegmentSpeed(previous, point) {
    const fromPoint = pointSpeed(previous);
    const toPoint = pointSpeed(point);
    if (Number.isFinite(fromPoint) && Number.isFinite(toPoint)) return (fromPoint + toPoint) / 2;
    if (Number.isFinite(fromPoint)) return fromPoint;
    if (Number.isFinite(toPoint)) return toPoint;

    const deltaTime = point.time - previous.time;
    if (!Number.isFinite(deltaTime) || deltaTime <= 0) return NaN;
    const gpsDistance = gpsDistanceMeters(previous, point);
    const measuredDistance =
      Number.isFinite(gpsDistance) && gpsDistance > 0
        ? gpsDistance
        : Math.abs((point.distance || 0) - (previous.distance || 0));
    return Number.isFinite(measuredDistance) && measuredDistance > 0 ? measuredDistance / deltaTime : NaN;
  }

  function pointSpeed(point) {
    if (Number.isFinite(point.speed) && point.speed > 0) return point.speed;
    if (Number.isFinite(point.pace) && point.pace > 0) return 500 / point.pace;
    return NaN;
  }

  function heatmapColor(speed, speedScale) {
    if (!Number.isFinite(speed)) return "rgb(246, 200, 95)";
    const ratio = Math.max(0, Math.min(1, (speed - speedScale.min) / Math.max(0.001, speedScale.max - speedScale.min)));
    if (ratio < 0.5) return mixColor([255, 79, 79], [246, 200, 95], ratio * 2);
    return mixColor([246, 200, 95], [34, 216, 110], (ratio - 0.5) * 2);
  }

  function mixColor(from, to, ratio) {
    const color = from.map((value, index) => Math.round(value + (to[index] - value) * ratio));
    return `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
  }

  function heatmapLegendHtml(speedScale, options = {}) {
    const slow = Number.isFinite(speedScale?.min) && speedScale.min > 0 ? formatSplitOnly(500 / speedScale.min) : "Sporije";
    const fast = Number.isFinite(speedScale?.max) && speedScale.max > 0 ? formatSplitOnly(500 / speedScale.max) : "Brže";
    const note = options.note ? `<em>${escapeHtml(options.note)}</em>` : "";
    const classes = ["heatmap-legend", options.compact ? "compact" : ""].filter(Boolean).join(" ");
    return `
      <div class="${classes}" aria-label="Legenda brzine">
        <span>${Number.isFinite(speedScale?.min) ? `Sporije ${slow}` : slow}</span>
        <i aria-hidden="true"></i>
        <span>${Number.isFinite(speedScale?.max) ? `Brže ${fast}` : fast}</span>
        ${note}
      </div>
    `;
  }

  function mapLabelHtml(text, position, type, color) {
    const rawX = Number.isFinite(position.xPercent) ? position.xPercent : position.x;
    const rawY = Number.isFinite(position.yPercent) ? position.yPercent : position.y;
    const x = Math.max(4, Math.min(96, rawX));
    const y = Math.max(6, Math.min(94, rawY));
    return `<span class="map-label ${type}" style="left:${x.toFixed(2)}%;top:${y.toFixed(2)}%;--label-color:${color}">${escapeHtml(text)}</span>`;
  }

  function latLonToTile(lat, lon, zoom) {
    const latRad = (lat * Math.PI) / 180;
    const scaleValue = 2 ** zoom;
    return {
      x: ((lon + 180) / 360) * scaleValue,
      y: ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * scaleValue,
    };
  }

  function latLonToWorldPixel(lat, lon, zoom) {
    const tile = latLonToTile(lat, lon, zoom);
    return {
      x: tile.x * 256,
      y: tile.y * 256,
    };
  }

  function buildStaticMapView(route, container = elements.mapTiles) {
    const isMini = Boolean(container?.closest?.(".mini-map-wrap"));
    const rect = container?.getBoundingClientRect?.() || {};
    const width = Math.max(isMini ? 220 : 320, Math.round(rect.width || container?.clientWidth || (isMini ? 260 : 420)));
    const height = Math.max(isMini ? 160 : 300, Math.round(rect.height || container?.clientHeight || (isMini ? 180 : 340)));
    const padding = Math.max(22, Math.min(width, height) * 0.06);
    let zoom = 12;
    let pixels = [];

    for (let candidate = 18; candidate >= 6; candidate -= 1) {
      const candidatePixels = route.map((point) => latLonToWorldPixel(point.lat, point.lon, candidate));
      const spanX = maxFinite(candidatePixels.map((point) => point.x)) - minFinite(candidatePixels.map((point) => point.x));
      const spanY = maxFinite(candidatePixels.map((point) => point.y)) - minFinite(candidatePixels.map((point) => point.y));
      if (spanX <= width - padding * 2 && spanY <= height - padding * 2) {
        zoom = candidate;
        pixels = candidatePixels;
        break;
      }
    }

    if (!pixels.length) {
      pixels = route.map((point) => latLonToWorldPixel(point.lat, point.lon, zoom));
    }

    const minX = minFinite(pixels.map((point) => point.x));
    const maxX = maxFinite(pixels.map((point) => point.x));
    const minY = minFinite(pixels.map((point) => point.y));
    const maxY = maxFinite(pixels.map((point) => point.y));
    const routeWidth = Math.max(1, maxX - minX);
    const routeHeight = Math.max(1, maxY - minY);
    const centerX = minX + routeWidth / 2;
    const centerY = minY + routeHeight / 2;
    const topLeftX = Math.round(centerX - width / 2);
    const topLeftY = Math.round(centerY - height / 2);

    return {
      width,
      height,
      zoom,
      topLeftX,
      topLeftY,
      tileMinX: Math.floor(topLeftX / 256) - 1,
      tileMaxX: Math.floor((topLeftX + width) / 256) + 1,
      tileMinY: Math.floor(topLeftY / 256) - 1,
      tileMaxY: Math.floor((topLeftY + height) / 256) + 1,
      project(point) {
        const projected = latLonToWorldPixel(point.lat, point.lon, zoom);
        const x = projected.x - topLeftX;
        const y = projected.y - topLeftY;
        return {
          x,
          y,
          xPercent: (x / width) * 100,
          yPercent: (y / height) * 100,
        };
      },
    };
  }

  function chooseMapZoom(route) {
    const minLat = minFinite(route.map((point) => point.lat));
    const maxLat = maxFinite(route.map((point) => point.lat));
    const minLon = minFinite(route.map((point) => point.lon));
    const maxLon = maxFinite(route.map((point) => point.lon));
    const span = Math.max(Math.abs(maxLat - minLat), Math.abs(maxLon - minLon));
    if (span > 0.08) return 12;
    if (span > 0.04) return 13;
    if (span > 0.02) return 13;
    if (span > 0.01) return 14;
    return 16;
  }

  function renderGpsPanel(session) {
    const route = session.points.filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon));
    if (route.length < 2) {
      elements.mapFrame.removeAttribute("src");
      elements.routeOverlay.innerHTML = "";
      elements.routeStats.innerHTML = "<div>GPS koordinate nisu dostupne u ovom CSV-u.</div>";
      return;
    }
    const minLat = minFinite(route.map((point) => point.lat));
    const maxLat = maxFinite(route.map((point) => point.lat));
    const minLon = minFinite(route.map((point) => point.lon));
    const maxLon = maxFinite(route.map((point) => point.lon));
    const latPad = Math.max((maxLat - minLat) * 0.25, 0.001);
    const lonPad = Math.max((maxLon - minLon) * 0.25, 0.001);
    const bbox = [minLon - lonPad, minLat - latPad, maxLon + lonPad, maxLat + latPad];
    const centerLat = (minLat + maxLat) / 2;
    const centerLon = (minLon + maxLon) / 2;
    elements.mapFrame.src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox
      .map((value) => value.toFixed(7))
      .join("%2C")}&layer=mapnik&marker=${centerLat.toFixed(7)}%2C${centerLon.toFixed(7)}`;

    const path = route
      .map((point, index) => {
        const x = scale(point.lon, minLon - lonPad, maxLon + lonPad, 0, 100);
        const y = scale(point.lat, minLat - latPad, maxLat + latPad, 100, 0);
        return `${index === 0 ? "M" : "L"} ${x.toFixed(3)} ${y.toFixed(3)}`;
      })
      .join(" ");
    const first = route[0];
    const last = route[route.length - 1];
    const startX = scale(first.lon, minLon - lonPad, maxLon + lonPad, 0, 100);
    const startY = scale(first.lat, minLat - latPad, maxLat + latPad, 100, 0);
    const finishX = scale(last.lon, minLon - lonPad, maxLon + lonPad, 0, 100);
    const finishY = scale(last.lat, minLat - latPad, maxLat + latPad, 100, 0);
    elements.routeOverlay.innerHTML = `
      <path class="map-route-line" d="${path}"></path>
      <circle class="map-route-point" cx="${startX.toFixed(3)}" cy="${startY.toFixed(3)}" r="1.3"></circle>
      <circle class="map-route-point finish" cx="${finishX.toFixed(3)}" cy="${finishY.toFixed(3)}" r="1.3"></circle>
    `;
    const osmUrl = `https://www.openstreetmap.org/?mlat=${centerLat.toFixed(7)}&mlon=${centerLon.toFixed(
      7,
    )}#map=15/${centerLat.toFixed(7)}/${centerLon.toFixed(7)}`;
    elements.routeStats.innerHTML = [
      `GPS točaka: ${route.length}`,
      `Start: ${formatNumber(first.lat, 5)}, ${formatNumber(first.lon, 5)}`,
      `Cilj: ${formatNumber(last.lat, 5)}, ${formatNumber(last.lon, 5)}`,
      `<a class="map-link" href="${osmUrl}" target="_blank" rel="noreferrer">Otvori na OpenStreetMap</a>`,
    ]
      .map((value) => `<div>${value}</div>`)
      .join("");
  }

  function renderTables(sessions) {
    elements.sessionTable.innerHTML = sessions
      .map(
        (session) => `
          <tr class="clickable-row ${session.id === state.selectedId ? "selected-row" : ""}" data-session-id="${escapeHtml(
            session.id,
          )}" tabindex="0" aria-label="Prikaži trening ${escapeHtml(session.title)}">
            <td>${escapeHtml(formatDate(session.date))}</td>
            <td>${escapeHtml(session.title)}</td>
            <td>${formatKm(session.summary.distance, 2)}</td>
            <td>${formatDuration(session.summary.duration)}</td>
            <td>${formatPace(session.summary.avgPace)}</td>
            <td>${formatNumber(session.summary.rate, 1)}</td>
            <td class="admin-only">
              <button class="delete-session-button" type="button" data-delete-session-id="${escapeHtml(session.id)}" aria-label="Obriši trening ${escapeHtml(session.title)}">
                Obriši
              </button>
            </td>
          </tr>
        `,
      )
      .join("");

    const session = getSelectedSession();
    const segments = session ? makeStrokeSegments(session, state.segmentMeters) : [];
    const splitValues = segments.map((segment) => segment.pace).filter(Number.isFinite);
    const spmValues = segments.map((segment) => segment.rate).filter(Number.isFinite);
    const minSplit = minFinite(splitValues);
    const maxSplit = maxFinite(splitValues);
    const minSpm = minFinite(spmValues);
    const maxSpm = maxFinite(spmValues);
    const hasMultipleIntervals = (session?.intervals?.length || 0) > 1;
    elements.segmentHead.innerHTML = `
      <tr>
        ${hasMultipleIntervals ? "<th>Interval</th>" : ""}
        <th>Dionica</th>
        <th>Faza</th>
        <th>Broj zaveslaja</th>
        <th>Avg SPM</th>
        <th>Avg Split /500m</th>
        <th>Tempo</th>
        <th>Trajanje</th>
        <th>HR</th>
      </tr>
    `;
    elements.segmentTable.innerHTML = segments.length
      ? segments
          .map(
            (segment) => `
              <tr class="${segment.isBest ? "best-row" : segment.isWorst ? "worst-row" : ""}">
                ${hasMultipleIntervals ? `<td>${escapeHtml(segment.intervalLabel || `Interval ${segment.interval}`)}</td>` : ""}
                <td>${escapeHtml(segment.label)}</td>
                <td>${phaseBadge(segment.phase)}</td>
                <td>${segment.strokes}</td>
                <td>${barCell(segment.rate, minSpm, maxSpm, "spm")}</td>
                <td class="${segment.isBest ? "best-text" : segment.isWorst ? "worst-text" : ""}">
                  ${barCell(segment.pace, minSplit, maxSplit, "split", true)}
                </td>
                <td>${formatNumber(segment.rate, 1)} spm</td>
                <td>${formatDurationTenths(segment.duration)}</td>
                <td>${Number.isFinite(segment.hr) ? formatNumber(segment.hr, 0) : "--"}</td>
              </tr>
            `,
          )
          .join("")
      : `<tr><td colspan="${hasMultipleIntervals ? 9 : 8}">Nema dovoljno per-stroke podataka za dionice.</td></tr>`;
  }

  function renderCharts() {
    hideChartTooltip();
    const session = getSelectedSession();
    const historySessions = filteredSessions().slice().reverse();
    drawSessionChart(elements.sessionChart, session);
    renderIntervalCharts(session);
    renderHistoryHighlights(historySessions);
    renderHistoryCalendar(historySessions);
  }

  function drawSessionChart(canvas, session) {
    const ctx = setupCanvas(canvas);
    clearCanvas(ctx, canvas);
    canvas._strokeHits = [];
    const chartData = buildChartData(session);
    const points = chartData.points;
    if (!session || points.length < 2) {
      drawEmptyChart(ctx, canvas, "Nema treninga za graf.");
      elements.sessionLegend.innerHTML = "";
      return;
    }

    const plot = chartBounds(canvas);
    const xMax = chartData.xMax;
    canvas._chartXMax = xMax;
    const splitValues = points.map((point) => point.pace);
    const spmValues = points.map((point) => point.rate);
    const splitMin = minFinite(splitValues);
    const splitMax = maxFinite(splitValues);
    const splitPad = Math.max(1, (splitMax - splitMin) * 0.08);
    const spmMin = minFinite(spmValues) - 2;
    const spmMax = maxFinite(spmValues) + 2;
    const avgSplit = session.summary.avgPace;
    const avgRate = session.summary.rate;

    drawRaceGrid(ctx, plot, xMax, splitMin - splitPad, splitMax + splitPad + 4, spmMin, spmMax);
    chartData.series.forEach((serie) => {
      const rawSplit = serie.points.map((point) => ({ x: point.chartX, y: point.pace }));
      const spmLine = serie.points.map((point) => ({ x: point.chartX, y: point.rate }));
      drawLineCustom(ctx, rawSplit, plot, { min: 0, max: xMax }, {
        min: splitMin - splitPad,
        max: splitMax + splitPad + 4,
        inverted: true,
      }, COLORS.pace, 2.3);
      drawLineCustom(ctx, spmLine, plot, { min: 0, max: xMax }, {
        min: spmMin,
        max: spmMax,
        inverted: false,
      }, COLORS.rate, 1.5);
    });
    drawIntervalGuides(ctx, plot, chartData, state.segmentMeters);
    drawStrokeDots(ctx, canvas, points, plot, xMax, splitMin - splitPad, splitMax + splitPad + 4);
    drawAverageLine(ctx, plot, avgSplit, splitMin - splitPad, splitMax + splitPad + 4, true, COLORS.green, `avg ${formatSplitOnly(avgSplit)}`);
    drawAverageLine(ctx, plot, avgRate, spmMin, spmMax, false, "rgba(255,107,53,0.65)", `avg ${formatNumber(avgRate, 1)} spm`, true);

    elements.sessionLegend.innerHTML = `
      <span class="legend-item"><span class="legend-swatch" style="background:${COLORS.pace}"></span>Split /500m (lijeva os, invertirana)</span>
      <span class="legend-item"><span class="legend-swatch" style="background:${COLORS.rate}"></span>Tempo SPM (desna os)</span>
      <span class="legend-item"><span class="legend-line green-line"></span>Avg split (${formatSplitOnly(avgSplit)})</span>
      <span class="legend-item"><span class="legend-line orange-line"></span>Avg SPM (${formatNumber(avgRate, 1)})</span>
    `;
  }

  function renderIntervalCharts(session) {
    const intervals = session?.intervals || [];
    if (!elements.intervalCharts || intervals.length <= 1) {
      if (elements.intervalCharts) {
        elements.intervalCharts.hidden = true;
        elements.intervalCharts.innerHTML = "";
      }
      return;
    }
    elements.intervalCharts.hidden = false;
    elements.intervalCharts.innerHTML = intervals
      .map(
        (interval, index) => `
          <article class="interval-chart-card">
            <div class="interval-chart-heading">
              <strong>I${escapeHtml(interval.interval)}</strong>
              <span>${formatMetersCompact(interval.distance)} · ${formatDurationTenths(interval.duration)} · ${formatSplitOnly(interval.avgPace)} /500</span>
            </div>
            <canvas class="interval-chart" data-interval-index="${index}" height="210" aria-label="Graf intervala ${escapeHtml(interval.interval)}"></canvas>
          </article>
        `,
      )
      .join("");
    elements.intervalCharts.querySelectorAll("canvas").forEach((canvas) => {
      const interval = intervals[Number(canvas.dataset.intervalIndex)];
      canvas.addEventListener("mousemove", handleChartHover);
      canvas.addEventListener("mouseleave", hideChartTooltip);
      drawIntervalChart(canvas, session, interval);
    });
  }

  function drawIntervalChart(canvas, session, interval) {
    const ctx = setupCanvas(canvas);
    clearCanvas(ctx, canvas);
    canvas._strokeHits = [];
    const points = intervalChartPoints(session, interval);
    if (!points || points.length < 2) {
      drawEmptyChart(ctx, canvas, "Nema dovoljno podataka za interval.");
      return;
    }
    const plot = chartBounds(canvas);
    const distanceMax = niceDistanceMax(Number.isFinite(interval.distance)
      ? interval.distance
      : maxFinite(points.map((point) => point.localDistance)));
    const splitMinRaw = minFinite(points.map((point) => point.pace));
    const splitMaxRaw = maxFinite(points.map((point) => point.pace));
    const splitPad = Math.max(1, (splitMaxRaw - splitMinRaw) * 0.1);
    const splitMin = splitMinRaw - splitPad;
    const splitMax = splitMaxRaw + splitPad + 2;
    const spmMin = minFinite(points.map((point) => point.rate)) - 2;
    const spmMax = maxFinite(points.map((point) => point.rate)) + 2;
    const color = intervalColor(interval.index);

    drawRaceGrid(ctx, plot, distanceMax, splitMin, splitMax, spmMin, spmMax);
    drawLineCustom(ctx, points.map((point) => ({ x: point.localDistance, y: point.pace })), plot, {
      min: 0,
      max: distanceMax,
    }, {
      min: splitMin,
      max: splitMax,
      inverted: true,
    }, color, 2.4);
    drawLineCustom(ctx, points.map((point) => ({ x: point.localDistance, y: point.rate })), plot, {
      min: 0,
      max: distanceMax,
    }, {
      min: spmMin,
      max: spmMax,
      inverted: false,
    }, COLORS.rate, 1.3);
    drawIntervalSegmentGuides(ctx, plot, distanceMax, state.segmentMeters);
    drawStrokeDots(ctx, canvas, points, plot, distanceMax, splitMin, splitMax, color);
    drawAverageLine(ctx, plot, interval.avgPace, splitMin, splitMax, true, COLORS.green, `I${interval.interval} ${formatSplitOnly(interval.avgPace)}`);
    drawAverageLine(ctx, plot, interval.rate, spmMin, spmMax, false, "rgba(255,107,53,0.62)", `${formatNumber(interval.rate, 1)} spm`, true);
    drawIntervalChartBadge(ctx, canvas, interval, color);
  }

  function intervalChartPoints(session, interval) {
    const avgPace = session.summary.avgPace;
    return interval.points
      .filter((point, index) => isUsableChartPoint(point, index, avgPace))
      .map((point) => {
        const localDistance = Number.isFinite(point.localDistance) ? point.localDistance : point.distance;
        return {
          ...point,
          interval: interval.interval,
          intervalLabel: interval.label,
          localDistance,
          distance: localDistance,
          chartX: localDistance,
        };
      });
  }

  function renderHistoryHighlights(sessions) {
    if (!elements.historyHighlights) return;
    if (!sessions.length) {
      elements.historyHighlights.innerHTML = "";
      return;
    }
    const totalKm = sum(sessions.map((session) => session.summary.distance || 0)) / 1000;
    const avgSplit = average(sessions.map((session) => session.summary.avgPace));
    const bestSession = sessions
      .filter((session) => Number.isFinite(session.summary.avgPace))
      .sort((a, b) => a.summary.avgPace - b.summary.avgPace)[0];
    const longestSession = sessions
      .filter((session) => Number.isFinite(session.summary.distance))
      .sort((a, b) => b.summary.distance - a.summary.distance)[0];

    elements.historyHighlights.innerHTML = [
      {
        label: "Ukupno",
        value: `${formatNumber(totalKm, totalKm >= 10 ? 1 : 2)} km`,
        note: formatTrainingCount(sessions.length),
      },
      {
        label: "Prosječni split",
        value: formatSplitOnly(avgSplit),
        note: "u odabranom razdoblju",
      },
      {
        label: "Najbolji zapis",
        value: bestSession ? formatSplitOnly(bestSession.summary.avgPace) : "--",
        note: bestSession ? formatDateShort(bestSession.date) : "--",
      },
      {
        label: "Najduži trening",
        value: longestSession ? `${formatNumber(longestSession.summary.distance / 1000, 1)} km` : "--",
        note: longestSession ? formatDateShort(longestSession.date) : "--",
      },
    ]
      .map(
        (item) => `
          <div class="trend-highlight">
            <span>${escapeHtml(item.label)}</span>
            <strong>${escapeHtml(item.value)}</strong>
            <em>${escapeHtml(item.note)}</em>
          </div>
        `,
      )
      .join("");
  }

  function renderHistoryCalendar(sessions) {
    if (!elements.historyCalendar) return;
    if (!sessions.length) {
      elements.historyCalendar.innerHTML = `
        <div class="calendar-empty">
          <strong>Nema treninga u odabranom razdoblju</strong>
          <span>Promijeni filter razdoblja ili dodaj novi CSV trening.</span>
        </div>
      `;
      return;
    }

    if (!state.calendarMonth) {
      state.calendarMonth = monthKey(parseDate(sessions[sessions.length - 1].date));
    }

    const monthDate = monthDateFromKey(state.calendarMonth);
    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const byDate = groupSessionsByDate(sessions);
    const firstDay = new Date(year, month, 1);
    const leadingDays = (firstDay.getDay() + 6) % 7;
    const visibleCells = 42;
    const monthPrefix = `${year}-${pad2(month + 1)}-`;
    const monthSessions = sessions.filter((session) => dateKeyFromValue(session.date).startsWith(monthPrefix));
    const monthKm = sum(monthSessions.map((session) => session.summary.distance || 0)) / 1000;
    const monthSplit = average(monthSessions.map((session) => session.summary.avgPace));

    const cells = Array.from({ length: visibleCells }, (_item, index) => {
      const dayOffset = index - leadingDays + 1;
      const cellDate = new Date(year, month, dayOffset);
      const key = dateKeyLocal(cellDate);
      const daySessions = (byDate.get(key) || []).slice().sort(sortByDateDesc);
      return calendarDayCell(cellDate, daySessions, month);
    }).join("");

    elements.historyCalendar.innerHTML = `
      <div class="calendar-toolbar">
        <button class="calendar-nav" type="button" data-calendar-action="prev" aria-label="Prethodni mjesec">‹</button>
        <div class="calendar-title">
          <strong>${escapeHtml(formatCalendarMonth(monthDate))}</strong>
          <span>${monthSessions.length ? `${formatTrainingCount(monthSessions.length)} · ${formatNumber(monthKm, monthKm >= 10 ? 1 : 2)} km · avg ${formatSplitOnly(monthSplit)}` : "Nema treninga u ovom mjesecu"}</span>
        </div>
        <button class="calendar-nav" type="button" data-calendar-action="next" aria-label="Sljedeći mjesec">›</button>
      </div>
      <div class="calendar-weekdays" aria-hidden="true">
        ${["Pon", "Uto", "Sri", "Čet", "Pet", "Sub", "Ned"].map((day) => `<span>${day}</span>`).join("")}
      </div>
      <div class="calendar-grid">
        ${cells}
      </div>
    `;
  }

  function calendarDayCell(date, sessions, currentMonth) {
    const key = dateKeyLocal(date);
    const isCurrentMonth = date.getMonth() === currentMonth;
    const isToday = key === dateKeyLocal(new Date());
    const isSelected = sessions.some((session) => session.id === state.selectedId);
    const dayNumber = date.getDate();
    const baseClasses = [
      "calendar-day",
      isCurrentMonth ? "" : "other-month",
      isToday ? "today" : "",
      isSelected ? "selected" : "",
    ]
      .filter(Boolean)
      .join(" ");

    if (!sessions.length) {
      return `
        <div class="${baseClasses}">
          <span class="calendar-date">${dayNumber}</span>
        </div>
      `;
    }

    const primary = sessions[0];
    const totalKm = sum(sessions.map((session) => session.summary.distance || 0)) / 1000;
    const avgSplit = average(sessions.map((session) => session.summary.avgPace));
    const intensity = totalKm >= 8 ? "long" : totalKm >= 4 ? "medium" : "short";
    const title = sessions.length > 1 ? formatTrainingCount(sessions.length) : sessionTitle(primary);
    const subtitle = `${formatNumber(totalKm, totalKm >= 10 ? 1 : 2)} km · ${formatSplitOnly(avgSplit)}`;

    return `
      <button class="${baseClasses} has-session ${intensity}" type="button" data-session-id="${escapeHtml(primary.id)}" title="${escapeHtml(`${formatDate(primary.date)} - ${title}`)}">
        <span class="calendar-date">${dayNumber}</span>
        ${sessions.length > 1 ? `<span class="calendar-session-count">${sessions.length}</span>` : ""}
        <strong>${escapeHtml(title)}</strong>
        <em>${escapeHtml(subtitle)}</em>
      </button>
    `;
  }

  function groupSessionsByDate(sessions) {
    const grouped = new Map();
    sessions.forEach((session) => {
      const key = dateKeyFromValue(session.date);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(session);
    });
    return grouped;
  }

  function drawHistoryChart(canvas, sessions) {
    const ctx = setupCanvas(canvas);
    clearCanvas(ctx, canvas);
    if (!sessions.length) {
      drawEmptyChart(ctx, canvas, "Nema treninga u odabranom razdoblju.");
      return;
    }
    const width = canvas.widthCss || canvas.width;
    const height = canvas.heightCss || canvas.height;
    const plot = {
      left: 52,
      top: 42,
      right: width - 20,
      bottom: height - 46,
      width: width - 72,
      height: height - 88,
    };
    const distances = sessions.map((session) => session.summary.distance / 1000);
    const maxDistance = Math.max(1, maxFinite(distances));
    const gapCount = Math.max(1, sessions.length);
    const slotWidth = plot.width / gapCount;
    const barWidth = Math.max(10, Math.min(56, slotWidth * 0.56));
    const labelEvery = Math.max(1, Math.ceil(sessions.length / Math.max(1, Math.floor(plot.width / 74))));

    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.78)";
    ctx.font = "800 11px ui-monospace, SFMono-Regular, Consolas, monospace";
    ctx.textAlign = "left";
    ctx.fillText("Kilometri po treningu", plot.left, 22);
    ctx.fillStyle = COLORS.muted;
    ctx.font = "10px ui-monospace, SFMono-Regular, Consolas, monospace";
    ctx.fillText("Split je označen po treningu, bez povezivanja stupaca", plot.left, 36);

    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;
    ctx.fillStyle = COLORS.muted;
    ctx.textAlign = "right";
    ctx.font = "10px ui-monospace, SFMono-Regular, Consolas, monospace";
    makeAxisLabels(0, maxDistance, 4, (value) => `${formatNumber(value, maxDistance >= 10 ? 0 : 1)} km`).forEach((item) => {
      const y = scale(item.value, 0, maxDistance, plot.bottom, plot.top);
      ctx.beginPath();
      ctx.moveTo(plot.left, y);
      ctx.lineTo(plot.right, y);
      ctx.stroke();
      ctx.fillText(item.label, plot.left - 9, y + 4);
    });

    sessions.forEach((session, index) => {
      const x = plot.left + slotWidth * index + slotWidth / 2;
      const barHeight = Math.max(3, (distances[index] / maxDistance) * plot.height);
      const barTop = plot.bottom - barHeight;
      const isSelected = session.id === state.selectedId;
      const gradient = ctx.createLinearGradient(0, barTop, 0, plot.bottom);
      gradient.addColorStop(0, isSelected ? "rgba(34,216,110,0.95)" : "rgba(59,125,255,0.94)");
      gradient.addColorStop(1, isSelected ? "rgba(34,216,110,0.34)" : "rgba(59,125,255,0.26)");

      ctx.fillStyle = gradient;
      roundRect(ctx, x - barWidth / 2, barTop, barWidth, barHeight, 6);
      ctx.fill();

      if (isSelected) {
        ctx.strokeStyle = "rgba(34,216,110,0.95)";
        ctx.lineWidth = 2;
        roundRect(ctx, x - barWidth / 2 - 2, barTop - 2, barWidth + 4, barHeight + 4, 7);
        ctx.stroke();
      }

      ctx.fillStyle = "rgba(255,255,255,0.88)";
      ctx.textAlign = "center";
      ctx.font = "800 10px ui-monospace, SFMono-Regular, Consolas, monospace";
      ctx.fillText(`${formatNumber(distances[index], distances[index] >= 10 ? 1 : 2)} km`, x, Math.max(plot.top + 12, barTop - 8));

      if (Number.isFinite(session.summary.avgPace) && sessions.length <= 14) {
        drawHistoryPill(ctx, formatSplitOnly(session.summary.avgPace), x, Math.max(plot.top + 18, barTop - 31), isSelected);
      }

      if (index % labelEvery === 0 || index === sessions.length - 1) {
        ctx.fillStyle = COLORS.muted2;
        ctx.font = "10px ui-monospace, SFMono-Regular, Consolas, monospace";
        ctx.fillText(formatDateShort(session.date), x, plot.bottom + 24);
      }
    });
    ctx.restore();
  }

  function drawHistoryPill(ctx, label, x, y, isSelected) {
    const width = Math.max(48, label.length * 6.5 + 15);
    ctx.save();
    ctx.fillStyle = isSelected ? "rgba(34,216,110,0.18)" : "rgba(15,17,23,0.82)";
    ctx.strokeStyle = isSelected ? "rgba(34,216,110,0.82)" : "rgba(255,255,255,0.16)";
    ctx.lineWidth = 1;
    roundRect(ctx, x - width / 2, y, width, 20, 10);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = isSelected ? COLORS.green : "rgba(255,255,255,0.86)";
    ctx.font = "800 10px ui-monospace, SFMono-Regular, Consolas, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, x, y + 10);
    ctx.restore();
  }

  function drawRouteChart(canvas, session) {
    const ctx = setupCanvas(canvas);
    clearCanvas(ctx, canvas);
    if (!session || !session.summary.hasGps) {
      drawEmptyChart(ctx, canvas, "CSV nema GPS koordinate.");
      return;
    }
    const route = session.points.filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon));
    if (route.length < 2) {
      drawEmptyChart(ctx, canvas, "Nema dovoljno GPS točaka.");
      return;
    }
    const plot = {
      left: 24,
      top: 18,
      right: canvas.width - 24,
      bottom: canvas.height - 22,
      width: canvas.width - 48,
      height: canvas.height - 40,
    };
    const minLat = minFinite(route.map((point) => point.lat));
    const maxLat = maxFinite(route.map((point) => point.lat));
    const minLon = minFinite(route.map((point) => point.lon));
    const maxLon = maxFinite(route.map((point) => point.lon));
    drawGrid(ctx, plot, {});
    ctx.strokeStyle = COLORS.distance;
    ctx.lineWidth = 3;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    route.forEach((point, index) => {
      const x = scale(point.lon, minLon, maxLon, plot.left, plot.right);
      const y = scale(point.lat, minLat, maxLat, plot.bottom, plot.top);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    drawPoint(ctx, scale(route[0].lon, minLon, maxLon, plot.left, plot.right), scale(route[0].lat, minLat, maxLat, plot.bottom, plot.top), COLORS.gold);
    const last = route[route.length - 1];
    drawPoint(ctx, scale(last.lon, minLon, maxLon, plot.left, plot.right), scale(last.lat, minLat, maxLat, plot.bottom, plot.top), COLORS.red);
  }

  function setupCanvas(canvas) {
    const rect = canvas.getBoundingClientRect();
    const parentRect = canvas.parentElement?.getBoundingClientRect?.() || {};
    const panelRect = canvas.closest?.(".panel, .interval-chart-card")?.getBoundingClientRect?.() || {};
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth || 360;
    const cssWidth = Math.max(
      240,
      Math.floor(rect.width || parentRect.width || panelRect.width || viewportWidth - 32),
    );
    const cssHeight = getCanvasCssHeight(canvas);
    const ratio = Math.min(window.devicePixelRatio || 1, 3);
    const width = Math.floor(cssWidth * ratio);
    const height = Math.floor(cssHeight * ratio);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    canvas.style.width = "100%";
    canvas.style.height = `${cssHeight}px`;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(ratio, ratio);
    canvas.widthCss = cssWidth;
    canvas.heightCss = cssHeight;
    return ctx;
  }

  function getCanvasCssHeight(canvas) {
    if (canvas.dataset.cssHeight) return Number(canvas.dataset.cssHeight);
    const attrHeight = Number(canvas.getAttribute("height"));
    const computedHeight = Number.parseFloat(window.getComputedStyle(canvas).height);
    const cssHeight = Math.max(
      180,
      Math.floor(
        (Number.isFinite(attrHeight) && attrHeight > 0 ? attrHeight : 0)
          || (Number.isFinite(computedHeight) && computedHeight > 0 ? computedHeight : 0)
          || 280,
      ),
    );
    canvas.dataset.cssHeight = String(cssHeight);
    return cssHeight;
  }

  function clearCanvas(ctx, canvas) {
    ctx.clearRect(0, 0, canvas.widthCss || canvas.width, canvas.heightCss || canvas.height);
  }

  function chartBounds(canvas) {
    const width = canvas.widthCss || canvas.width;
    const height = canvas.heightCss || canvas.height;
    return {
      left: 58,
      top: 22,
      right: width - 48,
      bottom: height - 42,
      width: width - 106,
      height: height - 60,
    };
  }

  function drawGrid(ctx, plot, options = {}) {
    ctx.save();
    ctx.strokeStyle = COLORS.grid;
    ctx.fillStyle = COLORS.muted;
    ctx.lineWidth = 1;
    ctx.font = "11px ui-monospace, SFMono-Regular, Consolas, monospace";
    for (let index = 0; index <= 4; index += 1) {
      const y = plot.top + (plot.height / 4) * index;
      ctx.beginPath();
      ctx.moveTo(plot.left, y);
      ctx.lineTo(plot.right, y);
      ctx.stroke();
    }
    for (let index = 0; index <= 5; index += 1) {
      const x = plot.left + (plot.width / 5) * index;
      ctx.beginPath();
      ctx.moveTo(x, plot.top);
      ctx.lineTo(x, plot.bottom);
      ctx.stroke();
    }
    if (options.xLabels) {
      const labels = Array.isArray(options.xLabels)
        ? options.xLabels
        : makeAxisLabels(0, 1, 5, (value) => value);
      labels.forEach((item) => {
        const x = scale(item.value, labels[0].value, labels[labels.length - 1].value, plot.left, plot.right);
        ctx.textAlign = "center";
        ctx.fillText(item.label, x, plot.bottom + 24);
      });
    }
    if (options.yLabels) {
      options.yLabels.forEach((item) => {
        const y = scale(item.value, options.yLabels[0].value, options.yLabels[options.yLabels.length - 1].value, plot.bottom, plot.top);
        ctx.textAlign = "right";
        ctx.fillText(item.label, plot.left - 8, y + 4);
      });
    }
    ctx.restore();
  }

  function drawLine(ctx, values, plot, xScale, yScale, color) {
    if (values.length < 2) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    values.forEach((point, index) => {
      const x = scale(point.x, xScale.min, xScale.max, plot.left, plot.right);
      const y = scale(point.y, yScale.min, yScale.max, plot.bottom, plot.top);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.restore();
  }

  function drawRaceGrid(ctx, plot, xMax, splitMin, splitMax, spmMin, spmMax) {
    ctx.save();
    ctx.strokeStyle = COLORS.grid;
    ctx.fillStyle = COLORS.muted;
    ctx.lineWidth = 1;
    ctx.font = "10px ui-monospace, SFMono-Regular, Consolas, monospace";
    for (let index = 0; index <= 5; index += 1) {
      const y = plot.top + (plot.height / 5) * index;
      ctx.beginPath();
      ctx.moveTo(plot.left, y);
      ctx.lineTo(plot.right, y);
      ctx.stroke();

      const splitValue = splitMin + ((splitMax - splitMin) / 5) * index;
      ctx.textAlign = "right";
      ctx.fillStyle = COLORS.pace;
      ctx.fillText(formatSplitOnly(splitValue), plot.left - 8, y + 4);

      const spmValue = spmMax - ((spmMax - spmMin) / 5) * index;
      ctx.textAlign = "left";
      ctx.fillStyle = COLORS.rate;
      ctx.fillText(`${formatNumber(spmValue, 0)} spm`, plot.right + 8, y + 4);
    }
    const steps = distanceGridSteps(xMax);
    for (let distance = 0; distance <= xMax + 0.001; distance += steps.minor) {
      const x = scale(distance, 0, xMax, plot.left, plot.right);
      const isMajor = Math.round(distance) % steps.major === 0;
      ctx.strokeStyle = isMajor ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.035)";
      ctx.beginPath();
      ctx.moveTo(x, plot.top);
      ctx.lineTo(x, plot.bottom);
      ctx.stroke();
      if (isMajor) {
        ctx.fillStyle = COLORS.muted;
        ctx.textAlign = "center";
        ctx.fillText(`${Math.round(distance)}m`, x, plot.bottom + 24);
      }
    }
    ctx.fillStyle = COLORS.pace;
    ctx.textAlign = "left";
    ctx.fillText("Split /500m (brže gore)", plot.left, plot.top - 8);
    ctx.fillStyle = COLORS.rate;
    ctx.textAlign = "right";
    ctx.fillText("Tempo SPM", plot.right, plot.top - 8);
    ctx.restore();
  }

  function buildChartData(session) {
    if (!session) return { series: [], points: [], xMax: 100 };
    const intervals = session.intervals?.length ? session.intervals : buildIntervalData(session.points, []);
    const hasMultiple = intervals.length > 1;
    const maxIntervalDistance = maxFinite(intervals.map((interval) => interval.distance));
    const gap = hasMultiple ? Math.max(60, maxIntervalDistance * 0.08) : 0;
    let offset = 0;
    const series = intervals.map((interval) => {
      const points = interval.points
        .filter((point, index) => isUsableChartPoint(point, index, session.summary.avgPace))
        .map((point) => {
          const localDistance = Number.isFinite(point.localDistance) ? point.localDistance : point.distance;
          return {
            ...point,
            interval: interval.interval,
            intervalLabel: interval.label,
            localDistance,
            chartX: offset + localDistance,
          };
        });
      const distance = Number.isFinite(interval.distance)
        ? interval.distance
        : maxFinite(points.map((point) => point.localDistance));
      const result = {
        ...interval,
        chartStart: offset,
        chartEnd: offset + distance,
        chartGapEnd: offset + distance + gap,
        points,
      };
      offset += distance + gap;
      return result;
    });
    const xMax = hasMultiple
      ? Math.max(100, offset - gap)
      : niceDistanceMax(maxFinite(series[0]?.points.map((point) => point.localDistance) || [0]));
    return {
      series,
      points: series.flatMap((serie) => serie.points),
      xMax,
      gap,
      hasMultiple,
    };
  }

  function drawIntervalGuides(ctx, plot, chartData, meters) {
    ctx.save();
    ctx.font = "10px ui-monospace, SFMono-Regular, Consolas, monospace";
    ctx.textAlign = "center";
    chartData.series.forEach((serie, index) => {
      if (chartData.hasMultiple) {
        ctx.fillStyle = "rgba(255,255,255,0.34)";
        ctx.fillText(`I${serie.interval}`, (scale(serie.chartStart, 0, chartData.xMax, plot.left, plot.right) + scale(serie.chartEnd, 0, chartData.xMax, plot.left, plot.right)) / 2, plot.bottom + 13);
      }
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.setLineDash([5, 5]);
      if (index > 0) {
        const x = scale(serie.chartStart, 0, chartData.xMax, plot.left, plot.right);
        ctx.beginPath();
        ctx.moveTo(x, plot.top);
        ctx.lineTo(x, plot.bottom);
        ctx.stroke();
      }
      ctx.setLineDash([2, 4]);
      for (let distance = meters; distance < serie.distance; distance += meters) {
        const x = scale(serie.chartStart + distance, 0, chartData.xMax, plot.left, plot.right);
        ctx.beginPath();
        ctx.moveTo(x, plot.top);
        ctx.lineTo(x, plot.bottom);
        ctx.stroke();
      }
    });
    ctx.restore();
  }

  function niceDistanceMax(distance) {
    if (!Number.isFinite(distance) || distance <= 0) return 100;
    const step = distance <= 1000 ? 50 : distance <= 3000 ? 100 : distance <= 8000 ? 250 : 500;
    return Math.max(step, Math.ceil(distance / step) * step);
  }

  function distanceGridSteps(xMax) {
    if (xMax <= 1000) return { minor: 50, major: 100 };
    if (xMax <= 3000) return { minor: 100, major: 250 };
    if (xMax <= 8000) return { minor: 250, major: 500 };
    return { minor: 500, major: 1000 };
  }

  function drawLineCustom(ctx, values, plot, xScale, yScale, color, width = 2) {
    if (values.length < 2) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    values.forEach((point, index) => {
      const x = scale(point.x, xScale.min, xScale.max, plot.left, plot.right);
      const y = yScale.inverted
        ? scale(point.y, yScale.min, yScale.max, plot.top, plot.bottom)
        : scale(point.y, yScale.min, yScale.max, plot.bottom, plot.top);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.restore();
  }

  function drawAverageLine(ctx, plot, value, min, max, inverted, color, label, rightAlign = false) {
    if (!Number.isFinite(value)) return;
    const y = inverted
      ? scale(value, min, max, plot.top, plot.bottom)
      : scale(value, min, max, plot.bottom, plot.top);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4;
    ctx.setLineDash(rightAlign ? [4, 5] : [6, 4]);
    ctx.beginPath();
    ctx.moveTo(plot.left, y);
    ctx.lineTo(plot.right, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.font = "600 10px ui-monospace, SFMono-Regular, Consolas, monospace";
    ctx.textAlign = rightAlign ? "right" : "left";
    ctx.fillText(label, rightAlign ? plot.right - 6 : plot.left + 6, y - 5);
    ctx.restore();
  }

  function drawStrokeDots(ctx, canvas, points, plot, xMax, splitMin, splitMax, color = "rgba(59,125,255,0.88)") {
    const hits = [];
    ctx.save();
    points.forEach((point) => {
      const x = scale(Number.isFinite(point.chartX) ? point.chartX : point.distance, 0, xMax, plot.left, plot.right);
      const y = scale(point.pace, splitMin, splitMax, plot.top, plot.bottom);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, 2.7, 0, Math.PI * 2);
      ctx.fill();
      hits.push({ x, y, point });
    });
    ctx.restore();
    canvas._strokeHits = hits;
  }

  function drawIntervalSegmentGuides(ctx, plot, xMax, meters) {
    if (!meters || meters < 100) return;
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.fillStyle = "rgba(255,255,255,0.28)";
    ctx.font = "10px ui-monospace, SFMono-Regular, Consolas, monospace";
    ctx.textAlign = "center";
    ctx.setLineDash([3, 4]);
    for (let distance = meters; distance < xMax; distance += meters) {
      const x = scale(distance, 0, xMax, plot.left, plot.right);
      ctx.beginPath();
      ctx.moveTo(x, plot.top);
      ctx.lineTo(x, plot.bottom);
      ctx.stroke();
      ctx.fillText(`${distance}m`, x, plot.bottom + 13);
    }
    ctx.restore();
  }

  function drawIntervalChartBadge(ctx, canvas, interval, color) {
    const width = canvas.widthCss || canvas.width;
    ctx.save();
    ctx.fillStyle = "rgba(8,9,13,0.78)";
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    const label = `I${interval.interval}`;
    const x = width - 56;
    const y = 12;
    roundRect(ctx, x, y, 42, 24, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = "800 12px ui-monospace, SFMono-Regular, Consolas, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, x + 21, y + 12);
    ctx.restore();
  }

  function roundRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  function intervalColor(index) {
    return COLORS.intervals[index % COLORS.intervals.length];
  }

  function drawSegmentGuides(ctx, plot, xMax, meters) {
    if (!meters || meters < 100) return;
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.fillStyle = "rgba(255,255,255,0.24)";
    ctx.font = "10px ui-monospace, SFMono-Regular, Consolas, monospace";
    ctx.textAlign = "center";
    ctx.setLineDash([3, 3]);
    for (let distance = meters; distance < xMax; distance += meters) {
      const x = scale(distance, 0, xMax, plot.left, plot.right);
      ctx.beginPath();
      ctx.moveTo(x, plot.top);
      ctx.lineTo(x, plot.bottom);
      ctx.stroke();
      if (meters >= 250) ctx.fillText(`${distance}m`, x, plot.bottom + 13);
    }
    ctx.restore();
  }

  function drawEmptyChart(ctx, canvas, message) {
    const width = canvas.widthCss || canvas.width;
    const height = canvas.heightCss || canvas.height;
    ctx.save();
    ctx.fillStyle = COLORS.muted;
    ctx.font = "600 15px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(message, width / 2, height / 2);
    ctx.restore();
  }

  function drawPoint(ctx, x, y, color) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function makeAxisLabels(min, max, count, formatter) {
    const labels = [];
    const span = max - min || 1;
    for (let index = 0; index <= count; index += 1) {
      const value = min + (span / count) * index;
      labels.push({ value, label: formatter(value) });
    }
    return labels;
  }

  function smoothValues(values, radius) {
    return values.map((value, index) => {
      const slice = values
        .slice(Math.max(0, index - radius), index + radius + 1)
        .filter(Number.isFinite);
      return slice.length ? average(slice) : value;
    });
  }

  function getSelectedSession() {
    return state.sessions.find((session) => session.id === state.selectedId) || state.sessions[0] || null;
  }

  function sessionTitle(session) {
    const distance = Number.isFinite(session.summary.distance)
      ? `${Math.round(session.summary.distance)}m`
      : "trening";
    return session.title || `Analiza ${distance}`;
  }

  function sessionSubtitle(session) {
    return [
      formatDateLong(session.date),
      session.startTime,
      session.type,
    ]
      .filter(Boolean)
      .join(" · ");
  }

  function deviceLabel(session) {
    return [
      session.deviceModel || session.deviceName || "SpeedCoach CSV",
      session.deviceSerial ? `S/N: ${session.deviceSerial}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
  }

  function sessionStorageLabel(session) {
    if (session.publicEntry) return "javno";
    if (session.storedEntry) return "spremljeno lokalno";
    return "lokalno";
  }

  function phaseBadge(phase) {
    const className = {
      Start: "badge-start",
      "Finiš 1": "badge-finish",
      "Finiš 2": "badge-finish",
      "Najbrže": "badge-best",
      "Najsporije": "badge-worst",
    }[phase] || "";
    return `<span class="badge ${className}">${escapeHtml(phase)}</span>`;
  }

  function barCell(value, min, max, type, invert = false) {
    if (!Number.isFinite(value)) return "--";
    const range = max - min || 1;
    const ratio = invert ? (max - value) / range : (value - min) / range;
    const width = Math.round(8 + Math.max(0, Math.min(1, ratio)) * 76);
    const label = type === "split" ? formatSplitOnly(value) : formatNumber(value, 1);
    return `
      <div class="${type}-bar-wrap">
        <div class="${type}-bar" style="width:${width}px;opacity:${0.38 + Math.max(0, Math.min(1, ratio)) * 0.62};"></div>
        <span>${label}</span>
      </div>
    `;
  }

  function exportSummary() {
    const session = getSelectedSession();
    if (!session) return;
    const reportView = ensureReportView();
    reportView.innerHTML = `
      <div class="report-toolbar">
        <button type="button" id="printReportButton">Spremi kao PDF</button>
        <button type="button" id="closeReportButton">Zatvori</button>
      </div>
      <article class="report-page">${buildReportBody(session)}</article>
    `;
    reportView.hidden = false;
    document.body.classList.add("report-open");
    reportView.querySelector("#printReportButton").addEventListener("click", () => window.print());
    reportView.querySelector("#closeReportButton").addEventListener("click", closeReportView);
  }

  function ensureReportView() {
    let reportView = document.getElementById("reportView");
    if (!reportView) {
      reportView = document.createElement("section");
      reportView.id = "reportView";
      reportView.className = "report-view";
      reportView.hidden = true;
      document.body.append(reportView);
    }
    return reportView;
  }

  function closeReportView() {
    const reportView = document.getElementById("reportView");
    if (reportView) {
      reportView.hidden = true;
      reportView.innerHTML = "";
    }
    document.body.classList.remove("report-open");
  }

  function buildPdfReport(session) {
    return `<!doctype html>
      <html lang="hr">
      <head>
        <meta charset="utf-8" />
        <title>Sažetak treninga - ${escapeHtml(session.title)}</title>
        <style>${reportStyles()}</style>
      </head>
      <body>${buildReportBody(session)}</body>
      </html>`;
  }

  function buildReportBody(session) {
    const summary = session.summary;
    const intervals = session.intervals || [];
    const segments = makeStrokeSegments(session, state.segmentMeters);
    const chartImage = elements.sessionChart.toDataURL("image/png");
    return `
      <h1>${escapeHtml(session.title)}</h1>
      <div class="muted">${escapeHtml(formatDate(session.date))} · ${escapeHtml(session.startTime || "")} · ${escapeHtml(deviceLabel(session))}</div>
      <div class="report-grid">
        <div class="report-kpi"><span>Vrijeme</span><strong>${formatDurationTenths(summary.duration)}</strong></div>
        <div class="report-kpi"><span>Distanca</span><strong>${formatNumber(summary.distance, 1)} m</strong></div>
        <div class="report-kpi"><span>Avg split</span><strong>${formatSplitOnly(summary.avgPace)} /500</strong></div>
        <div class="report-kpi"><span>SPM</span><strong>${formatNumber(summary.rate, 1)}</strong></div>
        <div class="report-kpi"><span>Zaveslaji</span><strong>${formatNumber(summary.strokes, 0)}</strong></div>
        <div class="report-kpi"><span>m/zaveslaj</span><strong>${formatNumber(summary.distPerStroke, 1)}</strong></div>
      </div>
      <h2>Graf</h2>
      <img class="report-chart" src="${chartImage}" alt="Graf treninga" />
      ${intervals.length > 1 ? `<h2>Intervali</h2>${reportTable(intervals.map((interval) => [
        interval.label,
        formatMetersCompact(interval.distance),
        Number.isFinite(interval.gapFromPreviousMeters) ? formatMetersCompact(interval.gapFromPreviousMeters) : "--",
        formatDurationTenths(interval.duration),
        `${formatSplitOnly(interval.avgPace)} /500`,
        formatNumber(interval.rate, 1),
        formatNumber(interval.strokes, 0),
      ]), ["Interval", "Distanca", "Razmak prije", "Vrijeme", "Split", "SPM", "Zaveslaji"])}` : ""}
      <h2>Dionice ${state.segmentMeters} m</h2>
      ${reportTable(segments.map((segment) => [
        segment.intervalLabel || "",
        segment.label,
        segment.phase,
        segment.strokes,
        `${formatSplitOnly(segment.pace)} /500`,
        formatNumber(segment.rate, 1),
        formatDurationTenths(segment.duration),
      ]), ["Interval", "Dionica", "Faza", "Zaveslaji", "Split", "SPM", "Vrijeme"])}
    `;
  }

  function reportStyles() {
    return `
      body{font-family:Arial,sans-serif;color:#111827;margin:28px;font-size:12px}
      h1{font-size:24px;margin:0 0 4px}h2{font-size:15px;margin:22px 0 8px}
      .muted{color:#6b7280}.report-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:18px 0}
      .report-kpi{border:1px solid #d1d5db;border-radius:8px;padding:10px}.report-kpi span{display:block;color:#6b7280;font-size:10px;text-transform:uppercase}.report-kpi strong{font-size:20px}
      table{width:100%;border-collapse:collapse;margin-top:8px}th,td{border-bottom:1px solid #e5e7eb;padding:7px;text-align:right}th:first-child,td:first-child{text-align:left}th{background:#f3f4f6;color:#374151}
      .report-chart{width:100%;border:1px solid #d1d5db;border-radius:8px;margin-top:8px}
      @page{size:A4;margin:14mm}
    `;
  }

  function reportTable(rows, headers) {
    return `<table><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${rows
      .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`)
      .join("")}</tbody></table>`;
  }

  function parseNumber(value) {
    if (value === null || value === undefined) return NaN;
    let text = String(value).trim();
    if (!text || /^[-–—]+$/.test(text)) return NaN;
    text = text.replace(/\s/g, "");
    const hasComma = text.includes(",");
    const hasDot = text.includes(".");
    if (hasComma && hasDot) {
      text = text.lastIndexOf(",") > text.lastIndexOf(".")
        ? text.replace(/\./g, "").replace(",", ".")
        : text.replace(/,/g, "");
    } else if (hasComma) {
      text = text.replace(",", ".");
    }
    text = text.replace(/[^0-9.+-]/g, "");
    const number = Number(text);
    return Number.isFinite(number) ? number : NaN;
  }

  function parseTime(value) {
    if (value === null || value === undefined) return NaN;
    const text = String(value).trim();
    if (!text) return NaN;
    if (/^\d{1,2}:\d{2}(:\d{2})?([.,]\d+)?$/.test(text)) {
      const parts = text.replace(",", ".").split(":").map(Number);
      if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
      if (parts.length === 2) return parts[0] * 60 + parts[1];
    }
    if (/^\d{4}-\d{2}-\d{2}/.test(text) || /^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(text)) {
      const timestamp = Date.parse(text);
      return Number.isFinite(timestamp) ? timestamp / 1000 : NaN;
    }
    return parseNumber(text);
  }

  function parsePace(value) {
    const time = parseTime(value);
    if (!Number.isFinite(time)) return NaN;
    return time;
  }

  function parseSpeed(value, header) {
    const speed = parseNumber(value);
    if (!Number.isFinite(speed)) return NaN;
    const normalized = normalizeHeader(header);
    if (normalized.includes("km/h") || normalized.includes("kph")) return speed / 3.6;
    if (normalized.includes("mph")) return speed * 0.44704;
    return speed;
  }

  function inferDateFromRows(rows) {
    for (const row of rows) {
      for (const value of Object.values(row.source || {})) {
        const text = String(value || "").trim();
        if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
      }
    }
    return "";
  }

  function parseDate(value) {
    if (!value) return new Date(0);
    const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
    return Number.isFinite(date.getTime()) ? date : new Date(0);
  }

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function dateKeyFromValue(value) {
    return dateKeyLocal(parseDate(value));
  }

  function dateKeyLocal(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  function monthKey(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
  }

  function monthDateFromKey(value) {
    const [year, month] = String(value || "").split("-").map(Number);
    if (!Number.isFinite(year) || !Number.isFinite(month)) return startOfDay(new Date());
    return new Date(year, month - 1, 1);
  }

  function shiftMonthKey(value, delta) {
    const date = monthDateFromKey(value);
    return monthKey(new Date(date.getFullYear(), date.getMonth() + delta, 1));
  }

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function sortByDateDesc(a, b) {
    return parseDate(b.date) - parseDate(a.date) || String(b.id).localeCompare(String(a.id));
  }

  function dateInputValue(date) {
    return date.toISOString().slice(0, 10);
  }

  function average(values) {
    const clean = values.filter(Number.isFinite);
    return clean.length ? sum(clean) / clean.length : NaN;
  }

  function sum(values) {
    return values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
  }

  function minFinite(values) {
    const clean = values.filter(Number.isFinite);
    return clean.length ? Math.min(...clean) : NaN;
  }

  function maxFinite(values) {
    const clean = values.filter(Number.isFinite);
    return clean.length ? Math.max(...clean) : NaN;
  }

  function scale(value, min, max, outMin, outMax) {
    if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max) || max === min) {
      return (outMin + outMax) / 2;
    }
    return outMin + ((value - min) / (max - min)) * (outMax - outMin);
  }

  function gpsDistanceMeters(pointA, pointB) {
    if (
      !pointA ||
      !pointB ||
      !Number.isFinite(pointA.lat) ||
      !Number.isFinite(pointA.lon) ||
      !Number.isFinite(pointB.lat) ||
      !Number.isFinite(pointB.lon)
    ) {
      return NaN;
    }
    const radius = 6371000;
    const toRad = (value) => (value * Math.PI) / 180;
    const dLat = toRad(pointB.lat - pointA.lat);
    const dLon = toRad(pointB.lon - pointA.lon);
    const lat1 = toRad(pointA.lat);
    const lat2 = toRad(pointB.lat);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function formatKm(meters, digits = 1) {
    return formatNumber((Number(meters) || 0) / 1000, digits);
  }

  function formatMeters(meters) {
    if (meters >= 1000) return `${formatNumber(meters / 1000, 1)} km`;
    return `${Math.round(meters)} m`;
  }

  function formatMetersCompact(meters) {
    if (!Number.isFinite(meters)) return "--";
    return meters >= 1000 ? `${formatNumber(meters / 1000, 2)} km` : `${formatNumber(meters, 0)} m`;
  }

  function formatDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "--";
    const rounded = Math.round(seconds);
    const hours = Math.floor(rounded / 3600);
    const minutes = Math.floor((rounded % 3600) / 60);
    const secs = rounded % 60;
    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    }
    return `${minutes}:${String(secs).padStart(2, "0")}`;
  }

  function formatDurationTenths(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "--";
    const rounded = Math.round(seconds * 10) / 10;
    const minutes = Math.floor(rounded / 60);
    const secs = rounded - minutes * 60;
    return `${minutes}:${secs.toFixed(1).padStart(4, "0")}`;
  }

  function formatSplitOnly(seconds) {
    return formatDurationTenths(seconds);
  }

  function formatDurationShort(seconds) {
    if (!Number.isFinite(seconds)) return "--";
    const minutes = Math.round(seconds / 60);
    return `${minutes} min`;
  }

  function formatPace(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return "--";
    return `${formatSplitOnly(seconds)} /500`;
  }

  function formatNumber(value, digits = 1) {
    if (!Number.isFinite(value)) return "--";
    return value.toLocaleString("hr-HR", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }

  function formatTrainingCount(count) {
    return `${count} ${count === 1 ? "trening" : "treninga"}`;
  }

  function formatDate(value) {
    const date = parseDate(value);
    if (date.getTime() === 0) return "--";
    return date.toLocaleDateString("hr-HR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }

  function formatDateShort(value) {
    const date = parseDate(value);
    if (date.getTime() === 0) return "--";
    return date.toLocaleDateString("hr-HR", {
      month: "2-digit",
      day: "2-digit",
    });
  }

  function formatCalendarMonth(date) {
    return date.toLocaleDateString("hr-HR", {
      month: "long",
      year: "numeric",
    });
  }

  function formatDateLong(value) {
    const date = parseDate(value);
    if (date.getTime() === 0) return "";
    return date.toLocaleDateString("hr-HR", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }

  function roundOrNull(value, digits) {
    if (!Number.isFinite(value)) return null;
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
  }

  function hashString(value) {
    let hash = 2166136261;
    const text = String(value || "");
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function debounce(fn, wait) {
    let timer = null;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), wait);
    };
  }

  init();
})();
