import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const WORKSPACE_DIR = "/workspace";
const PLUGIN_PACKAGE_DIR = join(
  WORKSPACE_DIR,
  "node_modules",
  "opencode-image-comprehension",
);
const TEST_IMAGE = join(WORKSPACE_DIR, "test-image.png");
const HOST_MODEL = "glm-5.2";
const VISION_MODEL = process.env.IMAGE_COMPREHENSION_MODEL || "gemma4:31b";
const TIMEOUT_MS = 300_000;

function log(message) {
  console.log(`[docker-packed-test] ${message}`);
}

function requireFile(path, description) {
  if (!existsSync(path)) throw new Error(`${description} not found: ${path}`);
}

function requireApiKey() {
  if (
    process.env.OLLAMA_API_KEY ||
    process.env.OLLAMA_CLOUD_API_KEY ||
    process.env.SEARCH_WEB_OLLAMA
  ) {
    return;
  }
  throw new Error(
    "OLLAMA_API_KEY, OLLAMA_CLOUD_API_KEY, or SEARCH_WEB_OLLAMA is required",
  );
}

function writePluginConfig() {
  const configDirectory = join(WORKSPACE_DIR, ".opencode");
  mkdirSync(configDirectory, { recursive: true });
  writeFileSync(
    join(configDirectory, "opencode-image-comprehension.json"),
    JSON.stringify(
      {
        provider: "ollama-cloud",
        model: VISION_MODEL,
        apiKeyEnv: process.env.OLLAMA_API_KEY
          ? "OLLAMA_API_KEY"
          : process.env.OLLAMA_CLOUD_API_KEY
            ? "OLLAMA_CLOUD_API_KEY"
            : "SEARCH_WEB_OLLAMA",
        activation: "force",
      },
      null,
      2,
    ),
  );
}

function buildOpenCodeConfig() {
  const apiKey =
    process.env.OLLAMA_API_KEY ||
    process.env.OLLAMA_CLOUD_API_KEY ||
    process.env.SEARCH_WEB_OLLAMA;

  return JSON.stringify({
    model: `ollama-cloud/${HOST_MODEL}`,
    plugin: [PLUGIN_PACKAGE_DIR],
    provider: {
      "ollama-cloud": {
        npm: "@ai-sdk/openai-compatible",
        name: "Ollama Cloud",
        options: {
          baseURL: "https://ollama.com/v1",
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
        },
        models: {
          [HOST_MODEL]: {
            name: HOST_MODEL,
            modalities: {
              input: ["text"],
              output: ["text"],
            },
          },
        },
      },
    },
  });
}

function includesAny(value, needles) {
  return needles.some((needle) => value.includes(needle));
}

function main() {
  requireApiKey();
  requireFile(PLUGIN_PACKAGE_DIR, "Installed plugin package directory");
  requireFile(
    join(PLUGIN_PACKAGE_DIR, "dist", "index.js"),
    "Plugin package entrypoint",
  );
  requireFile(TEST_IMAGE, "Test image");
  writePluginConfig();

  const opencodeConfig = buildOpenCodeConfig();
  log(`Host model: ollama-cloud/${HOST_MODEL}`);
  log(`Vision model: ${VISION_MODEL}`);
  log(`Plugin package directory: ${PLUGIN_PACKAGE_DIR}`);

  const result = spawnSync(
    "opencode",
    [
      "run",
      "--format",
      "json",
      "--dangerously-skip-permissions",
      "Please inspect the attached image using the image comprehension tool, then tell me what it contains.",
      "-f",
      TEST_IMAGE,
    ],
    {
      cwd: WORKSPACE_DIR,
      env: {
        ...process.env,
        OPENCODE_CONFIG_CONTENT: opencodeConfig,
        OPENCODE_DISABLE_DEFAULT_PLUGINS: "true",
        OPENCODE_FAKE_VCS: "git",
      },
      timeout: TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    },
  );

  const stdout = result.stdout || "";
  const stderr = result.stderr || "";
  const combinedOutput = `${stdout}\n${stderr}`;

  log(`opencode status: ${result.status}`);
  log(`stdout bytes: ${stdout.length}`);
  log(`stderr bytes: ${stderr.length}`);

  if (result.error) {
    throw new Error(`opencode failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`opencode exited ${result.status}: ${stderr.slice(-2000)}`);
  }

  const foundImagePathToolCall =
    combinedOutput.includes("comprehend_image") &&
    combinedOutput.includes("image_path");
  const foundDescription = includesAny(combinedOutput, [
    "yellow",
    "square",
    "solid",
    "uniform",
    "flat",
    "color",
  ]);

  if (!foundImagePathToolCall || !foundDescription) {
    throw new Error(
      "Packed Docker test failed. Expected comprehend_image with image_path and image-description content.\n\n" +
        `stdout tail:\n${stdout.slice(-3000)}\n\nstderr tail:\n${stderr.slice(-3000)}`,
    );
  }

  log(
    "SUCCESS: packed plugin loaded from node_modules and image_path tool flow worked",
  );
}

try {
  main();
} catch (error) {
  console.error(
    "[docker-packed-test] FAILED:",
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
}
