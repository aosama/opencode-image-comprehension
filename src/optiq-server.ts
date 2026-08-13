import { spawn, type ChildProcess } from "node:child_process";
import { Socket } from "node:net";
import { OPTIQ_SERVER_STARTUP_TIMEOUT_SECONDS } from "./constants.js";
import type { Logger, OptiqServerConfig } from "./types.js";

interface OptiqProcessLauncher {
  launch: (command: string, argumentsList: string[]) => ChildProcess;
}

const defaultProcessLauncher: OptiqProcessLauncher = {
  // Use argv-based spawning instead of a shell so model paths and host values
  // cannot become shell commands when they come from configuration.
  launch: (command, argumentsList) =>
    spawn(command, argumentsList, { stdio: ["ignore", "pipe", "pipe"] }),
};

function formatRunnerOutput(outputChunk: Buffer): string | undefined {
  // Runner streams can emit large multi-line diagnostics. Keep enough context
  // to diagnose startup failures without flooding OpenCode's persistent log.
  const trimmedOutput = outputChunk.toString().trim();
  if (trimmedOutput === "") return undefined;
  return trimmedOutput.slice(0, 2000);
}

export class OptiqServerLifecycle {
  private readonly serverConfig: OptiqServerConfig;
  private readonly log: Logger;
  private readonly processLauncher: OptiqProcessLauncher;
  private childProcess: ChildProcess | undefined;
  private startupPromise: Promise<void> | undefined;
  private idleShutdownTimer: NodeJS.Timeout | undefined;
  private shutdownPromise: Promise<void> | undefined;
  private activeJobCount = 0;

  public constructor(
    serverConfig: OptiqServerConfig,
    log: Logger = () => undefined,
    processLauncher: OptiqProcessLauncher = defaultProcessLauncher,
  ) {
    this.serverConfig = serverConfig;
    this.log = log;
    this.processLauncher = processLauncher;
  }

  public async run<T>(job: () => Promise<T>): Promise<T> {
    if (!this.serverConfig.managed) return job();

    await this.ensureServerStarted();
    this.activeJobCount += 1;
    this.clearIdleShutdownTimer();
    try {
      return await job();
    } finally {
      this.activeJobCount -= 1;
      this.scheduleIdleShutdown();
    }
  }

  public async shutdown(): Promise<void> {
    this.clearIdleShutdownTimer();
    if (this.shutdownPromise) return this.shutdownPromise;
    const runningProcess = this.childProcess;
    if (!runningProcess) return;

    this.childProcess = undefined;
    this.startupPromise = undefined;
    this.shutdownPromise = this.terminateProcess(runningProcess).finally(() => {
      this.shutdownPromise = undefined;
    });
    await this.shutdownPromise;
  }

  private async ensureServerStarted(): Promise<void> {
    if (this.shutdownPromise) await this.shutdownPromise;
    // A child exists before its HTTP listener is ready. Concurrent jobs must
    // share and await the startup promise instead of treating that child as a
    // ready server and issuing requests too early.
    if (this.startupPromise) return this.startupPromise;
    if (this.childProcess && !this.childProcess.killed) return;

    this.startupPromise = this.startServerAndWaitUntilReady()
      .catch(async (startupError) => {
        // A failed spawn or readiness check must not leave a partially started
        // child behind. Only this lifecycle's recorded child is terminated.
        await this.shutdown();
        throw startupError;
      })
      .finally(() => {
        this.startupPromise = undefined;
      });
    return this.startupPromise;
  }

