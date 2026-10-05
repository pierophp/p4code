// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import type { Item, ItemSummary } from "@p4code/contracts/items";
import { ItemsView } from "./ItemsView.tsx";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const summary: ItemSummary = {
  id: "1",
  projectId: "project-1" as ItemSummary["projectId"],
  url: "https://github.com/owner/repo/issues/9",
  title: "Track the Item's Threads",
  state: "OPEN",
  author: "owner",
};
const detail: Item = {
  ...summary,
  body: "Issue body",
  comments: [],
  threads: [
    { threadId: "thread-existing", available: true },
    { threadId: "thread-deleted", available: false },
  ],
  lastRefreshedAt: null,
  refreshError: null,
};

it("shows associated Threads and opens an existing or newly started Thread", async () => {
  const openThread = vi.fn();
  const startThread = vi.fn(async () => "thread-new");
  await act(async () => {
    root.render(
      <ItemsView
        list={async () => [summary]}
        create={async () => undefined}
        get={async () => detail}
        refresh={async () => detail}
        startThread={startThread}
        openThread={openThread}
      />,
    );
  });
  const itemButton = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === summary.title,
  );
  expect(itemButton).toBeDefined();
  await act(async () => itemButton?.click());

  const existing = [...container.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("thread-existing"),
  );
  expect(existing).toBeDefined();
  await act(async () => existing?.click());
  expect(openThread).toHaveBeenLastCalledWith("thread-existing");
  expect(container.textContent).toContain("Thread unavailable thread-deleted");
  expect(
    [...container.querySelectorAll("button")].some((button) =>
      button.textContent?.includes("thread-deleted"),
    ),
  ).toBe(false);

  const start = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Start replacement Thread",
  );
  expect(start).toBeDefined();
  await act(async () => start?.click());
  expect(startThread).toHaveBeenCalledWith(summary);
  expect(openThread).toHaveBeenLastCalledWith("thread-new");
});
