import type { Plugin } from "@opencode-ai/plugin";
import type { Message, Part, FilePart, TextPart } from "@opencode-ai/sdk";
import { tool } from "@opencode-ai/plugin";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const PLUGIN_NAME = "image-comprehension";
const TOOL_NAME = "comprehend_image";
const CONFIG_FILENAME = "opencode-image-comprehension.json";
const TEMP_DIR_NAME = "opencode-image-comprehension";
const SKILL_DIR_NAME = "image-comprehension-ollama";

const DEFAULT_VISION_MODEL = "moondream:1.8b";
const DEFAULT_SKILL_PROMPT = "Describe this image in detail";

const SUPPORTED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "image/bmp",
]);

const MIME_TO_EXTENSION: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/bmp": "bmp",
};

const PROMPT_TEMPLATE_VARIABLES = [
  "{imageList}",
  "{imageCount}",
  "{toolName}",
  "{userText}",
] as const;

interface PluginConfig {
  models?: string[];
  visionModel?: string;
  promptTemplate?: string;
  skillPath?: string;
  autoPullModel?: boolean;
}

interface SavedImage {
  path: string;
  mime: string;
  partId: string;
}

interface ModelInfo {
  providerID: string;
  modelID: string;
}

type Logger = (msg: string) => void;

let pluginConfig: PluginConfig = {};

function getUserConfigPath(): string {
  return join(homedir(), ".config", "opencode", CONFIG_FILENAME);
}

function getProjectConfigPath(directory: string): string {
  return join(directory, ".opencode", CONFIG_FILENAME);
}

function parseModelsArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const models = value.filter((m): m is string => typeof m === "string");
  return models.length > 0 ? models : undefined;
}

function parseVisionModel(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  return trimmed;
}

function parsePromptTemplate(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  if (!PROMPT_TEMPLATE_VARIABLES.some((v) => trimmed.includes(v)))
    return undefined;
  return trimmed;
}

function parseSkillPath(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  return trimmed;
}

function parseAutoPullModel(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value === "true") return true;
    if (value === "false") return false;
  }
  return undefined;
}

function parseConfigObject(raw: unknown): PluginConfig {
  if (!raw || typeof raw !== "object") return {};
  const obj = raw as Record<string, unknown>;
  return {
    models: parseModelsArray(obj.models),
    visionModel: parseVisionModel(obj.visionModel),
    promptTemplate: parsePromptTemplate(obj.promptTemplate),
    skillPath: parseSkillPath(obj.skillPath),
    autoPullModel: parseAutoPullModel(obj.autoPullModel),
  };
}

async function readConfigFile(
  configPath: string,
): Promise<PluginConfig | null> {
  if (!existsSync(configPath)) return null;
  try {
    const content = await readFile(configPath, "utf-8");
    const parsed = JSON.parse(content) as unknown;
    return parseConfigObject(parsed);
  } catch {
    return null;
  }
}

function selectWithPrecedence<T>(
  projectValue: T | undefined,
  userValue: T | undefined,
  defaultValue: T,
): { value: T; source: "project" | "user" | "default" } {
  if (projectValue !== undefined) {
    return { value: projectValue, source: "project" };
  }
  if (userValue !== undefined) {
    return { value: userValue, source: "user" };
  }
  return { value: defaultValue, source: "default" };
}

