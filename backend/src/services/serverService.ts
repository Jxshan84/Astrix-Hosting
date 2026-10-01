import { execFile } from "node:child_process";

function docker(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("docker", args, { timeout: 15000 }, (error, stdout, stderr) => {
      if (error) return reject(new Error(stderr || error.message));
      resolve(stdout.trim());
    });
  });
}

export async function createServer(name: string, image = "node:22-alpine") {
  const safeName = `astrix-${name.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`;

  await docker([
    "run",
    "-d",
    "--name",
    safeName,
    image,
    "sh",
    "-c",
    "while true; do sleep 3600; done"
  ]);

  return {
    id: safeName,
    name,
    image,
    status: "running"
  };
}

export async function serverAction(
  id: string,
  action: "start" | "stop" | "restart"
) {
  await docker([action, id]);
  return { id, action, success: true };
}

export async function serverInfo(id: string) {
  const output = await docker([
    "inspect",
    "--format",
    "{{.Name}}|{{.Config.Image}}|{{.State.Status}}|{{.State.Running}}",
    id
  ]);

  const [name, image, status, running] = output.replace(/^\//, "").split("|");

  return { id: name, image, status, running: running === "true" };
}

export async function serverLogs(id: string) {
  return docker(["logs", "--tail", "200", id]);
}

export async function deleteServer(id: string) {
  await docker(["rm", "-f", id]);
  return { id, deleted: true };
}
