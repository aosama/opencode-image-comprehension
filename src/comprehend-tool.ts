import { tool } from "@opencode-ai/plugin";
import { DEFAULT_IMAGE_PROMPT } from "./constants.js";
import { describeImageWithOllamaCloud } from "./providers/ollama-cloud.js";
import { describeImageWithOmlx } from "./providers/omlx.js";
import type { PluginConfig } from "./types.js";

export function createComprehendImageTool(getConfig: () => PluginConfig) {
  // Pass config through a getter instead of capturing a value at module load.
  // OpenCode constructs tools after plugin startup, and tests may also exercise
  // this factory directly; the getter keeps the tool tied to the latest resolved
  // config without making the module itself stateful.
  return tool({
    description:
      "Analyze a local image file and return a detailed text answer. " +
      "Use this tool when you need to inspect an image path mentioned in the conversation or any local image path. " +
      "The image_path can be absolute, file://, or relative to the current OpenCode directory. " +
      "Supports PNG, JPEG, GIF, WebP, and BMP formats. Choose the prompt based on what you need to learn from the image.",
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
