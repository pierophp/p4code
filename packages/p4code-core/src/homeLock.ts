// @effect-diagnostics nodeBuiltinImport:off - The lease coordinates Node server processes.
import * as NodePath from "node:path";
import { lock } from "proper-lockfile";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";

export class T3HomeLockedError extends Schema.TaggedError<T3HomeLockedError>()(
  "T3HomeLockedError",
  { directory: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `T3 home "${this.directory}" is locked by another instance. Stop that instance before starting this server.`;
  }
}

export class T3HomeLockError extends Schema.TaggedError<T3HomeLockError>()("T3HomeLockError", {
  directory: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Could not acquire the lock on T3 home "${this.directory}".`;
  }
}

const isLocked = Schema.is(Schema.Struct({ code: Schema.Literal("ELOCKED") }));

/** Hold the T3 home until the server scope closes, after its database and workers stop. */
export const acquire = Effect.fn("T3HomeLock.acquire")(function* (directory: string) {
  const fs = yield* FileSystem.FileSystem;
  yield* fs
    .makeDirectory(directory, { recursive: true })
    .pipe(Effect.mapError((cause) => new T3HomeLockError({ directory, cause })));
  yield* Effect.acquireRelease(
    Effect.tryPromise({
      try: () =>
        lock(directory, {
          lockfilePath: NodePath.join(directory, ".t3-server.lock"),
          stale: 120_000,
          update: 10_000,
          retries: 0,
          // Keep the library's fatal onCompromised handler: a writer must stop if it loses its lease.
        }),
      catch: (cause) =>
        isLocked(cause)
          ? new T3HomeLockedError({ directory, cause })
          : new T3HomeLockError({ directory, cause }),
    }),
    (release) =>
      Effect.promise(() => release()).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Failed to release T3 home lock", { directory, cause }),
        ),
      ),
  );
});
