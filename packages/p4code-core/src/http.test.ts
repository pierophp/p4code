// @effect-diagnostics nodeBuiltinImport:off - Tests exercise the real SQLite HTTP boundary in temp directories.
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
  body: "# Description\n\nLong context.",
  comments: [
    { author: "reviewer", body: "Looks good.", createdAt: "2024-01-01T00:00:00Z" },
    { author: "maintainer", body: "Thanks!", createdAt: "2024-01-02T00:00:00Z" },
  ],
};
async function fixture(
  filename: string,
  options: {
    scopes?: ReadonlyArray<import("@t3tools/contracts").AuthEnvironmentScope>;
    exists?: boolean;
    adapter?: GitHubIssue.GitHubIssue["Service"];
    threadLauncher?: ItemService.ItemThreadLauncher["Service"];
  } = {},
) {
  let threadLaunchCount = 0;
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
            Layer.succeed(
              ItemService.ItemThreadLauncher,
              options.threadLauncher ?? {
                launch: () => Effect.succeed(`thread-created-${++threadLaunchCount}`),
              },
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
const detailRequest = (project: string, id: string) =>
  new Request(`http://t3.test/api/p4code/projects/${project}/items/${id}`);
const refreshRequest = (project: string, id: string) =>
  new Request(`http://t3.test/api/p4code/projects/${project}/items/${id}/refresh`, {
    method: "POST",
  });
const startThreadRequest = (project: string, id: string) =>
  new Request(`http://t3.test/api/p4code/projects/${project}/items/${id}/threads`, {
    method: "POST",
  });
it("creates an issue snapshot and lists only its Project, including after reopening SQLite", async () => {
  const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "p4code-items-"));
  cleanup.push(() => NodeFSP.rm(dir, { recursive: true, force: true }));
  const filename = NodePath.join(dir, "p4code.sqlite");
  const app = await fixture(filename);
  const created = await app.handler(request("project-a", issue.url));
  expect(created.status).toBe(200);
  const item = await created.json();
  expect(item).toEqual({
    id: expect.any(String),
    projectId: "project-a",
    ...issue,
    threads: [],
    lastRefreshedAt: expect.any(String),
    refreshError: null,
  });
  expect(await (await app.handler(request("project-b"))).json()).toEqual([]);
  expect(await (await app.handler(request("project-a"))).json()).toEqual([
    {
      id: item.id,
      projectId: "project-a",
      url: issue.url,
      title: issue.title,
      state: issue.state,
      author: issue.author,
    },
  ]);
  const detail = await (await app.handler(detailRequest("project-a", item.id))).json();
  expect(detail).toEqual({ ...item, lastRefreshedAt: expect.any(String) });
  expect(Date.parse(detail.lastRefreshedAt)).toBeGreaterThanOrEqual(
    Date.parse(item.lastRefreshedAt),
  );
  expect(await (await app.handler(startThreadRequest("project-a", item.id))).json()).toEqual({
    threadId: "thread-created-1",
  });
  expect(await (await app.handler(startThreadRequest("project-a", item.id))).json()).toEqual({
    threadId: "thread-created-2",
  });
  expect((await (await app.handler(detailRequest("project-a", item.id))).json()).threads).toEqual([
    { threadId: "thread-created-1" },
    { threadId: "thread-created-2" },
  ]);
  await app.dispose();
  cleanup.pop();
  const reopened = await fixture(filename);
  expect(await (await reopened.handler(request("project-a"))).json()).toEqual([
    {
      id: item.id,
      projectId: "project-a",
      url: issue.url,
      title: issue.title,
      state: issue.state,
      author: issue.author,
    },
  ]);
  const reopenedDetail = await (await reopened.handler(detailRequest("project-a", item.id))).json();
  expect(reopenedDetail.body).toBe(issue.body);
  expect(reopenedDetail.comments).toEqual(issue.comments);
  expect(reopenedDetail.threads).toEqual([
    { threadId: "thread-created-1" },
    { threadId: "thread-created-2" },
  ]);
  expect(Date.parse(reopenedDetail.lastRefreshedAt)).toBeGreaterThanOrEqual(
    Date.parse(item.lastRefreshedAt),
  );
});

