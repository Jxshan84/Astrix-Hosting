import {
  checkDockerConnection,
  createServer,
  DOCKER_RUNTIMES,
  getLogs,
  getServer,
  getStats,
  removeServer,
  restartServer,
  startServer,
  stopServer,
} from "./dockerService.js";
import * as dockerFiles from "./dockerFileService.js";
import type { PlanLimits } from "./planService.js";

export type ProviderStatus = {
  provider: string;
  connected: boolean;
  version?: string;
  hostCpuCount?: number;
  hostMemoryBytes?: number;
  allocation?: string;
  error?: string;
};

export interface ServerProvider {
  readonly id: string;
  checkConnection(): Promise<ProviderStatus>;
  supportedRuntimes(): ReadonlyArray<{ id: string; name: string; image: string }>;
  create(id: string, type: string, limits: PlanLimits): ReturnType<typeof createServer>;
  status(id: string): ReturnType<typeof getServer>;
  stats(id: string): ReturnType<typeof getStats>;
  logs(id: string): ReturnType<typeof getLogs>;
  start(id: string): ReturnType<typeof startServer>;
  stop(id: string): ReturnType<typeof stopServer>;
  restart(id: string): ReturnType<typeof restartServer>;
  remove(id: string): ReturnType<typeof removeServer>;
  files: typeof dockerFiles;
}

class DockerEngineProvider implements ServerProvider {
  readonly id = "docker";
  readonly files = dockerFiles;

  async checkConnection(): Promise<ProviderStatus> {
    try {
      return await checkDockerConnection();
    } catch (error) {
      return {
        provider: this.id,
        connected: false,
        error: error instanceof Error ? error.message : "Docker Engine is unavailable.",
      };
    }
  }

  supportedRuntimes() {
    return DOCKER_RUNTIMES;
  }

  create(id: string, type: string, limits: PlanLimits) {
    return createServer(id, type, limits);
  }

  status(id: string) {
    return getServer(id);
  }

  stats(id: string) {
    return getStats(id);
  }

  logs(id: string) {
    return getLogs(id);
  }

  start(id: string) {
    return startServer(id);
  }

  stop(id: string) {
    return stopServer(id);
  }

  restart(id: string) {
    return restartServer(id);
  }

  remove(id: string) {
    return removeServer(id);
  }
}

export const serverProvider: ServerProvider = new DockerEngineProvider();
