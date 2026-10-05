import desktopIdentity from "../../p4code/desktop-identity.json" with { type: "json" };

export { desktopIdentity };

/** Apply the fork identity to the temporary package handed to electron-builder. */
export function applyDesktopIdentity<
  A extends { readonly name: string; readonly build: Record<string, unknown> },
>(manifest: A, platform: "mac" | "linux" | "win", version: string): A {
  return {
    ...manifest,
    name: desktopIdentity.name,
    build: {
      ...manifest.build,
      productName: desktopIdentity.productName,
      appId: desktopIdentity.appId,
      artifactName: desktopIdentity.name + "-${version}-${arch}.${ext}",
      ...(platform === "mac" && manifest.build.dmg
        ? {
            dmg: {
              ...(manifest.build.dmg as Record<string, unknown>),
              title: `${desktopIdentity.productName} ${version} Installer`,
            },
          }
        : {}),
      ...(platform === "linux"
        ? {
            linux: {
              ...(manifest.build.linux as Record<string, unknown>),
              executableName: desktopIdentity.name,
            },
          }
        : {}),
      // The artifact script probes this exact filename after packaging Windows.
      // Installation directories and NSIS identity use the fork productName/appId.
      ...(platform === "win"
        ? {
            win: {
              ...(manifest.build.win as Record<string, unknown>),
              executableName: manifest.build.productName,
            },
          }
        : {}),
    },
  };
}
