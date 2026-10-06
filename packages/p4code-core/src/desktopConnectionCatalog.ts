import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as Crypto from "effect/Crypto";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";

import * as DesktopConnectionCatalogStore from "../../../apps/desktop/src/app/DesktopConnectionCatalogStore.ts";
import * as ElectronSafeStorage from "../../../apps/desktop/src/electron/ElectronSafeStorage.ts";

const PackageIdentity = Schema.Struct({ name: Schema.String });
const EncryptedCatalog = Schema.Struct({
  version: Schema.Literal(1),
  encryptedCatalog: Schema.String,
});
const decodePackageIdentity = Schema.decodeEffect(Schema.fromJsonString(PackageIdentity));
const decodeEncryptedCatalog = Schema.decodeEffect(Schema.fromJsonString(EncryptedCatalog));
const encodeEncryptedCatalog = Schema.encodeEffect(Schema.fromJsonString(EncryptedCatalog));

/** The fork shares server state with T3 Code, but owns its desktop credentials. */
export const makeP4CodeCatalogStore = Effect.fn("p4code.desktopConnectionCatalog.make")(
  function* (input: { readonly appRoot: string; readonly stateDir: string }) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const crypto = yield* Crypto.Crypto;
    const safeStorage = yield* ElectronSafeStorage.ElectronSafeStorage;
    const packageJson = yield* fs
      .readFileString(path.join(input.appRoot, "package.json"))
      .pipe(Effect.option);
    const identity = yield* Option.match(packageJson, {
      onNone: () => Effect.succeedNone,
      onSome: (raw) => decodePackageIdentity(raw).pipe(Effect.option),
    });
    if (Option.isNone(identity) || identity.value.name !== "p4code") {
      return Option.none<DesktopConnectionCatalogStore.DesktopConnectionCatalogStore["Service"]>();
    }

    const catalogPath = path.join(input.stateDir, "p4code-connection-catalog.json");
    const unreadable = yield* Ref.make(false);

    const read = Effect.gen(function* () {
      const raw = yield* fs.readFileString(catalogPath).pipe(
        Effect.catchIf(
          (error) => error.reason._tag === "NotFound",
          () => Effect.succeed<string | null>(null),
        ),
      );
      if (raw === null) return Option.none<string>();
      const parsed = yield* decodeEncryptedCatalog(raw);
      const encrypted = yield* Effect.fromResult(Encoding.decodeBase64(parsed.encryptedCatalog));
      const decrypted = yield* safeStorage.decryptString(encrypted);
      return Option.some(decrypted);
    }).pipe(
      Effect.catch((error) =>
        Effect.gen(function* () {
          yield* Ref.set(unreadable, true);
          yield* Effect.logWarning(
            "P4 Code connection catalog is unreadable; local threads remain available.",
            {
              catalogPath,
              error: String(error),
            },
          );
          return Option.none<string>();
        }),
      ),
    );

    const store = DesktopConnectionCatalogStore.DesktopConnectionCatalogStore.of({
      get: read,
      set: (catalog) =>
        Effect.gen(function* () {
          yield* read;
          if (yield* Ref.get(unreadable)) return false;
          if (
            !(yield* safeStorage.isEncryptionAvailable.pipe(
              Effect.mapError(
                (cause) =>
                  new DesktopConnectionCatalogStore.DesktopConnectionCatalogStoreProtectionError({
                    operation: "check-encryption-availability",
                    catalogPath,
                    cause,
                  }),
              ),
            ))
          )
            return false;

          const encryptedCatalog = Encoding.encodeBase64(
            yield* safeStorage.encryptString(catalog).pipe(
              Effect.mapError(
                (cause) =>
                  new DesktopConnectionCatalogStore.DesktopConnectionCatalogStoreProtectionError({
                    operation: "encrypt-catalog",
                    catalogPath,
                    cause,
                  }),
              ),
            ),
          );
          const suffix = (yield* crypto.randomUUIDv4.pipe(
            Effect.mapError(
              (cause) =>
                new DesktopConnectionCatalogStore.DesktopConnectionCatalogStoreWriteError({
                  operation: "create-temporary-file-name",
                  path: catalogPath,
                  cause,
                }),
            ),
          )).replace(/-/g, "");
          const temporaryPath = `${catalogPath}.${process.pid}.${suffix}.tmp`;
          const encoded = yield* encodeEncryptedCatalog({ version: 1, encryptedCatalog }).pipe(
            Effect.mapError(
              (cause) =>
                new DesktopConnectionCatalogStore.DesktopConnectionCatalogStoreWriteError({
                  operation: "encode-document",
                  path: catalogPath,
                  cause,
                }),
            ),
          );
          yield* fs.makeDirectory(path.dirname(catalogPath), { recursive: true }).pipe(
            Effect.mapError(
              (cause) =>
                new DesktopConnectionCatalogStore.DesktopConnectionCatalogStoreWriteError({
                  operation: "create-directory",
                  path: path.dirname(catalogPath),
                  cause,
                }),
            ),
          );
          yield* Effect.gen(function* () {
            yield* fs.writeFileString(temporaryPath, `${encoded}\n`).pipe(
              Effect.mapError(
                (cause) =>
                  new DesktopConnectionCatalogStore.DesktopConnectionCatalogStoreWriteError({
                    operation: "write-temporary-file",
                    path: temporaryPath,
                    cause,
                  }),
              ),
            );
            yield* fs.rename(temporaryPath, catalogPath).pipe(
              Effect.mapError(
                (cause) =>
                  new DesktopConnectionCatalogStore.DesktopConnectionCatalogStoreWriteError({
                    operation: "replace-catalog-file",
                    path: catalogPath,
                    cause,
                  }),
              ),
            );
          }).pipe(
            Effect.ensuring(
              fs.remove(temporaryPath, { force: true }).pipe(Effect.catch(() => Effect.void)),
            ),
          );
          return true;
        }),
      clear: fs.remove(catalogPath, { force: true }).pipe(
        Effect.tap(() => Ref.set(unreadable, false)),
        Effect.catch((error) =>
          Effect.logWarning("Could not clear the P4 Code connection catalog.", {
            catalogPath,
            error: String(error),
          }),
        ),
      ),
    });
    return Option.some(store);
  },
);