  private async startServerAndWaitUntilReady(): Promise<void> {
    const { command, modelPath, host, port } = this.serverConfig;
    const readinessUrl = `http://${host}:${port}/v1/models`;
    if (await this.isPortOpen(host, port)) {
      // A responding endpoint predates this lifecycle and therefore is not ours
      // to terminate. Refuse managed mode rather than sending work to it and
      // later claiming that the managed child was safely unloaded.
      throw new Error(
        `Managed OptiQ endpoint is already in use: ${readinessUrl}. Disable managed mode or configure another port.`,
      );
    }

    const runningProcess = this.processLauncher.launch(command, [
      "serve",
      "--model",
      modelPath,
      "--host",
      host,
      "--port",
      String(port),
    ]);
    this.childProcess = runningProcess;
    runningProcess.stdout?.on("data", (outputChunk: Buffer) => {
      const runnerOutput = formatRunnerOutput(outputChunk);
      if (runnerOutput) this.log(`Managed OptiQ stdout: ${runnerOutput}`);
    });
    runningProcess.stderr?.on("data", (errorChunk: Buffer) => {
      const runnerError = formatRunnerOutput(errorChunk);
      if (runnerError) this.log(`Managed OptiQ stderr: ${runnerError}`);
    });
    let processStartupError: Error | undefined;
    runningProcess.once("exit", (exitCode, signalName) => {
      if (this.childProcess === runningProcess) this.childProcess = undefined;
      this.log(
        `Managed OptiQ server exited (code=${exitCode ?? "none"}, signal=${signalName ?? "none"})`,
      );
    });
    runningProcess.once("error", (error) => {
      processStartupError = error;
      this.log(`Managed OptiQ server process error: ${error.message}`);
    });

    const readinessDeadline =
      Date.now() + OPTIQ_SERVER_STARTUP_TIMEOUT_SECONDS * 1000;
    while (Date.now() < readinessDeadline) {
      if (processStartupError) throw processStartupError;
      if (
        runningProcess.exitCode !== null ||
        runningProcess.signalCode !== null
      ) {
        throw new Error("Managed OptiQ server exited before becoming ready");
      }
      if (await this.isEndpointResponding(readinessUrl)) {
        this.log(`Managed OptiQ server is ready at ${readinessUrl}`);
        return;
      }
      // The server normally needs several polling attempts while Python and
      // the HTTP listener initialize. Continue until the bounded deadline.
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    await this.shutdown();
    throw new Error(
      `Managed OptiQ server did not become ready: ${readinessUrl}`,
    );
  }

  private async isEndpointResponding(endpointUrl: string): Promise<boolean> {
    try {
      const endpointResponse = await fetch(endpointUrl, {
        signal: AbortSignal.timeout(1000),
      });
      // Any HTTP response proves that a listener owns the endpoint. Readiness
      // does not require a successful body because authentication may be on.
      return endpointResponse.status > 0;
    } catch {
      return false;
    }
  }

  private async isPortOpen(host: string, port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new Socket();
      const finishProbe = (isOpen: boolean) => {
        socket.destroy();
        resolve(isOpen);
      };
      // A direct TCP probe deliberately bypasses HTTP proxy environment
      // variables. Managed ownership depends on the configured local socket,
      // not on whether a proxy can synthesize an HTTP response for its URL.
      socket.setTimeout(1000);
      socket.once("connect", () => finishProbe(true));
      socket.once("timeout", () => finishProbe(false));
      socket.once("error", () => finishProbe(false));
      socket.connect(port, host);
    });
  }

  private scheduleIdleShutdown(): void {
    if (this.activeJobCount !== 0 || !this.childProcess) return;
    this.clearIdleShutdownTimer();
    this.idleShutdownTimer = setTimeout(() => {
      void this.shutdown().catch((error) => {
        this.log(`Managed OptiQ shutdown failed: ${String(error)}`);
      });
    }, this.serverConfig.idleTimeoutSeconds * 1000);
    this.idleShutdownTimer.unref();
  }

  private clearIdleShutdownTimer(): void {
    if (!this.idleShutdownTimer) return;
    clearTimeout(this.idleShutdownTimer);
    this.idleShutdownTimer = undefined;
  }

  private async terminateProcess(runningProcess: ChildProcess): Promise<void> {
    if (runningProcess.exitCode !== null || runningProcess.signalCode !== null)
      return;

    const exitedGracefully = await new Promise<boolean>((resolve) => {
      const shutdownDeadline = setTimeout(() => resolve(false), 5000);
      runningProcess.once("exit", () => {
        clearTimeout(shutdownDeadline);
        resolve(true);
      });
      // SIGTERM gives OptiQ a chance to release MLX buffers and unload its model.
      if (!runningProcess.kill("SIGTERM")) {
        clearTimeout(shutdownDeadline);
        resolve(true);
      }
    });
    if (exitedGracefully) return;

    // A broken or wedged runner must not keep the OpenCode process alive forever.
    // This is a last resort after the graceful shutdown window has elapsed.
    if (!runningProcess.kill("SIGKILL")) return;
    await new Promise<void>((resolve) => {
      if (
        runningProcess.exitCode !== null ||
        runningProcess.signalCode !== null
      ) {
        resolve();
        return;
      }
      runningProcess.once("exit", () => resolve());
    });
  }
}
