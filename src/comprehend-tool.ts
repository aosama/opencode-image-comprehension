import { tool } from "@opencode-ai/plugin";
import { DEFAULT_IMAGE_PROMPT } from "./constants.js";
import { describeImageWithOllamaCloud } from "./providers/ollama-cloud.js";
import { describeImageWithOmlx } from "./providers/omlx.js";
import type { PluginConfig } from "./types.js";

export function createComprehendImageTool(
  getConfig: () => PluginConfig,
  shouldBlockForVisionModel: (context: { sessionID: string }) => boolean = () =>
    false,
) {
  // Pass config through a getter instead of capturing a value at module load.
  // OpenCode constructs tools after plugin startup, and tests may also exercise
  // this factory directly; the getter keeps the tool tied to the latest resolved
  // config without making the module itself stateful.
  return tool({
    description:
      "Analyze a local image file and return a detailed text answer. " +
      "This tool is a FALLBACK for text-only models that cannot see images natively. " +
      "If you are a vision-capable model and the image is attached to your context, look at it directly — do NOT call this tool. " +
      "Only use this tool when you genuinely cannot see the image and need a text description of it. " +
      "The image_path can be absolute, file://, or relative to the current OpenCode directory. " +
      "Supports PNG, JPEG, GIF, WebP, and BMP formats.",
    args: {
      image_path: tool.schema
        .string()
        .describe(
          "Absolute path, file:// URL, or current-directory-relative path to a local image file",
        ),
      prompt: tool.schema
        .string()
        .describe(
          "Question or instruction for the vision model about this image",
        ),
    },
    async execute(args, context) {
      // The LLM chooses both the image path and the visual prompt. The plugin's
      // job here is execution and validation, not deciding what should be asked
      // about the image.

      // Guard: if this session is using a vision-capable model, refuse and tell
      // the model to look at the image directly. The tool is always registered
      // (the plugin API doesn't support conditional registration), so vision
      // models can see it and may try to call it despite the description saying
      // not to. This guard avoids an unnecessary oMLX round-trip even if host
      // before-hooks do not run for plugin-defined tools.
      if (shouldBlockForVisionModel(context)) {
        context.metadata({
          title: "Image Comprehension",
          metadata: {
            step: "blocked",
            reason: "vision-capable model should look at the image directly",
          },
        });
        return {
          output:
            "This tool is a fallback for text-only models. You are a vision-capable model — look at the image directly instead of calling this tool. " +
            "If the image was pasted as an attachment, it should already be in your context as an image part. " +
            "If the image is at a local file path, use your native vision capability to read and describe it. " +
            "Do not call comprehend_image again.",
          metadata: { blocked: true },
        };
      }

      const config = getConfig();
      const prompt = args.prompt || DEFAULT_IMAGE_PROMPT;
      // Metadata is surfaced in OpenCode's tool UI/log stream. Keep it concise
      // and non-secret: image path, provider/model identity, and a small prompt
      // preview are enough for debugging without dumping large content.
      context.metadata({
        title: "Image Comprehension",
        metadata: {
          step: "starting",
          image: args.image_path,
          provider: config.provider,
          model: config.model,
          prompt: prompt.slice(0, 100),
        },
      });

      try {
        // context.directory is OpenCode's current project/session directory. It
        // is the correct base for relative paths supplied by the LLM or user.
        // Dispatch to the configured vision provider so the tool stays unaware
        // of provider-specific request/response shapes.
        const describeImage =
          config.provider === "omlx"
            ? describeImageWithOmlx
            : describeImageWithOllamaCloud;
        return await describeImage({
          imagePath: args.image_path,
          directory: context.directory,
          prompt,
          config,
        });
      } catch (error) {
        // Tool failures should come back as model-readable results so the LLM can
        // recover or explain the failure. Throwing here would surface as a lower
        // level OpenCode/tool error and usually produces a worse user experience.
        const errorOutput =
          error instanceof Error ? error.message : String(error);
        return {
          output: `Error running image comprehension: ${errorOutput.slice(0, 500)}`,
          metadata: { error: true },
        };
      }
    },
  });
}
