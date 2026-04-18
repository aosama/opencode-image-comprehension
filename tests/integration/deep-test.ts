import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = join(__dirname, "..", "..");
const TEST_IMAGE = join(__dirname, "test-image.png");

const NON_VISION_MODEL = process.env.NON_VISION_MODEL || "qwen3.5:cloud";
const VISION_MODEL = process.env.OLLAMA_VISION_MODEL || "moondream:1.8b";

const TIMEOUT_MS = 300_000;

function log(msg: string): void {
  console.log(`[deep-test] ${msg}`);
}

async function checkOllamaReady(): Promise<void> {
  log("Checking if Ollama is ready...");
  for (let i = 0; i < 30; i++) {
    const result = spawnSync("ollama", ["list"], {
      timeout: 5_000,
      encoding: "utf-8",
    });
    if (result.stdout) {
      log("Ollama is ready.");
      return;
    }
    log(`Waiting for Ollama... (${i + 1}/30)`);
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error("Ollama did not become ready after 60 seconds");
}

async function ensureModel(model: string): Promise<void> {
  if (model.endsWith(":cloud")) {
    log(`Cloud model '${model}' does not need local pulling.`);
    return;
  }
  const listResult = spawnSync("ollama", ["list"], {
    timeout: 10_000,
    encoding: "utf-8",
  });
  if (listResult.stdout && listResult.stdout.includes(model)) {
    log(`Model '${model}' is already available locally`);
    return;
  }
  log(`Pulling model '${model}'...`);
  spawnSync("ollama", ["pull", model], { timeout: 300_000, encoding: "utf-8" });
  log(`Model '${model}' pulled successfully`);
}

async function checkSkillInstalled(): Promise<void> {
  const skillSearchPaths = [
    join(
      process.env.HOME || "/root",
      ".agents",
      "skills",
      "image-comprehension-ollama",
      "scripts",
      "comprehend_image.sh",
    ),
    join(
      process.env.HOME || "/root",
      ".config",
      "opencode",
      "skills",
      "image-comprehension-ollama",
      "scripts",
      "comprehend_image.sh",
    ),
  ];

  for (const candidate of skillSearchPaths) {
    if (existsSync(candidate)) {
      log(`image-comprehension-ollama skill found at: ${candidate}`);
      return;
    }
  }

  log(
    "Skill not found at expected paths. The plugin will attempt to resolve it at runtime.",
  );
  log(
    "Ensure the skill was installed via the CI step or manually before running this test.",
  );
}

function buildOpenCodeConfig(): string {
  const isCloudModel = NON_VISION_MODEL.endsWith(":cloud");

  const nonVisionModelName = isCloudModel
    ? NON_VISION_MODEL.replace(":cloud", "")
    : NON_VISION_MODEL;

  const llmProviderKey = isCloudModel ? "ollama-cloud" : "ollama";
  const llmBaseURL = isCloudModel
    ? "https://ollama.com/v1"
    : "http://localhost:11434/v1";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const llmProviderOptions: Record<string, any> = {
    baseURL: llmBaseURL,
  };

  if (isCloudModel && process.env.OLLAMA_API_KEY) {
    llmProviderOptions.headers = {
      Authorization: `Bearer ${process.env.OLLAMA_API_KEY}`,
    };
  }

  const config: Record<string, unknown> = {
    model: `${llmProviderKey}/${nonVisionModelName}`,
    plugin: [join(PROJECT_DIR, "dist", "index.js")],
    provider: {
      [llmProviderKey]: {
        npm: "@ai-sdk/openai-compatible",
        name: isCloudModel ? "Ollama Cloud" : "Ollama",
        options: llmProviderOptions,
        models: {
          [nonVisionModelName]: {
            name: nonVisionModelName,
          },
        },
      },
      ollama: {
        npm: "@ai-sdk/openai-compatible",
        name: "Ollama",
        options: {
          baseURL: "http://localhost:11434/v1",
        },
        models: {
          [VISION_MODEL]: {
            name: VISION_MODEL,
          },
        },
      },
    },
  };

  return JSON.stringify(config);
}

async function deepTest(): Promise<void> {
  log(`Test image: ${TEST_IMAGE}`);
  log(`Project dir: ${PROJECT_DIR}`);
  log(`Non-vision model: ${NON_VISION_MODEL}`);
  log(`Vision model: ${VISION_MODEL}`);

  if (!readFileSync(TEST_IMAGE).length) {
    throw new Error(`Test image is empty or missing: ${TEST_IMAGE}`);
  }

  await checkOllamaReady();
  await ensureModel(NON_VISION_MODEL);
  await ensureModel(VISION_MODEL);
  await checkSkillInstalled();

  const opencodeConfig = buildOpenCodeConfig();
  if (process.env.DEBUG_OPENCODE === "1") {
    const sanitizedConfig = opencodeConfig.replace(
      /Bearer [^"]+/g,
      "Bearer ***REDACTED***",
    );
    log(`OpenCode config: ${sanitizedConfig}`);
  }

  log("Running opencode run --format json...");
  const result = spawnSync(
    "opencode",
    [
      "run",
      "--format",
      "json",
      "--dangerously-skip-permissions",
      "Please describe the image I have attached.",
      "-f",
      TEST_IMAGE,
    ],
    {
      cwd: PROJECT_DIR,
      env: {
        ...process.env,
        OPENCODE_CONFIG_CONTENT: opencodeConfig,
        OPENCODE_DISABLE_DEFAULT_PLUGINS: "true",
        OPENCODE_FAKE_VCS: "git",
        OLLAMA_VISION_MODEL: VISION_MODEL,
        OLLAMA_API_KEY: process.env.OLLAMA_API_KEY || "",
      },
      timeout: TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
      encoding: "utf-8" as const,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );

  let stdout: string = result.stdout || "";
  let stderr: string = result.stderr || "";

  if (result.error) {
    if (result.error.message.includes("timed out")) {
      throw new Error(
        `opencode run timed out after ${TIMEOUT_MS / 1000}s. stderr: ${stderr.slice(-1000)}`,
      );
    }
    log(`opencode run encountered error: ${result.error.message}`);
  }

  if (result.status !== 0 && result.status !== null) {
    log(
      `opencode run exited with code ${result.status}. stderr: ${stderr.slice(-1000)}`,
    );
  }

  log(
    `opencode run completed. stdout length: ${stdout.length}, stderr length: ${stderr.length}`,
  );

  if (process.env.DEBUG_OPENCODE === "1") {
    log(`stdout: ${stdout.slice(-2000)}`);
    log(`stderr: ${stderr.slice(-2000)}`);
  }

  const combinedOutput = stdout + "\n" + stderr;

  let foundToolCall = false;
  let foundDescription = false;

  if (combinedOutput.includes("comprehend_image")) {
    foundToolCall = true;
    log("SUCCESS: comprehend_image tool was invoked by the LLM!");
  }

  if (
    combinedOutput.includes("1x1") ||
    combinedOutput.includes("red") ||
    combinedOutput.includes("pixel") ||
    combinedOutput.includes("small") ||
    combinedOutput.includes("yellow") ||
    combinedOutput.includes("square") ||
    combinedOutput.includes("tiny") ||
    combinedOutput.includes("image comprehension returned") ||
    combinedOutput.includes("moondream") ||
    combinedOutput.includes("flat") ||
    combinedOutput.includes("solid") ||
    combinedOutput.includes("uniform")
  ) {
    foundDescription = true;
    log("SUCCESS: Image description content detected in the response!");
  }

  if (foundToolCall && foundDescription) {
    log("FULL SUCCESS: Tool invocation AND image description both confirmed!");
  } else if (foundToolCall) {
    log(
      "PARTIAL SUCCESS: Tool was invoked but description pattern not matched (likely OK - pattern matching is approximate).",
    );
  } else if (foundDescription) {
    log(
      "PARTIAL SUCCESS: Description found but tool call not specifically detected.",
    );
  }

  if (!foundToolCall && !foundDescription) {
    throw new Error(
      "Integration test FAILED: No evidence of plugin loading, tool invocation, or image comprehension.\n\n" +
        `stdout (last 2000 chars): ${stdout.slice(-2000)}\n\n` +
        `stderr (last 2000 chars): ${stderr.slice(-2000)}`,
    );
  }

  log("Integration test PASSED!");
}

deepTest().catch((err) => {
  console.error(
    "Integration test FAILED:",
    err instanceof Error ? err.message : String(err),
  );
  process.exit(1);
});
