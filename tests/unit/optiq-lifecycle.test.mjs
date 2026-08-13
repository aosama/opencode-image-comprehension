import assert from "node:assert/strict";
import { createServer } from "node:net";
import { setTimeout as wait } from "node:timers/promises";
import { test } from "node:test";

import { OptiqServerLifecycle } from "../../dist/optiq-server.js";

function createFakeOptiqProcess() {
  const exitListeners = [];
  return {
    exitCode: null,
    signalCode: null,
    killed: false,
    once(eventName, listener) {
      if (eventName === "exit") exitListeners.push(listener);
    },
    kill(signalName) {
      this.killed = true;
      this.signalCode = signalName;
      this.exitCode = 0;
      for (const exitListener of exitListeners) exitListener(0, signalName);
      return true;
    },
  };
}

function createDelayedExitOptiqProcess() {
  const exitListeners = [];
  return {
    exitCode: null,
    signalCode: null,
    killed: false,
    once(eventName, listener) {
      if (eventName === "exit") exitListeners.push(listener);
    },
    kill(signalName) {
      this.killed = true;
      this.signalCode = signalName;
      setTimeout(() => {
        this.exitCode = 0;
        for (const exitListener of exitListeners) exitListener(0, signalName);
      }, 20);
      return true;
    },
  };
}

function installReadinessFetch() {
  let requestCount = 0;
  globalThis.fetch = async () => {
    requestCount += 1;
    if (requestCount % 2 === 1)
      throw new TypeError("endpoint is not listening");
    return new Response("{}", { status: 200 });
  };
}

async function reserveAvailablePort() {
  const portReservation = createServer();
  await new Promise((resolve) =>
    portReservation.listen(0, "127.0.0.1", resolve),
  );
  const reservedAddress = portReservation.address();
  assert.ok(reservedAddress && typeof reservedAddress !== "string");
  await new Promise((resolve, reject) =>
    portReservation.close((error) => (error ? reject(error) : resolve())),
  );
  return reservedAddress.port;
}

