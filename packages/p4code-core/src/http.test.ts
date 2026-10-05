import { afterEach, expect, it } from "vite-plus/test";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Etag from "effect/unstable/http/Etag";
import * as NodeHttpPlatform from "@effect/platform-node/NodeHttpPlatform";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { HttpRouter } from "effect/unstable/http";
import {
  AuthSessionId,
  AuthStandardClientScopes,
  EnvironmentAuthenticatedAuth,
  EnvironmentAuthenticatedPrincipal,
} from "@t3tools/contracts";
import { ItemUnavailableError } from "@p4code/contracts/items";
import * as GitHubIssue from "./GitHubIssue.ts";
import * as ItemService from "./ItemService.ts";
import { routes } from "./http.ts";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).toReversed()) await close();
});
const issue = {
  url: "https://github.com/pierophp/p4code/issues/5",
  title: "Tracer bullet",
  state: "OPEN" as const,
  author: "pierophp",
};
async function fixture(
  filename: string,
  options: {
    scopes?: ReadonlyArray<import("@t3tools/contracts").AuthEnvironmentScope>;
    exists?: boolean;
    adapter?: GitHubIssue.GitHubIssue["Service"];
  } = {},
) {
  const app = HttpRouter.toWebHandler(
    routes.pipe(
      Layer.provide(
        ItemService.layer(filename).pipe(
          Layer.provide(
            Layer.succeed(
              GitHubIssue.GitHubIssue,
              options.adapter ?? { fetch: () => Effect.succeed(issue) },
            ),
          ),
          Layer.provide(
            Layer.succeed(ItemService.Projects, {
              exists: () => Effect.succeed(options.exists ?? true),
            }),
          ),
          Layer.provide(NodeServices.layer),
        ),
      ),
      Layer.provide(
        Layer.succeed(EnvironmentAuthenticatedAuth, (effect) =>
          effect.pipe(
            Effect.provideService(EnvironmentAuthenticatedPrincipal, {
              sessionId: AuthSessionId.make("test"),
              subject: "test",
              method: "bearer-access-token",
              scopes: new Set(options.scopes ?? AuthStandardClientScopes),
            }),
          ),
        ),
      ),
      Layer.provide(Etag.layer),
      Layer.provide(NodeHttpPlatform.layer),
      Layer.provide(NodeServices.layer),
    ),
    { disableLogger: true },
  );
  cleanup.push(app.dispose);
  return app;
}
const request = (project: string, url?: string) =>
  new Request(
    `http://t3.test/api/p4code/projects/${project}/items`,
    url === undefined
      ? {}
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url }),
        },
  );
it("creates an issue snapshot and lists only its Project, including after reopening SQLite", async () => {
  const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "p4code-items-"));
  cleanup.push(() => NodeFSP.rm(dir, { recursive: true, force: true }));
  const filename = NodePath.join(dir, "p4code.sqlite");
  const app = await fixture(filename);
  const created = await app.handler(request("project-a", issue.url));
  expect(created.status).toBe(200);
  const item = await created.json();
  expect(item).toEqual({ id: expect.any(String), projectId: "project-a", ...issue });
  expect(await (await app.handler(request("project-b"))).json()).toEqual([]);
  await app.dispose();
  cleanup.pop();
  const reopened = await fixture(filename);
  expect(await (await reopened.handler(request("project-a"))).json()).toEqual([item]);
});

async function temporaryDatabase() {
  const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "p4code-items-"));
  cleanup.push(() => NodeFSP.rm(dir, { recursive: true, force: true }));
  return NodePath.join(dir, "p4code.sqlite");
}
it("rejects malformed issue URLs without creating an Item", async () => {
  const app = await fixture(await temporaryDatabase());
  for (const url of [
    "https://github.com/owner/repo/pull/5",
    "https://example.com/owner/repo/issues/5",
    "--help",
  ]) {
    expect((await app.handler(request("project-a", url))).status).toBe(400);
  }
  expect(await (await app.handler(request("project-a"))).json()).toEqual([]);
});
it("requires operate scope to create and read scope to list", async () => {
  const app = await fixture(await temporaryDatabase(), { scopes: [] });
  expect((await app.handler(request("project-a", issue.url))).status).toBe(403);
  expect((await app.handler(request("project-a"))).status).toBe(403);
});
it("rejects Projects that do not exist", async () => {
  const app = await fixture(await temporaryDatabase(), { exists: false });
  expect((await app.handler(request("missing", issue.url))).status).toBe(400);
  expect((await app.handler(request("missing"))).status).toBe(400);
});

it("reports adapter failures without saving a partial Item", async () => {
  const app = await fixture(await temporaryDatabase(), {
    adapter: {
      fetch: () =>
        Effect.fail(
          new ItemUnavailableError({
            message: "GitHub CLI is not authenticated. Run gh auth login.",
          }),
        ),
    },
  });
  const response = await app.handler(request("project-a", issue.url));
  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({
    _tag: "ItemUnavailableError",
    message: "GitHub CLI is not authenticated. Run gh auth login.",
  });
  expect(await (await app.handler(request("project-a"))).json()).toEqual([]);
});
