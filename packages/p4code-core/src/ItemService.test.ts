// @effect-diagnostics nodeBuiltinImport:off - These tests exercise the real SQLite service in temp directories.
import { expect, it } from "@effect/vitest";
import * as NodePath from "node:path";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FileSystem from "effect/FileSystem";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ProjectId } from "@t3tools/contracts";
import * as GitHubIssue from "./GitHubIssue.ts";
import * as ItemService from "./ItemService.ts";

it.live("rejects invalid Thread IDs in service calls before looking up a Thread", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped();
      const lookups: string[] = [];
      const layer = ItemService.layer(NodePath.join(dir, "p4code.sqlite")).pipe(
        Layer.provide(
          Layer.succeed(GitHubIssue.GitHubIssue, {
            fetch: () =>
              Effect.succeed({
                url: "https://github.com/owner/repo/issues/1",
                title: "Issue",
                state: "OPEN" as const,
                author: "author",
                body: "",
                comments: [],
              }),
          }),
        ),
        Layer.provide(
          Layer.succeed(ItemService.ItemThreadLauncher, {
            launch: () => Effect.succeed("created-thread"),
          }),
        ),
        Layer.provide(
          Layer.succeed(ItemService.ItemThreadReader, {
            isAvailable: ({ threadId }) => {
              lookups.push(threadId);
              return Effect.succeed(true);
            },
          }),
        ),
        Layer.provide(Layer.succeed(ItemService.Projects, { exists: () => Effect.succeed(true) })),
        Layer.provide(NodeServices.layer),
      );
      const results = yield* Effect.gen(function* () {
        const service = yield* ItemService.ItemService;
        const item = yield* service.create(
          ProjectId.make("project-a"),
          "https://github.com/owner/repo/issues/1",
        );
        const invalidIds = ["", " \t ", null, {}];
        const toResult = <A, E>(effect: Effect.Effect<A, E>) =>
          effect.pipe(
            Effect.match({
              onFailure: (left) => ({ _tag: "Left" as const, left }),
              onSuccess: () => ({ _tag: "Right" as const }),
            }),
          );
        const errors = [];
        for (const value of invalidIds) {
          const id = value as string;
          errors.push(yield* toResult(service.linkThread(item.projectId, item.id, id)));
          errors.push(yield* toResult(service.unlinkThread(item.projectId, item.id, id)));
        }
        return errors;
      }).pipe(Effect.provide(layer));

      expect(results).toHaveLength(8);
      for (const entry of results) {
        expect(entry._tag).toBe("Left");
        if (entry._tag === "Left") {
          expect(entry.left._tag).toBe("ItemRequestError");
          expect(entry.left.message).toBe("Thread ID must be a non-empty string.");
        }
      }
      expect(lookups).toEqual([]);
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);

it.live("deletes the Item snapshot and links while leaving its T3 Thread available", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped();
      const existingThreads = new Set(["thread-kept"]);
      const layer = ItemService.layer(NodePath.join(dir, "p4code.sqlite")).pipe(
        Layer.provide(
          Layer.succeed(GitHubIssue.GitHubIssue, {
            fetch: () =>
              Effect.succeed({
                url: "https://github.com/owner/repo/issues/1",
                title: "Issue",
                state: "OPEN" as const,
                author: "author",
                body: "Issue body",
                comments: [],
              }),
          }),
        ),
        Layer.provide(
          Layer.succeed(ItemService.ItemThreadLauncher, {
            launch: () => Effect.succeed("unused-thread"),
          }),
        ),
        Layer.provide(
          Layer.succeed(ItemService.ItemThreadReader, {
            isAvailable: ({ threadId }) => Effect.succeed(existingThreads.has(threadId)),
          }),
        ),
        Layer.provide(Layer.succeed(ItemService.Projects, { exists: () => Effect.succeed(true) })),
        Layer.provide(NodeServices.layer),
      );
      const result = yield* Effect.gen(function* () {
        const service = yield* ItemService.ItemService;
        const projectId = ProjectId.make("project-a");
        const deleted = yield* service.create(projectId, "https://github.com/owner/repo/issues/1");
        yield* service.linkThread(projectId, deleted.id, "thread-kept");
        yield* service.delete(projectId, deleted.id);
        const remaining = yield* service.list(projectId);
        const replacement = yield* service.create(
          projectId,
          "https://github.com/owner/repo/issues/1",
        );
        yield* service.linkThread(projectId, replacement.id, "thread-kept");
        const linkedThread = yield* service.get(projectId, replacement.id);
        return { remaining, linkedThread };
      }).pipe(Effect.provide(layer));

      expect(result.remaining).toEqual([]);
      expect(existingThreads.has("thread-kept")).toBe(true);
      expect(result.linkedThread.threads).toEqual([{ threadId: "thread-kept", available: true }]);
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);
