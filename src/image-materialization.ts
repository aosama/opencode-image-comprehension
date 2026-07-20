// Barrel file: re-exports everything from the image-materialization sub-modules
// to preserve the public API. Code that imports from "./image-materialization.js"
// will continue to work without changes.

export { isImageFilePart, parseBase64DataUrl } from "./image-detection.js";

export { extractImagesFromParts } from "./image-process.js";

export { sweepStaleTempImages } from "./image-sweep.js";

export {
  resolveLocalImagePath,
  readLocalImageAsBase64,
  readLocalImage,
} from "./image-validate.js";
