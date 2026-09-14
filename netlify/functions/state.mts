import type { Config, Context } from "@netlify/functions";
import { getDeployStore, getStore } from "@netlify/blobs";

type Preference = "da-vedere" | "da-valutare" | "ignorare";

type HouseState = {
  preference?: Preference;
  seenAt?: string;
  updatedAt: string;
};

function stateStore() {
  if (Netlify.context?.deploy.context === "production") {
    return getStore("house-state", { consistency: "strong" });
  }
  return getDeployStore("house-state");
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export default async (req: Request, _context: Context) => {
  const store = stateStore();

  if (req.method === "GET") {
    const { blobs } = await store.list();
    const states: Record<string, HouseState> = {};

    await Promise.all(
      blobs.map(async ({ key }) => {
        const value = await store.get(key, { type: "json" });
        if (value && typeof value === "object" && !Array.isArray(value)) {
          states[key] = value as HouseState;
        }
      }),
    );

    return json(states);
  }

  if (req.method === "POST") {
    let body: { homeId?: string; preference?: string; seen?: boolean };
    try {
      body = await req.json();
    } catch {
      return json({ error: "Richiesta non valida" }, 400);
    }

    const homeId = (body.homeId || "").trim();
    if (!/^[a-z0-9-]{1,80}$/.test(homeId)) {
      return json({ error: "Immobile non valido" }, 400);
    }

    if (
      body.preference !== undefined &&
      body.preference !== "da-vedere" &&
      body.preference !== "da-valutare" &&
      body.preference !== "ignorare"
    ) {
      return json({ error: "Valutazione non valida" }, 400);
    }

    const currentRaw = await store.get(homeId, { type: "json" });
    const current: HouseState =
      currentRaw && typeof currentRaw === "object" && !Array.isArray(currentRaw)
        ? (currentRaw as HouseState)
        : { updatedAt: new Date(0).toISOString() };

    const now = new Date().toISOString();
    const next: HouseState = {
      ...current,
      updatedAt: now,
    };

    if (body.preference !== undefined) {
      next.preference = body.preference as Preference;
    }
    if (body.seen === true && !next.seenAt) {
      next.seenAt = now;
    }

    await store.setJSON(homeId, next);
    return json(next);
  }

  return json({ error: "Metodo non consentito" }, 405);
};

export const config: Config = {
  path: "/api/state",
};
