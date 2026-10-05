// @effect-diagnostics nodeBuiltinImport:off - Tests use isolated filesystem fixtures and a separate process.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as HomeLock from "./homeLock.ts";

it.live("refuses a second acquisition of the same T3 home with an identifiable error", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* fs.makeTempDirectoryScoped();
      yield* HomeLock.acquire(directory);
      const second = yield* HomeLock.acquire(directory).pipe(Effect.flip);
      assert.strictEqual(second._tag, "T3HomeLockedError");
      assert.strictEqual(second.directory, directory);
      assert.strictEqual(
        second.message,
        `T3 home "${directory}" is locked by another instance. Stop that instance before starting this server.`,
      );
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);

it.live("releases the home on shutdown so it can be acquired again", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* fs.makeTempDirectoryScoped();
      yield* Effect.scoped(HomeLock.acquire(directory));
      yield* HomeLock.acquire(directory);
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);

it.live("allows different T3 homes to run concurrently", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const first = yield* fs.makeTempDirectoryScoped();
      const second = yield* fs.makeTempDirectoryScoped();
      yield* HomeLock.acquire(first);
      yield* HomeLock.acquire(second);
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);

it.live("recovers an expired lease left by a crashed server", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* fs.makeTempDirectoryScoped();
      const abandonedLock = NodePath.join(directory, ".t3-server.lock");
      yield* fs.makeDirectory(abandonedLock);
      yield* Effect.promise(() => NodeFSP.utimes(abandonedLock, 0, 0));
      yield* HomeLock.acquire(directory);
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);

it.live("refuses a competing server process against the same home", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* fs.makeTempDirectoryScoped();
      yield* HomeLock.acquire(directory);
      const { stdout } = yield* Effect.promise(() =>
        NodeUtil.promisify(NodeChildProcess.execFile)(process.execPath, [
          "--input-type=module",
          "-e",
          `
            const [Effect, NodeServices, HomeLock] = await Promise.all([
              import(process.argv[2]), import(process.argv[3]), import(process.argv[4]),
            ]);
            await Effect.runPromise(
              Effect.scoped(HomeLock.acquire(process.argv[1])).pipe(
                Effect.match({ onSuccess: () => 'acquired', onFailure: error => error._tag }),
                Effect.provide(NodeServices.layer),
                Effect.tap(result => Effect.sync(() => process.stdout.write(result))),
              ),
            );
          `,
          directory,
          import.meta.resolve("effect/Effect"),
          import.meta.resolve("@effect/platform-node/NodeServices"),
          new URL("./homeLock.ts", import.meta.url).href,
        ]),
      );
      assert.strictEqual(stdout, "T3HomeLockedError");
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);