async function loadPluginConfig(directory: string, log: Logger): Promise<void> {
  const userConfig = await readConfigFile(getUserConfigPath());
  const projectConfig = await readConfigFile(getProjectConfigPath(directory));

  const modelsResult = selectWithPrecedence(
    projectConfig?.models,
    userConfig?.models,
    undefined,
  );
  if (modelsResult.source !== "default") {
    log(
      `Loaded models from ${modelsResult.source} config: ${modelsResult.value?.join(", ")}`,
    );
  } else {
    log(
      "Using auto-detection for non-vision models (no model patterns configured)",
    );
  }

  const visionModelResult = selectWithPrecedence(
    projectConfig?.visionModel,
    userConfig?.visionModel,
    undefined,
  );
  if (visionModelResult.source !== "default") {
    log(
      `Using vision model from ${visionModelResult.source} config: ${visionModelResult.value}`,
    );
  } else {
    log(`Using default vision model: ${DEFAULT_VISION_MODEL}`);
  }

  const templateResult = selectWithPrecedence(
    projectConfig?.promptTemplate,
    userConfig?.promptTemplate,
    undefined,
  );
  if (templateResult.source !== "default") {
    log(
      `Using prompt template from ${templateResult.source} config (${templateResult.value?.length ?? 0} chars)`,
    );
  } else {
    log("Using default injection prompt template");
  }

  const skillPathResult = selectWithPrecedence(
    projectConfig?.skillPath,
    userConfig?.skillPath,
    undefined,
  );
  if (skillPathResult.source !== "default") {
    log(
      `Using skill script path from ${skillPathResult.source} config: ${skillPathResult.value}`,
    );
  } else {
    log("Using default skill script path resolution");
  }

  const autoPullResult = selectWithPrecedence(
    projectConfig?.autoPullModel,
    userConfig?.autoPullModel,
    true,
  );
  log(
    `Auto-pull missing models: ${autoPullResult.value ? "enabled" : "disabled"}`,
  );

  pluginConfig = {
    models: modelsResult.value,
    visionModel: visionModelResult.value,
    promptTemplate: templateResult.value,
    skillPath: skillPathResult.value,
    autoPullModel: autoPullResult.value,
  };
}

function getConfiguredModels(): readonly string[] | undefined {
  return pluginConfig.models;
}

function getVisionModel(): string {
  return pluginConfig.visionModel ?? DEFAULT_VISION_MODEL;
}

function getPromptTemplate(): string | undefined {
  return pluginConfig.promptTemplate;
}

function getAutoPullModel(): boolean {
  return pluginConfig.autoPullModel ?? true;
}

function matchesWildcardPattern(pattern: string, value: string): boolean {
  const p = pattern.toLowerCase();
  const v = value.toLowerCase();
  if (p === "*") return true;
  if (p.startsWith("*") && p.endsWith("*") && p.length > 2) {
    return v.includes(p.slice(1, -1));
  }
  if (p.endsWith("*")) {
    return v.startsWith(p.slice(0, -1));
  }
  if (p.startsWith("*")) {
    return v.endsWith(p.slice(1));
  }
  return v === p;
}

function matchesSinglePattern(pattern: string, model: ModelInfo): boolean {
  if (pattern === "*") return true;
  const slashIndex = pattern.indexOf("/");
  if (slashIndex === -1) {
    return (
      matchesWildcardPattern(pattern, model.modelID) ||
      matchesWildcardPattern(pattern, model.providerID)
    );
  }
  const providerPattern = pattern.slice(0, slashIndex);
  const modelPattern = pattern.slice(slashIndex + 1);
  return (
    matchesWildcardPattern(providerPattern, model.providerID) &&
    matchesWildcardPattern(modelPattern, model.modelID)
  );
}

function modelMatchesAnyPattern(model: ModelInfo | undefined): boolean {
  if (!model) return false;
  const patterns = getConfiguredModels();
  if (!patterns) return false;
  return patterns.some((pattern) => matchesSinglePattern(pattern, model));
}

function isImageFilePart(part: Part): part is FilePart {
  if (part.type !== "file") return false;
  const mime = (part as FilePart).mime?.toLowerCase() ?? "";
  return SUPPORTED_MIME_TYPES.has(mime);
}

function isTextPart(part: Part): part is TextPart {
  return part.type === "text";
}

function handleFileUrl(
  url: string,
  filePart: FilePart,
  log: Logger,
): SavedImage | null {
  const localPath = url.replace("file://", "");
  log(`Image already on disk: ${localPath}`);
  return { path: localPath, mime: filePart.mime, partId: filePart.id };
}

