import http from "node:http";

const DOCKER_SOCKET = "/var/run/docker.sock";

type Container = {
  Id: string;
  Labels: Record<string, string>;
  State: string;
  Names: string[];
};

function dockerRequest<T>(method: string, path: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { socketPath: DOCKER_SOCKET, path, method, headers: { "Content-Type": "application/json" } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString();
          try { resolve(JSON.parse(text) as T); }
          catch { resolve(text as unknown as T); }
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

export async function findComposeContainer(service: string): Promise<Container | null> {
  const filters = encodeURIComponent(JSON.stringify({ label: [`com.docker.compose.service=${service}`] }));
  const containers = await dockerRequest<Container[]>("GET", `/containers/json?filters=${filters}`);
  if (!Array.isArray(containers) || containers.length === 0) return null;
  const projectName = process.env.COMPOSE_PROJECT_NAME ?? "";
  if (projectName) {
    const match = containers.find(c => c.Labels["com.docker.compose.project"] === projectName);
    if (match) return match;
  }
  return containers[0] ?? null;
}

export async function restartContainer(containerId: string): Promise<void> {
  await dockerRequest<unknown>("POST", `/containers/${containerId}/restart?t=5`);
}
