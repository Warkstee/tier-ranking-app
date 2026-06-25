/**
 * Config API Server
 *
 * A minimal Node.js HTTP server that exposes a single POST /api/config
 * endpoint for persisting the tier ranking board's YAML configuration to
 * disk. Writes are performed directly to the mounted config.yml file,
 * which is shared with the nginx container via a Docker bind mount.
 *
 */
import { createServer } from "http";
import { writeFile } from "fs/promises";

const PORT = 3001;
const CONFIG_PATH = "/app/config.yml";

const server = createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/api/config") {
    try {
      const body = await readBody(req);

      if (!body.trim()) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Empty body" }));
        return;
      }

      // Write file
      await writeFile(CONFIG_PATH, body, "utf8");

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      console.error("Failed to write config:", err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Failed to write config" }));
    }
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

server.listen(PORT, () => {
  console.log(`API server listening on port ${PORT}`);
});