function parseBase64DataUrl(
  dataUrl: string,
): { mime: string; data: Buffer } | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  try {
    return { mime: match[1], data: Buffer.from(match[2], "base64") };
  } catch {
    return null;
  }
}

async function handleDataUrl(
  url: string,
  filePart: FilePart,
  log: Logger,
): Promise<SavedImage | null> {
  const parsed = parseBase64DataUrl(url);
  if (!parsed) {
    log(`Failed to parse data URL for part ${filePart.id}`);
    return null;
  }
  try {
    const savedPath = await saveImageToTemp(parsed.data, parsed.mime);
    log(`Saved pasted image to temp file: ${savedPath}`);
    return { path: savedPath, mime: parsed.mime, partId: filePart.id };
  } catch (err) {
    log(
      `Failed to save image: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

function handleHttpUrl(
  url: string,
  filePart: FilePart,
  log: Logger,
): SavedImage {
  log(`Image is remote URL (will be fetched by tool): ${url}`);
  return { path: url, mime: filePart.mime, partId: filePart.id };
}

function getExtensionForMime(mime: string): string {
  return MIME_TO_EXTENSION[mime.toLowerCase()] ?? "png";
}

async function ensureTempDir(): Promise<string> {
  const dir = join(tmpdir(), TEMP_DIR_NAME);
  await mkdir(dir, { recursive: true });
  return dir;
}

async function saveImageToTemp(data: Buffer, mime: string): Promise<string> {
  const tempDir = await ensureTempDir();
  const filename = `${randomUUID()}.${getExtensionForMime(mime)}`;
  const filepath = join(tempDir, filename);
  await writeFile(filepath, data);
  return filepath;
}

async function processImagePart(
  filePart: FilePart,
  log: Logger,
): Promise<SavedImage | null> {
  const url = filePart.url;
  if (!url) {
    log(`Skipping image part ${filePart.id}: no URL`);
    return null;
  }
  if (url.startsWith("file://")) {
    return handleFileUrl(url, filePart, log);
  }
  if (url.startsWith("data:")) {
    return handleDataUrl(url, filePart, log);
  }
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return handleHttpUrl(url, filePart, log);
  }
  log(`Unsupported URL scheme for part ${filePart.id}: ${url.slice(0, 50)}...`);
  return null;
}

async function extractImagesFromParts(
  parts: Part[],
  log: Logger,
): Promise<SavedImage[]> {
  const savedImages: SavedImage[] = [];
  for (const part of parts) {
    if (!isImageFilePart(part)) continue;
    const result = await processImagePart(part as FilePart, log);
    if (result) {
      savedImages.push(result);
    }
  }
  return savedImages;
}

function applyPromptTemplate(
  template: string,
  vars: {
    imageList: string;
    imageCount: number;
    toolName: string;
    userText: string;
  },
): string {
  return template
    .replace(/\{imageList\}/g, vars.imageList)
    .replace(/\{imageCount\}/g, String(vars.imageCount))
    .replace(/\{toolName\}/g, vars.toolName)
    .replace(/\{userText\}/g, vars.userText);
}

function generateInjectionPrompt(
  images: SavedImage[],
  userText: string,
  toolName: string,
): string {
  if (images.length === 0) return userText;

  const imageList = images
    .map((img, idx) => `- Image ${idx + 1}: ${img.path}`)
    .join("\n");

  const customTemplate = getPromptTemplate();
  if (customTemplate !== undefined) {
    return applyPromptTemplate(customTemplate, {
      imageList,
      imageCount: images.length,
      toolName,
      userText,
    });
  }

  const isSingle = images.length === 1;
  const imageCountText = isSingle ? "an image" : `${images.length} images`;
  const imagePlural = isSingle ? "image is" : "images are";
  const analyzeText = isSingle ? "this image" : "each image";

  return `The user has shared ${imageCountText}. The ${imagePlural} saved at:
${imageList}

Use the \`${toolName}\` tool to analyze ${analyzeText}. Pass the image path(s) to the tool and it will return a detailed text description of what is in the image.

User's request: ${userText || "(analyze the image)"}`;
}

function findLastUserMessage(
  messages: Array<{ info: Message; parts: Part[] }>,
): { message: { info: Message; parts: Part[] }; index: number } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].info.role === "user") {
      return { message: messages[i], index: i };
    }
  }
  return null;
}

