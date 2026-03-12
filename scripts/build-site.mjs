import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(currentDirectory, "..");
const sourceDirectory = join(repositoryRoot, "website");
const outputDirectory = join(repositoryRoot, "dist", "site");

async function main() {
  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });
  await cp(sourceDirectory, outputDirectory, { recursive: true });

  // Keep the shared mascot asset available in the final artifact for future page expansions.
  await cp(
    join(repositoryRoot, "assets", "nitpickr-mascot.png"),
    join(outputDirectory, "assets", "nitpickr-mascot.png"),
  );

  await writeFile(join(outputDirectory, ".nojekyll"), "");
  await cp(
    join(outputDirectory, "index.html"),
    join(outputDirectory, "404.html"),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
