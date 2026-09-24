import { runFixtureScenario } from "./core.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (
      request.method === "GET" &&
      (url.pathname === "/" || url.pathname === "/health")
    ) {
      return json({
        status: "ok",
        service: "matrix24-publisher-staging",
        mode: env.MATRIX24_MODE || "staging-fixtures-only",
        external_side_effects: false,
        cron_enabled: false
      });
    }

    if (request.method !== "POST" || url.pathname !== "/fixture/process") {
      return json({ error: "Not found" }, 404);
    }

    try {
      const payload = await request.json();
      return json({ success: true, result: runFixtureScenario(payload) });
    } catch (error) {
      return json(
        {
          success: false,
          error: error?.code || error?.message || "STAGING_FIXTURE_FAILED"
        },
        400
      );
    }
  }
};
