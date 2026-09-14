import type { Config, Context } from "@netlify/functions";
import { getDeployStore, getStore } from "@netlify/blobs";

type HouseNote = {
  id: string;
  author: "Bogdan" | "Camilla";
  text: string;
  createdAt: string;
};

function notesStore() {
  if (Netlify.context?.deploy.context === "production") {
    return getStore("house-notes", { consistency: "strong" });
  }
  return getDeployStore("house-notes");
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export default async (req: Request, _context: Context) => {
  const store = notesStore();

  if (req.method === "GET") {
    const { blobs } = await store.list();
    const notesByHome: Record<string, HouseNote[]> = {};

    await Promise.all(
      blobs.map(async ({ key }) => {
        const value = await store.get(key, { type: "json" });
        notesByHome[key] = Array.isArray(value) ? value : [];
      }),
    );

    return json(notesByHome);
  }

  if (req.method === "POST") {
    let body: { homeId?: string; author?: string; text?: string };
    try {
      body = await req.json();
    } catch {
      return json({ error: "Richiesta non valida" }, 400);
    }

    const homeId = (body.homeId || "").trim();
    const author = (body.author || "").trim();
    const text = (body.text || "").trim();

    if (!/^[a-z0-9-]{1,80}$/.test(homeId)) {
      return json({ error: "Immobile non valido" }, 400);
    }
    if (author !== "Bogdan" && author !== "Camilla") {
      return json({ error: "Autore non valido" }, 400);
    }
    if (!text || text.length > 1000) {
      return json({ error: "La nota deve contenere da 1 a 1000 caratteri" }, 400);
    }

    const current = await store.get(homeId, { type: "json" });
    const notes: HouseNote[] = Array.isArray(current) ? current : [];
    const note: HouseNote = {
      id: crypto.randomUUID(),
      author,
      text,
      createdAt: new Date().toISOString(),
    };

    notes.push(note);
    await store.setJSON(homeId, notes.slice(-100));

    return json(note, 201);
  }

  return json({ error: "Metodo non consentito" }, 405);
};

export const config: Config = {
  path: "/api/notes",
};