function getModelFromMessage(message: {
  info: Message;
}): ModelInfo | undefined {
  const info = message.info as { model?: ModelInfo };
  return info.model;
}

function modelSupportsVision(message: { info: Message }): boolean {
  const modelInfo = (message.info as Record<string, unknown>).model as
    | Record<string, unknown>
    | undefined;
  if (!modelInfo) return false;
  const capabilities = modelInfo.capabilities as
    | Record<string, unknown>
    | undefined;
  if (!capabilities) return false;
  const input = capabilities.input as Record<string, unknown> | undefined;
  if (!input) return false;
  return input.image === true;
}

function removeProcessedImageParts(
  parts: Part[],
  processedIds: Set<string>,
): Part[] {
  return parts.filter(
    (part) => !(part.type === "file" && processedIds.has(part.id)),
  );
}

function updateOrCreateTextPart(
  message: { info: Message; parts: Part[] },
  newText: string,
): void {
  const textPartIndex = message.parts.findIndex(isTextPart);
  if (textPartIndex !== -1) {
    (message.parts[textPartIndex] as TextPart).text = newText;
  } else {
    const newTextPart: TextPart = {
      id: `transformed-${randomUUID()}`,
      sessionID: message.info.sessionID,
      messageID: message.info.id,
      type: "text",
      text: newText,
      synthetic: true,
    };
    message.parts.unshift(newTextPart);
  }
}

function resolveSkillScriptPath(log: Logger): string {
  const configuredPath = pluginConfig.skillPath;
  if (configuredPath) {
    log(`Using configured skill script path: ${configuredPath}`);
    return configuredPath;
  }

  const defaultSkillPaths = [
    join(
      homedir(),
      ".agents",
      "skills",
      SKILL_DIR_NAME,
      "scripts",
      "comprehend_image.sh",
    ),
    join(
      homedir(),
      ".config",
      "opencode",
      "skills",
      SKILL_DIR_NAME,
      "scripts",
      "comprehend_image.sh",
    ),
  ];

  for (const candidate of defaultSkillPaths) {
    if (existsSync(candidate)) {
      log(`Found skill script at: ${candidate}`);
      return candidate;
    }
  }

  const primaryDefault = defaultSkillPaths[0];
  log(
    `No skill script found at default locations. Will use: ${primaryDefault}`,
  );
  return primaryDefault;
}

const execFileAsync = promisify(execFile);

async function ensureSkillInstalled(log: Logger): Promise<boolean> {
  const scriptPath = resolveSkillScriptPath(log);

  if (existsSync(scriptPath)) {
    log("image-comprehension-ollama skill is installed");
    return true;
  }

  log(
    "image-comprehension-ollama skill not found. Attempting to install via npx...",
  );

  try {
    const { stdout, stderr } = await execFileAsync(
      "npx",
      ["skills", "add", "aosama/image-comprehension-ollama"],
      { timeout: 120000 },
    );

    if (stdout) log(`npx skills add stdout: ${stdout.slice(0, 200)}`);
    if (stderr) log(`npx skills add stderr: ${stderr.slice(0, 200)}`);

    log("Successfully installed image-comprehension-ollama skill via npx");

    if (existsSync(scriptPath)) {
      log(`Confirmed skill script now available at: ${scriptPath}`);
      return true;
    }

    log(
      `Skill installation reported success but script not found at ${scriptPath}. ` +
        `The skill may have been installed to a different location. Attempting to use default path.`,
    );
    return true;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log(
      `Error installing skill: ${errorMsg}. ` +
        `Please install manually: npx skills add aosama/image-comprehension-ollama`,
    );
    return false;
  }
}

