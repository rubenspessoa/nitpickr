// Downloads the in-process embedding model into the image at build time so the
// worker never fetches it at runtime. Usage: node fetch-embedding-model.mjs <model-id> <cache-dir>
import { env, pipeline } from "@huggingface/transformers";

const [model, cacheDir] = process.argv.slice(2);
if (!model || !cacheDir) {
  throw new Error("Usage: fetch-embedding-model.mjs <model-id> <cache-dir>");
}
if (model.toLowerCase() === "off") {
  process.exit(0);
}
env.cacheDir = cacheDir;
const extractor = await pipeline("feature-extraction", model, { dtype: "q8" });
const output = await extractor("warm-up", { pooling: "mean", normalize: true });
console.log(`Cached ${model} (${output.dims.at(-1)} dims) in ${cacheDir}`);