test("managed OptiQ starts once, runs the job, and gracefully stops after idle timeout", async () => {
  const originalFetch = globalThis.fetch;
  const fakeOptiqProcess = createFakeOptiqProcess();
  const launchCalls = [];
  const availablePort = await reserveAvailablePort();
  installReadinessFetch();

  try {
    const lifecycle = new OptiqServerLifecycle(
      {
        managed: true,
        command: "optiq",
        modelPath: "Ornith-1.0-9B-OptiQ-4bit",
        host: "127.0.0.1",
        port: availablePort,
        idleTimeoutSeconds: 1,
      },
      () => undefined,
      {
        launch(command, argumentsList) {
          launchCalls.push({ command, argumentsList });
          return fakeOptiqProcess;
        },
      },
    );

    const output = await lifecycle.run(async () => "image description");
    assert.equal(output, "image description");
    assert.deepEqual(launchCalls, [
      {
        command: "optiq",
        argumentsList: [
          "serve",
          "--model",
          "Ornith-1.0-9B-OptiQ-4bit",
          "--host",
          "127.0.0.1",
          "--port",
          String(availablePort),
        ],
      },
    ]);

    await wait(1100);
    assert.equal(fakeOptiqProcess.signalCode, "SIGTERM");
    assert.equal(fakeOptiqProcess.exitCode, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("externally managed OptiQ never launches or terminates a process", async () => {
  let launchAttempted = false;
  const lifecycle = new OptiqServerLifecycle(
    {
      managed: false,
      command: "optiq",
      modelPath: "Ornith-1.0-9B-OptiQ-4bit",
      host: "127.0.0.1",
      port: 8080,
      idleTimeoutSeconds: 10,
    },
    () => undefined,
    {
      launch() {
        launchAttempted = true;
        throw new Error("external process must not be launched");
      },
    },
  );

  assert.equal(
    await lifecycle.run(async () => "external description"),
    "external description",
  );
  await lifecycle.shutdown();
  assert.equal(launchAttempted, false);
});

test("a new job waits for idle shutdown before starting a replacement runner", async () => {
  const originalFetch = globalThis.fetch;
  const fakeProcesses = [];
  const launchCalls = [];
  const availablePort = await reserveAvailablePort();
  installReadinessFetch();

  try {
    const lifecycle = new OptiqServerLifecycle(
      {
        managed: true,
        command: "optiq",
        modelPath: "Ornith-1.0-9B-OptiQ-4bit",
        host: "127.0.0.1",
        port: availablePort,
        idleTimeoutSeconds: 1,
      },
      () => undefined,
      {
        launch(command) {
          const fakeProcess = createDelayedExitOptiqProcess();
          fakeProcesses.push(fakeProcess);
          launchCalls.push(command);
          return fakeProcess;
        },
      },
    );

    await lifecycle.run(async () => "first description");
    await lifecycle.shutdown();
    const secondOutput = await lifecycle.run(async () => "second description");

    assert.equal(secondOutput, "second description");
    assert.deepEqual(launchCalls, ["optiq", "optiq"]);
    assert.equal(fakeProcesses[0].signalCode, "SIGTERM");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("managed OptiQ refuses to claim an endpoint that is already occupied", async () => {
  const originalFetch = globalThis.fetch;
  let launchAttempted = false;
  const occupiedServer = createServer();
  await new Promise((resolve) =>
    occupiedServer.listen(0, "127.0.0.1", resolve),
  );
  const occupiedAddress = occupiedServer.address();
  assert.ok(occupiedAddress && typeof occupiedAddress !== "string");

  try {
    const lifecycle = new OptiqServerLifecycle(
      {
        managed: true,
        command: "optiq",
        modelPath: "Ornith-1.0-9B-OptiQ-4bit",
        host: "127.0.0.1",
        port: occupiedAddress.port,
        idleTimeoutSeconds: 10,
      },
      () => undefined,
      {
        launch() {
          launchAttempted = true;
          return createFakeOptiqProcess();
        },
      },
    );

    await assert.rejects(
      lifecycle.run(async () => "must not run"),
      /endpoint is already in use/,
    );
    assert.equal(launchAttempted, false);
  } finally {
    await new Promise((resolve, reject) =>
      occupiedServer.close((error) => (error ? reject(error) : resolve())),
    );
    globalThis.fetch = originalFetch;
  }
});

test("concurrent jobs share startup and both wait until the server is ready", async () => {
  const originalFetch = globalThis.fetch;
  const fakeOptiqProcess = createFakeOptiqProcess();
  const availablePort = await reserveAvailablePort();
  let allowReadinessResponse;
  const readinessGate = new Promise((resolve) => {
    allowReadinessResponse = resolve;
  });
  let readinessRequestCount = 0;
  let launchCount = 0;
  globalThis.fetch = async () => {
    readinessRequestCount += 1;
    if (readinessRequestCount === 1)
      throw new TypeError("endpoint is not listening");
    await readinessGate;
    return new Response("{}", { status: 200 });
  };

  try {
    const lifecycle = new OptiqServerLifecycle(
      {
        managed: true,
        command: "optiq",
        modelPath: "Ornith-1.0-9B-OptiQ-4bit",
        host: "127.0.0.1",
        port: availablePort,
        idleTimeoutSeconds: 10,
      },
      () => undefined,
      {
        launch() {
          launchCount += 1;
          return fakeOptiqProcess;
        },
      },
    );
    const completedJobs = [];
    const firstJob = lifecycle.run(async () => completedJobs.push("first"));
    const secondJob = lifecycle.run(async () => completedJobs.push("second"));

    await wait(20);
    assert.deepEqual(completedJobs, []);
    assert.equal(launchCount, 1);

    allowReadinessResponse();
    await Promise.all([firstJob, secondJob]);
    assert.deepEqual(completedJobs.sort(), ["first", "second"]);
    assert.equal(launchCount, 1);
    await lifecycle.shutdown();
  } finally {
    globalThis.fetch = originalFetch;
  }
});
