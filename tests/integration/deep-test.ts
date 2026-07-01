import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = join(__dirname, "..", "..");
const TEST_IMAGE = join(__dirname, "test-image.png");
const PLUGIN_CONFIG_DIR = join(PROJECT_DIR, ".opencode");
const PLUGIN_CONFIG_PATH = join(
  PLUGIN_CONFIG_DIR,
  "opencode-image-comprehension.json",
);

const NON_VISION_MODEL = process.env.NON_VISION_MODEL || "qwen3.5:cloud";
const VISION_MODEL = process.env.IMAGE_COMPREHENSION_MODEL || "gemma4:31b";

const TIMEOUT_MS = 300_000;

interface LlmProviderOptions {
  baseURL: string;
  headers?: Record<string, string>;
}

function log(msg: string): void {
  console.log(`[deep-test] ${msg}`);
}

function snippetAround(value: string, needle: string): string | undefined {
  const index = value.indexOf(needle);
  if (index === -1) return undefined;
  return value.slice(Math.max(0, index - 500), index + needle.length + 500);
}

function getCloudApiKey(): string | undefined {
  return (
    process.env.OLLAMA_CLOUD_API_KEY ||
    process.env.OLLAMA_API_KEY ||
    process.env.LEGACY_OLLAMA_CLOUD_APIKEY
  );
}

function requireCloudApiKey(): void {
  if (getCloudApiKey()) return;
  throw new Error("OLLAMA_API_KEY or OLLAMA_CLOUD_API_KEY is required");
}

function writePluginConfig(): () => void {
  const previousConfig = existsSync(PLUGIN_CONFIG_PATH)
    ? readFileSync(PLUGIN_CONFIG_PATH, "utf-8")
    : undefined;

  mkdirSync(PLUGIN_CONFIG_DIR, { recursive: true });
  writeFileSync(
    PLUGIN_CONFIG_PATH,
    JSON.stringify(
      {
        provider: "ollama-cloud",
        model: VISION_MODEL,
        apiKeyEnv: process.env.OLLAMA_API_KEY
          ? "OLLAMA_API_KEY"
          : "OLLAMA_CLOUD_API_KEY",
        activation: "force",
      },
      null,
      2,
    ),
  );

  return () => {
    if (previousConfig !== undefined) {
      writeFileSync(PLUGIN_CONFIG_PATH, previousConfig);
      return;
    }
    rmSync(PLUGIN_CONFIG_PATH, { force: true });
  };
}

function buildOpenCodeConfig(): string {
  const isCloudModel = NON_VISION_MODEL.endsWith(":cloud");
  const cloudApiKey = getCloudApiKey();

  const nonVisionModelName = isCloudModel
    ? NON_VISION_MODEL.replace(":cloud", "")
    : NON_VISION_MODEL;

  const llmProviderKey = isCloudModel ? "ollama-cloud" : "ollama";
  const llmBaseURL = isCloudModel
    ? "https://ollama.com/v1"
    : "http://localhost:11434/v1";

  const llmProviderOptions: LlmProviderOptions = {
    baseURL: llmBaseURL,
  };

  if (isCloudModel && cloudApiKey) {
    llmProviderOptions.headers = {
      Authorization: `Bearer ${cloudApiKey}`,
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
            modalities: {
              input: ["text"],
              output: ["text"],
            },
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

  requireCloudApiKey();
  const restorePluginConfig = writePluginConfig();

  try {
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
          IMAGE_COMPREHENSION_MODEL: VISION_MODEL,
          OLLAMA_API_KEY: process.env.OLLAMA_API_KEY || "",
          OLLAMA_CLOUD_API_KEY: getCloudApiKey() || "",
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
      for (const needle of [
        "comprehend_image",
        "image_path",
        "shell",
        "bash",
      ]) {
        const snippet = snippetAround(stdout, needle);
        if (snippet) log(`stdout around ${needle}: ${snippet}`);
      }
    }

    const combinedOutput = stdout + "\n" + stderr;

    let foundToolCall = false;
    let foundDescription = false;

    if (
      combinedOutput.includes("comprehend_image") &&
      combinedOutput.includes("image_path")
    ) {
      foundToolCall = true;
      log(
        "SUCCESS: comprehend_image tool was invoked by the LLM with image_path!",
      );
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
      combinedOutput.includes("flat") ||
      combinedOutput.includes("solid") ||
      combinedOutput.includes("uniform")
    ) {
      foundDescription = true;
      log("SUCCESS: Image description content detected in the response!");
    }

    if (!foundToolCall || !foundDescription) {
      throw new Error(
        "Integration test FAILED: expected both image_path tool invocation and image description evidence.\n\n" +
          `stdout (last 2000 chars): ${stdout.slice(-2000)}\n\n` +
          `stderr (last 2000 chars): ${stderr.slice(-2000)}`,
      );
    }

    log("FULL SUCCESS: Tool invocation AND image description both confirmed!");

    log("Integration test PASSED!");
  } finally {
    restorePluginConfig();
  }
}

deepTest().catch((err) => {
  console.error(
    "Integration test FAILED:",
    err instanceof Error ? err.message : String(err),
  );
  process.exit(1);
});
