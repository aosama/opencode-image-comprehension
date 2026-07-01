import type { SavedImage } from "./types.js";

function applyPromptTemplate(
  template: string,
  vars: {
    imageList: string;
    imageCount: number;
    toolName: string;
    userText: string;
  },
): string {
  // Custom templates are intentionally simple string substitutions. This keeps
  // config portable JSON and avoids exposing a template language that could make
  // prompt construction hard to reason about or unsafe to render.
  return template
    .replace(/\{imageList\}/g, vars.imageList)
    .replace(/\{imageCount\}/g, String(vars.imageCount))
    .replace(/\{toolName\}/g, vars.toolName)
    .replace(/\{userText\}/g, vars.userText);
}

export function generateImageReferencePrompt(
  images: SavedImage[],
  userText: string,
  toolName: string,
  promptTemplate?: string,
): string {
  // This prompt is the core UX contract for non-vision models. It should make
  // the image feel like a local file the model can reference, not like hidden
  // plugin state or a precomputed description.
  if (images.length === 0) return userText;

  // Use a numbered list because models are better at referring back to "Image
  // 1" / "Image 2" when there are multiple attachments and the user asks for a
  // comparison or a specific image.
  const imageList = images
    .map((image, imageIndex) => `- Image ${imageIndex + 1}: ${image.path}`)
    .join("\n");
  if (promptTemplate !== undefined) {
    // Preserve advanced user customization, but only after config parsing has
    // already guaranteed the template includes at least one supported variable.
    return applyPromptTemplate(promptTemplate, {
      imageList,
      imageCount: images.length,
      toolName,
      userText,
    });
  }

  const imageCountText =
    images.length === 1 ? "an image" : `${images.length} images`;
  const imageVerb = images.length === 1 ? "is" : "are";

  // The explicit "Do not use shell commands" clause matters in real OpenCode
  // environments where global skills or shell snippets may also mention image
  // comprehension. We want attached-image analysis to flow through this plugin's
  // tool so the behavior is testable and provider-configurable.
  return `The user has shared ${imageCountText}. The image file path${images.length === 1 ? "" : "s"} ${imageVerb} available on the local filesystem:
${imageList}

When you need visual details, call the \`${toolName}\` tool with an \`image_path\` from the list above and a \`prompt\` of your choosing. Do not use shell commands or external scripts to inspect these attached image paths. Choose the prompt based on the user's request and the specific visual information you need.

User's request: ${userText || "(analyze the image)"}`;
}
