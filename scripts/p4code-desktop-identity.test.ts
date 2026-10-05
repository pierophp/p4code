import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as NodeServices from "@effect/platform-node/NodeServices";

import { createBuildConfig } from "./build-desktop-artifact.ts";
import { applyDesktopIdentity } from "./lib/p4code-desktop-identity.ts";

it.effect("stages a distinct macOS product and bundle identity", () =>
  Effect.gen(function* () {
    const build = yield* createBuildConfig(
      "mac",
      "dmg",
      "1.2.3",
      false,
      false,
      undefined,
      undefined,
    );
    const staged = applyDesktopIdentity({ name: "t3code", build }, "mac", "1.2.3");
    assert.equal(staged.name, "p4code");
    assert.equal(staged.build.productName, "p4code");
    assert.equal(staged.build.appId, "com.pierophp.p4code");
    assert.equal(staged.build.artifactName, "p4code-${version}-${arch}.${ext}");
    assert.equal((staged.build.dmg as { title: string }).title, "p4code 1.2.3 Installer");
    assert.equal(build.productName, "T3 Code (Alpha)");
    assert.equal(build.appId, "com.t3tools.t3code");
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("keeps nightly builds under the fork identity", () =>
  Effect.gen(function* () {
    const build = yield* createBuildConfig(
      "mac",
      "zip",
      "1.2.3-nightly.20261005.1",
      false,
      false,
      undefined,
      undefined,
    );
    const staged = applyDesktopIdentity(
      { name: "t3code", build },
      "mac",
      "1.2.3-nightly.20261005.1",
    );
    assert.equal(staged.build.productName, "p4code");
    assert.equal(staged.build.appId, "com.pierophp.p4code");
    assert.notProperty(staged.build, "dmg");
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("gives Linux its own package and executable without changing runtime options", () =>
  Effect.gen(function* () {
    const build = yield* createBuildConfig(
      "linux",
      "AppImage",
      "1.2.3",
      false,
      false,
      undefined,
      undefined,
    );
    const staged = applyDesktopIdentity(
      { name: "t3code", main: "boot.cjs", build },
      "linux",
      "1.2.3",
    );
    assert.equal(staged.name, "p4code");
    assert.equal(staged.build.productName, "p4code");
    assert.equal(staged.build.appId, "com.pierophp.p4code");
    assert.equal((staged.build.linux as { executableName: string }).executableName, "p4code");
    assert.equal(staged.main, "boot.cjs");
    assert.deepStrictEqual(staged.build.extraResources, build.extraResources);
    assert.deepStrictEqual(staged.build.deb, build.deb);
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("gives NSIS its own identity while preserving the Windows payload probe filename", () =>
  Effect.gen(function* () {
    const build = yield* createBuildConfig(
      "win",
      "nsis",
      "1.2.3",
      false,
      false,
      undefined,
      undefined,
    );
    const staged = applyDesktopIdentity({ name: "t3code", build }, "win", "1.2.3");
    assert.equal(staged.build.productName, "p4code");
    assert.equal(staged.build.appId, "com.pierophp.p4code");
    assert.equal(
      (staged.build.win as { executableName: string }).executableName,
      "T3 Code (Alpha)",
    );
    assert.deepStrictEqual(staged.build.nsis, build.nsis);
  }).pipe(Effect.provide(NodeServices.layer)),
);