it("refreshes on detail and explicit requests while preserving the cached snapshot on failure", async () => {
  const calls: string[] = [];
  const app = await fixture(await temporaryDatabase(), {
    adapter: {
      fetch: () => {
        calls.push("fetch");
        return calls.length === 1
          ? Effect.succeed(issue)
          : Effect.fail(
              new ItemUnavailableError({
                message: "GitHub rate limit exceeded. Try again after the quota resets.",
              }),
            );
      },
    },
  });
  const created = await app.handler(request("project-a", issue.url));
  const item = await created.json();
  const opened = await app.handler(detailRequest("project-a", item.id));
  expect(opened.status).toBe(200);
  expect(await opened.json()).toEqual({
    ...item,
    refreshError: "GitHub rate limit exceeded. Try again after the quota resets.",
  });
  const refreshed = await app.handler(refreshRequest("project-a", item.id));
  expect(refreshed.status).toBe(200);
  expect(await refreshed.json()).toEqual({
    ...item,
    refreshError: "GitHub rate limit exceeded. Try again after the quota resets.",
  });
  expect(calls).toHaveLength(3);
  const persisted = await app.handler(detailRequest("project-a", item.id));
  expect((await persisted.json()).body).toBe(issue.body);
});

it("stores the latest snapshot and timestamp after an explicit refresh", async () => {
  const updated = { ...issue, title: "Updated issue title", state: "CLOSED" as const };
  let calls = 0;
  const app = await fixture(await temporaryDatabase(), {
    adapter: {
      fetch: () => Effect.succeed(++calls === 1 ? issue : updated),
    },
  });
  const created = await app.handler(request("project-a", issue.url));
  const original = await created.json();
  const response = await app.handler(refreshRequest("project-a", original.id));
  expect(response.status).toBe(200);
  const refreshed = await response.json();
  expect(refreshed.title).toBe(updated.title);
  expect(refreshed.state).toBe(updated.state);
  expect(refreshed.refreshError).toBeNull();
  expect(Date.parse(refreshed.lastRefreshedAt)).toBeGreaterThanOrEqual(
    Date.parse(original.lastRefreshedAt),
  );
  const persisted = await app.handler(detailRequest("project-a", original.id));
  expect((await persisted.json()).title).toBe(updated.title);
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
  expect((await app.handler(detailRequest("project-a", "1"))).status).toBe(403);
  expect((await app.handler(refreshRequest("project-a", "1"))).status).toBe(403);
});
it("rejects Projects that do not exist", async () => {
  const app = await fixture(await temporaryDatabase(), { exists: false });
  expect((await app.handler(request("missing", issue.url))).status).toBe(400);
  expect((await app.handler(request("missing"))).status).toBe(400);
  expect((await app.handler(detailRequest("missing", "1"))).status).toBe(400);
});

it("returns a clean not-found response for an Item outside the Project", async () => {
  const app = await fixture(await temporaryDatabase());
  const response = await app.handler(detailRequest("project-a", "900"));
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ _tag: "ItemRequestError", message: "Item not found." });
});

it("serves empty comments and long cached Markdown through the detail route", async () => {
  const longBody = `# Issue details\n\n${"A useful paragraph.\n\n".repeat(5_000)}`;
  const longComment = "Please keep this context readable. ".repeat(8_000);
  const app = await fixture(await temporaryDatabase(), {
    adapter: {
      fetch: () => Effect.succeed({ ...issue, body: longBody, comments: [] }),
    },
  });
  const created = await app.handler(request("project-a", issue.url));
  const item = await created.json();
  const detail = await (await app.handler(detailRequest("project-a", item.id))).json();
  expect(detail.body).toBe(longBody);
  expect(detail.comments).toEqual([]);

  const longApp = await fixture(await temporaryDatabase(), {
    adapter: {
      fetch: () =>
        Effect.succeed({
          ...issue,
          body: longBody,
          comments: [{ author: "reviewer", body: longComment, createdAt: "2024-01-01T00:00:00Z" }],
        }),
    },
  });
  const longCreated = await longApp.handler(request("project-a", issue.url));
  const longItem = await longCreated.json();
  const longDetail = await (await longApp.handler(detailRequest("project-a", longItem.id))).json();
  expect(longDetail.body).toBe(longBody);
  expect(longDetail.comments[0].body).toBe(longComment);
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
