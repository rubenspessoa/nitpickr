import {
  type InstructionBundle,
  InstructionLoader,
} from "./instruction-loader.js";

export interface GitHubInstructionClient {
  readTextFile(input: {
    installationId: string;
    owner: string;
    repo: string;
    path: string;
    ref: string;
  }): Promise<string | null>;
  listFiles(input: {
    installationId: string;
    owner: string;
    repo: string;
    path: string;
    ref: string;
  }): Promise<string[]>;
}

export class GitHubInstructionBundleLoader {
  readonly #client: GitHubInstructionClient;
  readonly #loader: InstructionLoader;

  constructor(client: GitHubInstructionClient) {
    this.#client = client;
    this.#loader = new InstructionLoader();
  }

  async loadForReview(input: {
    installationId: string;
    repository: {
      owner: string;
      name: string;
    };
    changeRequest: {
      headSha: string;
    };
  }): Promise<InstructionBundle> {
    const installationId = input.installationId;
    const owner = input.repository.owner;
    const repo = input.repository.name;
    const ref = input.changeRequest.headSha;

    return this.#loader.load({
      readFile: (path) =>
        this.#client.readTextFile({
          installationId,
          owner,
          repo,
          path,
          ref,
        }),
      listFiles: (prefix) =>
        this.#client.listFiles({
          installationId,
          owner,
          repo,
          path: prefix.replace(/\/$/, ""),
          ref,
        }),
    });
  }
}