async function ensureOllamaAndModel(log: Logger): Promise<boolean> {
  const visionModel = getVisionModel();
  const autoPull = getAutoPullModel();

  try {
    const { stdout: listOutput } = await execFileAsync("ollama", ["list"], {
      timeout: 30000,
    }).catch((err: { stdout?: string; stderr?: string }) => {
      const combined = (err.stdout || "") + (err.stderr || "");
      if (combined) {
        log(`ollama list output: ${combined.slice(0, 300)}`);
      }
      throw err;
    });

    const isModelInstalled = listOutput.includes(visionModel);

    if (isModelInstalled) {
      log(`Vision model '${visionModel}' is already installed`);
      return true;
    }

    if (!autoPull) {
      log(
        `Vision model '${visionModel}' is not installed and auto-pull is disabled. ` +
          `Please run: ollama pull ${visionModel}`,
      );
      return false;
    }

    log(
      `Vision model '${visionModel}' not found. Auto-pulling... (this may take a few minutes on first run)`,
    );

    try {
      const { stdout: pullOutput, stderr: pullStderr } = await execFileAsync(
        "ollama",
        ["pull", visionModel],
        { timeout: 600000 },
      );
      if (pullOutput) log(`ollama pull: ${pullOutput.slice(0, 200)}`);
      if (pullStderr) log(`ollama pull stderr: ${pullStderr.slice(0, 200)}`);
      log(`Successfully pulled vision model '${visionModel}'`);
      return true;
    } catch (pullErr) {
      const pullErrorMsg =
        pullErr instanceof Error ? pullErr.message : String(pullErr);
      log(
        `Failed to pull vision model '${visionModel}'. ` +
          `Please run manually: ollama pull ${visionModel}. ` +
          `Error: ${pullErrorMsg.slice(0, 200)}`,
      );
      return false;
    }
  } catch {
    log(
      "Ollama is not responding. Please ensure Ollama is installed and running. " +
        "Install from https://ollama.com or run 'ollama serve'.",
    );
    return false;
  }
}

