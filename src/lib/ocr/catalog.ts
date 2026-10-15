/**
 * Built-in PaddleOCR models (shared by server and client).
 *
 * PP-OCRv6 is one multilingual family covering Simplified/Traditional Chinese,
 * English, Japanese and Latin scripts; Korean still needs the PP-OCRv5 Korean
 * recognizer. Models run in-process on ONNX Runtime via ppu-paddle-ocr.
 */
export type OcrModelId = "small" | "medium" | "tiny" | "korean";

/**
 * Where model files come from. `auto` tries the hosts in order until one
 * works, so a blocked host (e.g. Hugging Face in mainland China) falls back
 * to ModelScope or PyPI without configuration.
 */
export type OcrSource =
  "auto" | "huggingface" | "hf-mirror" | "modelscope" | "pypi" | "custom";

export const OCR_MODELS: {
  id: OcrModelId;
  sizeMb: number;
  /** Not every host carries every model. */
  sources: Exclude<OcrSource, "auto">[];
}[] = [
  {
    id: "small",
    sizeMb: 31,
    sources: ["huggingface", "modelscope", "hf-mirror", "pypi", "custom"],
  },
  {
    id: "medium",
    sizeMb: 55,
    sources: ["huggingface", "modelscope", "hf-mirror", "custom"],
  },
  {
    id: "tiny",
    sizeMb: 7,
    sources: ["huggingface", "modelscope", "hf-mirror", "custom"],
  },
  {
    id: "korean",
    sizeMb: 18,
    sources: ["huggingface", "modelscope", "hf-mirror", "custom"],
  },
];

export const OCR_SOURCES: Exclude<OcrSource, "custom">[] = [
  "auto",
  "huggingface",
  "modelscope",
  "hf-mirror",
  "pypi",
];

export const DEFAULT_OCR_MODEL: OcrModelId = "small";
