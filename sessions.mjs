import { getStore } from "@netlify/blobs";

const STORE_NAME = "speedcoach-sessions";
const INDEX_KEY = "index.json";
const MAX_CSV_BYTES = 1024 * 1024 * 2;

export default async (request) => {
  if (request.method === "OPTIONS") {
    return jsonResponse({ ok: true });
  }

  if (request.method === "GET") {
    return listSessions();
  }

  if (request.method === "POST") {
    const payload = await request.json().catch(() => null);
    if (payload?.action === "delete") {
      return deleteSession(request, payload);
    }
    return saveSession(request, payload);
  }

  if (request.method === "DELETE") {
    return deleteSession(request);
  }

  return jsonResponse({ error: "Method not allowed" }, 405);
};

async function listSessions() {
  const store = getStore(STORE_NAME);
  const index = await readIndex(store);
  const sessions = [];

  for (const item of index.sessions) {
    const csvText = await store.get(csvKey(item.id), { consistency: "strong", type: "text" });
    if (!csvText) continue;
    sessions.push({
      id: item.id,
      meta: item.meta,
      csvText,
      savedAt: item.savedAt,
    });
  }

  return jsonResponse({ sessions, deletedIds: index.deletedIds });
}

async function saveSession(request, payload = null) {
  const expectedKey = process.env.UPLOAD_KEY;
  if (!expectedKey) {
    return jsonResponse({ error: "UPLOAD_KEY is not configured" }, 500);
  }

  const providedKey = request.headers.get("x-upload-key") || "";
  if (providedKey !== expectedKey) {
    return jsonResponse({ error: "Upload key is missing or invalid" }, 401);
  }

  if (!payload || typeof payload.csvText !== "string" || typeof payload.id !== "string") {
    return jsonResponse({ error: "Invalid session payload" }, 400);
  }

  const byteLength = new TextEncoder().encode(payload.csvText).byteLength;
  if (byteLength > MAX_CSV_BYTES) {
    return jsonResponse({ error: "CSV file is too large" }, 413);
  }

  const id = safeId(payload.id);
  if (!id) {
    return jsonResponse({ error: "Invalid session id" }, 400);
  }

  const meta = sanitizeMeta(payload.meta || {});
  const savedAt = new Date().toISOString();
  const store = getStore(STORE_NAME);
  const index = await readIndex(store);
  const nextItem = {
    id,
    meta: {
      ...meta,
      id,
      publicEntry: true,
      storedEntry: false,
      source: meta.source || `${id}.csv`,
    },
    savedAt,
  };
  const sessions = [nextItem, ...index.sessions.filter((item) => item.id !== id)];
  const deletedIds = index.deletedIds.filter((deletedId) => deletedId !== id);

  await store.set(csvKey(id), payload.csvText, {
    metadata: {
      title: nextItem.meta.title || "",
      date: nextItem.meta.date || "",
      savedAt,
    },
  });
  await store.setJSON(INDEX_KEY, { sessions, deletedIds });

  return jsonResponse({ ok: true, session: nextItem });
}

async function deleteSession(request, payload = null) {
  const expectedKey = process.env.UPLOAD_KEY;
  if (!expectedKey) {
    return jsonResponse({ error: "UPLOAD_KEY is not configured" }, 500);
  }

  const providedKey = request.headers.get("x-upload-key") || "";
  if (providedKey !== expectedKey) {
    return jsonResponse({ error: "Upload key is missing or invalid" }, 401);
  }

  const url = new URL(request.url);
  let id = safeId(url.searchParams.get("id"));
  if (!id) {
    const body = payload || (await request.json().catch(() => null));
    id = safeId(body?.id);
  }
  if (!id) {
    return jsonResponse({ error: "Invalid session id" }, 400);
  }

  const store = getStore(STORE_NAME);
  const index = await readIndex(store);
  const sessions = index.sessions.filter((item) => item.id !== id);
  const deletedIds = [id, ...index.deletedIds.filter((deletedId) => deletedId !== id)].slice(0, 500);

  await store.delete(csvKey(id)).catch(() => null);
  await store.setJSON(INDEX_KEY, { sessions, deletedIds });

  return jsonResponse({ ok: true, id, deleted: sessions.length !== index.sessions.length });
}

async function readIndex(store) {
  const index = await store.get(INDEX_KEY, { consistency: "strong", type: "json" }).catch(() => null);
  if (!index || !Array.isArray(index.sessions)) return { sessions: [], deletedIds: [] };
  return {
    sessions: index.sessions
      .filter((item) => item && typeof item.id === "string")
      .map((item) => ({
        id: safeId(item.id),
        meta: sanitizeMeta(item.meta || {}),
        savedAt: typeof item.savedAt === "string" ? item.savedAt : "",
      }))
      .filter((item) => item.id),
    deletedIds: Array.isArray(index.deletedIds)
      ? index.deletedIds.map(safeId).filter(Boolean).slice(0, 500)
      : [],
  };
}

function csvKey(id) {
  return `csv/${id}.csv`;
}

function safeId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

function sanitizeMeta(meta) {
  const clean = {};
  [
    "id",
    "title",
    "date",
    "startTime",
    "type",
    "source",
    "boat",
    "location",
    "notes",
    "uploadedAt",
  ].forEach((key) => {
    if (meta[key] !== undefined && meta[key] !== null) {
      clean[key] = String(meta[key]).slice(0, 500);
    }
  });
  return clean;
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
