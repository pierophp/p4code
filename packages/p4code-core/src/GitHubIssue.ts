// @effect-diagnostics nodeBuiltinImport:off - Fork-local CLI adapter.
import * as NodeChildProcess from "node:child_process";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { IssueSnapshot, ItemUnavailableError } from "@p4code/contracts/items";

export class GitHubIssue extends Context.Service<
  GitHubIssue,
  {
    readonly fetch: (url: string) => Effect.Effect<IssueSnapshot, ItemUnavailableError>;
  }
>()("p4code/GitHubIssue") {}
const GitHubJson = Schema.Struct({
  url: IssueSnapshot.fields.url,
  title: Schema.String,
  state: IssueSnapshot.fields.state,
  author: Schema.Struct({ login: Schema.String }),
});

const hasStderr = Schema.is(Schema.Struct({ stderr: Schema.String }));
const decodeIssue = Schema.decodeUnknownEffect(Schema.fromJsonString(GitHubJson));

const runIssueCommand = (url: string, signal: AbortSignal) =>
  new Promise<string>((resolve, reject) => {
    NodeChildProcess.execFile(
      "gh",
      ["issue", "view", url, "--json", "url,title,state,author"],
      { timeout: 30_000, maxBuffer: 1024 * 1024, signal },
      (error, stdout, stderr) => {
        if (error) reject({ error, stderr });
        else resolve(stdout);
      },
    );
  });

/** Substitute the external CLI boundary when testing JSON translation and failures. */
export const layerWithRunner = (run: (url: string, signal: AbortSignal) => Promise<string>) =>
  Layer.succeed(GitHubIssue, {
    fetch: Effect.fn("GitHubIssue.fetch")(function* (url) {
      const stdout = yield* Effect.tryPromise({
        try: (signal) => run(url, signal),
        catch: (cause) => {
          const detail = hasStderr(cause) ? cause.stderr : "";
          const message = /rate limit/i.test(detail)
            ? "GitHub rate limit exceeded. Try again after the quota resets."
            : /auth login|not logged|authentication/i.test(detail)
              ? "GitHub CLI is not authenticated. Run gh auth login."
              : /not found|could not resolve|not accessible|HTTP (403|404)/i.test(detail)
                ? "Issue not found or inaccessible. Check the URL and repository access."
                : "Could not fetch the issue. Check that gh is installed and authenticated.";
          return new ItemUnavailableError({ message });
        },
      });
      const issue = yield* decodeIssue(stdout).pipe(
        Effect.mapError(
          () => new ItemUnavailableError({ message: "GitHub returned an invalid issue snapshot." }),
        ),
      );
      return { ...issue, author: issue.author.login };
    }),
  });

export const layer = layerWithRunner(runIssueCommand);
