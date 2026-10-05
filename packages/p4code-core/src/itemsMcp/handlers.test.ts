// @effect-diagnostics nodeBuiltinImport:off - These tests exercise the real SQLite service in temp directories.
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import { Item, ItemSummary, ItemUnavailableError } from "@p4code/contracts/items";
import { expect, it } from "@effect/vitest";
import * as NodePath from "node:path";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FileSystem from "effect/FileSystem";
import * as Stream from "effect/Stream";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as ThreadManagement from "../../../../apps/server/src/orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../../../apps/server/src/mcp/McpInvocationContext.ts";
import * as GitHubIssue from "../GitHubIssue.ts";
import * as ItemService from "../ItemService.ts";
import { ItemsToolkitHandlersLive } from "./handlers.ts";
import { ItemsToolkit } from "./tools.ts";

const PROJECT_ID = ProjectId.make("project-items-mcp");
const THREAD_ID = ThreadId.make("calling-thread");
const ISSUE_URL = "https://github.com/owner/repo/issues/123";

interface ItemToolkitCall {
  readonly create: (url: string) => Effect.Effect<Item, unknown, never>;
  readonly list: () => Effect.Effect<ReadonlyArray<ItemSummary>, unknown, never>;
  readonly read: (itemId: string) => Effect.Effect<Item, unknown, never>;
  readonly linkThread: (
    itemId: string,
    threadId: string,
  ) => Effect.Effect<{ threadId: ThreadId }, unknown, never>;
}

const withHarness = <A>(
  run: (call: ItemToolkitCall) => Effect.Effect<A, unknown>,
  options?: {
    readonly fetch?: GitHubIssue.GitHubIssue["Service"]["fetch"];
  },
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped();
      const availableThreads = new Set(["thread-existing"]);
      const caller = {
        id: THREAD_ID,
        projectId: PROJECT_ID,
        deletedAt: null,
      } as OrchestrationV2ThreadShell;
      const dependencies = Layer.mergeAll(
        ItemService.layer(NodePath.join(dir, "p4code.sqlite")).pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(GitHubIssue.GitHubIssue, {
                fetch:
                  options?.fetch ??
                  (() =>
                    Effect.succeed({
                      url: ISSUE_URL,
                      title: "A reproducible bug",
                      state: "OPEN" as const,
                      author: "octocat",
                      body: "Steps to reproduce",
                      comments: [
                        {
                          author: "maintainer",
                          body: "We can reproduce it.",
                          createdAt: "2025-01-02T00:00:00Z",
                        },
                      ],
                    })),
              }),
              Layer.succeed(ItemService.Projects, { exists: () => Effect.succeed(true) }),
              Layer.succeed(ItemService.ItemThreadLauncher, {
                launch: () => Effect.succeed("unused"),
              }),
              Layer.succeed(ItemService.ItemThreadReader, {
                isAvailable: ({ threadId }) => Effect.succeed(availableThreads.has(threadId)),
              }),
              NodeServices.layer,
            ),
          ),
        ),
        Layer.mock(ThreadManagement.ThreadManagementService)({
          getThreadShell: () => Effect.succeed(caller),
        }),
      );
      const invocation = {
        environmentId: EnvironmentId.make("environment-items-mcp"),
        threadId: THREAD_ID,
        providerSessionId: "provider-session-items-mcp",
        providerInstanceId: ProviderInstanceId.make("codex"),
        capabilities: new Set(["orchestration" as const]),
        issuedAt: 1,
      };
      return yield* Effect.gen(function* () {
        const toolkit = yield* ItemsToolkit;
        const call: ItemToolkitCall = {
          create: (url) =>
            toolkit
              .handle("p4code_item_create", { url })
              .pipe(
                Stream.unwrap,
                Stream.runCollect,
                Effect.map((chunk) => chunk.at(-1)!.result as Item),
              )
              .pipe(
                Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
                Effect.provide(dependencies),
              ),
          list: () =>
            toolkit
              .handle("p4code_item_list", {})
              .pipe(
                Stream.unwrap,
                Stream.runCollect,
                Effect.map((chunk) => chunk.at(-1)!.result as ReadonlyArray<ItemSummary>),
              )
              .pipe(
                Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
                Effect.provide(dependencies),
              ),
          read: (itemId) =>
            toolkit
              .handle("p4code_item_read", { itemId })
              .pipe(
                Stream.unwrap,
                Stream.runCollect,
                Effect.map((chunk) => chunk.at(-1)!.result as Item),
              )
              .pipe(
                Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
                Effect.provide(dependencies),
              ),
          linkThread: (itemId, threadId) =>
            toolkit
              .handle("p4code_item_link_thread", { itemId, threadId })
              .pipe(
                Stream.unwrap,
                Stream.runCollect,
                Effect.map((chunk) => chunk.at(-1)!.result as { threadId: ThreadId }),
              )
              .pipe(
                Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
                Effect.provide(dependencies),
              ),
        };
        return yield* run(call);
      }).pipe(Effect.provide(ItemsToolkitHandlersLive.pipe(Layer.provide(dependencies))));
    }).pipe(Effect.provide(NodeServices.layer)),
  );

it.live("lets an agent create, list, read, and link a project's Item through the toolkit", () =>
  withHarness((call) =>
    Effect.gen(function* () {
      const created = yield* call.create(ISSUE_URL);
      const listed = yield* call.list();
      yield* call.linkThread(created.id, "thread-existing");
      const read = yield* call.read(created.id);

      expect(listed).toEqual([
        {
          id: created.id,
          projectId: PROJECT_ID,
          url: ISSUE_URL,
          title: "A reproducible bug",
          state: "OPEN",
          author: "octocat",
        },
      ]);
      expect(read).toMatchObject({
        title: "A reproducible bug",
        body: "Steps to reproduce",
        comments: [
          { author: "maintainer", body: "We can reproduce it.", createdAt: "2025-01-02T00:00:00Z" },
        ],
        threads: [{ threadId: "thread-existing", available: true }],
      });
    }),
  ),
);

it.live("keeps invalid requests and unavailable GitHub reads as distinct tool failures", () =>
  Effect.gen(function* () {
    const requestResult = yield* withHarness((call) =>
      call.create("https://example.com/issue/123").pipe(
        Effect.match({
          onFailure: (left) => ({ _tag: "Left" as const, left }),
          onSuccess: () => ({ _tag: "Right" as const }),
        }),
      ),
    );
    expect(requestResult._tag).toBe("Left");
    if (requestResult._tag === "Left") {
      expect(requestResult.left).toMatchObject({ _tag: "ItemRequestError" });
    }

    const unavailableResult = yield* withHarness(
      (call) =>
        call.create(ISSUE_URL).pipe(
          Effect.match({
            onFailure: (left) => ({ _tag: "Left" as const, left }),
            onSuccess: () => ({ _tag: "Right" as const }),
          }),
        ),
      { fetch: () => Effect.fail(new ItemUnavailableError({ message: "GitHub is unavailable." })) },
    );
    expect(unavailableResult._tag).toBe("Left");
    if (unavailableResult._tag === "Left") {
      expect(unavailableResult.left).toMatchObject({
        _tag: "ItemUnavailableError",
        message: "GitHub is unavailable.",
      });
    }
  }),
);