export const ImageComprehensionPlugin: Plugin = async (input) => {
  const { client, directory } = input;

  const log: Logger = (msg) => {
    client.app
      .log({ body: { service: PLUGIN_NAME, level: "info", message: msg } })
      .catch(() => {});
  };

  const warn: Logger = (msg) => {
    client.app
      .log({ body: { service: PLUGIN_NAME, level: "warn", message: msg } })
      .catch(() => {});
  };

  await loadPluginConfig(directory, log);

  let skillInstalled = false;
  let ollamaReady = false;

  try {
    skillInstalled = await ensureSkillInstalled(log);
  } catch (err) {
    warn(
      `Skill installation check failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  try {
    ollamaReady = await ensureOllamaAndModel(log);
  } catch (err) {
    warn(
      `Ollama readiness check failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (skillInstalled) {
    log("image-comprehension-ollama skill: ready");
  } else {
    warn(
      "image-comprehension-ollama skill: not ready. Install with: npx skills add aosama/image-comprehension-ollama",
    );
  }

  if (ollamaReady) {
    const visionModel = getVisionModel();
    log(`Ollama + vision model '${visionModel}': ready`);
  } else {
    warn(
      "Ollama or vision model: not ready. Image comprehension will attempt to run at call time but may fail.",
    );
  }

  log("Plugin initialized");

  return {
    tool: {
      comprehend_image: tool({
        description:
          "Analyze an image file and return a detailed text description. " +
          "Use this tool when you need to understand or describe an image that has been shared by the user. " +
          "Supports PNG, JPEG, GIF, WebP, and BMP formats. " +
          "Pass the image file path (or HTTP URL) and optionally a custom prompt.",
        args: {
          imagePath: tool.schema
            .string()
            .describe(
              "Absolute path to the image file, or an HTTP(S) URL to the image",
            ),
          prompt: tool.schema
            .string()
            .optional()
            .describe(
              "Custom question or prompt about the image (default: 'Describe this image in detail')",
            ),
        },
        async execute(args, context) {
          const scriptPath = resolveSkillScriptPath((msg: string) => {
            context.metadata({
              title: "Image Comprehension",
              metadata: { step: "skill-resolution", detail: msg },
            });
          });
          const visionModel = getVisionModel();

          const imagePath = args.imagePath;
          const prompt = args.prompt || DEFAULT_SKILL_PROMPT;

          context.metadata({
            title: "Image Comprehension",
            metadata: {
              step: "starting",
              image: imagePath,
              model: visionModel,
              prompt: prompt.slice(0, 100),
            },
          });

          const shellCmd = scriptPath;
          const shellArgs = [
            "--image",
            imagePath,
            "--prompt",
            prompt,
            "--model",
            visionModel,
          ];

          try {
            const { stdout: description, stderr: stderrOutput } =
              await execFileAsync(shellCmd, shellArgs, {
                timeout: 180000,
              });

            if (!description || !description.trim()) {
              const stderrInfo = stderrOutput
                ? ` Stderr: ${stderrOutput.trim().slice(0, 200)}`
                : "";
              return {
                output: `Image comprehension returned no output. The model may not have been able to process the image.${stderrInfo}`,
                metadata: { error: true, empty: true },
              };
            }

            return description.trim();
          } catch (err) {
            const execErr = err as Error & {
              code?: string;
              stdout?: string;
              stderr?: string;
            };
            if (execErr.code === "ENOENT") {
              return {
                output: `Image comprehension script not found at: ${scriptPath}. Please ensure the image-comprehension-ollama skill is installed: npx skills add aosama/image-comprehension-ollama`,
                metadata: { error: true, code: "ENOENT" },
              };
            }
            const errOutput =
              execErr.stderr ||
              execErr.stdout ||
              execErr.message ||
              String(err);
            return {
              output: `Error running image comprehension: ${errOutput.slice(0, 500)}`,
              metadata: { error: true },
            };
          }
        },
      }),
    },

    "experimental.chat.messages.transform": async (_input, output) => {
      const { messages } = output;

      const result = findLastUserMessage(messages);
      if (!result) return;

      const { message: lastUserMessage, index: lastUserIndex } = result;

      const configuredModels = getConfiguredModels();
      if (configuredModels !== undefined) {
        const model = getModelFromMessage(lastUserMessage);
        if (!modelMatchesAnyPattern(model)) return;
      } else {
        if (modelSupportsVision(lastUserMessage)) {
          log(`Model supports vision natively — skipping image comprehension`);
          return;
        }
      }

      log("Non-vision model detected, checking for images...");

      const hasImages = lastUserMessage.parts.some(isImageFilePart);
      if (!hasImages) return;

      log("Found images in message, processing...");

      const savedImages = await extractImagesFromParts(
        lastUserMessage.parts,
        log,
      );
      if (savedImages.length === 0) {
        log("No images were successfully saved");
        return;
      }

      log(
        `Saved ${savedImages.length} image(s), transforming message to use comprehend_image tool...`,
      );

      const existingTextPart = lastUserMessage.parts.find(isTextPart);
      const userText = existingTextPart?.text ?? "";

      const transformedText = generateInjectionPrompt(
        savedImages,
        userText,
        TOOL_NAME,
      );

      const processedIds = new Set(savedImages.map((img) => img.partId));
      lastUserMessage.parts = removeProcessedImageParts(
        lastUserMessage.parts,
        processedIds,
      );

      updateOrCreateTextPart(lastUserMessage, transformedText);
      messages[lastUserIndex] = lastUserMessage;

      log("Successfully injected image comprehension instructions");
    },
  };
};

export default ImageComprehensionPlugin;
