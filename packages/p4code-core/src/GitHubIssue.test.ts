import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as GitHubIssue from "./GitHubIssue.ts";

const url = "https://github.com/pierophp/p4code/issues/5";
it.effect("translates gh JSON to the minimal issue snapshot", () =>
  Effect.gen(function* () {
    const adapter = yield* GitHubIssue.GitHubIssue;
    expect(yield* adapter.fetch(url)).toEqual({
      url,
      title: "Tracer bullet",
      state: "CLOSED",
      author: "pierophp",
    });
  }).pipe(
    Effect.provide(
      GitHubIssue.layerWithRunner(() =>
        Promise.resolve(
          '{"url":"https://github.com/pierophp/p4code/issues/5","title":"Tracer bullet","state":"CLOSED","author":{"login":"pierophp"},"body":"ignored"}',
        ),
      ),
    ),
  ),
);
it.effect("explains inaccessible issues", () =>
  Effect.gen(function* () {
    const adapter = yield* GitHubIssue.GitHubIssue;
    const error = yield* adapter.fetch(url).pipe(Effect.flip);
    expect(error.message).toBe(
      "Issue not found or inaccessible. Check the URL and repository access.",
    );
  }).pipe(
    Effect.provide(
      GitHubIssue.layerWithRunner(() =>
        Promise.reject({ stderr: "GraphQL: Resource not accessible by personal access token" }),
      ),
    ),
  ),
);

it.effect.each([
  ["API rate limit exceeded", "GitHub rate limit exceeded. Try again after the quota resets."],
  [
    "To get started, please run: gh auth login",
    "GitHub CLI is not authenticated. Run gh auth login.",
  ],
  [
    "Could not resolve to an Issue with the number of 5",
    "Issue not found or inaccessible. Check the URL and repository access.",
  ],
])("explains CLI failures: %s", ([stderr, message]) =>
  Effect.gen(function* () {
    const adapter = yield* GitHubIssue.GitHubIssue;
    const error = yield* adapter.fetch(url).pipe(Effect.flip);
    expect(error.message).toBe(message);
  }).pipe(Effect.provide(GitHubIssue.layerWithRunner(() => Promise.reject({ stderr })))),
);
it.effect("rejects invalid GitHub JSON", () =>
  Effect.gen(function* () {
    const adapter = yield* GitHubIssue.GitHubIssue;
    const error = yield* adapter.fetch(url).pipe(Effect.flip);
    expect(error.message).toBe("GitHub returned an invalid issue snapshot.");
  }).pipe(
    Effect.provide(GitHubIssue.layerWithRunner(() => Promise.resolve('{"title":"Incomplete"}'))),
  ),
);
